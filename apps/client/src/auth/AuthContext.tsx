// Session Firebase Auth de l'app client. Même principe que
// `packages/web/src/auth/AuthProvider.tsx` (back-offices) : écoute
// `onIdTokenChanged`, expose l'utilisateur et les actions de session. La
// persistance (rester connecté après fermeture de l'app) est assurée par
// `getReactNativePersistence(AsyncStorage)` dans `lib/firebase.ts` — il n'y a
// pas de case à cocher « se souvenir de moi » côté mobile (toujours persistée,
// comme les apps mobiles usuelles).
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  createUserWithEmailAndPassword,
  onIdTokenChanged,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
  updateProfile,
  type User,
} from '@firebase/auth';
import { auth } from '../lib/firebase';

export type AuthStatus = 'loading' | 'signed-out' | 'signed-in';

export interface AuthContextValue {
  status: AuthStatus;
  user: User | null;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (params: { firstName: string; lastName: string; email: string; password: string }) => Promise<void>;
  signOut: () => Promise<void>;
  sendPasswordReset: (email: string) => Promise<void>;
  resendVerificationEmail: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ status: AuthStatus; user: User | null }>({ status: 'loading', user: null });

  useEffect(
    () =>
      onIdTokenChanged(auth, (user) => {
        setState({ status: user ? 'signed-in' : 'signed-out', user });
      }),
    [],
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      status: state.status,
      user: state.user,
      async signIn(email, password) {
        await signInWithEmailAndPassword(auth, email.trim(), password);
      },
      async signUp({ firstName, lastName, email, password }) {
        const credential = await createUserWithEmailAndPassword(auth, email.trim(), password);
        const displayName = `${firstName.trim()} ${lastName.trim()}`.trim();
        if (displayName) await updateProfile(credential.user, { displayName });
        // Le profil `users/{uid}` (rôle « client » par défaut) est provisionné
        // côté serveur par le déclencheur `onUserCreate` (functions/src/core/users.ts) :
        // l'app n'écrit jamais elle-même ce document.
        await sendEmailVerification(credential.user).catch(() => undefined);
      },
      async signOut() {
        await firebaseSignOut(auth);
      },
      async sendPasswordReset(email) {
        await sendPasswordResetEmail(auth, email.trim());
      },
      async resendVerificationEmail() {
        if (auth.currentUser) await sendEmailVerification(auth.currentUser);
      },
    }),
    [state],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth doit être utilisé sous <AuthProvider>.');
  return value;
}
