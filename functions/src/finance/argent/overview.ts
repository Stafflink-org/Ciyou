// Vue d'ensemble financière (cahier §15) : ce que paient les clients, ce que garde
// GoLink, ce que reçoivent commerces et livreurs, sur une période et un périmètre,
// comparée à la période précédente de même durée. Calculée côté serveur à partir de
// la répartition faisant foi de chaque commande (orderFinancials).
import {
  COLLECTIONS,
  type DriverPrivate,
  type FinanceDailyPoint,
  type FinanceOverview,
  type FinanceTotals,
  type Invoice,
  type OrderFinancials,
  type Payout,
  type Promotion,
  type PromotionRedemption,
  type Refund,
} from '@golink/shared';
import { db, Timestamp } from '../../lib/admin';
import { fail } from '../../lib/errors';
import { requireAdmin } from '../../lib/permissions';
import { z } from '../../lib/validation';
import { addDays, chunk, inScope, parisDay, rangeBounds, scopeCities, scopeCountry, zDay } from './common';
import { argentCallable } from './runtime';

const emptyTotals = (): FinanceTotals => ({
  ordersCount: 0,
  grossCents: 0,
  netRevenueCents: 0,
  commissionHtCents: 0,
  customerFeesHtCents: 0,
  subscriptionsHtCents: 0,
  sponsoredHtCents: 0,
  paymentFeesCents: 0,
  courierCostCents: 0,
  tipsCents: 0,
  promoPlatformCents: 0,
  promoRestaurantCents: 0,
  refundsCents: 0,
  refundsRestaurantCents: 0,
  refundsPlatformCents: 0,
  restaurantsPayoutCents: 0,
  vatDueCents: 0,
  marginCents: 0,
});

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
}

interface Scope {
  countryId: string | null;
  cityIds: string[] | null;
}

async function collectPeriod(from: string, to: string, scope: Scope, withDetails: boolean) {
  const { start, end } = rangeBounds(from, to);
  const range = [Timestamp.fromDate(start), Timestamp.fromDate(end)] as const;
  const [finSnap, refundSnap, invoiceSnap] = await Promise.all([
    db.collection(COLLECTIONS.orderFinancials).where('deliveredAt', '>=', range[0]).where('deliveredAt', '<', range[1]).get(),
    db.collection(COLLECTIONS.refunds).where('requestedAt', '>=', range[0]).where('requestedAt', '<', range[1]).get(),
    db.collection(COLLECTIONS.invoices).where('issuedAt', '>=', range[0]).where('issuedAt', '<', range[1]).get(),
  ]);
  const totals = emptyTotals();
  const daily = new Map<string, FinanceDailyPoint>();
  const point = (day: string) => {
    let p = daily.get(day);
    if (!p) {
      p = { day, ordersCount: 0, grossCents: 0, netRevenueCents: 0, marginCents: 0, refundsCents: 0 };
      daily.set(day, p);
    }
    return p;
  };
  const byRestaurant = new Map<string, { grossCents: number; commissionHtCents: number; orders: number }>();
  const byMethod = new Map<string, { amountCents: number; count: number }>();

  for (const doc of finSnap.docs) {
    const f = doc.data() as OrderFinancials;
    if (!inScope(f, scope.countryId, scope.cityIds) || !f.deliveredAt) continue;
    const s = f.settlement;
    const fees = s.platform.serviceFeeHtCents + s.platform.smallOrderFeeHtCents + s.platform.deliveryFeeHtCents;
    totals.ordersCount += 1;
    totals.grossCents += s.customerPaidCents;
    totals.commissionHtCents += s.platform.commissionHtCents;
    totals.customerFeesHtCents += fees;
    totals.paymentFeesCents += s.payment.totalCents;
    totals.courierCostCents += s.platform.courierCostCents;
    totals.tipsCents += (s.courier?.tipCents ?? 0) + (s.restaurant.tipCents ?? 0);
    totals.promoPlatformCents += s.platform.promoCostCents;
    totals.promoRestaurantCents += s.restaurant.discountFundedCents;
    totals.restaurantsPayoutCents += s.restaurant.payoutCents;
    totals.vatDueCents += s.platform.vatDueCents;
    totals.marginCents += f.finalMarginCents;
    const p = point(parisDay(f.deliveredAt.toDate()));
    p.ordersCount += 1;
    p.grossCents += s.customerPaidCents;
    p.netRevenueCents += s.platform.commissionHtCents + fees;
    p.marginCents += f.finalMarginCents;
    if (withDetails) {
      const r = byRestaurant.get(f.restaurantId) ?? { grossCents: 0, commissionHtCents: 0, orders: 0 };
      r.grossCents += s.customerPaidCents;
      r.commissionHtCents += s.platform.commissionHtCents;
      r.orders += 1;
      byRestaurant.set(f.restaurantId, r);
      const m = byMethod.get(s.payment.method) ?? { amountCents: 0, count: 0 };
      m.amountCents += s.customerPaidCents;
      m.count += 1;
      byMethod.set(s.payment.method, m);
    }
  }
  for (const doc of refundSnap.docs) {
    const r = doc.data() as Refund;
    if (!inScope(r, scope.countryId, scope.cityIds) || !['processed', 'approved'].includes(r.status)) continue;
    totals.refundsCents += r.amountCents;
    totals.refundsRestaurantCents += r.allocation.restaurantCents;
    totals.refundsPlatformCents += r.allocation.platformCents;
    point(parisDay(r.requestedAt.toDate())).refundsCents += r.amountCents;
  }
  for (const doc of invoiceSnap.docs) {
    const inv = doc.data() as Invoice;
    if (!inScope(inv, scope.countryId, scope.cityIds) || inv.issuer.type !== 'platform') continue;
    const day = parisDay(inv.issuedAt.toDate());
    const sign = inv.kind === 'credit_note' ? -1 : 1;
    for (const raw of inv.lines) {
      const line = { ...raw, htCents: sign * Math.abs(raw.htCents) };
      const label = line.label.toLowerCase();
      if (inv.kind === 'subscription_invoice' || label.startsWith('abonnement') || label.startsWith('offre spéciale')) {
        totals.subscriptionsHtCents += line.htCents;
        totals.marginCents += line.htCents;
        point(day).netRevenueCents += line.htCents;
        point(day).marginCents += line.htCents;
      } else if (inv.kind === 'sponsored_invoice' || label.startsWith('mise en avant')) {
        totals.sponsoredHtCents += line.htCents;
        totals.marginCents += line.htCents;
        point(day).netRevenueCents += line.htCents;
        point(day).marginCents += line.htCents;
      }
    }
  }
  totals.netRevenueCents = totals.commissionHtCents + totals.customerFeesHtCents + totals.subscriptionsHtCents + totals.sponsoredHtCents;
  return { totals, daily, byRestaurant, byMethod };
}

export const getFinanceOverview = argentCallable(
  z.object({
    from: z.string().regex(zDay),
    to: z.string().regex(zDay),
    countryId: z.string().length(2).nullish(),
    cityIds: z.array(z.string().min(1).max(64)).max(30).nullish(),
  }),
  async (data, request): Promise<FinanceOverview> => {
    const { admin } = await requireAdmin(request, 'finance.view');
    if (data.from > data.to) throw fail.invalid('La date de début doit précéder la date de fin.');
    const length = daysBetween(data.from, data.to);
    if (length > 400) throw fail.invalid('Choisissez une période de 400 jours au plus.');
    const scope: Scope = { countryId: scopeCountry(admin, data.countryId), cityIds: scopeCities(admin, data.cityIds) };
    const prevTo = addDays(data.from, -1);
    const prevFrom = addDays(prevTo, -(length - 1));
    const [current, previous] = await Promise.all([collectPeriod(data.from, data.to, scope, true), collectPeriod(prevFrom, prevTo, scope, false)]);

    const daily: FinanceDailyPoint[] = [];
    for (let day = data.from; day <= data.to; day = addDays(day, 1)) {
      daily.push(current.daily.get(day) ?? { day, ordersCount: 0, grossCents: 0, netRevenueCents: 0, marginCents: 0, refundsCents: 0 });
    }

    // Soldes : reversements non versés et espèces détenues.
    const [openPayouts, cashSnap, redemptionSnap] = await Promise.all([
      db.collection(COLLECTIONS.payouts).where('status', 'in', ['scheduled', 'processing', 'failed', 'on_hold']).limit(2000).get(),
      db.collection(COLLECTIONS.driverPrivate).where('cashBalanceCents', '>', 0).limit(2000).get(),
      db.collection(COLLECTIONS.promotionRedemptions).where('createdAt', '>=', Timestamp.fromDate(rangeBounds(data.from, data.to).start)).where('createdAt', '<', Timestamp.fromDate(rangeBounds(data.from, data.to).end)).get(),
    ]);
    const balances: FinanceOverview['balances'] = { restaurantsPendingCents: 0, driversPendingCents: 0, onHoldCents: 0, failedCents: 0, driverCashHeldCents: 0, scheduledCount: 0, failedCount: 0, onHoldCount: 0 };
    for (const doc of openPayouts.docs) {
      const p = doc.data() as Payout;
      if (!inScope(p, scope.countryId, scope.cityIds)) continue;
      if (p.status === 'on_hold') {
        balances.onHoldCents += p.netCents;
        balances.onHoldCount += 1;
      } else if (p.status === 'failed') {
        balances.failedCents += p.netCents;
        balances.failedCount += 1;
      } else {
        balances.scheduledCount += 1;
        if (p.beneficiaryType === 'restaurant') balances.restaurantsPendingCents += p.netCents;
        else balances.driversPendingCents += p.netCents;
      }
    }
    const driverScope = scope.cityIds || scope.countryId ? new Map((await db.collection(COLLECTIONS.drivers).select('cityId', 'countryId').get()).docs.map((d) => [d.id, d.data() as { cityId?: string; countryId?: string }])) : null;
    for (const doc of cashSnap.docs) {
      if (driverScope && !inScope(driverScope.get(doc.id) ?? {}, scope.countryId, scope.cityIds)) continue;
      balances.driverCashHeldCents += (doc.data() as DriverPrivate).cashBalanceCents;
    }

    // Coût des promotions, par offre et par financeur.
    const byPromo = new Map<string, { uses: number; platformCents: number; restaurantCents: number }>();
    for (const doc of redemptionSnap.docs) {
      const r = doc.data() as PromotionRedemption;
      if (r.status === 'reversed' || (scope.cityIds && !scope.cityIds.includes(r.cityId))) continue;
      const bucket = byPromo.get(r.promotionId) ?? { uses: 0, platformCents: 0, restaurantCents: 0 };
      bucket.uses += 1;
      bucket.platformCents += r.platformFundedCents;
      bucket.restaurantCents += r.restaurantFundedCents;
      byPromo.set(r.promotionId, bucket);
    }
    const promotions: FinanceOverview['promotions'] = [];
    for (const part of chunk([...byPromo.keys()], 100)) {
      const snaps = await db.getAll(...part.map((id) => db.collection(COLLECTIONS.promotions).doc(id)));
      for (const snap of snaps) {
        const promo = snap.exists ? (snap.data() as Promotion) : null;
        const bucket = byPromo.get(snap.id);
        if (!bucket) continue;
        promotions.push({ promotionId: snap.id, name: promo?.title?.fr ?? promo?.code ?? snap.id, funding: promo?.funding ?? 'platform', ...bucket });
      }
    }
    promotions.sort((a, b) => b.platformCents + b.restaurantCents - (a.platformCents + a.restaurantCents));

    const top = [...current.byRestaurant.entries()].sort((a, b) => b[1].grossCents - a[1].grossCents).slice(0, 8);
    const names = top.length ? await db.getAll(...top.map(([id]) => db.collection(COLLECTIONS.restaurants).doc(id)), { fieldMask: ['name'] }) : [];
    const topRestaurants = top.map(([id, v], i) => ({ restaurantId: id, name: (names[i]?.get('name') as string | undefined) ?? id, ...v }));

    return {
      totals: current.totals,
      previous: previous.totals,
      daily,
      balances,
      promotions,
      topRestaurants,
      byMethod: [...current.byMethod.entries()].map(([method, v]) => ({ method, ...v })).sort((a, b) => b.amountCents - a.amountCents),
      generatedAt: new Date().toISOString(),
    };
  },
  { memory: '512MiB', timeoutSeconds: 120 },
);
