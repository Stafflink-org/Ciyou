// Client absent (décision client n° 25) : le livreur arrive, attend (10 minutes par défaut,
// réglable par ville), appelle le client depuis l'application ; sans réponse la commande est
// clôturée « client absent » sans remboursement, livreur et commerce payés normalement.
//   - markDriverArrived  : le livreur signale son arrivée, l'attente démarre (minuteur serveur)
//   - logCustomerCall    : appel passé via l'application (traçabilité, exigé si `callViaApp`)
//   - closeCustomerAbsent: clôture par le livreur une fois l'attente écoulée
//   - closeExpiredAbsences : clôture automatique par la plateforme (tâche planifiée) si le livreur n'a pas clôturé
import { COLLECTIONS, customerAbsentOutcome, type CustomerAbsence, type Order, type OrderRules } from '@golink/shared';
import { logger } from 'firebase-functions/v2';
import { db, Timestamp } from '../lib/admin';
import { SYSTEM_ACTOR, writeAudit } from '../lib/audit';
import { fail } from '../lib/errors';
import { z, zId } from '../lib/validation';
import { issueAutoRefund } from './auto-refund';
import { cancelOrderInternal } from './cancel';
import { addEvent, loadMarket, loadOrder, loadOrderRules, orderRef, SYSTEM_EVENT_ACTOR, type EventActor } from './context';
import { readDriver, releaseDriverInTransaction } from './dispatch';
import { ordersCallable as callable } from './runtime';
import { courierActor } from './transitions';
import { STRIPE_SECRET_KEY } from '../lib/secrets';

const orderIdSchema = z.object({ orderId: zId });

function assertOnDelivery(order: Order): void {
  if (order.fulfillment !== 'delivery' || order.status !== 'picked_up') {
    throw fail.precondition('Cette commande n’est pas en cours de livraison chez le client.');
  }
}

/** Le livreur est arrivé : l'attente démarre, le client en est informé dans l'historique. */
export const markDriverArrived = callable(orderIdSchema, async (data, request) => {
  const order = await loadOrder(data.orderId);
  const actor = await courierActor(request, order);
  assertOnDelivery(order);
  const rules = await loadOrderRules(await loadMarket(order.countryId, order.cityId));
  const result = await db.runTransaction(async (tx) => {
    const current = (await tx.get(orderRef(data.orderId))).data() as Order;
    assertOnDelivery(current);
    if (current.customerAbsence) return current.customerAbsence;
    const at = Timestamp.now();
    const absence: CustomerAbsence = {
      arrivedAt: at,
      waitUntil: Timestamp.fromMillis(at.toMillis() + rules.customerAbsent.driverWaitMinutes * 60_000),
      waitMinutes: rules.customerAbsent.driverWaitMinutes,
      calls: 0,
      lastCallAt: null,
      closedAt: null,
      closedBy: null,
      payDriver: rules.customerAbsent.payDriver,
      payRestaurant: rules.customerAbsent.payRestaurant ?? true,
    };
    tx.update(orderRef(data.orderId), { customerAbsence: absence, updatedAt: at });
    addEvent(tx, data.orderId, actor, {
      type: 'driver_arrived',
      from: null,
      to: null,
      visibleToCustomer: true,
      message: `Le livreur est arrivé. Il attend ${rules.customerAbsent.driverWaitMinutes} minutes.`,
      data: { waitMinutes: rules.customerAbsent.driverWaitMinutes },
    }, at);
    return absence;
  });
  return { arrivedAt: result.arrivedAt.toMillis(), waitUntil: result.waitUntil.toMillis() };
});

/** Appel du client passé depuis l'application du livreur (numéro masqué). */
export const logCustomerCall = callable(orderIdSchema, async (data, request) => {
  const order = await loadOrder(data.orderId);
  const actor = await courierActor(request, order);
  assertOnDelivery(order);
  if (!order.customerAbsence) throw fail.precondition('Signalez d’abord votre arrivée chez le client.');
  const calls = await db.runTransaction(async (tx) => {
    const current = (await tx.get(orderRef(data.orderId))).data() as Order;
    if (!current.customerAbsence || current.customerAbsence.closedAt) throw fail.precondition('L’attente est terminée.');
    const at = Timestamp.now();
    const count = current.customerAbsence.calls + 1;
    tx.update(orderRef(data.orderId), { 'customerAbsence.calls': count, 'customerAbsence.lastCallAt': at, updatedAt: at });
    addEvent(tx, data.orderId, actor, { type: 'customer_called', from: null, to: null, visibleToCustomer: false, message: `Client appelé via l’application (appel n° ${count}).`, data: { call: count } }, at);
    return count;
  });
  return { calls };
});

interface CloseOptions {
  orderId: string;
  actor: EventActor;
  closedBy: 'driver' | 'system';
  rules: OrderRules;
}

/** Clôture « client absent » : sans remboursement (sauf réglage contraire), livreur et commerce payés. */
async function closeAbsent({ orderId, actor, closedBy, rules }: CloseOptions): Promise<{ closed: boolean; refundedCents: number }> {
  const order = await loadOrder(orderId);
  assertOnDelivery(order);
  const absence = order.customerAbsence;
  if (!absence) throw fail.precondition('Le livreur n’a pas encore signalé son arrivée.');
  if (absence.closedAt) return { closed: false, refundedCents: 0 };
  if (Date.now() < absence.waitUntil.toMillis()) {
    const minutes = Math.ceil((absence.waitUntil.toMillis() - Date.now()) / 60_000);
    throw fail.precondition(`Patientez encore ${minutes} minute${minutes > 1 ? 's' : ''} avant de clôturer la commande.`);
  }
  if (closedBy === 'driver' && rules.customerAbsent.callViaApp !== false && absence.calls < 1) {
    throw fail.precondition('Appelez le client depuis l’application avant de clôturer la commande.');
  }

  // Espèces : rien n'a été encaissé, la commande est annulée (pas de règlement à honorer).
  if (order.payment.method === 'cash') {
    await cancelOrderInternal({ orderId, actor: SYSTEM_EVENT_ACTOR, reason: 'customer_absent', details: 'Client absent : paiement en espèces non encaissé.', restock: false });
    return { closed: true, refundedCents: 0 };
  }

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(orderRef(orderId));
    const current = snap.data() as Order;
    if (current.status !== 'picked_up' || current.customerAbsence?.closedAt) throw fail.precondition('Cette commande a déjà changé d’étape.');
    const driverState = current.driverId ? await readDriver(tx, current.driverId) : null;
    const at = Timestamp.now();
    const outcome = customerAbsentOutcome();
    tx.update(snap.ref, {
      status: 'delivered',
      closedAs: 'customer_absent',
      'timeline.delivered': at,
      'customerAbsence.closedAt': at,
      'customerAbsence.closedBy': closedBy,
      'flags.late': false,
      'flags.lateMinutes': 0,
      updatedAt: at,
    });
    addEvent(tx, orderId, actor, {
      type: 'customer_absent',
      from: 'picked_up',
      to: 'delivered',
      visibleToCustomer: true,
      message: `Client absent après ${rules.customerAbsent.driverWaitMinutes} minutes d’attente : commande clôturée${rules.customerAbsent.refundCustomer ? '' : ' sans remboursement'}.`,
      data: { calls: current.customerAbsence?.calls ?? 0, refundCustomer: rules.customerAbsent.refundCustomer, payDriver: rules.customerAbsent.payDriver, payRestaurant: rules.customerAbsent.payRestaurant ?? outcome.payRestaurant },
    }, at);
    if (current.driverId && driverState) releaseDriverInTransaction(tx, current.driverId, orderId, driverState.driver, driverState.location);
  });

  // Réglage contraire (super admin) : le client est remboursé (hors pourboire), l'imputation suit les règles.
  let refundedCents = 0;
  if (rules.customerAbsent.refundCustomer) {
    const refund = await issueAutoRefund({
      orderId,
      key: 'absent',
      amountCents: order.amounts.chargedCents - order.amounts.tipCents,
      cause: 'customer_absent',
      reason: 'Client absent : remboursement prévu par les règles de la ville',
      actor,
    });
    refundedCents = refund.amountCents;
  }
  await writeAudit({
    actor: actor.type === 'system' ? SYSTEM_ACTOR : { uid: actor.uid ?? 'driver', type: 'driver', role: null, name: actor.name ?? 'Livreur' },
    action: 'order.customer_absent_closed',
    target: { type: 'order', id: orderId, label: `${order.number} · ${order.restaurantName}` },
    reason: `Client absent après ${rules.customerAbsent.driverWaitMinutes} min d’attente, ${absence.calls} appel(s) : clôture ${closedBy === 'system' ? 'automatique' : 'par le livreur'}`,
    before: { status: order.status },
    after: { status: 'delivered', closedAs: 'customer_absent', refundedCents },
    countryId: order.countryId,
    cityId: order.cityId ?? null,
  });
  return { closed: true, refundedCents };
}

/** Clôture par le livreur après l'attente (et l'appel du client si le réglage l'exige). */
export const closeCustomerAbsent = callable(
  orderIdSchema,
  async (data, request) => {
    const order = await loadOrder(data.orderId);
    const actor = await courierActor(request, order);
    const rules = await loadOrderRules(await loadMarket(order.countryId, order.cityId));
    const result = await closeAbsent({ orderId: data.orderId, actor, closedBy: 'driver', rules });
    return { status: 'delivered' as const, closedAs: 'customer_absent' as const, refundedCents: result.refundedCents };
  },
  { secrets: [STRIPE_SECRET_KEY] },
);

/** Tâche planifiée : clôture les attentes que le livreur n'a pas clôturées (délai de grâce réglable, 0 = jamais). */
export async function closeExpiredAbsences(now: Timestamp): Promise<number> {
  const snap = await db.collection(COLLECTIONS.orders).where('status', '==', 'picked_up').where('customerAbsence.waitUntil', '<=', now).limit(50).get();
  let count = 0;
  for (const doc of snap.docs) {
    const order = doc.data() as Order;
    if (!order.customerAbsence || order.customerAbsence.closedAt) continue;
    const rules = await loadOrderRules(await loadMarket(order.countryId, order.cityId));
    const grace = rules.customerAbsent.autoCloseGraceMinutes ?? 10;
    if (grace <= 0 || now.toMillis() < order.customerAbsence.waitUntil.toMillis() + grace * 60_000) continue;
    try {
      await closeAbsent({ orderId: doc.id, actor: SYSTEM_EVENT_ACTOR, closedBy: 'system', rules });
      count += 1;
    } catch (error) {
      logger.warn('Clôture automatique « client absent » impossible', { orderId: doc.id, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return count;
}
