// Variables d'environnement publiques de l'app client (EXPO_PUBLIC_*). Contrairement
// aux VITE_* des back-offices web, Expo (@expo/env) ne charge les .env* que depuis la
// racine du PROJET EXPO (apps/client/.env.local), pas depuis la racine du monorepo :
// chaque variable doit donc être dupliquée dans apps/client/.env.local (voir ce fichier,
// piège vérifié en pratique lors du câblage du paiement carte, §10 CONTRAT_MODULES.md).
export const env = {
  useEmulators: process.env.EXPO_PUBLIC_FIREBASE_EMULATORS === 'true',
  /** Clé publiable Stripe (même compte de test que les back-offices restaurant/admin). */
  stripePublishableKey: process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? '',
} as const;
