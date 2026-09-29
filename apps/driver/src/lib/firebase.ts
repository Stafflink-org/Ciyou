// Initialisation Firebase de l'app livreur (mobile). Même projet et mêmes
// identifiants publics que l'app client et les back-offices : golink-9f16d.
// Copie fidèle de apps/client/src/lib/firebase.ts (même contrainte React
// Native sur `@firebase/auth`, voir ce fichier et `types/firebase-auth-rn.d.ts`).
import { type FirebaseApp, getApps, initializeApp } from 'firebase/app';
import { getFirestore, connectFirestoreEmulator } from 'firebase/firestore';
import { getStorage, connectStorageEmulator } from 'firebase/storage';
import { getFunctions, connectFunctionsEmulator } from 'firebase/functions';
import { getAuth, initializeAuth, getReactNativePersistence, connectAuthEmulator, type Auth } from '@firebase/auth';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { FIREBASE_REGION } from '@golink/shared';
import { env } from './env';

// Configuration publique du client Firebase (non secrète, identique aux back-offices).
const firebaseConfig = {
  apiKey: 'AIzaSyAYQ_TzyCEK0_Iw5TnSiH8jbFbOFKZYNoM',
  authDomain: 'golink-9f16d.firebaseapp.com',
  projectId: 'golink-9f16d',
  storageBucket: 'golink-9f16d.firebasestorage.app',
  messagingSenderId: '683198090102',
  appId: '1:683198090102:web:3640bfa24dd0d325910857',
};

export const app: FirebaseApp = getApps()[0] ?? initializeApp(firebaseConfig);

// `initializeAuth` ne peut être appelé qu'une seule fois par app Firebase (utile
// en recharge rapide Expo / Fast Refresh, qui ré-exécute ce module : on retombe
// alors sur l'instance déjà créée plutôt que de planter).
let authInstance: Auth;
try {
  authInstance = initializeAuth(app, { persistence: getReactNativePersistence(AsyncStorage) });
} catch {
  authInstance = getAuth(app);
}
export const auth: Auth = authInstance;

export const db = getFirestore(app);
export const storage = getStorage(app);
export const functions = getFunctions(app, FIREBASE_REGION);

// Développement local uniquement (émulateurs Firebase). La consigne de la tâche
// est de tester sur la vraie base golink-9f16d : ce bloc reste désactivé par défaut.
if (env.useEmulators) {
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
  connectStorageEmulator(storage, '127.0.0.1', 9199);
  connectFunctionsEmulator(functions, '127.0.0.1', 5001);
}
