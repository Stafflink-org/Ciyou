// Suppression d'éléments de la carte vers la corbeille (restaurables pendant le
// délai réglé, `settings/retention.trashRetentionDays`, cf. `resolveTrashRetentionDays`)
// et restauration. Les liens retirés d'autres documents
// (option retirée de ses listes, liste retirée de ses produits, produits détachés
// d'une section) sont notés pour être rétablis à la restauration.
import {
  COLLECTIONS,
  MENU_LIMITS,
  type MenuSection,
  type OptionGroup,
  type Product,
  type TrashItem,
} from '@golink/shared';
import type { DocumentReference, DocumentSnapshot, WriteBatch } from 'firebase-admin/firestore';
import { db, FieldValue, Timestamp } from '../lib/admin';
import { callable } from '../lib/callable';
import { fail } from '../lib/errors';
import { resolveTrashRetentionDays } from '../platform/backups';
import { z, zId } from '../lib/validation';
import { auditMenu, menuCollection, nameKey, requireMenuAccess, restaurantRef, trackedUpdate, uniqueCopyName, type MenuContext, MENU_RUNTIME } from './common';

type MenuKind = NonNullable<TrashItem['menuKind']>;

const SUB_BY_KIND = { section: 'sections', product: 'products', option: 'options', optionGroup: 'optionGroups' } as const;

const trashSchema = z.object({
  restaurantId: zId,
  kind: z.enum(['section', 'product', 'option', 'optionGroup']),
  ids: z.array(zId).min(1).max(100),
  /** Section : supprimer aussi ses produits (sinon ils passent « Sans section »). */
  withProducts: z.boolean().default(false),
  reason: z.string().trim().max(300).nullish(),
});

/** Lot d'écriture qui se valide automatiquement avant la limite de 500 opérations. */
class Writer {
  private batch: WriteBatch = db.batch();
  private count = 0;
  private readonly pending: Array<Promise<unknown>> = [];

  private bump() {
    this.count += 1;
    if (this.count >= 450) {
      this.pending.push(this.batch.commit());
      this.batch = db.batch();
      this.count = 0;
    }
  }
  set(ref: DocumentReference, value: Record<string, unknown>) {
    this.batch.set(ref, value);
    this.bump();
  }
  update(ref: DocumentReference, value: Record<string, unknown>) {
    this.batch.update(ref, value);
    this.bump();
  }
  delete(ref: DocumentReference) {
    this.batch.delete(ref);
    this.bump();
  }
  async flush() {
    if (this.count > 0) this.pending.push(this.batch.commit());
    await Promise.all(this.pending);
  }
}

function labelOf(kind: MenuKind, data: Record<string, unknown>): string {
  const name = typeof data.name === 'string' ? data.name : '';
  const prefix = { section: 'Section', product: 'Produit', option: 'Option', optionGroup: 'Liste d’options' }[kind];
  return name ? `${prefix} « ${name} »` : prefix;
}

export const trashMenuItems = callable(trashSchema, async (data, request) => {
  const context = await requireMenuAccess(request, data.restaurantId, 'menu.edit');
  const uid = context.actor.caller.uid;
  const collection = menuCollection(data.restaurantId, SUB_BY_KIND[data.kind]);
  const snaps = await db.getAll(...data.ids.map((id) => collection.doc(id)));
  const existing = snaps.filter((snap) => snap.exists);
  if (existing.length === 0) throw fail.notFound('Élément');

  const products = menuCollection(data.restaurantId, 'products');
  const groups = menuCollection(data.restaurantId, 'optionGroups');
  const writer = new Writer();
  const purgeAt = Timestamp.fromMillis(Date.now() + (await resolveTrashRetentionDays()) * 86_400_000);
  const trashed: string[] = [];

  for (const snap of existing) {
    const snapshot = snap.data() ?? {};
    const children: TrashItem['children'] = [];
    let detached: TrashItem['detached'] = null;

    if (data.kind === 'section') {
      const inside = await products.where('sectionId', '==', snap.id).get();
      if (data.withProducts) {
        for (const product of inside.docs) {
          children.push({ path: product.ref.path, snapshot: product.data() });
          writer.delete(product.ref);
        }
      } else if (!inside.empty) {
        detached = { field: 'sectionId', paths: inside.docs.map((product) => product.ref.path) };
        inside.docs.forEach((product) => writer.update(product.ref, { sectionId: null, ...trackedUpdate(uid) }));
      }
    }

    if (data.kind === 'option') {
      const using = await groups.where('optionIds', 'array-contains', snap.id).get();
      if (!using.empty) detached = { field: 'optionIds', paths: using.docs.map((group) => group.ref.path) };
      for (const groupSnap of using.docs) {
        const group = groupSnap.data() as OptionGroup;
        const optionIds = group.optionIds.filter((id) => id !== snap.id);
        // Bornes réajustées au nombre d'options restantes ; une liste vide est désactivée.
        const ceiling = group.multiple ? optionIds.length : Math.min(1, optionIds.length);
        const max = optionIds.length === 0 ? 1 : Math.max(1, Math.min(group.max, ceiling));
        const min = Math.min(group.min, optionIds.length === 0 ? 0 : max);
        writer.update(groupSnap.ref, {
          optionIds,
          max,
          min,
          enabled: optionIds.length > 0 ? group.enabled : false,
          ...trackedUpdate(uid),
        });
      }
    }

    if (data.kind === 'optionGroup') {
      const using = await products.where('optionGroupIds', 'array-contains', snap.id).get();
      if (!using.empty) detached = { field: 'optionGroupIds', paths: using.docs.map((product) => product.ref.path) };
      using.docs.forEach((product) =>
        writer.update(product.ref, { optionGroupIds: FieldValue.arrayRemove(snap.id), ...trackedUpdate(uid) }),
      );
    }

    const item: Omit<TrashItem, 'deletedAt'> & { deletedAt: FieldValue } = {
      entity: { type: 'other', id: snap.id, label: labelOf(data.kind, snapshot) },
      path: snap.ref.path,
      snapshot,
      children,
      restaurantId: data.restaurantId,
      deletedBy: uid,
      deletedAt: FieldValue.serverTimestamp(),
      reason: data.reason || null,
      purgeAt,
      restoredAt: null,
      restoredBy: null,
      menuKind: data.kind,
      detached,
    };
    writer.set(db.collection(COLLECTIONS.trash).doc(), item as unknown as Record<string, unknown>);
    writer.delete(snap.ref);
    trashed.push(snap.id);
  }

  await writer.flush();
  await auditMenu(request, context, `menu_${data.kind}.trashed`, { type: 'other', id: trashed.join(',').slice(0, 300), label: `${trashed.length} élément(s)` }, {
    reason: data.reason ?? null,
    after: { kind: data.kind, ids: trashed, withProducts: data.withProducts },
  });
  return { trashed: trashed.length };
}, MENU_RUNTIME);

// ------------------------------------------------------------------ Restauration

const restoreSchema = z.object({ trashId: zId });

async function uniqueSectionName(restaurantId: string, name: string): Promise<string> {
  const all = await menuCollection(restaurantId, 'sections').get();
  const taken = new Set(all.docs.map((doc) => nameKey(String(doc.get('name') ?? ''))));
  return taken.has(nameKey(name)) ? uniqueCopyName(name, taken, MENU_LIMITS.sectionName, 'restaurée') : name;
}

export const restoreMenuItem = callable(restoreSchema, async (data, request) => {
  const trashRef = db.collection(COLLECTIONS.trash).doc(data.trashId);
  const trashSnap = await trashRef.get();
  if (!trashSnap.exists) throw fail.notFound('Élément de la corbeille');
  const item = trashSnap.data() as TrashItem;
  if (!item.restaurantId || !item.menuKind) throw fail.precondition('Cet élément ne provient pas d’une carte de restaurant.');
  if (item.restoredAt) throw fail.precondition('Cet élément a déjà été restauré.');

  const context: MenuContext = await requireMenuAccess(request, item.restaurantId, 'menu.edit');
  const uid = context.actor.caller.uid;
  const targetRef = db.doc(item.path);
  if (!targetRef.path.startsWith(`${restaurantRef(item.restaurantId).path}/`)) throw fail.forbidden();
  if ((await targetRef.get()).exists) throw fail.alreadyExists('Un élément existe déjà à cet emplacement.');

  const snapshot = { ...item.snapshot } as Record<string, unknown>;
  if (item.menuKind === 'section') {
    snapshot.name = await uniqueSectionName(item.restaurantId, String((snapshot as unknown as MenuSection).name ?? 'Section'));
  }
  if (item.menuKind === 'product') {
    const product = snapshot as unknown as Product;
    if (product.sectionId) {
      const section = await menuCollection(item.restaurantId, 'sections').doc(product.sectionId).get();
      if (!section.exists) snapshot.sectionId = null;
    }
    // Les listes d'options supprimées entre-temps ne sont pas rattachées.
    const groupIds = product.optionGroupIds ?? [];
    if (groupIds.length) {
      const groups = await db.getAll(...groupIds.map((id) => menuCollection(item.restaurantId!, 'optionGroups').doc(id)));
      snapshot.optionGroupIds = groups.filter((g) => g.exists).map((g) => g.id);
    }
  }
  if (item.menuKind === 'optionGroup') {
    const group = snapshot as unknown as OptionGroup;
    const options = await db.getAll(...group.optionIds.map((id) => menuCollection(item.restaurantId!, 'options').doc(id)));
    const optionIds = options.filter((o) => o.exists).map((o) => o.id);
    snapshot.optionIds = optionIds;
    if (optionIds.length === 0) snapshot.enabled = false;
  }

  const writer = new Writer();
  writer.set(targetRef, { ...snapshot, ...trackedUpdate(uid) });
  for (const child of item.children ?? []) {
    const childRef = db.doc(child.path);
    writer.set(childRef, { ...child.snapshot, ...trackedUpdate(uid) });
  }

  // Liens rétablis sur les documents encore présents.
  if (item.detached?.paths.length) {
    const linked: DocumentSnapshot[] = await db.getAll(...item.detached.paths.map((path) => db.doc(path)));
    for (const doc of linked) {
      if (!doc.exists) continue;
      if (item.detached.field === 'sectionId') {
        if (doc.get('sectionId') == null) writer.update(doc.ref, { sectionId: targetRef.id, ...trackedUpdate(uid) });
      } else if (item.detached.field === 'optionIds') {
        const group = doc.data() as OptionGroup;
        writer.update(doc.ref, { optionIds: FieldValue.arrayUnion(targetRef.id), ...(group.optionIds.length === 0 ? { max: 1, min: 0 } : {}), ...trackedUpdate(uid) });
      } else if (item.detached.field === 'optionGroupIds') {
        writer.update(doc.ref, { optionGroupIds: FieldValue.arrayUnion(targetRef.id), ...trackedUpdate(uid) });
      }
    }
  }

  writer.update(trashRef, { restoredAt: FieldValue.serverTimestamp(), restoredBy: uid });
  await writer.flush();
  await auditMenu(request, context, `menu_${item.menuKind}.restored`, { type: 'other', id: targetRef.id, label: item.entity.label ?? null });
  return { path: targetRef.path, name: String(snapshot.name ?? '') };
}, MENU_RUNTIME);
