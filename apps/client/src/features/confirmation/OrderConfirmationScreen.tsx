// Confirmation (`OrderConfirmationScreen`, §18.1, §10 client.md) — lit la vraie
// commande créée par `placeOrder` (temps réel, `orders/{orderId}`).
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { MainStackParamList } from '../../navigation/types';
import { docAt, useDoc } from '../../lib/firestore';
import type { Order } from '@golink/shared';
import { colors, radius, spacing } from '../../theme/tokens';
import { Text } from '../../ui/Text';
import { Button } from '../../ui/Button';
import { PlaceholderScreen } from '../shared/PlaceholderScreen';

type Props = NativeStackScreenProps<MainStackParamList, 'Confirmation'>;

const money = (cents: number) => `${(cents / 100).toFixed(2).replace('.', ',')} €`;

export function OrderConfirmationScreen({ route, navigation }: Props) {
  const { orderId } = route.params;
  const { data: order, loading } = useDoc<Order>(orderId ? docAt(`orders/${orderId}`) : undefined);

  if (!orderId) {
    return (
      <View style={styles.root}>
        <Text variant="eyebrow" color="muted">
          C'EST PARTI !
        </Text>
        <Text variant="title" style={{ marginTop: 4 }}>
          Votre commande est confirmée.
        </Text>
        <Text variant="body" color="muted" style={{ marginTop: spacing.sm }}>
          Référence : <Text variant="bodyStrong" testID="text-confirmation-id">#</Text>
        </Text>
      </View>
    );
  }

  if (!loading && !order) {
    return <PlaceholderScreen icon="✅" title="Commande introuvable" note="Cette commande n'est plus disponible." />;
  }

  const scheduledLabel = order?.scheduledFor
    ? new Date(order.scheduledFor.toMillis()).toLocaleString('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
    : null;

  return (
    <ScrollView contentContainerStyle={styles.root}>
      <Text variant="eyebrow" color="muted">
        C'EST PARTI !
      </Text>
      <Text variant="title" style={{ marginTop: 4 }}>
        Votre commande est confirmée.
      </Text>
      <Text variant="body" color="muted" style={{ marginTop: spacing.sm }}>
        La cuisine de {order?.restaurantName ?? '…'} a reçu votre commande. Suivez chaque étape en direct.
      </Text>

      <View style={styles.card}>
        <Text variant="caption" color="muted">
          Référence
        </Text>
        <Text variant="bodyStrong" testID="text-confirmation-id">
          #{order?.number ?? ''}
        </Text>
        <Text variant="caption" color="muted" style={{ marginTop: spacing.sm }}>
          À régler (démo)
        </Text>
        <Text variant="title" color="primary">
          {money(order?.amounts.chargedCents ?? 0)}
        </Text>
        {scheduledLabel ? (
          <Text variant="body" style={{ marginTop: spacing.sm }}>
            Prévue le {scheduledLabel}.
          </Text>
        ) : null}
      </View>

      {order?.pickupCode ? (
        <View style={styles.pickupCard} testID="pickup-code-confirmation">
          <Text variant="eyebrow" color="muted">
            CODE DE RETRAIT · À PRÉSENTER AU RESTAURANT
          </Text>
          <Text variant="display" style={{ marginTop: spacing.xs }}>
            {order.pickupCode}
          </Text>
        </View>
      ) : null}

      <View style={{ gap: spacing.sm, marginTop: spacing.xl }}>
        <Button
          label="Suivre ma commande"
          onPress={() => order && navigation.replace('Tracking', { orderId: order.id })}
          testID="button-confirmation-track"
        />
        <Pressable onPress={() => navigation.navigate('MainTabs', { screen: 'Home' } as never)} style={styles.homeLink} testID="button-confirmation-home">
          <Text variant="bodyStrong" color="primary" align="center">
            Revenir à l'accueil
          </Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flexGrow: 1, backgroundColor: colors.canvas, padding: spacing.xl, paddingTop: spacing.xxl },
  card: { marginTop: spacing.xl, padding: spacing.lg, backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  pickupCard: { marginTop: spacing.lg, padding: spacing.lg, backgroundColor: colors.primarySoft, borderRadius: radius.lg, alignItems: 'center' },
  homeLink: { paddingVertical: spacing.md },
});
