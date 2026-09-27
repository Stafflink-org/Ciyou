// Commandes, vision globale du super admin (cahier §8) : liste filtrable de toutes
// les commandes (recherche, filtres combinés, pagination par curseur) et détection
// des anomalies (annulations, retards, refus) par commerce, par zone et par heure.
import {
  COLLECTIONS,
  normalizeText,
  type AdminOrderRow,
  type AnomalyRow,
  type ListOrdersAdminResult,
  type Order,
  type OrderAnomaliesResult,
} from '@golink/shared';
import type { Query } from 'firebase-admin/firestore';
import { db, Timestamp } from '../../lib/admin';
import { requireAdmin } from '../../lib/permissions';
import { z, zId } from '../../lib/validation';
import { loadMonitoringSettings } from '../pilotage/anomalies';
import { resolveScope } from '../pilotage/scope';
import { opsCallable, OPS_HEAVY_RUNTIME, TIMEZONE } from './common';

const ORDER_STATUS = z.enum(['scheduled', 'new', 'accepted', 'preparing', 'ready', 'assigned', 'picked_up', 'delivered', 'cancelled']);

function toRow(id: string, o: Order): AdminOrderRow {
  return {
    id,
    number: o.number,
    cityId: o.cityId,
    countryId: o.countryId,
    restaurantId: o.restaurantId,
    restaurantName: o.restaurantName,
    customerId: o.customerId,
    customerName: o.customerName,
    driverId: o.driverId ?? null,
    driverName: o.delivery?.driverName ?? null,
    status: o.status,
    fulfillment: o.fulfillment,
    paymentMethod: o.payment.method,
    paymentStatus: o.payment.status,
    totalCents: o.amounts.totalCents,
    refundedCents: o.amounts.refundedCents ?? 0,
    currency: o.amounts.currency ?? 'EUR',
    itemsCount: o.itemsCount,
    zoneId: o.delivery?.zoneId ?? null,
    late: Boolean(o.flags?.late),
    lateMinutes: o.flags?.lateMinutes ?? 0,
    disputed: Boolean(o.flags?.disputed),
    cancelReason: o.cancellation?.reason ?? null,
    dispatchStatus: o.delivery?.dispatchStatus ?? null,
    createdAt: o.createdAt.toMillis(),
    deliveredAt: o.timeline.delivered?.toMillis() ?? null,
    test: Boolean(o.test),
  };
}

export const listOrdersAdmin = opsCallable(
  z.object({
    countryId: z.string().regex(/^[A-Z]{2}$/).nullish(),
    cityIds: z.array(zId).max(30).nullish(),
    statuses: z.array(ORDER_STATUS).max(9).nullish(),
    fulfillment: z.enum(['delivery', 'pickup', 'dine_in']).nullish(),
    paymentMethod: z.enum(['card', 'apple_pay', 'google_pay', 'cash', 'meal_voucher', 'wallet']).nullish(),
    zoneId: zId.nullish(),
    restaurantId: zId.nullish(),
    driverId: zId.nullish(),
    customerId: zId.nullish(),
    search: z.string().trim().max(60).nullish(),
    from: z.number().int().nullish(),
    to: z.number().int().nullish(),
    flags: z.array(z.enum(['late', 'refunded', 'disputed', 'cancelled'])).max(4).nullish(),
    cursor: z.string().max(200).nullish(),
    pageSize: z.number().int().min(10).max(100).optional(),
  }),
  async (data, request): Promise<ListOrdersAdminResult> => {
    const { admin } = await requireAdmin(request, 'orders.view');
    const scope = await resolveScope(admin, { countryId: data.countryId ?? null, cityIds: data.cityIds ?? null });
    const pageSize = data.pageSize ?? 25;
    const orders = db.collection(COLLECTIONS.orders);

    // Filtre principal confié à Firestore (index existants), les autres appliqués en mémoire.
    let q: Query = orders;
    let cityInQuery = false;
    let primary: 'search' | 'restaurant' | 'driver' | 'customer' | 'city' | 'none' = 'none';
    const search = data.search ? normalizeText(data.search) : '';
    const searchWords = search.split(/[\s,@.'’]+/).filter(Boolean);
    if (search) {
      const compact = search.replace(/[\s.+()-]/g, '');
      const token = searchWords.length === 1 && compact.length <= 30 ? (compact.length > 15 && !/^gl/.test(compact) ? compact.slice(0, 15) : compact) : (searchWords[0] ?? '').slice(0, 15);
      q = q.where('searchKeywords', 'array-contains', token.length >= 2 ? token : compact);
      primary = 'search';
    } else if (data.restaurantId) {
      q = q.where('restaurantId', '==', data.restaurantId);
      primary = 'restaurant';
    } else if (data.driverId) {
      q = q.where('driverId', '==', data.driverId);
      primary = 'driver';
    } else if (data.customerId) {
      q = q.where('customerId', '==', data.customerId);
      primary = 'customer';
    } else if (scope.cityIds) {
      q = scope.cityIds.length === 1 ? q.where('cityId', '==', scope.cityIds[0]) : q.where('cityId', 'in', scope.cityIds);
      cityInQuery = true;
      primary = 'city';
      if (data.statuses?.length === 1 && scope.cityIds.length === 1) q = q.where('status', '==', data.statuses[0]);
    } else if (data.statuses?.length === 1) {
      q = q.where('status', '==', data.statuses[0]);
    }
    if (primary !== 'search') {
      if (data.from) q = q.where('createdAt', '>=', Timestamp.fromMillis(data.from));
      if (data.to) q = q.where('createdAt', '<=', Timestamp.fromMillis(data.to));
    }
    q = q.orderBy('createdAt', 'desc');

    const matches = (o: Order): boolean => {
      if (scope.cityIds && !scope.cityIds.includes(o.cityId)) return false;
      if (data.statuses?.length && !data.statuses.includes(o.status)) return false;
      if (data.fulfillment && o.fulfillment !== data.fulfillment) return false;
      if (data.paymentMethod && o.payment.method !== data.paymentMethod) return false;
      if (data.zoneId && o.delivery?.zoneId !== data.zoneId) return false;
      if (data.restaurantId && o.restaurantId !== data.restaurantId) return false;
      if (data.driverId && o.driverId !== data.driverId) return false;
      if (data.customerId && o.customerId !== data.customerId) return false;
      const created = o.createdAt.toMillis();
      if (data.from && created < data.from) return false;
      if (data.to && created > data.to) return false;
      if (searchWords.length > 1 && !searchWords.every((w) => o.searchKeywords?.some((k) => k.startsWith(w.slice(0, 15))))) return false;
      for (const flag of data.flags ?? []) {
        if (flag === 'late' && !o.flags?.late) return false;
        if (flag === 'refunded' && !(o.amounts.refundedCents > 0)) return false;
        if (flag === 'disputed' && !o.flags?.disputed) return false;
        if (flag === 'cancelled' && o.status !== 'cancelled') return false;
      }
      return true;
    };

    const rows: AdminOrderRow[] = [];
    let cursorSnap: FirebaseFirestore.DocumentSnapshot | null = data.cursor ? await orders.doc(data.cursor).get() : null;
    let scanned = 0;
    let exhausted = false;
    let lastId: string | null = null;
    const batchSize = 150;
    while (rows.length < pageSize && scanned < 3000) {
      const page = await (cursorSnap?.exists ? q.startAfter(cursorSnap) : q).limit(batchSize).get();
      scanned += page.size;
      for (const doc of page.docs) {
        lastId = doc.id;
        if (matches(doc.data() as Order)) rows.push(toRow(doc.id, doc.data() as Order));
        if (rows.length >= pageSize) break;
      }
      if (page.size < batchSize && rows.length < pageSize) {
        exhausted = true;
        break;
      }
      cursorSnap = page.docs[page.docs.length - 1] ?? null;
      if (rows.length >= pageSize) break;
    }
    if (rows.length >= pageSize) lastId = rows[rows.length - 1]!.id;

    // Total du filtre principal (sans les filtres appliqués en mémoire), si aucun ne s'ajoute.
    const secondary =
      Boolean(data.fulfillment || data.paymentMethod || data.zoneId || data.flags?.length || searchWords.length > 1) ||
      (Boolean(data.statuses?.length) && !(cityInQuery && data.statuses?.length === 1 && scope.cityIds?.length === 1) && !(primary === 'none' && data.statuses?.length === 1)) ||
      (primary !== 'city' && primary !== 'none' && Boolean(scope.cityIds));
    let total: number | null = null;
    if (!data.cursor && !secondary) total = (await q.count().get()).data().count;

    return { rows, nextCursor: exhausted ? null : lastId, scanned, total };
  },
  OPS_HEAVY_RUNTIME,
);

// ------------------------------------------------------------------ Anomalies

interface Tally {
  orders: number;
  cancelled: number;
  late: number;
  rejected: number;
  label: string;
  cityId: string | null;
}

function hourOf(date: Date): number {
  // formatToParts : le format « 22 h » de fr-FR n'est pas un nombre (Number('22 h') = NaN).
  const part = new Intl.DateTimeFormat('fr-FR', { timeZone: TIMEZONE, hour: '2-digit', hourCycle: 'h23' }).formatToParts(date).find((p) => p.type === 'hour');
  return Number(part?.value ?? 0) % 24;
}

export const getOrderAnomalies = opsCallable(
  z.object({ countryId: z.string().regex(/^[A-Z]{2}$/).nullish(), cityIds: z.array(zId).max(30).nullish(), days: z.number().int().min(1).max(60) }),
  async (data, request): Promise<OrderAnomaliesResult> => {
    const { admin } = await requireAdmin(request, 'orders.view');
    const scope = await resolveScope(admin, { countryId: data.countryId ?? null, cityIds: data.cityIds ?? null });
    const settings = await loadMonitoringSettings();
    const to = Date.now();
    const from = to - data.days * 86_400_000;
    let q: Query = db.collection(COLLECTIONS.orders);
    if (scope.cityIds) q = scope.cityIds.length === 1 ? q.where('cityId', '==', scope.cityIds[0]) : q.where('cityId', 'in', scope.cityIds);
    const snap = await q
      .where('createdAt', '>=', Timestamp.fromMillis(from))
      .orderBy('createdAt', 'desc')
      .select('cityId', 'restaurantId', 'restaurantName', 'status', 'flags', 'cancellation', 'delivery', 'createdAt')
      .limit(8000)
      .get();

    const zonesSnap = await db.collection(COLLECTIONS.zones).select('name', 'cityId').get();
    const zoneNames = new Map(zonesSnap.docs.map((d) => [d.id, d.get('name') as string]));
    const base: Tally = { orders: 0, cancelled: 0, late: 0, rejected: 0, label: 'Plateforme', cityId: null };
    const restaurants = new Map<string, Tally>();
    const zones = new Map<string, Tally>();
    const hours = new Map<string, Tally>();
    const bump = (map: Map<string, Tally>, key: string, label: string, cityId: string | null, o: Partial<Order>) => {
      const t = map.get(key) ?? { orders: 0, cancelled: 0, late: 0, rejected: 0, label, cityId };
      t.orders += 1;
      if (o.status === 'cancelled') t.cancelled += 1;
      if (o.flags?.late) t.late += 1;
      if (o.cancellation?.reason === 'restaurant_rejected' || o.cancellation?.reason === 'restaurant_timeout') t.rejected += 1;
      map.set(key, t);
    };
    for (const doc of snap.docs) {
      const o = doc.data() as Partial<Order>;
      if (o.status === 'scheduled') continue;
      bump(new Map([['all', base]]), 'all', base.label, null, o);
      bump(restaurants, o.restaurantId ?? '?', o.restaurantName ?? 'Commerce', o.cityId ?? null, o);
      const zoneId = o.delivery?.zoneId;
      if (zoneId) bump(zones, zoneId, zoneNames.get(zoneId) ?? zoneId, o.cityId ?? null, o);
      const h = hourOf(o.createdAt!.toDate());
      bump(hours, String(h).padStart(2, '0'), `${String(h).padStart(2, '0')} h – ${String((h + 1) % 24).padStart(2, '0')} h`, null, o);
    }
    const rate = (n: number, d: number) => (d > 0 ? n / d : 0);
    const baseline = { orders: base.orders, cancelRate: rate(base.cancelled, base.orders), lateRate: rate(base.late, base.orders), rejectRate: rate(base.rejected, base.orders) };
    // Seuil : écart au taux de référence au-delà du seuil de surveillance des commerces.
    const threshold = Math.max(0.05, settings.restaurantCancellationRate);
    const toRows = (map: Map<string, Tally>, minOrders: number): AnomalyRow[] =>
      [...map.entries()]
        .map(([key, t]) => {
          const cancelRate = rate(t.cancelled, t.orders);
          const lateRate = rate(t.late, t.orders);
          const rejectRate = rate(t.rejected, t.orders);
          const gaps = { cancel: cancelRate - baseline.cancelRate, late: lateRate - baseline.lateRate, reject: rejectRate - baseline.rejectRate } as const;
          const worstMetric = (Object.keys(gaps) as Array<keyof typeof gaps>).reduce((a, b) => (gaps[b] > gaps[a] ? b : a), 'cancel');
          return {
            key,
            label: t.label,
            cityId: t.cityId,
            orders: t.orders,
            cancelRate,
            lateRate,
            rejectRate,
            worstGap: gaps[worstMetric],
            worstMetric,
            flagged: t.orders >= minOrders && gaps[worstMetric] >= threshold,
          };
        })
        .sort((a, b) => Number(b.flagged) - Number(a.flagged) || b.worstGap - a.worstGap);
    const minOrders = Math.max(5, Math.round(settings.restaurantMinOrders * Math.min(1, data.days / 7)));
    return {
      from,
      to,
      baseline,
      threshold,
      minOrders,
      restaurants: toRows(restaurants, minOrders).slice(0, 50),
      zones: toRows(zones, minOrders),
      hours: toRows(hours, Math.max(5, Math.round(minOrders / 2))).sort((a, b) => a.key.localeCompare(b.key)),
    };
  },
  OPS_HEAVY_RUNTIME,
);
