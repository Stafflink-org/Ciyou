import { ArrowDownRight, ArrowUpRight, CreditCard, Landmark, LogOut, Sparkles, TrendingDown } from 'lucide-react';
import { AreaChart, Badge, BarChart, Card, CardHeader, ChartLegend, DonutChart, EmptyState, StatCard, formatNumber, formatPercent, formatRelative, Table } from '@golink/ui';
import type { SubscriptionAnalytics } from '@golink/shared';
import { ChartCard, PILOTAGE_PLAN_NAMES } from '../pilotage-commun/components';
import { monthTick } from '../pilotage-commun/period';
import { Num, euros, eurosCompact } from './shared';

const EVENT_LABELS: Record<
  string,
  {
    label: string;
    tone: 'success' | 'danger' | 'amber' | 'info' | 'neutral' | 'plum';
  }
> = {
  created: { label: 'Souscription', tone: 'info' },
  activated: { label: 'Activation', tone: 'success' },
  trial_started: { label: 'Essai', tone: 'plum' },
  upgraded: { label: 'Formule supérieure', tone: 'success' },
  downgraded: { label: 'Formule inférieure', tone: 'amber' },
  cancelled: { label: 'Résiliation', tone: 'danger' },
  reactivated: { label: 'Réactivation', tone: 'success' },
  past_due: { label: 'Impayé', tone: 'danger' },
  paused: { label: 'Suspension', tone: 'amber' },
};

const MOVES = [
  { key: 'newCount', label: 'Nouveaux', color: 'var(--gl-chart-4)' },
  { key: 'upgrades', label: 'Montées', color: 'var(--gl-chart-2)' },
  { key: 'downgrades', label: 'Descentes', color: 'var(--gl-chart-3)' },
  { key: 'cancelledCount', label: 'Résiliations', color: 'var(--gl-chart-1)' },
];

/** Abonnements : répartition, revenu mensuel récurrent, résiliations, montées en gamme (cahier §3). */
export function SubscriptionsSection({ data, showMoney }: { data: SubscriptionAnalytics; showMoney: boolean }) {
  const monthly = data.monthly.map((m) => ({
    ...m,
    label: monthTick(m.month),
  }));
  const activeTotal = data.byPlan.reduce((s, p) => s + p.active + p.trialing + p.pastDue, 0);

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {showMoney ? (
          <StatCard
            label="Revenu mensuel récurrent"
            value={euros(data.mrrCents)}
            icon={<Landmark />}
            tone="brand"
            footer={`Soit ${euros(data.arrCents)} par an (ARR).`}
          />
        ) : (
          <StatCard label="Abonnements en cours" value={formatNumber(activeTotal)} icon={<Landmark />} tone="brand" footer="Actifs, en essai ou impayés." />
        )}
        <StatCard
          label="Taux de résiliation"
          value={formatPercent(data.churnRate)}
          icon={<TrendingDown />}
          tone="danger"
          footer={`${formatNumber(data.cancellations)} résiliation${data.cancellations > 1 ? 's' : ''} sur la période.`}
        />
        <StatCard
          label="Nouveaux abonnements"
          value={formatNumber(data.newSubscriptions)}
          icon={<Sparkles />}
          tone="success"
          footer="Souscrits sur la période."
        />
        <StatCard
          label="Montées en gamme"
          value={formatNumber(data.upgrades)}
          icon={<ArrowUpRight />}
          tone="info"
          footer={
            <span className="inline-flex items-center gap-1">
              <ArrowDownRight className="size-3.5 text-warning" /> {formatNumber(data.downgrades)} passage
              {data.downgrades > 1 ? 's' : ''} à une formule inférieure
            </span>
          }
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-5">
        <Card className="min-w-0 xl:col-span-2 xl:self-start">
          <CardHeader title="Répartition par formule" description="Abonnements en cours (actifs, essai, impayés)." divided />
          <div className="p-5">
            {activeTotal === 0 ? (
              <EmptyState
                compact
                icon={<CreditCard />}
                title="Aucun abonnement en cours"
                description="Les formules sont à 0 € tant qu’aucune n’est paramétrée."
              />
            ) : (
              <DonutChart
                data={data.byPlan.map((p) => ({
                  label: p.name || PILOTAGE_PLAN_NAMES[p.planCode],
                  value: p.active + p.trialing + p.pastDue,
                }))}
                centerValue={formatNumber(activeTotal)}
                centerLabel="en cours"
              />
            )}
          </div>
          <div className="overflow-x-auto border-t border-border">
            <Table className="w-full text-sm">
              <thead>
                <tr className="bg-surface-2 text-left font-mono text-3xs uppercase tracking-wider text-fg-subtle">
                  <th className="px-5 py-2 font-medium">Formule</th>
                  <th className="px-2 py-2 text-right font-medium">Actifs</th>
                  <th className="px-2 py-2 text-right font-medium">Essai</th>
                  <th className="px-2 py-2 text-right font-medium">Impayés</th>
                  {showMoney && <th className="px-5 py-2 text-right font-medium">MRR</th>}
                </tr>
              </thead>
              <tbody>
                {data.byPlan.map((p) => (
                  <tr key={p.planCode} className="border-t border-border">
                    <td className="px-5 py-2 font-medium text-fg">{p.name || PILOTAGE_PLAN_NAMES[p.planCode]}</td>
                    <td className="px-2 py-2 text-right">
                      <Num>{formatNumber(p.active)}</Num>
                    </td>
                    <td className="px-2 py-2 text-right">
                      <Num muted>{formatNumber(p.trialing)}</Num>
                    </td>
                    <td className="px-2 py-2 text-right">
                      {p.pastDue ? (
                        <Badge size="sm" tone="danger">
                          {formatNumber(p.pastDue)}
                        </Badge>
                      ) : (
                        <Num muted>0</Num>
                      )}
                    </td>
                    {showMoney && (
                      <td className="px-5 py-2 text-right">
                        <Num>{euros(p.mrrCents)}</Num>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
        </Card>

        <div className="min-w-0 space-y-6 xl:col-span-3">
          {showMoney && (
            <ChartCard title="Évolution du revenu récurrent" description="MRR en fin de mois, sur 12 mois.">
              <AreaChart
                data={monthly}
                xKey="label"
                series={[{ key: 'mrrCents', label: 'MRR', color: 'var(--gl-chart-1)' }]}
                height={220}
                valueFormatter={euros}
                axisFormatter={eurosCompact}
              />
            </ChartCard>
          )}
          <ChartCard
            title="Mouvements mensuels"
            description="Souscriptions, changements de formule et résiliations."
            actions={<ChartLegend series={MOVES} className="hidden md:flex" />}
          >
            <BarChart data={monthly} xKey="label" series={MOVES} height={220} />
            <ChartLegend series={MOVES} className="mt-3 md:hidden" />
          </ChartCard>
        </div>
      </div>

      <Card>
        <CardHeader title="Derniers changements" description="Souscriptions, changements de formule et résiliations récents." icon={<LogOut />} divided />
        {data.recentChanges.length === 0 ? (
          <EmptyState compact icon={<CreditCard />} title="Aucun changement récent" />
        ) : (
          <ul className="divide-y divide-border">
            {data.recentChanges.slice(0, 15).map((c) => {
              const meta = EVENT_LABELS[c.event] ?? {
                label: c.event,
                tone: 'neutral' as const,
              };
              return (
                <li key={`${c.subscriptionId}-${c.at}-${c.event}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-3">
                  <Badge tone={meta.tone}>{meta.label}</Badge>
                  <span className="min-w-0 flex-1 truncate text-sm font-medium text-fg">{c.subscriberName}</span>
                  <span className="text-xs text-fg-muted">Formule {PILOTAGE_PLAN_NAMES[c.planCode] ?? c.planCode}</span>
                  {c.reason && <span className="w-full truncate text-xs text-fg-subtle sm:w-auto">« {c.reason} »</span>}
                  <span className="font-mono text-2xs text-fg-subtle">{formatRelative(new Date(c.at))}</span>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
