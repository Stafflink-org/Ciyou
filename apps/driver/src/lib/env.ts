// Variables d'environnement publiques de l'app livreur (EXPO_PUBLIC_*, lues par
// Expo depuis le .env.local à la racine du dépôt — même mécanisme que
// apps/client/src/lib/env.ts).
export const env = {
  useEmulators: process.env.EXPO_PUBLIC_FIREBASE_EMULATORS === 'true',
} as const;
