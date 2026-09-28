// Super admin §5 : contrôle qualité des cartes (anomalies automatiques),
// allergènes incomplets (obligation légale) et scores de qualité à surveiller.
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { limit, orderBy, query, where } from 'firebase/firestore';
import { RefreshCw, ShieldAlert, ShieldCheck, Sparkles, TriangleAlert, Wine } from 'lucide-react';
import {
  Button,
  DataTable,
  EmptyState,
  PageContainer,
  PageHeader,
  Select,
  Skeleton,
  StatCard,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  createColumnHelper,
  formatNumber,
} from '@golink/ui';
import { COLLECTIONS, MENU_ISSUE_LABELS, MENU_ISSUE_TYPES, QUALITY_THRESHOLDS, type MenuIssue } from '@golink/shared';
import { useDocumentTitle } from '@golink/web';
import { useGeoScope } from '@/layout/GeoScope';
import { collectionAt, useCollection, useMutation } from '@/lib/firestore';
import { ErrorPanel, ScoreRing, bpsLabel, plural } from '../acteurs-commun/ui';
import { MenuIssueList } from './components/MenuIssues';
import { RestaurantIdentity } from './components/RestaurantIdentity';
import { RestaurantsNav } from './components/RestaurantsNav';
import { refreshRestaurantScores, useScopedRestaurants, type RestaurantRow } from './lib';

const column = createColumnHelper<RestaurantRow>();

export function QualityPage() {
  useDocumentTitle('Qualité des commerces · GoLink Admin');
  const navigate = useNavigate();
  const scope = useGeoScope();
  const restaurants = useScopedRestaurants();
  const [type, setType] = useState('all');
  const [restaurantFilter, setRestaurantFilter] = useState('all');
  const [shown, setShown] = useState(20);
  const refresh = useMutation(refreshRestaurantScores, { success: (r) => `${plural(r.computed, 'score recalculé', 'scores recalculés')}` });
  const issuesQuery = useMemo(() => {
    const base = collectionAt(COLLECTIONS.menuIssues);
    if (scope.cityIds) return scope.cityIds.length ? query(base, where('cityId', 'in', scope.cityIds.slice(0, 30)), where('status', '==', 'open'), orderBy('detectedAt', 'desc'), limit(300)) : null;
    return query(base, where('status', '==', 'open'), orderBy('detectedAt', 'desc'), limit(300));
  }, [scope.cityIds]);
  const issues = useCollection<MenuIssue>(issuesQuery);
  const byId = useMemo(() => new Map(restaurants.data.map((r) => [r.id, r])), [restaurants.data]);
  const names = useMemo(() => new Map(restaurants.data.map((r) => [r.id, r.name])), [restaurants.data]);
  const cityName = useMemo(() => new Map(scope.cities.map((c) => [c.id, c.name])), [scope.cities]);
  const scopedIssues = issues.data.filter(
    (i) => byId.has(i.restaurantId) && (type === 'all' || i.type === type) && (restaurantFilter === 'all' || i.restaurantId === restaurantFilter),
  );
  const live = restaurants.data.filter((r) => r.status !== 'closed');
  const allergens = live.filter((r) => !r.allergensComplete);
  const lowScores = live.filter((r) => r.qualityScore < QUALITY_THRESHOLDS.watch).sort((a, b) => a.qualityScore - b.qualityScore);
  const alcohol = issues.data.filter((i) => i.type === 'alcohol_suspected' && byId.has(i.restaurantId)).length;

  const columns = useMemo(
    () => [
      column.accessor('name', { header: 'Commerce', cell: (info) => <RestaurantIdentity restaurant={info.row.original} cityName={cityName.get(info.row.original.cityId)} /> }),
      column.accessor('qualityScore', {
        header: 'Score',
        meta: { align: 'center' },
        cell: (info) => (
          <div className="flex justify-center">
            <ScoreRing value={info.getValue()} size={36} />
          </div>
        ),
      }),
      column.accessor((r) => r.metrics30d?.cancelRateBps ?? 0, { id: 'cancel', header: 'Annulation', meta: { align: 'right', className: 'hidden sm:table-cell' }, cell: (info) => <span className="font-mono text-sm num">{bpsLabel(info.getValue())}</span> }),
      column.accessor((r) => r.metrics30d?.rejectRateBps ?? 0, { id: 'reject', header: 'Refus', meta: { align: 'right', className: 'hidden md:table-cell' }, cell: (info) => <span className="font-mono text-sm num">{bpsLabel(info.getValue())}</span> }),
      column.accessor((r) => r.metrics30d?.lateRateBps ?? 0, { id: 'late', header: 'Retards', meta: { align: 'right', className: 'hidden md:table-cell' }, cell: (info) => <span className="font-mono text-sm num">{bpsLabel(info.getValue())}</span> }),
      column.accessor((r) => r.rating?.average ?? 0, {
        id: 'rating',
        header: 'Note',
        meta: { align: 'right', className: 'hidden lg:table-cell' },
        cell: (info) => <span className="font-mono text-sm num">{info.row.original.rating?.count ? info.getValue().toLocaleString('fr-FR', { maximumFractionDigits: 1 }) : '—'}</span>,
      }),
      column.accessor((r) => (r.qualityScore < QUALITY_THRESHOLDS.coach ? 'À accompagner' : 'À surveiller'), {
        id: 'verdict',
        header: 'Suivi',
        cell: (info) => <span className={`text-sm font-medium ${info.getValue() === 'À accompagner' ? 'text-danger' : 'text-fg-muted'}`}>{info.getValue()}</span>,
      }),
    ],
    [cityName],
  );
  const allergenColumns = useMemo(
    () => [
      column.accessor('name', { header: 'Commerce', cell: (info) => <RestaurantIdentity restaurant={info.row.original} cityName={cityName.get(info.row.original.cityId)} /> }),
      column.accessor((r) => (r.status === 'active' ? 'En ligne' : 'Hors ligne'), { id: 'status', header: 'Visibilité', meta: { className: 'hidden sm:table-cell' }, cell: (info) => <span className="text-sm text-fg-muted">{info.getValue()}</span> }),
      column.accessor((r) => issues.data.filter((i) => i.restaurantId === r.id && i.type === 'allergens_missing').length, {
        id: 'products',
        header: 'Produits sans allergènes',
        meta: { align: 'right' },
        cell: (info) => <span className="font-mono text-sm font-medium num">{info.getValue() || '—'}</span>,
      }),
    ],
    [cityName, issues.data],
  );

  return (
    <PageContainer wide>
      <PageHeader
        eyebrow="Acteurs"
        title="Qualité & allergènes"
        description="Anomalies de carte signalées automatiquement, allergènes à compléter et commerces à accompagner."
        actions={
          <Button variant="secondary" leftIcon={<RefreshCw />} loading={refresh.loading} onClick={() => void refresh.mutate({})}>
            Recalculer les scores
          </Button>
        }
      >
        <RestaurantsNav />
      </PageHeader>

      {restaurants.error ? (
        <ErrorPanel error={restaurants.error} />
      ) : (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
            <StatCard label="Anomalies ouvertes" value={formatNumber(issues.data.filter((i) => byId.has(i.restaurantId)).length)} icon={<TriangleAlert />} tone="amber" loading={issues.loading} />
            <StatCard label="Allergènes incomplets" value={formatNumber(allergens.length)} icon={<ShieldAlert />} tone={allergens.length ? 'danger' : 'success'} loading={restaurants.loading} footer="Information du client obligatoire" />
            <StatCard label="Scores à surveiller" value={formatNumber(lowScores.length)} icon={<Sparkles />} tone="info" loading={restaurants.loading} footer={`Sous ${QUALITY_THRESHOLDS.watch}/100`} />
            <StatCard label="Mentions d’alcool" value={formatNumber(alcohol)} icon={<Wine />} tone={alcohol ? 'danger' : 'success'} loading={issues.loading} footer="Vente d’alcool interdite" onClick={() => setType('alcohol_suspected')} />
          </div>

          <Tabs defaultValue="anomalies">
            <TabsList className="mb-5">
              <TabsTrigger value="anomalies" count={scopedIssues.length}>
                Anomalies de carte
              </TabsTrigger>
              <TabsTrigger value="allergenes" count={allergens.length}>
                Allergènes
              </TabsTrigger>
              <TabsTrigger value="scores" count={lowScores.length}>
                Scores à surveiller
              </TabsTrigger>
            </TabsList>
            <TabsContent value="anomalies" className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm text-fg-muted">Corrigez le produit directement ou marquez l’anomalie comme résolue.</p>
                <div className="flex flex-wrap gap-2">
                  <Select
                    size="sm"
                    className="w-48"
                    aria-label="Commerce"
                    value={restaurantFilter}
                    onValueChange={(v) => {
                      setRestaurantFilter(v);
                      setShown(20);
                    }}
                    options={[{ value: 'all', label: 'Tous les commerces' }, ...restaurants.data.map((r) => ({ value: r.id, label: r.name }))]}
                  />
                  <Select
                    size="sm"
                    className="w-56"
                    aria-label="Type d’anomalie"
                    value={type}
                    onValueChange={(v) => {
                      setType(v);
                      setShown(20);
                    }}
                    options={[{ value: 'all', label: 'Toutes les anomalies' }, ...MENU_ISSUE_TYPES.map((t) => ({ value: t, label: MENU_ISSUE_LABELS[t] }))]}
                  />
                </div>
              </div>
              {issues.error ? (
                <ErrorPanel error={issues.error} />
              ) : issues.loading ? (
                <Skeleton className="h-48 w-full" />
              ) : scopedIssues.length === 0 ? (
                <EmptyState icon={<ShieldCheck />} title="Aucune anomalie ouverte" description="Les cartes du périmètre sont en ordre." />
              ) : (
                <>
                  <MenuIssueList issues={scopedIssues.slice(0, shown)} showRestaurant restaurantNames={names} />
                  {scopedIssues.length > shown && (
                    <div className="flex items-center justify-center gap-3">
                      <span className="text-sm text-fg-subtle">
                        {shown} sur {scopedIssues.length}
                      </span>
                      <Button size="sm" variant="secondary" onClick={() => setShown((n) => n + 20)}>
                        Afficher plus
                      </Button>
                    </div>
                  )}
                </>
              )}
            </TabsContent>
            <TabsContent value="allergenes">
              <DataTable
                data={allergens}
                columns={allergenColumns}
                getRowId={(r) => r.id}
                loading={restaurants.loading}
                itemLabel="commerces"
                onRowClick={(r) => navigate(`/restaurants/${r.id}?onglet=qualite`)}
                emptyState={<EmptyState compact icon={<ShieldCheck />} title="Allergènes complets partout" description="Tous les commerces du périmètre informent leurs clients." />}
              />
            </TabsContent>
            <TabsContent value="scores">
              <DataTable
                data={lowScores}
                columns={columns}
                getRowId={(r) => r.id}
                loading={restaurants.loading}
                itemLabel="commerces"
                initialSorting={[{ id: 'qualityScore', desc: false }]}
                onRowClick={(r) => navigate(`/restaurants/${r.id}?onglet=qualite`)}
                emptyState={<EmptyState compact icon={<Sparkles />} title="Aucun commerce à surveiller" description={`Tous les scores sont au-dessus de ${QUALITY_THRESHOLDS.watch}/100.`} />}
              />
            </TabsContent>
          </Tabs>
        </div>
      )}
    </PageContainer>
  );
}
