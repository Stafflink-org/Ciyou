// CRM du restaurant : blocage d'un client (avec motif, vérifié à la commande)
// et notes internes de l'équipe. Les agrégats de la fiche restent calculés par
// les triggers de commande.
import { COLLECTIONS, SUBCOLLECTIONS, type CustomerNote, type Restaurant, type RestaurantCustomer } from '@golink/shared';
import { db, FieldValue, Timestamp } from '../lib/admin';
import { actorFromCaller, writeAudit } from '../lib/audit';
import { callable } from '../lib/callable';
import { fail } from '../lib/errors';
import { requireRestaurantAccess } from '../lib/permissions';
import { z, zId, zReason } from '../lib/validation';

function restaurantRef(restaurantId: string) {
  return db.collection(COLLECTIONS.restaurants).doc(restaurantId);
}

function customerRef(restaurantId: string, customerId: string) {
  return restaurantRef(restaurantId).collection(SUBCOLLECTIONS.restaurants.customers).doc(customerId);
}

async function loadRestaurant(restaurantId: string): Promise<Restaurant> {
  const snap = await restaurantRef(restaurantId).get();
  if (!snap.exists) throw fail.notFound('Restaurant');
  return snap.data() as Restaurant;
}

// ------------------------------------------------------------------ Blocage

const setCustomerBlockedSchema = z
  .object({
    restaurantId: zId,
    customerIds: z.array(zId).min(1).max(50),
    blocked: z.boolean(),
    reason: zReason.nullish(),
  })
  .refine((data) => !data.blocked || Boolean(data.reason), { message: 'Indiquez le motif du blocage.', path: ['reason'] });

/**
 * Bloque ou débloque un ou plusieurs clients pour ce restaurant. Un client bloqué
 * ne peut plus commander dans l'établissement (contrôle de `placeOrder`).
 */
export const setCustomerBlocked = callable(setCustomerBlockedSchema, async (data, request) => {
  const actor = await requireRestaurantAccess(request, data.restaurantId, 'customers.manage', 'customers.block');
  const restaurant = await loadRestaurant(data.restaurantId);
  const ids = [...new Set(data.customerIds)];

  const changed = await db.runTransaction(async (tx) => {
    const refs = ids.map((id) => customerRef(data.restaurantId, id));
    const snaps = await Promise.all(refs.map((ref) => tx.get(ref)));
    const missing = snaps.find((snap) => !snap.exists);
    if (missing) throw fail.notFound('Client');
    const now = Timestamp.now();
    const updated: Array<{ id: string; name: string }> = [];
    snaps.forEach((snap, index) => {
      const current = snap.data() as RestaurantCustomer;
      if (current.blocked === data.blocked) return;
      const ref = refs[index];
      if (!ref) return;
      tx.update(ref, {
        blocked: data.blocked,
        blockedReason: data.blocked ? (data.reason ?? null) : null,
        blockedAt: data.blocked ? now : null,
        blockedBy: data.blocked ? actor.caller.uid : null,
        updatedAt: now,
      });
      updated.push({ id: snap.id, name: current.displayName });
    });
    return updated;
  });

  await Promise.all(
    changed.map((customer) =>
      writeAudit({
        actor: actorFromCaller(actor.caller, actor.kind === 'admin' ? 'admin' : 'restaurant'),
        action: data.blocked ? 'restaurant.customer_blocked' : 'restaurant.customer_unblocked',
        target: { type: 'client', id: customer.id, label: customer.name },
        reason: data.reason ?? null,
        before: { blocked: !data.blocked },
        after: { blocked: data.blocked, restaurantId: data.restaurantId, restaurantName: restaurant.name },
        countryId: restaurant.countryId,
        cityId: restaurant.cityId,
        request,
      }),
    ),
  );
  return { updated: changed.length, unchanged: ids.length - changed.length };
});

// ------------------------------------------------------------------ Notes internes

export const addCustomerNote = callable(
  z.object({ restaurantId: zId, customerId: zId, body: z.string().trim().min(2, 'La note est trop courte.').max(1000) }),
  async (data, request) => {
    const actor = await requireRestaurantAccess(request, data.restaurantId, 'customers.manage', 'customers.edit');
    const ref = customerRef(data.restaurantId, data.customerId);
    const noteRef = ref.collection(SUBCOLLECTIONS.customers.notes).doc();
    const authorName = actor.kind === 'member' ? actor.member.displayName || actor.caller.name : `${actor.caller.name} (Ciyou Eats)`;

    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) throw fail.notFound('Client');
      const now = Timestamp.now();
      const note: CustomerNote = { body: data.body, authorId: actor.caller.uid, authorName, createdAt: now };
      tx.set(noteRef, note);
      // La dernière note sert d'aperçu dans la liste et sur les tickets de commande.
      tx.update(ref, { internalNote: data.body, notesCount: FieldValue.increment(1), updatedAt: now });
    });
    return { noteId: noteRef.id };
  },
);

export const deleteCustomerNote = callable(
  z.object({ restaurantId: zId, customerId: zId, noteId: zId }),
  async (data, request) => {
    const actor = await requireRestaurantAccess(request, data.restaurantId, 'customers.manage', 'customers.edit');
    const ref = customerRef(data.restaurantId, data.customerId);
    const notes = ref.collection(SUBCOLLECTIONS.customers.notes);

    await db.runTransaction(async (tx) => {
      const [customerSnap, noteSnap] = await Promise.all([tx.get(ref), tx.get(notes.doc(data.noteId))]);
      if (!customerSnap.exists || !noteSnap.exists) throw fail.notFound('Note');
      const note = noteSnap.data() as CustomerNote;
      // Seuls l'auteur et le propriétaire de l'établissement peuvent retirer une note.
      const owner = actor.kind === 'member' && actor.member.role === 'owner';
      if (note.authorId !== actor.caller.uid && !owner && actor.kind !== 'admin') {
        throw fail.forbidden('Seul l’auteur de la note ou le propriétaire peut la supprimer.');
      }
      const latest = await tx.get(notes.orderBy('createdAt', 'desc').limit(2));
      const remaining = latest.docs.filter((doc) => doc.id !== data.noteId);
      const preview = remaining[0] ? (remaining[0].data() as CustomerNote).body : null;
      tx.delete(noteSnap.ref);
      tx.update(ref, { internalNote: preview, notesCount: FieldValue.increment(-1), updatedAt: Timestamp.now() });
    });
    return { deleted: true };
  },
);
