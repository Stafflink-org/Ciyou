// Attribution des courses côté exploitation : intervention du super admin
// (relance, livreur imposé, réattribution), aperçu des candidats, réponse du
// livreur à une proposition et avancement des propositions expirées.
import { COLLECTIONS, type AdminDispatchOrderResult, type DispatchCandidate, type DispatchOffer, type DispatchRules, type Driver, type Order } from '@golink/shared';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions/v2';
import { db, Timestamp } from '../../lib/admin';
import { actorFromCaller, writeAudit } from '../../lib/audit';
import { fail } from '../../lib/errors';
import { assertAdminCovers, requireAdmin, requireAuth } from '../../lib/permissions';
import { z, zId, zReason } from '../../lib/validation';
import { addEvent, orderRef, orderViewerUids, type EventActor } from '../../orders/context';
import { readDriver, releaseDriverInTransaction } from '../../orders/dispatch';
import { advancedDispatchOrder, assignDriverInTransaction, DISPATCHABLE, previewCandidates } from '../../orders/dispatch-advanced';
import { opsCallable, OPS_SCHEDULE_RUNTIME, TIMEZONE } from './common';

async function loadOrderFor(orderId: string, admin: Parameters<typeof assertAdminCovers>[0]): Promise<Order> {
  const snap = await orderRef(orderId).get();
  if (!snap.exists) throw fail.notFound('Commande');
  const order = snap.data() as Order;
  assertAdminCovers(admin, order.cityId);
  return order;
}

/** Intervention du super admin sur l'attribution d'une commande (auditée). */
export const dispatchOrder = opsCallable(
  z.object({ orderId: zId, driverId: zId.nullish(), unassign: z.boolean().optional(), reason: zReason }),
  async (data, request): Promise<AdminDispatchOrderResult> => {
    const { caller, admin } = await requireAdmin(request, 'orders.intervene');
    const order = await loadOrderFor(data.orderId, admin);
    if (order.fulfillment !== 'delivery' || order.delivery?.deliveredBy !== 'platform') throw fail.precondition('Cette commande n’est pas livrée par la flotte GoLink.');
    const actor: EventActor = { type: 'admin', uid: caller.uid, name: 'Support GoLink' };
    const previousDriver = order.driverId ?? null;

    if (data.unassign || (data.driverId && order.driverId && order.driverId !== data.driverId)) {
      if (!order.driverId) throw fail.precondition('Aucun livreur n’est attribué à cette commande.');
      if (!['accepted', 'preparing', 'ready', 'assigned'].includes(order.status)) throw fail.precondition('La commande a déjà été récupérée : elle ne peut plus changer de livreur.');
      const driverId = order.driverId;
      await db.runTransaction(async (tx) => {
        const state = await readDriver(tx, driverId);
        const fresh = (await tx.get(orderRef(data.orderId))).data() as Order;
        if (fresh.driverId !== driverId) throw fail.precondition('Le livreur de la commande a changé entre-temps.');
        const at = Timestamp.now();
        releaseDriverInTransaction(tx, driverId, data.orderId, state.driver, state.location);
        tx.update(orderRef(data.orderId), {
          driverId: null,
          'delivery.driverId': null,
          'delivery.driverName': null,
          'delivery.driverPhoneMasked': null,
          'delivery.driverVehicle': null,
          'delivery.dispatchStatus': null,
          'delivery.dispatchRound': 0,
          'delivery.dispatchOfferId': null,
          ...(fresh.status === 'assigned' ? { status: 'ready' } : {}),
          updatedAt: at,
        });
        addEvent(tx, data.orderId, actor, {
          type: 'driver_unassigned',
          from: fresh.status === 'assigned' ? 'assigned' : null,
          to: fresh.status === 'assigned' ? 'ready' : null,
          visibleToCustomer: false,
          message: `Livreur retiré par le support : ${data.reason}`,
          data: { driverId },
        }, at);
      });
    }

    let result: AdminDispatchOrderResult;
    if (data.driverId) {
      const driverSnap = await db.collection(COLLECTIONS.drivers).doc(data.driverId).get();
      const driver = driverSnap.data() as Driver | undefined;
      if (!driver) throw fail.notFound('Livreur');
      if (driver.cityId !== order.cityId) throw fail.precondition('Ce livreur n’opère pas dans la ville de la commande.');
      if (driver.type !== 'platform') throw fail.precondition('Seuls les livreurs GoLink peuvent être imposés.');
      const viewers = await orderViewerUids(order.restaurantId);
      const assigned = await db.runTransaction((tx) =>
        assignDriverInTransaction(tx, { orderId: data.orderId, driverId: data.driverId!, actor, viewers, distanceMeters: null, round: order.delivery?.dispatchRound ?? 1, allowBusy: true }),
      );
      if (!assigned.assigned) throw fail.precondition('Un livreur est déjà attribué à cette commande.');
      const alert = db.collection(COLLECTIONS.platformAlerts).doc(`dispatch_failed_${data.orderId}`);
      if ((await alert.get()).exists) await alert.update({ status: 'resolved', resolvedAt: Timestamp.now() });
      result = { assigned: true, driverName: assigned.driverName, distanceMeters: null, offered: false, round: order.delivery?.dispatchRound ?? 1 };
    } else {
      result = await advancedDispatchOrder(data.orderId, actor);
    }

    await writeAudit({
      actor: actorFromCaller(caller, 'admin'),
      action: data.driverId ? 'order.driver_forced' : data.unassign ? 'order.driver_reassigned' : 'order.dispatch_relaunched',
      target: { type: 'order', id: data.orderId, label: order.number },
      reason: data.reason,
      before: { driverId: previousDriver, dispatchStatus: order.delivery?.dispatchStatus ?? null },
      after: { driverId: data.driverId ?? null, assigned: result.assigned, offered: result.offered, round: result.round },
      countryId: order.countryId,
      cityId: order.cityId,
      request,
    });
    return result;
  },
);

/** Candidats évalués par le moteur pour une commande (sans rien attribuer). */
export const previewDispatch = opsCallable(
  z.object({ orderId: zId }),
  async (data, request): Promise<{ rules: DispatchRules; candidates: DispatchCandidate[] }> => {
    const { admin } = await requireAdmin(request, 'orders.view');
    const order = await loadOrderFor(data.orderId, admin);
    if (order.fulfillment !== 'delivery' || order.delivery?.deliveredBy !== 'platform') throw fail.precondition('Cette commande n’est pas livrée par la flotte GoLink.');
    return previewCandidates(data.orderId);
  },
);

/** Réponse du livreur à une proposition de course (application livreur). */
export const respondToOffer = opsCallable(
  z.object({ offerId: zId, accept: z.boolean(), reason: z.string().trim().max(200).nullish() }),
  async (data, request): Promise<{ status: DispatchOffer['status'] }> => {
    const caller = requireAuth(request);
    const offerRef = db.collection(COLLECTIONS.dispatchOffers).doc(data.offerId);
    const offerSnap = await offerRef.get();
    if (!offerSnap.exists) throw fail.notFound('Proposition');
    const offer = offerSnap.data() as DispatchOffer;
    if (offer.driverId !== caller.uid) throw fail.forbidden();
    if (offer.status !== 'offered') throw fail.precondition('Cette proposition n’est plus disponible.');
    if (offer.expiresAt.toMillis() < Date.now()) throw fail.precondition('Le délai pour accepter cette course est dépassé.');
    const actor: EventActor = { type: 'driver', uid: caller.uid, name: caller.name };

    if (!data.accept) {
      await db.runTransaction(async (tx) => {
        const fresh = (await tx.get(offerRef)).data() as DispatchOffer;
        if (fresh.status !== 'offered') throw fail.precondition('Cette proposition n’est plus disponible.');
        tx.update(offerRef, { status: 'declined', respondedAt: Timestamp.now(), declineReason: data.reason ?? null });
        tx.update(orderRef(offer.orderId), { 'delivery.dispatchOfferId': null, updatedAt: Timestamp.now() });
      });
      await writeAudit({
        actor: actorFromCaller(caller, 'driver'),
        action: 'dispatch.offer_declined',
        target: { type: 'order', id: offer.orderId, label: offer.orderId },
        reason: data.reason ?? null,
        after: { offerId: data.offerId, round: offer.round },
        request,
      });
      await advancedDispatchOrder(offer.orderId).catch((error: unknown) => logger.warn('Relance après refus impossible', { orderId: offer.orderId, error: String(error) }));
      return { status: 'declined' };
    }
    const order = (await orderRef(offer.orderId).get()).data() as Order;
    const viewers = await orderViewerUids(order.restaurantId);
    const result = await db.runTransaction(async (tx) => {
      const fresh = (await tx.get(offerRef)).data() as DispatchOffer;
      if (fresh.status !== 'offered' || fresh.expiresAt.toMillis() < Date.now()) throw fail.precondition('Cette proposition n’est plus disponible.');
      return assignDriverInTransaction(tx, {
        orderId: offer.orderId,
        driverId: caller.uid,
        actor,
        viewers,
        distanceMeters: offer.distanceToRestaurantMeters,
        offerRef,
        round: offer.round,
        allowBusy: true,
      });
    });
    if (!result.assigned) throw fail.precondition('Cette course a déjà été attribuée.');
    await writeAudit({
      actor: actorFromCaller(caller, 'driver'),
      action: 'dispatch.offer_accepted',
      target: { type: 'order', id: offer.orderId, label: offer.orderId },
      after: { offerId: data.offerId, round: offer.round, distanceMeters: offer.distanceToRestaurantMeters },
      request,
    });
    const alert = db.collection(COLLECTIONS.platformAlerts).doc(`dispatch_failed_${offer.orderId}`);
    if ((await alert.get()).exists) await alert.update({ status: 'resolved', resolvedAt: Timestamp.now() });
    return { status: 'accepted' };
  },
);

/** Propositions expirées : marquées comme telles, puis la course passe au livreur suivant. */
export const advanceDispatchOffers = onSchedule(
  { schedule: 'every 1 minutes', timeZone: TIMEZONE, ...OPS_SCHEDULE_RUNTIME },
  async () => {
    const now = Timestamp.now();
    const expired = await db.collection(COLLECTIONS.dispatchOffers).where('status', '==', 'offered').where('expiresAt', '<=', now).limit(100).get();
    let relaunched = 0;
    for (const doc of expired.docs) {
      const offer = doc.data() as DispatchOffer;
      const order = (await orderRef(offer.orderId).get()).data() as Order | undefined;
      const stillOpen = Boolean(order && !order.driverId && DISPATCHABLE.includes(order.status));
      await doc.ref.update({ status: stillOpen ? 'expired' : 'cancelled', respondedAt: now });
      if (!stillOpen) continue;
      await orderRef(offer.orderId).update({ 'delivery.dispatchOfferId': null });
      await advancedDispatchOrder(offer.orderId).catch((error: unknown) => logger.warn('Relance de l’attribution impossible', { orderId: offer.orderId, error: String(error) }));
      relaunched += 1;
    }
    if (expired.size > 0) logger.info('Propositions de course expirées', { expired: expired.size, relaunched });
  },
);
