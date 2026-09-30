import { useMemo } from 'react';
import { Bike, CreditCard, Repeat, Store, UserPlus, Users } from 'lucide-react';
import { AreaChart, BarChart, Card, CardHeader, ChartLegend, EmptyState, StatCard, Tooltip, formatNumber, formatPercent, Table } from '@golink/ui';
import type { GrowthAnalytics } from '@golink/shared';
import { ChartCard } from '../pilotage-commun/components';
import { dayTick, monthTick, trend, type Period } from '../pilotage-commun/period';
import { bucketSeries, euros, eurosCompact } from './shared';

const NEW_SERIES = [
  { key: 'customersNew', label: 'Clients', color: 'var(--gl-chart-1)' },
  { key: 'restaurantsNew', label: 'Commerces', color: 'var(--gl-chart-2)' },
  { key: 'driversNew', label: 'Livreurs', color: 'var(--gl-chart-5)' },
];

/** Croissance et rétention (cahier §3). */
export function GrowthSection({ data, period, showMoney }: { data: GrowthAnalytics; period: Period; showMoney: boolean }) {
  const t = data.totals;
  const newActors = useMemo(
    () => bucketSeries(data.daily, ['customersNew', 'restaurantsNew', 'driversNew']).map((p) => ({ ...p, label: dayTick(String(p.day)) })),
    [data.daily],
  );
  const activity = useMemo(
    () =>
      bucketSeries(data.daily, ['ordersPlaced', 'gmvCents']).map((p) => ({
        ...p,
        label: dayTick(String(p.day)),
      })),
    [data.daily],
  );
  const maxRetention = Math.max(0.0001, ...data.cohorts.flatMap((c) => c.retention.slice(1)));

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-6 [&>*:nth-child(-n+3)]:xl:col-span-2 [&>*:nth-child(n+4)]:xl:col-span-3">
        <StatCard
          label="Nouveaux clients"
          value={formatNumber(t.customersNew)}
          icon={<UserPlus />}
          tone="brand"
          delta={trend(t.customersNew, t.previousCustomersNew)}
          deltaLabel={period.compareLabel}
        />
        <StatCard
          label="Nouveaux commerces"
          value={formatNumber(t.restaurantsNew)}
          icon={<Store />}
          tone="teal"
          delta={trend(t.restaurantsNew, t.previousRestaurantsNew)}
          deltaLabel={period.compareLabel}
        />
        <StatCard
          label="Nouveaux livreurs"
          value={formatNumber(t.driversNew)}
          icon={<Bike />}
          tone="plum"
          delta={trend(t.driversNew, t.previousDriversNew)}
          deltaLabel={period.compareLabel}
        />
        <StatCard
          label="Clients qui recommandent"
          value={formatPercent(data.repeatRate)}
          icon={<Repeat />}
          tone="success"
          footer="Au moins 2 commandes livrées sur la période."
        />
        <StatCard
          label="Commerces qui recommandent"
          value={formatPercent(data.restaurantRetention)}
          icon={<Users />}
          tone="info"
          footer="Ont passé au moins une commande au début et à la fin de la période."
        />
        <StatCard
          label="Rétention des abonnements"
          value={formatPercent(data.subscriptionRetention)}
          icon={<CreditCard />}
          tone="amber"
          footer="Commerces abonnés en début de période toujours abonnés (non résiliés) à la fin."
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <ChartCard
          title="Nouveaux inscrits"
          description={newActors.length < data.daily.length ? 'Par semaine.' : 'Par jour.'}
          actions={<ChartLegend series={NEW_SERIES} className="hidden sm:flex" />}
        >
          <BarChart data={newActors} xKey="label" series={NEW_SERIES} stacked height={260} />
          <ChartLegend series={NEW_SERIES} className="mt-3 sm:hidden" />
        </ChartCard>
        <ChartCard title="Activité" description={showMoney ? 'Commandes passées et volume d’affaires TTC.' : 'Commandes passées.'}>
          {showMoney ? (
            <AreaChart
              data={activity}
              xKey="label"
              series={[
                {
                  key: 'gmvCents',
                  label: 'Volume d’affaires',
                  color: 'var(--gl-chart-1)',
                },
              ]}
              height={260}
              valueFormatter={euros}
              axisFormatter={eurosCompact}
            />
          ) : (
            <AreaChart
              data={activity}
              xKey="label"
              series={[
                {
                  key: 'ordersPlaced',
                  label: 'Commandes',
                  color: 'var(--gl-chart-1)',
                },
              ]}
              height={260}
            />
          )}
        </ChartCard>
      </div>

      <Card>
        <CardHeader
          title="Rétention des clients par cohorte"
          description="Part des clients d’un mois de première commande qui recommandent les mois suivants."
          divided
        />
        {data.cohorts.length === 0 ? (
          <EmptyState compact icon={<Repeat />} title="Pas encore de cohorte" description="Les cohortes apparaissent dès les premières commandes livrées." />
        ) : (
          <div className="overflow-x-auto">
            <Table className="w-full min-w-[560px] table-fixed text-sm">
              <colgroup>
                <col className="w-32" />
                <col className="w-24" />
                {Array.from({ length: 6 }, (_, i) => (
                  <col key={i} />
                ))}
              </colgroup>
              <thead>
                <tr className="border-b border-border bg-surface-2 text-left">
                  <th className="px-5 py-2.5 font-mono text-3xs font-medium uppercase tracking-wider text-fg-subtle">Cohorte</th>
                  <th className="px-3 py-2.5 text-right font-mono text-3xs font-medium uppercase tracking-wider text-fg-subtle">Clients</th>
                  {Array.from({ length: 6 }, (_, i) => (
                    <th key={i} className="px-2 py-2.5 text-center font-mono text-3xs font-medium uppercase tracking-wider text-fg-subtle">
                      {i === 0 ? 'M0' : `M+${i}`}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.cohorts.map((cohort) => (
                  <tr key={cohort.cohort} className="border-b border-border last:border-0">
                    <td className="px-5 py-2 font-medium capitalize text-fg">{monthTick(cohort.cohort)}</td>
                    <td className="num px-3 py-2 text-right font-mono text-xs text-fg-muted">{formatNumber(cohort.size)}</td>
                    {Array.from({ length: 6 }, (_, i) => {
                      const value = cohort.retention[i];
                      if (value === undefined) return <td key={i} className="px-2 py-2" />;
                      const intensity = i === 0 ? 0.55 : Math.min(1, value / maxRetention);
                      return (
                        <td key={i} className="px-1 py-1">
                          <Tooltip
                            content={`${formatPercent(value)} des ${formatNumber(cohort.size)} clients de ${monthTick(cohort.cohort)} ont recommandé ${i === 0 ? 'le premier mois' : `au mois M+${i}`}.`}
                          >
                            <div
                              className="num grid h-8 place-items-center rounded-md font-mono text-2xs text-fg"
                              style={{
                                backgroundColor: `color-mix(in oklab, var(--gl-chart-1) ${Math.round(intensity * 60) + 6}%, transparent)`,
                              }}
                            >
                              {formatPercent(value)}
                            </div>
                          </Tooltip>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
        )}
      </Card>
    </div>
  );
}
