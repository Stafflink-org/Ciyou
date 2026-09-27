// Comptabilisation des commandes et des remboursements.
// - À la livraison (ou à la clôture « client absent »), la répartition définitive est
//   calculée par le moteur partagé et enregistrée (orderFinancials), puis les
//   mouvements du grand livre sont écrits (commerce, livreur, espèces) et le
//   justificatif client est émis. Identifiants déterministes : rejouable sans doublon.
// - À l'exécution d'un remboursement, la part imputée (règles d'imputation, décision
//   client : le commerce) est déduite de son prochain reversement et un avoir est émis
//   sur le justificatif de la commande.
import {
  COLLECTIONS,
  INVOICE_SERIES_CODES,
  allocateProRata,
  computeSettlement,
  htFromTtc,
  mergePricing,
  DEFAULT_PRICING_BY_COUNTRY,
  type City,
  type Country,
  type DriverEarning,
  type Invoice,
  type InvoiceLine,
  type LedgerEntry,
  type Order,
  type OrderFinancials,
  type Quote,
  type Refund,
  type Settlement,
} from '@golink/shared';
import { logger } from 'firebase-functions/v2';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import type { DocumentReference } from 'firebase-admin/firestore';
import { db, FieldValue, Timestamp } from '../../lib/admin';
import { actorFromCaller, writeAudit } from '../../lib/audit';
import { currencyOfCountry, defaultCurrency } from '../../lib/currency';
import { fail } from '../../lib/errors';
import { requireAdmin } from '../../lib/permissions';
import { z, zId } from '../../lib/validation';
import {
  invoiceTotals,
  loadCountry,
  nextInvoiceNumber,
  parisDay,
  platformParty,
  restaurantParty,
  retainUntil,
  seriesPrefix,
} from './common';
import { hasPendingCompensation, settleSubscriptionDebts } from './billing';
import { trackMerchantCash } from './cash';
import { ARGENT_RUNTIME, argentCallable } from './runtime';

const SETTLED_STATUSES = new Set(['delivered']);

function isSettled(order: Order | undefined): boolean {
  if (!order) return false;
  return SETTLED_STATUSES.has(order.status) || order.closedAs === 'customer_absent';
}

/** Devis faisant foi reconstitué à partir des montants enregistrés sur la commande. */
function quoteFromOrder(order: Order): Quote {
  const a = order.amounts;
  return {
    ok: true,
    issues: [],
    fulfillment: order.fulfillment,
    deliveredBy: order.delivery?.deliveredBy ?? 'platform',
    itemsCount: order.itemsCount,
    subtotalCents: a.subtotalCents,
    serviceFeeCents: a.serviceFeeCents,
    smallOrderFeeCents: a.smallOrderFeeCents,
    deliveryFeeCents: a.deliveryFeeCents,
    surgeFeeCents: a.surgeFeeCents,
    discount: a.discount,
    tipCents: a.tipCents,
    totalCents: a.totalCents,
    itemsVat: a.itemsVat,
    subtotalByCategory: {},
  };
}

async function pricingFor(order: Order) {
  const [countrySnap, citySnap] = await Promise.all([
    db.collection(COLLECTIONS.countries).doc(order.countryId).get(),
    db.collection(COLLECTIONS.cities).doc(order.cityId).get(),
  ]);
  const country = countrySnap.exists ? (countrySnap.data() as Country) : null;
  const city = citySnap.exists ? (citySnap.data() as City) : null;
  const base = country?.pricing ?? DEFAULT_PRICING_BY_COUNTRY[order.countryId] ?? DEFAULT_PRICING_BY_COUNTRY.FR;
  if (!base) throw new Error(`Configuration tarifaire absente pour ${order.countryId}`);
  return { config: mergePricing(base, city?.pricing ?? null), country };
}

/** Répartition définitive d'une commande livrée. */
async function settlementOf(order: Order): Promise<{ settlement: Settlement; country: Country | null; durationMinutes: number }> {
  const { config, country } = await pricingFor(order);
  const delivered = order.timeline.delivered ?? order.updatedAt;
  const pickedUp = order.timeline.picked_up ?? null;
  const durationMinutes = pickedUp ? Math.max(5, Math.round((delivered.toMillis() - pickedUp.toMillis()) / 60_000)) : 15;
  const settlement = computeSettlement(
    {
      quote: quoteFromOrder(order),
      paymentMethod: order.payment.method,
      commissionBps: order.commission?.bps ?? order.restaurantSettlement?.commissionBps ?? 0,
      courier: order.fulfillment === 'delivery' && order.delivery?.deliveredBy === 'platform'
        ? { distanceMeters: order.delivery.distanceMeters ?? 0, durationMinutes, isPeak: order.delivery.courierIsPeak === true }
        : undefined,
      // Bonus heure de pointe promis au livreur à la commande (décision client) : réappliqué tel quel.
      surgeCourierBonusCents: order.delivery?.courierSurgeBonusCents ?? undefined,
      walletAppliedCents: order.amounts.walletAppliedCents ?? 0,
    },
    config,
  );
  // La part du commerce annoncée à la commande fait foi (même taux, mêmes remises).
  if (order.restaurantSettlement) settlement.restaurant = { ...settlement.restaurant, ...order.restaurantSettlement };
  return { settlement, country, durationMinutes };
}

function ledgerRef(id: string): DocumentReference {
  return db.collection(COLLECTIONS.ledgerEntries).doc(id);
}

type EntryInput = Omit<LedgerEntry, 'currency' | 'bookingDate' | 'createdAt' | 'createdBy' | 'countryId' | 'cityId'>;

async function settleOrder(orderId: string, order: Order): Promise<'created' | 'exists'> {
  const finRef = db.collection(COLLECTIONS.orderFinancials).doc(orderId);
  const { settlement, country, durationMinutes } = await settlementOf(order);
  const deliveredAt = order.timeline.delivered ?? order.updatedAt;
  const bookingDate = parisDay(deliveredAt.toDate());
  const test = (order as Order & { test?: boolean }).test === true;

  const created = await db.runTransaction(async (tx) => {
    const existing = await tx.get(finRef);
    if (existing.exists) return false;
    const r = settlement.restaurant;
    const entries: Array<[string, EntryInput]> = [];
    const merchantDelivers = order.fulfillment === 'delivery' && order.delivery?.deliveredBy === 'restaurant';
    entries.push([`${orderId}-ca`, { accountType: 'restaurant', accountId: order.restaurantId, type: 'order_revenue', amountCents: r.grossCents - r.discountFundedCents, vatCents: null, orderId, payoutId: null, description: `Ventes ${order.number}` }]);
    if (r.deliveryFeeCents > 0) entries.push([`${orderId}-fl`, { accountType: 'restaurant', accountId: order.restaurantId, type: 'delivery_fee', amountCents: r.deliveryFeeCents, vatCents: null, orderId, payoutId: null, description: `Frais de livraison ${order.number}` }]);
    if ((r.tipCents ?? 0) > 0) entries.push([`${orderId}-pbr`, { accountType: 'restaurant', accountId: order.restaurantId, type: 'courier_tip', amountCents: r.tipCents ?? 0, vatCents: null, orderId, payoutId: null, description: `Pourboire pour votre livreur ${order.number}` }]);
    if (r.commissionTtcCents > 0) entries.push([`${orderId}-com`, { accountType: 'restaurant', accountId: order.restaurantId, type: 'commission', amountCents: -r.commissionTtcCents, vatCents: r.commissionVatCents, orderId, payoutId: null, description: `Commission ${order.number}` }]);
    if (r.paymentFeeCents > 0) entries.push([`${orderId}-fp`, { accountType: 'restaurant', accountId: order.restaurantId, type: 'payment_fee', amountCents: -r.paymentFeeCents, vatCents: null, orderId, payoutId: null, description: `Frais de paiement ${order.number}` }]);
    // Espèces encaissées par le livreur salarié du commerce : l'argent est déjà chez le commerce.
    if (settlement.payment.cashCollectedCents > 0 && merchantDelivers) {
      entries.push([`${orderId}-espr`, { accountType: 'restaurant', accountId: order.restaurantId, type: 'cash_collected', amountCents: -settlement.payment.cashCollectedCents, vatCents: null, orderId, payoutId: null, description: `Espèces encaissées par votre livreur ${order.number}` }]);
    }
    const driverId = order.driverId ?? order.delivery?.driverId ?? null;
    if (settlement.courier && driverId) {
      entries.push([`${orderId}-liv`, { accountType: 'driver', accountId: driverId, type: 'courier_earning', amountCents: settlement.courier.earningsCents, vatCents: null, orderId, payoutId: null, description: `Course ${order.number}` }]);
      if (settlement.courier.tipCents > 0) entries.push([`${orderId}-pb`, { accountType: 'driver', accountId: driverId, type: 'courier_tip', amountCents: settlement.courier.tipCents, vatCents: null, orderId, payoutId: null, description: `Pourboire ${order.number}` }]);
      if (settlement.payment.cashCollectedCents > 0) {
        entries.push([`${orderId}-esp`, { accountType: 'driver_cash', accountId: driverId, type: 'cash_collected', amountCents: -settlement.payment.cashCollectedCents, vatCents: null, orderId, payoutId: null, description: `Espèces encaissées ${order.number}` }]);
      }
    }

    const financials: OrderFinancials = {
      orderId,
      orderNumber: order.number,
      countryId: order.countryId,
      cityId: order.cityId,
      restaurantId: order.restaurantId,
      driverId,
      commissionBps: r.commissionBps,
      commissionSource: order.commission?.source ?? 'market',
      settlement,
      refunds: [],
      finalMarginCents: settlement.platform.marginCents,
      restaurantPayoutId: null,
      driverPayoutId: null,
      deliveredAt,
      computedAt: Timestamp.now(),
    };
    tx.create(finRef, { ...financials, ...(test ? { test: true } : {}) });
    // Client absent : les règles de la ville peuvent priver le livreur ou le commerce de son règlement (par défaut, les deux sont payés).
    const absence = order.closedAs === 'customer_absent' ? order.customerAbsence : null;
    const notPaid = (accountType: string) => Boolean(absence) && ((accountType === 'restaurant' && absence?.payRestaurant === false) || ((accountType === 'driver' || accountType === 'driver_cash') && absence?.payDriver === false));
    for (const [id, entry] of entries) {
      if (notPaid(entry.accountType)) continue;
      const doc: LedgerEntry = { ...entry, currency: country?.currency ?? defaultCurrency(order.countryId), bookingDate, countryId: order.countryId, cityId: order.cityId, createdAt: deliveredAt, createdBy: 'system' };
      tx.set(ledgerRef(id), { ...doc, ...(test ? { test: true } : {}) });
    }
    // Gains du livreur (§6) : alimente l'écran « Gains » (courses, pourboires, bonus de pointe).
    if (settlement.courier && driverId && !notPaid('driver')) {
      const earning: DriverEarning = {
        driverId,
        cityId: order.cityId,
        kind: 'delivery',
        orderId,
        breakdown: settlement.courier,
        amountCents: settlement.courier.earningsCents,
        tipCents: settlement.courier.tipCents,
        distanceMeters: order.delivery?.distanceMeters ?? null,
        durationMinutes,
        payoutId: null,
        earnedAt: deliveredAt,
        note: null,
      };
      tx.set(db.collection(COLLECTIONS.driverEarnings).doc(orderId), { ...earning, ...(test ? { test: true } : {}) });
    }
    return true;
  });
  if (!created) return 'exists';
  // De nouvelles ventes peuvent couvrir une retenue d'abonnement en attente : compensation et rétablissement.
  if (await hasPendingCompensation(order.restaurantId)) await settleSubscriptionDebts(order.restaurantId).catch((error) => logger.error('Compensation d’abonnement en échec', { restaurantId: order.restaurantId, error: String(error) }));
  await issueReceipt(orderId, order, country).catch((error) => logger.error('Justificatif client non émis', { orderId, error: String(error) }));
  // Remboursements partiels déjà exécutés avant la livraison : leur part imputée est maintenant retenue.
  const early = await db.collection(COLLECTIONS.refunds).where('orderId', '==', orderId).where('status', '==', 'processed').get();
  for (const doc of early.docs) await bookRefund(doc.id, doc.data() as Refund);
  return 'created';
}

// ------------------------------------------------------------------ Justificatif client

/**
 * Justificatif d'une commande : facture émise par GoLink au nom et pour le compte du
 * commerce (articles, par taux de TVA) et facture des frais de GoLink au client.
 */
export async function issueReceipt(orderId: string, order: Order, countryHint?: Country | null): Promise<string> {
  const invoiceRef = db.collection(COLLECTIONS.invoices).doc(`rec-${orderId}`);
  const existing = await invoiceRef.get();
  if (existing.exists) return invoiceRef.id;
  const country = countryHint ?? (await loadCountry(order.countryId));
  const standard = country?.pricing?.vat?.standardBps ?? DEFAULT_PRICING_BY_COUNTRY[order.countryId]?.vat.standardBps ?? 2000;
  const { party: seller } = await restaurantParty(order.restaurantId);
  const a = order.amounts;
  const lines: InvoiceLine[] = [];
  for (const vat of a.itemsVat ?? []) {
    if (vat.ttcCents <= 0) continue;
    lines.push({ label: `Articles ${order.number} (${vat.category === 'platform_fees' ? 'frais' : 'vendus par le commerce'})`, quantity: 1, unitHtCents: vat.htCents, vatRateBps: vat.rateBps, htCents: vat.htCents, vatCents: vat.vatCents, ttcCents: vat.ttcCents });
  }
  if (lines.length === 0 && a.subtotalCents > 0) {
    const rate = country?.pricing?.vat?.byCategory?.food ?? 1000;
    const ht = htFromTtc(a.subtotalCents - a.discount.restaurantOnItemsCents, rate);
    lines.push({ label: `Articles ${order.number}`, quantity: 1, unitHtCents: ht, vatRateBps: rate, htCents: ht, vatCents: a.subtotalCents - a.discount.restaurantOnItemsCents - ht, ttcCents: a.subtotalCents - a.discount.restaurantOnItemsCents });
  }
  const fee = (label: string, ttc: number) => {
    if (ttc <= 0) return;
    const ht = htFromTtc(ttc, standard);
    lines.push({ label, quantity: 1, unitHtCents: ht, vatRateBps: standard, htCents: ht, vatCents: ttc - ht, ttcCents: ttc });
  };
  const platformDelivers = order.fulfillment === 'delivery' && order.delivery?.deliveredBy === 'platform';
  fee('Frais de service GoLink', a.serviceFeeCents);
  fee('Frais de petite commande', a.smallOrderFeeCents);
  fee(platformDelivers ? 'Livraison GoLink' : 'Livraison par le commerce', Math.max(0, a.deliveryFeeCents - (a.discount.onDeliveryCents ?? 0)));
  if (a.tipCents > 0) lines.push({ label: 'Pourboire (reversé intégralement au livreur, hors TVA)', quantity: 1, unitHtCents: a.tipCents, vatRateBps: 0, htCents: a.tipCents, vatCents: 0, ttcCents: a.tipCents });

  const totals = invoiceTotals(lines);
  const issuedAt = order.timeline.delivered ?? Timestamp.now();
  const year = Number(parisDay(issuedAt.toDate()).slice(0, 4));
  const series = `${seriesPrefix(order.countryId, country)}-${INVOICE_SERIES_CODES.customer_receipt}`;
  const platform = platformParty(order.countryId, country);
  await db.runTransaction(async (tx) => {
    const again = await tx.get(invoiceRef);
    if (again.exists) return;
    const number = await nextInvoiceNumber(tx, series, year);
    const invoice: Invoice = {
      countryId: order.countryId,
      cityId: order.cityId,
      number,
      series,
      kind: 'customer_receipt',
      status: 'paid',
      issuer: seller,
      recipient: { type: 'client', id: order.customerId, name: order.customerName, address: '', vatNumber: null, registrationNumber: null, email: null },
      selfBilling: false,
      lines,
      ...totals,
      currency: country?.currency ?? defaultCurrency(order.countryId),
      periodStart: null,
      periodEnd: null,
      orderId,
      payoutId: null,
      subscriptionId: null,
      creditedInvoiceId: null,
      creditNoteIds: [],
      pdf: null,
      issuedAt,
      dueAt: null,
      paidAt: issuedAt,
      legalMentions: [
        `Facture émise par ${platform.name} au nom et pour le compte de ${seller.name} (mandat de facturation).`,
        a.discount.platformFundedCents > 0 ? `Remise de ${(a.discount.platformFundedCents / 100).toFixed(2).replace('.', ',')} € financée par GoLink.` : '',
        'Montant réglé à la commande.',
      ].filter(Boolean),
      retainUntil: retainUntil(year),
    };
    tx.set(invoiceRef, invoice);
  });
  await db.collection(COLLECTIONS.orderFinancials).doc(orderId).set({ receiptInvoiceId: invoiceRef.id }, { merge: true }).catch(() => undefined);
  return invoiceRef.id;
}

export const onOrderSettled = onDocumentWritten({ document: 'orders/{orderId}', retry: false, ...ARGENT_RUNTIME }, async (event) => {
  const before = event.data?.before.data() as Order | undefined;
  const after = event.data?.after.data() as Order | undefined;
  if (!after || !isSettled(after) || isSettled(before)) return;
  try {
    await settleOrder(event.params.orderId, after);
  } catch (error) {
    logger.error('Comptabilisation de la commande en échec', { orderId: event.params.orderId, error: error instanceof Error ? error.stack : String(error) });
  }
  // Espèces encaissées par un livreur salarié du commerce : la caisse du livreur est suivie et plafonnée.
  try {
    await trackMerchantCash(event.params.orderId, after);
  } catch (error) {
    logger.error('Suivi des espèces en échec', { orderId: event.params.orderId, error: error instanceof Error ? error.stack : String(error) });
  }
});

/** Émet (ou renvoie) le justificatif d'une commande livrée : commandes antérieures à l'émission automatique. */
export const issueCustomerReceipt = argentCallable(z.object({ orderId: zId }), async (data, request) => {
  const { caller } = await requireAdmin(request, 'invoices.issue');
  const snap = await db.collection(COLLECTIONS.orders).doc(data.orderId).get();
  if (!snap.exists) throw fail.notFound('Commande');
  const order = snap.data() as Order;
  if (!isSettled(order)) throw fail.precondition('Le justificatif est émis une fois la commande livrée.');
  const existed = (await db.collection(COLLECTIONS.invoices).doc(`rec-${data.orderId}`).get()).exists;
  const invoiceId = await issueReceipt(data.orderId, order);
  if (!existed) {
    await writeAudit({ actor: actorFromCaller(caller, 'admin'), action: 'invoice.receipt_issued', target: { type: 'order', id: data.orderId, label: order.number }, countryId: order.countryId, cityId: order.cityId, request });
  }
  return { invoiceId, created: !existed };
});

// ------------------------------------------------------------------ Remboursements

export const onRefundProcessed = onDocumentWritten({ document: 'refunds/{refundId}', retry: false, ...ARGENT_RUNTIME }, async (event) => {
  const before = event.data?.before.data() as Refund | undefined;
  const after = event.data?.after.data() as Refund | undefined;
  if (!after || after.status !== 'processed' || before?.status === 'processed') return;
  await bookRefund(event.params.refundId, after);
});

/**
 * Imputation d'un remboursement exécuté (déduction du reversement, avoir sur le justificatif).
 * Idempotent (écriture-marqueur). Rejouée à la comptabilisation d'une commande dont un
 * remboursement partiel a été exécuté avant la livraison (article retiré en préparation).
 */
async function bookRefund(refundId: string, after: Refund): Promise<void> {
  try {
    const finRef = db.collection(COLLECTIONS.orderFinancials).doc(after.orderId);
    const test = (after as Refund & { test?: boolean }).test === true;
    const currency = await currencyOfCountry(after.countryId);
    await db.runTransaction(async (tx) => {
      const fin = await tx.get(finRef);
      const marker = ledgerRef(`rf-${refundId}-rb`);
      const done = await tx.get(marker);
      if (done.exists) return;
      // Commande non comptabilisée (annulée avant livraison) : aucune vente n'a été créditée
      // au commerce, il n'y a donc rien à lui retenir.
      if (!fin.exists) return;
      const data = fin.data() as OrderFinancials;
      const bookingDate = parisDay(new Date());
      const base = { currency, bookingDate, countryId: after.countryId, cityId: after.cityId ?? null, orderId: after.orderId, refundId, payoutId: null, createdAt: Timestamp.now(), createdBy: 'system', ...(test ? { test: true } : {}) };
      tx.set(marker, { ...base, accountType: 'restaurant', accountId: after.restaurantId, type: 'refund_charge', amountCents: -after.allocation.restaurantCents, vatCents: null, description: `Remboursement imputé ${after.orderNumber}`, reason: after.reason ?? null });
      if (after.allocation.courierCents > 0 && after.driverId) {
        tx.set(ledgerRef(`rf-${refundId}-rl`), { ...base, accountType: 'driver', accountId: after.driverId, type: 'refund_charge', amountCents: -after.allocation.courierCents, vatCents: null, description: `Remboursement imputé ${after.orderNumber}` });
      }
      tx.update(finRef, {
        refunds: FieldValue.arrayUnion({ refundId, amountCents: after.amountCents, restaurantCents: after.allocation.restaurantCents, courierCents: after.allocation.courierCents, platformCents: after.allocation.platformCents }),
        finalMarginCents: data.finalMarginCents - after.allocation.platformCents,
      });
    });
    await creditNoteForRefund(refundId, after);
  } catch (error) {
    logger.error('Imputation du remboursement en échec', { refundId, error: error instanceof Error ? error.stack : String(error) });
  }
}

/** Avoir sur le justificatif de la commande, au prorata des taux de TVA. */
async function creditNoteForRefund(refundId: string, refund: Refund): Promise<void> {
  const receiptRef = db.collection(COLLECTIONS.invoices).doc(`rec-${refund.orderId}`);
  const noteRef = db.collection(COLLECTIONS.invoices).doc(`av-${refundId}`);
  const receiptSnap = await receiptRef.get();
  if (!receiptSnap.exists) return;
  const receipt = receiptSnap.data() as Invoice;
  const country = await loadCountry(refund.countryId);
  const amount = Math.min(refund.amountCents, receipt.totalTtcCents - (receipt.creditedCents ?? 0));
  if (amount <= 0) return;
  const shares = allocateProRata(amount, receipt.vatSummary.map((v) => v.htCents + v.vatCents));
  const lines: InvoiceLine[] = receipt.vatSummary.map((v, i) => {
    const ttc = shares[i] ?? 0;
    const ht = htFromTtc(ttc, v.rateBps);
    return { label: `Remboursement ${refund.orderNumber}`, quantity: 1, unitHtCents: -ht, vatRateBps: v.rateBps, htCents: -ht, vatCents: -(ttc - ht), ttcCents: -ttc };
  }).filter((l) => l.ttcCents !== 0);
  const totals = invoiceTotals(lines);
  const year = Number(parisDay(new Date()).slice(0, 4));
  const series = `${seriesPrefix(refund.countryId, country)}-${INVOICE_SERIES_CODES.credit_note}`;
  await db.runTransaction(async (tx) => {
    const [note, rec] = await Promise.all([tx.get(noteRef), tx.get(receiptRef)]);
    if (note.exists || !rec.exists) return;
    const current = rec.data() as Invoice;
    const number = await nextInvoiceNumber(tx, series, year);
    const now = Timestamp.now();
    const credited = (current.creditedCents ?? 0) + amount;
    const creditNote: Invoice = {
      ...current,
      number,
      series,
      kind: 'credit_note',
      status: 'issued',
      lines,
      ...totals,
      creditedInvoiceId: receiptRef.id,
      creditNoteIds: [],
      creditedCents: null,
      creditReason: refund.reason ?? 'Remboursement de la commande',
      refundId,
      issuedAt: now,
      paidAt: null,
      legalMentions: [`Avoir sur la facture ${current.number}.`, ...current.legalMentions.slice(0, 1)],
      retainUntil: retainUntil(year),
    };
    tx.set(noteRef, creditNote);
    tx.update(receiptRef, {
      creditNoteIds: FieldValue.arrayUnion(noteRef.id),
      creditedCents: credited,
      ...(credited >= current.totalTtcCents ? { status: 'credited' } : {}),
    });
  });
  await db.collection(COLLECTIONS.refunds).doc(refundId).set({ creditNoteId: noteRef.id }, { merge: true });
}
