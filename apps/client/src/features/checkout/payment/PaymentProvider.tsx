// Fournisseur Stripe côté natif (iOS/Android) : @stripe/stripe-react-native.
// Résolu automatiquement à la place de PaymentProvider.web.tsx par Metro sur
// ces plateformes (voir CardInput.tsx pour le détail du flux). Fichier par
// défaut (sans suffixe) : convention déjà utilisée par RouteMap.tsx/.web.tsx
// (features/tracking) — Metro résout `.web.tsx` sur web, sinon ce fichier.
import type { ReactElement } from 'react';
import { StripeProvider } from '@stripe/stripe-react-native';
import { env } from '../../../lib/env';

export function PaymentProvider({ children }: { children: ReactElement }) {
  if (!env.stripePublishableKey) return children;
  return <StripeProvider publishableKey={env.stripePublishableKey}>{children}</StripeProvider>;
}
