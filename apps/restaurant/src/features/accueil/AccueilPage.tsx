// Accueil : tableau de bord de l'établissement. Service en direct, indicateurs
// du jour comparés à la semaine précédente, ventes, heures de pointe, meilleures
// ventes, alertes de stock, équipe du jour et derniers avis. Les montants ne
// sont affichés qu'aux membres autorisés (finance.view).
import { useMemo } from 'react';
import { Link, useNavigate } from 'react-router';
import { limit, orderBy, query, where } from 'firebase/firestore';
import {
  AlertTriangle,
  ArrowRight,
  Bike,
  ChefHat,
  ClipboardList,
  Clock3,
  Euro,
  PackageOpen,
  Radio,
  ShoppingBag,
  Star,
  TrendingUp,
  Users,
} from 'lucide-react';
import {
  AreaChart,
  Avatar,
  BarChart,
  Button,
  Card,
  CardHeader,
  EmptyState,
  PageContainer,
  PageHeader,
  Skeleton,
  StatCard,
  StatusPill,
  cn,
  formatEUR,
  formatNumber,
  toneClass,
} from '@golink/ui';
import {
  COLLECTIONS,
  paths,
  toIsoDay,
  type Product,
  type RestaurantDailyStats,
  type RestaurantMember,
  type Review,
  type Shift,
} from '@golink/shared';
import { intlLocale, useAuth, useTranslation, type CollectionState } from '@golink/web';
import { useRestaurantAccess } from '@/auth/RestaurantAccess';
import { AutoPauseBanner } from '@/features/commandes/components/AutoPauseBanner';
import { serviceState, useServiceStateLabel } from '@/layout/ServiceStatus';
import { collectionAt, docAt, errorMessage, toDate, useCollection, useDocs } from '@/lib/firestore';
import { useActiveOrders, useNow } from '../commandes/hooks';
import { LANES, countdownOf, formatCountdown, laneOf, statusMeta, type OrderRow } from '../commandes/lib';

const DAY_MS = 86_400_000;
type Translate = (key: string, vars?: Record<string, string | number | undefined>) => string;

function greeting(hour: number, t: Translate): string {
  return t(hour < 5 || hour >= 18 ? 'greeting.evening' : 'greeting.day');
}

function serviceMoment(hour: number, t: Translate): string {
  if (hour < 11) return t('moment.before');
  if (hour < 15) return t('moment.lunch');
  if (hour < 18) return t('moment.between');
  return t('moment.evening');
}

/** Jours AAAA-MM-JJ du plus ancien au plus récent (fuseau de Paris). */
function lastDays(count: number, end = Date.now()): string[] {
  return Array.from({ length: count }, (_, i) => toIsoDay(new Date(end - (count - 1 - i) * DAY_MS)));
}

function delta(current: number, previous: number): number | undefined {
  if (previous <= 0) return undefined;
  return (current - previous) / previous;
}

function Stars({ value }: { value: number }) {
  const { t } = useTranslation('accueil');
  return (
    <span className="tone-amber inline-flex text-(--tone-solid)" aria-label={t('reviews.stars', { value })}>
      {Array.from({ length: 5 }, (_, i) => (
        <Star key={i} className={cn('size-3.5', i < value ? 'fill-current' : 'opacity-30')} />
      ))}
    </span>
  );
}

export function AccueilPage() {
  const navigate = useNavigate();
  const { t, locale } = useTranslation('accueil');
  const { user } = useAuth();
  const { restaurant, restaurantId, member, can } = useRestaurantAccess();
  const now = useNow(1000);
  const intl = intlLocale(locale);
  const WEEKDAY = useMemo(() => new Intl.DateTimeFormat(intl, { weekday: 'short' }), [intl]);
  const LONG_DATE = useMemo(() => new Intl.DateTimeFormat(intl, { weekday: 'long', day: 'numeric', month: 'long' }), [intl]);
  const stateLabel = useServiceStateLabel();
  const hour = new Date(now).getHours();
  const firstName = (member.displayName || user?.displayName || '').split(' ')[0];
  const showMoney = can('finance.view');
  const state = serviceState(restaurant);

  // ------------------------------------------------------------ Données
  const days = useMemo(() => lastDays(14), []);
  const statRefs = useMemo(() => days.map((d) => docAt(`${paths.restaurantSub(restaurantId, 'dailyStats')}/${d.replace(/-/g, '')}`)), [days, restaurantId]);
  const stats = useDocs<RestaurantDailyStats>(statRefs);
  const statsByDay = useMemo(() => new Map(stats.data.map((s) => [s.day, s])), [stats.data]);
  const active = useActiveOrders();
  const bestSellers = useCollection<Product>(query(collectionAt(paths.restaurantSub(restaurantId, 'products')), orderBy('salesCount', 'desc'), limit(5)));
  const lowStock = useCollection<Product>(query(collectionAt(paths.restaurantSub(restaurantId, 'products')), where('stock', '<=', 25), orderBy('stock', 'asc'), limit(30)));
  const reviews = useCollection<Review>(
    query(collectionAt(COLLECTIONS.reviews), where('restaurantId', '==', restaurantId), where('status', '==', 'published'), orderBy('createdAt', 'desc'), limit(3)),
  );
  const canTeam = can('team.view');
  const members = useCollection<RestaurantMember>(canTeam ? query(collectionAt(paths.restaurantSub(restaurantId, 'members')), where('active', '==', true), limit(60)) : null);
  const canPlanning = can('planning.view') && canTeam;
  const todayIso = days[days.length - 1] ?? toIsoDay(new Date());
  const shifts = useCollection<Shift>(canPlanning ? query(collectionAt(paths.restaurantSub(restaurantId, 'shifts')), where('date', '==', todayIso), limit(80)) : null);

  // ------------------------------------------------------------ Indicateurs
  const today = statsByDay.get(todayIso);
  const sameDayLastWeek = statsByDay.get(days[days.length - 8] ?? '');
  const thisWeek = days.slice(7).map((d) => statsByDay.get(d));
  const lastWeek = days.slice(0, 7).map((d) => statsByDay.get(d));
  const sum = (list: Array<RestaurantDailyStats | undefined>, pick: (s: RestaurantDailyStats) => number) => list.reduce((acc, s) => acc + (s ? pick(s) : 0), 0);
  // Comparaison à la même heure le même jour de la semaine précédente.
  const currentHour = new Date(now).getHours();
  const lastWeekOrdersSoFar = (sameDayLastWeek?.byHour ?? []).slice(0, currentHour + 1).reduce((a, b) => a + b, 0);
  const lastWeekShare = sameDayLastWeek?.ordersCount ? lastWeekOrdersSoFar / sameDayLastWeek.ordersCount : 0;
  const lastWeekSalesSoFar = Math.round((sameDayLastWeek?.salesCents ?? 0) * lastWeekShare);
  const lastWeekDeliveredSoFar = Math.round((sameDayLastWeek?.deliveredCount ?? 0) * lastWeekShare);
  const sameHourLabel = t('kpi.vsSameHour', { day: WEEKDAY.format(now - 7 * DAY_MS).replace('.', '') });
  const weekSales = sum(thisWeek, (s) => s.salesCents);
  const prevWeekSales = sum(lastWeek, (s) => s.salesCents);
  const weekOrders = sum(thisWeek, (s) => s.ordersCount);
  const prevWeekOrders = sum(lastWeek, (s) => s.ordersCount);
  const prepDays = thisWeek.filter((s): s is NonNullable<typeof s> => Boolean(s && s.averagePrepMinutes > 0));
  const weekPrep = prepDays.length ? prepDays.reduce((a, s) => a + s.averagePrepMinutes, 0) / prepDays.length : 0;

  const chartData = useMemo(
    () =>
      days.slice(7).map((d, i) => {
        const cur = statsByDay.get(d);
        const prev = statsByDay.get(days[i] ?? '');
        return {
          label: WEEKDAY.format(new Date(`${d}T12:00:00`)).replace('.', ''),
          current: showMoney ? (cur?.salesCents ?? 0) / 100 : (cur?.ordersCount ?? 0),
          previous: showMoney ? (prev?.salesCents ?? 0) / 100 : (prev?.ordersCount ?? 0),
        };
      }),
    [days, statsByDay, showMoney, WEEKDAY],
  );
  const hoursData = useMemo(() => {
    const byHour = today?.byHour ?? [];
    const lastWeekHours = sameDayLastWeek?.byHour ?? [];
    // Plage du service (9 h – 23 h), élargie si des commandes tombent en dehors.
    const active = Array.from({ length: 24 }, (_, h) => h).filter((h) => (byHour[h] ?? 0) + (lastWeekHours[h] ?? 0) > 0);
    const from = Math.min(9, ...active);
    const to = Math.max(22, ...active);
    // Au-delà de 14 heures affichées, regroupement par tranches de deux heures (barres lisibles).
    const step = to - from + 1 > 14 ? 2 : 1;
    const start = from - (from % step);
    const slots = Math.ceil((to - start + 1) / step);
    const pick = (list: number[], h: number) => Array.from({ length: step }, (_, k) => list[h + k] ?? 0).reduce((a, b) => a + b, 0);
    return Array.from({ length: slots }, (_, i) => start + i * step).map((h) => ({
      label: step === 1 ? t('charts.hour', { h }) : t('charts.hourRange', { from: h, to: h + step }),
      today: pick(byHour, h),
      lastWeek: pick(lastWeekHours, h),
    }));
  }, [today, sameDayLastWeek, t]);

  const laneCounts = useMemo(() => {
    const counts = { new: 0, kitchen: 0, ready: 0, delivery: 0 };
    for (const o of active.data) {
      const lane = laneOf(o);
      if (lane) counts[lane] += 1;
    }
    return counts;
  }, [active.data]);
  const urgent = useMemo(
    () =>
      [...active.data]
        .filter((o) => laneOf(o))
        .sort((a, b) => (countdownOf(a, now)?.seconds ?? 99_999) - (countdownOf(b, now)?.seconds ?? 99_999))
        .slice(0, 5),
    [active.data, now],
  );
  const lateCount = active.data.filter((o) => {
    const cd = countdownOf(o, now);
    return cd && cd.kind === 'prep' && cd.seconds < 0;
  }).length;

  const alerts = useMemo(() => lowStock.data.filter((p) => p.stock !== null && p.stock <= Math.max(1, p.lowStockThreshold)).slice(0, 5), [lowStock.data]);
  const onDuty = members.data.filter((m) => m.onDuty);
  const loadingStats = stats.loading;

  const openOrder = (o: OrderRow) => navigate(`/commandes?commande=${o.id}`);

  return (
    <PageContainer wide>
      <PageHeader
        eyebrow={LONG_DATE.format(now)}
        title={firstName ? `${greeting(hour, t)} ${firstName}` : greeting(hour, t)}
        description={
          <span className="inline-flex flex-wrap items-center gap-2">
            {restaurant.name} · {serviceMoment(hour, t)}
            <StatusPill tone={state.tone} pulse={state.pulse}>
              {stateLabel(state)}
            </StatusPill>
          </span>
        }
        actions={
          can('orders.view') ? (
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" leftIcon={<Radio />} onClick={() => navigate('/commandes/suivi')}>
                {t('actions.live')}
              </Button>
              <Button variant="primary" leftIcon={<ClipboardList />} onClick={() => navigate('/commandes')}>
                {t('actions.openService')}
              </Button>
            </div>
          ) : undefined
        }
      />

      <AutoPauseBanner className="mb-4" />

      {/* Service en direct */}
      {can('orders.view') && (
        <Card className="overflow-hidden">
          <div className="grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)]">
            <div className="border-b border-border p-5 lg:border-b-0 lg:border-e">
              <p className="eyebrow">{t('live.eyebrow')}</p>
              <div className="mt-2 font-display text-2xl font-semibold tracking-tight text-fg">
                {active.loading ? <Skeleton className="h-8 w-48" /> : active.data.length === 0 ? t('live.none') : t('live.inProgress', { count: active.data.length })}
              </div>
              {lateCount > 0 && (
                <p className="tone-danger mt-1 flex items-center gap-1.5 text-sm font-medium text-(--tone-fg)">
                  <AlertTriangle className="size-4" /> {t('live.late', { count: lateCount })}
                </p>
              )}
              <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-2 xl:grid-cols-4">
                {LANES.map((lane) => (
                  <Link
                    key={lane.id}
                    to="/commandes"
                    className={cn(toneClass[lane.tone], 'rounded-lg border border-border bg-surface-2 px-3 py-2.5 transition-colors hover:border-border-strong focus-visible:outline-2 focus-visible:outline-ring')}
                  >
                    <span className="flex items-center gap-1.5 text-2xs font-medium text-fg-muted">
                      <span className={cn('size-1.5 rounded-full bg-(--tone-solid)', lane.id === 'new' && laneCounts.new > 0 && 'animate-pulse')} />
                      {t(`lanes.${lane.id}`)}
                    </span>
                    <span className="num mt-0.5 block font-display text-2xl font-semibold tracking-display text-fg">{active.loading ? '·' : laneCounts[lane.id]}</span>
                  </Link>
                ))}
              </div>
            </div>
            <div className="min-w-0">
              {active.loading ? (
                <div className="space-y-2 p-5">
                  <Skeleton className="h-11" />
                  <Skeleton className="h-11" />
                  <Skeleton className="h-11" />
                </div>
              ) : active.error ? (
                <p className="p-5 text-sm text-danger">{errorMessage(active.error)}</p>
              ) : urgent.length === 0 ? (
                <EmptyState compact icon={<ChefHat />} title={t('live.calmTitle')} description={t('live.calmDescription')} />
              ) : (
                <ul className="divide-y divide-border">
                  {urgent.map((o) => {
                    const cd = countdownOf(o, now);
                    const meta = statusMeta(o);
                    return (
                      <li key={o.id}>
                        <button type="button" onClick={() => openOrder(o)} className="flex w-full items-center gap-3 px-5 py-3 text-start transition-colors hover:bg-surface-2 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring">
                          <span className="num w-20 shrink-0 font-mono text-sm font-semibold text-fg">{o.number}</span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm text-fg">{o.customerName}</span>
                            <span className="block truncate text-2xs text-fg-subtle">
                              {t('live.items', { count: o.itemsCount })} · {t(`fulfillment.${o.fulfillment}`)}
                            </span>
                          </span>
                          <StatusPill tone={meta.tone} pulse={meta.pulse} className="hidden sm:inline-flex">
                            {meta.label}
                          </StatusPill>
                          {cd && (
                            <span className={cn('num w-14 shrink-0 text-end font-mono text-xs', cd.seconds < 0 ? 'tone-danger font-semibold text-(--tone-fg)' : 'text-fg-muted')}>
                              {formatCountdown(cd.seconds)}
                            </span>
                          )}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        </Card>
      )}

      {/* Indicateurs */}
      <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {showMoney ? (
          <StatCard
            label={t('kpi.salesToday')}
            value={formatEUR(today?.salesCents ?? 0, { cents: true })}
            icon={<Euro />}
            loading={loadingStats}
            delta={delta(today?.salesCents ?? 0, lastWeekSalesSoFar)}
            deltaLabel={sameHourLabel}
            footer={t('kpi.weekFooter', { amount: formatEUR(weekSales, { cents: true }), change: prevWeekSales > 0 ? `${weekSales >= prevWeekSales ? '+' : '−'}${formatNumber(Math.abs(((weekSales - prevWeekSales) / prevWeekSales) * 100))} %` : t('kpi.newPeriod') })}
          />
        ) : (
          <StatCard
            label={t('kpi.deliveredToday')}
            value={formatNumber(today?.deliveredCount ?? 0)}
            icon={<ShoppingBag />}
            loading={loadingStats}
            delta={delta(today?.deliveredCount ?? 0, lastWeekDeliveredSoFar)}
            deltaLabel={sameHourLabel}
          />
        )}
        <StatCard
          label={t('kpi.ordersToday')}
          value={formatNumber(today?.ordersCount ?? 0)}
          icon={<ClipboardList />}
          tone="info"
          loading={loadingStats}
          delta={delta(today?.ordersCount ?? 0, lastWeekOrdersSoFar)}
          deltaLabel={sameHourLabel}
          footer={t('kpi.ordersFooter', { week: formatNumber(weekOrders), cancelled: t('kpi.cancelledToday', { count: today?.cancelledCount ?? 0 }) })}
        />
        <StatCard
          label={t('kpi.avgPrep')}
          value={today?.averagePrepMinutes ? t('kpi.minutes', { value: today.averagePrepMinutes }) : weekPrep ? t('kpi.minutes', { value: Math.round(weekPrep) }) : '—'}
          icon={<Clock3 />}
          tone="amber"
          loading={loadingStats}
          invertDelta
          delta={today?.averagePrepMinutes && weekPrep ? delta(today.averagePrepMinutes, weekPrep) : undefined}
          deltaLabel={today?.averagePrepMinutes ? t('kpi.vsAvg7') : t('kpi.avg7')}
          footer={restaurant.busyExtraMinutes ? t('kpi.prepFooterBusy', { minutes: restaurant.prepMinutes, extra: restaurant.busyExtraMinutes }) : t('kpi.prepFooter', { minutes: restaurant.prepMinutes })}
        />
        <StatCard
          label={t('kpi.rating')}
          value={restaurant.rating.count > 0 ? restaurant.rating.average.toLocaleString(intl, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) : '—'}
          icon={<Star />}
          tone="teal"
          footer={restaurant.rating.count > 0 ? t('kpi.ratingCount', { count: restaurant.rating.count }) : t('kpi.noReview')}
        />
      </div>

      {/* Graphiques */}
      <div className="mt-6 grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader
            eyebrow={t('charts.last7')}
            title={showMoney ? t('charts.salesWeek') : t('charts.ordersWeek')}
            description={
              showMoney
                ? t('charts.summaryMoney', { current: formatEUR(weekSales, { cents: true }), previous: formatEUR(prevWeekSales, { cents: true }) })
                : t('charts.summaryOrders', { current: formatNumber(weekOrders), previous: formatNumber(prevWeekOrders) })
            }
            icon={<TrendingUp />}
          />
          <div className="px-3 pb-4 sm:px-5">
            {loadingStats ? (
              <Skeleton className="h-64" />
            ) : stats.error ? (
              <p className="p-4 text-sm text-danger">{errorMessage(stats.error)}</p>
            ) : (
              <AreaChart
                data={chartData}
                xKey="label"
                height={260}
                series={[
                  { key: 'current', label: t('charts.thisWeek') },
                  { key: 'previous', label: t('charts.previousWeek') },
                ]}
                valueFormatter={(v) => (showMoney ? formatEUR(v) : formatNumber(v))}
                axisFormatter={(v) => (showMoney ? formatEUR(v, { compact: true }) : formatNumber(v))}
              />
            )}
          </div>
        </Card>
        <Card>
          <CardHeader eyebrow={t('charts.todayEyebrow')} title={t('charts.peakHours')} description={t('charts.peakHoursDescription')} icon={<Clock3 />} />
          <div className="px-3 pb-4 sm:px-5">
            {loadingStats ? (
              <Skeleton className="h-64" />
            ) : (
              <BarChart
                data={hoursData}
                xKey="label"
                height={260}
                series={[
                  { key: 'today', label: t('charts.today') },
                  { key: 'lastWeek', label: t('charts.lastWeek') },
                ]}
              />
            )}
          </div>
        </Card>
      </div>

      {/* Carte, stocks, équipe, avis */}
      <div className="mt-6 grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
        <Card>
          <CardHeader
            eyebrow={t('best.eyebrow')}
            title={t('best.title')}
            icon={<TrendingUp />}
            actions={
              can('menu.view') ? (
                <Button variant="ghost" size="sm" rightIcon={<ArrowRight />} onClick={() => navigate('/produits')}>
                  {t('best.products')}
                </Button>
              ) : undefined
            }
          />
          <div className="px-5 pb-4">
            {bestSellers.loading ? (
              <div className="space-y-2">
                {Array.from({ length: 4 }, (_, i) => (
                  <Skeleton key={i} className="h-10" />
                ))}
              </div>
            ) : bestSellers.error ? (
              <p className="text-sm text-danger">{errorMessage(bestSellers.error)}</p>
            ) : bestSellers.data.length === 0 ? (
              <EmptyState compact icon={<PackageOpen />} title={t('best.none')} description={t('best.noneDescription')} />
            ) : (
              <ol className="space-y-1">
                {bestSellers.data.map((p, i) => {
                  const max = bestSellers.data[0]?.salesCount || 1;
                  return (
                    <li key={p.id} className="py-1.5">
                      <div className="flex items-center gap-3">
                        <span className="num w-5 font-mono text-2xs text-fg-subtle">{String(i + 1).padStart(2, '0')}</span>
                        <span className="min-w-0 flex-1 truncate text-sm font-medium text-fg">{p.name}</span>
                        <span className="num font-mono text-xs text-fg-muted">{t('best.sold', { count: p.salesCount })}</span>
                      </div>
                      <div className="ms-8 mt-1.5 h-1 overflow-hidden rounded-full bg-surface-3">
                        <div className="h-full rounded-full bg-primary" style={{ width: `${Math.max(4, (p.salesCount / max) * 100)}%` }} />
                      </div>
                    </li>
                  );
                })}
              </ol>
            )}
          </div>
        </Card>

        <Card>
          <CardHeader
            eyebrow={t('stock.eyebrow')}
            title={t('stock.title')}
            icon={<AlertTriangle />}
            actions={
              can('menu.view') ? (
                <Button variant="ghost" size="sm" rightIcon={<ArrowRight />} onClick={() => navigate('/produits')}>
                  {t('stock.action')}
                </Button>
              ) : undefined
            }
          />
          <div className="px-5 pb-4">
            {lowStock.loading ? (
              <div className="space-y-2">
                <Skeleton className="h-12" />
                <Skeleton className="h-12" />
              </div>
            ) : lowStock.error ? (
              <p className="text-sm text-danger">{errorMessage(lowStock.error)}</p>
            ) : alerts.length === 0 ? (
              <EmptyState compact icon={<PackageOpen />} title={t('stock.none')} description={t('stock.noneDescription')} />
            ) : (
              <ul className="space-y-2">
                {alerts.map((p) => (
                  <li key={p.id} className={cn(p.stock === 0 ? 'tone-danger' : 'tone-amber', 'flex items-center gap-3 rounded-lg border border-(--tone-border) bg-(--tone-bg) px-3 py-2.5')}>
                    <AlertTriangle className="size-4 shrink-0 text-(--tone-fg)" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-fg">{p.name}</span>
                      <span className="text-2xs text-fg-muted">
                        {p.stock === 0 ? t('stock.outOfStock') : t('stock.remaining', { count: p.stock ?? 0 })} · {t('stock.threshold', { count: p.lowStockThreshold })}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Card>

        <Card className="lg:col-span-2 xl:col-span-1">
          {canTeam ? (
            <>
              <CardHeader eyebrow={t('charts.todayEyebrow')} title={t('team.title')} icon={<Users />} description={canPlanning ? t('team.planned', { count: shifts.data.length }) : undefined} />
              <div className="px-5 pb-4">
                {members.loading ? (
                  <Skeleton className="h-16" />
                ) : members.error ? (
                  <p className="text-sm text-danger">{errorMessage(members.error)}</p>
                ) : (
                  <>
                    <p className="text-xs font-medium text-fg-muted">{t('team.onDuty')}</p>
                    {onDuty.length === 0 ? (
                      <p className="mt-1 text-sm text-fg-subtle">{t('team.nobody')}</p>
                    ) : (
                      <ul className="mt-2 flex flex-wrap gap-2">
                        {onDuty.slice(0, 8).map((m) => (
                          <li key={m.id} className="flex items-center gap-2 rounded-full border border-border bg-surface-2 py-1 ps-1 pe-3">
                            <Avatar name={m.displayName} size="xs" status="online" />
                            <span className="text-xs text-fg">{m.displayName.split(' ')[0]}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                    {canPlanning && shifts.data.length > 0 && (
                      <ul className="mt-4 space-y-1.5 border-t border-border pt-3">
                        {[...shifts.data]
                          .sort((a, b) => a.startTime.localeCompare(b.startTime))
                          .slice(0, 5)
                          .map((s) => (
                            <li key={s.id} className="flex items-center justify-between text-xs">
                              <span className="text-fg">{s.position ?? t('team.slot')}</span>
                              <span className="num font-mono text-fg-muted">
                                {s.startTime} – {s.endTime}
                              </span>
                            </li>
                          ))}
                      </ul>
                    )}
                  </>
                )}
              </div>
            </>
          ) : (
            <>
              <CardHeader eyebrow={t('reviews.eyebrow')} title={t('reviews.title')} icon={<Star />} />
              <ReviewsList reviews={reviews} />
            </>
          )}
        </Card>

        {canTeam && (
          <Card className="lg:col-span-2 xl:col-span-3">
            <CardHeader eyebrow={t('reviews.eyebrow')} title={t('reviews.title')} icon={<Star />} />
            <ReviewsList reviews={reviews} horizontal />
          </Card>
        )}
      </div>

      {can('orders.view') && active.data.some((o) => o.fulfillment === 'delivery' && o.driverId) && (
        <p className="mt-6 flex items-center justify-center gap-2 text-xs text-fg-subtle">
          <Bike className="size-3.5" /> {t('live.couriersOnTheWay')}{' '}
          <Link to="/commandes/suivi" className="font-medium text-primary-soft-fg hover:underline">
            {t('live.trackingLink')}
          </Link>
          .
        </p>
      )}
    </PageContainer>
  );
}

function ReviewsList({ reviews, horizontal }: { reviews: CollectionState<Review>; horizontal?: boolean }) {
  const { t, locale } = useTranslation('accueil');
  if (reviews.loading) {
    return (
      <div className="space-y-2 px-5 pb-4">
        <Skeleton className="h-14" />
        <Skeleton className="h-14" />
      </div>
    );
  }
  if (reviews.error) return <p className="px-5 pb-4 text-sm text-danger">{errorMessage(reviews.error)}</p>;
  if (reviews.data.length === 0) {
    return <EmptyState compact icon={<Star />} title={t('reviews.none')} description={t('reviews.noneDescription')} />;
  }
  return (
    <ul className={cn('px-5 pb-4', horizontal ? 'grid gap-3 md:grid-cols-3' : 'space-y-3')}>
      {reviews.data.map((r) => (
        <li key={r.id} className="rounded-lg border border-border bg-surface-2 px-3.5 py-3">
          <div className="flex items-center justify-between gap-2">
            <span className="truncate text-sm font-medium text-fg">{r.customerDisplayName}</span>
            <Stars value={r.restaurantRating} />
          </div>
          <p className="mt-1 line-clamp-3 text-sm text-fg-muted">{r.comment || t('reviews.noComment')}</p>
          <p className="mt-1.5 text-2xs text-fg-subtle">{toDate(r.createdAt)?.toLocaleDateString(intlLocale(locale), { day: 'numeric', month: 'long' })}</p>
        </li>
      ))}
    </ul>
  );
}
