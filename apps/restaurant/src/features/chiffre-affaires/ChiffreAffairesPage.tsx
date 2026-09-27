import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { CalendarDays, Info, ListOrdered, Percent, Receipt, RotateCw } from 'lucide-react';
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  DataTable,
  EmptyState,
  PageContainer,
  PageHeader,
  SegmentedControl,
  Skeleton,
  StatCard,
  StatusPill,
  createColumnHelper,
  formatDate,
  formatDateTime,
  formatNumber,
  type DataTableFilter,
} from '@golink/ui';
import { useDocumentTitle } from '@golink/web';
import {
  FULFILLMENT_LABELS,
  ORDER_STATUS_LABELS,
  ORDER_STATUS_TONES,
  PAYMENT_METHOD_LABELS,
  type FulfillmentMode,
  type OrderStatus,
  type PaymentMethod,
  type RestaurantDailyStats,
  type WithId,
} from '@golink/shared';
import { useRestaurantAccess } from '@/auth/RestaurantAccess';
import { toDate } from '@/lib/firestore';
import { ExportMenu, type ExportFormat } from '../finances/components/ExportMenu';
import { PeriodPicker, usePeriod } from '../finances/components/PeriodPicker';
import { Callout, ErrorPanel } from '../finances/components/States';
import { downloadCsv, downloadXlsx, type Sheet } from '../finances/lib/export';
import { bpsLabel, eur } from '../finances/lib/format';
import { sumDaily, useDailyStats, useLedgerInRange, useOrdersInRange } from '../finances/lib/hooks';
import { fileStem } from '../finances/lib/period';
import { createPdf, generatedFooter } from '../finances/lib/pdf';

interface JournalRow {
  id: string;
  number: string;
  placedAt: Date | null;
  customer: string;
  mode: FulfillmentMode;
  payment: PaymentMethod;
  status: OrderStatus;
  ttcCents: number;
  htCents: number;
  vatCents: number;
  discountCents: number;
  commissionCents: number;
  refundCents: number;
  netCents: number;
}

interface VatRow {
  rateBps: number;
  htCents: number;
  vatCents: number;
  ttcCents: number;
  orders: number;
}

const column = createColumnHelper<JournalRow>();
const dayColumn = createColumnHelper<WithId<RestaurantDailyStats>>();
const TONE_MAP = { success: 'success', danger: 'danger', warning: 'amber', info: 'info', neutral: 'neutral', accent: 'brand' } as const;

/** États du chiffre d'affaires : journal par jour et par commande, TVA par taux. */
export function ChiffreAffairesPage() {
  useDocumentTitle('États du chiffre d’affaires · GoLink Restaurant');
  const navigate = useNavigate();
  const { restaurant, restaurantId, can } = useRestaurantAccess();
  const [period, periodValue, setPeriod] = usePeriod();
  const canOrders = can('orders.view');
  const [view, setView] = useState<'orders' | 'days'>(canOrders ? 'orders' : 'days');

  const daily = useDailyStats(restaurantId, period.from, period.to);
  const orders = useOrdersInRange(restaurantId, period.start, period.endExclusive, canOrders);
  const ledger = useLedgerInRange(restaurantId, period.start, period.endExclusive, canOrders);
  const totals = useMemo(() => sumDaily(daily.data, restaurant.countryId), [daily.data, restaurant.countryId]);

  const rows = useMemo<JournalRow[]>(() => {
    const byOrder = new Map<string, { commission: number; refund: number; revenue: number }>();
    for (const entry of ledger.data) {
      if (!entry.orderId) continue;
      const acc = byOrder.get(entry.orderId) ?? { commission: 0, refund: 0, revenue: 0 };
      if (entry.type === 'commission') acc.commission += -entry.amountCents;
      else if (entry.type === 'refund_charge') acc.refund += -entry.amountCents;
      else acc.revenue += entry.amountCents;
      byOrder.set(entry.orderId, acc);
    }
    return orders.data.map((order) => {
      const vat = order.amounts?.itemsVat ?? [];
      const ht = vat.reduce((s, l) => s + l.htCents, 0);
      const vatCents = vat.reduce((s, l) => s + l.vatCents, 0);
      const ledgerRow = byOrder.get(order.id);
      const delivered = order.status === 'delivered';
      return {
        id: order.id,
        number: order.number,
        placedAt: toDate(order.timeline?.placedAt ?? order.createdAt),
        customer: order.customerName,
        mode: order.fulfillment,
        payment: order.payment?.method ?? 'card',
        status: order.status,
        ttcCents: order.amounts?.subtotalCents ?? 0,
        htCents: ht,
        vatCents,
        discountCents: order.amounts?.discount?.restaurantFundedCents ?? 0,
        commissionCents: ledgerRow?.commission ?? 0,
        refundCents: ledgerRow?.refund ?? 0,
        netCents: delivered && ledgerRow ? ledgerRow.revenue - ledgerRow.commission - ledgerRow.refund : 0,
      };
    });
  }, [orders.data, ledger.data]);

  const delivered = rows.filter((row) => row.status === 'delivered');
  const vatRows = useMemo<VatRow[]>(() => {
    const map = new Map<number, VatRow>();
    for (const order of orders.data) {
      if (order.status !== 'delivered') continue;
      for (const line of order.amounts?.itemsVat ?? []) {
        const row = map.get(line.rateBps) ?? { rateBps: line.rateBps, htCents: 0, vatCents: 0, ttcCents: 0, orders: 0 };
        row.htCents += line.htCents;
        row.vatCents += line.vatCents;
        row.ttcCents += line.ttcCents;
        row.orders += 1;
        map.set(line.rateBps, row);
      }
    }
    return [...map.values()].sort((a, b) => a.rateBps - b.rateBps);
  }, [orders.data]);
  const vatTotal = vatRows.reduce((acc, r) => ({ ht: acc.ht + r.htCents, vat: acc.vat + r.vatCents, ttc: acc.ttc + r.ttcCents }), { ht: 0, vat: 0, ttc: 0 });
  const commissionVat = ledger.data.filter((e) => e.type === 'commission').reduce((s, e) => s + (e.vatCents ?? 0), 0);
  const sum = (key: keyof Pick<JournalRow, 'ttcCents' | 'htCents' | 'vatCents' | 'discountCents' | 'commissionCents' | 'refundCents' | 'netCents'>) =>
    delivered.reduce((s, row) => s + row[key], 0);

  const columns = useMemo(
    () => [
      column.accessor('number', {
        header: 'Commande',
        cell: (info) => (
          <div>
            <p className="font-mono text-sm font-medium text-fg">{info.getValue()}</p>
            <p className="text-xs text-fg-subtle">{info.row.original.placedAt ? formatDateTime(info.row.original.placedAt) : '—'}</p>
          </div>
        ),
      }),
      column.accessor('customer', { header: 'Client', cell: (info) => <span className="text-sm text-fg-muted">{info.getValue()}</span> }),
      column.accessor('status', {
        header: 'Statut',
        cell: (info) => {
          const tone = ORDER_STATUS_TONES[info.getValue()] as keyof typeof TONE_MAP;
          return <StatusPill tone={TONE_MAP[tone] ?? 'neutral'}>{ORDER_STATUS_LABELS[info.getValue()]}</StatusPill>;
        },
      }),
      column.accessor('mode', { header: 'Mode', cell: (info) => <span className="text-sm">{FULFILLMENT_LABELS[info.getValue()]}</span> }),
      column.accessor('payment', { header: 'Paiement', cell: (info) => <span className="text-sm text-fg-muted">{PAYMENT_METHOD_LABELS[info.getValue()]}</span> }),
      column.accessor('htCents', { header: 'HT', meta: { align: 'right' }, cell: (info) => <span className="font-mono text-sm num">{eur(info.getValue())}</span> }),
      column.accessor('vatCents', { header: 'TVA', meta: { align: 'right' }, cell: (info) => <span className="font-mono text-sm text-fg-muted num">{eur(info.getValue())}</span> }),
      column.accessor('ttcCents', { header: 'TTC', meta: { align: 'right' }, cell: (info) => <span className="font-mono text-sm font-medium num">{eur(info.getValue())}</span> }),
      column.accessor('commissionCents', {
        header: 'Commission TTC',
        meta: { align: 'right' },
        cell: (info) => <span className="font-mono text-sm text-fg-muted num">{info.getValue() ? `− ${eur(info.getValue())}` : '—'}</span>,
      }),
      column.accessor('netCents', {
        header: 'Net',
        meta: { align: 'right' },
        cell: (info) =>
          info.row.original.status === 'delivered' ? <span className="font-mono text-sm font-semibold num">{eur(info.getValue())}</span> : <span className="text-fg-subtle">—</span>,
      }),
    ],
    [],
  );

  const dayColumns = useMemo(
    () => [
      dayColumn.accessor('day', {
        header: 'Jour',
        cell: (info) => <span className="text-sm font-medium capitalize">{new Date(`${info.getValue()}T12:00:00`).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}</span>,
      }),
      dayColumn.accessor('deliveredCount', { header: 'Livrées', meta: { align: 'right' }, cell: (i) => <span className="font-mono num">{formatNumber(i.getValue())}</span> }),
      dayColumn.accessor('cancelledCount', { header: 'Annulées', meta: { align: 'right' }, cell: (i) => <span className="font-mono text-fg-muted num">{formatNumber(i.getValue())}</span> }),
      dayColumn.accessor('salesCents', { header: 'Ventes TTC', meta: { align: 'right' }, cell: (i) => <span className="font-mono font-medium num">{eur(i.getValue())}</span> }),
      dayColumn.accessor('discountFundedCents', { header: 'Remises', meta: { align: 'right' }, cell: (i) => <span className="font-mono text-fg-muted num">{eur(i.getValue())}</span> }),
      dayColumn.accessor('commissionCents', { header: 'Commission HT', meta: { align: 'right' }, cell: (i) => <span className="font-mono text-fg-muted num">{eur(i.getValue())}</span> }),
      dayColumn.accessor('netPayoutCents', { header: 'Net', meta: { align: 'right' }, cell: (i) => <span className="font-mono font-semibold num">{eur(i.getValue())}</span> }),
      dayColumn.accessor('averageBasketCents', { header: 'Panier moyen', meta: { align: 'right' }, cell: (i) => <span className="font-mono text-fg-muted num">{eur(i.getValue())}</span> }),
    ],
    [],
  );

  const filters: DataTableFilter<JournalRow>[] = [
    {
      id: 'status',
      label: 'Statut',
      options: (['delivered', 'cancelled', 'new', 'accepted', 'preparing', 'ready', 'assigned', 'picked_up'] as OrderStatus[])
        .filter((s) => rows.some((r) => r.status === s))
        .map((s) => ({ value: s, label: ORDER_STATUS_LABELS[s] })),
      getValue: (row) => row.status,
    },
    {
      id: 'mode',
      label: 'Mode',
      options: (Object.keys(FULFILLMENT_LABELS) as FulfillmentMode[]).map((m) => ({ value: m, label: FULFILLMENT_LABELS[m] })),
      getValue: (row) => row.mode,
    },
    {
      id: 'payment',
      label: 'Paiement',
      options: (Object.keys(PAYMENT_METHOD_LABELS) as PaymentMethod[]).filter((p) => rows.some((r) => r.payment === p)).map((p) => ({ value: p, label: PAYMENT_METHOD_LABELS[p] })),
      getValue: (row) => row.payment,
    },
  ];

  async function exportData(format: ExportFormat) {
    const stem = fileStem('etats-ca', restaurant.name, period);
    const journal: Sheet = {
      name: 'Journal des commandes',
      columns: [
        { header: 'Commande', width: 12 },
        { header: 'Date', width: 18 },
        { header: 'Client', width: 18 },
        { header: 'Statut', width: 14 },
        { header: 'Mode' },
        { header: 'Paiement', width: 16 },
        { header: 'HT', kind: 'money' },
        { header: 'TVA', kind: 'money' },
        { header: 'TTC', kind: 'money' },
        { header: 'Remise financée', kind: 'money', width: 16 },
        { header: 'Commission TTC', kind: 'money', width: 16 },
        { header: 'Remboursement imputé', kind: 'money', width: 20 },
        { header: 'Net', kind: 'money' },
      ],
      rows: rows.map((r) => [
        r.number,
        r.placedAt ? r.placedAt.toLocaleString('fr-FR') : '',
        r.customer,
        ORDER_STATUS_LABELS[r.status],
        FULFILLMENT_LABELS[r.mode],
        PAYMENT_METHOD_LABELS[r.payment],
        r.htCents,
        r.vatCents,
        r.ttcCents,
        r.discountCents,
        r.commissionCents,
        r.refundCents,
        r.status === 'delivered' ? r.netCents : null,
      ]),
      totals: ['Total livré', '', '', '', '', '', sum('htCents'), sum('vatCents'), sum('ttcCents'), sum('discountCents'), sum('commissionCents'), sum('refundCents'), sum('netCents')],
    };
    const days: Sheet = {
      name: 'Par jour',
      columns: [
        { header: 'Jour', kind: 'date', width: 12 },
        { header: 'Livrées', kind: 'number' },
        { header: 'Annulées', kind: 'number' },
        { header: 'Ventes TTC', kind: 'money', width: 14 },
        { header: 'Remises', kind: 'money' },
        { header: 'Commission HT', kind: 'money', width: 15 },
        { header: 'Net', kind: 'money' },
      ],
      rows: [...daily.data].sort((a, b) => a.day.localeCompare(b.day)).map((d) => [d.day, d.deliveredCount, d.cancelledCount, d.salesCents, d.discountFundedCents, d.commissionCents, d.netPayoutCents]),
      totals: ['Total', totals.delivered, totals.cancelled, totals.salesCents, totals.discountCents, totals.commissionHtCents, totals.netPayoutCents],
    };
    const vat: Sheet = {
      name: 'TVA par taux',
      columns: [{ header: 'Taux', width: 10 }, { header: 'Base HT', kind: 'money', width: 14 }, { header: 'TVA collectée', kind: 'money', width: 14 }, { header: 'TTC', kind: 'money', width: 14 }],
      rows: vatRows.map((r) => [bpsLabel(r.rateBps), r.htCents, r.vatCents, r.ttcCents]),
      totals: ['Total', vatTotal.ht, vatTotal.vat, vatTotal.ttc],
    };
    const title = `États du chiffre d’affaires · ${restaurant.name}`;
    if (format === 'csv') return downloadCsv(canOrders ? journal : days, stem);
    if (format === 'xlsx') return downloadXlsx(canOrders ? [journal, days, vat] : [days], stem, { title, subtitle: `Période : ${period.label}` });
    const pdf = await createPdf({ title: 'États du chiffre d’affaires', subtitle: [restaurant.name, `Période : ${period.label}`], footer: generatedFooter(restaurant.name) });
    pdf.kpis([
      { label: 'Ventes TTC', value: eur(totals.salesCents) },
      { label: 'Commandes livrées', value: formatNumber(totals.delivered) },
      { label: 'TVA collectée', value: canOrders ? eur(vatTotal.vat) : '—' },
      { label: 'Net', value: eur(totals.netPayoutCents), accent: true },
    ]);
    if (canOrders && vatRows.length) {
      pdf.heading('TVA collectée par taux');
      pdf.table({
        head: ['Taux', 'Base HT', 'TVA', 'TTC'],
        body: vatRows.map((r) => [bpsLabel(r.rateBps), eur(r.htCents), eur(r.vatCents), eur(r.ttcCents)]),
        foot: ['Total', eur(vatTotal.ht), eur(vatTotal.vat), eur(vatTotal.ttc)],
        rightAligned: [1, 2, 3],
      });
      pdf.paragraph(`TVA déductible sur les commissions GoLink de la période : ${eur(commissionVat)}.`);
    }
    pdf.heading('Synthèse par jour');
    pdf.table({
      head: ['Jour', 'Livrées', 'Ventes TTC', 'Commission HT', 'Net'],
      body: [...daily.data].sort((a, b) => a.day.localeCompare(b.day)).map((d) => [formatDate(new Date(`${d.day}T12:00:00`)), formatNumber(d.deliveredCount), eur(d.salesCents), eur(d.commissionCents), eur(d.netPayoutCents)]),
      foot: ['Total', formatNumber(totals.delivered), eur(totals.salesCents), eur(totals.commissionHtCents), eur(totals.netPayoutCents)],
      rightAligned: [1, 2, 3, 4],
    });
    if (canOrders) {
      pdf.heading('Journal des commandes livrées');
      pdf.table({
        head: ['Commande', 'Date', 'Mode', 'HT', 'TVA', 'TTC', 'Commission', 'Net'],
        body: delivered.map((r) => [r.number, r.placedAt ? formatDateTime(r.placedAt) : '—', FULFILLMENT_LABELS[r.mode], eur(r.htCents), eur(r.vatCents), eur(r.ttcCents), eur(r.commissionCents), eur(r.netCents)]),
        foot: ['Total', '', '', eur(sum('htCents')), eur(sum('vatCents')), eur(sum('ttcCents')), eur(sum('commissionCents')), eur(sum('netCents'))],
        rightAligned: [3, 4, 5, 6, 7],
      });
    }
    pdf.save(stem);
  }

  const loading = daily.loading || (canOrders && (orders.loading || ledger.loading));
  const error = daily.error ?? orders.error ?? ledger.error;

  return (
    <PageContainer wide>
      <PageHeader
        eyebrow="Finances"
        title="États du chiffre d’affaires"
        description="Journal détaillé des ventes par jour et par commande, avec la TVA collectée par taux."
        actions={<ExportMenu onExport={exportData} disabled={loading || daily.data.length === 0} />}
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <PeriodPicker period={period} value={periodValue} onChange={setPeriod} />
          {canOrders && (
            <Button variant="ghost" size="sm" leftIcon={<RotateCw />} onClick={() => { orders.refresh(); ledger.refresh(); }}>
              Actualiser
            </Button>
          )}
        </div>
      </PageHeader>

      {error ? (
        <ErrorPanel error={error} onRetry={() => { orders.refresh(); ledger.refresh(); }} />
      ) : (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard label="Ventes TTC" value={eur(totals.salesCents)} icon={<Receipt />} loading={loading} footer={`${formatNumber(totals.delivered)} commandes livrées${totals.discountCents > 0 ? ` · avant ${eur(totals.discountCents)} de remises` : ''}`} />
            <StatCard label="Ventes HT" value={canOrders ? eur(vatTotal.ht) : '—'} icon={<ListOrdered />} tone="info" loading={loading} footer="Base imposable des plats et boissons" />
            <StatCard label="TVA collectée" value={canOrders ? eur(vatTotal.vat) : '—'} icon={<Percent />} tone="amber" loading={loading} footer={`TVA déductible sur commissions : ${canOrders ? eur(commissionVat) : '—'}`} />
            <StatCard label="Net" value={eur(totals.netPayoutCents)} icon={<CalendarDays />} tone="success" loading={loading} footer="Après remises et commission, avant remboursements" />
          </div>

          <div className="grid gap-4 xl:grid-cols-3">
            <Card className="xl:col-span-2">
              <CardHeader icon={<Percent />} title="TVA collectée par taux" description="Commandes livrées de la période. Montants à reporter dans votre déclaration." />
              <CardContent className="px-0 pb-2">
                {!canOrders ? (
                  <EmptyState compact title="Accès aux commandes requis" description="Le détail par taux nécessite la permission « Voir les commandes »." />
                ) : loading ? (
                  <div className="space-y-3 px-5">{Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-8 w-full" />)}</div>
                ) : vatRows.length === 0 ? (
                  <EmptyState compact title="Aucune vente taxable" description="Aucune commande livrée sur la période." />
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[480px] text-sm">
                      <thead>
                        <tr className="border-b border-border text-left font-mono text-3xs uppercase tracking-eyebrow text-fg-subtle">
                          <th className="px-5 py-2 font-medium">Taux</th>
                          <th className="px-5 py-2 text-right font-medium">Base HT</th>
                          <th className="px-5 py-2 text-right font-medium">TVA</th>
                          <th className="px-5 py-2 text-right font-medium">TTC</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {vatRows.map((r) => (
                          <tr key={r.rateBps}>
                            <td className="px-5 py-2.5 font-medium">{bpsLabel(r.rateBps)}</td>
                            <td className="px-5 py-2.5 text-right font-mono num">{eur(r.htCents)}</td>
                            <td className="px-5 py-2.5 text-right font-mono num">{eur(r.vatCents)}</td>
                            <td className="px-5 py-2.5 text-right font-mono num">{eur(r.ttcCents)}</td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr className="border-t border-border-strong bg-surface-2 font-semibold">
                          <td className="px-5 py-2.5">Total</td>
                          <td className="px-5 py-2.5 text-right font-mono num">{eur(vatTotal.ht)}</td>
                          <td className="px-5 py-2.5 text-right font-mono num">{eur(vatTotal.vat)}</td>
                          <td className="px-5 py-2.5 text-right font-mono num">{eur(vatTotal.ttc)}</td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
            <Callout
              tone="info"
              icon={<Info />}
              title="Comment lire ces montants"
              className="h-fit"
            >
              Le TTC correspond au prix des articles payés par vos clients, remises à votre charge déduites. Les frais de livraison, de service et les pourboires ne font pas partie de votre chiffre d’affaires. La TVA sur la commission GoLink figure sur vos factures mensuelles et reste déductible.
            </Callout>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <SegmentedControl
              aria-label="Vue du journal"
              value={view}
              onValueChange={(v) => setView(v as 'orders' | 'days')}
              options={[
                ...(canOrders ? [{ value: 'orders', label: 'Par commande', count: rows.length }] : []),
                { value: 'days', label: 'Par jour', count: daily.data.length },
              ]}
            />
            {orders.truncated && <p className="text-xs text-fg-subtle">Affichage limité aux {formatNumber(orders.data.length)} commandes les plus récentes.</p>}
          </div>

          {view === 'orders' && canOrders ? (
            <DataTable
              data={rows}
              columns={columns}
              getRowId={(row) => row.id}
              loading={loading}
              filters={filters}
              searchPlaceholder="N° de commande, client…"
              itemLabel="commandes"
              pageSize={25}
              onRowClick={(row) => navigate(`/commandes/${row.id}`)}
              emptyState={<EmptyState compact icon={<Receipt />} title="Aucune commande" description="Aucune commande passée sur la période choisie." />}
            />
          ) : (
            <DataTable
              data={[...daily.data].sort((a, b) => b.day.localeCompare(a.day))}
              columns={dayColumns}
              getRowId={(row) => row.id}
              loading={daily.loading}
              searchable={false}
              itemLabel="jours"
              pageSize={31}
              emptyState={<EmptyState compact icon={<CalendarDays />} title="Aucune activité" description="Aucune commande sur la période choisie." />}
            />
          )}
        </div>
      )}
    </PageContainer>
  );
}
