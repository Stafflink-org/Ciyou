// Calcul pur des agrégats statsDaily (aucun accès à Firestore) : utilisé par les
// Cloud Functions et par le script de recalcul scripts/seed/only/a-pilotage.ts.
// Les agrégats d'une ville sont recalculés à partir des commandes du jour, donc
// rejouables sans doublon ; pays et plateforme sont la somme des villes.
import type { Cents, DailyStats, FulfillmentMode, Order, OrderFinancials } from '@golink/shared';

export const REJECTION_REASONS = new Set(['restaurant_rejected', 'restaurant_timeout', 'restaurant_closed', 'item_unavailable']);

type StatsBody = Omit<DailyStats, 'updatedAt'>;
type PlatformPart = OrderFinancials['settlement']['platform'];

/** Accumulateurs internes (moyennes pondérées) conservés dans le document. */
export interface StatsAccumulators {
  prepSum: number;
  prepCount: number;
  deliverySum: number;
  deliveryCount: number;
  distanceSum: number;
  distanceCount: number;
}

export type StatsDoc = StatsBody & { accumulators?: StatsAccumulators };

export function emptyStats(scope: DailyStats['scope'], scopeId: string, day: string, cityId: string | null, countryId: string | null): StatsDoc {
  return {
    scope,
    scopeId,
    cityId,
    countryId,
    day,
    orders: { placed: 0, delivered: 0, cancelled: 0, rejected: 0, late: 0, byMode: {}, byHour: Array.from({ length: 24 }, () => 0) },
    revenue: {
      gmvCents: 0,
      restaurantSalesCents: 0,
      commissionHtCents: 0,
      feesHtCents: 0,
      subscriptionsHtCents: 0,
      promoCostCents: 0,
      refundsCents: 0,
      courierCostCents: 0,
      paymentFeesCents: 0,
      marginCents: 0,
      averageBasketCents: 0,
    },
    delivery: { averageMinutes: 0, averagePrepMinutes: 0, onTimeRate: 0, averageDistanceMeters: 0 },
    actors: { restaurantsActive: 0, restaurantsNew: 0, customersNew: 0, customersActive: 0, driversNew: 0, driversOnlinePeak: 0 },
    funnel: { appOpens: 0, restaurantViews: 0, addToCart: 0, checkoutStarted: 0, paid: 0 },
    support: { ticketsOpened: 0, ticketsResolved: 0, averageResolutionMinutes: 0 },
    driversOnlineByHour: Array.from({ length: 24 }, () => 0),
    accumulators: { prepSum: 0, prepCount: 0, deliverySum: 0, deliveryCount: 0, distanceSum: 0, distanceCount: 0 },
  };
}

const ms = (value: { toMillis(): number } | null | undefined) => (value ? value.toMillis() : null);

function minutesBetween(from: { toMillis(): number } | null | undefined, to: { toMillis(): number } | null | undefined): number | null {
  const a = ms(from);
  const b = ms(to);
  if (a === null || b === null) return null;
  return (b - a) / 60_000;
}

/**
 * Agrégats d'une ville pour un jour, à partir des commandes créées ce jour-là
 * (heure de Paris via `hourOf`) et de leur répartition financière.
 * Les champs non dérivables des commandes (tunnel, support, abonnements,
 * nouveaux restaurants et livreurs, pic de livreurs en ligne) sont repris de `previous`.
 */
export function computeCityStats(input: {
  day: string;
  cityId: string;
  countryId: string | null;
  orders: Array<Order & { id: string }>;
  financials: Map<string, PlatformPart>;
  hourOf: (date: Date) => number;
  previous?: Partial<StatsDoc> | null;
}): StatsDoc {
  const { day, cityId, countryId, financials, hourOf, previous } = input;
  const stats = emptyStats('city', cityId, day, cityId, countryId);
  const orders = input.orders.filter((o) => o.status !== 'scheduled');
  const restaurants = new Set<string>();
  const customers = new Set<string>();
  const acc = stats.accumulators!;

  for (const order of orders) {
    stats.orders.placed += 1;
    restaurants.add(order.restaurantId);
    const hour = hourOf(order.createdAt.toDate());
    stats.orders.byHour[hour] = (stats.orders.byHour[hour] ?? 0) + 1;
    const mode = order.fulfillment as FulfillmentMode;
    stats.orders.byMode[mode] = (stats.orders.byMode[mode] ?? 0) + 1;
    stats.revenue.refundsCents += order.amounts.refundedCents ?? 0;
    // Tunnel de commande (§3) : les deux dernières étapes sont dérivables des commandes
    // elles-mêmes (les précédentes — ouverture de l'app, fiche du commerce, panier —
    // exigent une application cliente qui n'existe pas encore : voir docs/CONTRATS_APPS_MOBILES.md).
    stats.funnel.checkoutStarted += 1;
    if (order.payment.status === 'paid' || order.payment.status === 'authorized' || order.payment.status === 'partially_refunded' || order.payment.status === 'refunded') {
      stats.funnel.paid += 1;
    }

    if (order.status === 'cancelled') {
      stats.orders.cancelled += 1;
      if (order.cancellation && REJECTION_REASONS.has(order.cancellation.reason)) stats.orders.rejected += 1;
      continue;
    }
    if (order.status !== 'delivered') continue;

    stats.orders.delivered += 1;
    customers.add(order.customerId);
    if (order.flags?.late) stats.orders.late += 1;
    if (order.flags?.firstOrder) stats.actors.customersNew += 1;
    stats.revenue.gmvCents += order.amounts.totalCents;
    stats.revenue.restaurantSalesCents += order.amounts.subtotalCents;

    const platform = financials.get(orderKey(order));
    if (platform) {
      stats.revenue.commissionHtCents += platform.commissionHtCents;
      stats.revenue.feesHtCents += platform.serviceFeeHtCents + platform.smallOrderFeeHtCents + platform.deliveryFeeHtCents;
      stats.revenue.promoCostCents += platform.promoCostCents;
      stats.revenue.courierCostCents += platform.courierCostCents;
      stats.revenue.paymentFeesCents += platform.paymentCostCents;
      stats.revenue.marginCents += platform.marginCents;
    } else {
      stats.revenue.commissionHtCents += order.restaurantSettlement?.commissionHtCents ?? 0;
    }

    const prep = minutesBetween(order.timeline.accepted ?? order.timeline.preparing, order.timeline.ready ?? order.timeline.assigned ?? order.timeline.picked_up);
    if (prep !== null && prep > 0 && prep < 240) {
      acc.prepSum += prep;
      acc.prepCount += 1;
    }
    if (order.fulfillment === 'delivery') {
      const total = minutesBetween(order.timeline.placedAt ?? order.createdAt, order.timeline.delivered);
      if (total !== null && total > 0 && total < 300) {
        acc.deliverySum += total;
        acc.deliveryCount += 1;
      }
      const distance = order.delivery?.distanceMeters;
      if (typeof distance === 'number' && distance > 0) {
        acc.distanceSum += distance;
        acc.distanceCount += 1;
      }
    }
  }

  stats.actors.restaurantsActive = restaurants.size;
  stats.actors.customersActive = customers.size;
  finalizeAverages(stats);
  keepExternalFields(stats, previous);
  return stats;
}

/** Identifiant de la répartition financière d'une commande (orderFinancials/{orderId}). */
export function orderKey(order: Order & { id: string }): string {
  return order.id;
}

function finalizeAverages(stats: StatsDoc): void {
  const acc = stats.accumulators!;
  const delivered = stats.orders.delivered;
  stats.revenue.averageBasketCents = delivered ? Math.round(stats.revenue.gmvCents / delivered) : 0;
  stats.delivery.averagePrepMinutes = acc.prepCount ? Math.round(acc.prepSum / acc.prepCount) : 0;
  stats.delivery.averageMinutes = acc.deliveryCount ? Math.round(acc.deliverySum / acc.deliveryCount) : 0;
  stats.delivery.averageDistanceMeters = acc.distanceCount ? Math.round(acc.distanceSum / acc.distanceCount) : 0;
  stats.delivery.onTimeRate = delivered ? Math.round(((delivered - stats.orders.late) / delivered) * 1000) / 1000 : 0;
}

/** Champs alimentés par d'autres sources, conservés d'un recalcul à l'autre. */
function keepExternalFields(stats: StatsDoc, previous: Partial<StatsDoc> | null | undefined): void {
  if (!previous) return;
  // `checkoutStarted` et `paid` sont recalculés depuis les vraies commandes à chaque
  // passage (ne pas les reprendre de `previous`, qui daterait alors d'un calcul antérieur).
  if (previous.funnel) stats.funnel = { ...stats.funnel, appOpens: previous.funnel.appOpens, restaurantViews: previous.funnel.restaurantViews, addToCart: previous.funnel.addToCart };
  if (previous.support) stats.support = { ...stats.support, ...previous.support };
  if (previous.revenue?.subscriptionsHtCents) stats.revenue.subscriptionsHtCents = previous.revenue.subscriptionsHtCents;
  if (previous.actors) {
    stats.actors.restaurantsNew = previous.actors.restaurantsNew ?? 0;
    stats.actors.driversNew = previous.actors.driversNew ?? 0;
    stats.actors.driversOnlinePeak = previous.actors.driversOnlinePeak ?? 0;
  }
  if (previous.driversOnlineByHour?.length === 24) stats.driversOnlineByHour = [...previous.driversOnlineByHour];
}

/** Somme de plusieurs agrégats (villes → pays, villes → plateforme). */
export function sumStats(scope: 'country' | 'platform', scopeId: string, day: string, parts: StatsDoc[]): StatsDoc {
  const out = emptyStats(scope, scopeId, day, null, scope === 'country' ? scopeId : null);
  const acc = out.accumulators!;
  let averageResolutionWeighted = 0;
  for (const part of parts) {
    out.orders.placed += part.orders.placed;
    out.orders.delivered += part.orders.delivered;
    out.orders.cancelled += part.orders.cancelled;
    out.orders.rejected += part.orders.rejected;
    out.orders.late += part.orders.late;
    for (const [mode, count] of Object.entries(part.orders.byMode)) {
      const key = mode as FulfillmentMode;
      out.orders.byMode[key] = (out.orders.byMode[key] ?? 0) + (count ?? 0);
    }
    part.orders.byHour.forEach((count, hour) => {
      out.orders.byHour[hour] = (out.orders.byHour[hour] ?? 0) + count;
    });
    (part.driversOnlineByHour ?? []).forEach((count, hour) => {
      out.driversOnlineByHour![hour] = (out.driversOnlineByHour![hour] ?? 0) + count;
    });
    const r = part.revenue;
    const keys: Array<keyof typeof r> = [
      'gmvCents',
      'restaurantSalesCents',
      'commissionHtCents',
      'feesHtCents',
      'subscriptionsHtCents',
      'promoCostCents',
      'refundsCents',
      'courierCostCents',
      'paymentFeesCents',
      'marginCents',
    ];
    for (const key of keys) out.revenue[key] = (out.revenue[key] as Cents) + ((r[key] as Cents) ?? 0);
    const a = part.accumulators ?? approximateAccumulators(part);
    acc.prepSum += a.prepSum;
    acc.prepCount += a.prepCount;
    acc.deliverySum += a.deliverySum;
    acc.deliveryCount += a.deliveryCount;
    acc.distanceSum += a.distanceSum;
    acc.distanceCount += a.distanceCount;
    out.actors.restaurantsActive += part.actors.restaurantsActive;
    out.actors.restaurantsNew += part.actors.restaurantsNew;
    out.actors.customersNew += part.actors.customersNew;
    out.actors.customersActive += part.actors.customersActive;
    out.actors.driversNew += part.actors.driversNew;
    out.actors.driversOnlinePeak += part.actors.driversOnlinePeak;
    out.funnel.appOpens += part.funnel.appOpens;
    out.funnel.restaurantViews += part.funnel.restaurantViews;
    out.funnel.addToCart += part.funnel.addToCart;
    out.funnel.checkoutStarted += part.funnel.checkoutStarted;
    out.funnel.paid += part.funnel.paid;
    out.support.ticketsOpened += part.support.ticketsOpened;
    out.support.ticketsResolved += part.support.ticketsResolved;
    averageResolutionWeighted += part.support.averageResolutionMinutes * part.support.ticketsResolved;
  }
  out.support.averageResolutionMinutes = out.support.ticketsResolved ? Math.round(averageResolutionWeighted / out.support.ticketsResolved) : 0;
  finalizeAverages(out);
  return out;
}

/** Documents anciens sans accumulateurs : reconstitution depuis les moyennes. */
function approximateAccumulators(part: StatsDoc): StatsAccumulators {
  const delivered = part.orders.delivered;
  const deliveries = part.orders.byMode.delivery ?? delivered;
  return {
    prepSum: part.delivery.averagePrepMinutes * delivered,
    prepCount: part.delivery.averagePrepMinutes ? delivered : 0,
    deliverySum: part.delivery.averageMinutes * deliveries,
    deliveryCount: part.delivery.averageMinutes ? deliveries : 0,
    distanceSum: part.delivery.averageDistanceMeters * deliveries,
    distanceCount: part.delivery.averageDistanceMeters ? deliveries : 0,
  };
}

/** Identifiant de document statsDaily. */
export function statsDocId(scope: DailyStats['scope'], scopeId: string, day: string): string {
  return `${scope}_${scopeId}_${day.replaceAll('-', '')}`;
}
