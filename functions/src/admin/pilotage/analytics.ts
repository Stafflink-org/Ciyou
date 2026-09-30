// Analytics du super admin (cahier §3) : croissance et rétention, classements des
// restaurants, performance des livreurs, villes et zones (heures de pointe, offre /
// demande), abonnements (revenu mensuel récurrent, résiliations), tunnel de commande.
// Calculé à la demande, par section, dans le périmètre de l'administrateur.
import {
  COLLECTIONS,
  type AnalyticsSection,
  type CityAnalyticsRow,
  type DailyStats,
  type DispatchOffer,
  type Driver,
  type DriverPerformanceRow,
  type GrowthAnalytics,
  type Order,
  type PilotageAnalytics,
  type Plan,
  type PlanCode,
  type RestaurantRankingRow,
  type Subscription,
  type SubscriptionAnalytics,
  type Zone,
} from '@golink/shared';
import { db, Timestamp } from '../../lib/admin';
import { fail } from '../../lib/errors';
import { requireAdmin } from '../../lib/permissions';
import { z } from '../../lib/validation';
import { platformDaily, restaurantDaily, restaurantsInScope } from './data';
import { zFilters } from './overview';
import { pilotageCallable } from './runtime';
import { chunks, resolveScope, type ResolvedScope } from './scope';
import { addDays, daysInRange, listDays, monthKey, parisDay, rangeBounds } from './time';

type Filters = { from: string; to: string; planCode?: PlanCode | null };
type OrderLite = Pick<Order, 'customerId' | 'restaurantId' | 'cityId' | 'status' | 'flags' | 'driverId' | 'fulfillment' | 'timeline' | 'createdAt' | 'cancellation'> & {
  delivery?: { zoneId?: string | null; deliveredBy?: string | null } | null;
};

const ORDER_FIELDS = ['customerId', 'restaurantId', 'cityId', 'status', 'flags', 'driverId', 'fulfillment', 'timeline', 'createdAt', 'delivery.zoneId', 'delivery.deliveredBy', 'cancellation'];
const MAX_ORDERS = 25_000;

function previousPeriod(from: string, to: string): { from: string; to: string } {
  const length = daysInRange(from, to);
  return { from: addDays(from, -length), to: addDays(from, -1) };
}

async function ordersInScope(scope: ResolvedScope, from: string, to: string): Promise<OrderLite[]> {
  const { start, end } = rangeBounds(from, to);
  const base = db
    .collection(COLLECTIONS.orders)
    .where('createdAt', '>=', Timestamp.fromDate(start))
    .where('createdAt', '<', Timestamp.fromDate(end));
  const out: OrderLite[] = [];
  const run = async (query: FirebaseFirestore.Query) => {
    const snap = await query.orderBy('createdAt', 'desc').select(...ORDER_FIELDS).limit(MAX_ORDERS).get();
    out.push(...snap.docs.map((doc) => doc.data() as OrderLite));
  };
  if (scope.cityIds) {
    for (const ids of chunks(scope.cityIds)) if (ids.length) await run(base.where('cityId', 'in', ids));
  } else await run(base);
  return out;
}

const minutes = (a?: { toMillis(): number } | null, b?: { toMillis(): number } | null) => (a && b ? (b.toMillis() - a.toMillis()) / 60_000 : null);

// ------------------------------------------------------------------ Croissance

async function growth(scope: ResolvedScope, f: Filters): Promise<GrowthAnalytics> {
  const prev = previousPeriod(f.from, f.to);
  const { start: prevStart } = rangeBounds(prev.from, prev.to);
  const { end } = rangeBounds(f.from, f.to);
  const inRange = (ts: { toDate(): Date } | null | undefined, a: string, b: string) => {
    if (!ts) return false;
    const day = parisDay(ts.toDate());
    return day >= a && day <= b;
  };
  const byCity = async (collection: string, extra?: (q: FirebaseFirestore.Query) => FirebaseFirestore.Query) => {
    const docs: FirebaseFirestore.QueryDocumentSnapshot[] = [];
    let base: FirebaseFirestore.Query = db.collection(collection);
    if (extra) base = extra(base);
    base = base.where('createdAt', '>=', Timestamp.fromDate(prevStart)).where('createdAt', '<', Timestamp.fromDate(end));
    if (scope.cityIds) {
      for (const ids of chunks(scope.cityIds)) if (ids.length) docs.push(...(await base.where('cityId', 'in', ids).select('createdAt', 'cityId').get()).docs);
    } else docs.push(...(await base.select('createdAt', 'cityId').get()).docs);
    return docs.map((d) => d.get('createdAt') as FirebaseFirestore.Timestamp);
  };
  const [restaurants, drivers, customers, stats, churn] = await Promise.all([
    byCity(COLLECTIONS.restaurants),
    byCity(COLLECTIONS.drivers),
    byCity(COLLECTIONS.users, (q) => q.where('role', '==', 'client')),
    platformDaily(scope, f.from, f.to),
    subscriptionChurn(scope, f),
  ]);
  const count = (list: FirebaseFirestore.Timestamp[], a: string, b: string) => list.filter((ts) => inRange(ts, a, b)).length;
  const daily = listDays(f.from, f.to).map((day) => {
    const s = stats.get(day) ?? [];
    return {
      day,
      customersNew: count(customers, day, day),
      restaurantsNew: count(restaurants, day, day),
      driversNew: count(drivers, day, day),
      ordersPlaced: s.reduce((sum, x) => sum + x.orders.placed, 0),
      gmvCents: s.reduce((sum, x) => sum + x.revenue.gmvCents, 0),
    };
  });

  // Cohortes mensuelles : clients dont la première commande tombe dans le mois.
  const cohortFrom = `${monthKey(addDays(`${monthKey(f.to)}-01`, -150))}-01`;
  const orders = (await ordersInScope(scope, cohortFrom < prev.from ? cohortFrom : prev.from, f.to)).filter((o) => o.status === 'delivered');
  const months = [...new Set(orders.map((o) => monthKey(parisDay(o.createdAt.toDate()))))].sort();
  const firstMonth = new Map<string, string>();
  const activeMonths = new Map<string, Set<string>>();
  for (const o of [...orders].sort((a, b) => a.createdAt.toMillis() - b.createdAt.toMillis())) {
    const month = monthKey(parisDay(o.createdAt.toDate()));
    if (o.flags?.firstOrder && !firstMonth.has(o.customerId)) firstMonth.set(o.customerId, month);
    const set = activeMonths.get(o.customerId) ?? new Set<string>();
    set.add(month);
    activeMonths.set(o.customerId, set);
  }
  const cohorts = months
    .filter((m) => m >= monthKey(cohortFrom))
    .slice(-6)
    .map((cohort) => {
      const members = [...firstMonth.entries()].filter(([, m]) => m === cohort).map(([id]) => id);
      const later = months.filter((m) => m >= cohort);
      return {
        cohort,
        size: members.length,
        retention: later.slice(0, 6).map((m) => (members.length ? members.filter((id) => activeMonths.get(id)?.has(m)).length / members.length : 0)),
      };
    })
    .filter((c) => c.size > 0);

  const current = orders.filter((o) => {
    const d = parisDay(o.createdAt.toDate());
    return d >= f.from && d <= f.to;
  });
  const perCustomer = new Map<string, number>();
  for (const o of current) perCustomer.set(o.customerId, (perCustomer.get(o.customerId) ?? 0) + 1);
  const repeatRate = perCustomer.size ? [...perCustomer.values()].filter((n) => n >= 2).length / perCustomer.size : 0;

  const prevRestaurants = new Set(
    orders.filter((o) => {
      const d = parisDay(o.createdAt.toDate());
      return d >= prev.from && d <= prev.to;
    }).map((o) => o.restaurantId),
  );
  const currentRestaurants = new Set(current.map((o) => o.restaurantId));
  const retained = [...prevRestaurants].filter((id) => currentRestaurants.has(id)).length;

  return {
    daily,
    totals: {
      customersNew: count(customers, f.from, f.to),
      restaurantsNew: count(restaurants, f.from, f.to),
      driversNew: count(drivers, f.from, f.to),
      previousCustomersNew: count(customers, prev.from, prev.to),
      previousRestaurantsNew: count(restaurants, prev.from, prev.to),
      previousDriversNew: count(drivers, prev.from, prev.to),
    },
    cohorts,
    repeatRate,
    restaurantRetention: prevRestaurants.size ? retained / prevRestaurants.size : 0,
    subscriptionRetention: 1 - churn.churnRate,
  };
}

// ------------------------------------------------------------------ Restaurants

async function rankings(scope: ResolvedScope, f: Filters): Promise<NonNullable<PilotageAnalytics['restaurants']>> {
  const prev = previousPeriod(f.from, f.to);
  const restaurants = (await restaurantsInScope(scope, f.planCode)).filter((r) => r.status !== 'onboarding' || r.ordersCount > 0);
  const daily = await restaurantDaily(
    restaurants.map((r) => r.id),
    prev.from,
    f.to,
  );
  const recentFrom = addDays(f.to, -6);
  const rows: RestaurantRankingRow[] = restaurants.map((r) => {
    const days = daily.get(r.id) ?? [];
    const cur = days.filter((d) => d.day >= f.from && d.day <= f.to);
    const old = days.filter((d) => d.day >= prev.from && d.day <= prev.to);
    const sum = (list: typeof days, pick: (d: (typeof days)[number]) => number) => list.reduce((s, d) => s + pick(d), 0);
    const orders = sum(cur, (d) => d.ordersCount);
    const delivered = sum(cur, (d) => d.deliveredCount);
    const salesCents = sum(cur, (d) => d.salesCents);
    const previousSalesCents = sum(old, (d) => d.salesCents);
    const prepDays = cur.filter((d) => d.averagePrepMinutes > 0);
    return {
      restaurantId: r.id,
      name: r.name,
      cityId: r.cityId,
      planCode: r.planCode,
      status: r.status,
      orders,
      delivered,
      salesCents,
      commissionCents: sum(cur, (d) => d.commissionCents),
      averageBasketCents: delivered ? Math.round(salesCents / delivered) : 0,
      cancellationRate: orders ? sum(cur, (d) => d.cancelledCount) / orders : 0,
      rejectionRate: orders ? sum(cur, (d) => d.rejectedCount) / orders : 0,
      averagePrepMinutes: prepDays.length
        ? Math.round(prepDays.reduce((s, d) => s + d.averagePrepMinutes * Math.max(1, d.deliveredCount), 0) / prepDays.reduce((s, d) => s + Math.max(1, d.deliveredCount), 0))
        : 0,
      rating: r.rating?.average ?? 0,
      ratingCount: r.rating?.count ?? 0,
      salesTrend: previousSalesCents > 0 ? (salesCents - previousSalesCents) / previousSalesCents : null,
      previousSalesCents,
      recentOrders: sum(days.filter((d) => d.day >= recentFrom && d.day <= f.to), (d) => d.ordersCount),
    } as RestaurantRankingRow & { recentOrders: number };
  });
  // Risque de départ : ventes en baisse de 30 % ou plus, ou plus aucune commande sur 7 jours.
  const atRisk = rows
    .filter((row) => row.status === 'active' && ((row.salesTrend !== null && row.salesTrend <= -0.3) || (row.previousSalesCents > 0 && (row as RestaurantRankingRow & { recentOrders: number }).recentOrders === 0)))
    .sort((a, b) => (a.salesTrend ?? -1) - (b.salesTrend ?? -1));
  const clean = (row: RestaurantRankingRow & { recentOrders?: number }): RestaurantRankingRow => {
    const { recentOrders: _recent, ...rest } = row;
    return rest;
  };
  return { rows: rows.map(clean), atRisk: atRisk.map(clean) };
}

// ------------------------------------------------------------------ Livreurs

async function driverPerformance(scope: ResolvedScope, f: Filters): Promise<NonNullable<PilotageAnalytics['drivers']>> {
  const driverDocs: FirebaseFirestore.QueryDocumentSnapshot[] = [];
  if (scope.cityIds) {
    for (const ids of chunks(scope.cityIds)) if (ids.length) driverDocs.push(...(await db.collection(COLLECTIONS.drivers).where('cityId', 'in', ids).get()).docs);
  } else driverDocs.push(...(await db.collection(COLLECTIONS.drivers).get()).docs);
  const { start, end } = rangeBounds(f.from, f.to);
  const [orders, zonesSnap, offers] = await Promise.all([
    ordersInScope(scope, f.from, f.to),
    db.collection(COLLECTIONS.zones).get(),
    // Propositions de course par zone (§3 « Performance par zone »), sur la même période
    // que le reste de la section — jusqu'ici seules les livraisons/retards étaient
    // détaillés par zone, pas l'acceptation ni les annulations (corrigé cdc-fix-residuals-7).
    scopedDispatchOffers(scope, start, end),
  ]);
  const zoneNames = new Map(zonesSnap.docs.map((doc) => [doc.id, (doc.data() as Zone).name]));
  const perDriver = new Map<string, { delivered: number; late: number }>();
  const perZone = new Map<string, { deliveries: number; late: number; minutes: number; timed: number; assigned: number; cancellations: number; offered: number; accepted: number }>();
  const zoneAcc = (zoneId: string) => perZone.get(zoneId) ?? { deliveries: 0, late: 0, minutes: 0, timed: 0, assigned: 0, cancellations: 0, offered: 0, accepted: 0 };
  for (const o of orders) {
    if (o.driverId) {
      const d = perDriver.get(o.driverId) ?? { delivered: 0, late: 0 };
      if (o.status === 'delivered' && o.fulfillment === 'delivery') {
        d.delivered += 1;
        if (o.flags?.late) d.late += 1;
      }
      perDriver.set(o.driverId, d);
    }
    const zoneId = o.delivery?.zoneId;
    if (!zoneId) continue;
    // Base « annulations » alignée sur `runDriverStatsCompute` (driver-stats.ts) : toute
    // commande livrée par la plateforme et assignée à un livreur compte dans le
    // dénominateur, une annulation imputable au livreur au numérateur.
    if (o.driverId && o.delivery?.deliveredBy === 'platform') {
      const z = zoneAcc(zoneId);
      z.assigned += 1;
      if (o.status === 'cancelled' && (o.cancellation?.by === 'driver' || o.cancellation?.reason === 'address_unreachable')) z.cancellations += 1;
      perZone.set(zoneId, z);
    }
    if (o.status === 'delivered' && o.fulfillment === 'delivery') {
      const z = zoneAcc(zoneId);
      z.deliveries += 1;
      if (o.flags?.late) z.late += 1;
      const total = minutes(o.timeline?.placedAt ?? o.createdAt, o.timeline?.delivered);
      if (total !== null && total > 0 && total < 300) {
        z.minutes += total;
        z.timed += 1;
      }
      perZone.set(zoneId, z);
    }
  }
  // Acceptation par zone : mêmes règles que `runDriverStatsCompute` (une offre encore
  // `offered` est en attente, ni acceptée ni refusée, exclue du calcul).
  for (const offer of offers) {
    if (offer.status === 'offered' || !offer.zoneId) continue;
    const z = zoneAcc(offer.zoneId);
    z.offered += 1;
    if (offer.status === 'accepted') z.accepted += 1;
    perZone.set(offer.zoneId, z);
  }
  const rows: DriverPerformanceRow[] = driverDocs
    .map((doc) => ({ id: doc.id, d: doc.data() as Driver }))
    .filter(({ d }) => !d.deletedAt)
    .map(({ id, d }) => ({
      driverId: id,
      name: `${d.firstName} ${d.lastName}`.trim() || d.displayName,
      cityId: d.cityId,
      zoneIds: d.zoneIds ?? [],
      vehicle: d.vehicle?.type ?? 'bike',
      status: d.status,
      availability: d.availability,
      deliveries: d.stats?.deliveries ?? 0,
      deliveriesInPeriod: perDriver.get(id)?.delivered ?? 0,
      acceptanceRate: d.stats?.acceptanceRate ?? 0,
      cancellationRate: d.stats?.cancellationRate ?? 0,
      onTimeRate: d.stats?.onTimeRate ?? 0,
      lateInPeriod: perDriver.get(id)?.late ?? 0,
      averageDeliveryMinutes: d.stats?.averageDeliveryMinutes ?? 0,
      rating: d.rating?.average ?? 0,
    }));
  const byZone = [...perZone.entries()]
    .map(([zoneId, z]) => ({
      zoneId,
      name: zoneNames.get(zoneId) ?? zoneId,
      deliveries: z.deliveries,
      lateRate: z.deliveries ? z.late / z.deliveries : 0,
      averageMinutes: z.timed ? Math.round(z.minutes / z.timed) : 0,
      acceptanceRate: z.offered ? Math.round((z.accepted / z.offered) * 1000) / 1000 : 0,
      cancellationRate: z.assigned ? Math.round((z.cancellations / z.assigned) * 1000) / 1000 : 0,
    }))
    .sort((a, b) => b.deliveries - a.deliveries);
  return { rows, byZone };
}

/** Propositions de course de la période, dans le périmètre géographique (§3 « Performance par zone »). */
async function scopedDispatchOffers(scope: ResolvedScope, start: Date, end: Date): Promise<DispatchOffer[]> {
  const base = db.collection(COLLECTIONS.dispatchOffers).where('offeredAt', '>=', Timestamp.fromDate(start)).where('offeredAt', '<', Timestamp.fromDate(end));
  const out: DispatchOffer[] = [];
  if (scope.cityIds) {
    for (const ids of chunks(scope.cityIds)) if (ids.length) out.push(...(await base.where('cityId', 'in', ids).get()).docs.map((doc) => doc.data() as DispatchOffer));
  } else {
    out.push(...(await base.get()).docs.map((doc) => doc.data() as DispatchOffer));
  }
  return out;
}

// ------------------------------------------------------------------ Villes et zones

async function cities(scope: ResolvedScope, f: Filters): Promise<NonNullable<PilotageAnalytics['cities']>> {
  const cityIds = scope.cityIds ?? [...scope.markets.cities.keys()];
  const stats: DailyStats[] = [];
  for (const ids of chunks(cityIds)) {
    if (!ids.length) continue;
    const snap = await db
      .collection(COLLECTIONS.statsDaily)
      .where('scope', '==', 'city')
      .where('scopeId', 'in', ids)
      .where('day', '>=', f.from)
      .where('day', '<=', f.to)
      .get();
    stats.push(...snap.docs.map((doc) => doc.data() as DailyStats));
  }
  const [driversSnap, zonesSnap] = await Promise.all([
    db.collection(COLLECTIONS.drivers).select('cityId', 'availability', 'status').get(),
    db.collection(COLLECTIONS.zones).get(),
  ]);
  const rows: CityAnalyticsRow[] = cityIds
    .map((cityId) => scope.markets.cities.get(cityId))
    .filter((c): c is NonNullable<typeof c> => Boolean(c))
    .map((city) => {
      const days = stats.filter((s) => s.scopeId === city.id);
      const sum = (pick: (s: DailyStats) => number) => days.reduce((total, s) => total + pick(s), 0);
      const delivered = sum((s) => s.orders.delivered);
      const placed = sum((s) => s.orders.placed);
      const gmv = sum((s) => s.revenue.gmvCents);
      const deliveries = sum((s) => (s.delivery.averageMinutes ? s.orders.byMode.delivery ?? s.orders.delivered : 0));
      const byHour = Array.from({ length: 24 }, (_, h) => sum((s) => s.orders.byHour[h] ?? 0));
      const sampledDays = days.filter((s) => (s.driversOnlineByHour ?? []).some((n) => n > 0));
      const driversOnlineByHour = Array.from({ length: 24 }, (_, h) =>
        sampledDays.length ? Math.round((sampledDays.reduce((t, s) => t + (s.driversOnlineByHour?.[h] ?? 0), 0) / sampledDays.length) * 10) / 10 : 0,
      );
      const drivers = driversSnap.docs.filter((d) => d.get('cityId') === city.id);
      const peakHour = byHour.indexOf(Math.max(...byHour));
      const peakOrdersPerDay = days.length ? (byHour[peakHour] ?? 0) / days.length : 0;
      const peakDrivers = driversOnlineByHour[peakHour] ?? 0;
      return {
        cityId: city.id,
        name: city.name,
        countryId: city.countryId,
        orders: placed,
        delivered,
        gmvCents: gmv,
        commissionHtCents: sum((s) => s.revenue.commissionHtCents),
        averageBasketCents: delivered ? Math.round(gmv / delivered) : 0,
        averageDeliveryMinutes: deliveries ? Math.round(sum((s) => s.delivery.averageMinutes * (s.delivery.averageMinutes ? s.orders.byMode.delivery ?? s.orders.delivered : 0)) / deliveries) : 0,
        onTimeRate: delivered ? (delivered - sum((s) => s.orders.late)) / delivered : 0,
        cancellationRate: placed ? sum((s) => s.orders.cancelled) / placed : 0,
        byHour,
        driversOnlineByHour,
        driversRegistered: drivers.filter((d) => d.get('status') === 'active').length,
        driversOnlineNow: drivers.filter((d) => ['online', 'on_delivery'].includes(d.get('availability') as string)).length,
        demandPerDriver: peakDrivers > 0 ? Math.round((peakOrdersPerDay / peakDrivers) * 10) / 10 : null,
        zones: zonesSnap.docs
          .filter((z) => z.get('cityId') === city.id)
          .map((z) => {
            const zone = z.data() as Zone;
            return { zoneId: z.id, name: zone.name, active: zone.active, driversAvailable: zone.live?.driversAvailable ?? 0, pendingOrders: zone.live?.ordersWaiting ?? 0 };
          }),
      };
    })
    .sort((a, b) => b.gmvCents - a.gmvCents);
  return { rows };
}

// ------------------------------------------------------------------ Abonnements

function monthlyPrice(s: Subscription): number {
  const discount = s.specialOffer?.discountBps ? 1 - s.specialOffer.discountBps / 10_000 : 1;
  return Math.round((s.billingCycle === 'yearly' ? s.priceHtCents / 12 : s.priceHtCents) * discount);
}

/**
 * Souscriptions dans le périmètre + désabonnements de la période (§3 « Croissance »,
 * « rétention des restaurants (qui restent abonnés) », et §3 « Abonnements »). Factorisé
 * pour que `growth()` puisse présenter la même rétention d'abonnement que l'onglet
 * Abonnements sans dupliquer la logique (corrigé cdc-fix-residuals-7 : la ligne
 * « rétention des restaurants » de Croissance ne mesurait que les restaurants qui
 * commandent, jamais ceux qui restent abonnés — donnée déjà calculée ici mais jamais
 * remontée dans cet onglet).
 */
async function subscriptionChurn(scope: ResolvedScope, f: Filters): Promise<{ churnRate: number; cancellations: number; activeAtStart: number }> {
  const restaurants = await restaurantsInScope(scope);
  const names = new Set(restaurants.map((r) => r.id));
  const subsSnap = await db.collection(COLLECTIONS.subscriptions).get();
  const subs = subsSnap.docs
    .map((doc) => doc.data() as Subscription)
    .filter((s) => (s.restaurantIds?.length ? s.restaurantIds : [s.subscriberId]).some((id) => names.has(id)))
    .filter((s) => !f.planCode || s.planCode === f.planCode);
  const { start, end } = rangeBounds(f.from, f.to);
  const within = (ts: { toMillis(): number } | null | undefined) => Boolean(ts && ts.toMillis() >= start.getTime() && ts.toMillis() < end.getTime());
  const cancellations = subs.flatMap((s) => s.history ?? []).filter((h) => h.event === 'cancelled' && within(h.at)).length;
  const activeAtStart = subs.filter((s) => s.createdAt.toMillis() < start.getTime() && (!s.cancelledAt || s.cancelledAt.toMillis() >= start.getTime())).length;
  return { churnRate: activeAtStart ? cancellations / activeAtStart : 0, cancellations, activeAtStart };
}

async function subscriptions(scope: ResolvedScope, f: Filters): Promise<SubscriptionAnalytics> {
  const restaurants = await restaurantsInScope(scope);
  const names = new Map(restaurants.map((r) => [r.id, r.name]));
  const [subsSnap, plansSnap] = await Promise.all([db.collection(COLLECTIONS.subscriptions).get(), db.collection(COLLECTIONS.plans).get()]);
  const planNames = new Map(plansSnap.docs.map((doc) => [doc.id, (doc.data() as Plan).name]));
  const subs = subsSnap.docs
    .map((doc) => ({ id: doc.id, s: doc.data() as Subscription }))
    .filter(({ s }) => (s.restaurantIds?.length ? s.restaurantIds : [s.subscriberId]).some((id) => names.has(id)))
    .filter(({ s }) => !f.planCode || s.planCode === f.planCode);
  const live = subs.filter(({ s }) => s.status === 'active' || s.status === 'past_due' || s.status === 'restricted');
  const mrr = live.reduce((sum, { s }) => sum + monthlyPrice(s), 0);
  const codes: PlanCode[] = ['basic', 'pro', 'premium'];
  const byPlan = codes.map((code) => {
    const list = subs.filter(({ s }) => s.planCode === code);
    return {
      planCode: code,
      name: planNames.get(code) ?? code,
      active: list.filter(({ s }) => s.status === 'active').length,
      trialing: list.filter(({ s }) => s.status === 'trialing').length,
      pastDue: list.filter(({ s }) => s.status === 'past_due' || s.status === 'restricted').length,
      mrrCents: list.filter(({ s }) => s.status === 'active' || s.status === 'past_due').reduce((sum, { s }) => sum + monthlyPrice(s), 0),
    };
  });
  const { start, end } = rangeBounds(f.from, f.to);
  const within = (ts: { toMillis(): number } | null | undefined) => Boolean(ts && ts.toMillis() >= start.getTime() && ts.toMillis() < end.getTime());
  const events = subs.flatMap(({ id, s }) => (s.history ?? []).map((h) => ({ id, s, h })));
  const cancellations = events.filter(({ h }) => h.event === 'cancelled' && within(h.at)).length;
  const activeAtStart = subs.filter(({ s }) => s.createdAt.toMillis() < start.getTime() && (!s.cancelledAt || s.cancelledAt.toMillis() >= start.getTime())).length;

  const months: string[] = [];
  for (let i = 5; i >= 0; i -= 1) {
    const [y, m] = f.to.split('-').map(Number) as [number, number];
    months.push(new Date(Date.UTC(y, m - 1 - i, 1)).toISOString().slice(0, 7));
  }
  const monthly = months.map((month) => {
    const [y, m] = month.split('-').map(Number) as [number, number];
    const monthEnd = Date.UTC(y, m, 1);
    const inMonth = (ts: { toMillis(): number } | null | undefined) => Boolean(ts && monthKey(parisDay(new Date(ts.toMillis()))) === month);
    const activeAtEnd = subs.filter(({ s }) => s.createdAt.toMillis() < monthEnd && (!s.cancelledAt || s.cancelledAt.toMillis() >= monthEnd) && s.status !== 'trialing');
    return {
      month,
      mrrCents: activeAtEnd.reduce((sum, { s }) => sum + monthlyPrice(s), 0),
      newCount: subs.filter(({ s }) => inMonth(s.createdAt)).length,
      cancelledCount: events.filter(({ h }) => h.event === 'cancelled' && inMonth(h.at)).length,
      upgrades: events.filter(({ h }) => h.event === 'upgraded' && inMonth(h.at)).length,
      downgrades: events.filter(({ h }) => h.event === 'downgraded' && inMonth(h.at)).length,
    };
  });
  return {
    byPlan,
    mrrCents: mrr,
    arrCents: mrr * 12,
    churnRate: activeAtStart ? cancellations / activeAtStart : 0,
    cancellations,
    upgrades: events.filter(({ h }) => h.event === 'upgraded' && within(h.at)).length,
    downgrades: events.filter(({ h }) => h.event === 'downgraded' && within(h.at)).length,
    newSubscriptions: subs.filter(({ s }) => within(s.createdAt)).length,
    monthly,
    recentChanges: events
      .filter(({ h }) => h.event !== 'renewed')
      .sort((a, b) => b.h.at.toMillis() - a.h.at.toMillis())
      .slice(0, 12)
      .map(({ id, s, h }) => ({
        subscriptionId: id,
        subscriberName: names.get(s.subscriberId) ?? s.subscriberId,
        event: h.event,
        planCode: h.planCode,
        at: h.at.toDate().toISOString(),
        reason: h.reason ?? null,
      })),
  };
}

// ------------------------------------------------------------------ Tunnel

async function funnel(scope: ResolvedScope, f: Filters): Promise<NonNullable<PilotageAnalytics['funnel']>> {
  const stats = await platformDaily(scope, f.from, f.to);
  const days = listDays(f.from, f.to).map((day) => {
    const list = stats.get(day) ?? [];
    return {
      day,
      appOpens: list.reduce((s, x) => s + (x.funnel?.appOpens ?? 0), 0),
      restaurantViews: list.reduce((s, x) => s + (x.funnel?.restaurantViews ?? 0), 0),
      addToCart: list.reduce((s, x) => s + (x.funnel?.addToCart ?? 0), 0),
      checkoutStarted: list.reduce((s, x) => s + (x.funnel?.checkoutStarted ?? 0), 0),
      paid: list.reduce((s, x) => s + (x.funnel?.paid ?? 0), 0),
    };
  });
  const total = (key: 'appOpens' | 'restaurantViews' | 'addToCart' | 'checkoutStarted' | 'paid') => days.reduce((s, d) => s + d[key], 0);
  const opens = total('appOpens');
  const checkoutStarted = total('checkoutStarted');
  // `appOpens` (et les étapes suivantes de découverte) exigent l'application cliente,
  // absente à ce jour : sans elle, seules les deux dernières étapes (dérivées des
  // commandes elles-mêmes) sont réelles ('estimated' — voir docs/CONTRATS_APPS_MOBILES.md).
  const source: 'analytics' | 'estimated' | 'none' = opens > 0 ? 'analytics' : checkoutStarted > 0 ? 'estimated' : 'none';
  return {
    steps: [
      { key: 'appOpens', label: 'Ouvertures de l’app', value: opens },
      { key: 'restaurantViews', label: 'Fiches commerce consultées', value: total('restaurantViews') },
      { key: 'addToCart', label: 'Ajouts au panier', value: total('addToCart') },
      { key: 'checkoutStarted', label: 'Paiements commencés', value: checkoutStarted },
      { key: 'paid', label: 'Commandes payées', value: total('paid') },
    ],
    daily: days.map((d) => ({ day: d.day, appOpens: d.appOpens, addToCart: d.addToCart, paid: d.paid })),
    conversionRate: opens ? total('paid') / opens : checkoutStarted ? total('paid') / checkoutStarted : 0,
    source,
  };
}

export const getPilotageAnalytics = pilotageCallable(
  z.object({ ...zFilters, section: z.enum(['growth', 'restaurants', 'drivers', 'cities', 'subscriptions', 'funnel']) }),
  async (data, request): Promise<PilotageAnalytics> => {
    const { admin } = await requireAdmin(request, 'analytics.view');
    if (data.from > data.to) throw fail.invalid('La date de début doit précéder la date de fin.');
    if (daysInRange(data.from, data.to) > 400) data.from = addDays(data.to, -399);
    const scope = await resolveScope(admin, data);
    const filters: Filters = { from: data.from, to: data.to, planCode: data.planCode ?? null };
    const section = data.section as AnalyticsSection;
    const result: PilotageAnalytics = { section, generatedAt: new Date().toISOString() };
    if (section === 'growth') result.growth = await growth(scope, filters);
    if (section === 'restaurants') result.restaurants = await rankings(scope, filters);
    if (section === 'drivers') result.drivers = await driverPerformance(scope, filters);
    if (section === 'cities') result.cities = await cities(scope, filters);
    if (section === 'subscriptions') result.subscriptions = await subscriptions(scope, filters);
    if (section === 'funnel') result.funnel = await funnel(scope, filters);
    return result;
  },
  { memory: '512MiB', timeoutSeconds: 120 },
);

