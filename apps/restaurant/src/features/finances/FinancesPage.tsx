import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { ArrowRight, BadgePercent, Clock3, CreditCard, Euro, Info, PackageOpen, ReceiptText, ShoppingBag, Sparkles, Undo2, Wallet } from 'lucide-react';
import {
  BarChart,
  Card,
  CardContent,
  CardHeader,
  DonutChart,
  EmptyState,
  PageContainer,
  PageHeader,
  SegmentedControl,
  Skeleton,
  Sparkline,
  StatCard,
  Tooltip,
  formatDate,
  formatNumber,
  cn,
} from '@golink/ui';
import { useDocumentTitle } from '@golink/web';
import {
  DEFAULT_PRICING_BY_COUNTRY,
  FULFILLMENT_LABELS,
  PAYMENT_METHOD_LABELS,
  REFUND_CAUSE_LABELS,
  type FulfillmentMode,
  type PaymentMethod,
} from '@golink/shared';
import { useRestaurantAccess } from '@/auth/RestaurantAccess';
import { toDate } from '@/lib/firestore';
import { ExportMenu, type ExportFormat } from './components/ExportMenu';
import { PeriodPicker, usePeriod } from './components/PeriodPicker';
import { Callout, ErrorPanel } from './components/States';
import { TrendChart } from './components/TrendChart';
import { downloadCsv, downloadXlsx, type Sheet } from './lib/export';
import { bpsLabel, eur, eurCompact, plural, ratioLabel } from './lib/format';
import { restaurantShare, sumDaily, useDailyStats, useOrdersInRange, useRefundsInRange } from './lib/hooks';
import { buildTrend, ordersByHour, topProducts, type TrendMetric } from './lib/model';
import { change, fileStem } from './lib/period';
import { createPdf, generatedFooter } from './lib/pdf';

const METRICS: Array<{ value: TrendMetric; label: string }> = [
  { value: 'sales', label: 'Chiffre d’affaires' },
  { value: 'net', label: 'Net' },
  { value: 'orders', label: 'Commandes' },
  { value: 'basket', label: 'Panier moyen' },
];

const PAYMENT_COLORS: Partial<Record<PaymentMethod, string>> = {
  card: 'var(--gl-chart-1)',
  apple_pay: 'var(--gl-chart-2)',
  google_pay: 'var(--gl-chart-6)',
  cash: 'var(--gl-chart-3)',
  meal_voucher: 'var(--gl-chart-4)',
  wallet: 'var(--gl-chart-5)',
};

const MODE_TONES: Record<FulfillmentMode, string> = {
  delivery: 'bg-chart-1',
  pickup: 'bg-chart-2',
  dine_in: 'bg-chart-3',
};

/** Finances & ventes : chiffre d'affaires, du brut au net, répartitions, produits. */
export function FinancesPage() {
  useDocumentTitle('Finances & ventes · GoLink Restaurant');
  const { restaurant, restaurantId, can } = useRestaurantAccess();
  const [period, periodValue, setPeriod] = usePeriod();
  const [metric, setMetric] = useState<TrendMetric>('sales');
  const canOrders = can('orders.view');

  const current = useDailyStats(restaurantId, period.from, period.to);
  const previous = useDailyStats(restaurantId, period.previous.from, period.previous.to);
  const refunds = useRefundsInRange(restaurantId, period.start, period.endExclusive);
  const previousRefunds = useRefundsInRange(restaurantId, period.previous.start, period.previous.endExclusive);
  const orders = useOrdersInRange(restaurantId, period.start, period.endExclusive, canOrders);

  const totals = useMemo(() => sumDaily(current.data, restaurant.countryId), [current.data, restaurant.countryId]);
  const previousTotals = useMemo(() => sumDaily(previous.data, restaurant.countryId), [previous.data, restaurant.countryId]);
  const refundsCharged = useMemo(() => refunds.data.reduce((sum, refund) => sum + restaurantShare(refund), 0), [refunds.data]);
  const previousRefundsCharged = useMemo(
    () => previousRefunds.data.reduce((sum, refund) => sum + restaurantShare(refund), 0),
    [previousRefunds.data],
  );
  const net = totals.netPayoutCents - refundsCharged;
  const previousNet = previousTotals.netPayoutCents - previousRefundsCharged;
  const vatBps = DEFAULT_PRICING_BY_COUNTRY[restaurant.countryId]?.vat.standardBps ?? 2000;

  const trend = useMemo(
    () => buildTrend(period, current.data, previous.data, metric, { current: refunds.data, previous: previousRefunds.data }),
    [period, current.data, previous.data, metric, refunds.data, previousRefunds.data],
  );
  const salesSpark = useMemo(() => buildTrend(period, current.data, [], 'sales').map((point) => point.current), [period, current.data]);
  const products = useMemo(() => topProducts(orders.data), [orders.data]);
  const hours = useMemo(() => ordersByHour(orders.data), [orders.data]);
  const chargedRefunds = refunds.data.filter((refund) => restaurantShare(refund) > 0);

  const loading = current.loading || previous.loading;
  const empty = !loading && totals.orders === 0;
  const cancelRate = totals.orders > 0 ? (totals.cancelled / totals.orders) : 0;
  const metricFormat = metric === 'orders' ? (value: number) => formatNumber(value) : eur;
  const metricAxis = metric === 'orders' ? (value: number) => formatNumber(value, { compact: true }) : eurCompact;

  const payments = Object.entries(totals.byPayment)
    .filter(([, cents]) => cents > 0)
    .sort(([, a], [, b]) => b - a)
    .map(([method, cents]) => ({
      label: PAYMENT_METHOD_LABELS[method as PaymentMethod] ?? method,
      value: cents,
      color: PAYMENT_COLORS[method as PaymentMethod],
    }));
  const paymentsTotal = payments.reduce((sum, item) => sum + item.value, 0);
  const modes = (Object.keys(FULFILLMENT_LABELS) as FulfillmentMode[]).map((mode) => ({ mode, count: totals.byMode[mode] ?? 0 }));
  const modesTotal = modes.reduce((sum, item) => sum + item.count, 0);

  const waterfall = [
    { label: 'Ventes TTC (articles)', cents: totals.salesCents, sign: 1, hint: 'Prix payés par vos clients pour vos plats.' },
    { label: 'Remises que vous financez', cents: totals.discountCents, sign: -1, hint: 'Codes promo et offres à votre charge.' },
    { label: 'Commission GoLink HT', cents: totals.commissionHtCents, sign: -1, hint: 'Selon votre formule et le mode de commande.' },
    { label: `TVA sur commission (${bpsLabel(vatBps)})`, cents: totals.commissionVatCents, sign: -1, hint: 'Récupérable dans votre déclaration de TVA.' },
    { label: 'Remboursements imputés', cents: refundsCharged, sign: -1, hint: 'Part des remboursements clients à votre charge.' },
  ];
  const segments = [
    { key: 'net', label: 'Net', cents: Math.max(net, 0), className: 'tone-success bg-(--tone-solid)' },
    { key: 'commission', label: 'Commission', cents: totals.commissionHtCents, className: 'tone-brand bg-(--tone-solid)' },
    { key: 'vat', label: 'TVA', cents: totals.commissionVatCents, className: 'tone-amber bg-(--tone-solid)' },
    { key: 'discount', label: 'Remises', cents: totals.discountCents, className: 'tone-plum bg-(--tone-solid)' },
    { key: 'refund', label: 'Remboursements', cents: refundsCharged, className: 'tone-danger bg-(--tone-solid)' },
  ];
  const segmentsTotal = segments.reduce((sum, segment) => sum + segment.cents, 0);

  async function exportData(format: ExportFormat) {
    const stem = fileStem('finances', restaurant.name, period);
    const days = [...current.data].sort((a, b) => a.day.localeCompare(b.day));
    const daySheet: Sheet = {
      name: 'Par jour',
      columns: [
        { header: 'Date', kind: 'date', width: 12 },
        { header: 'Commandes', kind: 'number' },
        { header: 'Livrées', kind: 'number' },
        { header: 'Annulées', kind: 'number' },
        { header: 'Ventes TTC', kind: 'money', width: 14 },
        { header: 'Remises', kind: 'money' },
        { header: 'Commission HT', kind: 'money', width: 15 },
        { header: 'Net avant remboursements', kind: 'money', width: 24 },
        { header: 'Panier moyen', kind: 'money', width: 14 },
      ],
      rows: days.map((day) => [
        day.day,
        day.ordersCount,
        day.deliveredCount,
        day.cancelledCount,
        day.salesCents,
        day.discountFundedCents,
        day.commissionCents,
        day.netPayoutCents,
        day.averageBasketCents,
      ]),
      totals: ['Total', totals.orders, totals.delivered, totals.cancelled, totals.salesCents, totals.discountCents, totals.commissionHtCents, totals.netPayoutCents, totals.averageBasketCents],
    };
    const summarySheet: Sheet = {
      name: 'Synthèse',
      columns: [{ header: 'Indicateur', width: 36 }, { header: 'Montant', kind: 'money', width: 16 }],
      rows: [
        ...waterfall.map((row) => [row.label, row.sign * row.cents]),
        ['Net à percevoir', net],
        ['Panier moyen', totals.averageBasketCents],
      ],
    };
    const paymentSheet: Sheet = {
      name: 'Paiements',
      columns: [{ header: 'Moyen de paiement', width: 24 }, { header: 'Montant encaissé', kind: 'money', width: 18 }, { header: 'Part', kind: 'percent' }],
      rows: payments.map((item) => [item.label, item.value, paymentsTotal ? item.value / paymentsTotal : 0]),
    };
    const productSheet: Sheet = {
      name: 'Top produits',
      columns: [{ header: 'Produit', width: 32 }, { header: 'Quantité', kind: 'number' }, { header: 'Chiffre d’affaires TTC', kind: 'money', width: 20 }, { header: 'Part', kind: 'percent' }],
      rows: products.items.map((item) => [item.name, item.quantity, item.salesCents, products.totalCents ? item.salesCents / products.totalCents : 0]),
    };
    const title = `Finances et ventes · ${restaurant.name}`;
    if (format === 'csv') return downloadCsv(daySheet, stem);
    if (format === 'xlsx') {
      return downloadXlsx([summarySheet, daySheet, paymentSheet, ...(canOrders ? [productSheet] : [])], stem, { title, subtitle: `Période : ${period.label}` });
    }
    const pdf = await createPdf({ title: 'Rapport financier', subtitle: [restaurant.name, `Période : ${period.label}`], footer: generatedFooter(restaurant.name) });
    pdf.kpis([
      { label: 'Ventes TTC', value: eur(totals.salesCents) },
      { label: 'Net à percevoir', value: eur(net), accent: true },
      { label: 'Commandes livrées', value: formatNumber(totals.delivered) },
      { label: 'Panier moyen', value: eur(totals.averageBasketCents) },
    ]);
    pdf.heading('Du brut au net');
    pdf.table({
      head: ['Poste', 'Montant'],
      body: waterfall.map((row) => [row.label, `${row.sign < 0 && row.cents > 0 ? '-' : ''}${eur(row.cents)}`]),
      foot: ['Net à percevoir', eur(net)],
      rightAligned: [1],
    });
    pdf.heading('Détail par jour');
    pdf.table({
      head: ['Date', 'Livrées', 'Annulées', 'Ventes TTC', 'Commission HT', 'Net'],
      body: days.map((day) => [formatDate(new Date(`${day.day}T12:00:00`)), formatNumber(day.deliveredCount), formatNumber(day.cancelledCount), eur(day.salesCents), eur(day.commissionCents), eur(day.netPayoutCents)]),
      foot: ['Total', formatNumber(totals.delivered), formatNumber(totals.cancelled), eur(totals.salesCents), eur(totals.commissionHtCents), eur(totals.netPayoutCents)],
      rightAligned: [1, 2, 3, 4, 5],
    });
    if (payments.length) {
      pdf.heading('Encaissements par moyen de paiement');
      pdf.table({
        head: ['Moyen de paiement', 'Montant', 'Part'],
        body: payments.map((item) => [item.label, eur(item.value), paymentsTotal ? ratioLabel(item.value / paymentsTotal) : '—']),
        rightAligned: [1, 2],
      });
    }
    if (canOrders && products.items.length) {
      pdf.heading('Produits les plus vendus');
      pdf.table({
        head: ['#', 'Produit', 'Quantité', 'CA TTC'],
        body: products.items.map((item, index) => [String(index + 1), item.name, formatNumber(item.quantity), eur(item.salesCents)]),
        rightAligned: [2, 3],
        columnWidths: { 0: 10 },
      });
    }
    pdf.paragraph('Montants calculés sur les commandes livrées. La TVA sur commission est récupérable ; l’abonnement GoLink est facturé séparément (rubrique Factures).');
    pdf.save(stem);
  }

  return (
    <PageContainer>
      <PageHeader
        eyebrow="Finances"
        title="Finances & ventes"
        description={`Chiffre d’affaires, commissions et net à percevoir de ${restaurant.name}.`}
        actions={<ExportMenu onExport={exportData} disabled={loading || empty} />}
      >
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <PeriodPicker period={period} value={periodValue} onChange={setPeriod} />
          <p className="text-xs text-fg-subtle">
            Comparaison avec <span className="text-fg-muted">{period.previous.label}</span>
          </p>
        </div>
      </PageHeader>

      {current.error ? (
        <ErrorPanel error={current.error} />
      ) : (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              label="Chiffre d’affaires"
              value={eur(totals.salesCents)}
              delta={loading ? undefined : change(totals.salesCents, previousTotals.salesCents)}
              deltaLabel="vs période précédente"
              icon={<Euro />}
              loading={loading}
              chart={salesSpark.length > 1 ? <Sparkline data={salesSpark} /> : undefined}
            />
            <StatCard
              label="Net à percevoir"
              value={eur(net)}
              delta={loading ? undefined : change(net, previousNet)}
              deltaLabel="après commission"
              icon={<Wallet />}
              tone="success"
              loading={loading || refunds.loading}
              footer="Ventes − remises − commission TTC − remboursements imputés."
            />
            <StatCard
              label="Commandes livrées"
              value={formatNumber(totals.delivered)}
              delta={loading ? undefined : change(totals.delivered, previousTotals.delivered)}
              icon={<ShoppingBag />}
              tone="info"
              loading={loading}
              footer={
                totals.orders > 0
                  ? `${plural(totals.cancelled, 'annulation')} · ${ratioLabel(cancelRate)} des commandes`
                  : 'Aucune commande sur la période.'
              }
            />
            <StatCard
              label="Panier moyen"
              value={totals.delivered ? eur(totals.averageBasketCents) : '—'}
              delta={loading ? undefined : change(totals.averageBasketCents, previousTotals.averageBasketCents)}
              icon={<ReceiptText />}
              tone="amber"
              loading={loading}
              footer={`${plural(totals.newCustomers, 'nouveau client', 'nouveaux clients')} sur la période`}
            />
          </div>

          <div className="grid gap-4 xl:grid-cols-3">
            <Card className="min-w-0 xl:col-span-2">
              <CardHeader
                eyebrow={period.label}
                title="Évolution"
                description={`Par ${period.granularity === 'day' ? 'jour' : period.granularity === 'week' ? 'semaine' : 'mois'}, comparée à la période précédente.`}
              />
              <CardContent className="relative pt-2">
                <SegmentedControl
                  size="sm"
                  className="mb-3"
                  aria-label="Indicateur affiché"
                  value={metric}
                  onValueChange={(value) => setMetric(value as TrendMetric)}
                  options={METRICS}
                />
                {loading ? (
                  <Skeleton className="h-[300px] w-full" />
                ) : (
                  <>
                    <TrendChart data={trend} format={metricFormat} axisFormat={metricAxis} />
                    {empty && (
                      <div className="pointer-events-none absolute inset-0 grid place-items-center">
                        <div className="rounded-xl border border-border bg-surface/90 px-5 py-4 text-center shadow-sm backdrop-blur-sm">
                          <p className="font-display text-md font-semibold text-fg">Aucune vente sur cette période</p>
                          <p className="mt-0.5 text-sm text-fg-muted">Choisissez une autre période pour voir l’activité.</p>
                        </div>
                      </div>
                    )}
                  </>
                )}
                <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-xs text-fg-muted">
                  <span className="inline-flex items-center gap-1.5">
                    <span className="size-2 rounded-full bg-chart-1" /> {period.label}
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="h-0.5 w-3 rounded-full bg-fg-subtle" /> {period.previous.label}
                  </span>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader eyebrow="Répartition" title="Du brut au net" description="Ce que deviennent vos ventes." />
              <CardContent className="pt-3">
                {loading ? (
                  <div className="space-y-3">
                    {Array.from({ length: 6 }, (_, index) => (
                      <Skeleton key={index} className="h-5 w-full" />
                    ))}
                  </div>
                ) : (
                  <>
                    <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-surface-3" aria-hidden="true">
                      {segmentsTotal > 0 &&
                        segments.map((segment) =>
                          segment.cents > 0 ? (
                            <div key={segment.key} className={segment.className} style={{ width: `${(segment.cents / segmentsTotal) * 100}%` }} />
                          ) : null,
                        )}
                    </div>
                    <dl className="mt-4 divide-y divide-border">
                      {waterfall.map((row) => (
                        <div key={row.label} className="flex items-start justify-between gap-3 py-2">
                          <dt className="min-w-0">
                            <Tooltip content={row.hint}>
                              <span className="cursor-help text-sm text-fg-muted decoration-border-strong decoration-dotted underline-offset-4 hover:underline">
                                {row.label}
                              </span>
                            </Tooltip>
                          </dt>
                          <dd className={cn('shrink-0 font-mono text-sm num', row.sign < 0 && row.cents > 0 ? 'text-fg-muted' : 'text-fg')}>
                            {row.sign < 0 && row.cents > 0 ? '− ' : ''}
                            {eur(row.cents)}
                          </dd>
                        </div>
                      ))}
                      <div className="flex items-center justify-between gap-3 pt-3">
                        <dt className="text-sm font-semibold text-fg">Net à percevoir</dt>
                        <dd className="font-display text-xl font-semibold tracking-tight text-fg num">{eur(net)}</dd>
                      </div>
                    </dl>
                    <p className="mt-3 flex gap-2 rounded-lg bg-surface-2 p-3 text-xs text-fg-muted">
                      <Info className="mt-0.5 size-3.5 shrink-0 text-fg-subtle" />
                      Frais de service et de livraison payés par vos clients reviennent à GoLink. L’abonnement est facturé à part.
                    </p>
                  </>
                )}
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
            <Card>
              <CardHeader icon={<CreditCard />} title="Moyens de paiement" description="Montants encaissés auprès de vos clients." />
              <CardContent>
                {loading ? (
                  <Skeleton className="h-44 w-full" />
                ) : payments.length === 0 ? (
                  <EmptyState compact title="Aucun encaissement" description="Les paiements apparaîtront dès la première commande livrée." />
                ) : (
                  <DonutChart data={payments} height={150} valueFormatter={eur} centerValue={eurCompact(paymentsTotal)} centerLabel="encaissés" />
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader icon={<PackageOpen />} title="Modes de commande" description="Commandes livrées ou remises au client." />
              <CardContent className="space-y-4">
                {loading ? (
                  <Skeleton className="h-36 w-full" />
                ) : (
                  modes.map((item) => (
                    <div key={item.mode}>
                      <div className="mb-1.5 flex items-center justify-between gap-2 text-sm">
                        <span className="flex items-center gap-2 text-fg-muted">
                          <span className={cn('size-2 rounded-full', MODE_TONES[item.mode])} />
                          {FULFILLMENT_LABELS[item.mode]}
                        </span>
                        <span className="font-mono text-xs text-fg num">
                          {formatNumber(item.count)}
                          <span className="ml-2 text-fg-subtle">{modesTotal ? ratioLabel(item.count / modesTotal) : '—'}</span>
                        </span>
                      </div>
                      <div className="h-1.5 overflow-hidden rounded-full bg-surface-3">
                        <div className={cn('h-full rounded-full', MODE_TONES[item.mode])} style={{ width: `${modesTotal ? (item.count / modesTotal) * 100 : 0}%` }} />
                      </div>
                    </div>
                  ))
                )}
                {!loading && (
                  <div className="grid grid-cols-2 gap-3 border-t border-border pt-4 text-sm">
                    <div>
                      <p className="text-xs text-fg-subtle">Commandes en retard</p>
                      <p className="mt-0.5 font-mono text-fg num">
                        {formatNumber(totals.late)}
                        <span className="ml-1.5 text-xs text-fg-subtle">{totals.delivered ? ratioLabel(totals.late / totals.delivered) : ''}</span>
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-fg-subtle">Refusées par vous</p>
                      <p className="mt-0.5 font-mono text-fg num">{formatNumber(totals.rejected)}</p>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="lg:col-span-2 xl:col-span-1">
              <CardHeader icon={<Clock3 />} title="Heures de commande" description="Commandes livrées selon l’heure de passage." />
              <CardContent>
                {!canOrders ? (
                  <EmptyState compact title="Accès aux commandes requis" description="Votre rôle ne permet pas de consulter le détail des commandes." />
                ) : orders.loading ? (
                  <Skeleton className="h-44 w-full" />
                ) : orders.error ? (
                  <ErrorPanel compact error={orders.error} onRetry={orders.refresh} className="border-0 shadow-none" />
                ) : hours.every((hour) => hour.commandes === 0) ? (
                  <EmptyState compact title="Pas encore de données" description="Aucune commande livrée sur la période." />
                ) : (
                  <BarChart data={hours} xKey="hour" series={[{ key: 'commandes', label: 'Commandes', color: 'var(--gl-chart-2)' }]} height={180} hideYAxis />
                )}
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-4 xl:grid-cols-5">
            <Card className="xl:col-span-3">
              <CardHeader
                icon={<Sparkles />}
                title="Produits les plus vendus"
                description="Classement par chiffre d’affaires TTC sur les commandes livrées."
              />
              <CardContent className="px-0 pb-2">
                {!canOrders ? (
                  <EmptyState compact title="Accès aux commandes requis" description="Demandez au propriétaire d’ajouter la permission « Voir les commandes » à votre rôle." />
                ) : orders.loading ? (
                  <div className="space-y-3 px-5">
                    {Array.from({ length: 5 }, (_, index) => (
                      <Skeleton key={index} className="h-8 w-full" />
                    ))}
                  </div>
                ) : orders.error ? (
                  <ErrorPanel compact error={orders.error} onRetry={orders.refresh} className="border-0 shadow-none" />
                ) : products.items.length === 0 ? (
                  <EmptyState compact icon={<PackageOpen />} title="Aucun produit vendu" description="Les ventes de la période apparaîtront ici." />
                ) : (
                  <ol className="divide-y divide-border">
                    {products.items.map((item, index) => {
                      const share = products.totalCents ? item.salesCents / products.totalCents : 0;
                      return (
                        <li key={item.productId} className="flex items-center gap-3 px-5 py-2.5">
                          <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-surface-2 font-mono text-xs text-fg-muted num">{index + 1}</span>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-baseline justify-between gap-3">
                              <p className="truncate text-sm font-medium text-fg">{item.name}</p>
                              <p className="shrink-0 font-mono text-sm text-fg num">{eur(item.salesCents)}</p>
                            </div>
                            <div className="mt-1.5 flex items-center gap-3">
                              <div className="h-1 flex-1 overflow-hidden rounded-full bg-surface-3">
                                <div className="h-full rounded-full bg-chart-1" style={{ width: `${Math.max(share * 100, 2)}%` }} />
                              </div>
                              <span className="w-28 shrink-0 text-right text-xs text-fg-subtle num">
                                {formatNumber(item.quantity)} vendus · {ratioLabel(share)}
                              </span>
                            </div>
                          </div>
                        </li>
                      );
                    })}
                  </ol>
                )}
              </CardContent>
            </Card>

            <Card className="xl:col-span-2">
              <CardHeader
                icon={<Undo2 />}
                title="Remboursements imputés"
                description="Part des remboursements retenue sur vos reversements."
              />
              <CardContent className="px-0 pb-2">
                {refunds.loading ? (
                  <div className="space-y-3 px-5">
                    {Array.from({ length: 3 }, (_, index) => (
                      <Skeleton key={index} className="h-10 w-full" />
                    ))}
                  </div>
                ) : refunds.error ? (
                  <ErrorPanel compact error={refunds.error} className="border-0 shadow-none" />
                ) : chargedRefunds.length === 0 ? (
                  <EmptyState compact icon={<BadgePercent />} title="Aucun remboursement à votre charge" description="Aucune retenue sur la période : continuez ainsi." />
                ) : (
                  <>
                    <ul className="divide-y divide-border">
                      {chargedRefunds.slice(0, 6).map((refund) => {
                        const at = toDate(refund.requestedAt);
                        const content = (
                          <>
                            <div className="min-w-0">
                              <p className="truncate text-sm font-medium text-fg">
                                {refund.orderNumber}
                                <span className="ml-2 font-normal text-fg-muted">{REFUND_CAUSE_LABELS[refund.cause] ?? refund.cause}</span>
                              </p>
                              <p className="text-xs text-fg-subtle">
                                {at ? formatDate(at) : '—'} · remboursé {eur(refund.amountCents)} au client
                              </p>
                            </div>
                            <span className="shrink-0 font-mono text-sm text-fg num">− {eur(restaurantShare(refund))}</span>
                          </>
                        );
                        return (
                          <li key={refund.id}>
                            {canOrders ? (
                              <Link to={`/commandes/${refund.orderId}`} className="flex items-center justify-between gap-3 px-5 py-2.5 transition-colors hover:bg-surface-2">
                                {content}
                              </Link>
                            ) : (
                              <div className="flex items-center justify-between gap-3 px-5 py-2.5">{content}</div>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                    <div className="flex items-center justify-between gap-3 border-t border-border px-5 pt-3 text-sm">
                      <span className="text-fg-muted">{plural(chargedRefunds.length, 'remboursement')} sur la période</span>
                      <Link to="/virements" className="inline-flex items-center gap-1 font-medium text-primary-soft-fg hover:underline">
                        Voir les virements <ArrowRight className="size-3.5" />
                      </Link>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          </div>

          {orders.truncated && (
            <Callout tone="amber" title="Période très chargée">
              Le classement des produits et des heures porte sur les {formatNumber(orders.data.length)} commandes les plus récentes. Réduisez la période pour un détail complet.
            </Callout>
          )}

          <p className="flex items-start gap-2 text-xs text-fg-subtle">
            <Info className="mt-0.5 size-3.5 shrink-0" />
            Seules les commandes livrées comptent dans le chiffre d’affaires. Les montants sont mis à jour à chaque commande et peuvent différer
            légèrement du relevé de reversement tant que la semaine n’est pas clôturée.
          </p>
        </div>
      )}
    </PageContainer>
  );
}
