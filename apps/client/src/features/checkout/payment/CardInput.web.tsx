// Saisie carte côté web (Expo web) : Stripe.js + @stripe/react-stripe-js.
// Utilisé uniquement pour permettre un test réel bout en bout dans le
// navigateur intégré (seul mode de test disponible ici, voir
// docs/_deps-demandees.md et docs/ETAT_AVANCEMENT.md — @stripe/stripe-react-native
// n'a pas d'implémentation web). Résolu automatiquement à la place de
// CardInput.native.tsx par Metro sur cette plateforme.
import { useCallback, useRef } from 'react';
import { View, StyleSheet } from 'react-native';
import { CardElement, useElements, useStripe as useStripeJs } from '@stripe/react-stripe-js';
import { colors, radius } from '../../../theme/tokens';
import type { CardPayment } from './types';

export function useCardPayment(): CardPayment {
  const stripe = useStripeJs();
  const elements = useElements();
  return {
    createCardPaymentMethod: useCallback(async () => {
      if (!stripe || !elements) return { error: 'Le module de paiement n’est pas encore prêt.' };
      const card = elements.getElement(CardElement);
      if (!card) return { error: 'Renseignez votre carte bancaire.' };
      const { paymentMethod, error } = await stripe.createPaymentMethod({ type: 'card', card });
      if (error || !paymentMethod) return { error: error?.message ?? 'Carte refusée.' };
      return { id: paymentMethod.id };
    }, [stripe, elements]),
    confirmNextAction: useCallback(
      async (clientSecret: string) => {
        if (!stripe) return { error: 'Le module de paiement n’est pas encore prêt.' };
        const { paymentIntent, error } = await stripe.handleNextAction({ clientSecret });
        if (error) return { error: error.message ?? 'Authentification de la carte refusée.' };
        return { status: paymentIntent?.status };
      },
      [stripe],
    ),
  };
}

const CARD_ELEMENT_OPTIONS = {
  style: {
    base: {
      fontSize: '15px',
      color: colors.fg,
      '::placeholder': { color: colors.fgSubtle },
    },
    invalid: { color: colors.danger },
  },
};

export function CardEntry({ onChange }: { onChange: (complete: boolean) => void }) {
  const lastComplete = useRef<boolean | null>(null);
  return (
    <View style={styles.wrap} testID="checkout-card-field">
      <CardElement
        options={CARD_ELEMENT_OPTIONS}
        onChange={(event) => {
          const complete = event.complete && !event.error;
          if (lastComplete.current !== complete) {
            lastComplete.current = complete;
            onChange(complete);
          }
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { width: '100%', backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: 14, justifyContent: 'center', minHeight: 50 },
});
