// Relevé détaillé d'un reversement : données fournies par la fonction
// `generateStatement` (vérification des droits côté serveur), mise en page PDF.
import { PAYOUT_STATUS_LABELS, type LedgerEntryType, type PayoutStatus } from '@golink/shared';
import { formatDate, formatNumber } from '@golink/ui';
import { callFunction } from '@/lib/firestore';
import { LEDGER_LABELS, eur } from '../finances/lib/format';
import { createPdf, generatedFooter } from '../finances/lib/pdf';

export interface StatementResult {
  payout: {
    id: string;
    periodStart: string;
    periodEnd: string;
    status: PayoutStatus;
    grossCents: number;
    commissionCents: number;
    refundsChargedCents: number;
    adjustmentsCents: number;
    tipsCents: number;
    cashDeductedCents: number;
    netCents: number;
    scheduledFor: string | null;
    paidAt: string | null;
    providerTransferId: string | null;
    failureReason: string | null;
  };
  restaurant: { id: string; name: string; legalName: string | null; siret: string | null; vatNumber: string | null; address: string; ibanMasked: string | null };
  issuer: { legalName: string; vatNumber: string; registrationNumber: string; address: string };
  lines: Array<{
    entryId: string;
    bookingDate: string;
    type: LedgerEntryType;
    description: string;
    orderId: string | null;
    refundId: string | null;
    amountCents: number;
    vatCents: number | null;
  }>;
  orderNumbers: Record<string, string>;
  totals: { byType: Record<string, number>; vatCents: number; linesCount: number };
  generatedAt: string;
}

export const generateStatement = callFunction<{ payoutId: string }, StatementResult>('generateStatement');

const day = (value: string) => formatDate(new Date(`${value}T12:00:00`));
const minus = (cents: number) => (cents ? `-${eur(cents)}` : eur(0));

/** Télécharge le relevé PDF d'un reversement. */
export async function downloadStatementPdf(payoutId: string): Promise<void> {
  const s = await generateStatement({ payoutId });
  const p = s.payout;
  const pdf = await createPdf({
    title: 'Relevé de reversement',
    subtitle: [`Période du ${day(p.periodStart)} au ${day(p.periodEnd)}`, `Référence ${p.id}`],
    footer: generatedFooter(s.restaurant.name),
  });
  pdf.columns([
    {
      title: 'Émetteur',
      lines: [s.issuer.legalName, s.issuer.address, s.issuer.registrationNumber, s.issuer.vatNumber ? `TVA ${s.issuer.vatNumber}` : ''].filter(Boolean),
    },
    {
      title: 'Bénéficiaire',
      lines: [
        s.restaurant.legalName ?? s.restaurant.name,
        s.restaurant.legalName ? `Enseigne ${s.restaurant.name}` : '',
        s.restaurant.address,
        s.restaurant.siret ? `SIRET ${s.restaurant.siret}` : '',
        s.restaurant.ibanMasked ? `Compte ${s.restaurant.ibanMasked}` : '',
      ].filter(Boolean),
    },
  ]);
  pdf.kpis([
    { label: 'Ventes', value: eur(p.grossCents) },
    { label: 'Commission TTC', value: minus(p.commissionCents) },
    { label: 'Retenues', value: minus(p.refundsChargedCents - p.adjustmentsCents) },
    { label: 'Net versé', value: eur(p.netCents), accent: true },
  ]);
  pdf.heading('Récapitulatif');
  const recap: string[][] = [
    ['Ventes livrées (après remises financées)', eur(p.grossCents)],
    ['Commission Ciyou Eats TTC', minus(p.commissionCents)],
    ['Remboursements imputés', minus(p.refundsChargedCents)],
  ];
  if (p.adjustmentsCents) recap.push(['Ajustements', eur(p.adjustmentsCents)]);
  if (p.tipsCents) recap.push(['Pourboires reversés', eur(p.tipsCents)]);
  if (p.cashDeductedCents) recap.push(['Espèces déjà encaissées', minus(p.cashDeductedCents)]);
  pdf.table({ head: ['Poste', 'Montant'], body: recap, foot: ['Net du reversement', eur(p.netCents)], rightAligned: [1] });
  const statusLine = [
    `Statut : ${PAYOUT_STATUS_LABELS[p.status]}`,
    p.scheduledFor ? `date prévue le ${formatDate(new Date(p.scheduledFor))}` : '',
    p.paidAt ? `payé le ${formatDate(new Date(p.paidAt))}` : '',
    p.providerTransferId ? `référence bancaire ${p.providerTransferId}` : '',
  ].filter(Boolean);
  pdf.paragraph(`${statusLine.join(' · ')}.`);
  if (p.failureReason) pdf.paragraph(`Motif de l’échec : ${p.failureReason}`);
  pdf.heading(`Détail des mouvements (${formatNumber(s.lines.length)})`);
  pdf.table({
    head: ['Date', 'Commande', 'Mouvement', 'TVA incluse', 'Montant'],
    body: s.lines.map((line) => [
      day(line.bookingDate),
      line.orderId ? (s.orderNumbers[line.orderId] ?? line.orderId) : '—',
      LEDGER_LABELS[line.type] ?? line.description,
      line.vatCents ? eur(line.vatCents) : '',
      eur(line.amountCents),
    ]),
    foot: ['', '', 'Total des mouvements', s.totals.vatCents ? eur(s.totals.vatCents) : '', eur(s.lines.reduce((sum, line) => sum + line.amountCents, 0))],
    rightAligned: [3, 4],
  });
  pdf.paragraph('La TVA sur commission figure sur votre facture mensuelle de commissions Ciyou Eats. Ce relevé ne constitue pas une facture.');
  if (p.status === 'paid') pdf.stamp('Payé', 'success');
  else if (p.status === 'failed' || p.status === 'on_hold') pdf.stamp(PAYOUT_STATUS_LABELS[p.status], 'danger');
  pdf.save(`releve-${s.restaurant.id}-${p.periodStart}`);
}
