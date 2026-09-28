/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_STRIPE_PUBLISHABLE_KEY?: string;
  readonly VITE_GOOGLE_MAPS_API_KEY?: string;
  /** « true » : Auth, Firestore, Functions et Storage pointent vers les émulateurs locaux. */
  readonly VITE_FIREBASE_EMULATORS?: string;
  /** Adresse du back-office restaurant (« Voir comme le restaurant »). */
  readonly VITE_RESTAURANT_APP_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
