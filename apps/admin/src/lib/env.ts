// Variables d'environnement publiques (VITE_*), lues depuis le .env.local à la racine du dépôt.
export const env = {
  stripePublishableKey: import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY ?? '',
  googleMapsApiKey: import.meta.env.VITE_GOOGLE_MAPS_API_KEY ?? '',
  useEmulators: import.meta.env.VITE_FIREBASE_EMULATORS === 'true',
  restaurantAppUrl: import.meta.env.VITE_RESTAURANT_APP_URL ?? 'http://localhost:5173',
} as const;
