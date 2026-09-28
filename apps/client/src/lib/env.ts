// Variables d'environnement publiques de l'app client (EXPO_PUBLIC_*, lues par
// Expo depuis le .env.local à la racine du dépôt — même mécanisme que les
// VITE_* des back-offices web, adapté à Expo).
export const env = {
  useEmulators: process.env.EXPO_PUBLIC_FIREBASE_EMULATORS === 'true',
} as const;
