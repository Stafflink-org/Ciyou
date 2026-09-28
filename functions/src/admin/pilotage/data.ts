// Lectures communes du pilotage : restaurants du périmètre, agrégats journaliers
// des restaurants et de la plateforme, conversion en indicateurs.
import {
  COLLECTIONS,
  SUBCOLLECTIONS,
  type DailyStats,
  type PilotageKpis,
  type PlanCode,
  type Restaurant,
  type RestaurantDailyStats,
  type WithId,
} from '@golink/shared';
import { db } from '../../lib/admin';
import { chunks, type ResolvedScope } from './scope';

export async function restaurantsInScope(scope: ResolvedScope, planCode?: PlanCode | null): Promise<WithId<Restaurant>[]> {
  const docs: FirebaseFirestore.QueryDocumentSnapshot[] = [];
  if (scope.cityIds) {
    for (const ids of chunks(scope.cityIds)) {
      if (!ids.length) continue;
      docs.push(...(await db.collection(COLLECTIONS.restaurants).where('cityId', 'in', ids).get()).docs);
    }
  } else {
    docs.push(...(await db.collection(COLLECTIONS.restaurants).get()).docs);
  }
  return docs
    .map((doc) => ({ ...(doc.data() as Restaurant), id: doc.id }))
    .filter((r) => !r.deletedAt && (!planCode || r.planCode === planCode));
}

/** Agrégats journaliers d'une liste de restaurants sur une période (par restaurant). */
export async function restaurantDaily(ids: string[], from: string, to: string): Promise<Map<string, RestaurantDailyStats[]>> {
  const out = new Map<string, RestaurantDailyStats[]>();
  for (const group of chunks(ids, 25)) {
    await Promise.all(
      group.map(async (id) => {
        const snap = await db
          .collection(COLLECTIONS.restaurants)
          .doc(id)
          .collection(SUBCOLLECTIONS.restaurants.dailyStats)
          .where('day', '>=', from)
          .where('day', '<=', to)
          .get();
        out.set(
          id,
          snap.docs.map((doc) => doc.data() as RestaurantDailyStats),
        );
      }),
    );
  }
  return out;
}

/** Agrégats statsDaily de la portée résolue, jour par jour (villes additionnées). */
export async function platformDaily(scope: ResolvedScope, from: string, to: string): Promise<Map<string, DailyStats[]>> {
  const byDay = new Map<string, DailyStats[]>();
  const { scope: level, ids } = scope.statsScope;
  for (const group of chunks(ids)) {
    if (!group.length) continue;
    const snap = await db
      .collection(COLLECTIONS.statsDaily)
      .where('scope', '==', level)
      .where('scopeId', 'in', group)
      .where('day', '>=', from)
      .where('day', '<=', to)
      .get();
    for (const doc of snap.docs) {
      const s = doc.data() as DailyStats;
      byDay.set(s.day, [...(byDay.get(s.day) ?? []), s]);
    }
  }
  return byDay;
}

export function emptyKpis(): PilotageKpis {
  return {
    ordersPlaced: 0,
    ordersDelivered: 0,
    ordersCancelled: 0,
    ordersRejected: 0,
    ordersLate: 0,
    gmvCents: 0,
    restaurantSalesCents: 0,
    commissionHtCents: 0,
    feesHtCents: 0,
    subscriptionsHtCents: 0,
    refundsCents: 0,
    marginCents: 0,
    averageBasketCents: 0,
    cancellationRate: 0,
    customersNew: 0,
  };
}

export function kpisFromPlatform(days: DailyStats[]): PilotageKpis {
  const k = emptyKpis();
  for (const s of days) {
    k.ordersPlaced += s.orders.placed;
    k.ordersDelivered += s.orders.delivered;
    k.ordersCancelled += s.orders.cancelled;
    k.ordersRejected += s.orders.rejected;
    k.ordersLate += s.orders.late;
    k.gmvCents += s.revenue.gmvCents;
    k.restaurantSalesCents += s.revenue.restaurantSalesCents;
    k.commissionHtCents += s.revenue.commissionHtCents;
    k.feesHtCents += s.revenue.feesHtCents;
    k.subscriptionsHtCents += s.revenue.subscriptionsHtCents;
    k.refundsCents += s.revenue.refundsCents;
    k.marginCents += s.revenue.marginCents;
    k.customersNew += s.actors.customersNew;
  }
  k.averageBasketCents = k.ordersDelivered ? Math.round(k.gmvCents / k.ordersDelivered) : 0;
  k.cancellationRate = k.ordersPlaced ? k.ordersCancelled / k.ordersPlaced : 0;
  return k;
}

/** Indicateurs depuis les agrégats restaurants (filtre par formule) : ventes TTC des articles comme volume. */
export function kpisFromRestaurants(days: RestaurantDailyStats[]): PilotageKpis {
  const k = emptyKpis();
  for (const d of days) {
    k.ordersPlaced += d.ordersCount;
    k.ordersDelivered += d.deliveredCount;
    k.ordersCancelled += d.cancelledCount;
    k.ordersRejected += d.rejectedCount;
    k.ordersLate += d.lateCount;
    k.gmvCents += d.salesCents;
    k.restaurantSalesCents += d.salesCents;
    k.commissionHtCents += d.commissionCents;
    k.customersNew += d.newCustomers;
  }
  k.averageBasketCents = k.ordersDelivered ? Math.round(k.restaurantSalesCents / k.ordersDelivered) : 0;
  k.cancellationRate = k.ordersPlaced ? k.ordersCancelled / k.ordersPlaced : 0;
  return k;
}
