// « Voir comme le restaurant » : session limitée dans le temps, en lecture seule,
// ouverte avec un motif et tracée au journal d'audit (ouverture et fin — manuelle ou
// automatique si l'administrateur ferme l'onglet sans cliquer sur « Terminer »).
import { COLLECTIONS, adminHasPermission, type ImpersonationSession, type Restaurant } from '@golink/shared';
import { logger } from 'firebase-functions/v2';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { db, Timestamp } from '../../lib/admin';
import { writeAudit } from '../../lib/audit';
import { fail } from '../../lib/errors';
import { requireAdmin } from '../../lib/permissions';
import { z, zId, zReason } from '../../lib/validation';
import { ACTEURS_SCHEDULE_RUNTIME, TIMEZONE, acteursCallable, adminActor, auditRestaurant, loadRestaurantFor, restaurantDoc } from './common';

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

/**
 * Referme les sessions « Voir comme » arrivées à expiration sans que l'administrateur n'ait
 * cliqué sur « Terminer » (onglet fermé, par exemple) : rien ne le faisait jusqu'ici, une
 * session restait ouverte (`endedAt: null`) indéfiniment au-delà de `expiresAt`.
 */
export async function runImpersonationExpiryCheck(): Promise<{ closed: number }> {
  const now = Timestamp.now();
  const snap = await db.collection(COLLECTIONS.impersonationSessions).where('endedAt', '==', null).where('expiresAt', '<=', now).get();
  let closed = 0;
  for (const doc of snap.docs) {
    const session = doc.data() as ImpersonationSession;
    await doc.ref.update({ endedAt: now, endedBy: 'system' });
    const minutes = Math.max(1, Math.round((now.toMillis() - session.startedAt.toMillis()) / 60_000));
    await writeAudit({
      actor: { uid: 'system', type: 'system', role: null, name: 'Ciyou Eats (automatique)' },
      action: 'restaurant.impersonation_ended',
      target: { type: 'restaurant', id: session.restaurantId, label: session.restaurantName ?? null },
      cityId: session.cityId ?? null,
      after: { sessionId: doc.id, minutes, auto: true },
      sensitive: true,
    });
    closed += 1;
  }
  return { closed };
}

export const closeExpiredImpersonations = onSchedule({ schedule: 'every 15 minutes', timeZone: TIMEZONE, ...ACTEURS_SCHEDULE_RUNTIME }, async () => {
  const report = await runImpersonationExpiryCheck();
  if (report.closed > 0) logger.info('Sessions « Voir comme » expirées refermées automatiquement', report);
});
