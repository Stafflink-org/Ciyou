// Adresses des applications utilisées dans les liens envoyés par e-mail.
// Surchargeables par variables d'environnement des fonctions (fichier functions/.env).

export const APP_URLS = {
  admin: process.env.ADMIN_APP_URL ?? 'http://localhost:5174',
  restaurant: process.env.RESTAURANT_APP_URL ?? 'http://localhost:5173',
  driver: process.env.DRIVER_APP_URL ?? 'http://localhost:8081',
} as const;

export const PLATFORM_NAME = 'GoLink';
export const EMAIL_SENDER_NAME = 'GoLink';
