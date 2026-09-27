import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { Bike, Gauge, MapPin, ShoppingBag, Timer } from 'lucide-react';
import { Badge, BarChart, Card, CardHeader, ChartLegend, EmptyState, SegmentedControl, cn, formatNumber, formatPercent, type Tone, Table } from '@golink/ui';
import type { CityAnalyticsRow, PilotageAnalytics } from '@golink/shared';
import { Num, RateCell, euros, eurosCompact, minutes } from './shared';

const HOUR_SERIES = [
  { key: 'orders', label: 'Commandes par jour (moyenne)', color: 'var(--gl-chart-1)' },
  {
    key: 'drivers',
    label: 'Livreurs en ligne (pic)',
    color: 'var(--gl-chart-2)',
  },
];

function tension(value: number | null, threshold: number): { label: string; tone: Tone } {
  if (value === null) return { label: 'Offre inconnue', tone: 'neutral' };
  if (value > threshold) return { label: 'Tension forte', tone: 'danger' };
  if (value > threshold - 1) return { label: 'Sous tension', tone: 'amber' };
  return { label: 'Équilibré', tone: 'success' };
}

function peakHours(byHour: number[]): string {
  const ranked = byHour
    .map((v, h) => ({ v, h }))
    .filter((x) => x.v > 0)
    .sort((a, b) => b.v - a.v)
    .slice(0, 2);
  if (!ranked.length) return '—';
  return ranked
    .sort((a, b) => a.h - b.h)
    .map((x) => `${String(x.h).padStart(2, '0')} h`)
    .join(' · ');
}

/** Villes et zones : activité, heures de pointe, offre / demande de livreurs (cahier §3). */
export function CitiesSection({
  data,
  showMoney,
  driverRatio,
  tensionRatio,
  days,
}: {
  data: NonNullable<PilotageAnalytics['cities']>;
  showMoney: boolean;
  driverRatio: number;
  tensionRatio: number;
  days: number;
}) {
  const rows = useMemo(() => [...data.rows].sort((a, b) => b.orders - a.orders), [data.rows]);
  const [selected, setSelected] = useState<string | null>(null);
  const city = rows.find((r) => r.cityId === selected) ?? rows[0] ?? null;

  if (!rows.length) {
    return (
      <Card>
        <EmptyState icon={<MapPin />} title="Aucune ville dans le périmètre" description="Ouvrez une ville ou élargissez le filtre géographique." />
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader title="Comparatif des villes" description="Activité et qualité de service sur la période." divided />
        <div className="overflow-x-auto">
          <Table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="border-b border-border bg-surface-2 text-left font-mono text-3xs uppercase tracking-wider text-fg-subtle">
                <th className="px-5 py-2.5 font-medium">Ville</th>
                <th className="px-3 py-2.5 text-right font-medium">Commandes</th>
                {showMoney && <th className="px-3 py-2.5 text-right font-medium">Volume TTC</th>}
                {showMoney && <th className="px-3 py-2.5 text-right font-medium">Panier</th>}
                <th className="px-3 py-2.5 text-right font-medium">Livraison</th>
                <th className="px-3 py-2.5 text-right font-medium">À l’heure</th>
                <th className="px-3 py-2.5 text-right font-medium">Annulation</th>
                <th className="px-5 py-2.5 text-right font-medium">Offre / demande</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const t = tension(r.demandPerDriver, tensionRatio);
                const active = city?.cityId === r.cityId;
                return (
                  <tr
                    key={r.cityId}
                    onClick={() => setSelected(r.cityId)}
                    className={cn('cursor-pointer border-b border-border transition-colors last:border-0 hover:bg-surface-2', active && 'bg-surface-2')}
                  >
                    <td className="px-5 py-2.5">
                      <button
                        type="button"
                        onClick={() => setSelected(r.cityId)}
                        className="flex items-center gap-2 text-left font-medium text-fg focus-visible:underline focus-visible:outline-none"
                      >
                        <span className={cn('size-1.5 rounded-full', active ? 'bg-primary' : 'bg-border-strong')} />
                        {r.name}
                      </button>
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <Num>{formatNumber(r.orders)}</Num>
                    </td>
                    {showMoney && (
                      <td className="px-3 py-2.5 text-right">
                        <Num>{euros(r.gmvCents)}</Num>
                      </td>
                    )}
                    {showMoney && (
                      <td className="px-3 py-2.5 text-right">
                        <Num muted>{r.averageBasketCents ? euros(r.averageBasketCents) : '—'}</Num>
                      </td>
                    )}
                    <td className="px-3 py-2.5 text-right">
                      <Num muted>{minutes(r.averageDeliveryMinutes)}</Num>
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <Num>{r.delivered ? formatPercent(r.onTimeRate) : '—'}</Num>
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <RateCell value={r.cancellationRate} warn={0.05} danger={0.08} has={r.orders > 0} />
                    </td>
                    <td className="px-5 py-2.5 text-right">
                      <Badge size="sm" tone={t.tone}>
                        {t.label}
                      </Badge>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        </div>
      </Card>

      {city && <CityDetail city={city} showMoney={showMoney} driverRatio={driverRatio} tensionRatio={tensionRatio} days={days} />}
    </div>
  );
}

function CityDetail({
  city,
  showMoney,
  driverRatio,
  tensionRatio,
  days,
}: {
  city: CityAnalyticsRow;
  showMoney: boolean;
  driverRatio: number;
  tensionRatio: number;
  days: number;
}) {
  const [view, setView] = useState<'hours' | 'zones'>('hours');
  const hours = city.byHour.map((orders, hour) => ({
    label: `${String(hour).padStart(2, '0')} h`,
    // Moyenne quotidienne : comparable au nombre de livreurs en ligne à la même heure.
    orders: Math.round((orders / Math.max(1, days)) * 10) / 10,
    drivers: city.driversOnlineByHour[hour] ?? 0,
  }));
  const firstActive = hours.findIndex((h) => h.orders > 0 || h.drivers > 0);
  const lastActive = hours.length - 1 - [...hours].reverse().findIndex((h) => h.orders > 0 || h.drivers > 0);
  const trimmed = firstActive >= 0 ? hours.slice(Math.max(0, firstActive - 1), Math.min(hours.length, lastActive + 2)) : hours;
  const t = tension(city.demandPerDriver, tensionRatio);
  const figures = [
    {
      label: 'Commandes',
      value: formatNumber(city.orders),
      icon: <ShoppingBag />,
    },
    ...(showMoney
      ? [
          {
            label: 'Commission HT',
            value: eurosCompact(city.commissionHtCents),
            icon: <Gauge />,
          },
        ]
      : []),
    {
      label: 'Heures de pointe',
      value: peakHours(city.byHour),
      icon: <Timer />,
    },
    {
      label: 'Livreurs en ligne',
      value: `${formatNumber(city.driversOnlineNow)} / ${formatNumber(city.driversRegistered)}`,
      icon: <Bike />,
    },
  ];

  return (
    <Card>
      <CardHeader
        title={city.name}
        description="Heures de pointe et rapport entre commandes et livreurs disponibles."
        icon={<MapPin />}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={t.tone}>
              {t.label}
              {city.demandPerDriver !== null ? ` · ${formatNumber(city.demandPerDriver, { decimals: true })} cmd / livreur` : ''}
            </Badge>
            <SegmentedControl
              size="sm"
              aria-label="Vue"
              value={view}
              onValueChange={(v) => setView(v as 'hours' | 'zones')}
              options={[
                { value: 'hours', label: 'Heures' },
                { value: 'zones', label: 'Zones', count: city.zones.length },
              ]}
            />
          </div>
        }
        divided
      />
      <dl className="grid grid-cols-2 border-b border-border lg:grid-cols-4">
        {figures.map((f, i) => (
          <div
            key={f.label}
            className={cn(
              'flex items-center gap-3 px-5 py-3',
              i % 2 === 1 && 'border-l border-border',
              i >= 2 && 'border-t border-border lg:border-t-0',
              i >= 1 && 'lg:border-l',
            )}
          >
            <span className="grid size-8 shrink-0 place-items-center rounded-lg border border-border bg-surface-2 text-fg-muted [&_svg]:size-4">{f.icon}</span>
            <div className="min-w-0">
              <dt className="truncate text-xs text-fg-muted">{f.label}</dt>
              <dd className="num truncate font-display text-base font-semibold text-fg">{f.value}</dd>
            </div>
          </div>
        ))}
      </dl>
      {view === 'hours' ? (
        <div className="p-5">
          <ChartLegend series={HOUR_SERIES} className="mb-3" />
          <BarChart data={trimmed} xKey="label" series={HOUR_SERIES} height={260} valueFormatter={(v) => formatNumber(v, { decimals: true })} />
          <p className="mt-3 text-xs text-fg-subtle">
            Commandes moyennes par jour à chaque heure de la période ; livreurs : maximum relevé en ligne à cette heure. Au-delà de 3 commandes par livreur au pic, la ville
            est en tension.
          </p>
        </div>
      ) : city.zones.length === 0 ? (
        <EmptyState compact icon={<MapPin />} title="Aucune zone de service" description="Les zones de cette ville n’ont pas encore été tracées." />
      ) : (
        <div className="overflow-x-auto">
          <Table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-surface-2 text-left font-mono text-3xs uppercase tracking-wider text-fg-subtle">
                <th className="px-5 py-2.5 font-medium">Zone</th>
                <th className="px-3 py-2.5 text-right font-medium">Livreurs dispo.</th>
                <th className="px-3 py-2.5 text-right font-medium">En attente</th>
                <th className="px-5 py-2.5 text-right font-medium">État</th>
              </tr>
            </thead>
            <tbody>
              {city.zones.map((z) => {
                const short = z.pendingOrders > 0 && z.driversAvailable / z.pendingOrders < driverRatio;
                return (
                  <tr key={z.zoneId} className="border-b border-border last:border-0">
                    <td className="px-5 py-2.5">
                      <Link to={`/zones/${z.zoneId}`} className="font-medium text-fg hover:underline">
                        {z.name}
                      </Link>
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <Num>{formatNumber(z.driversAvailable)}</Num>
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <Num muted={!z.pendingOrders}>{formatNumber(z.pendingOrders)}</Num>
                    </td>
                    <td className="px-5 py-2.5 text-right">
                      <Badge size="sm" tone={!z.active ? 'neutral' : short ? 'danger' : 'success'}>
                        {!z.active ? 'Inactive' : short ? 'Manque de livreurs' : 'Couverte'}
                      </Badge>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        </div>
      )}
    </Card>
  );
}
