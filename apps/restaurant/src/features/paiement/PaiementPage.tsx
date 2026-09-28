// Hub Paiement (plan V2 §3.3) : agrège les rubriques Finances, États du CA, Commissions,
// Virements, Factures, Compte de versement et Abonnement en un seul lien de menu, sous
// forme d'onglets. Chaque onglet reste le composant déjà existant (aucune duplication),
// affiché en mode intégré (HubEmbedProvider) pour ne pas répéter son propre en-tête.
// Les anciennes routes (/finances, /virements/:payoutId, /factures/:invoiceId…) restent
// actives : elles ne sont ici que masquées du menu (nav.hidden).
import { Suspense, lazy, useMemo, type ComponentType, type ReactNode } from 'react';
import { useSearchParams } from 'react-router';
import { BadgePercent, Banknote, ChartColumn, FileText, Gem, Landmark, Wallet } from 'lucide-react';
import { HubEmbedProvider, PageContainer, PageHeader, Skeleton, Tabs, TabsList, TabsTrigger } from '@golink/ui';
import { AccessDeniedPanel, useDocumentTitle } from '@golink/web';
import type { RestaurantPermission } from '@golink/shared';
import { useCan, useRestaurantAccess } from '@/auth/RestaurantAccess';

const FinancesPage = lazy(() => import('../finances/FinancesPage').then((m) => ({ default: m.FinancesPage })));
const ChiffreAffairesPage = lazy(() => import('../chiffre-affaires/ChiffreAffairesPage').then((m) => ({ default: m.ChiffreAffairesPage })));
const CommissionsTab = lazy(() => import('./CommissionsTab').then((m) => ({ default: m.CommissionsTab })));
const VirementsPage = lazy(() => import('../virements/VirementsPage').then((m) => ({ default: m.VirementsPage })));
const FacturesPage = lazy(() => import('../factures/FacturesPage').then((m) => ({ default: m.FacturesPage })));
const VersementsPage = lazy(() => import('../versements/VersementsPage').then((m) => ({ default: m.VersementsPage })));
const AbonnementPage = lazy(() => import('../abonnement/AbonnementPage').then((m) => ({ default: m.AbonnementPage })));

interface PaiementTab {
  id: string;
  label: string;
  icon: ReactNode;
  permission: RestaurantPermission;
  Component: ComponentType;
}

const TABS: PaiementTab[] = [
  { id: 'vue-ensemble', label: 'Vue d’ensemble', icon: <Wallet />, permission: 'finance.view', Component: FinancesPage },
  { id: 'etats-ca', label: 'États du CA', icon: <ChartColumn />, permission: 'finance.view', Component: ChiffreAffairesPage },
  { id: 'commissions', label: 'Commissions', icon: <BadgePercent />, permission: 'finance.view', Component: CommissionsTab },
  { id: 'virements', label: 'Virements', icon: <Banknote />, permission: 'finance.view', Component: VirementsPage },
  { id: 'factures', label: 'Factures', icon: <FileText />, permission: 'invoices.view', Component: FacturesPage },
  { id: 'versements', label: 'Compte de versement', icon: <Landmark />, permission: 'finance.view', Component: VersementsPage },
  { id: 'abonnement', label: 'Abonnement', icon: <Gem />, permission: 'finance.view', Component: AbonnementPage },
];

function TabFallback() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-8 w-64" />
      <Skeleton className="h-40 w-full" />
    </div>
  );
}

/** Hub « Paiement » : onglets agrégeant les rubriques financières existantes. */
export function PaiementPage() {
  useDocumentTitle('Paiement · Ciyou Eats Restaurant');
  const { restaurant } = useRestaurantAccess();
  const can = useCan();
  const [params, setParams] = useSearchParams();

  const visible = useMemo(() => TABS.filter((tab) => can(tab.permission)), [can]);
  const requested = params.get('onglet');
  const active = visible.find((tab) => tab.id === requested)?.id ?? visible[0]?.id ?? '';

  const setActive = (id: string) => {
    const next = new URLSearchParams(params);
    next.set('onglet', id);
    setParams(next, { replace: true });
  };

  if (visible.length === 0) {
    return (
      <PageContainer>
        <PageHeader eyebrow="Paiement" title="Paiement" description={`Reversements, factures et abonnement de ${restaurant.name}.`} />
        <AccessDeniedPanel description="Vous n’avez pas accès aux informations financières de cet établissement." />
      </PageContainer>
    );
  }

  return (
    <PageContainer wide>
      <PageHeader
        eyebrow="Paiement"
        title="Paiement"
        description={`Chiffre d’affaires, commissions, reversements et facturation de ${restaurant.name}.`}
      >
        <Tabs value={active} onValueChange={setActive}>
          <TabsList aria-label="Onglets du paiement">
            {visible.map((tab) => (
              <TabsTrigger key={tab.id} value={tab.id} icon={tab.icon}>
                {tab.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </PageHeader>

      <HubEmbedProvider>
        {visible.map((tab) =>
          tab.id === active ? (
            <Suspense key={tab.id} fallback={<TabFallback />}>
              <tab.Component />
            </Suspense>
          ) : null,
        )}
      </HubEmbedProvider>
    </PageContainer>
  );
}
