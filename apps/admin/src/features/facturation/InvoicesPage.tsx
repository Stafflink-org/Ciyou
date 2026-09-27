import { useEffect, useMemo, useState } from 'react';
import { collection, orderBy, query, where } from 'firebase/firestore';
import { AlertOctagon, CalendarRange, CheckCircle2, FileMinus2, FileStack, FileText, Percent, Undo2 } from 'lucide-react';
import {
  Badge,
  Button,
  DataTable,
  EmptyState,
  FormField,
  Input,
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
  StatusBadge,
  createColumnHelper,
  formatDate,
} from '@golink/ui';
import {
  COLLECTIONS,
  INVOICE_KIND_LABELS,
  INVOICE_STATUS_LABELS,
  type Invoice,
  type InvoiceKind,
  type MonthlyInvoicesResult,
  type WithId,
} from '@golink/shared';
import { useDocumentTitle } from '@golink/web';
import { useCan } from '@/auth/AdminAccess';
import { useGeoScope } from '@/layout/GeoScope';
import { db } from '@/lib/firebase';
import { docAt, errorMessage, toDate, useDoc, useInfiniteCollection, useMutation } from '@/lib/firestore';
import { generateMonthlyInvoicesNow, issueCreditNote, markInvoicePaid } from '../argent-commun/api';
import { ActionDialog, Callout, DetailRow, ErrorPanel, ExportMenu, Money } from '../argent-commun/components';
import { downloadCsv, downloadXlsx, type Sheet as ExportSheet } from '../argent-commun/export';
import { bps, eur, monthLabel, parseEuros, periodLabel, plural, previousMonth } from '../argent-commun/format';
import { scopeConstraints } from '../argent-commun/hooks';
import { INVOICE_STATUS } from '../argent-commun/status';
import { downloadInvoicePdf } from './invoice-pdf';
import { FacturationNav } from './nav';

type Row = WithId<Invoice>;
const col = createColumnHelper<Row>();

type KindFilter = 'all' | 'restaurants' | 'drivers' | 'customers' | 'credits';
const KIND_GROUPS: Record<Exclude<KindFilter, 'all'>, InvoiceKind[]> = {
  restaurants: ['commission_invoice', 'subscription_invoice', 'sponsored_invoice'],
  drivers: ['driver_statement'],
  customers: ['customer_receipt'],
  credits: ['credit_note'],
};

/** Facturation (cahier §16) : factures aux commerces, relevés livreurs, justificatifs clients, avoirs. */
export function InvoicesPage() {
  useDocumentTitle('Facturation · GoLink Admin');
  const can = useCan();
  const geo = useGeoScope();
  const [kind, setKind] = useState<KindFilter>('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [monthly, setMonthly] = useState(false);

  const q = useMemo(
    () =>
      query(
        collection(db, COLLECTIONS.invoices),
        ...(kind === 'all' ? [] : [where('kind', 'in', KIND_GROUPS[kind])]),
        ...scopeConstraints(geo),
        orderBy('issuedAt', 'desc'),
      ),
    [kind, geo.cityIds, geo.countryId],
  );
  const list = useInfiniteCollection<Invoice>(q, { pageSize: 150 });
  const thisMonth = new Date().toISOString().slice(0, 7);
  const stats = useMemo(() => {
    const month = list.data.filter((i) => (toDate(i.issuedAt)?.toISOString().slice(0, 7) ?? '') === thisMonth);
    const platform = month.filter((i) => i.issuer.type === 'platform' && i.kind !== 'credit_note');
    const overdue = list.data.filter((i) => i.status === 'overdue');
    const credits = month.filter((i) => i.kind === 'credit_note');
    return {
      issued: { count: month.filter((i) => i.kind !== 'credit_note').length, ttc: month.filter((i) => i.kind !== 'credit_note').reduce((s, i) => s + i.totalTtcCents, 0) },
      vat: platform.reduce((s, i) => s + i.totalVatCents, 0),
      overdue: { count: overdue.length, ttc: overdue.reduce((s, i) => s + i.totalTtcCents, 0) },
      credits: { count: credits.length, ttc: credits.reduce((s, i) => s + i.totalTtcCents, 0) },
    };
  }, [list.data, thisMonth]);

  const columns = useMemo(
    () => [
      col.accessor('number', {
        header: 'Numéro',
        cell: (info) => (
          <div>
            <p className="font-mono text-sm font-medium text-fg">{info.getValue()}</p>
            <p className="text-xs text-fg-subtle">{INVOICE_KIND_LABELS[info.row.original.kind]}</p>
          </div>
        ),
      }),
      col.accessor((r) => (r.kind === 'driver_statement' ? r.issuer.name : r.recipient.name), {
        id: 'party',
        header: 'Tiers',
        cell: (info) => (
          <div className="min-w-0">
            <p className="max-w-64 truncate text-fg">{info.getValue()}</p>
            <p className="text-xs text-fg-subtle">{info.row.original.periodStart && info.row.original.periodEnd ? periodLabel(info.row.original.periodStart, info.row.original.periodEnd) : info.row.original.orderId ? `Commande ${info.row.original.orderId}` : ''}</p>
          </div>
        ),
      }),
      col.accessor((r) => toDate(r.issuedAt)?.getTime() ?? 0, { id: 'issued', header: 'Émise le', cell: (info) => <span className="whitespace-nowrap text-fg-muted">{info.getValue() ? formatDate(info.getValue()) : '—'}</span> }),
      col.accessor('totalHtCents', { header: 'HT', meta: { align: 'right' }, cell: (info) => <Money cents={info.getValue()} className="text-fg-muted" /> }),
      col.accessor('totalVatCents', { header: 'TVA', meta: { align: 'right' }, cell: (info) => <Money cents={info.getValue()} className="text-fg-muted" /> }),
      col.accessor('totalTtcCents', { header: 'TTC', meta: { align: 'right' }, cell: (info) => <Money cents={info.getValue()} className="font-semibold text-fg" /> }),
      col.accessor('status', {
        header: 'Statut',
        cell: (info) => (
          <div className="flex flex-wrap items-center gap-1.5">
            <StatusBadge status={info.getValue()} map={INVOICE_STATUS} />
            {(info.row.original.creditedCents ?? 0) > 0 && info.getValue() !== 'credited' && <Badge size="sm" tone="neutral" variant="outline">Avoir partiel</Badge>}
          </div>
        ),
      }),
    ],
    [],
  );

  async function onExport(format: 'csv' | 'xlsx' | 'pdf') {
    const sheet: ExportSheet = {
      name: 'Factures',
      columns: [
        { header: 'Numéro', width: 22 },
        { header: 'Type', width: 24 },
        { header: 'Émetteur', width: 30 },
        { header: 'Destinataire', width: 30 },
        { header: 'Émise le', kind: 'date' },
        { header: 'Début de période', kind: 'date' },
        { header: 'Fin de période', kind: 'date' },
        { header: 'Total HT', kind: 'money' },
        { header: 'TVA', kind: 'money' },
        { header: 'Total TTC', kind: 'money' },
        { header: 'Statut', width: 16 },
        { header: 'Facture d’origine', width: 22 },
      ],
      rows: list.data.map((i) => [i.number, INVOICE_KIND_LABELS[i.kind], i.issuer.name, i.recipient.name, toDate(i.issuedAt) ?? null, i.periodStart ?? null, i.periodEnd ?? null, i.totalHtCents, i.totalVatCents, i.totalTtcCents, INVOICE_STATUS_LABELS[i.status], i.creditedInvoiceId ?? '']),
    };
    if (format === 'csv') downloadCsv(sheet, 'golink-factures');
    else await downloadXlsx([sheet], 'golink-factures', { title: 'GoLink · Factures et avoirs', subtitle: geo.label });
  }

  return (
    <PageContainer wide>
      <PageHeader
        eyebrow={`Argent · ${geo.label}`}
        title="Facturation et TVA"
        description="Chaque commande, commission et abonnement produit ses pièces, numérotées sans trou et conservées dix ans. Une facture n’est jamais supprimée : on émet un avoir."
        actions={
          can('invoices.issue') ? (
            <Button variant="primary" size="sm" leftIcon={<CalendarRange />} onClick={() => setMonthly(true)}>
              Facturation mensuelle
            </Button>
          ) : undefined
        }
      >
        <FacturationNav />
      </PageHeader>

      <div className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard label={`Émises en ${monthLabel(thisMonth).toLowerCase()}`} icon={<FileStack />} tone="brand" loading={list.loading} value={eur(stats.issued.ttc)} footer={plural(stats.issued.count, 'pièce')} />
          <StatCard label="TVA facturée par GoLink (mois)" icon={<Percent />} tone="info" loading={list.loading} value={eur(stats.vat)} footer="Factures de commissions, abonnements, mises en avant" />
          <StatCard label="En retard de paiement" icon={<AlertOctagon />} tone="danger" loading={list.loading} value={eur(stats.overdue.ttc)} footer={plural(stats.overdue.count, 'facture')} />
          <StatCard label="Avoirs émis (mois)" icon={<Undo2 />} tone="neutral" loading={list.loading} value={eur(Math.abs(stats.credits.ttc))} footer={plural(stats.credits.count, 'avoir')} />
        </div>

        <div data-scroll-ok className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
          <SegmentedControl
            aria-label="Type de pièce"
            value={kind}
            onValueChange={(v) => setKind(v as KindFilter)}
            options={[
              { value: 'all', label: 'Toutes' },
              { value: 'restaurants', label: 'Commerces' },
              { value: 'drivers', label: 'Relevés livreurs' },
              { value: 'customers', label: 'Justificatifs clients' },
              { value: 'credits', label: 'Avoirs' },
            ]}
          />
        </div>

        {list.error ? (
          <ErrorPanel error={list.error} />
        ) : (
          <>
            <DataTable
              data={list.data}
              columns={columns}
              loading={list.loading}
              getRowId={(r) => r.id}
              onRowClick={(r) => setSelectedId(r.id)}
              searchPlaceholder="Numéro, commerce, livreur…"
              itemLabel="pièces"
              pageSize={15}
              filters={[{ id: 'status', label: 'Statut', options: Object.entries(INVOICE_STATUS_LABELS).map(([value, label]) => ({ value, label })), getValue: (r) => r.status }]}
              toolbar={<ExportMenu onExport={onExport} disabled={!list.data.length} />}
              emptyState={<EmptyState icon={<FileText />} title="Aucune pièce" description="Aucune facture ne correspond à ce filtre dans votre périmètre." />}
            />
            {list.hasMore && (
              <div className="flex justify-center">
                <Button variant="secondary" size="sm" loading={list.loadingMore} onClick={list.loadMore}>
                  Charger des pièces plus anciennes
                </Button>
              </div>
            )}
          </>
        )}
      </div>

      <Sheet open={Boolean(selectedId)} onOpenChange={(o) => !o && setSelectedId(null)}>
        <SheetContent className="w-full sm:max-w-xl">{selectedId && <InvoiceSheet invoiceId={selectedId} onOpen={setSelectedId} />}</SheetContent>
      </Sheet>
      <MonthlyDialog open={monthly} onOpenChange={setMonthly} />
    </PageContainer>
  );
}

function InvoiceSheet({ invoiceId, onOpen }: { invoiceId: string; onOpen: (id: string) => void }) {
  const can = useCan();
  const { data: invoice, loading, error } = useDoc<Invoice>(docAt(`${COLLECTIONS.invoices}/${invoiceId}`));
  const [dialog, setDialog] = useState<null | 'credit' | 'paid'>(null);
  const [amount, setAmount] = useState('');
  const [partial, setPartial] = useState(false);
  const credit = useMutation(issueCreditNote, { success: (r) => `Avoir ${r.number} émis` });
  const paid = useMutation(markInvoicePaid, { success: 'Facture marquée comme payée' });
  const [downloading, setDownloading] = useState(false);

  if (loading) return <div className="space-y-3 p-6"><Skeleton className="h-10 w-2/3" /><Skeleton className="h-64 w-full" /></div>;
  if (error || !invoice) return <div className="p-6"><ErrorPanel error={error ?? new Error('Facture introuvable')} compact /></div>;

  const remaining = invoice.totalTtcCents - (invoice.creditedCents ?? 0);
  const cents = partial ? parseEuros(amount) : remaining;
  const canCredit = can('invoices.issue') && invoice.kind !== 'credit_note' && remaining > 0;
  const canMarkPaid = can('invoices.issue') && ['issued', 'overdue'].includes(invoice.status) && invoice.kind !== 'credit_note';

  return (
    <>
      <SheetHeader title={invoice.number} description={`${INVOICE_KIND_LABELS[invoice.kind]} · émise le ${toDate(invoice.issuedAt) ? formatDate(toDate(invoice.issuedAt) as Date) : '—'}`} icon={<FileText />} />
      <SheetBody className="space-y-6">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={invoice.status} map={INVOICE_STATUS} />
          {invoice.selfBilling && <Badge tone="info" size="sm">Autofacturation</Badge>}
          {invoice.periodStart && invoice.periodEnd && <Badge tone="neutral" size="sm">{periodLabel(invoice.periodStart, invoice.periodEnd)}</Badge>}
        </div>
        {invoice.kind === 'credit_note' && invoice.creditedInvoiceId && (
          <Callout tone="info" title="Avoir" action={<Button size="sm" variant="secondary" onClick={() => onOpen(invoice.creditedInvoiceId as string)}>Voir la facture d’origine</Button>}>
            {invoice.creditReason ? `Motif : ${invoice.creditReason}` : 'Annulation totale ou partielle d’une facture.'}
          </Callout>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          {[
            { title: invoice.selfBilling ? 'Prestataire' : 'Émetteur', p: invoice.issuer },
            { title: 'Destinataire', p: invoice.recipient },
          ].map(({ title, p }) => (
            <div key={title} className="rounded-xl border border-border bg-surface-2 p-4">
              <p className="eyebrow mb-2">{title}</p>
              <p className="font-medium text-fg">{p.name}</p>
              {p.address && <p className="text-sm text-fg-muted">{p.address}</p>}
              {p.registrationNumber && <p className="text-xs text-fg-subtle">{p.registrationNumber}</p>}
              {p.vatNumber && <p className="text-xs text-fg-subtle">TVA {p.vatNumber}</p>}
            </div>
          ))}
        </div>
        <div>
          <p className="eyebrow mb-2">Lignes</p>
          <ul className="divide-y divide-border rounded-xl border border-border">
            {invoice.lines.map((line, index) => (
              <li key={index} className="flex items-start justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="text-sm text-fg">{line.label}</p>
                  <p className="text-xs text-fg-subtle">{line.quantity} × {eur(line.unitHtCents)} HT · TVA {bps(line.vatRateBps)}</p>
                </div>
                <Money cents={line.htCents} className="shrink-0 text-sm text-fg" />
              </li>
            ))}
          </ul>
        </div>
        <div className="divide-y divide-border">
          {invoice.vatSummary.map((v) => (
            <DetailRow key={v.rateBps} label={`TVA ${bps(v.rateBps)}`} hint={`Base ${eur(v.htCents)}`} value={eur(v.vatCents)} />
          ))}
          <DetailRow label="Total HT" value={eur(invoice.totalHtCents)} />
          <DetailRow label="Total TTC" value={eur(invoice.totalTtcCents)} strong />
          {(invoice.creditedCents ?? 0) > 0 && <DetailRow label="Déjà crédité par avoir" value={`− ${eur(invoice.creditedCents ?? 0)}`} tone="danger" />}
        </div>
        {invoice.creditNoteIds.length > 0 && (
          <div>
            <p className="eyebrow mb-2">Avoirs liés</p>
            <div className="flex flex-wrap gap-2">
              {invoice.creditNoteIds.map((id) => (
                <Button key={id} size="xs" variant="soft" leftIcon={<FileMinus2 />} onClick={() => onOpen(id)}>
                  Ouvrir l’avoir
                </Button>
              ))}
            </div>
          </div>
        )}
        <ul className="space-y-1 text-xs text-fg-subtle">
          {invoice.legalMentions.map((m) => <li key={m}>{m}</li>)}
          <li>Conservation jusqu’au {invoice.retainUntil.split('-').reverse().join('/')}.</li>
        </ul>
      </SheetBody>
      <SheetFooter className="flex-wrap">
        {canMarkPaid && (
          <Button variant="secondary" size="sm" leftIcon={<CheckCircle2 />} onClick={() => setDialog('paid')}>
            Marquer payée
          </Button>
        )}
        {canCredit && (
          <Button variant="secondary" size="sm" leftIcon={<Undo2 />} onClick={() => setDialog('credit')}>
            Émettre un avoir
          </Button>
        )}
        <Button
          variant="primary"
          size="sm"
          leftIcon={<FileText />}
          loading={downloading}
          onClick={async () => {
            setDownloading(true);
            try {
              await downloadInvoicePdf(invoice);
            } finally {
              setDownloading(false);
            }
          }}
        >
          Télécharger le PDF
        </Button>
      </SheetFooter>

      <ActionDialog
        open={dialog === 'credit'}
        onOpenChange={(o) => setDialog(o ? 'credit' : null)}
        destructive
        icon={<Undo2 className="text-danger" />}
        title={`Avoir sur la facture ${invoice.number}`}
        description="L’avoir porte son propre numéro continu. La facture d’origine est conservée et marquée comme annulée si l’avoir est total."
        confirmLabel={cents ? `Émettre un avoir de ${eur(cents)}` : 'Émettre l’avoir'}
        disabled={!cents || cents <= 0 || cents > remaining}
        onSubmit={async (reason) => Boolean(await credit.mutate({ invoiceId, amountCents: partial ? cents : null, reason }))}
      >
        <SegmentedControl
          aria-label="Montant de l’avoir"
          value={partial ? 'partial' : 'full'}
          onValueChange={(v) => setPartial(v === 'partial')}
          options={[
            { value: 'full', label: `Total (${eur(remaining)})` },
            { value: 'partial', label: 'Partiel' },
          ]}
        />
        {partial && (
          <FormField label="Montant TTC de l’avoir" hint={`Au plus ${eur(remaining)}. Réparti au prorata des taux de TVA.`}>
            <Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} trailing="€" invalid={amount !== '' && (!cents || cents > remaining)} />
          </FormField>
        )}
      </ActionDialog>
      <ActionDialog
        open={dialog === 'paid'}
        onOpenChange={(o) => setDialog(o ? 'paid' : null)}
        icon={<CheckCircle2 />}
        title="Marquer la facture comme payée"
        description="À utiliser pour un règlement reçu hors prélèvement automatique (virement, régularisation)."
        confirmLabel="Marquer payée"
        onSubmit={async (reason) => Boolean(await paid.mutate({ invoiceId, reason }))}
      />
    </>
  );
}

function MonthlyDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const geo = useGeoScope();
  const [month, setMonth] = useState(previousMonth());
  const [preview, setPreview] = useState<MonthlyInvoicesResult | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const generate = useMutation(generateMonthlyInvoicesNow, {
    success: (r) => (r.restaurantInvoices + r.driverStatements ? `${plural(r.restaurantInvoices, 'facture')} et ${plural(r.driverStatements, 'relevé')} émis` : 'Tout était déjà facturé pour ce mois'),
  });
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setPreviewError(null);
    generateMonthlyInvoicesNow({ month, countryId: geo.countryId, dryRun: true })
      .then((r) => !cancelled && setPreview(r))
      .catch((error: unknown) => !cancelled && setPreviewError(errorMessage(error)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [open, month, geo.countryId]);
  const toIssue = preview?.preview.filter((p) => !p.exists) ?? [];
  return (
    <ActionDialog
      open={open}
      onOpenChange={onOpenChange}
      size="md"
      icon={<CalendarRange />}
      title="Facturation mensuelle"
      description="Factures aux commerces (commissions, abonnement, mises en avant, débours) et relevés d’autofacturation des livreurs. Émises automatiquement le 1er de chaque mois ; ce lancement manuel rattrape un mois manquant."
      confirmLabel={toIssue.length ? `Émettre ${plural(toIssue.length, 'pièce')}` : 'Émettre'}
      disabled={loading || toIssue.length === 0}
      requireReason={false}
      onSubmit={async () => Boolean(await generate.mutate({ month, countryId: geo.countryId }))}
    >
      <FormField label="Mois facturé" hint="Seul un mois terminé peut être facturé.">
        <Input type="month" value={month} max={previousMonth()} onChange={(e) => e.target.value && setMonth(e.target.value)} />
      </FormField>
      <div className="rounded-xl border border-border">
        <div className="flex items-center justify-between border-b border-border bg-surface-2 px-4 py-2.5">
          <p className="text-sm font-medium text-fg">{monthLabel(month)}</p>
          {preview && !loading && <p className="font-mono text-sm text-fg num">{eur(preview.totalTtcCents)} TTC à émettre</p>}
        </div>
        <div className="max-h-64 overflow-y-auto">
          {loading ? (
            <div className="space-y-2 p-4">{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-8 w-full" />)}</div>
          ) : previewError ? (
            <p className="p-4 text-sm text-danger">{previewError}</p>
          ) : !preview?.preview.length ? (
            <p className="p-4 text-sm text-fg-muted">Rien à facturer pour ce mois dans votre périmètre.</p>
          ) : (
            <ul className="divide-y divide-border">
              {preview.preview.map((p, i) => (
                <li key={`${p.recipient}-${i}`} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                  <div className="min-w-0">
                    <p className="truncate text-fg">{p.recipient}</p>
                    <p className="text-xs text-fg-subtle">{INVOICE_KIND_LABELS[p.kind as InvoiceKind] ?? p.kind}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {p.exists && <Badge tone="success" size="sm">Déjà émise</Badge>}
                    <Money cents={p.totalTtcCents} className={p.exists ? 'text-fg-subtle' : 'text-fg'} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </ActionDialog>
  );
}
