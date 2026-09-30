// Facturation : factures mensuelles automatiques aux commerces (commissions,
// abonnement, mises en avant, débours de frais de paiement), relevés
// d'autofacturation des livreurs indépendants et avoirs. Numérotation continue par
// série ; une facture n'est jamais modifiée ni supprimée : on émet un avoir.
import {
  COLLECTIONS,
  INVOICE_SERIES_CODES,
  allocateProRata,
  billingModeChargesSubscription,
  htFromTtc,
  resolveBillingMode,
  RESTAURANT_PRIVATE_DOCS,
  SUBCOLLECTIONS,
  type Invoice,
  type InvoiceLine,
  type LedgerEntry,
  type MonthlyInvoicesResult,
  type OrderFinancials,
  type Plan,
  type RestaurantCommercial,
  type SponsoredPlacement,
  type Subscription,
} from '@golink/shared';
import { logger } from 'firebase-functions/v2';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { db, FieldValue, Timestamp } from '../../lib/admin';
import { actorFromCaller, writeAudit } from '../../lib/audit';
import { defaultCurrency } from '../../lib/currency';
import { fail } from '../../lib/errors';
import { assertAdminCovers, requireAdmin } from '../../lib/permissions';
import { z, zId, zReason } from '../../lib/validation';
import {
  driverParty,
  invoiceLine,
  invoiceTotals,
  loadCountry,
  euros,
  monthBounds,
  nextInvoiceNumber,
  parisDay,
  platformParty,
  previousMonth,
  rangeBounds,
  restaurantParty,
  retainUntil,
  seriesPrefix,
  zMonth,
} from './common';
import { feeLedgerEntries, openSubscriptionDebt, restaurantBalanceCents, settleInvoiceByTransfer } from './billing';
import { messageRestaurantFinance } from './notify';
import { ARGENT_HEAVY_RUNTIME, argentCallable } from './runtime';

const pct = (bps: number) => `${(bps / 100).toLocaleString('fr-FR', { maximumFractionDigits: 2 })} %`;
const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const monthLabel = (month: string) => `${MONTHS[Number(month.slice(5, 7)) - 1] ?? ''} ${month.slice(0, 4)}`;

/**
 * Mention légale d'exonération de TVA sur le relevé d'autofacturation d'un livreur
 * indépendant, par pays d'établissement (décision client : 6 pays de lancement,
 * FR/BE/LU/DZ/MA/TN). Les seuils de franchise sont ceux en vigueur au 01/2026 ;
 * pour DZ/MA/TN, le régime applicable dépend du statut du prestataire (auto-entrepreneur
 * ou équivalent) et n'est pas une franchise de TVA harmonisée comme en UE : mention
 * prudente renvoyant à la réglementation locale plutôt qu'une référence légale inventée.
 * DZ/MA/TN : ce ne sont PAS de vraies références légales (aucun avis juridique local
 * réalisé) — seulement un texte prudent qui nomme le régime concerné et renvoie le
 * prestataire à sa propre situation fiscale ; à faire valider par un fiscaliste local
 * avant tout lancement commercial dans ces pays (cf. AUDIT_COUVERTURE_CDC.md Annexe E).
 */
const DRIVER_VAT_EXEMPTION_MENTIONS: Record<string, string> = {
  FR: 'TVA non applicable, article 293 B du Code général des impôts (franchise en base).',
  BE: 'TVA non applicable, article 56bis du Code de la TVA belge (franchise en base pour petites entreprises).',
  LU: 'TVA non applicable, article 57 de la loi TVA luxembourgeoise (franchise en base pour petites entreprises).',
  DZ: 'TVA non applicable : prestataire relevant du régime fiscal algérien applicable aux activités de prestation de services (statut à vérifier par le prestataire auprès de l’administration fiscale locale — mention indicative, non un avis juridique).',
  MA: 'TVA non applicable : prestataire relevant du régime fiscal marocain applicable aux auto-entrepreneurs ou assimilés (statut à vérifier par le prestataire auprès de l’administration fiscale locale — mention indicative, non un avis juridique).',
  TN: 'TVA non applicable : prestataire relevant du régime forfaitaire tunisien ou assimilé (statut à vérifier par le prestataire auprès de l’administration fiscale locale — mention indicative, non un avis juridique).',
};
function driverVatExemptionMention(countryId: string): string {
  return DRIVER_VAT_EXEMPTION_MENTIONS[countryId] ?? 'TVA non applicable : prestataire exonéré selon le régime fiscal applicable dans son pays d’établissement.';
}

interface RunOptions {
  month: string;
  countryId?: string | null;
  cityIds?: string[] | null;
  dryRun?: boolean;
}

export async function runMonthlyInvoices(options: RunOptions): Promise<MonthlyInvoicesResult> {
  const { first, last } = monthBounds(options.month);
  const { start, end } = rangeBounds(first, last);
  const year = Number(options.month.slice(0, 4));
  const result: MonthlyInvoicesResult = { month: options.month, restaurantInvoices: 0, driverStatements: 0, skippedExisting: 0, totalTtcCents: 0, preview: [] };
  const inScope = (d: { countryId?: string; cityId?: string | null }) =>
    (!options.countryId || d.countryId === options.countryId) && (!options.cityIds?.length || (d.cityId ? options.cityIds.includes(d.cityId) : false));

  // ---------------------------------------------------------------- Commerces
  const finSnap = await db.collection(COLLECTIONS.orderFinancials).where('deliveredAt', '>=', Timestamp.fromDate(start)).where('deliveredAt', '<', Timestamp.fromDate(end)).get();
  const byRestaurant = new Map<string, OrderFinancials[]>();
  for (const doc of finSnap.docs) {
    const fin = doc.data() as OrderFinancials;
    if (!inScope(fin)) continue;
    byRestaurant.set(fin.restaurantId, [...(byRestaurant.get(fin.restaurantId) ?? []), fin]);
  }
  // Abonnements payants et mises en avant du mois, même sans commande.
  const subsSnap = await db.collection(COLLECTIONS.subscriptions).where('status', 'in', ['active', 'past_due', 'restricted']).get();
  const subscriptions = new Map<string, Subscription & { id: string }>();
  for (const doc of subsSnap.docs) {
    const sub = doc.data() as Subscription;
    if (sub.subscriberType !== 'restaurant' || !inScope(sub)) continue;
    subscriptions.set(sub.subscriberId, { ...sub, id: doc.id });
    if (!byRestaurant.has(sub.subscriberId) && sub.priceHtCents > 0) byRestaurant.set(sub.subscriberId, []);
  }
  const sponsoredSnap = await db.collection(COLLECTIONS.sponsoredPlacements).where('startsAt', '>=', Timestamp.fromDate(start)).where('startsAt', '<', Timestamp.fromDate(end)).get();
  const sponsored = new Map<string, Array<SponsoredPlacement & { id: string }>>();
  for (const doc of sponsoredSnap.docs) {
    const placement = doc.data() as SponsoredPlacement;
    if (placement.invoiceId || placement.status === 'cancelled' || placement.status === 'pending_payment') continue;
    sponsored.set(placement.restaurantId, [...(sponsored.get(placement.restaurantId) ?? []), { ...placement, id: doc.id }]);
    if (!byRestaurant.has(placement.restaurantId)) byRestaurant.set(placement.restaurantId, []);
  }
  const plans = new Map((await db.collection(COLLECTIONS.plans).get()).docs.map((d) => [d.id, d.data() as Plan]));

  for (const [restaurantId, list] of byRestaurant) {
    const invoiceRef = db.collection(COLLECTIONS.invoices).doc(`fac-${restaurantId}-${options.month}`);
    const [existing, legacy] = await Promise.all([invoiceRef.get(), db.collection(COLLECTIONS.invoices).doc(`com-${restaurantId}-${options.month}`).get()]);
    const { party, restaurant } = await restaurantParty(restaurantId);
    if (!inScope(restaurant)) continue;
    if (existing.exists || legacy.exists) {
      result.skippedExisting += 1;
      result.preview.push({ recipient: restaurant.name, kind: 'commission_invoice', totalTtcCents: (existing.exists ? existing : legacy).get('totalTtcCents') as number, exists: true });
      continue;
    }
    const country = await loadCountry(restaurant.countryId);
    const vat = country?.pricing?.vat?.standardBps ?? 2000;
    const lines: InvoiceLine[] = [];
    // Commissions, par taux appliqué.
    const byRate = new Map<number, { count: number; ht: number }>();
    for (const fin of list) {
      const r = fin.settlement.restaurant;
      if (r.commissionHtCents <= 0) continue;
      const bucket = byRate.get(r.commissionBps) ?? { count: 0, ht: 0 };
      bucket.count += 1;
      bucket.ht += r.commissionHtCents;
      byRate.set(r.commissionBps, bucket);
    }
    for (const [bps, bucket] of [...byRate.entries()].sort((a, b) => b[0] - a[0])) {
      lines.push(invoiceLine(`Commissions sur ${bucket.count} commande${bucket.count > 1 ? 's' : ''} (taux ${pct(bps)})`, 1, bucket.ht, vat));
    }
    // Abonnement (selon le mode de facturation effectif), offre spéciale déduite tant qu'elle court.
    const sub = subscriptions.get(restaurantId);
    const subscriptionLines: InvoiceLine[] = [];
    const sponsoredLines: InvoiceLine[] = [];
    if (sub && sub.priceHtCents > 0) {
      const commercialSnap = await db.collection(COLLECTIONS.restaurants).doc(restaurantId).collection(SUBCOLLECTIONS.restaurants.private).doc(RESTAURANT_PRIVATE_DOCS.commercial).get();
      const commercial = commercialSnap.exists ? (commercialSnap.data() as RestaurantCommercial) : null;
      const mode = resolveBillingMode({ restaurant: commercial?.billingMode ?? null, plan: plans.get(sub.planCode)?.billingMode ?? null, market: country?.pricing?.commission?.billingMode ?? null });
      const trialing = sub.trialEndsAt && sub.trialEndsAt.toMillis() >= end.getTime();
      const free = sub.specialOffer?.freeUntil && sub.specialOffer.freeUntil.toMillis() >= end.getTime();
      if (billingModeChargesSubscription(mode) && !trialing && !free) {
        const price = sub.billingCycle === 'yearly' ? Math.round(sub.priceHtCents / 12) : sub.priceHtCents;
        // La remise s'éteint à la fin de l'offre : elle ne s'applique que si l'offre court encore pendant le mois facturé.
        const offerRunning = sub.specialOffer?.discountBps && (!sub.specialOffer.endsAt || sub.specialOffer.endsAt.toMillis() > start.getTime());
        const discount = offerRunning ? Math.round((price * (sub.specialOffer?.discountBps ?? 0)) / 10_000) : 0;
        subscriptionLines.push(invoiceLine(`Abonnement ${plans.get(sub.planCode)?.name ?? sub.planCode} (${monthLabel(options.month)})`, 1, price, vat));
        if (discount > 0) subscriptionLines.push(invoiceLine(`Offre spéciale : ${sub.specialOffer?.reason ?? 'remise'}`, 1, -discount, vat));
      }
    }
    for (const placement of sponsored.get(restaurantId) ?? []) {
      sponsoredLines.push(invoiceLine(`Mise en avant sponsorisée (${placement.slot.replace('_', ' ')})`, 1, placement.priceHtCents, vat));
    }
    lines.push(...subscriptionLines, ...sponsoredLines);
    const paymentFees = list.reduce((s, f) => s + (f.settlement.restaurant.paymentFeeCents ?? 0), 0);
    if (paymentFees > 0) lines.push(invoiceLine('Frais d’encaissement refacturés à l’euro près (débours, hors TVA)', 1, paymentFees, 0));
    if (lines.length === 0 || lines.every((l) => l.ttcCents === 0)) continue;
    const totals = invoiceTotals(lines);
    result.restaurantInvoices += 1;
    result.totalTtcCents += totals.totalTtcCents;
    result.preview.push({ recipient: restaurant.name, kind: 'commission_invoice', totalTtcCents: totals.totalTtcCents, exists: false });
    if (options.dryRun) continue;

    const series = `${seriesPrefix(restaurant.countryId, country)}-${INVOICE_SERIES_CODES.commission_invoice}`;
    const issuedAt = Timestamp.now();
    // Abonnement et mises en avant : retenus sur les reversements (écritures négatives du grand livre).
    // Les commissions et frais de paiement l'ont déjà été, commande par commande.
    const subscriptionTtc = subscriptionLines.reduce((sum, l) => sum + l.ttcCents, 0);
    const sponsoredTtc = sponsoredLines.reduce((sum, l) => sum + l.ttcCents, 0);
    const debitCents = subscriptionTtc + sponsoredTtc;
    const balanceCents = debitCents > 0 ? await restaurantBalanceCents(restaurantId) : 0;
    const compensated = debitCents <= 0 || balanceCents >= debitCents;
    const flags = restaurant as typeof restaurant & { seed?: boolean; test?: boolean };
    const demo = flags.seed === true || flags.test === true;
    let created: { id: string; number: string } | null = null;
    await db.runTransaction(async (tx) => {
      const again = await tx.get(invoiceRef);
      if (again.exists) return;
      const number = await nextInvoiceNumber(tx, series, year);
      const invoice: Invoice = {
        countryId: restaurant.countryId,
        cityId: restaurant.cityId,
        number,
        series,
        kind: 'commission_invoice',
        status: compensated ? 'paid' : 'issued',
        issuer: platformParty(restaurant.countryId, country),
        recipient: party,
        selfBilling: false,
        lines,
        ...totals,
        currency: country?.currency ?? 'EUR',
        periodStart: first,
        periodEnd: last,
        orderId: null,
        payoutId: null,
        subscriptionId: sub?.id ?? null,
        creditedInvoiceId: null,
        creditNoteIds: [],
        pdf: null,
        issuedAt,
        dueAt: issuedAt,
        paidAt: compensated ? issuedAt : null,
        compensation: debitCents > 0 ? { debitCents, status: compensated ? 'done' : 'pending', settledAt: compensated ? issuedAt : null } : null,
        legalMentions: [
          'Commissions et frais de paiement : retenus commande par commande sur vos reversements.',
          ...(debitCents > 0
            ? [
                compensated
                  ? `Abonnement et mises en avant (${euros(debitCents)}) : retenus sur vos reversements.`
                  : `Abonnement et mises en avant (${euros(debitCents)}) : à compenser sur vos prochains reversements ou à régler par virement.`,
              ]
            : []),
          'TVA acquittée sur les débits.',
          `Commande${list.length > 1 ? 's' : ''} concernée${list.length > 1 ? 's' : ''} : ${list.length}.`,
        ],
        retainUntil: retainUntil(year),
      };
      tx.set(invoiceRef, invoice);
      const entries = feeLedgerEntries({
        invoiceId: invoiceRef.id,
        restaurantId,
        subscriptionId: sub?.id ?? null,
        countryId: restaurant.countryId,
        cityId: restaurant.cityId,
        currency: country?.currency ?? 'EUR',
        subscriptionTtcCents: subscriptionTtc,
        sponsoredTtcCents: sponsoredTtc,
        bookingDate: parisDay(issuedAt.toDate()),
        issuedAt,
        test: demo,
      });
      for (const { id, entry } of entries) tx.set(db.collection(COLLECTIONS.ledgerEntries).doc(id), entry);
      for (const placement of sponsored.get(restaurantId) ?? []) tx.update(db.collection(COLLECTIONS.sponsoredPlacements).doc(placement.id), { invoiceId: invoiceRef.id });
      created = { id: invoiceRef.id, number };
    });
    if (!created) continue;
    const made = created as { id: string; number: string };
    // Impayé : la retenue dépasse le solde à reverser. Dans tous les cas, la facture est envoyée au commerce.
    if (!compensated) await openSubscriptionDebt({ restaurantId, invoiceId: made.id, invoiceNumber: made.number, debitCents, demo });
    await messageRestaurantFinance(
      restaurantId,
      'invoice_available',
      {
        invoiceNumber: made.number,
        amount: euros(totals.totalTtcCents),
        period: monthLabel(options.month),
        settlement: compensated ? 'Elle est réglée par compensation sur vos reversements.' : `${euros(debitCents)} restent à compenser : voir le détail dans votre espace.`,
      },
      { dedupeKey: made.id, ctaUrl: null },
      demo,
    );
  }

  // ---------------------------------------------------------------- Livreurs (autofacturation)
  const ledgerSnap = await db.collection(COLLECTIONS.ledgerEntries).where('accountType', '==', 'driver').where('bookingDate', '>=', first).where('bookingDate', '<=', last).get();
  const byDriver = new Map<string, LedgerEntry[]>();
  for (const doc of ledgerSnap.docs) {
    const entry = doc.data() as LedgerEntry;
    if (!inScope(entry)) continue;
    if (!['courier_earning', 'courier_tip', 'courier_bonus', 'hourly_guarantee_topup'].includes(entry.type)) continue;
    byDriver.set(entry.accountId, [...(byDriver.get(entry.accountId) ?? []), entry]);
  }
  for (const [uid, entries] of byDriver) {
    const ref = db.collection(COLLECTIONS.invoices).doc(`rel-${uid}-${options.month}`);
    const [existing, legacy] = await Promise.all([ref.get(), db.collection(COLLECTIONS.invoices).doc(`liv-${uid}-${options.month}`).get()]);
    const { party, driver, priv } = await driverParty(uid);
    if (driver.type && driver.type !== 'platform') continue;
    if (existing.exists || legacy.exists) {
      result.skippedExisting += 1;
      result.preview.push({ recipient: party.name, kind: 'driver_statement', totalTtcCents: (existing.exists ? existing : legacy).get('totalTtcCents') as number, exists: true });
      continue;
    }
    const country = await loadCountry(driver.countryId);
    const exempt = priv?.vatExempt !== false;
    const rate = exempt ? 0 : (country?.pricing?.vat?.standardBps ?? 2000);
    const sum = (type: string) => entries.filter((e) => e.type === type).reduce((s, e) => s + e.amountCents, 0);
    const courses = entries.filter((e) => e.type === 'courier_earning').length;
    const lines: InvoiceLine[] = [];
    const earnings = sum('courier_earning');
    if (earnings) lines.push(invoiceLine(`Prestations de livraison : ${courses} course${courses > 1 ? 's' : ''}`, 1, exempt ? earnings : htFromTtc(earnings, rate), rate));
    const bonus = sum('courier_bonus') + sum('hourly_guarantee_topup');
    if (bonus) lines.push(invoiceLine('Primes et compléments', 1, exempt ? bonus : htFromTtc(bonus, rate), rate));
    const tips = sum('courier_tip');
    if (tips) lines.push(invoiceLine('Pourboires reversés (100 %, hors TVA)', 1, tips, 0));
    if (lines.length === 0) continue;
    const totals = invoiceTotals(lines);
    result.driverStatements += 1;
    result.totalTtcCents += totals.totalTtcCents;
    result.preview.push({ recipient: party.name, kind: 'driver_statement', totalTtcCents: totals.totalTtcCents, exists: false });
    if (options.dryRun) continue;
    const series = `${seriesPrefix(driver.countryId, country)}-${INVOICE_SERIES_CODES.driver_statement}`;
    const issuedAt = Timestamp.now();
    await db.runTransaction(async (tx) => {
      const again = await tx.get(ref);
      if (again.exists) return;
      const number = await nextInvoiceNumber(tx, series, year);
      const invoice: Invoice = {
        countryId: driver.countryId,
        cityId: driver.cityId,
        number,
        series,
        kind: 'driver_statement',
        status: 'issued',
        issuer: party,
        recipient: platformParty(driver.countryId, country),
        selfBilling: true,
        lines,
        ...totals,
        currency: country?.currency ?? defaultCurrency(driver.countryId),
        periodStart: first,
        periodEnd: last,
        orderId: null,
        payoutId: null,
        subscriptionId: null,
        creditedInvoiceId: null,
        creditNoteIds: [],
        pdf: null,
        issuedAt,
        dueAt: null,
        paidAt: null,
        legalMentions: [
          'Autofacturation : facture émise par Ciyou Eats au nom et pour le compte du prestataire.',
          exempt ? driverVatExemptionMention(driver.countryId) : 'TVA due par le prestataire.',
        ],
        retainUntil: retainUntil(year),
      };
      tx.set(ref, invoice);
    });
  }
  return result;
}

/** Le 1er de chaque mois à 5 h : factures et relevés du mois écoulé. */
export const generateMonthlyInvoices = onSchedule({ schedule: '0 5 1 * *', timeZone: 'Europe/Paris', ...ARGENT_HEAVY_RUNTIME }, async () => {
  const month = previousMonth();
  const result = await runMonthlyInvoices({ month });
  logger.info('Factures mensuelles émises', { month, restaurants: result.restaurantInvoices, drivers: result.driverStatements, skipped: result.skippedExisting });
});

export const generateMonthlyInvoicesNow = argentCallable(
  z.object({ month: z.string().regex(zMonth, 'Mois invalide').nullish(), countryId: z.string().length(2).nullish(), dryRun: z.boolean().optional(), reason: zReason.nullish() }),
  async (data, request) => {
    const { caller, admin } = await requireAdmin(request, 'invoices.issue');
    if (!data.dryRun && !data.reason) throw fail.invalid('Indiquez le motif de l’émission manuelle des factures (numérotation légale).');
    const month = data.month ?? previousMonth();
    const current = new Date().toISOString().slice(0, 7);
    if (month >= current) throw fail.precondition('Seul un mois terminé peut être facturé.');
    const cityIds = admin.role !== 'super_admin' && admin.cityIds.length > 0 ? admin.cityIds : null;
    const result = await runMonthlyInvoices({ month, countryId: data.countryId ?? null, cityIds, dryRun: data.dryRun });
    if (!data.dryRun && result.restaurantInvoices + result.driverStatements > 0) {
      await writeAudit({ actor: actorFromCaller(caller, 'admin'), action: 'invoices.monthly_issued', target: { type: 'other', id: `factures-${month}`, label: `Factures de ${monthLabel(month)}` }, reason: data.reason ?? null, after: { restaurantInvoices: result.restaurantInvoices, driverStatements: result.driverStatements, totalTtcCents: result.totalTtcCents }, countryId: data.countryId ?? null, request, sensitive: true });
    }
    return result;
  },
  { ...ARGENT_HEAVY_RUNTIME },
);

// ------------------------------------------------------------------ Avoirs

export const issueCreditNote = argentCallable(
  z.object({ invoiceId: zId, amountCents: z.number().int().positive().nullish(), reason: zReason }),
  async (data, request) => {
    const { caller, admin } = await requireAdmin(request, 'invoices.issue');
    const sourceRef = db.collection(COLLECTIONS.invoices).doc(data.invoiceId);
    const snap = await sourceRef.get();
    if (!snap.exists) throw fail.notFound('Facture');
    const source = snap.data() as Invoice;
    assertAdminCovers(admin, source.cityId ?? null);
    if (source.kind === 'credit_note') throw fail.precondition('Un avoir ne peut pas être annulé par un autre avoir.');
    const remaining = source.totalTtcCents - (source.creditedCents ?? 0);
    if (remaining <= 0) throw fail.precondition('Cette facture est déjà entièrement annulée par avoir.');
    const amount = data.amountCents ?? remaining;
    if (amount > remaining) throw fail.invalid(`Le montant dépasse le reste à créditer (${(remaining / 100).toFixed(2).replace('.', ',')} €).`);

    const full = amount === remaining && (source.creditedCents ?? 0) === 0;
    const lines: InvoiceLine[] = full
      ? source.lines.map((l) => ({ ...l, unitHtCents: -l.unitHtCents, htCents: -l.htCents, vatCents: -l.vatCents, ttcCents: -l.ttcCents }))
      : (() => {
          const shares = allocateProRata(amount, source.vatSummary.map((v) => v.htCents + v.vatCents));
          return source.vatSummary
            .map((v, i) => {
              const ttc = shares[i] ?? 0;
              const ht = htFromTtc(ttc, v.rateBps);
              return { label: `Annulation partielle de la facture ${source.number}`, quantity: 1, unitHtCents: -ht, vatRateBps: v.rateBps, htCents: -ht, vatCents: -(ttc - ht), ttcCents: -ttc };
            })
            .filter((l) => l.ttcCents !== 0);
        })();
    const totals = invoiceTotals(lines);
    const country = await loadCountry(source.countryId);
    const year = new Date().getFullYear();
    const series = `${seriesPrefix(source.countryId, country)}-${INVOICE_SERIES_CODES.credit_note}`;
    const noteRef = db.collection(COLLECTIONS.invoices).doc();
    const number = await db.runTransaction(async (tx) => {
      const fresh = await tx.get(sourceRef);
      const current = fresh.data() as Invoice;
      if (current.totalTtcCents - (current.creditedCents ?? 0) < amount) throw fail.precondition('La facture a été créditée entre-temps : actualisez la page.');
      const num = await nextInvoiceNumber(tx, series, year);
      const now = Timestamp.now();
      const note: Invoice = {
        ...current,
        number: num,
        series,
        kind: 'credit_note',
        status: 'issued',
        lines,
        ...totals,
        creditedInvoiceId: data.invoiceId,
        creditNoteIds: [],
        creditedCents: null,
        creditReason: data.reason,
        issuedAt: now,
        dueAt: null,
        paidAt: null,
        pdf: null,
        legalMentions: [`Avoir sur la facture ${current.number} du ${current.issuedAt.toDate().toLocaleDateString('fr-FR')}.`, `Motif : ${data.reason}`],
        retainUntil: retainUntil(year),
      };
      tx.set(noteRef, note);
      const credited = (current.creditedCents ?? 0) + amount;
      tx.update(sourceRef, { creditNoteIds: FieldValue.arrayUnion(noteRef.id), creditedCents: credited, ...(credited >= current.totalTtcCents ? { status: 'credited' } : {}) });
      return num;
    });
    await writeAudit({ actor: actorFromCaller(caller, 'admin'), action: 'invoice.credit_note_issued', target: { type: 'invoice', id: data.invoiceId, label: source.number }, reason: data.reason, after: { creditNoteId: noteRef.id, number, amountCents: amount }, countryId: source.countryId, cityId: source.cityId ?? null, request, sensitive: true });
    return { creditNoteId: noteRef.id, number };
  },
);

/** Encaissement constaté hors prélèvement automatique (virement reçu, régularisation). */
export const markInvoicePaid = argentCallable(z.object({ invoiceId: zId, reason: zReason }), async (data, request) => {
  const { caller, admin } = await requireAdmin(request, 'invoices.issue');
  const ref = db.collection(COLLECTIONS.invoices).doc(data.invoiceId);
  const snap = await ref.get();
  if (!snap.exists) throw fail.notFound('Facture');
  const invoice = snap.data() as Invoice;
  assertAdminCovers(admin, invoice.cityId ?? null);
  if (!['issued', 'overdue'].includes(invoice.status) || invoice.kind === 'credit_note') throw fail.precondition('Cette facture n’est pas en attente de paiement.');
  const now = Timestamp.now();
  // Facture en attente de compensation : la retenue au grand livre est annulée (le commerce a payé par virement).
  if (!(await settleInvoiceByTransfer(data.invoiceId, data.reason, caller.uid))) await ref.update({ status: 'paid', paidAt: now });
  await writeAudit({ actor: actorFromCaller(caller, 'admin'), action: 'invoice.marked_paid', target: { type: 'invoice', id: data.invoiceId, label: invoice.number }, reason: data.reason, before: { status: invoice.status }, after: { status: 'paid' }, countryId: invoice.countryId, cityId: invoice.cityId ?? null, request, sensitive: true });
  return { ok: true };
});

