// Secrets Secret Manager (firebase functions:secrets:set NOM). Aucune valeur en clair
// dans le dépôt ; chaque fonction déclare ceux qu'elle utilise dans ses options.
import { defineSecret } from 'firebase-functions/params';

export const BREVO_API_KEY = defineSecret('BREVO_API_KEY');
export const BREVO_SENDER_EMAIL = defineSecret('BREVO_SENDER_EMAIL');
export const STRIPE_SECRET_KEY = defineSecret('STRIPE_SECRET_KEY');
/** Secret de signature du point de terminaison webhook Stripe (whsec_…). */
export const STRIPE_WEBHOOK_SECRET = defineSecret('STRIPE_WEBHOOK_SECRET');

/** Secrets nécessaires à l'envoi d'e-mails. */
export const EMAIL_SECRETS = [BREVO_API_KEY, BREVO_SENDER_EMAIL];
