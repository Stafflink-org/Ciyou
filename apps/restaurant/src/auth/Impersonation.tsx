// « Voir comme le restaurant » (super admin) : un administrateur Ciyou Eats ouvre
// l'espace d'un établissement en lecture seule via ?voir-comme=<id>, à condition
// qu'une session ouverte par la Cloud Function startImpersonation soit active.
// Les droits fournis ne contiennent que des permissions de consultation.
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Outlet } from 'react-router';
import { collection, query, where } from 'firebase/firestore';
import { Eye } from 'lucide-react';
import { Button, formatTime } from '@golink/ui';
import {
  COLLECTIONS,
  paths,
  type ImpersonationSession,
  type Restaurant,
  type RestaurantMember,
  type RestaurantPermission,
  type WithId,
} from '@golink/shared';
import { AccessDeniedScreen, FullScreenLoader, PermissionProvider, toMillis, useAuth } from '@golink/web';
import { db } from '@/lib/firebase';
import { callFunction, docAt, useCollection, useDoc, useMutation } from '@/lib/firestore';
import { EntitlementsGate, RestaurantAccessContext, RestaurantAccessGate, type RestaurantAccess } from './RestaurantAccess';

const STORAGE_KEY = 'golink:restaurant:voir-comme';

/** Permissions de consultation accordées pendant une session « voir comme ». */
export const READ_ONLY_PERMISSIONS: readonly RestaurantPermission[] = [
  'dashboard.view',
  'orders.view',
  'menu.view',
  'customers.view',
  'finance.view',
  'invoices.view',
  'team.view',
  'planning.view',
  'payroll.view',
  'tasks.view',
  'documents.view',
];

// Le paramètre de l'URL est mémorisé pour l'onglet (il survit à la connexion).
(() => {
  try {
    const target = new URLSearchParams(window.location.search).get('voir-comme');
    if (target && /^[A-Za-z0-9_-]{1,128}$/.test(target)) window.sessionStorage.setItem(STORAGE_KEY, target);
  } catch {
    // Stockage indisponible : la session « voir comme » ne sera pas proposée.
  }
})();

function storedTarget(): string | null {
  try {
    return window.sessionStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function clearTarget() {
  try {
    window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // rien à nettoyer
  }
}

const endImpersonation = callFunction<{ sessionId: string }, { alreadyEnded: boolean }>('endImpersonation');

function useClock(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 20_000);
    return () => window.clearInterval(timer);
  }, []);
  return now;
}

interface ActiveImpersonation {
  session: WithId<ImpersonationSession>;
  restaurant: WithId<Restaurant>;
}

const ImpersonationContext = createContext<ActiveImpersonation | null>(null);

/** Session « voir comme » en cours dans cet onglet (null sinon). */
export function useImpersonation(): ActiveImpersonation | null {
  return useContext(ImpersonationContext);
}

function ImpersonatedAccess({ restaurantId, children }: { restaurantId: string; children?: ReactNode }) {
  const { user, signOut } = useAuth();
  const now = useClock();
  const sessionsQuery = useMemo(
    () => (user ? query(collection(db, COLLECTIONS.impersonationSessions), where('adminId', '==', user.uid), where('endedAt', '==', null)) : null),
    [user],
  );
  const sessions = useCollection<ImpersonationSession>(sessionsQuery);
  const session = sessions.data.find((s) => s.restaurantId === restaurantId && (toMillis(s.expiresAt) ?? 0) > now) ?? null;
  const restaurantState = useDoc<Restaurant>(session ? docAt(paths.restaurant(restaurantId)) : null);
  const restaurant = restaurantState.data;

  const value = useMemo<RestaurantAccess | null>(() => {
    if (!session || !restaurant || !user) return null;
    const member: WithId<RestaurantMember> = {
      id: user.uid,
      uid: user.uid,
      restaurantId,
      displayName: session.adminName ?? user.displayName ?? 'Équipe Ciyou Eats',
      email: user.email ?? '',
      role: 'custom',
      permissions: [...READ_ONLY_PERMISSIONS],
      active: true,
      onDuty: false,
      invitedBy: session.adminId,
      invitedAt: session.startedAt,
    };
    const can = (permission: RestaurantPermission) => READ_ONLY_PERMISSIONS.includes(permission);
    return { restaurants: [restaurant], roles: { [restaurantId]: 'custom' }, restaurantId, restaurant, member, setRestaurantId: () => undefined, can };
  }, [session, restaurant, user, restaurantId]);

  const active = useMemo(() => (session && restaurant ? { session, restaurant } : null), [session, restaurant]);

  if (sessions.loading || (session && restaurantState.loading)) return <FullScreenLoader label="Ouverture en lecture seule" />;
  if (!value) {
    return (
      <AccessDeniedScreen
        caption="Restaurant"
        title="Session « voir comme » inactive"
        description="Cette session est terminée, expirée ou n’a pas été ouverte. Lancez « Voir comme le restaurant » depuis la fiche du commerce dans le super admin."
        email={user?.email}
        onSignOut={() => {
          clearTarget();
          void signOut();
        }}
      />
    );
  }
  return (
    <ImpersonationContext.Provider value={active}>
      <RestaurantAccessContext.Provider value={value}>
        <PermissionProvider can={(permission) => value.can(permission as RestaurantPermission)}>
          <EntitlementsGate>{children ?? <Outlet />}</EntitlementsGate>
        </PermissionProvider>
      </RestaurantAccessContext.Provider>
    </ImpersonationContext.Provider>
  );
}

/**
 * Garde des routes connectées : membre du restaurant (cas normal) ou
 * administrateur Ciyou Eats en session « voir comme » (lecture seule).
 */
export function AccessGate({ children }: { children?: ReactNode }) {
  const { claims } = useAuth();
  const target = storedTarget();
  if (claims.role === 'admin' && target) return <ImpersonatedAccess restaurantId={target}>{children}</ImpersonatedAccess>;
  return <RestaurantAccessGate>{children}</RestaurantAccessGate>;
}

/** Bandeau affiché pendant une session « voir comme ». */
export function ImpersonationBanner() {
  const active = useImpersonation();
  const end = useMutation(endImpersonation, { success: 'Session « voir comme » terminée' });
  if (!active) return null;
  const expires = toMillis(active.session.expiresAt);
  return (
    <div role="status" className="tone-plum border-b border-(--tone-border) bg-(--tone-bg)">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5 sm:px-6 lg:px-8">
        <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-(--tone-solid) text-white">
          <Eye className="size-4" />
        </span>
        <p className="min-w-0 flex-1 text-sm text-(--tone-fg)">
          <strong className="font-semibold">Lecture seule</strong> · équipe Ciyou Eats sur l’espace de {active.restaurant.name}
          {expires ? ` · fin à ${formatTime(expires)}` : ''}.
          <span className="hidden md:inline"> Aucune modification n’est possible ; l’accès est tracé au journal d’audit.</span>
        </p>
        <Button
          size="sm"
          variant="secondary"
          loading={end.loading}
          onClick={() =>
            void end.mutate({ sessionId: active.session.id }).then((r) => {
              if (r) {
                clearTarget();
                window.close();
              }
            })
          }
        >
          Terminer
        </Button>
      </div>
    </div>
  );
}
