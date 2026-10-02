// Fournisseur Stripe côté web (Expo web, seul mode de test disponible dans cet
// environnement) : Stripe.js + @stripe/react-stripe-js. Résolu automatiquement
// à la place de PaymentProvider.tsx par Metro sur cette plateforme.
import { useMemo, type ReactElement } from 'react';
import { loadStripe } from '@stripe/stripe-js';
import { Elements } from '@stripe/react-stripe-js';
import { env } from '../../../lib/env';

export function PaymentProvider({ children }: { children: ReactElement }) {
  // `useCardPayment()` (CardInput.web.tsx) appelle `useStripe()`/`useElements()` sans condition :
  // sans ce fournisseur, ces appels plantent tout l'écran (« Could not find Elements context »)
  // au lieu d'un simple paiement carte indisponible — toujours envelopper, même sans clé (Stripe.js
  // accepte officiellement `stripe={null}`, le contexte reste utilisable, `useStripe()` renvoie
  // `null` tant qu'aucune clé n'est chargée, sans jeter).
  const stripePromise = useMemo(() => (env.stripePublishableKey ? loadStripe(env.stripePublishableKey) : null), []);
  return <Elements stripe={stripePromise}>{children}</Elements>;
}
