// Facture, relevé ou avoir au format PDF, à partir du document `invoices/{id}`
// (immuable après émission : le PDF reproduit exactement la pièce enregistrée).
import { INVOICE_KIND_LABELS, INVOICE_STATUS_LABELS, type Invoice } from '@golink/shared';
import { formatDate } from '@golink/ui';
import { toDate } from '@/lib/firestore';
import { bps, day, eur } from '../argent-commun/format';
import { createPdf, generatedFooter } from '../argent-commun/pdf';

const TITLES: Record<Invoice['kind'], string> = {
  customer_receipt: 'Facture',
  commission_invoice: 'Facture',
  subscription_invoice: 'Facture',
  sponsored_invoice: 'Facture',
  driver_statement: 'Relevé de prestations',
  credit_note: 'Avoir',
};

export async function downloadInvoicePdf(invoice: Invoice): Promise<void> {
  const issued = toDate(invoice.issuedAt);
  const due = toDate(invoice.dueAt);
  const paid = toDate(invoice.paidAt);
  const credit = invoice.kind === 'credit_note';
  const pdf = await createPdf({
    title: TITLES[invoice.kind],
    subtitle: [
      `N° ${invoice.number}`,
      issued ? `Émise le ${formatDate(issued)}` : '',
      invoice.periodStart && invoice.periodEnd ? `Période du ${day(invoice.periodStart)} au ${day(invoice.periodEnd)}` : '',
    ].filter(Boolean),
    footer: `${invoice.issuer.name}${invoice.issuer.registrationNumber ? ` · ${invoice.issuer.registrationNumber}` : ''} · ${generatedFooter('GoLink')}`,
    caption: 'FACTURATION',
  });
  const party = (p: Invoice['issuer']) =>
    [p.name, p.address, p.registrationNumber ?? '', p.vatNumber ? `TVA intracommunautaire ${p.vatNumber}` : '', p.email ?? ''].filter(Boolean);
  pdf.columns([
    { title: invoice.selfBilling ? 'Prestataire' : 'Émetteur', lines: party(invoice.issuer) },
    { title: invoice.selfBilling ? 'Client (émetteur par mandat)' : 'Destinataire', lines: party(invoice.recipient) },
  ]);
  pdf.paragraph(`${INVOICE_KIND_LABELS[invoice.kind]}${due && !credit ? ` · échéance le ${formatDate(due)}` : ''}${invoice.creditReason ? ` · motif : ${invoice.creditReason}` : ''}`, { size: 9 });
  pdf.table({
    head: ['Désignation', 'Qté', 'PU HT', 'TVA', 'Total HT'],
    body: invoice.lines.map((line) => [line.label, String(line.quantity), eur(line.unitHtCents), bps(line.vatRateBps), eur(line.htCents)]),
    rightAligned: [1, 2, 3, 4],
    columnWidths: { 1: 14, 2: 26, 3: 18, 4: 28 },
  });
  pdf.table({
    head: ['Taux de TVA', 'Base HT', 'Montant TVA'],
    body: invoice.vatSummary.map((v) => [bps(v.rateBps), eur(v.htCents), eur(v.vatCents)]),
    rightAligned: [1, 2],
  });
  pdf.kpis([
    { label: 'Total HT', value: eur(invoice.totalHtCents) },
    { label: 'TVA', value: eur(invoice.totalVatCents) },
    { label: credit ? 'Total de l’avoir TTC' : 'Total TTC', value: eur(invoice.totalTtcCents), accent: true },
  ]);
  if (paid) pdf.paragraph(`Réglée le ${formatDate(paid)}.`);
  for (const mention of invoice.legalMentions ?? []) pdf.paragraph(mention);
  if (!credit && invoice.kind !== 'customer_receipt' && invoice.kind !== 'driver_statement') {
    pdf.paragraph('En cas de retard de paiement : pénalités au taux légal et indemnité forfaitaire pour frais de recouvrement de 40 €. Pas d’escompte pour paiement anticipé.', { size: 7.5 });
  }
  pdf.paragraph(`Pièce conservée jusqu’au ${day(invoice.retainUntil)}.`, { size: 7.5 });
  if (invoice.status === 'paid') pdf.stamp(INVOICE_STATUS_LABELS.paid, 'success');
  else if (invoice.status === 'overdue') pdf.stamp(INVOICE_STATUS_LABELS.overdue, 'danger');
  else if (invoice.status === 'credited') pdf.stamp(INVOICE_STATUS_LABELS.credited, 'muted');
  pdf.save(`${credit ? 'avoir' : 'facture'}-${invoice.number}`);
}
