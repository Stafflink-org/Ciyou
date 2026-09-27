import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  browserLocalPersistence,
  browserSessionPersistence,
  onIdTokenChanged,
  sendPasswordResetEmail,
  setPersistence,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
  type Auth,
  type User,
} from 'firebase/auth';
import { ADMIN_ROLES, STAFF_ROLES, USER_ROLES, type AdminRole, type AuthClaims, type StaffRole, type UserRole } from '@golink/shared';

export type AuthStatus = 'loading' | 'signed-out' | 'signed-in';

export interface AuthContextValue {
  auth: Auth;
  status: AuthStatus;
  user: User | null;
  /** Custom claims du jeton courant (rôle, établissements…). */
  claims: AuthClaims;
  /** `remember` : session conservée après fermeture du navigateur. */
  signIn: (email: string, password: string, remember: boolean) => Promise<void>;
  signOut: () => Promise<void>;
  /** E-mail de réinitialisation ; le lien ramène vers `continuePath` de l'application. */
  sendPasswordReset: (email: string, continuePath?: string) => Promise<void>;
  /** Force le rafraîchissement du jeton (après un changement de rôle côté serveur). */
  refreshClaims: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function parseClaims(raw: Record<string, unknown>): AuthClaims {
  const claims: AuthClaims = {};
  if (typeof raw.role === 'string' && (USER_ROLES as readonly string[]).includes(raw.role)) claims.role = raw.role as UserRole;
  if (raw.restaurants && typeof raw.restaurants === 'object' && !Array.isArray(raw.restaurants)) {
    claims.restaurants = Object.fromEntries(
      Object.entries(raw.restaurants as Record<string, unknown>).filter(
        (entry): entry is [string, StaffRole] => typeof entry[1] === 'string' && (STAFF_ROLES as readonly string[]).includes(entry[1]),
      ),
    );
  }
  if (raw.restaurantsTruncated === true) claims.restaurantsTruncated = true;
  if (typeof raw.adminRole === 'string' && (ADMIN_ROLES as readonly string[]).includes(raw.adminRole)) {
    claims.adminRole = raw.adminRole as AdminRole;
  }
  return claims;
}

/** Session Firebase Auth et custom claims, mis à jour à chaque renouvellement du jeton. */
export function AuthProvider({ auth, children }: { auth: Auth; children: ReactNode }) {
  const [state, setState] = useState<{ status: AuthStatus; user: User | null; claims: AuthClaims }>({
    status: 'loading',
    user: null,
    claims: {},
  });

  useEffect(
    () =>
      onIdTokenChanged(auth, async (user) => {
        if (!user) {
          setState({ status: 'signed-out', user: null, claims: {} });
          return;
        }
        try {
          const token = await user.getIdTokenResult();
          setState({ status: 'signed-in', user, claims: parseClaims(token.claims) });
        } catch {
          // Jeton illisible (compte supprimé, réseau) : on repart d'une session vide.
          setState({ status: 'signed-out', user: null, claims: {} });
        }
      }),
    [auth],
  );

  const signIn = useCallback(
    async (email: string, password: string, remember: boolean) => {
      await setPersistence(auth, remember ? browserLocalPersistence : browserSessionPersistence);
      await signInWithEmailAndPassword(auth, email.trim(), password);
    },
    [auth],
  );

  const signOut = useCallback(() => firebaseSignOut(auth), [auth]);

  const sendPasswordReset = useCallback(
    (email: string, continuePath = '/connexion') =>
      sendPasswordResetEmail(auth, email.trim(), { url: new URL(continuePath, window.location.origin).toString() }),
    [auth],
  );

  const refreshClaims = useCallback(async () => {
    await auth.currentUser?.getIdToken(true);
  }, [auth]);

  const value = useMemo<AuthContextValue>(
    () => ({ auth, ...state, signIn, signOut, sendPasswordReset, refreshClaims }),
    [auth, state, signIn, signOut, sendPasswordReset, refreshClaims],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth doit être utilisé sous <AuthProvider>.');
  return value;
}

/** Utilisateur connecté (à utiliser sous une route protégée). */
export function useCurrentUser(): User {
  const { user } = useAuth();
  if (!user) throw new Error('useCurrentUser doit être utilisé sous une route protégée.');
  return user;
}
