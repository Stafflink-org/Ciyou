// Données du tableau de bord : indicateurs de la période et de la comparaison,
// série d'évolution, relevé « en direct » du jour et du mois.
import { useMemo } from 'react';
import { startOfMonth, subDays } from 'date-fns';
import type { PilotageKpis, PilotageOverview } from '@golink/shared';
import { kpisOf, sumDays, useDailyStats, type DayStats, type PeriodKpis } from '../pilotage-commun/hooks';
import { isoDay, type Period } from '../pilotage-commun/period';

export type EvolutionMetric = 'gmv' | 'revenue' | 'orders' | 'customers' | 'restaurants';

export interface SeriesPoint {
  label: string;
  current: number;
  previous: number;
  day: string;
}

export interface DashboardData {
  current: PeriodKpis;
  previous: PeriodKpis;
  currentDays: DayStats[];
  previousDays: DayStats[];
  loading: boolean;
  error: unknown;
  /** Indicateurs recalculés par formule (sans ventilation des abonnements). */
  byPlan: boolean;
}

function fromPlan(k: PilotageKpis): PeriodKpis {
  return {
    platformRevenueHtCents: k.commissionHtCents + k.feesHtCents + k.subscriptionsHtCents,
    gmvCents: k.gmvCents,
    restaurantSalesCents: k.restaurantSalesCents,
    commissionHtCents: k.commissionHtCents,
    subscriptionsHtCents: k.subscriptionsHtCents,
    feesHtCents: k.feesHtCents,
    marginCents: k.marginCents,
    refundsCents: k.refundsCents,
    orders: k.ordersPlaced,
    delivered: k.ordersDelivered,
    cancelled: k.ordersCancelled,
    averageBasketCents: k.averageBasketCents,
    cancellationRate: k.cancellationRate,
    customersNew: k.customersNew,
    restaurantsNew: 0,
    driversNew: 0,
    averageDeliveryMinutes: 0,
    onTimeRate: k.ordersDelivered ? (k.ordersDelivered - k.ordersLate) / k.ordersDelivered : 0,
  };
}

/** Indicateurs du tableau de bord : statsDaily en temps réel, ou calcul serveur par formule. */
export function useDashboardData(period: Period, overview: PilotageOverview | null, planSelected: boolean): DashboardData {
  const stats = useDailyStats(period.compareFrom, period.to, !planSelected);
  return useMemo(() => {
    if (planSelected) {
      const plan = overview?.planKpis;
      const days = (plan?.daily ?? []).map((d) => ({
        ...sumDays([]),
        day: d.day,
        gmvCents: d.gmvCents,
        restaurantSalesCents: d.gmvCents,
        commissionHtCents: d.commissionHtCents,
        placed: d.orders,
      }));
      const empty = kpisOf(sumDays([]));
      return {
        current: plan ? fromPlan(plan.current) : empty,
        previous: plan ? fromPlan(plan.previous) : empty,
        currentDays: days,
        previousDays: [],
        loading: !overview,
        error: null,
        byPlan: true,
      };
    }
    const currentDays = stats.days.filter((d) => d.day >= period.from && d.day <= period.to);
    const previousDays = stats.days.filter((d) => d.day >= period.compareFrom && d.day <= period.compareTo);
    return {
      current: kpisOf(sumDays(currentDays)),
      previous: kpisOf(sumDays(previousDays)),
      currentDays,
      previousDays,
      loading: stats.loading,
      error: stats.error,
      byPlan: false,
    };
  }, [planSelected, overview, stats, period.from, period.to, period.compareFrom, period.compareTo]);
}

export function metricValue(day: DayStats, metric: EvolutionMetric): number {
  switch (metric) {
    case 'gmv':
      return day.gmvCents;
    case 'revenue':
      return day.commissionHtCents + day.feesHtCents + day.subscriptionsHtCents;
    case 'orders':
      return day.placed;
    case 'customers':
      return day.customersNew;
    case 'restaurants':
      return day.restaurantsNew;
  }
}

/** Série « période » contre « période précédente », regroupée par semaine au-delà de 120 jours. */
export function evolutionSeries(current: DayStats[], previous: DayStats[], metric: EvolutionMetric, tick: (day: string) => string): SeriesPoint[] {
  const bucket = current.length > 120 ? 7 : 1;
  const out: SeriesPoint[] = [];
  for (let i = 0; i < current.length; i += bucket) {
    const slice = current.slice(i, i + bucket);
    const prevSlice = previous.slice(i, i + bucket);
    const first = slice[0];
    if (!first) continue;
    out.push({
      day: first.day,
      label: tick(first.day),
      current: slice.reduce((s, d) => s + metricValue(d, metric), 0),
      previous: prevSlice.reduce((s, d) => s + metricValue(d, metric), 0),
    });
  }
  return out;
}

/** Relevé du jour, de la veille et du mois en cours (indépendant de la période choisie). */
export function useLiveFigures() {
  const today = new Date();
  const monthStart = startOfMonth(today);
  const yesterday = subDays(today, 1);
  const from = isoDay(yesterday < monthStart ? yesterday : monthStart);
  const todayIso = isoDay(today);
  const stats = useDailyStats(from, todayIso);
  return useMemo(() => {
    const todayStats = stats.byDay.get(todayIso);
    const yesterdayStats = stats.byDay.get(isoDay(yesterday));
    const month = sumDays(stats.days.filter((d) => d.day >= isoDay(monthStart)));
    const hour = today.getHours();
    // Même heure hier : comparaison équitable en cours de journée.
    const yesterdaySameHour = (yesterdayStats?.byHour ?? []).slice(0, hour + 1).reduce((s, n) => s + n, 0);
    return {
      loading: stats.loading,
      ordersToday: todayStats?.placed ?? 0,
      gmvToday: todayStats?.gmvCents ?? 0,
      deliveredToday: todayStats?.delivered ?? 0,
      cancelledToday: todayStats?.cancelled ?? 0,
      ordersYesterdaySameHour: yesterdaySameHour,
      ordersMonth: month.placed,
      gmvMonth: month.gmvCents,
      byHourToday: todayStats?.byHour ?? [],
    };
  }, [stats, todayIso]);
}
