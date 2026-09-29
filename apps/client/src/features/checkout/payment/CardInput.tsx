// Saisie carte côté natif (iOS/Android) : `CardField` de @stripe/stripe-react-native,
// et `useStripe()` pour créer le moyen de paiement réel + gérer l'authentification
// forte 3-D Secure (`handleNextAction`) après un `placeOrder` en `requires_action`.
// Résolu automatiquement à la place de CardInput.web.tsx par Metro sur ces plateformes.
import { useCallback, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { CardField, useStripe, type CardFieldInput } from '@stripe/stripe-react-native';
import { colors, radius } from '../../../theme/tokens';
import type { CardPayment } from './types';

export function useCardPayment(): CardPayment {
  const { createPaymentMethod, handleNextAction } = useStripe();
  return {
    createCardPaymentMethod: useCallback(async () => {
      const { paymentMethod, error } = await createPaymentMethod({ paymentMethodType: 'Card' });
      if (error || !paymentMethod) return { error: error?.message ?? 'Carte refusée.' };
      return { id: paymentMethod.id };
    }, [createPaymentMethod]),
    confirmNextAction: useCallback(
      async (clientSecret: string) => {
        const { paymentIntent, error } = await handleNextAction(clientSecret);
        if (error) return { error: error.message ?? 'Authentification de la carte refusée.' };
        return { status: paymentIntent?.status };
      },
      [handleNextAction],
    ),
  };
}

export function CardEntry({ onChange }: { onChange: (complete: boolean) => void }) {
  // La ref évite de redéclencher onChange pour les mêmes infos (CardField republie l'événement souvent).
  const lastComplete = useRef<boolean | null>(null);
  const handleCardChange = useCallback(
    (details: CardFieldInput.Details) => {
      if (lastComplete.current !== details.complete) {
        lastComplete.current = details.complete;
        onChange(details.complete);
      }
    },
    [onChange],
  );
  return (
    <View style={styles.wrap}>
      <CardField
        postalCodeEnabled={false}
        placeholders={{ number: '4242 4242 4242 4242' }}
        cardStyle={{ backgroundColor: colors.surface, textColor: colors.fg, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, placeholderColor: colors.fgSubtle }}
        style={styles.field}
        onCardChange={handleCardChange}
        testID="checkout-card-field"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: 4 },
  field: { width: '100%', height: 50 },
});
