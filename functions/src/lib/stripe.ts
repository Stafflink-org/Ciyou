// Client Stripe (mode déterminé par la clé : test ou live). Les fonctions qui
// l'utilisent doivent déclarer STRIPE_SECRET_KEY dans leurs options.
import Stripe from 'stripe';
import { STRIPE_SECRET_KEY } from './secrets';

let client: Stripe | null = null;

export function getStripe(): Stripe {
  client ??= new Stripe(STRIPE_SECRET_KEY.value(), {
    appInfo: { name: 'Ciyou Eats' },
    maxNetworkRetries: 2,
    timeout: 20_000,
  });
  return client;
}

export function isStripeLiveMode(): boolean {
  return STRIPE_SECRET_KEY.value().startsWith('sk_live_');
}
