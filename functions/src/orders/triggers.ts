// Trigger des commandes : agrégats du jour du restaurant (recalculés à partir
// des commandes du jour, donc idempotents) et compteurs de ventes (appliqués une
// seule fois grâce au marqueur `processed.salesCounted`).
import {
  COLLECTIONS,
  SUBCOLLECTIONS,
  toIsoDay,
  type FulfillmentMode,
  type Order,
  type PaymentMethod,
  type Restaurant,
  type RestaurantDailyStats,
} from '@golink/shared';
import { logger } from 'firebase-functions/v2';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { db, FieldValue, Timestamp } from '../lib/admin';
import { SYSTEM_ACTOR, writeAudit } from '../lib/audit';
import { EMAIL_SECRETS } from '../lib/secrets';
import { earnLoyaltyPoints } from '../marketing/platform/loyalty';
import { notifyOrderChange, restaurantStaffTargets } from '../notifications/order-messages';
import { sendPlatformMessage } from '../notifications/messages';
import { applyCancellationEffects } from './cancel-effects';
import { applyLateCredit } from './late-credit';
import { dayBounds, loadMarket, loadOrderRules, localClock, minutesBetween } from './context';
import { ORDERS_RUNTIME } from './runtime';

const TIMEZONE = 'Europe/Paris';
const REJECTION_REASONS = new Set(['restaurant_rejected', 'restaurant_timeout', 'restaurant_closed', 'item_unavailable']);

/** Champs dont la modification change les agrégats. */
function statsChanged(before: Order | undefined, after: Order | undefined): boolean {
  if (!before || !after) return true;
  return before.status !== after.status || before.amounts.refundedCents !== after.amounts.refundedCents || before.flags.late !== after.flags.late;
}

async function recomputeDailyStats(restaurantId: string, day: string): Promise<void> {
  const { start, end } = dayBounds(day, TIMEZONE);
  const snap = await db
    .collection(COLLECTIONS.orders)
    .where('restaurantId', '==', restaurantId)
    .where('createdAt', '>=', Timestamp.fromDate(start))
    .where('createdAt', '<', Timestamp.fromDate(end))
    .orderBy('createdAt', 'desc')
    .get();
  const orders = snap.docs.map((d) => d.data() as Order).filter((o) => o.status !== 'scheduled');
  const delivered = orders.filter((o) => o.status === 'delivered');
  const cancelled = orders.filter((o) => o.status === 'cancelled');
  const byMode: Partial<Record<FulfillmentMode, number>> = {};
  const byPayment: Partial<Record<PaymentMethod, number>> = {};
  const byHour = Array.from({ length: 24 }, () => 0);
  for (const o of orders) {
    byMode[o.fulfillment] = (byMode[o.fulfillment] ?? 0) + 1;
    const hour = Math.floor(localClock(o.createdAt.toDate(), TIMEZONE).minutes / 60);
    byHour[hour] = (byHour[hour] ?? 0) + 1;
  }
  let prepTotal = 0;
  let prepCount = 0;
  for (const o of delivered) {
    byPayment[o.payment.method] = (byPayment[o.payment.method] ?? 0) + o.amounts.totalCents;
    const prep = minutesBetween(o.timeline.accepted ?? o.timeline.preparing, o.timeline.ready ?? o.timeline.assigned ?? o.timeline.picked_up);
    if (prep !== null && prep > 0 && prep < 240) {
      prepTotal += prep;
      prepCount += 1;
    }
  }
  const sum = (list: Order[], pick: (o: Order) => number) => list.reduce((s, o) => s + pick(o), 0);
  const salesCents = sum(delivered, (o) => o.amounts.subtotalCents);
  const stats: RestaurantDailyStats = {
    day,
    ordersCount: orders.length,
    deliveredCount: delivered.length,
    cancelledCount: cancelled.length,
    rejectedCount: cancelled.filter((o) => o.cancellation && REJECTION_REASONS.has(o.cancellation.reason)).length,
    lateCount: delivered.filter((o) => o.flags.late).length,
    salesCents,
    netPayoutCents: sum(delivered, (o) => o.restaurantSettlement?.payoutCents ?? 0) - sum(cancelled, (o) => o.cancellation?.restaurantChargeCents ?? 0),
    commissionCents: sum(delivered, (o) => o.restaurantSettlement?.commissionHtCents ?? 0),
    discountFundedCents: sum(delivered, (o) => o.restaurantSettlement?.discountFundedCents ?? 0),
    averageBasketCents: delivered.length ? Math.round(salesCents / delivered.length) : 0,
    averagePrepMinutes: prepCount ? Math.round(prepTotal / prepCount) : 0,
    byMode,
    byPayment,
    byHour,
    newCustomers: delivered.filter((o) => o.flags.firstOrder).length,
    updatedAt: Timestamp.now(),
  };
  await db
    .collection(COLLECTIONS.restaurants)
    .doc(restaurantId)
    .collection(SUBCOLLECTIONS.restaurants.dailyStats)
    .doc(day.replace(/-/g, ''))
    .set(stats);
}

/** Ventes par produit et compteur de commandes du restaurant, une seule fois par commande livrée. */
async function countSales(orderId: string): Promise<void> {
  await db.runTransaction(async (tx) => {
    const ref = db.collection(COLLECTIONS.orders).doc(orderId);
    const order = (await tx.get(ref)).data() as Order | undefined;
    if (!order || order.status !== 'delivered' || order.processed?.salesCounted) return;
    const restaurantRef = db.collection(COLLECTIONS.restaurants).doc(order.restaurantId);
    const quantities = new Map<string, number>();
    for (const item of order.items) quantities.set(item.productId, (quantities.get(item.productId) ?? 0) + item.quantity);
    const productRefs = [...quantities.keys()].map((id) => restaurantRef.collection(SUBCOLLECTIONS.restaurants.products).doc(id));
    const products = productRefs.length ? await tx.getAll(...productRefs) : [];
    for (const product of products) {
      if (product.exists) tx.update(product.ref, { salesCount: FieldValue.increment(quantities.get(product.id) ?? 0) });
    }
    tx.update(restaurantRef, { ordersCount: FieldValue.increment(1) });
    // Agrégats client : posés une seule fois par commande (même marqueur), pour
    // que `flags.firstOrder` (posé à la création selon ce compteur) reflète bien
    // le vrai historique du client aux commandes suivantes.
    const userRef = db.collection(COLLECTIONS.users).doc(order.customerId);
    tx.update(userRef, {
      'stats.ordersCount': FieldValue.increment(1),
      'stats.totalSpentCents': FieldValue.increment(order.amounts.totalCents),
      'stats.lastOrderAt': Timestamp.now(),
      ...(order.flags.firstOrder ? { 'stats.firstOrderAt': Timestamp.now() } : {}),
    });
    tx.update(ref, { 'processed.salesCounted': true });
  });
}

/**
 * Commande non acceptée dans le délai : compteur de commandes manquées d'affilée
 * (une seule fois par commande, marqueur `processed.missCounted`) et pause
 * automatique du commerce au-delà du seuil paramétré (décision client).
 */
async function countMissedOrder(orderId: string): Promise<void> {
  const order = (await db.collection(COLLECTIONS.orders).doc(orderId).get()).data() as Order | undefined;
  if (!order) return;
  const rules = await loadOrderRules(await loadMarket(order.countryId, order.cityId));
  const threshold = rules.autoPause?.enabled ? rules.autoPause.missedOrdersInARow : 0;
  const paused = await db.runTransaction(async (tx) => {
    const ref = db.collection(COLLECTIONS.orders).doc(orderId);
    const current = (await tx.get(ref)).data() as Order | undefined;
    if (!current || current.processed?.missCounted) return null;
    const restaurantRef = db.collection(COLLECTIONS.restaurants).doc(current.restaurantId);
    const restaurant = (await tx.get(restaurantRef)).data() as Restaurant | undefined;
    tx.update(ref, { 'processed.missCounted': true });
    if (!restaurant) return null;
    const missed = (restaurant.missedOrdersInARow ?? 0) + 1;
    const pause = threshold > 0 && missed >= threshold && restaurant.isOpen;
    const at = Timestamp.now();
    tx.update(restaurantRef, {
      missedOrdersInARow: missed,
      ...(pause
        ? {
            isOpen: false,
            pausedUntil: null,
            pauseReason: `Pause automatique : ${missed} commandes non acceptées d’affilée. Rouvrez les commandes quand l’équipe est prête.`,
            autoPausedAt: at,
            updatedAt: at,
          }
        : {}),
    });
    return pause ? { restaurantId: current.restaurantId, name: restaurant.name, missed, countryId: restaurant.countryId, cityId: restaurant.cityId } : null;
  });
  if (paused) {
    await writeAudit({
      actor: SYSTEM_ACTOR,
      action: 'restaurant.auto_paused',
      target: { type: 'restaurant', id: paused.restaurantId, label: paused.name },
      reason: `${paused.missed} commandes non acceptées d’affilée`,
      after: { isOpen: false, missedOrdersInARow: paused.missed },
      countryId: paused.countryId,
      cityId: paused.cityId,
    });
    // Message automatique « pause automatique » (gabarit modifiable) à l'équipe du commerce.
    const demo = Boolean((await db.collection(COLLECTIONS.restaurants).doc(paused.restaurantId).get()).get('seed')) || order.test === true;
    const targets = await restaurantStaffTargets(paused.restaurantId, demo);
    await Promise.all(
      targets.map((t) => sendPlatformMessage('restaurant_auto_paused', t, { restaurantName: paused.name, count: paused.missed }, { dedupeKey: `${paused.restaurantId}-${paused.missed}-${orderId}` })),
    );
  }
}

/** Première commande acceptée : le compteur de commandes manquées repart à zéro. */
async function resetMissedOrders(restaurantId: string): Promise<void> {
  const ref = db.collection(COLLECTIONS.restaurants).doc(restaurantId);
  const snap = await ref.get();
  if (!((snap.get('missedOrdersInARow') as number | undefined) ?? 0)) return;
  const reason = snap.get('pauseReason') as string | null | undefined;
  await ref.update({ missedOrdersInARow: 0, ...(reason?.startsWith('Pause automatique') ? { pauseReason: null } : {}) });
}

export const onOrderWritten = onDocumentWritten({ document: 'orders/{orderId}', retry: false, secrets: EMAIL_SECRETS, ...ORDERS_RUNTIME }, async (event) => {
  const before = event.data?.before.data() as Order | undefined;
  const after = event.data?.after.data() as Order | undefined;
  const order = after ?? before;
  if (!order) return;
  try {
    if (statsChanged(before, after)) {
      await recomputeDailyStats(order.restaurantId, toIsoDay(order.createdAt.toDate()));
    }
    if (after?.status === 'delivered' && !after.processed?.salesCounted) {
      await countSales(event.params.orderId);
    }
    if (after?.status === 'cancelled' && before?.status !== 'cancelled' && after.cancellation?.reason === 'restaurant_timeout') {
      await countMissedOrder(event.params.orderId);
    }
    if (before?.status === 'new' && after && (after.status === 'preparing' || after.status === 'accepted')) {
      await resetMissedOrders(after.restaurantId);
    }
  } catch (error) {
    logger.error('Agrégats de commande en échec', { orderId: event.params.orderId, error: error instanceof Error ? error.stack : String(error) });
    throw error;
  }
  // Automatismes indépendants : l'échec de l'un n'empêche pas les autres.
  await safely('messages', event.params.orderId, () => notifyOrderChange(event.params.orderId, before, after));
  if (after?.status === 'delivered' && before?.status !== 'delivered' && !after.processed?.lateCreditDone) {
    await safely('lateCredit', event.params.orderId, () => applyLateCredit(event.params.orderId));
  }
  // Fidélité : points de gain et de bienvenue (programme éteint par défaut).
  if (after?.status === 'delivered' && before?.status !== 'delivered') {
    await safely('loyalty', event.params.orderId, () => earnLoyaltyPoints(event.params.orderId, after));
  }
  // Commande annulée : l'offre utilisée est libérée et les avoirs Ciyou Eats sont rendus au client.
  if (after?.status === 'cancelled' && before?.status !== 'cancelled') {
    await safely('cancelEffects', event.params.orderId, () => applyCancellationEffects(event.params.orderId, after));
    // §7 « Indicateurs de risque » (fiche client) : `stats.cancelledCount` était initialisé à 0 à
    // la création du compte mais jamais incrémenté ensuite — le signal « annulations fréquentes »
    // ne pouvait donc jamais se déclencher. Le statut `cancelled` est terminal (une commande ne
    // repasse jamais par un autre statut après), le garde `before?.status !== 'cancelled'` suffit
    // à éviter un double comptage en cas de rejeu de l'évènement.
    if (after.customerId) {
      await safely('customerCancelledCount', event.params.orderId, () =>
        db.collection(COLLECTIONS.users).doc(after.customerId).update({ 'stats.cancelledCount': FieldValue.increment(1) }),
      );
    }
  }
});

async function safely(step: string, orderId: string, run: () => Promise<unknown>): Promise<void> {
  try {
    await run();
  } catch (error) {
    logger.error('Automatisme de commande en échec', { step, orderId, error: error instanceof Error ? error.stack : String(error) });
  }
}
