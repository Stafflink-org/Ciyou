// Réordonnancement de la carte (glisser-déposer) : sections, produits d'une section
// (y compris déplacement vers une autre section) et vitrine des produits mis en avant.
import { MENU_LIMITS, buildSearchKeywords } from '@golink/shared';
import { db } from '../lib/admin';
import { callable } from '../lib/callable';
import { fail } from '../lib/errors';
import { z, zId } from '../lib/validation';
import { menuCollection, requireMenuAccess, trackedUpdate, MENU_RUNTIME } from './common';

const schema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('sections'), restaurantId: zId, ids: z.array(zId).min(1).max(200) }),
  z.object({
    kind: z.literal('products'),
    restaurantId: zId,
    /** Section cible : null = « Sans section ». Les produits listés y sont rattachés. */
    sectionId: zId.nullable(),
    ids: z.array(zId).min(1).max(400),
  }),
  z.object({ kind: z.literal('featured'), restaurantId: zId, ids: z.array(zId).max(MENU_LIMITS.featured) }),
]);

export const reorderMenu = callable(schema, async (data, request) => {
  const context = await requireMenuAccess(request, data.restaurantId, 'menu.edit');
  const uid = context.actor.caller.uid;
  if (new Set(data.ids).size !== data.ids.length) throw fail.invalid('La liste contient des doublons.');

  if (data.kind === 'sections') {
    const sections = menuCollection(data.restaurantId, 'sections');
    const snaps = await db.getAll(...data.ids.map((id) => sections.doc(id)));
    if (snaps.some((snap) => !snap.exists)) throw fail.notFound('Section');
    const batch = db.batch();
    snaps.forEach((snap, order) => {
      if (snap.get('order') !== order) batch.update(snap.ref, { order, ...trackedUpdate(uid) });
    });
    await batch.commit();
    return { updated: data.ids.length };
  }

  const products = menuCollection(data.restaurantId, 'products');

  if (data.kind === 'products') {
    let sectionName: string | null = null;
    if (data.sectionId) {
      const section = await menuCollection(data.restaurantId, 'sections').doc(data.sectionId).get();
      if (!section.exists) throw fail.notFound('Section');
      sectionName = String(section.get('name') ?? '');
    }
    const snaps = await db.getAll(...data.ids.map((id) => products.doc(id)));
    if (snaps.some((snap) => !snap.exists)) throw fail.notFound('Produit');
    const batch = db.batch();
    snaps.forEach((snap, order) => {
      const moved = (snap.get('sectionId') ?? null) !== data.sectionId;
      if (!moved && snap.get('order') === order) return;
      const patch: Record<string, unknown> = { order, sectionId: data.sectionId, ...trackedUpdate(uid) };
      if (moved) patch.searchKeywords = buildSearchKeywords(String(snap.get('name') ?? ''), sectionName);
      batch.update(snap.ref, patch);
    });
    await batch.commit();
    return { updated: data.ids.length };
  }

  // Vitrine : les produits listés sont mis en avant dans cet ordre, les autres en sortent.
  const current = await products.where('featured', '==', true).get();
  const wanted = new Set(data.ids);
  const snaps = data.ids.length ? await db.getAll(...data.ids.map((id) => products.doc(id))) : [];
  if (snaps.some((snap) => !snap.exists)) throw fail.notFound('Produit');
  const batch = db.batch();
  snaps.forEach((snap, order) => {
    if (snap.get('featured') !== true || snap.get('featuredOrder') !== order) {
      batch.update(snap.ref, { featured: true, featuredOrder: order, ...trackedUpdate(uid) });
    }
  });
  current.docs
    .filter((doc) => !wanted.has(doc.id))
    .forEach((doc) => batch.update(doc.ref, { featured: false, featuredOrder: null, ...trackedUpdate(uid) }));
  await batch.commit();
  return { updated: data.ids.length };
}, MENU_RUNTIME);
