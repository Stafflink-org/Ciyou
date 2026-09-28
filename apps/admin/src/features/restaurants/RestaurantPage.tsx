// Super admin §5 : fiche complète d'un commerce (aperçu, dossier et documents,
// conditions commerciales, statistiques et finances, qualité, notes et historique)
// et actions : valider, suspendre, réactiver, modifier, « voir comme le restaurant ».
import { useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { ArrowLeft, Ban, BarChart3, Eye, FileCheck2, LayoutGrid, MoreHorizontal, NotebookPen, Pencil, Play, RefreshCw, ShieldCheck, Store, Wallet } from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  EmptyState,
  IconButton,
  PageContainer,
  Skeleton,
  StatusBadge,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  formatDateTime,
} from '@golink/ui';
import { MERCHANT_TYPE_LABELS, paths, type Restaurant } from '@golink/shared';
import { useDocumentTitle } from '@golink/web';
import { useAdminAccess } from '@/auth/AdminAccess';
import { useGeoScope } from '@/layout/GeoScope';
import { docAt, toDate, useDoc, useMutation } from '@/lib/firestore';
import { HistoryPanel } from '../acteurs-commun/HistoryPanel';
import { NotesPanel } from '../acteurs-commun/NotesPanel';
import { ErrorPanel, Panel, ScoreRing } from '../acteurs-commun/ui';
import { EditProfileSheet } from './components/EditProfileSheet';
import { RatingInline, RestaurantMark } from './components/RestaurantIdentity';
import { ImpersonateDialog, ReactivateDialog, SuspendDialog } from './components/RestaurantDialogs';
import { CommercialTab } from './fiche/CommercialTab';
import { DossierTab } from './fiche/DossierTab';
import { OverviewTab } from './fiche/OverviewTab';
import { QualityTab } from './fiche/QualityTab';
import { StatsTab } from './fiche/StatsTab';
import { ONBOARDING_META, PLAN_LABELS, RESTAURANT_STATUS_META, refreshRestaurantScores } from './lib';

const TABS = ['apercu', 'dossier', 'conditions', 'statistiques', 'qualite', 'notes'] as const;
type Tab = (typeof TABS)[number];

export function RestaurantPage() {
  const { restaurantId = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const { admin, can } = useAdminAccess();
  const scope = useGeoScope();
  const state = useDoc<Restaurant>(restaurantId ? docAt(paths.restaurant(restaurantId)) : null);
  const restaurant = state.data;
  const [dialog, setDialog] = useState<'suspend' | 'reactivate' | 'impersonate' | 'edit' | null>(null);
  const refresh = useMutation(refreshRestaurantScores, { success: 'Score de qualité recalculé' });
  useDocumentTitle(`${restaurant?.name ?? 'Restaurant'} · GoLink Admin`);

  const requested = params.get('onglet') as Tab | null;
  const tab: Tab = requested && TABS.includes(requested) ? requested : restaurant && restaurant.onboardingStatus !== 'approved' ? 'dossier' : 'apercu';
  const cityName = useMemo(() => scope.cities.find((c) => c.id === restaurant?.cityId)?.name ?? restaurant?.address.city ?? '', [scope.cities, restaurant]);
  const outOfScope = restaurant && admin.role !== 'super_admin' && admin.cityIds.length > 0 && !admin.cityIds.includes(restaurant.cityId);

  if (state.loading) {
    return (
      <PageContainer wide>
        <Skeleton className="mb-6 h-5 w-40" />
        <div className="mb-8 flex items-center gap-4">
          <Skeleton className="size-16 rounded-2xl" />
          <div className="space-y-2">
            <Skeleton className="h-7 w-64" />
            <Skeleton className="h-4 w-48" />
          </div>
        </div>
        <Skeleton className="h-96 w-full" />
      </PageContainer>
    );
  }
  if (state.error) {
    return (
      <PageContainer>
        <ErrorPanel error={state.error} />
      </PageContainer>
    );
  }
  if (!restaurant || outOfScope) {
    return (
      <PageContainer>
        <Card>
          <EmptyState
            icon={<Store />}
            title={outOfScope ? 'Commerce hors de votre périmètre' : 'Commerce introuvable'}
            description={outOfScope ? 'Ce commerce appartient à une ville qui ne vous est pas attribuée.' : 'Il a peut-être été supprimé, ou le lien est incorrect.'}
            action={
              <Button asChild variant="secondary" leftIcon={<ArrowLeft />}>
                <Link to="/restaurants">Retour aux commerces</Link>
              </Button>
            }
          />
        </Card>
      </PageContainer>
    );
  }

  const suspended = restaurant.status === 'suspended' || restaurant.status === 'closed';
  const until = toDate(restaurant.suspension?.until);

  return (
    <PageContainer wide>
      <Link to="/restaurants" className="mb-5 inline-flex items-center gap-1.5 text-sm text-fg-muted transition-colors hover:text-fg">
        <ArrowLeft className="size-4" /> Restaurants
      </Link>

      <header className="mb-6 flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 items-center gap-4">
          <RestaurantMark restaurant={restaurant} size={64} className="rounded-2xl" />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="font-display text-2xl font-semibold tracking-display text-fg sm:text-[1.75rem] sm:leading-9">{restaurant.name}</h1>
              <StatusBadge status={restaurant.status} map={RESTAURANT_STATUS_META} />
              {restaurant.onboardingStatus !== 'approved' && <StatusBadge status={restaurant.onboardingStatus} map={ONBOARDING_META} />}
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-fg-muted">
              <span>{MERCHANT_TYPE_LABELS[restaurant.merchantType ?? 'restaurant']}</span>
              <span aria-hidden="true">·</span>
              <span>{cityName}</span>
              <span aria-hidden="true">·</span>
              <Badge tone={restaurant.planCode === 'premium' ? 'plum' : restaurant.planCode === 'pro' ? 'brand' : 'neutral'}>{PLAN_LABELS[restaurant.planCode]}</Badge>
              <RatingInline average={restaurant.rating?.average ?? 0} count={restaurant.rating?.count ?? 0} />
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {restaurant.status !== 'onboarding' && (
            <div className="mr-1 hidden items-center gap-2 sm:flex" title="Score de qualité">
              <ScoreRing value={restaurant.qualityScore ?? 0} size={40} />
            </div>
          )}
          {can('restaurants.impersonate') && (
            <Button variant="secondary" leftIcon={<Eye />} onClick={() => setDialog('impersonate')}>
              Voir comme le restaurant
            </Button>
          )}
          {can('restaurants.suspend') &&
            (suspended ? (
              <Button variant="primary" leftIcon={<Play />} onClick={() => setDialog('reactivate')}>
                Réactiver
              </Button>
            ) : (
              <Button variant="danger-soft" leftIcon={<Ban />} onClick={() => setDialog('suspend')}>
                Suspendre
              </Button>
            ))}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <IconButton label="Plus d’actions" variant="secondary">
                <MoreHorizontal />
              </IconButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {can('restaurants.edit') && (
                <DropdownMenuItem icon={<Pencil />} onSelect={() => setDialog('edit')}>
                  Modifier la fiche
                </DropdownMenuItem>
              )}
              <DropdownMenuItem icon={<RefreshCw />} onSelect={() => void refresh.mutate({ restaurantId: restaurant.id })}>
                Recalculer le score qualité
              </DropdownMenuItem>
              <DropdownMenuItem icon={<NotebookPen />} onSelect={() => setParams({ onglet: 'notes' })}>
                Ajouter une note interne
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      {suspended && restaurant.suspension && (
        <div role="status" className="tone-danger mb-6 flex flex-col gap-1 rounded-xl border border-(--tone-border) bg-(--tone-bg) px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-(--tone-fg)">
            <strong className="font-semibold">
              {restaurant.suspension.kind === 'documents' ? 'Bloqué pour document expiré' : restaurant.status === 'closed' ? 'Fermé définitivement' : 'Suspendu'}
            </strong>{' '}
            · {restaurant.suspension.reason}
          </p>
          <p className="text-xs text-(--tone-fg)/80">
            {until ? `Réactivation automatique le ${formatDateTime(until)}` : 'Jusqu’à réactivation manuelle'}
            {toDate(restaurant.suspension.at) ? ` · depuis le ${formatDateTime(toDate(restaurant.suspension.at)!)}` : ''}
          </p>
        </div>
      )}

      <Tabs value={tab} onValueChange={(value) => setParams({ onglet: value }, { replace: true })}>
        <TabsList className="mb-6">
          <TabsTrigger value="apercu" icon={<LayoutGrid />}>
            Aperçu
          </TabsTrigger>
          <TabsTrigger value="dossier" icon={<FileCheck2 />}>
            Dossier & documents
          </TabsTrigger>
          <TabsTrigger value="conditions" icon={<Wallet />}>
            Conditions
          </TabsTrigger>
          <TabsTrigger value="statistiques" icon={<BarChart3 />}>
            Statistiques & finances
          </TabsTrigger>
          <TabsTrigger value="qualite" icon={<ShieldCheck />}>
            Qualité
          </TabsTrigger>
          <TabsTrigger value="notes" icon={<NotebookPen />}>
            Notes & historique
          </TabsTrigger>
        </TabsList>
        <TabsContent value="apercu">
          <OverviewTab restaurant={restaurant} cityName={cityName} />
        </TabsContent>
        <TabsContent value="dossier">
          <DossierTab restaurant={restaurant} />
        </TabsContent>
        <TabsContent value="conditions">
          <CommercialTab restaurant={restaurant} />
        </TabsContent>
        <TabsContent value="statistiques">
          <StatsTab restaurant={restaurant} />
        </TabsContent>
        <TabsContent value="qualite">
          <QualityTab restaurant={restaurant} />
        </TabsContent>
        <TabsContent value="notes">
          <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
            <Panel title="Notes internes" icon={<NotebookPen />} description="Visibles uniquement par l’équipe GoLink.">
              <NotesPanel target={{ type: 'restaurant', id: restaurant.id, label: restaurant.name }} />
            </Panel>
            <Panel title="Historique des modifications" icon={<RefreshCw />} description="Qui a fait quoi, quand et pourquoi.">
              <HistoryPanel target={{ type: 'restaurant', id: restaurant.id, label: restaurant.name }} />
            </Panel>
          </div>
        </TabsContent>
      </Tabs>

      <SuspendDialog restaurant={restaurant} open={dialog === 'suspend'} onOpenChange={(o) => !o && setDialog(null)} />
      <ReactivateDialog restaurant={restaurant} open={dialog === 'reactivate'} onOpenChange={(o) => !o && setDialog(null)} />
      <ImpersonateDialog restaurant={restaurant} open={dialog === 'impersonate'} onOpenChange={(o) => !o && setDialog(null)} />
      {dialog === 'edit' && <EditProfileSheet restaurant={restaurant} open onOpenChange={(o) => !o && setDialog(null)} />}
    </PageContainer>
  );
}
