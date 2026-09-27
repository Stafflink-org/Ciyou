import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { Building, ImageIcon, MapPin, Store } from 'lucide-react';
import { PageContainer, PageHeader, StatusPill, Tabs, TabsContent, TabsList, TabsTrigger, type Tone } from '@golink/ui';
import { RESTAURANT_STATUS_LABELS, type RestaurantStatus } from '@golink/shared';
import { useRestaurantAccess } from '@/auth/RestaurantAccess';
import { AddressTab } from './AddressTab';
import { LegalTab } from './LegalTab';
import { ProfileTab } from './ProfileTab';
import { VisualsTab } from './VisualsTab';

const TABS = [
  { id: 'profil', label: 'Profil', icon: <Store /> },
  { id: 'visuels', label: 'Visuels', icon: <ImageIcon /> },
  { id: 'adresse', label: 'Adresse', icon: <MapPin /> },
  { id: 'legal', label: 'Informations légales', icon: <Building /> },
] as const;

type TabId = (typeof TABS)[number]['id'];

const STATUS_TONES: Record<RestaurantStatus, Tone> = {
  onboarding: 'info',
  active: 'success',
  paused: 'amber',
  suspended: 'danger',
  closed: 'neutral',
};

/** Fiche de l'établissement : profil public, visuels, adresse géolocalisée, identité légale. */
export function EtablissementPage() {
  const { restaurant, restaurantId } = useRestaurantAccess();
  const [params, setParams] = useSearchParams();
  const current = (TABS.find((t) => t.id === params.get('onglet'))?.id ?? 'profil') as TabId;

  // La carte n'est chargée qu'à la première ouverture de l'onglet, puis conservée.
  const [mapVisited, setMapVisited] = useState(current === 'adresse');
  useEffect(() => {
    if (current === 'adresse') setMapVisited(true);
  }, [current]);

  return (
    <PageContainer>
      <PageHeader
        eyebrow="Configuration"
        title="Établissement"
        description="Les informations que vos clients voient sur GoLink, et celles dont nous avons besoin pour facturer et vous reverser vos ventes."
        actions={
          <StatusPill tone={STATUS_TONES[restaurant.status]} pulse={restaurant.status === 'active'}>
            {RESTAURANT_STATUS_LABELS[restaurant.status]}
          </StatusPill>
        }
      />
      <Tabs
        value={current}
        onValueChange={(value) => {
          const next = new URLSearchParams(params);
          if (value === 'profil') next.delete('onglet');
          else next.set('onglet', value);
          setParams(next, { replace: true });
        }}
      >
        <TabsList aria-label="Sections de la fiche">
          {TABS.map((tab) => (
            <TabsTrigger key={tab.id} value={tab.id} icon={tab.icon}>
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>
        {/* Onglets conservés montés : un brouillon n'est pas perdu en changeant d'onglet. */}
        <TabsContent value="profil" forceMount className="pt-6 data-[state=inactive]:hidden">
          <ProfileTab key={restaurantId} active={current === 'profil'} />
        </TabsContent>
        <TabsContent value="visuels" forceMount className="pt-6 data-[state=inactive]:hidden">
          <VisualsTab key={restaurantId} />
        </TabsContent>
        <TabsContent value="adresse" forceMount className="pt-6 data-[state=inactive]:hidden">
          {mapVisited && <AddressTab key={restaurantId} active={current === 'adresse'} />}
        </TabsContent>
        <TabsContent value="legal" forceMount className="pt-6 data-[state=inactive]:hidden">
          <LegalTab key={restaurantId} active={current === 'legal'} />
        </TabsContent>
      </Tabs>
    </PageContainer>
  );
}
