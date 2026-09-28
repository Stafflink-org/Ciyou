import { useMemo } from 'react';
import { Info } from 'lucide-react';
import { Card, PageContainer, PageHeader, Section } from '@golink/ui';
import type { PilotageOverview, PilotageOverviewInput } from '@golink/shared';
import { intlLocale, useDocumentTitle, useTranslation } from '@golink/web';
import { useAdminAccess } from '@/auth/AdminAccess';
import { useGeoScope } from '@/layout/GeoScope';
import { callFunction } from '@/lib/firestore';
import { useAlerts } from '../pilotage-commun/alerts';
import { LoadError, PILOTAGE_PLAN_NAMES, PilotageFilterBar } from '../pilotage-commun/components';
import { useCallableQuery, useDailyStats, usePilotageFilters } from '../pilotage-commun/hooks';
import { isoDay } from '../pilotage-commun/period';
import { ActivityCard, AlertsCard, CountersRow, EvolutionCard, KpiGrid, LiveStrip, TodoCard } from './components';
import { useDashboardData, useLiveFigures } from './data';

const getOverview = callFunction<PilotageOverviewInput, PilotageOverview>('getPilotageOverview');

/** Tableau de bord global du super admin (cahier §1) : chiffres, alertes par exception, file à traiter. */
export function AccueilPage() {
  const { t, locale } = useTranslation('accueil');
  const today = useMemo(() => new Intl.DateTimeFormat(intlLocale(locale), { weekday: 'long', day: 'numeric', month: 'long' }), [locale]);
  useDocumentTitle(`${t('docTitle')} · Ciyou Eats Admin`);
  const { admin, can } = useAdminAccess();
  const geo = useGeoScope();
  const state = usePilotageFilters('30d');
  const { period, planCode } = state;
  const showMoney = can('finance.view') || can('analytics.view');
  const firstName = admin.displayName.split(' ')[0];

  const input = useMemo<PilotageOverviewInput>(
    () => ({
      ...state.filters,
      compareFrom: period.compareFrom,
      compareTo: period.compareTo,
    }),
    [state.filters, period.compareFrom, period.compareTo],
  );
  const overview = useCallableQuery(getOverview, input, `${state.key}|${period.compareFrom}`);
  const data = useDashboardData(period, overview.data, Boolean(planCode));
  const live = useLiveFigures();
  const yesterday = useMemo(() => isoDay(new Date(Date.now() - 86_400_000)), []);
  const yesterdayStats = useDailyStats(yesterday, yesterday, period.days === 1);
  const openAlerts = useAlerts('alert', 'active', 60).alerts;
  const cityNames = useMemo(() => new Map(geo.cities.map((c) => [c.id, c.name])), [geo.cities]);

  return (
    <PageContainer wide>
      <PageHeader
        eyebrow={`${today.format(new Date())} · ${geo.label}`}
        title={firstName ? t('header.greeting', { name: firstName }) : t('header.title')}
        description={t('header.description')}
        actions={<PilotageFilterBar state={state} onRefresh={overview.reload} refreshing={overview.refreshing} />}
      />

      <LiveStrip
        loading={live.loading}
        ordersToday={live.ordersToday}
        gmvToday={live.gmvToday}
        ordersYesterdaySameHour={live.ordersYesterdaySameHour}
        ordersMonth={live.ordersMonth}
        gmvMonth={live.gmvMonth}
        openAlerts={openAlerts.length}
        criticalAlerts={openAlerts.filter((a) => a.severity === 'critical').length}
        showMoney={showMoney}
      />

      {planCode && (
        <p className="tone-info mb-4 flex items-start gap-2 rounded-lg bg-(--tone-bg) px-3 py-2 text-xs text-(--tone-fg)">
          <Info className="mt-px size-3.5 shrink-0" />
          {t('planNote', { plan: PILOTAGE_PLAN_NAMES[planCode] })}
        </p>
      )}

      {data.error ? (
        <Card>
          <LoadError error={data.error} className="py-10" />
        </Card>
      ) : (
        <KpiGrid
          current={data.current}
          previous={data.previous}
          days={data.currentDays}
          loading={data.loading}
          compareLabel={period.compareLabel}
          showMoney={showMoney}
          byPlan={data.byPlan}
        />
      )}

      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        <div className="min-w-0 xl:col-span-2">
          <EvolutionCard
            period={period}
            current={data.currentDays}
            previous={data.previousDays}
            loading={data.loading}
            error={data.error ?? (planCode ? overview.error : null)}
            showMoney={showMoney}
            byPlan={data.byPlan}
            byHourToday={live.byHourToday}
            byHourYesterday={yesterdayStats.days[0]?.byHour ?? []}
          />
        </div>
        <AlertsCard cityNames={cityNames} />
      </div>

      <Section title={t('counters.title')} description={t('counters.description')} className="mt-8">
        <CountersRow
          counters={overview.data?.counters ?? null}
          loading={overview.loading}
          error={overview.error}
          onRetry={overview.reload}
          showMoney={showMoney}
        />
      </Section>

      <div className="mt-8 grid gap-6 xl:grid-cols-5">
        <div className="min-w-0 xl:col-span-3">
          <TodoCard cityNames={cityNames} />
        </div>
        <div className="min-w-0 xl:col-span-2">
          <ActivityCard activity={overview.data?.activity ?? []} loading={overview.loading} error={overview.error} onRetry={overview.reload} />
        </div>
      </div>
    </PageContainer>
  );
}
