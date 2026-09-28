import { useMemo, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { Bike, CreditCard, Download, Filter, MapPin, Store, TrendingUp } from 'lucide-react';
import { Button, Card, PageContainer, PageHeader, Tabs, TabsList, TabsTrigger, formatDateTime } from '@golink/ui';
import { COLLECTIONS, DEFAULT_MONITORING_SETTINGS, SETTINGS_DOCS, type AnalyticsSection, type MonitoringSettings } from '@golink/shared';
import { useDocumentTitle } from '@golink/web';
import { useAdminAccess } from '@/auth/AdminAccess';
import { useGeoScope } from '@/layout/GeoScope';
import { docAt, useDoc } from '@/lib/firestore';
import { LoadError, PilotageFilterBar } from '../pilotage-commun/components';
import { usePilotageFilters } from '../pilotage-commun/hooks';
import { CitiesSection } from './CitiesSection';
import { DriversSection } from './DriversSection';
import { FunnelSection } from './FunnelSection';
import { GrowthSection } from './GrowthSection';
import { RestaurantsSection } from './RestaurantsSection';
import { SectionSkeleton, useAnalytics } from './shared';
import { SubscriptionsSection } from './SubscriptionsSection';

const SECTIONS: Array<{
  slug: string;
  section: AnalyticsSection;
  label: string;
  icon: ReactNode;
  description: string;
}> = [
  {
    slug: 'croissance',
    section: 'growth',
    label: 'Croissance',
    icon: <TrendingUp />,
    description: 'Nouveaux commerces, clients et livreurs ; rétention.',
  },
  {
    slug: 'commerces',
    section: 'restaurants',
    label: 'Commerces',
    icon: <Store />,
    description: 'Top et flop, commerces en baisse d’activité.',
  },
  {
    slug: 'livreurs',
    section: 'drivers',
    label: 'Livreurs',
    icon: <Bike />,
    description: 'Livraisons, acceptation, délais et retards par zone.',
  },
  {
    slug: 'villes',
    section: 'cities',
    label: 'Villes et zones',
    icon: <MapPin />,
    description: 'Heures de pointe et offre / demande de livreurs.',
  },
  {
    slug: 'abonnements',
    section: 'subscriptions',
    label: 'Abonnements',
    icon: <CreditCard />,
    description: 'Formules, revenu récurrent, résiliations.',
  },
  {
    slug: 'tunnel',
    section: 'funnel',
    label: 'Tunnel de commande',
    icon: <Filter />,
    description: 'De l’ouverture de l’app au paiement.',
  },
];

/** Analytics du super admin (cahier §3), calculées à la demande dans le périmètre choisi. */
export function AnalyticsPage() {
  const { section: slug } = useParams();
  const navigate = useNavigate();
  const current = SECTIONS.find((s) => s.slug === slug) ?? SECTIONS[0]!;
  useDocumentTitle(`${current.label} · Analytics · GoLink Admin`);
  const { can } = useAdminAccess();
  const geo = useGeoScope();
  const state = usePilotageFilters('30d');
  const showMoney = can('finance.view') || can('analytics.view');
  const query = useAnalytics(current.section, state);
  const cityNames = useMemo(() => new Map(geo.cities.map((c) => [c.id, c.name])), [geo.cities]);
  const monitoring = useDoc<MonitoringSettings>(can('settings.view') ? docAt(`${COLLECTIONS.settings}/${SETTINGS_DOCS.monitoring}`) : null);
  const driverRatio = monitoring.data?.zoneDriverRatio ?? DEFAULT_MONITORING_SETTINGS.zoneDriverRatio;
  const tensionRatio = monitoring.data?.driverTensionRatio ?? DEFAULT_MONITORING_SETTINGS.driverTensionRatio;
  const result = query.data?.section === current.section ? query.data : null;

  let body: ReactNode = null;
  if (query.error && !result)
    body = (
      <Card>
        <LoadError error={query.error} onRetry={query.reload} className="py-14" />
      </Card>
    );
  else if (query.loading || !result) body = <SectionSkeleton cards={current.section === 'growth' ? 5 : 4} />;
  else if (result.growth) body = <GrowthSection data={result.growth} period={state.period} showMoney={showMoney} />;
  else if (result.restaurants) body = <RestaurantsSection data={result.restaurants} cityNames={cityNames} showMoney={showMoney} />;
  else if (result.drivers) body = <DriversSection data={result.drivers} cityNames={cityNames} />;
  else if (result.cities) body = <CitiesSection data={result.cities} showMoney={showMoney} driverRatio={driverRatio} tensionRatio={tensionRatio} days={state.period.days} />;
  else if (result.subscriptions) body = <SubscriptionsSection data={result.subscriptions} showMoney={showMoney} />;
  else if (result.funnel) body = <FunnelSection data={result.funnel} />;

  return (
    <PageContainer wide>
      <PageHeader
        eyebrow={`Analytics · ${geo.label} · ${state.period.label}`}
        title={current.label}
        description={current.description}
        actions={
          <PilotageFilterBar state={state} showPlan={current.section !== 'funnel'} onRefresh={query.reload} refreshing={query.refreshing}>
            {can('exports.run') && (
              <Button variant="secondary" asChild>
                <Link to="/rapports">
                  <Download /> Exporter
                </Link>
              </Button>
            )}
          </PilotageFilterBar>
        }
      />
      <Tabs value={current.slug} onValueChange={(value) => void navigate(`/analytics/${value}`)}>
        <TabsList className="mb-6">
          {SECTIONS.map((s) => (
            <TabsTrigger key={s.slug} value={s.slug} icon={s.icon}>
              {s.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      {body}
      {result && (
        <p className="mt-6 text-right text-2xs text-fg-subtle">
          Calculé le {formatDateTime(new Date(result.generatedAt))}
          {query.refreshing ? ' · actualisation…' : ''}
        </p>
      )}
    </PageContainer>
  );
}
