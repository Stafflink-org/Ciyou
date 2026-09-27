import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { orderBy, query, where } from 'firebase/firestore';
import { AlertTriangle, BadgeEuro, Calculator, Download, FileCheck2, FileText, Landmark, ReceiptText, Send, Settings2, Wallet } from 'lucide-react';
import {
  Avatar,
  BarChart,
  Button,
  Card,
  CardHeader,
  ConfirmDialog,
  DataTable,
  EmptyState,
  PageContainer,
  PageHeader,
  Skeleton,
  StatCard,
  StatusBadge,
  createColumnHelper,
  formatEUR,
} from '@golink/ui';
import { PAYSLIP_STATUS_LABELS, paths, type Payslip, type WithId } from '@golink/shared';
import { useAuth, useDocumentTitle } from '@golink/web';
import { useCan, useRestaurantAccess } from '@/auth/RestaurantAccess';
import { collectionAt, useCollection, useMutation } from '@/lib/firestore';
import { addMonths, currentPeriod, formatMonth } from '../_rh/dates';
import { csvEuros, csvNumber, downloadCsv } from '../_rh/export';
import { computePayroll, sendPayslips, setPayslipStatus, type PayrollRunResult } from '../_rh/functions';
import { useStaffDirectory } from '../_rh/hooks';
import { ErrorCard, MonthSwitcher, PAYSLIP_STATUS } from '../_rh/ui';
import { PayslipSheet, usePayslipDownload } from './PayslipSheet';

const column = createColumnHelper<WithId<Payslip>>();
const shortMonth = new Intl.DateTimeFormat('fr-FR', { month: 'short' });

export function PaiePage() {
  useDocumentTitle('Paie · GoLink Restaurant');
  const can = useCan();
  return can('payroll.view') ? <PayrollManager /> : <MyPayslips />;
}

function PayrollManager() {
  const can = useCan();
  const manage = can('payroll.manage');
  const { restaurantId, restaurant } = useRestaurantAccess();
  const directory = useStaffDirectory();
  const [period, setPeriod] = useState(() => addMonths(currentPeriod(), -1));
  const [selected, setSelected] = useState<WithId<Payslip> | null>(null);
  const [computeOpen, setComputeOpen] = useState(false);
  const [sendIds, setSendIds] = useState<string[] | null>(null);
  const [lastRun, setLastRun] = useState<(PayrollRunResult & { period: string }) | null>(null);

  const payslipsCol = collectionAt(paths.restaurantSub(restaurantId, 'payslips'));
  const month = useCollection<Payslip>(query(payslipsCol, where('period', '==', period)));
  const history = useCollection<Payslip>(query(payslipsCol, where('period', '>=', addMonths(period, -5)), where('period', '<=', period), orderBy('period')));

  const compute = useMutation(computePayroll, {
    success: (r) => `${r.computed} bulletin${r.computed > 1 ? 's' : ''} calculé${r.computed > 1 ? 's' : ''}${r.skipped ? ` · ${r.skipped} déjà validé(s) conservé(s)` : ''}`,
  });
  const status = useMutation(setPayslipStatus, { success: (r) => `${r.updated} bulletin${r.updated > 1 ? 's' : ''} mis à jour` });
  const send = useMutation(sendPayslips, {
    success: (r) => `${r.sent} bulletin${r.sent > 1 ? 's' : ''} envoyé${r.sent > 1 ? 's' : ''}${r.skipped.length ? ` · ${r.skipped.length} non validé(s) ignoré(s)` : ''}`,
  });
  const download = usePayslipDownload();

  const name = (p: Payslip) => p.employeeSnapshot?.fullName ?? directory.byEmployeeId.get(p.employeeId)?.displayName ?? p.employeeId;
  const rows = month.data;
  const gross = rows.reduce((t, p) => t + p.grossCents, 0);
  const net = rows.reduce((t, p) => t + p.netCents, 0);
  const cost = rows.reduce((t, p) => t + p.grossCents + p.employerContributionsCents, 0);
  const validated = rows.filter((p) => p.status === 'validated' || p.status === 'sent').length;

  const chart = useMemo(() => {
    const periods = Array.from({ length: 6 }, (_, i) => addMonths(period, i - 5));
    return periods.map((p) => {
      const list = history.data.filter((s) => s.period === p);
      const [y = 2026, m = 1] = p.split('-').map(Number);
      return {
        mois: shortMonth.format(new Date(y, m - 1, 1)),
        brut: list.reduce((t, s) => t + s.grossCents, 0) / 100,
        cout: list.reduce((t, s) => t + s.grossCents + s.employerContributionsCents, 0) / 100,
      };
    });
  }, [history.data, period]);

  const columns = useMemo(
    () => [
      column.accessor((p) => name(p), {
        id: 'name',
        header: 'Salarié',
        cell: (info) => (
          <span className="flex items-center gap-2.5">
            <Avatar name={info.getValue()} size="sm" />
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium text-fg">{info.getValue()}</span>
              <span className="block truncate text-2xs text-fg-subtle">
                {info.row.original.employeeSnapshot?.position ?? directory.byEmployeeId.get(info.row.original.employeeId)?.position ?? '—'}
              </span>
            </span>
          </span>
        ),
      }),
      column.accessor((p) => p.hours.regular + p.hours.overtime10 + p.hours.overtime20 + p.hours.overtime50, {
        id: 'hours',
        header: 'Heures',
        meta: { align: 'right' },
        cell: (info) => {
          const h = info.row.original.hours;
          const overtime = h.overtime10 + h.overtime20 + h.overtime50;
          return (
            <span className="flex flex-col items-end">
              <span className="font-mono text-sm num">{info.getValue().toLocaleString('fr-FR', { maximumFractionDigits: 1 })} h</span>
              {overtime > 0 && <span className="whitespace-nowrap font-mono text-2xs text-fg-subtle num">dont {overtime.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} h sup.</span>}
            </span>
          );
        },
      }),
      column.accessor('grossCents', { header: 'Brut', meta: { align: 'right' }, cell: (info) => <span className="font-mono text-sm num">{formatEUR(info.getValue(), { cents: true })}</span> }),
      column.accessor('employeeContributionsCents', {
        header: 'Cotisations',
        meta: { align: 'right' },
        cell: (info) => <span className="font-mono text-sm text-fg-muted num">{formatEUR(info.getValue(), { cents: true })}</span>,
      }),
      column.accessor('netCents', { header: 'Net à payer', meta: { align: 'right' }, cell: (info) => <span className="font-mono text-sm font-semibold num">{formatEUR(info.getValue(), { cents: true })}</span> }),
      column.accessor((p) => p.grossCents + p.employerContributionsCents, {
        id: 'cost',
        header: 'Coût employeur',
        meta: { align: 'right' },
        cell: (info) => <span className="font-mono text-sm text-fg-muted num">{formatEUR(info.getValue(), { cents: true })}</span>,
      }),
      column.accessor('status', { header: 'Statut', cell: (info) => <StatusBadge status={info.getValue()} map={PAYSLIP_STATUS} /> }),
    ],
    [directory.byEmployeeId],
  );

  function exportJournal(list: WithId<Payslip>[]) {
    downloadCsv(
      `journal-paie-${restaurant.slug}-${period}`,
      list.map((p) => ({
        Salarié: name(p),
        Période: p.period,
        'Heures normales': csvNumber(p.hours.regular),
        'Heures sup. +10 %': csvNumber(p.hours.overtime10),
        'Heures sup. +20 %': csvNumber(p.hours.overtime20),
        'Heures sup. +50 %': csvNumber(p.hours.overtime50),
        'Heures de nuit': csvNumber(p.hours.night),
        'Brut (€)': csvEuros(p.grossCents),
        'Primes (€)': csvEuros(p.bonusCents),
        'Avantage nourriture (€)': csvEuros(p.mealAllowanceCents),
        'Cotisations salariales (€)': csvEuros(p.employeeContributionsCents),
        'Cotisations patronales (€)': csvEuros(p.employerContributionsCents),
        'Net imposable (€)': csvEuros(p.taxableNetCents),
        'Prélèvement à la source (€)': csvEuros(p.withholdingTaxCents),
        'Retenues (€)': csvEuros(p.deductionsCents),
        'Net à payer (€)': csvEuros(p.netCents),
        Statut: PAYSLIP_STATUS_LABELS[p.status],
      })),
    );
  }

  const run = lastRun && lastRun.period === period ? lastRun : null;

  return (
    <PageContainer>
      <PageHeader
        eyebrow="Équipe & RH"
        title="Paie"
        description="Bulletins calculés à partir des pointages, des absences et de la convention HCR. Vérifiez, validez, envoyez."
        actions={
          <>
            {manage && (
              <Button asChild>
                <Link to="/equipe/paie/reglages">
                  <Settings2 /> Réglages
                </Link>
              </Button>
            )}
            <Button leftIcon={<Download />} onClick={() => exportJournal(rows)} disabled={rows.length === 0}>
              Journal de paie
            </Button>
            {manage && (
              <Button variant="primary" leftIcon={<Calculator />} onClick={() => setComputeOpen(true)}>
                Calculer la paie
              </Button>
            )}
          </>
        }
      />

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <MonthSwitcher period={period} onChange={setPeriod} />
        <p className="text-sm text-fg-muted">
          Validés : <span className="font-medium text-fg num">{validated}</span> / {rows.length}
        </p>
      </div>

      {month.error && <ErrorCard error={month.error} />}

      {run && (run.openEntries > 0 || run.unvalidatedEntries > 0) && (
        <div className="tone-amber mb-4 flex items-start gap-3 rounded-xl border border-(--tone-border) bg-(--tone-bg) px-4 py-3 text-sm text-(--tone-fg)">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <p>
            Calcul effectué avec {run.unvalidatedEntries} pointage{run.unvalidatedEntries > 1 ? 's' : ''} non validé{run.unvalidatedEntries > 1 ? 's' : ''}
            {run.openEntries ? ` et ${run.openEntries} service${run.openEntries > 1 ? 's' : ''} non clôturé${run.openEntries > 1 ? 's' : ''} (ignoré${run.openEntries > 1 ? 's' : ''})` : ''}.{' '}
            <Link to="/equipe/pointages" className="font-medium underline underline-offset-2">
              Vérifier les pointages
            </Link>
          </p>
        </div>
      )}

      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Masse salariale brute" value={formatEUR(gross, { cents: true })} icon={<BadgeEuro />} tone="brand" loading={month.loading} footer={formatMonth(period)} />
        <StatCard label="Net à verser" value={formatEUR(net, { cents: true })} icon={<Wallet />} tone="teal" loading={month.loading} footer="Après cotisations et prélèvement à la source." />
        <StatCard label="Coût employeur" value={formatEUR(cost, { cents: true })} icon={<Landmark />} tone="info" loading={month.loading} footer="Brut et cotisations patronales." />
        <StatCard label="Bulletins validés" value={`${validated} / ${rows.length}`} icon={<FileCheck2 />} tone={rows.length && validated === rows.length ? 'success' : 'amber'} loading={month.loading} footer="À valider avant l’envoi aux salariés." />
      </div>

      <div className="space-y-4">
        <div className="min-w-0">
          <DataTable
            data={rows}
            columns={columns}
            getRowId={(p) => p.id}
            loading={month.loading}
            onRowClick={setSelected}
            itemLabel="bulletins"
            searchPlaceholder="Rechercher un salarié…"
            filters={[{ id: 'status', label: 'Statut', options: Object.entries(PAYSLIP_STATUS).map(([value, meta]) => ({ value, label: meta.label })), getValue: (p) => p.status }]}
            bulkActions={
              manage
                ? [
                    { label: 'Valider', icon: <FileCheck2 />, onClick: (list, clear) => void status.mutate({ restaurantId, payslipIds: list.map((p) => p.id), status: 'validated' }).then((ok) => ok && clear()) },
                    { label: 'Envoyer', icon: <Send />, onClick: (list) => setSendIds(list.map((p) => p.id)) },
                    { label: 'Exporter', icon: <Download />, onClick: (list, clear) => { exportJournal(list); clear(); } },
                  ]
                : [{ label: 'Exporter', icon: <Download />, onClick: (list, clear) => { exportJournal(list); clear(); } }]
            }
            emptyState={
              <EmptyState
                compact
                icon={<ReceiptText />}
                title={`Aucun bulletin pour ${formatMonth(period).toLowerCase()}`}
                description={manage ? 'Lancez le calcul : GoLink reprend les pointages, les absences et vos réglages de paie.' : 'Les bulletins apparaîtront dès qu’ils seront calculés.'}
                action={
                  manage ? (
                    <Button variant="primary" leftIcon={<Calculator />} onClick={() => setComputeOpen(true)}>
                      Calculer la paie
                    </Button>
                  ) : undefined
                }
              />
            }
          />
        </div>
        <Card className="min-w-0">
          <CardHeader icon={<BadgeEuro />} title="Évolution sur six mois" description="Masse salariale brute et coût employeur" divided />
          <div className="p-4">
            {history.loading ? (
              <Skeleton className="h-56" />
            ) : (
              <BarChart
                data={chart}
                xKey="mois"
                height={220}
                series={[
                  { key: 'brut', label: 'Brut' },
                  { key: 'cout', label: 'Coût employeur' },
                ]}
                valueFormatter={(v) => formatEUR(v)}
                axisFormatter={(v) => formatEUR(v, { compact: true })}
              />
            )}
          </div>
          <div className="border-t border-border px-5 py-3 text-xs text-fg-subtle">
            <FileText className="mr-1 inline size-3.5" /> Bulletins établis selon vos réglages ; à contrôler par votre expert-comptable.
          </div>
        </Card>
      </div>

      <PayslipSheet payslip={selected ? (rows.find((p) => p.id === selected.id) ?? selected) : null} name={selected ? name(selected) : ''} onClose={() => setSelected(null)} />

      <ConfirmDialog
        open={computeOpen}
        onOpenChange={setComputeOpen}
        title={`Calculer la paie de ${formatMonth(period).toLowerCase()}`}
        description="Les bulletins non validés sont recalculés à partir des pointages clôturés, des absences acceptées et des réglages. Les bulletins validés ou envoyés sont conservés."
        confirmLabel="Lancer le calcul"
        onConfirm={async () => {
          const result = await compute.mutate({ restaurantId, period });
          if (result) setLastRun({ ...result, period });
        }}
      />
      <ConfirmDialog
        open={sendIds !== null}
        onOpenChange={(open) => !open && setSendIds(null)}
        title="Envoyer les bulletins sélectionnés ?"
        description="Seuls les bulletins validés sont envoyés. Ils deviennent définitifs et consultables par chaque salarié."
        confirmLabel="Envoyer"
        onConfirm={async () => {
          if (sendIds) await send.mutate({ restaurantId, payslipIds: sendIds });
        }}
      />
      {download.loading && <span className="sr-only">Préparation du PDF…</span>}
    </PageContainer>
  );
}

function MyPayslips() {
  const { restaurantId } = useRestaurantAccess();
  const { user } = useAuth();
  const [selected, setSelected] = useState<WithId<Payslip> | null>(null);
  const download = usePayslipDownload();
  const mine = useCollection<Payslip>(
    user
      ? query(
          collectionAt(paths.restaurantSub(restaurantId, 'payslips')),
          where('employeeUid', '==', user.uid),
          where('status', 'in', ['validated', 'sent']),
          orderBy('period', 'desc'),
        )
      : null,
  );
  const last = mine.data[0];
  return (
    <PageContainer>
      <PageHeader eyebrow="Équipe & RH" title="Mes bulletins de paie" description="Vos bulletins validés par votre employeur, à télécharger en PDF." />
      {mine.error && <ErrorCard error={mine.error} />}
      {last && (
        <div className="mb-6 grid gap-4 sm:grid-cols-3">
          <StatCard label={`Net de ${formatMonth(last.period).toLowerCase()}`} value={formatEUR(last.netCents, { cents: true })} icon={<Wallet />} tone="teal" />
          <StatCard label="Brut" value={formatEUR(last.grossCents, { cents: true })} icon={<BadgeEuro />} tone="brand" />
          <StatCard
            label="Heures payées"
            value={`${(last.hours.regular + last.hours.overtime10 + last.hours.overtime20 + last.hours.overtime50).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} h`}
            icon={<ReceiptText />}
            tone="info"
          />
        </div>
      )}
      <Card>
        {mine.loading ? (
          <div className="space-y-2 p-5">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-12" />
            ))}
          </div>
        ) : mine.data.length === 0 ? (
          <EmptyState icon={<ReceiptText />} title="Aucun bulletin disponible" description="Vos bulletins apparaissent ici dès que votre employeur les valide." />
        ) : (
          <ul className="divide-y divide-border">
            {mine.data.map((payslip) => (
              <li key={payslip.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5">
                <button type="button" onClick={() => setSelected(payslip)} className="min-w-0 text-left">
                  <p className="text-sm font-semibold text-fg hover:underline">{formatMonth(payslip.period)}</p>
                  <p className="font-mono text-xs text-fg-subtle num">
                    Brut {formatEUR(payslip.grossCents, { cents: true })} · net {formatEUR(payslip.netCents, { cents: true })}
                  </p>
                </button>
                <span className="flex items-center gap-2">
                  <StatusBadge status={payslip.status} map={PAYSLIP_STATUS} />
                  <Button size="sm" leftIcon={<Download />} loading={download.loading} onClick={() => void download.mutate(payslip.id)}>
                    PDF
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <PayslipSheet payslip={selected} name={selected?.employeeSnapshot?.fullName ?? 'Mon bulletin'} onClose={() => setSelected(null)} />
    </PageContainer>
  );
}
