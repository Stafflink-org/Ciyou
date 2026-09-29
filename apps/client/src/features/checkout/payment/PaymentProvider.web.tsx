// Fournisseur Stripe côté web (Expo web, seul mode de test disponible dans cet
// environnement) : Stripe.js + @stripe/react-stripe-js. Résolu automatiquement
// à la place de PaymentProvider.tsx par Metro sur cette plateforme.
import { useMemo, type ReactElement } from 'react';
import { loadStripe } from '@stripe/stripe-js';
import { Elements } from '@stripe/react-stripe-js';
import { env } from '../../../lib/env';

export function PaymentProvider({ children }: { children: ReactElement }) {
  const stripePromise = useMemo(() => (env.stripePublishableKey ? loadStripe(env.stripePublishableKey) : null), []);
  if (!stripePromise) return children;
  return <Elements stripe={stripePromise}>{children}</Elements>;
}
