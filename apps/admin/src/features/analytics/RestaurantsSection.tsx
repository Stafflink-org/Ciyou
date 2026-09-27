import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { AlertTriangle, Star, Store, TrendingDown } from 'lucide-react';
import {
  Badge,
  BarChart,
  Card,
  CardHeader,
  DataTable,
  EmptyState,
  SegmentedControl,
  Section,
  Select,
  StatusBadge,
  createColumnHelper,
  formatNumber,
} from '@golink/ui';
import type { PilotageAnalytics, RestaurantRankingRow } from '@golink/shared';
import { ChartCard, PILOTAGE_PLAN_NAMES } from '../pilotage-commun/components';
import { Num, RESTAURANT_STATUS_META, RateCell, TrendBadge, euros, eurosCompact, minutes } from './shared';

type SortKey = 'salesCents' | 'orders' | 'rating' | 'cancellationRate' | 'averagePrepMinutes';

const SORTS: Array<{
  value: SortKey;
  label: string;
  /** Plus grand = meilleur. */ higherIsBetter: boolean;
  money?: boolean;
}> = [
  {
    value: 'salesCents',
    label: 'Chiffre d’affaires',
    higherIsBetter: true,
    money: true,
  },
  { value: 'orders', label: 'Commandes', higherIsBetter: true },
  { value: 'rating', label: 'Note moyenne', higherIsBetter: true },
  {
    value: 'cancellationRate',
    label: 'Taux d’annulation',
    higherIsBetter: false,
  },
  {
    value: 'averagePrepMinutes',
    label: 'Temps de préparation',
    higherIsBetter: false,
  },
];

const col = createColumnHelper<RestaurantRankingRow>();

/** Classements des commerces : top / flop et risque de départ (cahier §3). */
export function RestaurantsSection({
  data,
  cityNames,
  showMoney,
}: {
  data: NonNullable<PilotageAnalytics['restaurants']>;
  cityNames: Map<string, string>;
  showMoney: boolean;
}) {
  const navigate = useNavigate();
  const sorts = SORTS.filter((s) => showMoney || !s.money);
  const [sort, setSort] = useState<SortKey>(sorts[0]!.value);
  const [side, setSide] = useState<'top' | 'flop'>('top');
  const def = sorts.find((s) => s.value === sort) ?? sorts[0]!;

  const ranked = useMemo(() => {
    // Commerces sans activité exclus des classements de qualité (note, délais, annulations).
    const eligible = data.rows.filter((r) =>
      sort === 'rating' ? r.ratingCount > 0 : sort === 'averagePrepMinutes' ? r.averagePrepMinutes > 0 : sort === 'cancellationRate' ? r.orders > 0 : true,
    );
    const sorted = [...eligible].sort((a, b) => (def.higherIsBetter ? b[sort] - a[sort] : a[sort] - b[sort]));
    return side === 'top' ? sorted.slice(0, 10) : sorted.reverse().slice(0, 10);
  }, [data.rows, sort, side, def.higherIsBetter]);

  const format = (v: number) =>
    sort === 'salesCents'
      ? euros(v)
      : sort === 'rating'
        ? `${formatNumber(v, { decimals: true })} / 5`
        : sort === 'cancellationRate'
          ? `${formatNumber(Math.round(v * 1000) / 10, { decimals: true })} %`
          : sort === 'averagePrepMinutes'
            ? `${formatNumber(v)} min`
            : formatNumber(v);
  const chart = ranked.map((r) => ({
    name: r.name.length > 16 ? `${r.name.slice(0, 15)}…` : r.name,
    value: r[sort],
  }));

  const columns = useMemo(
    () => [
      col.accessor('name', {
        header: 'Commerce',
        cell: (info) => (
          <span className="block min-w-40">
            <span className="block font-medium text-fg">{info.getValue()}</span>
            <span className="flex flex-wrap items-center gap-x-1.5 text-2xs text-fg-subtle">
              {cityNames.get(info.row.original.cityId) ?? info.row.original.cityId} ·{' '}
              {PILOTAGE_PLAN_NAMES[info.row.original.planCode] ?? info.row.original.planCode}
              {info.row.original.status !== 'active' && <StatusBadge status={info.row.original.status} map={RESTAURANT_STATUS_META} className="text-2xs" />}
            </span>
          </span>
        ),
      }),
      col.accessor('orders', {
        header: 'Commandes',
        meta: { align: 'right' },
        cell: (info) => <Num>{formatNumber(info.getValue())}</Num>,
      }),
      ...(showMoney
        ? [
            col.accessor('salesCents', {
              header: 'CA',
              meta: { align: 'right' },
              cell: (info) => <Num>{euros(info.getValue())}</Num>,
            }),
            col.accessor('commissionCents', {
              header: 'Commission',
              meta: { align: 'right' },
              cell: (info) => <Num muted>{euros(info.getValue())}</Num>,
            }),
            col.accessor('averageBasketCents', {
              header: 'Panier',
              meta: { align: 'right' },
              cell: (info) => <Num muted>{info.getValue() ? euros(info.getValue()) : '—'}</Num>,
            }),
          ]
        : []),
      col.accessor('cancellationRate', {
        header: 'Annulation',
        meta: { align: 'right' },
        cell: (info) => <RateCell value={info.getValue()} warn={0.04} danger={0.06} has={info.row.original.orders > 0} />,
      }),
      col.accessor('rejectionRate', {
        header: 'Refus',
        meta: { align: 'right' },
        cell: (info) => <RateCell value={info.getValue()} warn={0.05} danger={0.08} has={info.row.original.orders > 0} />,
      }),
      col.accessor('averagePrepMinutes', {
        header: 'Préparation',
        meta: { align: 'right' },
        cell: (info) => <Num muted>{minutes(info.getValue())}</Num>,
      }),
      col.accessor('rating', {
        header: 'Note',
        meta: { align: 'right' },
        cell: (info) =>
          info.row.original.ratingCount ? (
            <span className="inline-flex items-center gap-1 whitespace-nowrap">
              <Star className="size-3 fill-current text-warning" />
              <Num>{formatNumber(info.getValue(), { decimals: true })}</Num>
              <span className="text-2xs text-fg-subtle">({info.row.original.ratingCount})</span>
            </span>
          ) : (
            <span className="text-fg-subtle">—</span>
          ),
      }),
      col.accessor((r) => r.salesTrend ?? -99, {
        id: 'trend',
        header: 'Évolution',
        meta: { align: 'right' },
        cell: (info) => <TrendBadge value={info.row.original.salesTrend} />,
      }),
    ],
    [cityNames, showMoney],
  );

  return (
    <div className="space-y-6">
      <div className="grid gap-6 xl:grid-cols-5">
        <ChartCard
          className="xl:col-span-3"
          title={side === 'top' ? 'Meilleurs commerces' : 'Commerces en retrait'}
          description={`Classés par ${def.label.toLowerCase()} sur la période.`}
          actions={
            <div className="flex flex-wrap gap-2">
              <SegmentedControl
                size="sm"
                aria-label="Sens du classement"
                value={side}
                onValueChange={(v) => setSide(v as 'top' | 'flop')}
                options={[
                  { value: 'top', label: 'Top 10' },
                  { value: 'flop', label: 'Flop 10' },
                ]}
              />
              <Select size="sm" aria-label="Critère" value={sort} onValueChange={(v) => setSort(v as SortKey)} options={sorts} className="w-48" />
            </div>
          }
        >
          {chart.length === 0 ? (
            <EmptyState compact icon={<Store />} title="Aucun commerce à classer" description="Aucune activité sur la période et le périmètre choisis." />
          ) : (
            <BarChart
              data={chart}
              xKey="name"
              horizontal
              series={[
                {
                  key: 'value',
                  label: def.label,
                  color: side === 'top' ? 'var(--gl-chart-4)' : 'var(--gl-chart-1)',
                },
              ]}
              height={Math.max(220, chart.length * 34 + 40)}
              valueFormatter={format}
              axisFormatter={(v) =>
                sort === 'salesCents' ? eurosCompact(v) : sort === 'cancellationRate' ? `${Math.round(v * 100)} %` : formatNumber(v, { compact: true })
              }
            />
          )}
        </ChartCard>

        <Card className="flex min-w-0 flex-col xl:col-span-2">
          <CardHeader title="Risque de départ" description="Ventes en baisse d’au moins 30 % ou arrêt des commandes." icon={<TrendingDown />} divided />
          {data.atRisk.length === 0 ? (
            <EmptyState
              compact
              className="flex-1 py-10"
              icon={<Store />}
              title="Aucun commerce en décrochage"
              description="Tous les commerces actifs maintiennent leur activité."
            />
          ) : (
            <ul className="max-h-[420px] divide-y divide-border overflow-y-auto">
              {data.atRisk.map((r) => (
                <li key={r.restaurantId}>
                  <Link
                    to={`/restaurants/${r.restaurantId}`}
                    className="flex items-center gap-3 px-5 py-3 hover:bg-surface-2 focus-visible:bg-surface-2 focus-visible:outline-none"
                  >
                    <span className="tone-amber grid size-8 shrink-0 place-items-center rounded-lg bg-(--tone-bg) text-(--tone-fg)">
                      <AlertTriangle className="size-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-fg">{r.name}</span>
                      <span className="block truncate text-xs text-fg-subtle">
                        {cityNames.get(r.cityId) ?? r.cityId} · {formatNumber(r.orders)} commande
                        {r.orders > 1 ? 's' : ''}
                        {showMoney ? ` · ${eurosCompact(r.salesCents)} vs ${eurosCompact(r.previousSalesCents)}` : ''}
                      </span>
                    </span>
                    {r.salesTrend !== null ? <TrendBadge value={r.salesTrend} /> : <Badge tone="danger">Arrêt</Badge>}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Section title="Tous les commerces" description="Performance détaillée sur la période, comparée à la période précédente.">
        <DataTable
          data={data.rows}
          columns={columns}
          getRowId={(r) => r.restaurantId}
          searchPlaceholder="Rechercher un commerce…"
          itemLabel="commerces"
          initialSorting={[{ id: showMoney ? 'salesCents' : 'orders', desc: true }]}
          onRowClick={(r) => void navigate(`/restaurants/${r.restaurantId}`)}
          filters={[
            {
              id: 'plan',
              label: 'Formule',
              options: (['basic', 'pro', 'premium'] as const).map((p) => ({
                value: p,
                label: PILOTAGE_PLAN_NAMES[p],
              })),
              getValue: (r) => r.planCode,
            },
            {
              id: 'city',
              label: 'Ville',
              options: [...new Set(data.rows.map((r) => r.cityId))].map((id) => ({ value: id, label: cityNames.get(id) ?? id })),
              getValue: (r) => r.cityId,
            },
          ]}
          emptyState={<EmptyState compact icon={<Store />} title="Aucun commerce" description="Aucun commerce dans ce périmètre." />}
        />
      </Section>
    </div>
  );
}
