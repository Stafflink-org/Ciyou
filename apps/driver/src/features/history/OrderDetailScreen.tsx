// Détail d'une course de l'historique — lecture réelle de la commande
// (orders/{orderId}, driverId = moi, cf. firebase/rules/orders.rules).
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { MainStackParamList } from '../../navigation/types';
import { colors, spacing } from '../../theme/tokens';
import { Card } from '../../ui/Card';
import { Text } from '../../ui/Text';
import { useOrderDetail, useOrderEarning } from './hooks';

type Props = NativeStackScreenProps<MainStackParamList, 'OrderDetail'>;

const money = (cents: number) => `${(cents / 100).toFixed(2).replace('.', ',')} €`;

export function OrderDetailScreen({ route }: Props) {
  const { data: order, loading } = useOrderDetail(route.params.orderId);
  const { data: earning } = useOrderEarning(route.params.orderId);

  if (loading || !order) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return (
    <ScrollView style={styles.root} contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.md }}>
      <Card>
        <Text variant="title">{order.number}</Text>
        <Text variant="body" color="muted" style={{ marginTop: 2 }}>
          {order.restaurantName}
        </Text>
      </Card>
      <Card>
        <Text variant="eyebrow" color="muted">
          Client
        </Text>
        <Text variant="bodyStrong" style={{ marginTop: 4 }}>
          {order.customerName}
        </Text>
        {order.delivery ? (
          <Text variant="body" color="muted" style={{ marginTop: 2 }}>
            {order.delivery.address.line1}, {order.delivery.address.postalCode} {order.delivery.address.city}
          </Text>
        ) : null}
      </Card>
      <Card>
        <Text variant="eyebrow" color="muted">
          Articles
        </Text>
        {order.items.map((item, index) => (
          <View key={index} style={styles.itemRow}>
            <Text variant="body">
              {item.quantity} × {item.name}
            </Text>
          </View>
        ))}
      </Card>
      {earning ? (
        <Card>
          <Text variant="eyebrow" color="muted">
            Gain de la course
          </Text>
          <Text variant="title" style={{ marginTop: 4 }}>
            {money(earning.amountCents + earning.tipCents)}
          </Text>
          {earning.tipCents > 0 ? (
            <Text variant="caption" color="muted">
              dont {money(earning.tipCents)} de pourboire
            </Text>
          ) : null}
        </Card>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.canvas },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.canvas },
  itemRow: { paddingVertical: 4 },
});
