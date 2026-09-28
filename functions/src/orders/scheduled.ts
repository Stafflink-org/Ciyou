// Tâche planifiée (chaque minute) : annulation et remboursement automatiques des
// commandes non acceptées dans le délai, paiements non aboutis, transmission des
// commandes programmées au restaurant, demande de livreur avant la fin de préparation.
import { COLLECTIONS, type Order } from '@golink/shared';
import { logger } from 'firebase-functions/v2';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { db, Timestamp } from '../lib/admin';
import { STRIPE_SECRET_KEY } from '../lib/secrets';
import { cancelBySystem } from './cancel';
import { addEvent, loadDispatchRules, loadMarket, loadOrderRules, SYSTEM_EVENT_ACTOR } from './context';
import { closeExpiredAbsences } from './customer-absent';
import { dispatchOrder } from './dispatch';
import { expireItemProposals } from './item-unavailable';

/** Délai laissé au client pour finaliser un paiement avec authentification forte. */
const PAYMENT_ACTION_TIMEOUT_MINUTES = 20;
/** Nouvelle tentative de recherche de livreur quand personne n'était disponible. */
const DISPATCH_RETRY_MINUTES = 2;

async function expireUnaccepted(now: Timestamp): Promise<number> {
  const snap = await db.collection(COLLECTIONS.orders).where('status', '==', 'new').where('acceptDeadline', '<=', now).limit(50).get();
  for (const doc of snap.docs) {
    await cancelBySystem(doc.id, 'restaurant_timeout', 'Commande non acceptée dans le délai : client remboursé automatiquement.').catch((error: unknown) =>
      logger.error('Annulation automatique en échec', { orderId: doc.id, error: error instanceof Error ? error.message : String(error) }),
    );
  }
  return snap.size;
}

async function expireUnpaid(now: Timestamp): Promise<number> {
  const snap = await db.collection(COLLECTIONS.orders).where('status', '==', 'new').where('payment.status', '==', 'requires_action').limit(50).get();
  let count = 0;
  for (const doc of snap.docs) {
    const order = doc.data() as Order;
    if (now.toMillis() - order.createdAt.toMillis() < PAYMENT_ACTION_TIMEOUT_MINUTES * 60_000) continue;
    count += 1;
    await cancelBySystem(doc.id, 'payment_failed', 'Paiement non finalisé par le client.').catch(() => undefined);
  }
  return count;
}

/** Commandes programmées : transmises au restaurant au moment de lancer la préparation. */
async function releaseScheduled(now: Timestamp): Promise<number> {
  const horizon = Timestamp.fromMillis(now.toMillis() + 90 * 60_000);
  const snap = await db.collection(COLLECTIONS.orders).where('status', '==', 'scheduled').where('scheduledFor', '<=', horizon).limit(50).get();
  let count = 0;
  for (const doc of snap.docs) {
    const order = doc.data() as Order;
    const travel = order.delivery ? Math.round(order.delivery.distanceMeters / 250) + 5 : 0;
    const startAt = (order.scheduledFor?.toMillis() ?? 0) - (order.prepMinutes + travel + 10) * 60_000;
    if (startAt > now.toMillis()) continue;
    const rules = await loadOrderRules(await loadMarket(order.countryId, order.cityId));
    await db.runTransaction(async (tx) => {
      const current = (await tx.get(doc.ref)).data() as Order;
      if (current.status !== 'scheduled') return;
      const at = Timestamp.now();
      tx.update(doc.ref, {
        status: 'new',
        'timeline.new': at,
        acceptDeadline: Timestamp.fromMillis(at.toMillis() + rules.acceptanceTimeoutSeconds * 1000),
        updatedAt: at,
      });
      addEvent(tx, doc.id, SYSTEM_EVENT_ACTOR, { type: 'status_changed', from: 'scheduled', to: 'new', visibleToCustomer: true, message: 'Commande programmée transmise au restaurant.', data: null }, at);
    });
    count += 1;
  }
  return count;
}

/** Demande automatique d'un livreur GoLink quand la fin de préparation approche. */
async function autoDispatch(now: Timestamp): Promise<number> {
  const snap = await db
    .collection(COLLECTIONS.orders)
    .where('fulfillment', '==', 'delivery')
    .where('driverId', '==', null)
    .where('status', 'in', ['preparing', 'ready'])
    .limit(50)
    .get();
  let count = 0;
  const rulesByCity = new Map<string, number>();
  for (const doc of snap.docs) {
    const order = doc.data() as Order;
    if (order.delivery?.deliveredBy !== 'platform') continue;
    const cityKey = `${order.countryId}/${order.cityId ?? ''}`;
    if (!rulesByCity.has(cityKey)) rulesByCity.set(cityKey, (await loadDispatchRules(await loadMarket(order.countryId, order.cityId))).dispatchLeadMinutes);
    const lead = rulesByCity.get(cityKey) ?? 8;
    const started = (order.timeline.preparing ?? order.timeline.accepted ?? order.createdAt).toMillis();
    const readyAt = started + (order.prepMinutes + order.prepExtendedMinutes) * 60_000;
    const due = order.status === 'ready' || readyAt - now.toMillis() <= lead * 60_000;
    // Après un échec (ou une recherche interrompue), nouvelle tentative toutes les deux minutes.
    const waiting = order.delivery.dispatchStatus === 'unavailable' || order.delivery.dispatchStatus === 'searching';
    const retry = !waiting || now.toMillis() - order.updatedAt.toMillis() >= DISPATCH_RETRY_MINUTES * 60_000;
    if (!due || !retry) continue;
    await dispatchOrder(doc.id).catch((error: unknown) => logger.warn('Dispatch automatique impossible', { orderId: doc.id, error: error instanceof Error ? error.message : String(error) }));
    count += 1;
  }
  return count;
}

export const enforceAcceptanceTimeout = onSchedule(
  { schedule: 'every 1 minutes', timeZone: 'Europe/Paris', secrets: [STRIPE_SECRET_KEY], timeoutSeconds: 120, retryCount: 0, maxInstances: 1, cpu: 'gcf_gen1' },
  async () => {
    const now = Timestamp.now();
    const [expired, unpaid, released, dispatched, absent, proposals] = [
      await expireUnaccepted(now),
      await expireUnpaid(now),
      await releaseScheduled(now),
      await autoDispatch(now),
      await closeExpiredAbsences(now).catch((error: unknown) => {
        logger.error('Clôtures « client absent » en échec', { error: error instanceof Error ? error.message : String(error) });
        return 0;
      }),
      await expireItemProposals(now).catch((error: unknown) => {
        logger.error('Retraits d’articles sans réponse en échec', { error: error instanceof Error ? error.message : String(error) });
        return 0;
      }),
    ];
    if (expired + unpaid + released + dispatched + absent + proposals > 0) {
      logger.info('Commandes : tâche planifiée', { expired, unpaid, released, dispatched, absent, proposals });
    }
  },
);
