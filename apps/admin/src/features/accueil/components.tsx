// Blocs du tableau de bord global (cahier §1).
import { useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import {
  Activity,
  ArrowRight,
  BadgeEuro,
  Bike,
  CalendarClock,
  ChevronRight,
  CircleCheck,
  CreditCard,
  Euro,
  FileWarning,
  Flag,
  Gauge,
  HandCoins,
  Inbox,
  Landmark,
  PiggyBank,
  Receipt,
  ShieldAlert,
  ShoppingBag,
  Store,
  Ticket,
  TrendingUp,
  PackageCheck,
  Users,
  UtensilsCrossed,
  XCircle,
} from 'lucide-react';
import {
  AreaChart,
  Badge,
  Button,
  Card,
  CardHeader,
  ChartLegend,
  EmptyState,
  SegmentedControl,
  Skeleton,
  Sparkline,
  StatCard,
  StatusPill,
  Timeline,
  cn,
  formatEUR,
  formatNumber,
  formatPercent,
  formatRelative,
  type Tone,
} from '@golink/ui';
import { labelOf, type PilotageActivity, type PilotageCounters, type PlatformAlert, type PlatformAlertView } from '@golink/shared';
import { useTranslation } from '@golink/web';
import { AlertItem, useAlerts } from '../pilotage-commun/alerts';
import { LoadError, Metric } from '../pilotage-commun/components';
import type { DayStats, PeriodKpis } from '../pilotage-commun/hooks';
import { alertHref, entityHref } from '../pilotage-commun/links';
import { dayTick, trend, type Period } from '../pilotage-commun/period';
import { evolutionSeries, metricValue, type EvolutionMetric } from './data';

type T = (key: string, vars?: Record<string, string | number | undefined>) => string;

const euros = (cents: number) => formatEUR(cents, { cents: true });
const eurosCompact = (cents: number) => formatEUR(cents, { cents: true, compact: true });

// ------------------------------------------------------------------ En direct

export function LiveStrip({
  loading,
  ordersToday,
  gmvToday,
  ordersYesterdaySameHour,
  ordersMonth,
  gmvMonth,
  openAlerts,
  criticalAlerts,
  showMoney,
}: {
  loading: boolean;
  ordersToday: number;
  gmvToday: number;
  ordersYesterdaySameHour: number;
  ordersMonth: number;
  gmvMonth: number;
  openAlerts: number;
  criticalAlerts: number;
  showMoney: boolean;
}) {
  const { t } = useTranslation('accueil');
  const delta = trend(ordersToday, ordersYesterdaySameHour);
  const items: Array<{ label: string; value: ReactNode; hint?: ReactNode }> = [
    {
      label: t('live.ordersToday'),
      value: formatNumber(ordersToday),
      hint:
        delta === undefined ? null : (
          <span className={cn('font-mono', delta > 0 ? 'text-success' : delta < 0 ? 'text-danger' : 'text-fg-subtle')}>
            {t('live.vsYesterday', { percent: `${delta > 0 ? '+' : ''}${formatPercent(delta)}` })}
          </span>
        ),
    },
    ...(showMoney ? [{ label: t('live.gmvToday'), value: euros(gmvToday) }] : []),
    {
      label: t('live.ordersMonth'),
      value: formatNumber(ordersMonth),
      hint: showMoney ? <span>{t('live.gross', { amount: eurosCompact(gmvMonth) })}</span> : null,
    },
    {
      label: t('live.openAlerts'),
      value: formatNumber(openAlerts),
      hint: criticalAlerts ? (
        <span className="text-danger">{t('live.critical', { count: criticalAlerts })}</span>
      ) : (
        <span>{t('live.noneCritical')}</span>
      ),
    },
  ];
  return (
    <Card className="mb-6 overflow-hidden">
      <div className="flex flex-col divide-y divide-border sm:flex-row sm:divide-x sm:divide-y-0">
        <div className="flex items-center gap-2 px-5 py-3 sm:w-36 sm:shrink-0 sm:flex-col sm:items-start sm:justify-center">
          <StatusPill tone="success" pulse>
            {t('live.badge')}
          </StatusPill>
          <span className="text-2xs text-fg-subtle">{t('live.updated')}</span>
        </div>
        <dl className="grid flex-1 grid-cols-2 lg:grid-cols-4">
          {items.map((item, index) => (
            <div
              key={item.label}
              className={cn(
                'min-w-0 px-5 py-3',
                index % 2 === 1 && 'border-s border-border',
                index >= 2 && 'border-t border-border lg:border-t-0',
                index >= 1 && 'lg:border-s',
              )}
            >
              <dt className="truncate text-xs text-fg-muted">{item.label}</dt>
              <dd className="mt-0.5">
                {loading ? (
                  <Skeleton className="h-6 w-20" />
                ) : (
                  <span className="num font-display text-xl font-semibold tracking-display text-fg">{item.value}</span>
                )}
                {item.hint && !loading && <span className="mt-0.5 block truncate text-2xs text-fg-subtle">{item.hint}</span>}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </Card>
  );
}

// ------------------------------------------------------------------ Chiffres clés

interface KpiDef {
  key: string;
  label: string;
  icon: ReactNode;
  tone: Tone;
  value: (k: PeriodKpis) => number;
  format: (value: number, t: T) => string;
  spark?: (d: DayStats) => number;
  invert?: boolean;
  footer?: (current: PeriodKpis, previous: PeriodKpis, t: T) => ReactNode;
  money?: boolean;
}

const KPIS: KpiDef[] = [
  {
    key: 'revenue',
    label: 'CA plateforme HT',
    icon: <BadgeEuro />,
    tone: 'brand',
    money: true,
    value: (k) => k.platformRevenueHtCents,
    format: euros,
    spark: (d) => d.commissionHtCents + d.feesHtCents + d.subscriptionsHtCents,
    footer: (k, _p, t) => (
      <span className="flex flex-wrap gap-x-3">
        <Metric label={t('kpi.margin')} value={eurosCompact(k.marginCents)} tone={k.marginCents < 0 ? 'danger' : undefined} />
        <Metric label={t('kpi.fees')} value={eurosCompact(k.feesHtCents)} />
      </span>
    ),
  },
  {
    key: 'gmv',
    label: 'Volume d’affaires TTC',
    icon: <Euro />,
    tone: 'teal',
    money: true,
    value: (k) => k.gmvCents,
    format: euros,
    spark: (d) => d.gmvCents,
    footer: (k, _p, t) => <Metric label={t('kpi.refunded')} value={eurosCompact(k.refundsCents)} tone={k.refundsCents ? 'warning' : undefined} />,
  },
  {
    key: 'sales',
    label: 'CA des commerces',
    icon: <Store />,
    tone: 'info',
    money: true,
    value: (k) => k.restaurantSalesCents,
    format: euros,
    spark: (d) => d.restaurantSalesCents,
    footer: (_k, _p, t) => t('kpi.salesFooter'),
  },
  {
    key: 'commission',
    label: 'Commissions Ciyou Eats HT',
    icon: <HandCoins />,
    tone: 'plum',
    money: true,
    value: (k) => k.commissionHtCents,
    format: euros,
    spark: (d) => d.commissionHtCents,
    footer: (k, _p, t) => <Metric label={t('kpi.avgRate')} value={k.restaurantSalesCents ? formatPercent(k.commissionHtCents / k.restaurantSalesCents) : '—'} />,
  },
  {
    key: 'subscriptions',
    label: 'Abonnements encaissés HT',
    icon: <CreditCard />,
    tone: 'amber',
    money: true,
    value: (k) => k.subscriptionsHtCents,
    format: euros,
    spark: (d) => d.subscriptionsHtCents,
    footer: (_k, _p, t) => t('kpi.subscriptionsFooter'),
  },
  {
    key: 'orders',
    label: 'Commandes',
    icon: <ShoppingBag />,
    tone: 'brand',
    value: (k) => k.orders,
    format: (v) => formatNumber(v),
    spark: (d) => d.placed,
    footer: (k, _p, t) => (
      <span className="flex flex-wrap gap-x-3">
        <Metric label={t('kpi.delivered')} value={formatNumber(k.delivered)} />
        <Metric label={t('kpi.cancelled')} value={formatNumber(k.cancelled)} tone={k.cancelled ? 'danger' : undefined} />
      </span>
    ),
  },
  {
    key: 'basket',
    label: 'Panier moyen',
    icon: <Receipt />,
    tone: 'success',
    value: (k) => k.averageBasketCents,
    format: euros,
    spark: (d) => (d.delivered ? d.gmvCents / d.delivered : 0),
    footer: (_k, _p, t) => t('kpi.basketFooter'),
  },
  {
    key: 'cancellation',
    label: 'Taux d’annulation',
    icon: <XCircle />,
    tone: 'danger',
    invert: true,
    value: (k) => k.cancellationRate,
    format: (v) => formatPercent(v),
    spark: (d) => (d.placed ? d.cancelled / d.placed : 0),
    footer: (k, _p, t) => <Metric label={t('kpi.onTime')} value={k.delivered ? formatPercent(k.onTimeRate) : '—'} />,
  },
];

const OPERATIONAL: KpiDef[] = [
  {
    key: 'delivery',
    label: 'Temps de livraison moyen',
    icon: <Gauge />,
    tone: 'info',
    invert: true,
    value: (k) => k.averageDeliveryMinutes,
    format: (v, t) => (v ? t('kpi.minutes', { value: formatNumber(v) }) : '—'),
    footer: (k, _p, t) => <Metric label={t('kpi.deliveredOnTime')} value={k.delivered ? formatPercent(k.onTimeRate) : '—'} />,
  },
  {
    key: 'delivered',
    label: 'Commandes livrées',
    icon: <PackageCheck />,
    tone: 'success',
    value: (k) => k.delivered,
    format: (v) => formatNumber(v),
    spark: (d) => d.delivered,
    footer: (k, _p, t) => <Metric label={t('kpi.ofPlaced')} value={k.orders ? formatPercent(k.delivered / k.orders) : '—'} />,
  },
];

export function KpiGrid({
  current,
  previous,
  days,
  loading,
  compareLabel,
  showMoney,
  byPlan,
}: {
  current: PeriodKpis;
  previous: PeriodKpis;
  days: DayStats[];
  loading: boolean;
  compareLabel: string;
  showMoney: boolean;
  byPlan: boolean;
}) {
  const { t } = useTranslation('accueil');
  const defs = showMoney ? KPIS.filter((k) => !(byPlan && k.key === 'subscriptions')) : [...KPIS.filter((k) => !k.money), ...OPERATIONAL];
  const list = byPlan && showMoney ? [...defs, OPERATIONAL[1]!] : defs;
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {list.map((def) => {
        const value = def.value(current);
        const spark = def.spark && days.length > 1 ? days.map(def.spark) : null;
        return (
          <StatCard
            key={def.key}
            label={t(`kpi.${def.key}`)}
            value={def.format(value, t)}
            icon={def.icon}
            tone={def.tone}
            loading={loading}
            delta={trend(value, def.value(previous))}
            deltaLabel={compareLabel}
            invertDelta={def.invert}
            chart={spark && spark.some((v) => v > 0) ? <Sparkline data={spark} /> : undefined}
            footer={def.footer?.(current, previous, t)}
          />
        );
      })}
    </div>
  );
}

// ------------------------------------------------------------------ Évolution

const METRIC_OPTIONS: Array<{
  value: EvolutionMetric;
  label: string;
  money?: boolean;
}> = [
  { value: 'gmv', label: 'Volume d’affaires', money: true },
  { value: 'revenue', label: 'CA plateforme', money: true },
  { value: 'orders', label: 'Commandes' },
  { value: 'customers', label: 'Clients' },
  { value: 'restaurants', label: 'Commerces' },
];

export function EvolutionCard({
  period,
  current,
  previous,
  loading,
  error,
  showMoney,
  byPlan,
  byHourToday,
  byHourYesterday,
}: {
  period: Period;
  current: DayStats[];
  previous: DayStats[];
  loading: boolean;
  error: unknown;
  showMoney: boolean;
  byPlan: boolean;
  byHourToday: number[];
  byHourYesterday: number[];
}) {
  const { t } = useTranslation('accueil');
  const options = METRIC_OPTIONS.filter((o) => (showMoney || !o.money) && (!byPlan || ['gmv', 'orders'].includes(o.value))).map((o) => ({
    ...o,
    label: t(`evolution.metric.${o.value}`),
  }));
  const [metric, setMetric] = useState<EvolutionMetric>(options[0]?.value ?? 'orders');
  const active = options.some((o) => o.value === metric) ? metric : (options[0]?.value ?? 'orders');
  const hourly = period.days === 1;
  const money = active === 'gmv' || active === 'revenue';

  const data = useMemo(() => {
    if (hourly) {
      return Array.from({ length: 24 }, (_, hour) => ({
        label: t('evolution.hour', { h: String(hour).padStart(2, '0') }),
        current: byHourToday[hour] ?? 0,
        previous: byHourYesterday[hour] ?? 0,
      }));
    }
    return evolutionSeries(current, previous, active, dayTick);
  }, [hourly, byHourToday, byHourYesterday, current, previous, active, t]);

  const total = hourly ? byHourToday.reduce((s, n) => s + n, 0) : current.reduce((s, d) => s + metricValue(d, active), 0);
  const totalPrev = hourly ? byHourYesterday.reduce((s, n) => s + n, 0) : previous.reduce((s, d) => s + metricValue(d, active), 0);
  const delta = trend(total, totalPrev);
  const format = (v: number) => (money && !hourly ? euros(v) : formatNumber(v));
  const series = [
    {
      key: 'current',
      label: hourly ? t('evolution.today') : t('evolution.period'),
      color: 'var(--gl-chart-1)',
    },
    ...(byPlan
      ? []
      : [
          {
            key: 'previous',
            label: hourly ? t('evolution.yesterday') : t('evolution.previousPeriod'),
            color: 'var(--gl-chart-axis)',
          },
        ]),
  ];

  return (
    <Card className="flex min-w-0 flex-col">
      <CardHeader
        title={t('evolution.title')}
        description={hourly ? t('evolution.hourlyDescription') : t('evolution.periodDescription', { period: period.label })}
        actions={
          !hourly && options.length > 1 ? (
            <SegmentedControl
              size="sm"
              aria-label={t('evolution.indicator')}
              value={active}
              onValueChange={(v) => setMetric(v as EvolutionMetric)}
              options={options}
              className="hidden md:inline-flex"
            />
          ) : null
        }
      />
      <div className="px-5 pb-5">
        {!hourly && options.length > 1 && (
          <div className="-mx-1 mb-3 overflow-x-auto px-1 md:hidden">
            <SegmentedControl size="sm" aria-label={t('evolution.indicator')} value={active} onValueChange={(v) => setMetric(v as EvolutionMetric)} options={options} />
          </div>
        )}
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            {loading ? <Skeleton className="h-8 w-32" /> : <p className="num font-display text-2xl font-semibold tracking-display text-fg">{format(total)}</p>}
            {!loading && !byPlan && delta !== undefined && (
              <p className="mt-0.5 text-xs text-fg-subtle">
                <span className={cn('font-mono', delta > 0 ? 'text-success' : delta < 0 ? 'text-danger' : '')}>
                  {delta > 0 ? '+' : ''}
                  {formatPercent(delta)}
                </span>{' '}
                {hourly ? t('evolution.vsYesterday', { amount: format(totalPrev) }) : t('evolution.vsPrevious', { amount: format(totalPrev) })}
              </p>
            )}
          </div>
          <ChartLegend series={series} />
        </div>
        {error ? (
          <LoadError error={error} compact />
        ) : loading ? (
          <Skeleton className="h-[260px] w-full" />
        ) : (
          <AreaChart
            data={data}
            xKey="label"
            series={series}
            height={260}
            valueFormatter={format}
            axisFormatter={(v) => (money && !hourly ? eurosCompact(v) : formatNumber(v, { compact: true }))}
          />
        )}
      </div>
    </Card>
  );
}

// ------------------------------------------------------------------ Alertes

export function AlertsCard({ cityNames }: { cityNames: Map<string, string> }) {
  const { t } = useTranslation('accueil');
  const { alerts, loading, error } = useAlerts('alert', 'active', 30);
  const critical = alerts.filter((a) => a.severity === 'critical').length;
  return (
    <Card className="flex min-w-0 flex-col">
      <CardHeader
        title={t('alerts.title')}
        description={t('alerts.description')}
        actions={
          <Button variant="ghost" size="sm" asChild>
            <Link to="/alertes">
              {t('alerts.seeAll')} <ArrowRight className="rtl:-scale-x-100" />
            </Link>
          </Button>
        }
        divided
      />
      {error ? (
        <LoadError error={error} compact className="py-8" />
      ) : loading ? (
        <div className="space-y-3 p-5">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : alerts.length === 0 ? (
        <EmptyState
          compact
          className="flex-1 py-10"
          icon={<CircleCheck className="text-success" />}
          title={t('alerts.none')}
          description={t('alerts.noneDescription')}
        />
      ) : (
        <>
          {critical > 0 && (
            <p className="tone-danger mx-5 mt-4 rounded-lg bg-(--tone-bg) px-3 py-2 text-xs font-medium text-(--tone-fg)">
              {t('alerts.critical', { count: critical })}
            </p>
          )}
          <ul className="max-h-[430px] flex-1 divide-y divide-border overflow-y-auto xl:max-h-[318px]">
            {alerts.slice(0, 12).map((alert) => (
              <AlertItem key={alert.id} alert={alert} cityName={alert.cityId ? cityNames.get(alert.cityId) : null} dense />
            ))}
          </ul>
          {alerts.length > 12 && (
            <Link to="/alertes" className="border-t border-border px-5 py-2.5 text-center text-xs font-medium text-primary-soft-fg hover:bg-surface-2">
              {t('alerts.more', { count: alerts.length - 12 })}
            </Link>
          )}
        </>
      )}
    </Card>
  );
}

// ------------------------------------------------------------------ Compteurs d'acteurs

function Segments({ parts }: { parts: Array<{ value: number; tone: Tone; label: string }> }) {
  const total = parts.reduce((s, p) => s + p.value, 0);
  if (!total) return <div className="h-1.5 rounded-full bg-surface-3" />;
  return (
    <div className="flex h-1.5 gap-0.5 overflow-hidden rounded-full" role="img" aria-label={parts.map((p) => `${p.label} : ${p.value}`).join(', ')}>
      {parts
        .filter((p) => p.value > 0)
        .map((p) => (
          <span key={p.label} className={cn(`tone-${p.tone}`, 'h-full bg-(--tone-solid)')} style={{ width: `${(p.value / total) * 100}%` }} />
        ))}
    </div>
  );
}

function CounterCard({
  title,
  icon,
  value,
  caption,
  parts,
  href,
  loading,
}: {
  title: string;
  icon: ReactNode;
  value: string;
  caption?: ReactNode;
  parts: Array<{ value: number; tone: Tone; label: string; pulse?: boolean }>;
  href?: string;
  loading: boolean;
}) {
  const body = (
    <>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="grid size-8 place-items-center rounded-lg border border-border bg-surface-2 text-fg-muted [&_svg]:size-4">{icon}</span>
          <p className="text-sm font-medium text-fg-muted">{title}</p>
        </div>
        {href && <ChevronRight className="size-4 text-fg-subtle transition-transform group-hover:translate-x-0.5 rtl:-scale-x-100" />}
      </div>
      {loading ? (
        <Skeleton className="mt-3 h-8 w-24" />
      ) : (
        <p className="num mt-3 font-display text-2xl font-semibold tracking-display text-fg">
          {value}
          {caption && <span className="ms-2 font-sans text-xs font-normal tracking-normal text-fg-subtle">{caption}</span>}
        </p>
      )}
      <div className="mt-3">{loading ? <Skeleton className="h-1.5 w-full" /> : <Segments parts={parts} />}</div>
      <ul className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
        {parts.map((p) => (
          <li key={p.label} className={cn(`tone-${p.tone}`, 'flex min-w-0 items-center gap-1.5')}>
            <span className={cn('size-1.5 shrink-0 rounded-full bg-(--tone-solid)', p.pulse && p.value > 0 && 'animate-pulse')} />
            <span className="truncate text-fg-muted">{p.label}</span>
            <span className="num ms-auto font-mono text-fg">{loading ? '·' : formatNumber(p.value)}</span>
          </li>
        ))}
      </ul>
    </>
  );
  const className = 'group block min-w-0 rounded-xl border border-border bg-surface p-5 shadow-card';
  return href ? (
    <Link
      to={href}
      className={cn(
        className,
        'transition-[border-color,box-shadow] hover:border-border-strong hover:shadow-md focus-visible:outline-2 focus-visible:outline-ring',
      )}
    >
      {body}
    </Link>
  ) : (
    <div className={className}>{body}</div>
  );
}

export function CountersRow({
  counters,
  loading,
  error,
  onRetry,
  showMoney,
}: {
  counters: PilotageCounters | null;
  loading: boolean;
  error: unknown;
  onRetry: () => void;
  showMoney: boolean;
}) {
  if (error && !counters) {
    return (
      <Card>
        <LoadError error={error} onRetry={onRetry} compact />
      </Card>
    );
  }
  const { t } = useTranslation('accueil');
  const c = counters;
  const r = c?.restaurants;
  const d = c?.drivers;
  const s = c?.subscriptions;
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <CounterCard
        title={t('counters.shops')}
        icon={<Store />}
        href="/restaurants"
        loading={loading}
        value={formatNumber(r?.total ?? 0)}
        caption={t('counters.total')}
        parts={[
          { label: t('counters.active'), value: r?.active ?? 0, tone: 'success' },
          { label: t('counters.paused'), value: r?.paused ?? 0, tone: 'amber' },
          { label: t('counters.suspended'), value: r?.suspended ?? 0, tone: 'danger' },
          { label: t('counters.onboarding'), value: r?.onboarding ?? 0, tone: 'info' },
        ]}
      />
      <CounterCard
        title={t('counters.customers')}
        icon={<Users />}
        href="/clients"
        loading={loading}
        value={formatNumber(c?.customers.registered ?? 0)}
        caption={t('counters.registered')}
        parts={[
          {
            label: t('counters.active30d'),
            value: c?.customers.active30d ?? 0,
            tone: 'success',
          },
          {
            label: t('counters.inactive'),
            value: Math.max(0, (c?.customers.registered ?? 0) - (c?.customers.active30d ?? 0)),
            tone: 'neutral',
          },
        ]}
      />
      <CounterCard
        title={t('counters.couriers')}
        icon={<Bike />}
        href="/livreurs"
        loading={loading}
        value={formatNumber(d?.registered ?? 0)}
        caption={t('counters.registered')}
        parts={[
          {
            label: t('counters.online'),
            value: Math.max(0, (d?.online ?? 0) - (d?.onDelivery ?? 0)),
            tone: 'success',
            pulse: true,
          },
          {
            label: t('counters.onDelivery'),
            value: d?.onDelivery ?? 0,
            tone: 'info',
            pulse: true,
          },
          {
            label: t('counters.offline'),
            value: Math.max(0, (d?.active ?? 0) - (d?.online ?? 0)),
            tone: 'neutral',
          },
          { label: t('counters.toValidate'), value: d?.onboarding ?? 0, tone: 'amber' },
        ]}
      />
      <CounterCard
        title={t('counters.subscriptions')}
        icon={<Landmark />}
        href="/abonnements"
        loading={loading}
        value={showMoney ? euros(s?.mrrCents ?? 0) : formatNumber((s?.active ?? 0) + (s?.trialing ?? 0))}
        caption={showMoney ? t('counters.mrr') : t('counters.running')}
        parts={[
          { label: t('counters.active'), value: s?.active ?? 0, tone: 'success' },
          { label: t('counters.trialing'), value: s?.trialing ?? 0, tone: 'plum' },
          { label: t('counters.pastDue'), value: s?.pastDue ?? 0, tone: 'danger' },
          { label: t('counters.cancelledSubs'), value: s?.cancelled ?? 0, tone: 'neutral' },
        ]}
      />
    </div>
  );
}

// ------------------------------------------------------------------ À traiter

const TODO_ICONS: Partial<Record<PlatformAlert['kind'], ReactNode>> = {
  restaurant_to_validate: <Store />,
  driver_to_validate: <Bike />,
  document_expired: <FileWarning />,
  ticket_escalated: <Ticket />,
  review_reported: <Flag />,
  gdpr_request: <ShieldAlert />,
  payout_failed: <PiggyBank />,
  subscription_unpaid: <CreditCard />,
  menu_quality: <UtensilsCrossed />,
  fraud_signal: <ShieldAlert />,
};

const TODO_ORDER: PlatformAlert['kind'][] = [
  'restaurant_to_validate',
  'driver_to_validate',
  'document_expired',
  'ticket_escalated',
  'review_reported',
  'gdpr_request',
  'payout_failed',
  'subscription_unpaid',
];

export function TodoCard({ cityNames }: { cityNames: Map<string, string> }) {
  const { t, locale } = useTranslation('accueil');
  const { alerts, loading, error } = useAlerts('todo', 'active', 150);
  const [open, setOpen] = useState<PlatformAlert['kind'] | null>(null);
  const groups = useMemo(() => {
    const map = new Map<PlatformAlert['kind'], PlatformAlertView[]>();
    for (const alert of alerts) map.set(alert.kind, [...(map.get(alert.kind) ?? []), alert]);
    return [...map.entries()].sort((a, b) => {
      const ia = TODO_ORDER.indexOf(a[0]);
      const ib = TODO_ORDER.indexOf(b[0]);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    });
  }, [alerts]);

  return (
    <Card className="flex min-w-0 flex-col">
      <CardHeader
        title={t('todo.title')}
        description={t('todo.description')}
        icon={<Inbox />}
        actions={
          alerts.length > 0 && (
            <Button variant="ghost" size="sm" asChild>
              <Link to="/alertes?file=a-traiter">
                {t('todo.seeAll')} <ArrowRight className="rtl:-scale-x-100" />
              </Link>
            </Button>
          )
        }
        divided
      />
      {error ? (
        <LoadError error={error} compact className="py-8" />
      ) : loading ? (
        <div className="space-y-2 p-5">
          {Array.from({ length: 5 }, (_, i) => (
            <Skeleton key={i} className="h-11 w-full" />
          ))}
        </div>
      ) : groups.length === 0 ? (
        <EmptyState
          compact
          className="py-10"
          icon={<CircleCheck className="text-success" />}
          title={t('todo.none')}
          description={t('todo.noneDescription')}
        />
      ) : (
        <ul className="divide-y divide-border">
          {groups.map(([kind, items]) => {
            const expanded = open === kind;
            const critical = items.some((i) => i.severity === 'critical');
            return (
              <li key={kind}>
                <button
                  type="button"
                  aria-expanded={expanded}
                  onClick={() => setOpen(expanded ? null : kind)}
                  className="flex w-full items-center gap-3 px-5 py-3 text-start transition-colors hover:bg-surface-2 focus-visible:bg-surface-2 focus-visible:outline-none"
                >
                  <span className="grid size-8 shrink-0 place-items-center rounded-lg border border-border bg-surface-2 text-fg-muted [&_svg]:size-4">
                    {TODO_ICONS[kind] ?? <CalendarClock />}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm font-medium text-fg">{labelOf('PLATFORM_ALERT_KIND_LABELS', kind, locale)}</span>
                  <Badge tone={critical ? 'danger' : 'neutral'}>{formatNumber(items.length)}</Badge>
                  <ChevronRight className={cn('size-4 text-fg-subtle transition-transform rtl:-scale-x-100', expanded && 'rotate-90 rtl:rotate-90')} />
                </button>
                {expanded && (
                  <ul className="border-t border-border bg-surface-2/50">
                    {items.slice(0, 6).map((item) => {
                      const href = alertHref(item);
                      const inner = (
                        <>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm text-fg">{item.target.label || item.title}</span>
                            <span className="block truncate text-xs text-fg-subtle">
                              {item.message}
                              {item.cityId && cityNames.get(item.cityId) ? ` · ${cityNames.get(item.cityId)}` : ''}
                            </span>
                          </span>
                          <span className="shrink-0 font-mono text-2xs text-fg-subtle">{formatRelative(item.detectedAt.toMillis())}</span>
                        </>
                      );
                      return (
                        <li key={item.id}>
                          {href ? (
                            <Link
                              to={href}
                              className="flex items-center gap-3 py-2.5 ps-16 pe-5 hover:bg-surface-3 focus-visible:bg-surface-3 focus-visible:outline-none"
                            >
                              {inner}
                            </Link>
                          ) : (
                            <div className="flex items-center gap-3 py-2.5 ps-16 pe-5">{inner}</div>
                          )}
                        </li>
                      );
                    })}
                    {items.length > 6 && (
                      <li>
                        <Link
                          to={`/alertes?file=a-traiter&type=${kind}`}
                          className="block py-2 ps-16 pe-5 text-xs font-medium text-primary-soft-fg hover:underline"
                        >
                          {t('todo.viewItems', { count: items.length })}
                        </Link>
                      </li>
                    )}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

// ------------------------------------------------------------------ Activité récente

const ACTIVITY_ICONS: Record<PilotageActivity['kind'], ReactNode> = {
  restaurant_signup: <Store />,
  driver_signup: <Bike />,
  restaurant_status: <Activity />,
  driver_status: <Activity />,
  plan_change: <TrendingUp />,
  subscription_cancelled: <XCircle />,
  audit: <Activity />,
};

export function ActivityCard({ activity, loading, error, onRetry }: { activity: PilotageActivity[]; loading: boolean; error: unknown; onRetry: () => void }) {
  const { t } = useTranslation('accueil');
  return (
    <Card className="flex min-w-0 flex-col">
      <CardHeader title={t('activity.title')} description={t('activity.description')} icon={<Activity />} divided />
      <div className="p-5">
        {error && !activity.length ? (
          <LoadError error={error} onRetry={onRetry} compact />
        ) : loading ? (
          <div className="space-y-4">
            {Array.from({ length: 5 }, (_, i) => (
              <div key={i} className="flex gap-3">
                <Skeleton className="size-7 rounded-full" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-4 w-2/3" />
                  <Skeleton className="h-3 w-1/2" />
                </div>
              </div>
            ))}
          </div>
        ) : activity.length === 0 ? (
          <EmptyState compact icon={<Activity />} title={t('activity.none')} description={t('activity.noneDescription')} />
        ) : (
          <Timeline
            items={activity.slice(0, 10).map((item) => {
              const href = entityHref(item.target);
              return {
                id: item.id,
                tone: item.tone === 'warning' ? 'amber' : item.tone,
                icon: ACTIVITY_ICONS[item.kind],
                title: href ? (
                  <Link to={href} className="hover:underline">
                    {item.title}
                  </Link>
                ) : (
                  item.title
                ),
                description: item.detail,
                time: formatRelative(new Date(item.at)),
              };
            })}
          />
        )}
      </div>
    </Card>
  );
}
