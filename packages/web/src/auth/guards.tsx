import { createContext, useContext, type ReactNode } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router';
import { FullScreenLoader } from '../screens/FullScreenLoader';
import { useAuth } from './AuthProvider';

/** Adresse demandée avant la redirection vers la connexion. */
export interface RedirectState {
  from?: string;
}

/** Route protégée : redirige vers la connexion si aucune session n'est ouverte. */
export function RequireAuth({ loginPath = '/connexion', children }: { loginPath?: string; children?: ReactNode }) {
  const { status } = useAuth();
  const location = useLocation();
  if (status === 'loading') return <FullScreenLoader />;
  if (status === 'signed-out') {
    const from = `${location.pathname}${location.search}${location.hash}`;
    return <Navigate to={loginPath} replace state={{ from } satisfies RedirectState} />;
  }
  return children ?? <Outlet />;
}

/** Pages publiques (connexion…) : renvoie vers l'application si une session est ouverte. */
export function PublicOnly({ home = '/', children }: { home?: string; children?: ReactNode }) {
  const { status } = useAuth();
  const location = useLocation();
  if (status === 'loading') return <FullScreenLoader />;
  if (status === 'signed-in') {
    const from = (location.state as RedirectState | null)?.from;
    return <Navigate to={from && from.startsWith('/') ? from : home} replace />;
  }
  return children ?? <Outlet />;
}

/* ------------------------------------------------------------ Permissions */

type Check = (permission: string) => boolean;

const PermissionContext = createContext<Check>(() => false);

/**
 * Fournit la vérification des droits de l'utilisateur courant (membre du
 * restaurant ou administrateur). Chaque application la type avec ses permissions.
 */
export function PermissionProvider({ can, children }: { can: Check; children: ReactNode }) {
  return <PermissionContext.Provider value={can}>{children}</PermissionContext.Provider>;
}

/** Fonction `can(permission)` de l'utilisateur courant. */
export function usePermissionCheck<P extends string = string>(): (permission: P) => boolean {
  return useContext(PermissionContext);
}

/** Affiche `children` seulement si l'utilisateur a la permission. */
export function Can({ permission, children, fallback = null }: { permission: string; children: ReactNode; fallback?: ReactNode }) {
  const can = useContext(PermissionContext);
  return <>{can(permission) ? children : fallback}</>;
}
