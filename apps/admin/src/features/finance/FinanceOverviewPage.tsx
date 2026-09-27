import { useMemo } from 'react';
import { Link } from 'react-router';
import { ArrowRight, BadgePercent, Banknote, CircleDollarSign, CreditCard, HandCoins, PiggyBank, RotateCw, Undo2, Wallet } from 'lucide-react';
import { AreaChart, Button, Card, CardContent, CardHeader, DonutChart, EmptyState, PageContainer, PageHeader, Skeleton, StatCard, Tooltip, cn, formatNumber, Table } from '@golink/ui';
import { PAYMENT_METHOD_LABELS, PROMOTION_FUNDING_LABELS, type FinanceOverview, type FinanceScopeInput, type PaymentMethod, type PromotionFunding } from '@golink/shared';
import { useDocumentTitle } from '@golink/web';
import { useGeoScope } from '@/layout/GeoScope';
import { getFinanceOverview } from '../argent-commun/api';
import { Callout, ErrorPanel, ExportMenu, Money, PeriodBar } from '../argent-commun/components';
import { downloadCsv, downloadXlsx, type Sheet } from '../argent-commun/export';
import { change, eur, eurCompact, periodLabel, plural, ratio, shortDay } from '../argent-commun/format';
import { useCallableQuery, useFinancePeriod } from '../argent-commun/hooks';
import { FinanceNav } from './nav';

/** Vue d'ensemble financière (cahier §15) : du montant payé par les clients à la marge Ciyou Eats. */
export function FinanceOverviewPage() {
  useDocumentTitle('Finance · Ciyou Eats Admin');
  const geo = useGeoScope();
  const { period, setPreset, setCustom } = useFinancePeriod('overview');
  const input = useMemo<FinanceScopeInput>(
    () => ({ from: period.from, to: period.to, countryId: geo.countryId, cityIds: geo.cityIds }),
    [period.from, period.to, geo.countryId, geo.cityIds],
  );
  const overview = useCallableQuery(getFinanceOverview, input, JSON.stringify(input));
  const data = overview.data;
  const t = data?.totals;
  const p = data?.previous;
  const loading = overview.loading;

  const chart = useMemo(
    () => (data?.daily ?? []).map((d) => ({ day: shortDay(d.day), encaisse: d.grossCents, revenu: d.netRevenueCents, marge: d.marginCents })),
    [data?.daily],
  );

  async function onExport(format: 'csv' | 'xlsx' | 'pdf') {
    if (!data) return;
    const daily: Sheet = {
      name: 'Par jour',
      columns: [
        { header: 'Jour', kind: 'date', width: 12 },
        { header: 'Commandes', kind: 'number' },
        { header: 'Encaissé TTC', kind: 'money', width: 16 },
        { header: 'Revenu Ciyou Eats HT', kind: 'money', width: 18 },
        { header: 'Marge nette', kind: 'money', width: 14 },
        { header: 'Remboursements', kind: 'money', width: 16 },
      ],
      rows: data.daily.map((d) => [d.day, d.ordersCount, d.grossCents, d.netRevenueCents, d.marginCents, d.refundsCents]),
    };
    const totals: Sheet = {
      name: 'Synthèse',
      columns: [{ header: 'Indicateur', width: 40 }, { header: 'Période', kind: 'money', width: 16 }, { header: 'Période précédente', kind: 'money', width: 18 }],
      rows: [
        ['Encaissé auprès des clients (TTC)', data.totals.grossCents, data.previous.grossCents],
        ['Commissions HT', data.totals.commissionHtCents, data.previous.commissionHtCents],
        ['Frais clients HT (service, livraison)', data.totals.customerFeesHtCents, data.previous.customerFeesHtCents],
        ['Abonnements HT', data.totals.subscriptionsHtCents, data.previous.subscriptionsHtCents],
        ['Mises en avant HT', data.totals.sponsoredHtCents, data.previous.sponsoredHtCents],
        ['Revenu net Ciyou Eats HT', data.totals.netRevenueCents, data.previous.netRevenueCents],
        ['Part des commerces', data.totals.restaurantsPayoutCents, data.previous.restaurantsPayoutCents],
        ['Rémunération des livreurs', data.totals.courierCostCents, data.previous.courierCostCents],
        ['Pourboires reversés', data.totals.tipsCents, data.previous.tipsCents],
        ['Frais de paiement', data.totals.paymentFeesCents, data.previous.paymentFeesCents],
        ['Promotions financées par Ciyou Eats', data.totals.promoPlatformCents, data.previous.promoPlatformCents],
        ['Promotions financées par les commerces', data.totals.promoRestaurantCents, data.previous.promoRestaurantCents],
        ['Remboursements', data.totals.refundsCents, data.previous.refundsCents],
        ['TVA due par Ciyou Eats', data.totals.vatDueCents, data.previous.vatDueCents],
        ['Marge nette Ciyou Eats', data.totals.marginCents, data.previous.marginCents],
      ],
    };
    const name = `golink-finance-${period.from}-${period.to}`;
    if (format === 'csv') downloadCsv(daily, name);
    else await downloadXlsx([totals, daily], name, { title: 'Ciyou Eats · Vue d’ensemble financière', subtitle: `${geo.label} · ${periodLabel(period.from, period.to)}` });
  }

  const revenueParts = t
    ? [
        { label: 'Commissions', value: t.commissionHtCents },
        { label: 'Frais clients', value: t.customerFeesHtCents },
        { label: 'Abonnements', value: t.subscriptionsHtCents },
        { label: 'Mises en avant', value: t.sponsoredHtCents },
      ].filter((x) => x.value > 0)
    : [];

  return (
    <PageContainer wide>
      <PageHeader
        eyebrow={`Argent · ${geo.label}`}
        title="Finance et reversements"
        description="Tout l’argent qui circule : ce que paient les clients, ce que garde Ciyou Eats, ce que reçoivent commerces et livreurs."
        actions={
          <>
            <PeriodBar period={period} onPreset={setPreset} onCustom={setCustom} />
            <Tooltip content="Actualiser">
              <Button variant="ghost" size="sm" aria-label="Actualiser" onClick={overview.reload} loading={overview.refreshing}>
                <RotateCw />
              </Button>
            </Tooltip>
            <ExportMenu onExport={onExport} disabled={!data} />
          </>
        }
      >
        <FinanceNav />
      </PageHeader>

      {overview.error && !data ? (
        <ErrorPanel error={overview.error} onRetry={overview.reload} />
      ) : (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard label="Encaissé auprès des clients" icon={<CreditCard />} tone="brand" loading={loading} value={t ? eur(t.grossCents) : '—'} delta={t && p ? change(t.grossCents, p.grossCents) : undefined} deltaLabel="vs période précédente" footer={t ? `${plural(t.ordersCount, 'commande')} livrée${t.ordersCount > 1 ? 's' : ''}` : undefined} />
            <StatCard label="Revenu net Ciyou Eats (HT)" icon={<CircleDollarSign />} tone="success" loading={loading} value={t ? eur(t.netRevenueCents) : '—'} delta={t && p ? change(t.netRevenueCents, p.netRevenueCents) : undefined} deltaLabel="vs période précédente" footer={t && t.grossCents ? `Taux de prélèvement ${ratio(t.netRevenueCents / t.grossCents)}` : undefined} />
            <StatCard label="Commissions (HT)" icon={<HandCoins />} tone="info" loading={loading} value={t ? eur(t.commissionHtCents) : '—'} delta={t && p ? change(t.commissionHtCents, p.commissionHtCents) : undefined} deltaLabel="vs période précédente" footer={t ? `Abonnements ${eur(t.subscriptionsHtCents)} · Frais ${eur(t.customerFeesHtCents)}` : undefined} />
            <StatCard label="Marge nette Ciyou Eats" icon={<PiggyBank />} tone={t && t.marginCents < 0 ? 'danger' : 'teal'} loading={loading} value={t ? eur(t.marginCents) : '—'} delta={t && p ? change(t.marginCents, p.marginCents) : undefined} deltaLabel="après livreurs, frais et promotions" />
          </div>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard label="Remboursements" icon={<Undo2 />} tone="danger" invertDelta loading={loading} value={t ? eur(t.refundsCents) : '—'} delta={t && p ? change(t.refundsCents, p.refundsCents) : undefined} footer={t ? `Imputés aux commerces : ${eur(t.refundsRestaurantCents)}` : undefined} />
            <StatCard label="Promotions financées par Ciyou Eats" icon={<BadgePercent />} tone="plum" invertDelta loading={loading} value={t ? eur(t.promoPlatformCents) : '—'} delta={t && p ? change(t.promoPlatformCents, p.promoPlatformCents) : undefined} footer={t ? `Financées par les commerces : ${eur(t.promoRestaurantCents)}` : undefined} />
            <StatCard label="Frais de paiement" icon={<Banknote />} tone="amber" invertDelta loading={loading} value={t ? eur(t.paymentFeesCents) : '—'} delta={t && p ? change(t.paymentFeesCents, p.paymentFeesCents) : undefined} footer="Déduits des reversements des commerces" />
            <StatCard label="Part reversée aux commerces" icon={<Wallet />} tone="neutral" loading={loading} value={t ? eur(t.restaurantsPayoutCents) : '—'} delta={t && p ? change(t.restaurantsPayoutCents, p.restaurantsPayoutCents) : undefined} footer={t ? `Livreurs : ${eur(t.courierCostCents + t.tipsCents)} (pourboires inclus)` : undefined} />
          </div>

          <div className="grid gap-4 xl:grid-cols-3">
            <Card className="xl:col-span-2">
              <CardHeader title="Évolution" description={`Encaissements, revenu Ciyou Eats et marge · ${periodLabel(period.from, period.to)}`} divided />
              <CardContent>
                {loading ? (
                  <Skeleton className="h-[280px] w-full" />
                ) : chart.every((d) => d.encaisse === 0) ? (
                  <EmptyState compact icon={<CreditCard />} title="Aucune commande livrée sur la période" description="Élargissez la période ou changez de marché dans le filtre en haut de l’écran." />
                ) : (
                  <AreaChart
                    data={chart}
                    xKey="day"
                    series={[
                      { key: 'encaisse', label: 'Encaissé TTC' },
                      { key: 'revenu', label: 'Revenu Ciyou Eats HT' },
                      { key: 'marge', label: 'Marge nette' },
                    ]}
                    valueFormatter={eur}
                    axisFormatter={eurCompact}
                  />
                )}
              </CardContent>
            </Card>
            <MoneyFlowCard overview={data} loading={loading} />
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <BalancesCard overview={data} loading={loading} />
            <Card>
              <CardHeader title="Composition du revenu" description="Revenu net Ciyou Eats hors taxes" divided />
              <CardContent>
                {loading ? (
                  <Skeleton className="h-48 w-full" />
                ) : revenueParts.length === 0 ? (
                  <EmptyState compact title="Aucun revenu sur la période" />
                ) : (
                  <DonutChart data={revenueParts} valueFormatter={eur} centerValue={eurCompact(t?.netRevenueCents ?? 0)} centerLabel="HT" />
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader title="Moyens de paiement" description="Montants encaissés par moyen" divided />
              <CardContent className="space-y-3">
                {loading ? (
                  Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-8 w-full" />)
                ) : !data?.byMethod.length ? (
                  <EmptyState compact title="Aucun paiement sur la période" />
                ) : (
                  data.byMethod.map((m) => {
                    const share = t && t.grossCents ? m.amountCents / t.grossCents : 0;
                    return (
                      <div key={m.method}>
                        <div className="flex items-center justify-between gap-3 text-sm">
                          <span className="text-fg">{PAYMENT_METHOD_LABELS[m.method as PaymentMethod] ?? m.method}</span>
                          <span className="font-mono text-fg-muted num">{eur(m.amountCents)}</span>
                        </div>
                        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-3">
                          <div className="h-full rounded-full bg-chart-1" style={{ width: `${Math.max(2, share * 100)}%` }} />
                        </div>
                        <p className="mt-1 text-2xs text-fg-subtle">
                          {plural(m.count, 'paiement')} · {ratio(share)}
                        </p>
                      </div>
                    );
                  })
                )}
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <Card>
              <CardHeader title="Coût des promotions" description="Combien ont coûté les offres, et qui les a financées" divided />
              <CardContent className="p-0">
                {loading ? (
                  <div className="space-y-2 p-5">{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-9 w-full" />)}</div>
                ) : !data?.promotions.length ? (
                  <EmptyState compact icon={<BadgePercent />} title="Aucune promotion utilisée" description="Aucune offre n’a été appliquée sur la période et le périmètre choisis." />
                ) : (
                  <div className="overflow-x-auto">
                    <Table className="w-full min-w-[520px] text-sm">
                      <thead>
                        <tr className="border-b border-border bg-surface-2 text-left">
                          <th className="eyebrow px-5 py-2.5 font-normal">Offre</th>
                          <th className="eyebrow px-3 py-2.5 text-right font-normal">Utilisations</th>
                          <th className="eyebrow px-3 py-2.5 text-right font-normal">Ciyou Eats</th>
                          <th className="eyebrow px-5 py-2.5 text-right font-normal">Commerces</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.promotions.slice(0, 8).map((promo) => (
                          <tr key={promo.promotionId} className="border-b border-border last:border-0">
                            <td className="px-5 py-3">
                              <p className="truncate font-medium text-fg">{promo.name}</p>
                              <p className="text-xs text-fg-subtle">{PROMOTION_FUNDING_LABELS[promo.funding as PromotionFunding] ?? promo.funding}</p>
                            </td>
                            <td className="px-3 py-3 text-right font-mono num">{formatNumber(promo.uses)}</td>
                            <td className="px-3 py-3 text-right"><Money cents={promo.platformCents} /></td>
                            <td className="px-5 py-3 text-right"><Money cents={promo.restaurantCents} /></td>
                          </tr>
                        ))}
                      </tbody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader title="Commerces les plus actifs" description="Encaissements et commissions de la période" divided actions={<Button asChild size="sm" variant="ghost" rightIcon={<ArrowRight />}><Link to="/finance/repartition">Détail par commande</Link></Button>} />
              <CardContent className="p-0">
                {loading ? (
                  <div className="space-y-2 p-5">{Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className="h-9 w-full" />)}</div>
                ) : !data?.topRestaurants.length ? (
                  <EmptyState compact title="Aucune vente sur la période" />
                ) : (
                  <ul className="divide-y divide-border">
                    {data.topRestaurants.map((r, index) => (
                      <li key={r.restaurantId} className="flex items-center gap-3 px-5 py-3">
                        <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-surface-3 font-mono text-xs text-fg-muted num">{index + 1}</span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-fg">{r.name}</p>
                          <p className="text-xs text-fg-subtle">{plural(r.orders, 'commande')} · commission {eur(r.commissionHtCents)} HT</p>
                        </div>
                        <Money cents={r.grossCents} className="text-sm text-fg" />
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          </div>
          {data && (
            <p className="text-xs text-fg-subtle">
              Montants calculés à partir de la répartition enregistrée à la livraison de chaque commande ; abonnements et mises en avant d’après les factures émises. Mis à jour le{' '}
              {new Date(data.generatedAt).toLocaleString('fr-FR', { dateStyle: 'long', timeStyle: 'short' })}.
            </p>
          )}
        </div>
      )}
    </PageContainer>
  );
}

/** Où va l'argent payé par les clients : décomposition en parts. */
function MoneyFlowCard({ overview, loading }: { overview: FinanceOverview | null; loading: boolean }) {
  const t = overview?.totals;
  const parts = t
    ? [
        { label: 'Commerces', value: t.restaurantsPayoutCents, className: 'bg-chart-2' },
        { label: 'Livreurs (pourboires inclus)', value: t.courierCostCents + t.tipsCents, className: 'bg-chart-5' },
        { label: 'Frais de paiement', value: t.paymentFeesCents, className: 'bg-chart-3' },
        { label: 'TVA due par Ciyou Eats', value: t.vatDueCents, className: 'bg-chart-6' },
        { label: 'Marge Ciyou Eats', value: Math.max(0, t.marginCents), className: 'bg-chart-1' },
      ]
    : [];
  const total = parts.reduce((s, x) => s + x.value, 0);
  return (
    <Card>
      <CardHeader title="Où va l’argent" description="Répartition des montants payés par les clients" divided />
      <CardContent>
        {loading ? (
          <Skeleton className="h-56 w-full" />
        ) : !t || t.grossCents === 0 ? (
          <EmptyState compact title="Rien à répartir" description="Aucune commande livrée sur la période." />
        ) : (
          <div className="space-y-4">
            <div className="flex h-3 overflow-hidden rounded-full bg-surface-3" role="img" aria-label="Répartition des encaissements">
              {parts.map((part) => (
                <div key={part.label} className={cn('h-full', part.className)} style={{ width: `${total ? (part.value / total) * 100 : 0}%` }} />
              ))}
            </div>
            <ul className="space-y-2.5">
              {parts.map((part) => (
                <li key={part.label} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-sm">
                  <span className="flex min-w-0 max-w-full items-center gap-2 text-fg-muted">
                    <span className={cn('size-2.5 shrink-0 rounded-full', part.className)} />
                    <span className="truncate">{part.label}</span>
                  </span>
                  <span className="max-w-full shrink-0 font-mono text-fg num">
                    {eur(part.value)} <span className="text-fg-subtle">· {ratio(total ? part.value / total : 0)}</span>
                  </span>
                </li>
              ))}
            </ul>
            {t.marginCents < 0 && (
              <Callout tone="danger" title="Marge négative">
                Les coûts dépassent le revenu Ciyou Eats sur la période ({eur(t.marginCents)}).
              </Callout>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function BalancesCard({ overview, loading }: { overview: FinanceOverview | null; loading: boolean }) {
  const b = overview?.balances;
  const rows = b
    ? [
        { label: 'À reverser aux commerces', hint: `${plural(b.scheduledCount, 'reversement')} programmé${b.scheduledCount > 1 ? 's' : ''}`, value: b.restaurantsPendingCents, to: '/finance/reversements?statut=scheduled' },
        { label: 'À reverser aux livreurs', hint: 'Gains, pourboires et bonus', value: b.driversPendingCents, to: '/finance/reversements?type=driver' },
        { label: 'Reversements bloqués', hint: plural(b.onHoldCount, 'reversement'), value: b.onHoldCents, to: '/finance/blocages' },
        { label: 'Reversements en échec', hint: plural(b.failedCount, 'reversement'), value: b.failedCents, to: '/finance/reversements?statut=failed', tone: b.failedCount ? 'text-danger' : undefined },
        { label: 'Espèces détenues par les livreurs', hint: 'À reverser à Ciyou Eats', value: b.driverCashHeldCents, to: '/paiements/especes' },
      ]
    : [];
  return (
    <Card>
      <CardHeader title="Soldes à date" description="Argent en attente de versement" divided />
      <CardContent className="p-0">
        {loading ? (
          <div className="space-y-2 p-5">{Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
        ) : (
          <ul className="divide-y divide-border">
            {rows.map((row) => (
              <li key={row.label}>
                <Link to={row.to} className="flex items-center justify-between gap-3 px-5 py-3 transition-colors hover:bg-surface-2">
                  <div className="min-w-0">
                    <p className="text-sm text-fg">{row.label}</p>
                    <p className="text-xs text-fg-subtle">{row.hint}</p>
                  </div>
                  <span className={cn('shrink-0 font-mono text-sm font-medium text-fg num', row.tone)}>{eur(row.value)}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
