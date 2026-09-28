import { useMemo, useState } from 'react';
import { collection, limit, orderBy, query } from 'firebase/firestore';
import { BookCheck, Calculator, FileSpreadsheet, Landmark, Lock, Percent, Send, Users } from 'lucide-react';
import { Badge, Button, Card, CardContent, CardHeader, DataTable, EmptyState, FormField, Input, PageContainer, PageHeader, Select, Sheet, SheetBody, SheetContent, SheetFooter, SheetHeader, StatusBadge, createColumnHelper, formatDateTime, toast, Table } from '@golink/ui';
import { COLLECTIONS, TAX_REPORT_TYPE_LABELS, type TaxReport, type WithId } from '@golink/shared';
import { useDocumentTitle } from '@golink/web';
import { useCan } from '@/auth/AdminAccess';
import { useGeoScope } from '@/layout/GeoScope';
import { db } from '@/lib/firebase';
import { errorMessage, toDate, useCollection, useMutation } from '@/lib/firestore';
import { exportAccounting, generateTaxReport, markTaxReportSubmitted } from '../argent-commun/api';
import { ActionDialog, Callout, DetailRow, ErrorPanel, Money } from '../argent-commun/components';
import { downloadCsv, downloadFec, downloadXlsx, type Sheet as ExportSheet } from '../argent-commun/export';
import { bps, eur, monthLabel, plural, previousMonth } from '../argent-commun/format';
import { TAX_REPORT_STATUS } from '../argent-commun/status';
import { FacturationNav } from './nav';

type Row = WithId<TaxReport>;
const col = createColumnHelper<Row>();

const periodText = (r: Pick<TaxReport, 'period' | 'type'>) => (/^\d{4}$/.test(r.period) ? `Année ${r.period}` : monthLabel(r.period));

/** Déclarations aux autorités et exports (cahier §16) : DAC7, TVA, export comptable mensuel. */
export function DeclarationsPage() {
  useDocumentTitle('Déclarations et exports · Ciyou Eats Admin');
  const can = useCan();
  const geo = useGeoScope();
  const allowed = can('tax.reports');
  const countries = geo.countries;
  const [countryId, setCountryId] = useState(geo.countryId ?? countries[0]?.id ?? 'FR');
  const [year, setYear] = useState(String(new Date().getFullYear() - (new Date().getMonth() < 1 ? 1 : 0)));
  const [vatMonth, setVatMonth] = useState(previousMonth());
  const [exportMonth, setExportMonth] = useState(previousMonth());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState<Row | null>(null);
  const [reference, setReference] = useState('');
  const [exporting, setExporting] = useState<null | 'csv' | 'xlsx' | 'fec'>(null);

  const q = useMemo(() => (allowed ? query(collection(db, COLLECTIONS.taxReports), orderBy('updatedAt', 'desc'), limit(200)) : null), [allowed]);
  const reports = useCollection<TaxReport>(q);
  const rows = useMemo(() => reports.data.filter((r) => !geo.countryId || r.countryId === geo.countryId), [reports.data, geo.countryId]);
  const selected = selectedId ? (reports.data.find((r) => r.id === selectedId) ?? null) : null;
  const generate = useMutation(generateTaxReport, { success: 'Déclaration calculée' });
  const submit = useMutation(markTaxReportSubmitted, { success: 'Déclaration marquée comme transmise' });

  async function runExport(format: 'csv' | 'xlsx' | 'fec') {
    setExporting(format);
    try {
      const result = await exportAccounting({ month: exportMonth, countryId });
      if (!result.lines.length) {
        toast.info(`Aucune écriture pour ${monthLabel(exportMonth).toLowerCase()}.`);
        return;
      }
      if (format === 'fec') {
        // Dernier jour du mois exporté (clôture), sans passage par un fuseau UTC.
        const lastDay = new Date(Number(exportMonth.slice(0, 4)), Number(exportMonth.slice(5, 7)), 0).getDate();
        const closingDay = `${exportMonth}-${String(lastDay).padStart(2, '0')}`;
        downloadFec(result.lines, (result.issuer.registrationNumber ?? '000000000').replace(/\D/g, ''), closingDay);
        toast.success(`${plural(result.lines.length, 'écriture')} exportée${result.lines.length > 1 ? 's' : ''} au format FEC.`);
        return;
      }
      const sheet: ExportSheet = {
        name: 'Écritures',
        columns: [
          { header: 'JournalCode', width: 10 },
          { header: 'EcritureDate', kind: 'date', width: 12 },
          { header: 'PieceRef', width: 26 },
          { header: 'CompteNum', width: 10 },
          { header: 'CompteLib', width: 36 },
          { header: 'CompAuxLib', width: 28 },
          { header: 'EcritureLib', width: 40 },
          { header: 'Debit', kind: 'money' },
          { header: 'Credit', kind: 'money' },
        ],
        rows: result.lines.map((l) => [l.journal, l.date, l.piece, l.account, l.accountLabel, l.thirdParty ?? '', l.label, l.debitCents, l.creditCents]),
        totals: ['Total', '', '', '', '', '', `${result.lines.length} écritures`, result.totals.debitCents, result.totals.creditCents],
      };
      const name = `golink-export-comptable-${countryId}-${exportMonth}`;
      if (format === 'csv') downloadCsv(sheet, name);
      else await downloadXlsx([sheet], name, { title: `Ciyou Eats · Export comptable ${countryId}`, subtitle: monthLabel(exportMonth) });
      toast.success(`${plural(result.lines.length, 'écriture')} exportée${result.lines.length > 1 ? 's' : ''} (${result.totals.invoices} factures, ${result.totals.payouts} reversements)`);
    } catch (error) {
      toast.error(errorMessage(error, 'L’export comptable a échoué.'));
    } finally {
      setExporting(null);
    }
  }

  const columns = useMemo(
    () => [
      col.accessor('type', {
        header: 'Document',
        cell: (info) => (
          <div>
            <p className="font-medium text-fg">{TAX_REPORT_TYPE_LABELS[info.getValue()]}</p>
            <p className="text-xs text-fg-subtle">{countries.find((c) => c.id === info.row.original.countryId)?.name ?? info.row.original.countryId}</p>
          </div>
        ),
      }),
      col.accessor('period', { header: 'Période', cell: (info) => <span className="text-fg-muted">{periodText(info.row.original)}</span> }),
      col.accessor((r) => r.totals?.grossCents ?? 0, {
        id: 'totals',
        header: 'Montants',
        meta: { align: 'right' },
        cell: (info) => {
          const r = info.row.original;
          if (!r.totals) return <span className="text-fg-subtle">—</span>;
          if (r.type === 'vat') return <span className="font-mono num">TVA {eur(r.totals.vatCents)}</span>;
          if (r.type === 'dac7') return <span className="font-mono num">{eur(r.totals.grossCents)}<span className="ml-1 text-xs text-fg-subtle">· {plural(r.sellersCount ?? 0, 'déclarant')}</span></span>;
          return <span className="font-mono num">{eur(r.totals.grossCents)}</span>;
        },
      }),
      col.accessor('status', { header: 'Statut', cell: (info) => <StatusBadge status={info.getValue()} map={TAX_REPORT_STATUS} /> }),
      col.accessor((r) => toDate(r.updatedAt)?.getTime() ?? 0, { id: 'updated', header: 'Mis à jour', cell: (info) => <span className="whitespace-nowrap text-fg-muted">{info.getValue() ? formatDateTime(info.getValue()) : '—'}</span> }),
    ],
    [countries],
  );

  if (!allowed) {
    return (
      <PageContainer wide>
        <PageHeader eyebrow="Argent" title="Déclarations et exports"><FacturationNav /></PageHeader>
        <EmptyState icon={<Lock />} title="Accès réservé" description="Les déclarations fiscales et l’export comptable demandent le droit « déclarations fiscales »." />
      </PageContainer>
    );
  }

  const years = Array.from({ length: 4 }, (_, i) => String(new Date().getFullYear() - i));
  return (
    <PageContainer wide>
      <PageHeader
        eyebrow={`Argent · ${geo.label}`}
        title="Déclarations et exports"
        description="Récapitulatif annuel des revenus des vendeurs et prestataires (DAC7), TVA collectée et export mensuel pour l’expert-comptable."
      >
        <FacturationNav />
      </PageHeader>

      <div className="space-y-6">
        <Callout tone="amber" title="À faire valider par l’expert-comptable">
          Les taux de TVA et les seuils DAC7 sont paramétrés selon le droit connu. Les montants sont calculés à partir des pièces émises et de la répartition des commandes.
        </Callout>

        <div className="flex flex-wrap items-end gap-3">
          <FormField label="Pays déclarant" className="w-56">
            <Select value={countryId} onValueChange={setCountryId} options={countries.map((c) => ({ value: c.id, label: c.name }))} />
          </FormField>
        </div>

        <div className="grid gap-4 lg:grid-cols-3">
          <Card>
            <CardHeader title="DAC7" description="Déclaration annuelle des revenus des commerces et des livreurs, avant le 31 janvier." icon={<Users />} divided />
            <CardContent className="space-y-3">
              <FormField label="Année">
                <Select value={year} onValueChange={setYear} options={years.map((y) => ({ value: y, label: y }))} />
              </FormField>
              <Button variant="primary" block size="sm" leftIcon={<Calculator />} loading={generate.loading} onClick={async () => { const r = await generate.mutate({ type: 'dac7', countryId, period: year }); if (r) setSelectedId(r.reportId); }}>
                Calculer la déclaration
              </Button>
            </CardContent>
          </Card>
          <Card>
            <CardHeader title="Récapitulatif de TVA" description="TVA collectée par Ciyou Eats sur ses commissions, abonnements et frais, moins les avoirs." icon={<Percent />} divided />
            <CardContent className="space-y-3">
              <FormField label="Mois">
                <Input type="month" value={vatMonth} max={previousMonth()} onChange={(e) => e.target.value && setVatMonth(e.target.value)} />
              </FormField>
              <Button variant="primary" block size="sm" leftIcon={<Calculator />} loading={generate.loading} onClick={async () => { const r = await generate.mutate({ type: 'vat', countryId, period: vatMonth }); if (r) setSelectedId(r.reportId); }}>
                Calculer la TVA du mois
              </Button>
            </CardContent>
          </Card>
          <Card>
            <CardHeader title="Export comptable" description="Écritures du mois (ventes, achats de prestations, reversements) : format FEC réglementaire pour l'expert-comptable, ou tableur pour une lecture rapide." icon={<FileSpreadsheet />} divided />
            <CardContent className="space-y-3">
              <FormField label="Mois">
                <Input type="month" value={exportMonth} max={new Date().toISOString().slice(0, 7)} onChange={(e) => e.target.value && setExportMonth(e.target.value)} />
              </FormField>
              <Button size="sm" variant="primary" className="w-full" loading={exporting === 'fec'} disabled={Boolean(exporting)} onClick={() => void runExport('fec')}>
                Export FEC (.txt)
              </Button>
              <div className="grid grid-cols-2 gap-2">
                <Button size="sm" variant="secondary" loading={exporting === 'xlsx'} disabled={Boolean(exporting)} onClick={() => void runExport('xlsx')}>Excel</Button>
                <Button size="sm" variant="secondary" loading={exporting === 'csv'} disabled={Boolean(exporting)} onClick={() => void runExport('csv')}>CSV</Button>
              </div>
            </CardContent>
          </Card>
        </div>

        {reports.error ? (
          <ErrorPanel error={reports.error} />
        ) : (
          <DataTable
            data={rows}
            columns={columns}
            loading={reports.loading}
            getRowId={(r) => r.id}
            onRowClick={(r) => setSelectedId(r.id)}
            searchable={false}
            itemLabel="documents"
            emptyState={<EmptyState icon={<Landmark />} title="Aucune déclaration" description="Calculez une première déclaration avec les cartes ci-dessus." />}
          />
        )}
      </div>

      <Sheet open={Boolean(selected)} onOpenChange={(o) => !o && setSelectedId(null)}>
        <SheetContent className="w-full sm:max-w-2xl">
          {selected && (
            <ReportSheet
              report={selected}
              countryName={countries.find((c) => c.id === selected.countryId)?.name ?? selected.countryId}
              onSubmit={() => { setReference(''); setSubmitting(selected); }}
              onRegenerate={() => (selected.type === 'accounting_export' ? undefined : void generate.mutate({ type: selected.type, countryId: selected.countryId, period: selected.period }))}
              regenerating={generate.loading}
            />
          )}
        </SheetContent>
      </Sheet>
      <ActionDialog
        open={Boolean(submitting)}
        onOpenChange={(o) => !o && setSubmitting(null)}
        icon={<Send />}
        title="Marquer comme transmise"
        description="La déclaration sera figée : elle ne pourra plus être recalculée."
        confirmLabel="Confirmer la transmission"
        requireReason={false}
        disabled={reference.trim().length < 3}
        onSubmit={async () => Boolean(submitting && (await submit.mutate({ reportId: submitting.id, reference: reference.trim() })))}
      >
        <FormField label="Référence du dépôt" hint="Numéro d’accusé de réception de l’administration fiscale." required>
          <Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Ex. : DGFIP-DAC7-2027-0001" />
        </FormField>
      </ActionDialog>
    </PageContainer>
  );
}

function ReportSheet({ report, countryName, onSubmit, onRegenerate, regenerating }: { report: Row; countryName: string; onSubmit: () => void; onRegenerate: () => void; regenerating: boolean }) {
  const lines = report.dac7Lines ?? [];
  const reportable = lines.filter((l) => l.reportable);
  const incomplete = reportable.filter((l) => l.missing.length > 0);

  async function exportDetail() {
    if (report.type === 'dac7') {
      const sheet: ExportSheet = {
        name: `DAC7 ${report.period}`,
        columns: [
          { header: 'Type', width: 12 },
          { header: 'Nom', width: 32 },
          { header: 'Identifiant fiscal', width: 20 },
          { header: 'Adresse', width: 40 },
          { header: 'Déclarable' },
          { header: 'T1 brut', kind: 'money' },
          { header: 'T2 brut', kind: 'money' },
          { header: 'T3 brut', kind: 'money' },
          { header: 'T4 brut', kind: 'money' },
          { header: 'Total brut', kind: 'money' },
          { header: 'Frais et commissions', kind: 'money', width: 18 },
          { header: 'Transactions', kind: 'number' },
          { header: 'Informations manquantes', width: 30 },
        ],
        rows: lines.map((l) => [l.sellerType === 'restaurant' ? 'Commerce' : 'Livreur', l.name, l.taxId ?? '', l.address ?? '', l.reportable ? 'Oui' : 'Non', ...l.quarters.map((q) => q.grossCents), l.grossCents, l.feesCents, l.transactionsCount, l.missing.join(', ')]),
      };
      await downloadXlsx([sheet], `golink-dac7-${report.countryId}-${report.period}`, { title: `Ciyou Eats · DAC7 ${countryName} ${report.period}`, subtitle: `${reportable.length} déclarants` });
    } else if (report.type === 'vat') {
      const sheet: ExportSheet = {
        name: `TVA ${report.period}`,
        columns: [{ header: 'Nature', width: 40 }, { header: 'Taux', width: 10 }, { header: 'Base HT', kind: 'money' }, { header: 'TVA', kind: 'money' }],
        rows: (report.vatLines ?? []).map((l) => [l.label, bps(l.rateBps), l.htCents, l.vatCents]),
        totals: ['Total', '', (report.vatLines ?? []).reduce((s, l) => s + l.htCents, 0), (report.vatLines ?? []).reduce((s, l) => s + l.vatCents, 0)],
      };
      await downloadXlsx([sheet], `golink-tva-${report.countryId}-${report.period}`, { title: `Ciyou Eats · TVA ${countryName}`, subtitle: monthLabel(report.period) });
    }
  }

  return (
    <>
      <SheetHeader title={`${TAX_REPORT_TYPE_LABELS[report.type]} · ${periodText(report)}`} description={countryName} icon={<BookCheck />} />
      <SheetBody className="space-y-6">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={report.status} map={TAX_REPORT_STATUS} />
          {report.submissionReference && <Badge tone="success" size="sm">Réf. {report.submissionReference}</Badge>}
        </div>
        {report.type === 'dac7' && (
          <>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-xl border border-border p-4"><p className="text-xs text-fg-subtle">Déclarants</p><p className="font-display text-2xl font-semibold text-fg">{reportable.length}</p></div>
              <div className="rounded-xl border border-border p-4"><p className="text-xs text-fg-subtle">Montants bruts</p><p className="font-display text-2xl font-semibold text-fg num">{eur(report.totals?.grossCents ?? 0)}</p></div>
              <div className="rounded-xl border border-border p-4"><p className="text-xs text-fg-subtle">Frais retenus</p><p className="font-display text-2xl font-semibold text-fg num">{eur(report.totals?.feesCents ?? 0)}</p></div>
            </div>
            {incomplete.length > 0 && (
              <Callout tone="amber" title={`${plural(incomplete.length, 'déclarant')} incomplet${incomplete.length > 1 ? 's' : ''}`}>
                Complétez les informations fiscales manquantes avant le dépôt (identifiant fiscal, adresse, date de naissance).
              </Callout>
            )}
            {!lines.length ? (
              <EmptyState compact title="Aucun vendeur sur l’année" description="Calculez de nouveau la déclaration pour obtenir le détail." />
            ) : (
              <div className="overflow-x-auto rounded-xl border border-border">
                <Table className="w-full min-w-[560px] text-sm">
                  <thead>
                    <tr className="border-b border-border bg-surface-2 text-left">
                      <th className="eyebrow px-4 py-2.5 font-normal">Vendeur</th>
                      <th className="eyebrow px-3 py-2.5 text-right font-normal">Brut</th>
                      <th className="eyebrow px-3 py-2.5 text-right font-normal">Transactions</th>
                      <th className="eyebrow px-4 py-2.5 font-normal">État</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((l) => (
                      <tr key={`${l.sellerType}-${l.sellerId}`} className="border-b border-border last:border-0">
                        <td className="px-4 py-2.5">
                          <p className="max-w-56 truncate font-medium text-fg">{l.name}</p>
                          <p className="text-xs text-fg-subtle">{l.sellerType === 'restaurant' ? 'Commerce' : 'Livreur'}{l.taxId ? ` · ${l.taxId}` : ''}</p>
                        </td>
                        <td className="px-3 py-2.5 text-right"><Money cents={l.grossCents} /></td>
                        <td className="px-3 py-2.5 text-right font-mono num">{l.transactionsCount}</td>
                        <td className="px-4 py-2.5">
                          {!l.reportable ? <Badge size="sm" tone="neutral">Sous les seuils</Badge> : l.missing.length ? <Badge size="sm" tone="amber">Manque : {l.missing.join(', ')}</Badge> : <Badge size="sm" tone="success">Complet</Badge>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </div>
            )}
          </>
        )}
        {report.type === 'vat' && (
          <div className="divide-y divide-border">
            {(report.vatLines ?? []).map((l) => (
              <DetailRow key={`${l.label}-${l.rateBps}`} label={`${l.label} · ${bps(l.rateBps)}`} hint={`Base ${eur(l.htCents)}`} value={eur(l.vatCents)} />
            ))}
            {report.vatBreakdown && (
              <>
                <DetailRow label="dont avoirs (TVA à déduire)" value={eur(report.vatBreakdown.creditNotesCents)} />
                <DetailRow label="TVA nette collectée" value={eur(report.vatBreakdown.netCents)} strong />
              </>
            )}
            {!report.vatLines?.length && <p className="py-4 text-sm text-fg-muted">Ce récapitulatif a été produit avant le détail par taux : recalculez-le pour l’obtenir.</p>}
          </div>
        )}
        {report.type === 'accounting_export' && (
          <div className="divide-y divide-border">
            <DetailRow label="Total des débits" value={eur(report.totals?.grossCents ?? 0)} />
            <DetailRow label="TVA collectée" value={eur(report.totals?.vatCents ?? 0)} />
            <p className="py-3 text-sm text-fg-muted">Relancez l’export depuis la carte « Export comptable » pour télécharger le fichier des écritures.</p>
          </div>
        )}
        {report.error && <Callout tone="danger" title="Erreur de calcul">{report.error}</Callout>}
      </SheetBody>
      <SheetFooter className="flex-wrap">
        {report.type !== 'accounting_export' && report.status !== 'submitted' && (
          <>
            <Button size="sm" variant="secondary" loading={regenerating} onClick={onRegenerate}>Recalculer</Button>
            {report.status === 'ready' && <Button size="sm" variant="secondary" leftIcon={<Send />} onClick={onSubmit}>Marquer transmise</Button>}
          </>
        )}
        {report.type !== 'accounting_export' && (
          <Button variant="primary" size="sm" leftIcon={<FileSpreadsheet />} onClick={() => void exportDetail()} disabled={report.type === 'dac7' ? !lines.length : !report.vatLines?.length}>
            Exporter le détail
          </Button>
        )}
      </SheetFooter>
    </>
  );
}
