// Calculs dérivés des écrans financiers (séries temporelles, classements).
import type { Order, Refund, RestaurantDailyStats, WithId } from '@golink/shared';
import { buildBuckets, type ResolvedPeriod } from './period';
import type { TrendPoint } from '../components/TrendChart';
import { restaurantShare } from './hooks';

export type TrendMetric = 'sales' | 'net' | 'orders' | 'basket';

function metricOf(day: RestaurantDailyStats | undefined, metric: TrendMetric): number {
  if (!day) return 0;
  switch (metric) {
    case 'sales':
      return day.salesCents ?? 0;
    case 'net':
      return day.netPayoutCents ?? 0;
    case 'orders':
      return day.deliveredCount ?? 0;
    case 'basket':
      return day.salesCents ?? 0;
  }
}

/** Série de la période et de la période précédente, alignées rang par rang. */
export function buildTrend(
  period: ResolvedPeriod,
  current: readonly RestaurantDailyStats[],
  previous: readonly RestaurantDailyStats[],
  metric: TrendMetric,
  refunds: { current: readonly Refund[]; previous: readonly Refund[] } = { current: [], previous: [] },
): TrendPoint[] {
  const byDay = new Map([...current, ...previous].map((day) => [day.day, day]));
  const refundByDay = new Map<string, number>();
  if (metric === 'net') {
    for (const refund of [...refunds.current, ...refunds.previous]) {
      const date = refund.requestedAt?.toDate?.();
      if (!date) continue;
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
      refundByDay.set(key, (refundByDay.get(key) ?? 0) + restaurantShare(refund));
    }
  }
  const aggregate = (days: string[]) => {
    let value = 0;
    let delivered = 0;
    for (const key of days) {
      const day = byDay.get(key);
      value += metricOf(day, metric) - (refundByDay.get(key) ?? 0);
      delivered += day?.deliveredCount ?? 0;
    }
    if (metric === 'basket') return delivered > 0 ? Math.round(value / delivered) : 0;
    return value;
  };
  const currentBuckets = buildBuckets(period.from, period.to, period.granularity);
  const previousBuckets = buildBuckets(period.previous.from, period.previous.to, period.granularity);
  return currentBuckets.map((bucket, index) => {
    const prev = previousBuckets[index];
    return {
      label: bucket.label,
      fullLabel: bucket.fullLabel,
      previousLabel: prev?.fullLabel,
      current: aggregate(bucket.days),
      previous: prev ? aggregate(prev.days) : null,
    };
  });
}

export interface ProductRank {
  productId: string;
  name: string;
  quantity: number;
  salesCents: number;
  orders: number;
}

/** Classement des produits vendus (commandes livrées), par chiffre d'affaires. */
export function topProducts(orders: readonly WithId<Order>[], max = 10): { items: ProductRank[]; totalCents: number } {
  const map = new Map<string, ProductRank>();
  let totalCents = 0;
  for (const order of orders) {
    if (order.status !== 'delivered') continue;
    for (const item of order.items ?? []) {
      if (item.adjustment?.type === 'removed') continue;
      const key = item.productId || item.name;
      const rank = map.get(key) ?? { productId: key, name: item.name, quantity: 0, salesCents: 0, orders: 0 };
      rank.quantity += item.quantity;
      rank.salesCents += item.totalCents;
      rank.orders += 1;
      totalCents += item.totalCents;
      map.set(key, rank);
    }
  }
  return { items: [...map.values()].sort((a, b) => b.salesCents - a.salesCents).slice(0, max), totalCents };
}

/** Commandes livrées par heure de passage (0 à 23 h). */
export function ordersByHour(orders: readonly WithId<Order>[]): Array<{ hour: string; commandes: number }> {
  const counts = Array.from({ length: 24 }, () => 0);
  for (const order of orders) {
    if (order.status !== 'delivered') continue;
    const placed = order.timeline?.placedAt?.toDate?.() ?? order.createdAt?.toDate?.();
    if (!placed) continue;
    counts[placed.getHours()] = (counts[placed.getHours()] ?? 0) + 1;
  }
  const first = counts.findIndex((count) => count > 0);
  const last = 23 - [...counts].reverse().findIndex((count) => count > 0);
  const from = first < 0 ? 10 : Math.min(first, 11);
  const to = first < 0 ? 23 : Math.max(last, 22);
  return counts.slice(from, to + 1).map((commandes, index) => ({ hour: `${from + index} h`, commandes }));
}
