// Déclarations et exports réglementaires : récapitulatif annuel DAC7 des revenus des
// vendeurs (commerces) et prestataires (livreurs), récapitulatif mensuel de la TVA
// collectée par Ciyou Eats, export comptable mensuel (écritures au format proche du FEC).
// Les résultats sont enregistrés dans taxReports (historique) ; les fichiers sont
// produits par le back-office à partir des lignes renvoyées.
import {
  COLLECTIONS,
  RESTAURANT_PRIVATE_DOCS,
  SUBCOLLECTIONS,
  aggregateDac7,
  isDac7Reportable,
  type AccountingExportResult,
  type AccountingLine,
  type Dac7Line,
  type DriverPrivate,
  type Invoice,
  type LedgerEntry,
  type OrderFinancials,
  type Payout,
  type Refund,
  type Restaurant,
  type RestaurantLegal,
  type TaxReport,
  type VatReportLine,
} from '@golink/shared';
import { db, Timestamp } from '../../lib/admin';
import { actorFromCaller, writeAudit } from '../../lib/audit';
import { fail } from '../../lib/errors';
import { requireAdmin } from '../../lib/permissions';
import { z, zReason } from '../../lib/validation';
import { chunk, loadCountry, monthBounds, parisDay, rangeBounds, zMonth } from './common';
import { ARGENT_HEAVY_RUNTIME, argentCallable } from './runtime';

const zCountry = z.string().trim().length(2).toUpperCase();

/** Exportée pour un test réel direct (cdc-fix-residuals-3 : déduction des remboursements). */
export async function runDac7(countryId: string, year: number): Promise<{ lines: Dac7Line[]; totals: { grossCents: number; feesCents: number; vatCents: number } }> {
  const { start, end } = rangeBounds(`${year}-01-01`, `${year}-12-31`);
  const finSnap = await db.collection(COLLECTIONS.orderFinancials).where('deliveredAt', '>=', Timestamp.fromDate(start)).where('deliveredAt', '<', Timestamp.fromDate(end)).get();
  const byRestaurant = new Map<string, Array<{ paidAt: Date; grossCents: number; feesCents: number; countsAsTransaction?: boolean }>>();
  for (const doc of finSnap.docs) {
    const fin = doc.data() as OrderFinancials;
    if (fin.countryId !== countryId || !fin.deliveredAt) continue;
    const r = fin.settlement.restaurant;
    // Contrepartie versée au vendeur : prix des articles après remises qu'il finance ; frais = commission TTC + frais de paiement.
    const tx = { paidAt: fin.deliveredAt.toDate(), grossCents: r.grossCents - r.discountFundedCents + r.deliveryFeeCents, feesCents: r.commissionTtcCents + r.paymentFeeCents };
    byRestaurant.set(fin.restaurantId, [...(byRestaurant.get(fin.restaurantId) ?? []), tx]);
  }
  // Remboursements traités dans l'année, imputés au commerce (§16 « Déclarations » — corrigé,
  // cdc-fix-residuals-3) : réduisent le montant déclaré sans compter comme une vente de plus.
  const refundSnap = await db.collection(COLLECTIONS.refunds).where('status', '==', 'processed').where('processedAt', '>=', Timestamp.fromDate(start)).where('processedAt', '<', Timestamp.fromDate(end)).get();
  for (const doc of refundSnap.docs) {
    const refund = doc.data() as Refund;
    const restaurantCents = refund.allocation?.restaurantCents ?? 0;
    if (restaurantCents <= 0 || !refund.processedAt) continue;
    if (!byRestaurant.has(refund.restaurantId)) continue; // Restaurant hors périmètre pays (pas de vente déclarée cette année).
    byRestaurant.get(refund.restaurantId)!.push({ paidAt: refund.processedAt.toDate(), grossCents: -restaurantCents, feesCents: 0, countsAsTransaction: false });
  }
  const lines: Dac7Line[] = [];
  for (const part of chunk([...byRestaurant.keys()], 100)) {
    const refs = part.map((id) => db.collection(COLLECTIONS.restaurants).doc(id));
    const legalRefs = part.map((id) => db.collection(COLLECTIONS.restaurants).doc(id).collection(SUBCOLLECTIONS.restaurants.private).doc(RESTAURANT_PRIVATE_DOCS.legal));
    const [snaps, legals] = await Promise.all([db.getAll(...refs), db.getAll(...legalRefs)]);
    snaps.forEach((snap, i) => {
      const restaurant = snap.exists ? (snap.data() as Restaurant) : null;
      const legal = legals[i]?.exists ? (legals[i]?.data() as RestaurantLegal) : null;
      const txs = byRestaurant.get(snap.id) ?? [];
      const quarters = aggregateDac7(txs, year);
      const grossCents = quarters.reduce((s, q) => s + q.grossCents, 0);
      const feesCents = quarters.reduce((s, q) => s + q.feesCents, 0);
      const count = quarters.reduce((s, q) => s + q.transactionsCount, 0);
      const address = legal?.registeredAddress ?? restaurant?.address ?? null;
      const missing: string[] = [];
      if (!legal?.siret) missing.push('SIRET');
      if (!legal?.vatNumber) missing.push('numéro de TVA');
      if (!address) missing.push('adresse');
      lines.push({
        sellerType: 'restaurant',
        sellerId: snap.id,
        name: legal?.legalName ?? restaurant?.name ?? snap.id,
        taxId: legal?.siret ?? null,
        address: address ? `${address.line1}, ${address.postalCode} ${address.city}` : null,
        countryId,
        quarters,
        grossCents,
        feesCents,
        transactionsCount: count,
        reportable: isDac7Reportable('sale_of_goods', count, grossCents),
        missing,
      });
    });
  }

  // Livreurs indépendants : services personnels, déclarables dès le premier euro. Les
  // remboursements imputés au livreur (`refund_charge`, cdc-fix-residuals-32) réduisent le
  // revenu brut déclaré sans compter comme une course de plus — même principe que pour les
  // commerces ci-dessus.
  const DRIVER_EARNING_TYPES = ['courier_earning', 'courier_bonus', 'hourly_guarantee_topup', 'courier_tip', 'refund_charge'];
  const ledger = await db.collection(COLLECTIONS.ledgerEntries).where('accountType', '==', 'driver').where('bookingDate', '>=', `${year}-01-01`).where('bookingDate', '<=', `${year}-12-31`).get();
  const byDriver = new Map<string, Array<{ paidAt: Date; grossCents: number; feesCents: number; countsAsTransaction?: boolean }>>();
  for (const doc of ledger.docs) {
    const entry = doc.data() as LedgerEntry;
    if (entry.countryId !== countryId || !DRIVER_EARNING_TYPES.includes(entry.type)) continue;
    const tx = { paidAt: new Date(`${entry.bookingDate}T12:00:00Z`), grossCents: entry.amountCents, feesCents: 0, countsAsTransaction: entry.type !== 'refund_charge' };
    byDriver.set(entry.accountId, [...(byDriver.get(entry.accountId) ?? []), tx]);
  }
  for (const part of chunk([...byDriver.keys()], 100)) {
    const [drivers, privs] = await Promise.all([
      db.getAll(...part.map((id) => db.collection(COLLECTIONS.drivers).doc(id))),
      db.getAll(...part.map((id) => db.collection(COLLECTIONS.driverPrivate).doc(id))),
    ]);
    drivers.forEach((snap, i) => {
      const d = snap.data() as { firstName?: string; lastName?: string } | undefined;
      const priv = privs[i]?.exists ? (privs[i]?.data() as DriverPrivate) : null;
      const txs = byDriver.get(snap.id) ?? [];
      const quarters = aggregateDac7(txs, year);
      // Une course = une transaction (les pourboires s'ajoutent au montant sans compter en plus) ;
      // un remboursement imputé (`countsAsTransaction: false`) ne compte pas comme une course de plus.
      const courses = quarters.reduce((s, q) => s + q.transactionsCount, 0);
      const grossCents = quarters.reduce((s, q) => s + q.grossCents, 0);
      const missing: string[] = [];
      if (!priv?.taxIdentificationNumber) missing.push('numéro fiscal');
      if (!priv?.address) missing.push('adresse');
      if (!priv?.birthDate) missing.push('date de naissance');
      lines.push({
        sellerType: 'driver',
        sellerId: snap.id,
        name: `${d?.firstName ?? ''} ${d?.lastName ?? ''}`.trim() || snap.id,
        taxId: priv?.taxIdentificationNumber ?? null,
        address: priv?.address ? `${priv.address.line1}, ${priv.address.postalCode} ${priv.address.city}` : null,
        countryId,
        quarters,
        grossCents,
        feesCents: 0,
        transactionsCount: courses,
        reportable: isDac7Reportable('personal_services', courses, grossCents),
        missing,
      });
    });
  }
  lines.sort((a, b) => b.grossCents - a.grossCents);
  const reportable = lines.filter((l) => l.reportable);
  return {
    lines,
    totals: { grossCents: reportable.reduce((s, l) => s + l.grossCents, 0), feesCents: reportable.reduce((s, l) => s + l.feesCents, 0), vatCents: 0 },
  };
}

async function runVat(countryId: string, month: string): Promise<{ lines: VatReportLine[]; collected: number; credits: number }> {
  const { first, last } = monthBounds(month);
  const { start, end } = rangeBounds(first, last);
  const byKey = new Map<string, VatReportLine>();
  const add = (label: string, rateBps: number, ht: number, vat: number) => {
    const key = `${label}|${rateBps}`;
    const line = byKey.get(key) ?? { label, rateBps, htCents: 0, vatCents: 0 };
    line.htCents += ht;
    line.vatCents += vat;
    byKey.set(key, line);
  };
  const invoices = await db.collection(COLLECTIONS.invoices).where('issuedAt', '>=', Timestamp.fromDate(start)).where('issuedAt', '<', Timestamp.fromDate(end)).get();
  let credits = 0;
  for (const doc of invoices.docs) {
    const inv = doc.data() as Invoice;
    if (inv.countryId !== countryId) continue;
    const platformIssued = inv.issuer.type === 'platform';
    if (!platformIssued) continue;
    const label = inv.kind === 'credit_note' ? 'Avoirs émis' : inv.kind === 'subscription_invoice' ? 'Abonnements' : inv.kind === 'sponsored_invoice' ? 'Mises en avant' : 'Commissions et services aux commerces';
    // Un avoir réduit toujours la TVA collectée, quelle que soit la convention de signe du document.
    const sign = inv.kind === 'credit_note' ? -1 : 1;
    for (const v of inv.vatSummary) {
      const ht = sign * Math.abs(v.htCents);
      const vat = sign * Math.abs(v.vatCents);
      add(label, v.rateBps, ht, vat);
      if (inv.kind === 'credit_note') credits += vat;
    }
  }
  // Frais facturés aux clients (service, petite commande, livraison Ciyou Eats) : TVA incluse dans la répartition.
  const fin = await db.collection(COLLECTIONS.orderFinancials).where('deliveredAt', '>=', Timestamp.fromDate(start)).where('deliveredAt', '<', Timestamp.fromDate(end)).get();
  const standard = (await db.collection(COLLECTIONS.countries).doc(countryId).get()).get('pricing.vat.standardBps') as number | undefined;
  for (const doc of fin.docs) {
    const f = doc.data() as OrderFinancials;
    if (f.countryId !== countryId) continue;
    const p = f.settlement.platform;
    const feesHt = p.serviceFeeHtCents + p.smallOrderFeeHtCents + p.deliveryFeeHtCents;
    const feesVat = p.vatDueCents - f.settlement.restaurant.commissionVatCents;
    if (feesHt > 0 || feesVat > 0) add('Frais facturés aux clients', standard ?? 2000, feesHt, feesVat);
  }
  const lines = [...byKey.values()].sort((a, b) => a.label.localeCompare(b.label, 'fr') || b.rateBps - a.rateBps);
  const collected = lines.reduce((s, l) => s + l.vatCents, 0);
  return { lines, collected, credits };
}

export const generateTaxReport = argentCallable(
  z.object({
    type: z.enum(['dac7', 'vat']),
    countryId: zCountry,
    period: z.string().trim().regex(/^\d{4}(-(0[1-9]|1[0-2]))?$/, 'Période invalide'),
    reason: zReason,
  }),
  async (data, request) => {
    const { caller } = await requireAdmin(request, 'tax.reports');
    const now = Timestamp.now();
    const id = `${data.type === 'dac7' ? 'dac7' : 'tva'}-${data.countryId.toLowerCase()}-${data.period}`;
    const ref = db.collection(COLLECTIONS.taxReports).doc(id);
    const existing = await ref.get();
    if (existing.exists && existing.get('status') === 'submitted') throw fail.precondition('Cette déclaration a déjà été transmise : elle ne peut plus être recalculée.');
    let report: TaxReport;
    if (data.type === 'dac7') {
      if (!/^\d{4}$/.test(data.period)) throw fail.invalid('Indiquez une année pour la déclaration DAC7.');
      const { lines, totals } = await runDac7(data.countryId, Number(data.period));
      report = {
        type: 'dac7',
        countryId: data.countryId,
        period: data.period,
        status: 'ready',
        sellersCount: lines.filter((l) => l.reportable).length,
        totals,
        file: null,
        submittedAt: null,
        submissionReference: null,
        error: null,
        dac7Lines: lines,
        vatLines: null,
        generatedBy: caller.uid,
        createdAt: existing.exists ? (existing.get('createdAt') as Timestamp) : now,
        createdBy: existing.exists ? (existing.get('createdBy') as string) : caller.uid,
        updatedAt: now,
        updatedBy: caller.uid,
      };
    } else {
      if (!zMonth.test(data.period)) throw fail.invalid('Indiquez un mois (AAAA-MM) pour le récapitulatif de TVA.');
      const { lines, collected, credits } = await runVat(data.countryId, data.period);
      report = {
        type: 'vat',
        countryId: data.countryId,
        period: data.period,
        status: 'ready',
        sellersCount: null,
        totals: { grossCents: lines.reduce((s, l) => s + l.htCents + l.vatCents, 0), feesCents: lines.reduce((s, l) => s + l.htCents, 0), vatCents: collected },
        vatBreakdown: { collectedCents: collected - credits, creditNotesCents: credits, netCents: collected },
        file: null,
        submittedAt: null,
        submissionReference: null,
        error: null,
        dac7Lines: null,
        vatLines: lines,
        generatedBy: caller.uid,
        createdAt: existing.exists ? (existing.get('createdAt') as Timestamp) : now,
        createdBy: existing.exists ? (existing.get('createdBy') as string) : caller.uid,
        updatedAt: now,
        updatedBy: caller.uid,
      };
    }
    await ref.set(report);
    await writeAudit({ actor: actorFromCaller(caller, 'admin'), action: 'tax_report.generated', target: { type: 'other', id, label: `${data.type.toUpperCase()} ${data.countryId} ${data.period}` }, reason: data.reason, after: { totals: report.totals ?? null, sellersCount: report.sellersCount ?? null }, countryId: data.countryId, request, sensitive: true });
    return { reportId: id };
  },
  { ...ARGENT_HEAVY_RUNTIME },
);

export const markTaxReportSubmitted = argentCallable(
  z.object({ reportId: z.string().trim().min(3).max(80), reference: z.string().trim().min(3, 'Indiquez la référence du dépôt').max(120), reason: zReason.optional() }),
  async (data, request) => {
    const { caller } = await requireAdmin(request, 'tax.reports');
    const ref = db.collection(COLLECTIONS.taxReports).doc(data.reportId);
    const snap = await ref.get();
    if (!snap.exists) throw fail.notFound('Déclaration');
    if (snap.get('status') !== 'ready') throw fail.precondition('Seule une déclaration prête peut être marquée comme transmise.');
    const now = Timestamp.now();
    await ref.update({ status: 'submitted', submittedAt: now, submissionReference: data.reference, updatedAt: now, updatedBy: caller.uid });
    await writeAudit({ actor: actorFromCaller(caller, 'admin'), action: 'tax_report.submitted', target: { type: 'other', id: data.reportId }, reason: data.reason ?? null, after: { reference: data.reference }, countryId: snap.get('countryId') as string, request, sensitive: true });
    return { ok: true };
  },
);

// ------------------------------------------------------------------ Export comptable

const ACCOUNTS: Record<string, string> = {
  '411': 'Clients – commerces',
  '4111': 'Clients – particuliers',
  '401': 'Fournisseurs – livreurs',
  '467': 'Comptes de reversement des commerces',
  '706': 'Prestations de services (commissions, abonnements)',
  '7062': 'Frais facturés aux clients',
  '604': 'Achats de prestations de livraison',
  '44571': 'TVA collectée',
  '44566': 'TVA déductible sur services',
  '512': 'Banque (Stripe)',
};

// JournalLib (FEC) : libellé des 3 journaux utilisés par l'export (Ventes, Achats, Banque).
const JOURNAL_LIBS: Record<string, string> = { VT: 'Ventes', AC: 'Achats', BQ: 'Banque' };

export const exportAccounting = argentCallable(
  z.object({ month: z.string().regex(zMonth, 'Mois invalide'), countryId: zCountry, reason: zReason }),
  async (data, request): Promise<AccountingExportResult> => {
    const { caller } = await requireAdmin(request, 'tax.reports');
    const { first, last } = monthBounds(data.month);
    const { start, end } = rangeBounds(first, last);
    const lines: AccountingLine[] = [];
    // EcritureNum (FEC) : numéro de séquence continue, partagé par toutes les lignes d'une même
    // pièce (une écriture = un ensemble de lignes équilibré) ; ValidDate : date de validation,
    // toujours la date d'émission de l'export (les écritures ne sont jamais modifiées après coup).
    const ecritureNums = new Map<string, number>();
    let nextEcritureNum = 1;
    const validDate = parisDay(new Date());
    const push = (journal: string, date: string, piece: string, account: string, thirdParty: string | null, label: string, debit: number, credit: number): void => {
      if (debit === 0 && credit === 0) return;
      const key = `${journal}|${piece}`;
      if (!ecritureNums.has(key)) ecritureNums.set(key, nextEcritureNum++);
      lines.push({
        journal,
        journalLib: JOURNAL_LIBS[journal] ?? journal,
        ecritureNum: ecritureNums.get(key) as number,
        date,
        pieceDate: date,
        validDate,
        piece,
        account,
        accountLabel: ACCOUNTS[account] ?? account,
        thirdParty,
        label,
        debitCents: debit,
        creditCents: credit,
      });
    };

    // Ventes : factures émises par Ciyou Eats (commissions, abonnements, mises en avant, avoirs).
    const invoices = await db.collection(COLLECTIONS.invoices).where('issuedAt', '>=', Timestamp.fromDate(start)).where('issuedAt', '<', Timestamp.fromDate(end)).get();
    let invoicesCount = 0;
    for (const doc of invoices.docs) {
      const inv = doc.data() as Invoice;
      if (inv.countryId !== data.countryId) continue;
      const date = parisDay(inv.issuedAt.toDate());
      if (inv.issuer.type === 'platform') {
        invoicesCount += 1;
        const credit = inv.kind === 'credit_note';
        const ttc = Math.abs(inv.totalTtcCents);
        const ht = Math.abs(inv.totalHtCents);
        const vat = Math.abs(inv.totalVatCents);
        push('VT', date, inv.number, '411', inv.recipient.name, `${credit ? 'Avoir' : 'Facture'} ${inv.recipient.name}`, credit ? 0 : ttc, credit ? ttc : 0);
        push('VT', date, inv.number, '706', null, `${credit ? 'Avoir' : 'Facture'} ${inv.number}`, credit ? ht : 0, credit ? 0 : ht);
        if (vat) push('VT', date, inv.number, '44571', null, `TVA ${inv.number}`, credit ? vat : 0, credit ? 0 : vat);
      } else if (inv.kind === 'driver_statement') {
        invoicesCount += 1;
        push('AC', date, inv.number, '604', null, `Relevé ${inv.issuer.name}`, inv.totalHtCents, 0);
        if (inv.totalVatCents) push('AC', date, inv.number, '44566', null, `TVA déductible ${inv.number}`, inv.totalVatCents, 0);
        push('AC', date, inv.number, '401', inv.issuer.name, `Relevé ${inv.issuer.name}`, 0, inv.totalTtcCents);
      }
    }

    // Frais facturés aux clients : une écriture par jour.
    const fin = await db.collection(COLLECTIONS.orderFinancials).where('deliveredAt', '>=', Timestamp.fromDate(start)).where('deliveredAt', '<', Timestamp.fromDate(end)).get();
    const byDay = new Map<string, { ht: number; vat: number; orders: number }>();
    for (const doc of fin.docs) {
      const f = doc.data() as OrderFinancials;
      if (f.countryId !== data.countryId || !f.deliveredAt) continue;
      const day = parisDay(f.deliveredAt.toDate());
      const p = f.settlement.platform;
      const bucket = byDay.get(day) ?? { ht: 0, vat: 0, orders: 0 };
      bucket.ht += p.serviceFeeHtCents + p.smallOrderFeeHtCents + p.deliveryFeeHtCents;
      bucket.vat += Math.max(0, p.vatDueCents - f.settlement.restaurant.commissionVatCents);
      bucket.orders += 1;
      byDay.set(day, bucket);
    }
    for (const [day, b] of [...byDay.entries()].sort()) {
      const piece = `FRAIS-${day.replace(/-/g, '')}`;
      push('VT', day, piece, '4111', 'Clients', `Frais clients (${b.orders} commandes)`, b.ht + b.vat, 0);
      push('VT', day, piece, '7062', null, `Frais clients ${day}`, 0, b.ht);
      if (b.vat) push('VT', day, piece, '44571', null, `TVA frais clients ${day}`, 0, b.vat);
    }

    // Reversements payés : sortie de banque.
    const payouts = await db.collection(COLLECTIONS.payouts).where('paidAt', '>=', Timestamp.fromDate(start)).where('paidAt', '<', Timestamp.fromDate(end)).get();
    let payoutsCount = 0;
    for (const doc of payouts.docs) {
      const p = doc.data() as Payout;
      if (p.countryId !== data.countryId || p.status !== 'paid' || !p.paidAt) continue;
      payoutsCount += 1;
      const date = parisDay(p.paidAt.toDate());
      const account = p.beneficiaryType === 'restaurant' ? '467' : '401';
      push('BQ', date, doc.id, account, p.beneficiaryName, `Reversement ${p.beneficiaryName}`, p.netCents, 0);
      push('BQ', date, doc.id, '512', null, `Virement ${p.providerTransferId ?? doc.id}`, 0, p.netCents);
    }

    const totals = {
      debitCents: lines.reduce((s, l) => s + l.debitCents, 0),
      creditCents: lines.reduce((s, l) => s + l.creditCents, 0),
      invoices: invoicesCount,
      payouts: payoutsCount,
    };
    const reportId = `export-${data.countryId.toLowerCase()}-${data.month}`;
    const now = Timestamp.now();
    const report: TaxReport = {
      type: 'accounting_export',
      countryId: data.countryId,
      period: data.month,
      status: 'ready',
      sellersCount: null,
      totals: { grossCents: totals.debitCents, feesCents: 0, vatCents: lines.filter((l) => l.account === '44571').reduce((s, l) => s + l.creditCents - l.debitCents, 0) },
      file: null,
      submittedAt: null,
      submissionReference: null,
      error: null,
      generatedBy: caller.uid,
      createdAt: now,
      createdBy: caller.uid,
      updatedAt: now,
      updatedBy: caller.uid,
    };
    await db.collection(COLLECTIONS.taxReports).doc(reportId).set(report);
    await writeAudit({ actor: actorFromCaller(caller, 'admin'), action: 'accounting.exported', target: { type: 'other', id: reportId, label: `Export comptable ${data.countryId} ${data.month}` }, reason: data.reason, after: { lines: lines.length, ...totals }, countryId: data.countryId, request, sensitive: true });
    const country = await loadCountry(data.countryId);
    const issuer = { legalName: country?.billingEntity?.legalName ?? 'Ciyou Eats', registrationNumber: country?.billingEntity?.registrationNumber || null };
    return { reportId, month: data.month, countryId: data.countryId, lines, totals, issuer };
  },
  { ...ARGENT_HEAVY_RUNTIME },
);
