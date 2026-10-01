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

/**
 * Version de l'app (§30 « Versions des applications »), à faire évoluer avec `app.json::expo.version`
 * à chaque publication. `placeOrder` (`functions/src/orders/place.ts`) refuse la commande si elle
 * est inférieure à `appVersions/client.minimumVersion` — un contrôle déjà réel côté serveur mais
 * jusqu'ici sans effet car aucun appel de `placeOrder` ne transmettait cette version.
 */
export const APP_VERSION = '1.0.0';
