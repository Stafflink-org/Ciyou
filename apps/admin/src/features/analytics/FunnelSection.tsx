import { useMemo } from 'react';
import { ArrowDown, Filter, Info } from 'lucide-react';
import { AreaChart, Card, CardHeader, ChartLegend, EmptyState, cn, formatNumber, formatPercent } from '@golink/ui';
import type { FunnelAnalytics } from '@golink/shared';
import { ChartCard } from '../pilotage-commun/components';
import { dayTick } from '../pilotage-commun/period';
import { bucketSeries } from './shared';

const DAILY = [
  { key: 'appOpens', label: 'Ouvertures', color: 'var(--gl-chart-2)' },
  { key: 'addToCart', label: 'Ajouts au panier', color: 'var(--gl-chart-3)' },
  { key: 'paid', label: 'Paiements', color: 'var(--gl-chart-1)' },
];

/** Tunnel de commande : ouverture de l'app → paiement, et où les clients abandonnent (cahier §3). */
export function FunnelSection({ data }: { data: FunnelAnalytics }) {
  const daily = useMemo(
    () =>
      bucketSeries(data.daily, ['appOpens', 'addToCart', 'paid']).map((p) => ({
        ...p,
        label: dayTick(String(p.day)),
      })),
    [data.daily],
  );
  if (data.source === 'none') {
    return (
      <Card>
        <EmptyState
          icon={<Filter />}
          title="Pas encore de mesure du tunnel"
          description="Les étapes (ouverture de l’application, fiche commerce, panier, paiement) sont remontées par l’application client. Elles apparaîtront ici dès les premières sessions mesurées sur la période."
        />
      </Card>
    );
  }
  // Sans application cliente ('estimated') : seules les deux dernières étapes sont réelles.
  const visibleSteps = data.source === 'estimated' ? data.steps.slice(3) : data.steps;
  const first = visibleSteps[0]?.value ?? 0;
  const worst = visibleSteps
    .slice(1)
    .map((step, i) => ({
      step,
      prev: visibleSteps[i]!,
      drop: visibleSteps[i]!.value ? 1 - step.value / visibleSteps[i]!.value : 0,
    }))
    .sort((a, b) => b.drop - a.drop)[0];

  return (
    <div className="space-y-6">
      <div className="grid gap-6 xl:grid-cols-5">
        <Card className="min-w-0 xl:col-span-3">
          <CardHeader
            title="Tunnel de commande"
            description={
              data.source === 'estimated'
                ? `${formatPercent(data.conversionRate)} des paiements commencés aboutissent.`
                : `${formatPercent(data.conversionRate)} des ouvertures de l’application aboutissent à un paiement.`
            }
            icon={<Filter />}
            divided
          />
          <ol className="space-y-1 p-5">
            {visibleSteps.map((step, index) => {
              const previous = index > 0 ? visibleSteps[index - 1]!.value : null;
              const ratio = first ? step.value / first : 0;
              const conversion = previous ? step.value / previous : null;
              const isWorst = worst?.step.key === step.key;
              return (
                <li key={step.key}>
                  {conversion !== null && (
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 py-1.5 pl-3 text-xs text-fg-subtle">
                      <ArrowDown className="size-3.5" />
                      <span className={cn('font-mono num', isWorst && 'font-medium text-danger')}>{formatPercent(conversion)}</span>
                      passent à l’étape suivante
                      {isWorst && (
                        <span className="tone-danger rounded-md bg-(--tone-bg) px-1.5 py-0.5 text-2xs font-medium text-(--tone-fg)">Plus forte perte</span>
                      )}
                    </div>
                  )}
                  <div className="relative overflow-hidden rounded-lg border border-border bg-surface-2">
                    <div className="absolute inset-y-0 left-0 bg-primary/15" style={{ width: `${Math.max(ratio * 100, 1.5)}%` }} aria-hidden />
                    <div className="relative flex items-center justify-between gap-3 px-4 py-3">
                      <span className="min-w-0 truncate text-sm font-medium text-fg">{step.label}</span>
                      <span className="flex max-w-[70%] shrink-0 flex-wrap items-baseline justify-end gap-x-2">
                        <span className="num font-display text-lg font-semibold text-fg">{formatNumber(step.value)}</span>
                        <span className="num w-14 text-right font-mono text-2xs text-fg-subtle">{formatPercent(ratio)}</span>
                      </span>
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
        </Card>
        <Card className="min-w-0 xl:col-span-2">
          <CardHeader title="Lecture" icon={<Info />} divided />
          <div className="space-y-4 p-5 text-sm text-fg-muted">
            {worst && (
              <p>
                La plus forte perte se situe entre <strong className="text-fg">{worst.prev.label.toLowerCase()}</strong> et{' '}
                <strong className="text-fg">{worst.step.label.toLowerCase()}</strong> : {formatPercent(worst.drop)} des clients abandonnent à cette étape.
              </p>
            )}
            <p>
              Taux de conversion global : <strong className="num text-fg">{formatPercent(data.conversionRate)}</strong> (
              {formatNumber(visibleSteps.at(-1)?.value ?? 0)} paiements pour {formatNumber(first)} {data.source === 'estimated' ? 'paiements commencés' : 'ouvertures'}).
            </p>
            <p className="text-xs text-fg-subtle">
              {data.source === 'analytics'
                ? 'Mesures remontées par l’application client, agrégées chaque jour.'
                : 'Valeurs dérivées directement des commandes : l’application cliente n’est pas encore déployée, les étapes de découverte (ouverture, fiche commerce, panier) ne sont donc pas mesurées.'}
            </p>
          </div>
        </Card>
      </div>
      <ChartCard
        title="Au jour le jour"
        description="Ouvertures, ajouts au panier et paiements."
        actions={<ChartLegend series={DAILY} className="hidden md:flex" />}
      >
        <AreaChart data={daily} xKey="label" series={DAILY} height={260} />
        <ChartLegend series={DAILY} className="mt-3 md:hidden" />
      </ChartCard>
    </div>
  );
}
