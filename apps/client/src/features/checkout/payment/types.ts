// Interface commune aux deux implémentations de saisie carte (native via
// @stripe/stripe-react-native, web via Stripe.js) : le reste de CheckoutScreen
// n'a besoin de connaître que ce contrat, résolu automatiquement par Metro
// selon la plateforme (CardInput.native.tsx / CardInput.web.tsx).
export type CardPaymentMethodResult = { id: string } | { error: string };
export type NextActionResult = { status?: string; error?: string };
export type SetupIntentResult = { id: string } | { error: string };

export interface CardPayment {
  /** Crée un moyen de paiement Stripe réel à partir de la carte saisie à l'écran. */
  createCardPaymentMethod: () => Promise<CardPaymentMethodResult>;
  /** Authentification forte (3-D Secure) après un `placeOrder` renvoyant `requires_action`. */
  confirmNextAction: (clientSecret: string) => Promise<NextActionResult>;
  /** Confirme la carte saisie à l'écran contre un `SetupIntent` (enregistrement sans paiement). */
  confirmCardSetup: (clientSecret: string) => Promise<SetupIntentResult>;
}
