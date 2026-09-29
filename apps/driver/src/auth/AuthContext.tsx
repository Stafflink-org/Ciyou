// Session Firebase Auth de l'app livreur. Même principe que
// apps/client/src/auth/AuthContext.tsx (écoute `onIdTokenChanged`, persistance
// `getReactNativePersistence(AsyncStorage)` dans `lib/firebase.ts`), avec deux
// différences assumées pour ce lot :
//  - Pas d'inscription en libre-service ici : la validation d'un livreur est
//    manuelle (docs/DECISIONS_CLIENT.md « Validation des livreurs : à la main »)
//    et aucune Cloud Function d'inscription livreur n'existe encore côté
//    serveur (recherché dans functions/src : absent). Seule la connexion à un
//    compte déjà créé est couverte par ce lot ; l'écran d'inscription viendra
//    avec la Cloud Function serveur correspondante (lot suivant, documents +
//    validation).
//  - Un compte qui se connecte mais dont les claims Firebase ne portent pas
//    `role: 'driver'` est refusé et déconnecté aussitôt (évite qu'un client se
//    retrouve dans l'app livreur avec une session à moitié fonctionnelle).
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { onIdTokenChanged, sendPasswordResetEmail, signInWithEmailAndPassword, signOut as firebaseSignOut, type User } from '@firebase/auth';
import { auth } from '../lib/firebase';

export type AuthStatus = 'loading' | 'signed-out' | 'signed-in';

export interface AuthContextValue {
  status: AuthStatus;
  user: User | null;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  sendPasswordReset: (email: string) => Promise<void>;
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
        const credential = await signInWithEmailAndPassword(auth, email.trim(), password);
        const { claims } = await credential.user.getIdTokenResult();
        if (claims.role !== 'driver') {
          await firebaseSignOut(auth);
          throw new Error('driver/wrong-role');
        }
      },
      async signOut() {
        await firebaseSignOut(auth);
      },
      async sendPasswordReset(email) {
        await sendPasswordResetEmail(auth, email.trim());
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
