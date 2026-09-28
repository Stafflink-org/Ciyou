// « Voir comme le restaurant » : session limitée dans le temps, en lecture seule,
// ouverte avec un motif et tracée au journal d'audit (ouverture et fin).
import { COLLECTIONS, adminHasPermission, type ImpersonationSession, type Restaurant } from '@golink/shared';
import { db, Timestamp } from '../../lib/admin';
import { writeAudit } from '../../lib/audit';
import { fail } from '../../lib/errors';
import { requireAdmin } from '../../lib/permissions';
import { z, zId, zReason } from '../../lib/validation';
import { acteursCallable, adminActor, auditRestaurant, loadRestaurantFor, restaurantDoc } from './common';

const startSchema = z.object({
  restaurantId: zId,
  reason: zReason,
  durationMinutes: z.number().int().min(5).max(120).default(30),
});

export const startImpersonation = acteursCallable(startSchema, async (data, request) => {
  const { caller, admin } = await requireAdmin(request, 'restaurants.impersonate');
  const restaurant = await loadRestaurantFor(admin, data.restaurantId);
  const now = Timestamp.now();

  // Une seule session ouverte par administrateur : les précédentes sont refermées.
  const open = await db
    .collection(COLLECTIONS.impersonationSessions)
    .where('adminId', '==', caller.uid)
    .where('endedAt', '==', null)
    .get();
  const ref = db.collection(COLLECTIONS.impersonationSessions).doc();
  const session: ImpersonationSession = {
    adminId: caller.uid,
    restaurantId: restaurant.id,
    mode: 'read_only',
    reason: data.reason,
    startedAt: now,
    expiresAt: Timestamp.fromMillis(now.toMillis() + data.durationMinutes * 60_000),
    endedAt: null,
    actionsCount: 0,
    adminName: admin.displayName || caller.name,
    restaurantName: restaurant.data.name,
    cityId: restaurant.data.cityId,
    endedBy: null,
  };
  const batch = db.batch();
  open.docs.forEach((d) => batch.update(d.ref, { endedAt: now, endedBy: caller.uid }));
  batch.set(ref, session);
  await batch.commit();

  await auditRestaurant(caller, restaurant, 'restaurant.impersonation_started', {
    reason: data.reason,
    after: { sessionId: ref.id, mode: 'read_only', durationMinutes: data.durationMinutes },
    sensitive: true,
    request,
  });
  return { sessionId: ref.id, expiresAt: session.expiresAt.toMillis() };
});

export const endImpersonation = acteursCallable(z.object({ sessionId: zId }), async (data, request) => {
  const { caller, admin } = await requireAdmin(request);
  const ref = db.collection(COLLECTIONS.impersonationSessions).doc(data.sessionId);
  const snap = await ref.get();
  if (!snap.exists) throw fail.notFound('Session');
  const session = snap.data() as ImpersonationSession;
  if (session.adminId !== caller.uid && !adminHasPermission(admin, 'audit.view')) throw fail.forbidden();
  if (session.endedAt) return { alreadyEnded: true };
  const now = Timestamp.now();
  await ref.update({ endedAt: now, endedBy: caller.uid });
  const rSnap = await restaurantDoc(session.restaurantId).get();
  const minutes = Math.max(1, Math.round((now.toMillis() - session.startedAt.toMillis()) / 60_000));
  if (rSnap.exists) {
    await auditRestaurant(caller, { id: rSnap.id, data: rSnap.data() as Restaurant, ref: rSnap.ref }, 'restaurant.impersonation_ended', {
      after: { sessionId: ref.id, minutes, endedByOwner: session.adminId === caller.uid },
      request,
    });
  } else {
    await writeAudit({
      actor: adminActor(caller),
      action: 'restaurant.impersonation_ended',
      target: { type: 'restaurant', id: session.restaurantId, label: session.restaurantName ?? null },
      after: { sessionId: ref.id, minutes },
      request,
    });
  }
  return { alreadyEnded: false };
});
