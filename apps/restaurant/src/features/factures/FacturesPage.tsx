import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { limit, orderBy, query, where } from 'firebase/firestore';
import { AlertTriangle, Download, FileMinus, FileText, Files, Percent, Receipt, Scale } from 'lucide-react';
import {
  Badge,
  Button,
  DataTable,
  EmptyState,
  IconButton,
  PageContainer,
  PageHeader,
  SegmentedControl,
  Sheet,
  SheetBody,
  SheetContent,
  SheetFooter,
  SheetHeader,
  Skeleton,
  StatCard,
  StatusPill,
  Tooltip,
  createColumnHelper,
  formatDate,
  toast,
  type DataTableFilter,
} from '@golink/ui';
import { useDocumentTitle } from '@golink/web';
import { COLLECTIONS, INVOICE_KIND_LABELS, INVOICE_STATUS_LABELS, type Invoice, type InvoiceKind, type InvoiceStatus, type WithId } from '@golink/shared';
import { useRestaurantAccess } from '@/auth/RestaurantAccess';
import { collectionAt, errorMessage, toDate, useCollection, useMutation } from '@/lib/firestore';
import { Callout, DetailRow, ErrorPanel } from '../finances/components/States';
import { downloadCsv, downloadXlsx, type Sheet as ExportSheet } from '../finances/lib/export';
import { INVOICE_TONES, bpsLabel, eur, plural } from '../finances/lib/format';
import { downloadInvoicePdf } from './invoicePdf';

const column = createColumnHelper<WithId<Invoice>>();
const day = (value: string) => formatDate(new Date(`${value}T12:00:00`));
const KIND_TONES: Partial<Record<InvoiceKind, 'brand' | 'info' | 'plum' | 'success'>> = {
  commission_invoice: 'brand',
  subscription_invoice: 'info',
  sponsored_invoice: 'plum',
  credit_note: 'success',
};

function periodText(invoice: Invoice): string {
  if (!invoice.periodStart) return '—';
  const start = new Date(`${invoice.periodStart}T12:00:00`);
  return start.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
}

/** Signe comptable : un avoir vient en déduction. */
const signed = (invoice: Invoice, cents: number) => (invoice.kind === 'credit_note' ? -cents : cents);

/** Factures GoLink mensuelles (commissions, abonnement, mises en avant) et avoirs. */
export function FacturesPage() {
  useDocumentTitle('Factures · GoLink Restaurant');
  const navigate = useNavigate();
  const { invoiceId } = useParams();
  const { restaurant, restaurantId } = useRestaurantAccess();
  const invoices = useCollection<Invoice>(
    query(
      collectionAt(COLLECTIONS.invoices),
      where('recipient.type', '==', 'restaurant'),
      where('recipient.id', '==', restaurantId),
      orderBy('issuedAt', 'desc'),
      limit(500),
    ),
  );
  const years = useMemo(
    () => [...new Set(invoices.data.map((i) => toDate(i.issuedAt)?.getFullYear()).filter((y): y is number => Boolean(y)))].sort((a, b) => b - a),
    [invoices.data],
  );
  const [yearChoice, setYear] = useState<string>('');
  const year = yearChoice || String(years[0] ?? new Date().getFullYear());
  const list = invoices.data.filter((i) => String(toDate(i.issuedAt)?.getFullYear()) === year);
  const unpaid = invoices.data.filter((i) => i.status === 'overdue' || (i.status === 'issued' && i.kind !== 'credit_note'));
  const selected = invoices.data.find((i) => i.id === invoiceId) ?? null;

  const ht = list.reduce((s, i) => s + signed(i, i.totalHtCents), 0);
  const vat = list.reduce((s, i) => s + signed(i, i.totalVatCents), 0);
  const ttc = list.reduce((s, i) => s + signed(i, i.totalTtcCents), 0);
  const credits = list.filter((i) => i.kind === 'credit_note');

  const pdf = useMutation(downloadInvoicePdf, { success: 'Facture téléchargée.' });

  const columns = useMemo(
    () => [
      column.accessor('number', {
        header: 'Numéro',
        cell: (info) => (
          <div>
            <p className="font-mono text-sm font-medium text-fg">{info.getValue()}</p>
            <p className="text-xs text-fg-subtle">{toDate(info.row.original.issuedAt) ? `Émise le ${formatDate(toDate(info.row.original.issuedAt) as Date)}` : ''}</p>
          </div>
        ),
      }),
      column.accessor('kind', {
        header: 'Type',
        cell: (info) => <Badge tone={KIND_TONES[info.getValue()] ?? 'neutral'}>{INVOICE_KIND_LABELS[info.getValue()]}</Badge>,
      }),
      column.accessor((row) => row.periodStart ?? '', { id: 'period', header: 'Période', meta: { className: 'hidden md:table-cell' }, cell: (info) => <span className="text-sm capitalize text-fg-muted">{periodText(info.row.original)}</span> }),
      column.accessor('totalHtCents', { header: 'HT', meta: { align: 'right', className: 'hidden lg:table-cell' }, cell: (info) => <span className="font-mono text-sm num">{eur(signed(info.row.original, info.getValue()))}</span> }),
      column.accessor('totalVatCents', { header: 'TVA', meta: { align: 'right', className: 'hidden lg:table-cell' }, cell: (info) => <span className="font-mono text-sm text-fg-muted num">{eur(signed(info.row.original, info.getValue()))}</span> }),
      column.accessor('totalTtcCents', { header: 'TTC', meta: { align: 'right' }, cell: (info) => <span className="font-mono text-sm font-semibold num">{eur(signed(info.row.original, info.getValue()))}</span> }),
      column.accessor('status', { header: 'Statut', cell: (info) => <StatusPill tone={INVOICE_TONES[info.getValue()]}>{INVOICE_STATUS_LABELS[info.getValue()]}</StatusPill> }),
      column.display({
        id: 'actions',
        header: '',
        meta: { align: 'right', className: 'w-12' },
        cell: (info) => (
          <Tooltip content="Télécharger le PDF">
            <IconButton
              label={`Télécharger ${info.row.original.number}`}
              size="sm"
              onClick={(event) => {
                event.stopPropagation();
                void pdf.mutate(info.row.original);
              }}
            >
              <Download />
            </IconButton>
          </Tooltip>
        ),
      }),
    ],
    [pdf],
  );

  const filters: DataTableFilter<WithId<Invoice>>[] = [
    {
      id: 'kind',
      label: 'Type',
      options: (Object.keys(INVOICE_KIND_LABELS) as InvoiceKind[]).filter((k) => list.some((i) => i.kind === k)).map((k) => ({ value: k, label: INVOICE_KIND_LABELS[k] })),
      getValue: (row) => row.kind,
    },
    {
      id: 'status',
      label: 'Statut',
      options: (Object.keys(INVOICE_STATUS_LABELS) as InvoiceStatus[]).filter((s) => list.some((i) => i.status === s)).map((s) => ({ value: s, label: INVOICE_STATUS_LABELS[s] })),
      getValue: (row) => row.status,
    },
  ];

  function sheetOf(rows: WithId<Invoice>[]): ExportSheet {
    return {
      name: 'Factures',
      columns: [
        { header: 'Numéro', width: 22 },
        { header: 'Type', width: 26 },
        { header: 'Date d’émission', kind: 'date', width: 16 },
        { header: 'Période', width: 16 },
        { header: 'HT', kind: 'money' },
        { header: 'TVA', kind: 'money' },
        { header: 'TTC', kind: 'money' },
        { header: 'Statut', width: 16 },
        { header: 'Réglée le', kind: 'date', width: 12 },
      ],
      rows: rows.map((i) => [
        i.number,
        INVOICE_KIND_LABELS[i.kind],
        toDate(i.issuedAt),
        periodText(i),
        signed(i, i.totalHtCents),
        signed(i, i.totalVatCents),
        signed(i, i.totalTtcCents),
        INVOICE_STATUS_LABELS[i.status],
        toDate(i.paidAt),
      ]),
      totals: ['Total', '', '', '', rows.reduce((s, i) => s + signed(i, i.totalHtCents), 0), rows.reduce((s, i) => s + signed(i, i.totalVatCents), 0), rows.reduce((s, i) => s + signed(i, i.totalTtcCents), 0), '', ''],
    };
  }

  async function downloadMany(rows: WithId<Invoice>[]) {
    let failed = 0;
    for (const invoice of rows) {
      try {
        await downloadInvoicePdf(invoice);
        await new Promise((resolve) => setTimeout(resolve, 350));
      } catch (error) {
        failed += 1;
        toast.error(errorMessage(error));
      }
    }
    if (!failed) toast.success(`${plural(rows.length, 'facture téléchargée', 'factures téléchargées')}.`);
  }

  return (
    <PageContainer>
      <PageHeader
        eyebrow="Finances"
        title="Factures"
        description="Factures mensuelles de GoLink (commissions, abonnement, mises en avant) et avoirs. Conservées dix ans."
        actions={
          <Button
            variant="secondary"
            leftIcon={<Download />}
            disabled={list.length === 0}
            onClick={() => void downloadXlsx([sheetOf(list)], `factures-${restaurantId}-${year}`, { title: `Factures GoLink · ${restaurant.name}`, subtitle: `Année ${year}` }).then(() => toast.success('Récapitulatif téléchargé.'))}
          >
            Récapitulatif {year}
          </Button>
        }
      >
        {years.length > 1 && (
          <SegmentedControl aria-label="Année" value={year} onValueChange={setYear} options={years.map((y) => ({ value: String(y), label: String(y) }))} />
        )}
      </PageHeader>

      {invoices.error ? (
        <ErrorPanel error={invoices.error} />
      ) : (
        <div className="space-y-6">
          {unpaid.filter((i) => i.status === 'overdue').map((invoice) => (
            <Callout
              key={invoice.id}
              tone="danger"
              icon={<AlertTriangle />}
              title={`Facture ${invoice.number} en retard de paiement · ${eur(invoice.totalTtcCents)}`}
              action={
                <Button size="sm" variant="secondary" asChild>
                  <Link to="/abonnement">Régulariser</Link>
                </Button>
              }
            >
              {INVOICE_KIND_LABELS[invoice.kind]} de {periodText(invoice)}. Sans règlement, certaines fonctions de votre formule peuvent être restreintes.
            </Callout>
          ))}

          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard label={`Facturé en ${year} (TTC)`} value={eur(ttc)} icon={<Receipt />} loading={invoices.loading} footer={plural(list.length - credits.length, 'facture')} />
            <StatCard label="Total HT" value={eur(ht)} icon={<Scale />} tone="info" loading={invoices.loading} footer="Charges déductibles de votre résultat" />
            <StatCard label="TVA récupérable" value={eur(vat)} icon={<Percent />} tone="amber" loading={invoices.loading} footer="À déduire dans votre déclaration de TVA" />
            <StatCard
              label="Avoirs"
              value={eur(credits.reduce((s, i) => s + i.totalTtcCents, 0))}
              icon={<FileMinus />}
              tone="success"
              loading={invoices.loading}
              footer={credits.length ? plural(credits.length, 'avoir émis', 'avoirs émis') : 'Aucun avoir sur l’année'}
            />
          </div>

          <DataTable
            data={list}
            columns={columns}
            getRowId={(row) => row.id}
            loading={invoices.loading}
            filters={filters}
            searchPlaceholder="Numéro de facture…"
            itemLabel="factures"
            pageSize={12}
            onRowClick={(row) => navigate(`/factures/${row.id}`)}
            bulkActions={[
              { label: 'Télécharger les PDF', icon: <Files />, onClick: (rows, clear) => void downloadMany(rows).then(clear) },
              { label: 'Exporter (CSV)', icon: <Download />, onClick: (rows) => downloadCsv(sheetOf(rows), `factures-${restaurantId}-selection`) },
            ]}
            emptyState={<EmptyState compact icon={<FileText />} title="Aucune facture cette année" description="Votre première facture de commissions est émise au début du mois suivant vos premières ventes." />}
          />
        </div>
      )}

      <Sheet open={Boolean(invoiceId)} onOpenChange={(open) => !open && navigate('/factures')}>
        <SheetContent className="sm:max-w-xl">
          {selected ? (
            <InvoiceDetail invoice={selected} all={invoices.data} onDownload={() => void pdf.mutate(selected)} downloading={pdf.loading} />
          ) : (
            <>
              <SheetHeader title="Facture" />
              <SheetBody>{invoices.loading ? <Skeleton className="h-40 w-full" /> : <EmptyState compact title="Facture introuvable" description="Cette facture n’existe pas ou n’est pas adressée à cet établissement." />}</SheetBody>
            </>
          )}
        </SheetContent>
      </Sheet>
    </PageContainer>
  );
}

function InvoiceDetail({ invoice, all, onDownload, downloading }: { invoice: WithId<Invoice>; all: WithId<Invoice>[]; onDownload: () => void; downloading: boolean }) {
  const issued = toDate(invoice.issuedAt);
  const due = toDate(invoice.dueAt);
  const paid = toDate(invoice.paidAt);
  const credited = invoice.creditedInvoiceId ? all.find((i) => i.id === invoice.creditedInvoiceId) : null;
  const creditNotes = all.filter((i) => invoice.creditNoteIds?.includes(i.id));
  return (
    <>
      <SheetHeader title={`${invoice.kind === 'credit_note' ? 'Avoir' : 'Facture'} ${invoice.number}`} description={INVOICE_KIND_LABELS[invoice.kind]} icon={invoice.kind === 'credit_note' ? <FileMinus /> : <FileText />} />
      <SheetBody className="space-y-6">
        <div className="rounded-xl border border-border bg-surface-2 p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs text-fg-subtle">Total TTC</p>
              <p className="mt-1 font-display text-3xl font-semibold tracking-display text-fg num">{eur(signed(invoice, invoice.totalTtcCents))}</p>
            </div>
            <StatusPill tone={INVOICE_TONES[invoice.status]}>{INVOICE_STATUS_LABELS[invoice.status]}</StatusPill>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
            <div>
              <p className="text-xs text-fg-subtle">Émise le</p>
              <p className="text-fg">{issued ? formatDate(issued) : '—'}</p>
            </div>
            <div>
              <p className="text-xs text-fg-subtle">{paid ? 'Réglée le' : 'Échéance'}</p>
              <p className="text-fg">{paid ? formatDate(paid) : due ? formatDate(due) : '—'}</p>
            </div>
            <div>
              <p className="text-xs text-fg-subtle">Période</p>
              <p className="text-fg">{invoice.periodStart && invoice.periodEnd ? `${day(invoice.periodStart)} – ${day(invoice.periodEnd)}` : '—'}</p>
            </div>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          {[{ title: 'Émetteur', p: invoice.issuer }, { title: 'Client', p: invoice.recipient }].map(({ title, p }) => (
            <div key={title} className="rounded-xl border border-border p-3 text-sm">
              <p className="eyebrow mb-1.5">{title}</p>
              <p className="font-medium text-fg">{p.name}</p>
              <p className="text-fg-muted">{p.address}</p>
              {p.vatNumber && <p className="text-xs text-fg-subtle">TVA {p.vatNumber}</p>}
              {p.registrationNumber && <p className="text-xs text-fg-subtle">{p.registrationNumber}</p>}
            </div>
          ))}
        </div>

        <section>
          <p className="eyebrow mb-2">Lignes</p>
          <ul className="divide-y divide-border rounded-xl border border-border">
            {invoice.lines.map((line, index) => (
              <li key={index} className="flex items-start justify-between gap-3 px-3 py-2.5 text-sm">
                <div className="min-w-0">
                  <p className="text-fg">{line.label}</p>
                  <p className="text-xs text-fg-subtle">
                    {line.quantity} × {eur(line.unitHtCents)} HT · TVA {bpsLabel(line.vatRateBps)}
                  </p>
                </div>
                <span className="shrink-0 font-mono text-fg num">{eur(line.htCents)}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="divide-y divide-border">
          {invoice.vatSummary.map((v) => (
            <DetailRow key={v.rateBps} label={`TVA ${bpsLabel(v.rateBps)}`} hint={`sur ${eur(v.htCents)} HT`} value={eur(v.vatCents)} />
          ))}
          <DetailRow label="Total HT" value={eur(invoice.totalHtCents)} />
          <DetailRow label="Total TTC" value={eur(invoice.totalTtcCents)} strong />
        </section>

        {(credited || creditNotes.length > 0) && (
          <section>
            <p className="eyebrow mb-2">{credited ? 'Facture d’origine' : 'Avoirs liés'}</p>
            {[...(credited ? [credited] : []), ...creditNotes].map((linked) => (
              <Link key={linked.id} to={`/factures/${linked.id}`} className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-sm hover:bg-surface-2">
                <span className="font-mono">{linked.number}</span>
                <span className="font-mono text-fg-muted num">{eur(linked.totalTtcCents)}</span>
              </Link>
            ))}
          </section>
        )}

        {invoice.legalMentions?.length > 0 && (
          <ul className="space-y-1 text-xs text-fg-subtle">
            {invoice.legalMentions.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        )}
      </SheetBody>
      <SheetFooter>
        <Button variant="primary" leftIcon={<Download />} loading={downloading} onClick={onDownload}>
          Télécharger le PDF
        </Button>
      </SheetFooter>
    </>
  );
}
