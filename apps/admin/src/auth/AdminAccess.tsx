// Droits de l'administrateur connecté : custom claim `role = admin` puis document
// admins/{uid} (rôle, permissions résolues, périmètre géographique), comme dans
// les règles de sécurité. Suit aussi la session (cahier §27) : enregistrement à
// l'ouverture puis toutes les 2 minutes, déconnexion si révoquée ou expirée, et
// double authentification bloquante quand elle est exigée.
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Outlet } from 'react-router';
import { adminHasPermission, paths, type AdminPermission, type AdminUser, type WithId } from '@golink/shared';
import { AccessDeniedScreen, FullScreenLoader, PermissionProvider, useAuth, useTranslation } from '@golink/web';
import { docAt, useDoc } from '@/lib/firestore';
import { trackAdminSession } from '@/features/a-plateforme-securite/api';
import { MfaChallengeScreen } from '@/features/a-plateforme-securite/MfaChallengeScreen';

export interface AdminAccess {
  admin: WithId<AdminUser>;
  can: (permission: AdminPermission) => boolean;
}

const AdminAccessContext = createContext<AdminAccess | null>(null);

export const CAPTION = 'Super admin';

const HEARTBEAT_MS = 2 * 60 * 1000;

interface SessionState {
  mfaRequired: boolean;
  mfaVerified: boolean;
  revoked: boolean;
  expired: boolean;
}

/** Enregistre la session au montage puis toutes les 2 minutes ; déconnecte si révoquée ou expirée. */
function useAdminSessionTracking(active: boolean, onRevoked: () => void): SessionState | null {
  const [state, setState] = useState<SessionState | null>(null);
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    const beat = async () => {
      try {
        const result = await trackAdminSession();
        if (cancelled) return;
        if (result.revoked || result.expired) {
          onRevoked();
          return;
        }
        setState({ mfaRequired: result.mfaRequired, mfaVerified: result.mfaVerified, revoked: result.revoked, expired: result.expired });
      } catch {
        // Session non trackée (hors ligne, etc.) : ne bloque pas l'accès.
      }
    };
    void beat();
    const interval = setInterval(() => void beat(), HEARTBEAT_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [active, onRevoked]);
  return state;
}

/** Garde des routes connectées : réservé aux membres actifs de l'équipe interne. */
export function AdminAccessGate({ children }: { children?: ReactNode }) {
  const { user, claims, signOut } = useAuth();
  const { t } = useTranslation('auth');
  const isAdmin = claims.role === 'admin';
  const state = useDoc<AdminUser>(isAdmin && user ? docAt(paths.admin(user.uid)) : null);
  const admin = state.data;

  const can = useCallback((permission: AdminPermission) => Boolean(admin && adminHasPermission(admin, permission)), [admin]);
  const value = useMemo<AdminAccess | null>(() => (admin?.active ? { admin, can } : null), [admin, can]);
  const handleRevoked = useCallback(() => void signOut(), [signOut]);
  const session = useAdminSessionTracking(Boolean(value), handleRevoked);
  const [justVerified, setJustVerified] = useState(false);

  if (isAdmin && state.loading) return <FullScreenLoader label={t('access.checking')} />;

  if (!value) {
    return (
      <AccessDeniedScreen
        caption={t('caption')}
        description={isAdmin ? t('access.disabled') : t('access.reserved')}
        email={user?.email}
        onSignOut={() => void signOut()}
      />
    );
  }

  if (session?.mfaRequired && !session.mfaVerified && !justVerified) {
    return <MfaChallengeScreen admin={value.admin} onVerified={() => setJustVerified(true)} onSignOut={() => void signOut()} />;
  }

  return (
    <AdminAccessContext.Provider value={value}>
      <PermissionProvider can={(permission) => can(permission as AdminPermission)}>{children ?? <Outlet />}</PermissionProvider>
    </AdminAccessContext.Provider>
  );
}

/** Administrateur connecté et ses droits (sous les routes connectées). */
export function useAdminAccess(): AdminAccess {
  const value = useContext(AdminAccessContext);
  if (!value) throw new Error('useAdminAccess doit être utilisé sous <AdminAccessGate>.');
  return value;
}

/** Raccourci : vérification d'une permission de l'administrateur connecté. */
export function useCan(): (permission: AdminPermission) => boolean {
  return useAdminAccess().can;
}
