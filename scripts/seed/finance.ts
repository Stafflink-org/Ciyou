// Argent : reversements hebdomadaires (restaurants, livreurs), factures de
// commission et d'abonnement, relevés livreurs (autofacturation), blocages,
// paiements d'abonnement et exports fiscaux.
import {
  COLLECTIONS,
  DEFAULT_PLANS,
  DEFAULT_PRICING_BY_COUNTRY,
  formatInvoiceNumber,
  vatOnHt,
  type Invoice,
  type InvoiceLine,
  type InvoiceParty,
  type Payment,
  type Payout,
  type PayoutHold,
  type TaxReport,
} from '@golink/shared';
import { CITIES } from './catalog';
import { tracked, type SeedContext } from './context';
import { addDays, parisDay, parisTime, ts, weekday } from './lib';
import type { SeededOrder } from './orders';
import type { DriverRuntime } from './people';
import type { RestaurantRuntime } from './restaurants';

const PLATFORM_PARTY: Record<'FR' | 'LU', InvoiceParty> = {
  FR: { type: 'platform', id: 'golink-fr', name: 'GoLink SAS', address: '4 Place Darche, 54400 Longwy', vatNumber: 'FR 12 912 345 678', registrationNumber: 'RCS Briey 912 345 678', email: 'facturation@golink.fr' },
  LU: { type: 'platform', id: 'golink-lu', name: 'GoLink Luxembourg SARL', address: '12 Rue du Fossé, L-1536 Luxembourg', vatNumber: 'LU 34567890', registrationNumber: 'RCS Luxembourg B 281 234', email: 'facturation@golink.lu' },
};

function line(label: string, quantity: number, unitHtCents: number, vatRateBps: number): InvoiceLine {
  const htCents = unitHtCents * quantity;
  const vatCents = vatOnHt(htCents, vatRateBps);
  return { label, quantity, unitHtCents, vatRateBps, htCents, vatCents, ttcCents: htCents + vatCents };
}

function totals(lines: InvoiceLine[]) {
  const byRate = new Map<number, { rateBps: number; htCents: number; vatCents: number }>();
  for (const l of lines) {
    const t = byRate.get(l.vatRateBps) ?? { rateBps: l.vatRateBps, htCents: 0, vatCents: 0 };
    t.htCents += l.htCents;
    t.vatCents += l.vatCents;
    byRate.set(l.vatRateBps, t);
  }
  const vatSummary = [...byRate.values()];
  const totalHtCents = vatSummary.reduce((s, t) => s + t.htCents, 0);
  const totalVatCents = vatSummary.reduce((s, t) => s + t.vatCents, 0);
  return { vatSummary, totalHtCents, totalVatCents, totalTtcCents: totalHtCents + totalVatCents };
}

export function seedFinance(ctx: SeedContext, orders: SeededOrder[], restaurants: RestaurantRuntime[], drivers: DriverRuntime[]): Record<string, { prefix: string; value: number }> {
  const { w, nowTs } = ctx;
  const thisMonday = addDays(ctx.today, -weekday(ctx.today));
  const delivered = orders.filter((o) => o.status === 'delivered' && o.settlement && o.deliveredAt);
  const counters: Record<string, { prefix: string; value: number }> = {};
  const nextNumber = (series: string, year: number) => {
    const c = (counters[`invoice_${series}`] ??= { prefix: series, value: 0 });
    c.value += 1;
    return formatInvoiceNumber(series, year, c.value);
  };

  // ------------------------------------------------------------ Reversements restaurants
  const byRestaurantWeek = new Map<string, SeededOrder[]>();
  for (const o of delivered) {
    const day = parisDay(o.deliveredAt as Date);
    const key = `${o.restaurantId}|${addDays(day, -weekday(day))}`;
    byRestaurantWeek.set(key, [...(byRestaurantWeek.get(key) ?? []), o]);
  }
  for (const [key, list] of byRestaurantWeek) {
    const [rid = '', weekStart = ''] = key.split('|');
    const r = restaurants.find((x) => x.seed.id === rid);
    if (!r) continue;
    const current = weekStart >= thisMonday;
    const gross = list.reduce((s, o) => s + (o.settlement?.restaurant.grossCents ?? 0) - (o.settlement?.restaurant.discountFundedCents ?? 0) + (o.settlement?.restaurant.deliveryFeeCents ?? 0), 0);
    const commission = list.reduce((s, o) => s + (o.settlement?.restaurant.commissionTtcCents ?? 0), 0);
    const refunds = list.reduce((s, o) => s + o.restaurantChargeCents, 0);
    const net = gross - commission - refunds;
    const payDay = addDays(weekStart, 9);
    const failed = rid === 'beldi-bowls' && weekStart === addDays(thisMonday, -7);
    const onHold = rid === 'casa-arepa' && current;
    const payout: Payout = {
      countryId: r.countryId,
      cityId: r.seed.cityId,
      beneficiaryType: 'restaurant',
      beneficiaryId: rid,
      beneficiaryName: r.seed.name,
      periodStart: weekStart,
      periodEnd: addDays(weekStart, 6),
      grossCents: gross,
      commissionCents: commission,
      refundsChargedCents: refunds,
      adjustmentsCents: 0,
      tipsCents: 0,
      cashDeductedCents: 0,
      netCents: net,
      entriesCount: list.length * 2,
      status: onHold ? 'on_hold' : current ? 'scheduled' : failed ? 'failed' : payDay > ctx.today ? 'processing' : 'paid',
      scheduledFor: ts(parisTime(payDay, 9 * 60)),
      paidAt: !current && !failed && payDay <= ctx.today ? ts(parisTime(payDay, 10 * 60)) : null,
      providerTransferId: !current && !failed ? `tr_seed_${rid}_${weekStart.replace(/-/g, '')}` : null,
      failureReason: failed ? 'Coordonnées bancaires refusées par la banque (compte clôturé).' : null,
      holdId: onHold ? 'blocage-casa-arepa' : null,
      statementInvoiceId: null,
      createdAt: ts(parisTime(addDays(weekStart, 7), 2 * 60)),
      updatedAt: nowTs,
    };
    w.set(w.doc(`${COLLECTIONS.payouts}/po-r-${rid}-${weekStart}`), payout);
  }
  const hold: PayoutHold = {
    beneficiaryType: 'restaurant',
    beneficiaryId: 'casa-arepa',
    reason: 'missing_document',
    details: 'Attestation de formation hygiène expirée : reversements suspendus jusqu’au dépôt du nouveau document.',
    active: true,
    releasedAt: null,
    releasedBy: null,
    ...tracked(ts(parisTime(addDays(ctx.today, -6), 9 * 60)), 'system'),
  };
  w.set(w.doc(`${COLLECTIONS.payoutHolds}/blocage-casa-arepa`), hold);

  // ------------------------------------------------------------ Reversements livreurs
  const byDriverWeek = new Map<string, SeededOrder[]>();
  for (const o of delivered) {
    if (!o.driverId || !o.settlement?.courier) continue;
    const day = parisDay(o.deliveredAt as Date);
    const key = `${o.driverId}|${addDays(day, -weekday(day))}`;
    byDriverWeek.set(key, [...(byDriverWeek.get(key) ?? []), o]);
  }
  for (const [key, list] of byDriverWeek) {
    const [uid = '', weekStart = ''] = key.split('|');
    const d = drivers.find((x) => x.uid === uid);
    if (!d) continue;
    const current = weekStart >= thisMonday;
    const earnings = list.reduce((s, o) => s + (o.settlement?.courier?.earningsCents ?? 0), 0);
    const tips = list.reduce((s, o) => s + (o.settlement?.courier?.tipCents ?? 0), 0);
    const cash = list.filter((o) => o.paymentMethod === 'cash').reduce((s, o) => s + o.totalCents, 0);
    const payDay = addDays(weekStart, 8);
    const payout: Payout = {
      countryId: d.countryId,
      cityId: d.cityId,
      beneficiaryType: 'driver',
      beneficiaryId: uid,
      beneficiaryName: `${d.firstName} ${d.lastName}`,
      periodStart: weekStart,
      periodEnd: addDays(weekStart, 6),
      grossCents: earnings,
      commissionCents: 0,
      refundsChargedCents: 0,
      adjustmentsCents: 0,
      tipsCents: tips,
      cashDeductedCents: cash,
      netCents: earnings + tips - cash,
      entriesCount: list.length,
      status: current ? 'scheduled' : payDay > ctx.today ? 'processing' : 'paid',
      scheduledFor: ts(parisTime(payDay, 9 * 60)),
      paidAt: !current && payDay <= ctx.today ? ts(parisTime(payDay, 10 * 60)) : null,
      providerTransferId: !current ? `tr_seed_${uid}_${weekStart.replace(/-/g, '')}` : null,
      failureReason: null,
      holdId: null,
      statementInvoiceId: null,
      createdAt: ts(parisTime(addDays(weekStart, 7), 2 * 60)),
      updatedAt: nowTs,
    };
    w.set(w.doc(`${COLLECTIONS.payouts}/po-d-${uid}-${weekStart}`), payout);
  }

  // ------------------------------------------------------------ Factures mensuelles
  const months = [...new Set(delivered.map((o) => parisDay(o.deliveredAt as Date).slice(0, 7)))].sort();
  const currentMonth = ctx.today.slice(0, 7);
  for (const month of months) {
    if (month >= currentMonth) continue;
    const year = Number(month.slice(0, 4));
    const monthEnd = new Date(Date.UTC(year, Number(month.slice(5)), 0)).toISOString().slice(0, 10);
    const issuedAt = parisTime(addDays(monthEnd, 2), 6 * 60);
    for (const r of restaurants.filter((x) => x.seed.status !== 'onboarding')) {
      const list = delivered.filter((o) => o.restaurantId === r.seed.id && parisDay(o.deliveredAt as Date).startsWith(month));
      if (!list.length) continue;
      const vat = DEFAULT_PRICING_BY_COUNTRY[r.countryId]?.vat.standardBps ?? 2000;
      const commissionHt = list.reduce((s, o) => s + (o.settlement?.restaurant.commissionHtCents ?? 0), 0);
      const lines = [line(`Commission sur ${list.length} commandes (${month})`, 1, commissionHt, vat)];
      const series = `${r.countryId}-COM`;
      const recipient: InvoiceParty = { type: 'restaurant', id: r.seed.id, name: r.seed.name, address: `${r.seed.address.line1}, ${r.seed.address.postalCode} ${r.seed.address.city}`, vatNumber: null, registrationNumber: null, email: `contact@${r.seed.id}.test` };
      const invoice: Invoice = {
        countryId: r.countryId,
        cityId: r.seed.cityId,
        number: nextNumber(series, year),
        series,
        kind: 'commission_invoice',
        status: 'paid',
        issuer: PLATFORM_PARTY[r.countryId],
        recipient,
        selfBilling: false,
        lines,
        ...totals(lines),
        currency: 'EUR',
        periodStart: `${month}-01`,
        periodEnd: monthEnd,
        orderId: null,
        payoutId: null,
        subscriptionId: null,
        creditedInvoiceId: null,
        creditNoteIds: [],
        pdf: null,
        issuedAt: ts(issuedAt),
        dueAt: ts(issuedAt),
        paidAt: ts(issuedAt),
        legalMentions: ['Commission prélevée sur les reversements.', 'TVA acquittée sur les débits.'],
        retainUntil: `${year + 10}-12-31`,
      };
      w.set(w.doc(`${COLLECTIONS.invoices}/com-${r.seed.id}-${month}`), invoice);

      const plan = DEFAULT_PLANS.find((p) => p.code === r.seed.plan);
      if (plan && plan.monthlyPriceHtCents > 0) {
        const subLines = [line(`Abonnement ${plan.name} (${month})`, 1, plan.monthlyPriceHtCents, vat)];
        const subSeries = `${r.countryId}-ABO`;
        const unpaid = r.seed.id === 'beldi-bowls' && month === months.filter((m) => m < currentMonth).pop();
        const subInvoice: Invoice = {
          ...invoice,
          number: nextNumber(subSeries, year),
          series: subSeries,
          kind: 'subscription_invoice',
          status: unpaid ? 'overdue' : 'paid',
          lines: subLines,
          ...totals(subLines),
          subscriptionId: `sub-${r.seed.id}`,
          paidAt: unpaid ? null : ts(issuedAt),
          dueAt: ts(parisTime(addDays(monthEnd, 10), 0)),
          legalMentions: ['Paiement par prélèvement à réception.'],
        };
        w.set(w.doc(`${COLLECTIONS.invoices}/abo-${r.seed.id}-${month}`), subInvoice);
        const payment: Payment = {
          countryId: r.countryId,
          cityId: r.seed.cityId,
          purpose: 'subscription',
          orderId: null,
          subscriptionId: `sub-${r.seed.id}`,
          invoiceId: `abo-${r.seed.id}-${month}`,
          payerType: 'restaurant',
          payerId: r.seed.id,
          restaurantId: r.seed.id,
          method: 'card',
          amountCents: subInvoice.totalTtcCents,
          currency: 'EUR',
          status: unpaid ? 'failed' : 'paid',
          provider: 'stripe',
          providerIntentId: `pi_seed_abo_${r.seed.id}_${month.replace('-', '')}`,
          providerChargeId: null,
          cardFingerprint: null,
          cardLabel: 'Visa ···· 4242',
          feeCents: 0,
          failureCode: unpaid ? 'card_declined' : null,
          failureMessage: unpaid ? 'Carte refusée par la banque émettrice.' : null,
          attempts: unpaid ? 2 : 1,
          refundedCents: 0,
          createdAt: ts(issuedAt),
          updatedAt: ts(issuedAt),
        };
        w.set(w.doc(`${COLLECTIONS.payments}/abo-${r.seed.id}-${month}`), payment);
      }
    }

    // Relevés livreurs (autofacturation, TVA non applicable).
    for (const d of drivers.filter((x) => x.type === 'platform')) {
      const list = delivered.filter((o) => o.driverId === d.uid && parisDay(o.deliveredAt as Date).startsWith(month));
      if (!list.length) continue;
      const earnings = list.reduce((s, o) => s + (o.settlement?.courier?.earningsCents ?? 0), 0);
      const tips = list.reduce((s, o) => s + (o.settlement?.courier?.tipCents ?? 0), 0);
      const lines = [line(`Prestations de livraison : ${list.length} courses`, 1, earnings, 0), line('Pourboires reversés', 1, tips, 0)];
      const series = `${d.countryId}-LIV`;
      const statement: Invoice = {
        countryId: d.countryId,
        cityId: d.cityId,
        number: nextNumber(series, year),
        series,
        kind: 'driver_statement',
        status: 'paid',
        issuer: { type: 'driver', id: d.uid, name: `${d.firstName} ${d.lastName}`, address: CITIES.find((c) => c.id === d.cityId)?.name ?? '', vatNumber: null, registrationNumber: null, email: d.email },
        recipient: PLATFORM_PARTY[d.countryId],
        selfBilling: true,
        lines,
        ...totals(lines),
        currency: 'EUR',
        periodStart: `${month}-01`,
        periodEnd: monthEnd,
        orderId: null,
        payoutId: null,
        subscriptionId: null,
        creditedInvoiceId: null,
        creditNoteIds: [],
        pdf: null,
        issuedAt: ts(issuedAt),
        dueAt: null,
        paidAt: ts(issuedAt),
        legalMentions: ['Autofacturation : facture émise par GoLink au nom et pour le compte du prestataire.', 'TVA non applicable, article 293 B du CGI.'],
        retainUntil: `${year + 10}-12-31`,
      };
      w.set(w.doc(`${COLLECTIONS.invoices}/liv-${d.uid}-${month}`), statement);
    }
  }

  // ------------------------------------------------------------ Déclarations
  const reports: Array<TaxReport & { id: string }> = months
    .filter((m) => m < currentMonth)
    .map((month) => ({
      id: `tva-fr-${month}`,
      type: 'vat',
      countryId: 'FR',
      period: month,
      status: 'ready',
      sellersCount: null,
      totals: (() => {
        const list = delivered.filter((o) => o.countryId === 'FR' && parisDay(o.deliveredAt as Date).startsWith(month));
        return {
          grossCents: list.reduce((s, o) => s + o.totalCents, 0),
          feesCents: list.reduce((s, o) => s + (o.settlement?.platform.commissionHtCents ?? 0), 0),
          vatCents: list.reduce((s, o) => s + (o.settlement?.platform.vatDueCents ?? 0), 0),
        };
      })(),
      file: null,
      submittedAt: null,
      submissionReference: null,
      error: null,
      ...tracked(nowTs, 'system'),
    }));
  reports.push({
    id: `dac7-fr-${ctx.today.slice(0, 4)}`,
    type: 'dac7',
    countryId: 'FR',
    period: ctx.today.slice(0, 4),
    status: 'draft',
    sellersCount: restaurants.filter((r) => r.countryId === 'FR' && r.seed.status !== 'onboarding').length + drivers.filter((d) => d.countryId === 'FR').length,
    totals: null,
    file: null,
    submittedAt: null,
    submissionReference: null,
    error: null,
    ...tracked(nowTs, 'system'),
  });
  for (const { id, ...report } of reports) w.set(w.doc(`${COLLECTIONS.taxReports}/${id}`), report);

  return counters;
}
