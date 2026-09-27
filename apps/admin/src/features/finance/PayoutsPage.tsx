import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { collection, limit, orderBy, query, where } from 'firebase/firestore';
import { AlertOctagon, ArrowLeftRight, CalendarClock, Calculator, CheckCircle2, Clock3, MoreHorizontal, PauseCircle, Send, ShieldBan, SlidersHorizontal, XCircle } from 'lucide-react';
import {
  Button,
  DataTable,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  EmptyState,
  IconButton,
  PageContainer,
  PageHeader,
  SegmentedControl,
  StatCard,
  StatusBadge,
  Tooltip,
  createColumnHelper,
  formatDate,
  toast,
} from '@golink/ui';
import { COLLECTIONS, PAYOUT_STATUS_LABELS, type Payout, type PayoutStatus, type WithId } from '@golink/shared';
import { useDocumentTitle } from '@golink/web';
import { useCan } from '@/auth/AdminAccess';
import { useGeoScope } from '@/layout/GeoScope';
import { db } from '@/lib/firebase';
import { toDate, useCollection, useMutation } from '@/lib/firestore';
import { cancelPayout, executePayout } from '../argent-commun/api';
import { ActionDialog, Callout, ErrorPanel, ExportMenu, Money } from '../argent-commun/components';
import { downloadCsv, downloadXlsx, type Sheet } from '../argent-commun/export';
import { eur, periodLabel, plural } from '../argent-commun/format';
import { scopeConstraints } from '../argent-commun/hooks';
import { PAYOUT_STATUS } from '../argent-commun/status';
import { AdjustmentDialog, BuildPayoutsDialog, HoldDialog, ScheduleDialog } from './dialogs';
import { FinanceNav } from './nav';

type Row = WithId<Payout>;
const col = createColumnHelper<Row>();

/** Reversements des commerces et des livreurs (cahier §15) : calendrier, statuts, virements. */
export function PayoutsPage() {
  useDocumentTitle('Reversements · Ciyou Eats Admin');
  const can = useCan();
  const geo = useGeoScope();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const type = (params.get('type') === 'driver' ? 'driver' : 'restaurant') as 'restaurant' | 'driver';
  const statusFilter = params.get('statut') as PayoutStatus | null;
  const [dialog, setDialog] = useState<null | 'build' | 'schedule' | 'hold' | 'adjust'>(null);
  const [target, setTarget] = useState<{ kind: 'pay' | 'cancel'; payout: Row } | null>(null);
  const [beneficiary, setBeneficiary] = useState<{ type: 'restaurant' | 'driver'; id: string; name: string } | null>(null);

  const q = useMemo(
    () => query(collection(db, COLLECTIONS.payouts), where('beneficiaryType', '==', type), ...scopeConstraints(geo), orderBy('scheduledFor', 'desc'), limit(600)),
    [type, geo.cityIds, geo.countryId],
  );
  const { data, loading, error } = useCollection<Payout>(q);
  const rows = useMemo(() => (statusFilter ? data.filter((p) => p.status === statusFilter) : data), [data, statusFilter]);

  const stats = useMemo(() => {
    const sum = (status: PayoutStatus) => data.filter((p) => p.status === status).reduce((s, p) => s + p.netCents, 0);
    const count = (status: PayoutStatus) => data.filter((p) => p.status === status).length;
    const since = Date.now() - 30 * 86_400_000;
    const paid30 = data.filter((p) => p.status === 'paid' && (toDate(p.paidAt)?.getTime() ?? 0) >= since);
    return {
      scheduled: { cents: sum('scheduled') + sum('processing'), count: count('scheduled') + count('processing') },
      failed: { cents: sum('failed'), count: count('failed') },
      held: { cents: sum('on_hold'), count: count('on_hold') },
      paid30: { cents: paid30.reduce((s, p) => s + p.netCents, 0), count: paid30.length },
    };
  }, [data]);

  const pay = useMutation(executePayout, { success: (r) => (r.status === 'paid' ? 'Virement émis' : r.status === 'on_hold' ? 'Reversement bloqué : virement non émis' : 'Virement refusé') });
  const cancel = useMutation(cancelPayout, { success: (r) => `Reversement annulé : ${plural(r.entriesReleased, 'mouvement')} repris au prochain calcul` });
  const canPay = can('finance.payouts');
  const canHold = can('finance.hold');
  const canAdjust = can('finance.adjust');

  const setFilter = (key: string, value: string | null) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };

  const columns = useMemo(
    () => [
      col.accessor('beneficiaryName', {
        header: type === 'restaurant' ? 'Commerce' : 'Livreur',
        cell: (info) => (
          <div className="min-w-0">
            <p className="truncate font-medium text-fg">{info.getValue()}</p>
            <p className="text-xs text-fg-subtle">{geo.cities.find((c) => c.id === info.row.original.cityId)?.name ?? info.row.original.countryId}</p>
          </div>
        ),
      }),
      col.accessor((r) => r.periodEnd, {
        id: 'period',
        header: 'Période',
        cell: (info) => <span className="whitespace-nowrap text-fg-muted">{periodLabel(info.row.original.periodStart, info.row.original.periodEnd)}</span>,
      }),
      col.accessor('grossCents', { header: type === 'restaurant' ? 'Ventes' : 'Gains', meta: { align: 'right' }, cell: (info) => <Money cents={info.getValue()} className="text-fg-muted" /> }),
      col.accessor((r) => r.commissionCents + r.refundsChargedCents + r.cashDeductedCents - r.adjustmentsCents, {
        id: 'deductions',
        header: 'Retenues',
        meta: { align: 'right' },
        cell: (info) => {
          const r = info.row.original;
          const parts = [
            r.commissionCents ? `Commission ${eur(r.commissionCents)}` : null,
            r.refundsChargedCents ? `Remboursements ${eur(r.refundsChargedCents)}` : null,
            r.cashDeductedCents ? `Espèces ${eur(r.cashDeductedCents)}` : null,
            r.adjustmentsCents ? `Ajustements et frais ${eur(r.adjustmentsCents)}` : null,
            r.tipsCents ? `Pourboires + ${eur(r.tipsCents)}` : null,
          ].filter(Boolean);
          return (
            <Tooltip content={parts.length ? parts.join(' · ') : 'Aucune retenue'}>
              <span className="cursor-help font-mono text-fg-muted num">{info.getValue() ? `− ${eur(info.getValue())}` : '—'}</span>
            </Tooltip>
          );
        },
      }),
      col.accessor('netCents', { header: 'Net', meta: { align: 'right' }, cell: (info) => <Money cents={info.getValue()} className="font-semibold text-fg" /> }),
      col.accessor('status', {
        header: 'Statut',
        cell: (info) => (
          <div className="flex flex-col items-start gap-1">
            <StatusBadge status={info.getValue()} map={PAYOUT_STATUS} />
            {info.row.original.failureReason && info.getValue() === 'failed' && <span className="line-clamp-1 max-w-56 text-2xs text-danger" title={String(info.row.original.failureReason ?? '')}>{info.row.original.failureReason}</span>}
          </div>
        ),
      }),
      col.accessor((r) => toDate(r.paidAt ?? r.scheduledFor)?.getTime() ?? 0, {
        id: 'date',
        header: 'Versement',
        cell: (info) => {
          const r = info.row.original;
          const date = toDate(r.paidAt) ?? toDate(r.scheduledFor);
          return <span className="whitespace-nowrap text-fg-muted">{date ? `${r.paidAt ? 'Payé le' : 'Prévu le'} ${formatDate(date)}` : '—'}</span>;
        },
      }),
      col.display({
        id: 'actions',
        header: '',
        meta: { align: 'right', className: 'w-12' },
        cell: (info) => {
          const r = info.row.original;
          const payable = ['scheduled', 'failed'].includes(r.status);
          return (
            <div onClick={(e) => e.stopPropagation()}>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <IconButton label="Actions" variant="ghost" size="sm"><MoreHorizontal /></IconButton>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onSelect={() => navigate(`/finance/reversements/${r.id}`)}>Voir le détail</DropdownMenuItem>
                  {canPay && payable && (
                    <DropdownMenuItem icon={<Send />} onSelect={() => setTarget({ kind: 'pay', payout: r })}>
                      {r.status === 'failed' ? 'Relancer le virement' : 'Verser maintenant'}
                    </DropdownMenuItem>
                  )}
                  {canAdjust && (
                    <DropdownMenuItem icon={<SlidersHorizontal />} onSelect={() => { setBeneficiary({ type: r.beneficiaryType, id: r.beneficiaryId, name: r.beneficiaryName }); setDialog('adjust'); }}>
                      Ajustement manuel
                    </DropdownMenuItem>
                  )}
                  {canHold && r.status !== 'on_hold' && r.status !== 'paid' && (
                    <DropdownMenuItem icon={<ShieldBan />} onSelect={() => { setBeneficiary({ type: r.beneficiaryType, id: r.beneficiaryId, name: r.beneficiaryName }); setDialog('hold'); }}>
                      Bloquer les reversements
                    </DropdownMenuItem>
                  )}
                  {canPay && ['scheduled', 'failed', 'on_hold'].includes(r.status) && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem destructive icon={<XCircle />} onSelect={() => setTarget({ kind: 'cancel', payout: r })}>
                        Annuler ce reversement
                      </DropdownMenuItem>
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          );
        },
      }),
    ],
    [type, geo.cities, canPay, canHold, canAdjust, navigate],
  );

  async function onExport(format: 'csv' | 'xlsx' | 'pdf') {
    const sheet: Sheet = {
      name: type === 'restaurant' ? 'Reversements commerces' : 'Reversements livreurs',
      columns: [
        { header: 'Référence', width: 34 },
        { header: 'Bénéficiaire', width: 28 },
        { header: 'Début', kind: 'date' },
        { header: 'Fin', kind: 'date' },
        { header: 'Brut', kind: 'money' },
        { header: 'Commission', kind: 'money' },
        { header: 'Remboursements imputés', kind: 'money', width: 20 },
        { header: 'Ajustements et frais', kind: 'money', width: 18 },
        { header: 'Pourboires', kind: 'money' },
        { header: 'Espèces déduites', kind: 'money' },
        { header: 'Net', kind: 'money' },
        { header: 'Statut', width: 14 },
        { header: 'Payé le', kind: 'date' },
        { header: 'Virement Stripe', width: 30 },
      ],
      rows: rows.map((r) => [
        r.id,
        r.beneficiaryName,
        r.periodStart,
        r.periodEnd,
        r.grossCents,
        r.commissionCents,
        r.refundsChargedCents,
        r.adjustmentsCents,
        r.tipsCents,
        r.cashDeductedCents,
        r.netCents,
        PAYOUT_STATUS_LABELS[r.status],
        toDate(r.paidAt) ?? null,
        r.providerTransferId ?? '',
      ]),
      totals: ['Total', '', '', '', rows.reduce((s, r) => s + r.grossCents, 0), rows.reduce((s, r) => s + r.commissionCents, 0), rows.reduce((s, r) => s + r.refundsChargedCents, 0), rows.reduce((s, r) => s + r.adjustmentsCents, 0), rows.reduce((s, r) => s + r.tipsCents, 0), rows.reduce((s, r) => s + r.cashDeductedCents, 0), rows.reduce((s, r) => s + r.netCents, 0), '', null, ''],
    };
    const name = `golink-reversements-${type === 'restaurant' ? 'commerces' : 'livreurs'}`;
    if (format === 'csv') downloadCsv(sheet, name);
    else await downloadXlsx([sheet], name, { title: 'Ciyou Eats · Reversements', subtitle: geo.label });
  }

  return (
    <PageContainer wide>
      <PageHeader
        eyebrow={`Argent · ${geo.label}`}
        title="Reversements"
        description="Versements automatiques aux commerces et aux livreurs selon le calendrier, avec relevé détaillé."
        actions={
          <>
            {canPay && (
              <Button variant="secondary" size="sm" leftIcon={<CalendarClock />} onClick={() => setDialog('schedule')}>
                Calendrier
              </Button>
            )}
            {canPay && (
              <Button variant="primary" size="sm" leftIcon={<Calculator />} onClick={() => setDialog('build')}>
                Construire les reversements
              </Button>
            )}
          </>
        }
      >
        <FinanceNav />
      </PageHeader>

      <div className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard label="Programmés" icon={<Clock3 />} tone="info" loading={loading} value={eur(stats.scheduled.cents)} footer={plural(stats.scheduled.count, 'reversement')} onClick={() => setFilter('statut', 'scheduled')} />
          <StatCard label="En échec" icon={<AlertOctagon />} tone="danger" loading={loading} value={eur(stats.failed.cents)} footer={plural(stats.failed.count, 'reversement')} onClick={() => setFilter('statut', 'failed')} />
          <StatCard label="Bloqués" icon={<PauseCircle />} tone="plum" loading={loading} value={eur(stats.held.cents)} footer={plural(stats.held.count, 'reversement')} onClick={() => setFilter('statut', 'on_hold')} />
          <StatCard label="Payés sur 30 jours" icon={<CheckCircle2 />} tone="success" loading={loading} value={eur(stats.paid30.cents)} footer={plural(stats.paid30.count, 'virement')} onClick={() => setFilter('statut', 'paid')} />
        </div>

        {stats.failed.count > 0 && !statusFilter && (
          <Callout
            tone="danger"
            title={`${plural(stats.failed.count, 'reversement')} en échec`}
            action={<Button size="sm" variant="secondary" onClick={() => setFilter('statut', 'failed')}>Voir les échecs</Button>}
          >
            Vérifiez le compte de paiement du bénéficiaire puis relancez le virement depuis le menu de la ligne.
          </Callout>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3">
          <SegmentedControl
            aria-label="Bénéficiaires"
            value={type}
            onValueChange={(v) => setFilter('type', v === 'driver' ? 'driver' : null)}
            options={[
              { value: 'restaurant', label: 'Commerces' },
              { value: 'driver', label: 'Livreurs' },
            ]}
          />
          <SegmentedControl
            aria-label="Statut"
            size="sm"
            value={statusFilter ?? 'all'}
            onValueChange={(v) => setFilter('statut', v === 'all' ? null : v)}
            options={[
              { value: 'all', label: 'Tous' },
              { value: 'scheduled', label: 'Programmés' },
              { value: 'failed', label: 'Échoués' },
              { value: 'on_hold', label: 'Bloqués' },
              { value: 'paid', label: 'Payés' },
            ]}
          />
        </div>

        {error ? (
          <ErrorPanel error={error} />
        ) : (
          <DataTable
            data={rows}
            columns={columns}
            loading={loading}
            getRowId={(r) => r.id}
            onRowClick={(r) => navigate(`/finance/reversements/${r.id}`)}
            searchPlaceholder={type === 'restaurant' ? 'Rechercher un commerce…' : 'Rechercher un livreur…'}
            itemLabel="reversements"
            pageSize={15}
            toolbar={<ExportMenu onExport={onExport} disabled={!rows.length} />}
            bulkActions={
              canPay
                ? [
                    {
                      label: 'Verser les reversements sélectionnés',
                      icon: <Send />,
                      onClick: async (selected, clear) => {
                        const payable = selected.filter((r) => ['scheduled', 'failed'].includes(r.status));
                        let ok = 0;
                        for (const r of payable) {
                          const res = await executePayout({ payoutId: r.id }).catch(() => null);
                          if (res?.status === 'paid') ok += 1;
                        }
                        clear();
                        pay.reset();
                        toast[ok === payable.length && ok > 0 ? 'success' : 'warning'](`${ok} virement${ok > 1 ? 's' : ''} émis sur ${payable.length} reversement${payable.length > 1 ? 's' : ''} à verser.`);
                      },
                    },
                  ]
                : undefined
            }
            emptyState={
              <EmptyState
                icon={<ArrowLeftRight />}
                title={statusFilter ? `Aucun reversement « ${PAYOUT_STATUS_LABELS[statusFilter]} »` : 'Aucun reversement'}
                description="Les reversements sont construits automatiquement chaque nuit selon le calendrier."
                action={statusFilter ? <Button size="sm" variant="secondary" onClick={() => setFilter('statut', null)}>Voir tous les statuts</Button> : undefined}
              />
            }
          />
        )}
      </div>

      <BuildPayoutsDialog open={dialog === 'build'} onOpenChange={(o) => setDialog(o ? 'build' : null)} defaultType={type} />
      <ScheduleDialog open={dialog === 'schedule'} onOpenChange={(o) => setDialog(o ? 'schedule' : null)} />
      <HoldDialog open={dialog === 'hold'} onOpenChange={(o) => setDialog(o ? 'hold' : null)} beneficiary={beneficiary} />
      <AdjustmentDialog open={dialog === 'adjust'} onOpenChange={(o) => setDialog(o ? 'adjust' : null)} beneficiary={beneficiary} />

      <ActionDialog
        open={target?.kind === 'pay'}
        onOpenChange={(o) => !o && setTarget(null)}
        icon={<Send />}
        title={target?.payout.status === 'failed' ? 'Relancer le virement' : 'Verser maintenant'}
        description={target ? `${eur(target.payout.netCents)} vers le compte Stripe de ${target.payout.beneficiaryName}.` : undefined}
        confirmLabel="Émettre le virement"
        requireReason={false}
        onSubmit={async () => Boolean(target && (await pay.mutate({ payoutId: target.payout.id })))}
      >
        <Callout tone="info" title="Virement Stripe Connect">
          Le montant est transféré sur le compte de paiement du bénéficiaire, puis viré sur son compte bancaire selon le rythme Stripe. Un relevé lui est envoyé par e-mail.
        </Callout>
      </ActionDialog>
      <ActionDialog
        open={target?.kind === 'cancel'}
        onOpenChange={(o) => !o && setTarget(null)}
        destructive
        title="Annuler ce reversement"
        description="Aucun virement ne sera émis ; les mouvements redeviennent « à reverser » et seront repris au prochain calcul."
        confirmLabel="Annuler le reversement"
        onSubmit={async (reason) => Boolean(target && (await cancel.mutate({ payoutId: target.payout.id, reason })))}
      />
    </PageContainer>
  );
}
