// Établissement actif et droits du membre connecté. Les établissements accessibles
// viennent des custom claims (`restaurants`), les permissions du document
// restaurants/{rid}/members/{uid}, comme dans les règles de sécurité.
import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react';
import { Outlet } from 'react-router';
import { Store } from 'lucide-react';
import { Button } from '@golink/ui';
import {
  memberHasPermission,
  paths,
  type Restaurant,
  type RestaurantMember,
  type RestaurantPermission,
  type StaffRole,
  type WithId,
} from '@golink/shared';
import { AccessDeniedScreen, FeatureProvider, FullScreenLoader, PermissionProvider, useAuth, usePersistentState } from '@golink/web';
import { docAt, useDoc, useDocs } from '@/lib/firestore';
import { useEntitlements } from './useEntitlements';

export interface RestaurantAccess {
  /** Établissements accessibles, triés par nom. */
  restaurants: WithId<Restaurant>[];
  /** Rôle du compte dans chaque établissement (claims). */
  roles: Record<string, StaffRole>;
  restaurantId: string;
  restaurant: WithId<Restaurant>;
  member: WithId<RestaurantMember>;
  setRestaurantId: (id: string) => void;
  can: (permission: RestaurantPermission) => boolean;
}

/** Exporté pour la session « voir comme » du super admin (auth/Impersonation.tsx). */
export const RestaurantAccessContext = createContext<RestaurantAccess | null>(null);

/** Clé de stockage du dernier établissement ouvert (aussi utilisée par le lien d'invitation). */
export function activeRestaurantKey(uid: string): string {
  return `golink:restaurant:${uid}`;
}

const CAPTION = 'Restaurant';

/**
 * Garde des routes connectées : vérifie le rattachement à au moins un établissement
 * et l'accès actif du membre, puis fournit l'établissement courant et ses droits.
 */
export function RestaurantAccessGate({ children }: { children?: ReactNode }) {
  const { user, claims, signOut } = useAuth();
  const uid = user?.uid ?? '';
  const roles = useMemo(() => claims.restaurants ?? {}, [claims.restaurants]);
  const ids = useMemo(() => Object.keys(roles), [roles]);
  const [storedId, setStoredId] = usePersistentState<string | null>(activeRestaurantKey(uid), null);
  const restaurantId = storedId && ids.includes(storedId) ? storedId : (ids[0] ?? '');

  const refs = useMemo(() => ids.map((id) => docAt(paths.restaurant(id))), [ids]);
  const list = useDocs<Restaurant>(refs);
  const memberState = useDoc<RestaurantMember>(restaurantId && uid ? docAt(paths.member(restaurantId, uid)) : null);

  const restaurants = useMemo(
    () => [...list.data].sort((a, b) => a.name.localeCompare(b.name, 'fr')),
    [list.data],
  );
  const restaurant = restaurants.find((item) => item.id === restaurantId) ?? null;
  const member = memberState.data;

  const setRestaurantId = useCallback((id: string) => setStoredId(id), [setStoredId]);
  const can = useCallback(
    (permission: RestaurantPermission) => Boolean(member && memberHasPermission(member, permission)),
    [member],
  );

  const value = useMemo<RestaurantAccess | null>(
    () =>
      restaurant && member?.active
        ? { restaurants, roles, restaurantId, restaurant, member, setRestaurantId, can }
        : null,
    [restaurants, roles, restaurantId, restaurant, member, setRestaurantId, can],
  );

  const signOutAction = () => void signOut();

  if (ids.length === 0) {
    return (
      <AccessDeniedScreen
        caption={CAPTION}
        title="Aucun établissement rattaché"
        description="Ce compte n’est membre d’aucun restaurant Ciyou Eats. Demandez au responsable de votre établissement de vous inviter depuis la rubrique Équipe."
        email={user?.email}
        onSignOut={signOutAction}
      />
    );
  }

  if (list.loading || memberState.loading) return <FullScreenLoader label="Ouverture de votre établissement" />;

  if (!value) {
    const others = restaurants.filter((item) => item.id !== restaurantId);
    return (
      <AccessDeniedScreen
        caption={CAPTION}
        title="Accès à cet établissement indisponible"
        description={
          restaurant
            ? `Votre accès à ${restaurant.name} est désactivé ou en cours de configuration.`
            : 'Cet établissement est introuvable ou votre accès a été retiré.'
        }
        email={user?.email}
        onSignOut={signOutAction}
        actions={others.slice(0, 3).map((item) => (
          <Button key={item.id} variant="secondary" size="lg" leftIcon={<Store />} onClick={() => setRestaurantId(item.id)}>
            {item.name}
          </Button>
        ))}
      />
    );
  }

  return (
    <RestaurantAccessContext.Provider value={value}>
      <PermissionProvider can={(permission) => can(permission as RestaurantPermission)}>
        <EntitlementsGate>{children ?? <Outlet />}</EntitlementsGate>
      </PermissionProvider>
    </RestaurantAccessContext.Provider>
  );
}

/** Expose la formule active de l'établissement (`useEntitlements`) au menu (`Shell.tsx`) et aux routes des modules. */
export function EntitlementsGate({ children }: { children: ReactNode }) {
  const { hasFeature } = useEntitlements();
  return <FeatureProvider hasFeature={(feature) => hasFeature(feature as Parameters<typeof hasFeature>[0])}>{children}</FeatureProvider>;
}

/** Établissement actif, membre connecté et droits (sous les routes connectées). */
export function useRestaurantAccess(): RestaurantAccess {
  const value = useContext(RestaurantAccessContext);
  if (!value) throw new Error('useRestaurantAccess doit être utilisé sous <RestaurantAccessGate>.');
  return value;
}

/** Raccourci : établissement actif. */
export function useActiveRestaurant(): WithId<Restaurant> {
  return useRestaurantAccess().restaurant;
}

/** Raccourci : vérification d'une permission du membre connecté. */
export function useCan(): (permission: RestaurantPermission) => boolean {
  return useRestaurantAccess().can;
}
