// Onglet « Commissions » du hub Paiement (plan V2 §3.3, D3/E-R03b) : le détail par
// commande de la commission réellement appliquée, jamais un taux figé dans le code —
// chaque ligne relit `order.restaurantSettlement` (calculé au moment de la commande).
import { useMemo } from 'react';
import { BadgePercent } from 'lucide-react';
import { Card, DataTable, EmptyState, PageContainer, PageHeader, Skeleton, StatCard, createColumnHelper, formatDate } from '@golink/ui';
import { type Order, type WithId } from '@golink/shared';
import { useRestaurantAccess } from '@/auth/RestaurantAccess';
import { toDate } from '@/lib/firestore';
import { ExportMenu } from '../finances/components/ExportMenu';
import { PeriodPicker, usePeriod } from '../finances/components/PeriodPicker';
import { downloadCsv, type Sheet } from '../finances/lib/export';
import { bpsLabel, eur } from '../finances/lib/format';
import { restaurantShare, useOrdersInRange, useRefundsInRange } from '../finances/lib/hooks';

interface CommissionRow {
  orderId: string;
  number: string;
  date: Date;
  baseCents: number;
  commissionBps: number;
  commissionCents: number;
  paymentFeeCents: number;
  refundedCents: number;
  netCents: number;
}

function rowsOf(orders: WithId<Order>[], refundByOrder: Map<string, number>): CommissionRow[] {
  return orders
    .filter((order) => Boolean(order.restaurantSettlement))
    .map((order) => {
      const settlement = order.restaurantSettlement!;
      const refundedCents = refundByOrder.get(order.id) ?? 0;
      return {
        orderId: order.id,
        number: order.number,
        date: toDate(order.createdAt) ?? new Date(0),
        baseCents: settlement.commissionBaseCents,
        commissionBps: settlement.commissionBps,
        commissionCents: settlement.commissionTtcCents,
        paymentFeeCents: settlement.paymentFeeCents,
        refundedCents,
        netCents: settlement.payoutCents - refundedCents,
      };
    })
    .sort((a, b) => b.date.getTime() - a.date.getTime());
}

const column = createColumnHelper<CommissionRow>();

/** Détail des commissions prélevées, commande par commande, sur la période choisie. */
export function CommissionsTab() {
  const { restaurantId } = useRestaurantAccess();
  const [period, periodValue, setPeriod] = usePeriod('paiement-commissions');
  const orders = useOrdersInRange(restaurantId, period.start, period.endExclusive);
  const refunds = useRefundsInRange(restaurantId, period.start, period.endExclusive);

  const refundByOrder = useMemo(() => {
    const map = new Map<string, number>();
    for (const refund of refunds.data) map.set(refund.orderId, (map.get(refund.orderId) ?? 0) + restaurantShare(refund));
    return map;
  }, [refunds.data]);

  const rows = useMemo(() => rowsOf(orders.data, refundByOrder), [orders.data, refundByOrder]);

  const totals = useMemo(
    () =>
      rows.reduce(
        (acc, row) => ({
          base: acc.base + row.baseCents,
          commission: acc.commission + row.commissionCents,
          fee: acc.fee + row.paymentFeeCents,
          refunded: acc.refunded + row.refundedCents,
          net: acc.net + row.netCents,
        }),
        { base: 0, commission: 0, fee: 0, refunded: 0, net: 0 },
      ),
    [rows],
  );

  const loading = orders.loading || refunds.loading;

  const columns = useMemo(
    () => [
      column.accessor('number', {
        header: 'Commande',
        cell: (info) => <span className="whitespace-nowrap font-mono text-sm text-fg num">{info.getValue()}</span>,
      }),
      column.accessor('date', { header: 'Date', cell: (info) => <span className="whitespace-nowrap text-sm text-fg-muted">{formatDate(info.getValue())}</span> }),
      column.accessor('baseCents', {
        header: 'Base commissionnable',
        meta: { align: 'right' },
        cell: (info) => <span className="font-mono text-sm num">{eur(info.getValue())}</span>,
      }),
      column.accessor((row) => row, {
        id: 'commission',
        header: 'Commission',
        meta: { align: 'right' },
        cell: (info) => (
          <div className="text-end">
            <span className="font-mono text-sm text-fg-muted num">− {eur(info.getValue().commissionCents)}</span>
            <span className="ml-1.5 text-2xs text-fg-subtle">({bpsLabel(info.getValue().commissionBps)})</span>
          </div>
        ),
      }),
      column.accessor('paymentFeeCents', {
        header: 'Frais de paiement',
        meta: { align: 'right', className: 'hidden md:table-cell' },
        cell: (info) => <span className="font-mono text-sm text-fg-muted num">{info.getValue() ? `− ${eur(info.getValue())}` : '—'}</span>,
      }),
      column.accessor('refundedCents', {
        header: 'Remboursement imputé',
        meta: { align: 'right', className: 'hidden lg:table-cell' },
        cell: (info) => <span className="font-mono text-sm text-fg-muted num">{info.getValue() ? `− ${eur(info.getValue())}` : '—'}</span>,
      }),
      column.accessor('netCents', {
        header: 'Net',
        meta: { align: 'right' },
        cell: (info) => <span className="font-mono text-sm font-semibold num">{eur(info.getValue())}</span>,
      }),
    ],
    [],
  );

  const exportCsv = () => {
    const sheet: Sheet = {
      name: 'Commissions',
      columns: [
        { header: 'Commande' },
        { header: 'Date', kind: 'date' },
        { header: 'Base commissionnable (€)', kind: 'money' },
        { header: 'Taux de commission', kind: 'percent' },
        { header: 'Commission (€)', kind: 'money' },
        { header: 'Frais de paiement (€)', kind: 'money' },
        { header: 'Remboursement imputé (€)', kind: 'money' },
        { header: 'Net (€)', kind: 'money' },
      ],
      rows: rows.map((row) => [
        row.number,
        row.date.toISOString().slice(0, 10),
        row.baseCents,
        row.commissionBps / 10_000,
        row.commissionCents,
        row.paymentFeeCents,
        row.refundedCents,
        row.netCents,
      ]),
      totals: ['Total', '', totals.base, '', totals.commission, totals.fee, totals.refunded, totals.net],
    };
    downloadCsv(sheet, `commissions-${periodValue.preset ?? 'periode'}`);
  };

  return (
    <PageContainer wide>
      <PageHeader
        eyebrow="Paiement"
        title="Commissions"
        description="Le détail, commande par commande, de la commission réellement prélevée."
        actions={<ExportMenu onExport={exportCsv} disabled={loading || rows.length === 0} formats={['csv']} label="Exporter en CSV" />}
      >
        <PeriodPicker period={period} value={periodValue} onChange={setPeriod} />
      </PageHeader>

      {loading ? (
        <div className="grid gap-4 sm:grid-cols-3">
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="h-24 rounded-xl" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <Card>
          <EmptyState icon={<BadgePercent />} title="Aucune commande sur cette période" description="Les commissions apparaissent ici dès la première commande réglée." />
        </Card>
      ) : (
        <>
          <div className="mb-5 grid gap-4 sm:grid-cols-3">
            <StatCard label="Base commissionnable" value={eur(totals.base)} />
            <StatCard label="Commissions prélevées" value={eur(totals.commission)} tone="amber" />
            <StatCard label="Net à percevoir" value={eur(totals.net)} tone="success" />
          </div>
          <Card className="overflow-hidden">
            <DataTable data={rows} columns={columns} getRowId={(row) => row.orderId} pageSize={20} itemLabel="commandes" searchPlaceholder="N° de commande…" />
          </Card>
        </>
      )}
    </PageContainer>
  );
}
