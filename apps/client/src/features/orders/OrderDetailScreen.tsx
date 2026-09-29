// Détail commande (`OrderDetailScreen`, §18.1, §12 client.md) — détail complet
// d'une commande passée (articles, montants, adresse/retrait, statut).
import { ScrollView, StyleSheet, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { MainStackParamList } from '../../navigation/types';
import { colors, radius, spacing } from '../../theme/tokens';
import { Text } from '../../ui/Text';
import { Badge } from '../../ui/Badge';
import { Card } from '../../ui/Card';
import { Button } from '../../ui/Button';
import { Skeleton } from '../../ui/Skeleton';
import { useOrder, useOrderReview } from './hooks';
import { stepLabel } from '../tracking/hooks';

type Props = NativeStackScreenProps<MainStackParamList, 'OrderDetail'>;

const money = (cents: number) => `${(cents / 100).toFixed(2).replace('.', ',')} €`;

export function OrderDetailScreen({ route, navigation }: Props) {
  const { orderId } = route.params;
  const { data: order, loading, missing } = useOrder(orderId);
  const { data: review } = useOrderReview(orderId);

  if (loading) {
    return <Skeleton style={{ height: 200, margin: spacing.lg, borderRadius: 16 }} />;
  }
  if (missing || !order) {
    return (
      <View style={[styles.root, styles.center]}>
        <Text color="muted">Commande introuvable.</Text>
      </View>
    );
  }

  const createdAt = order.timeline.placedAt && 'toDate' in order.timeline.placedAt ? order.timeline.placedAt.toDate() : null;

  return (
    <ScrollView style={styles.root} contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xxl }}>
      <Card>
        <View style={styles.row}>
          <Text variant="subtitle">{order.number}</Text>
          <Badge label={stepLabel(order.status)} tone={order.status === 'delivered' ? 'success' : order.status === 'cancelled' ? 'danger' : 'primary'} />
        </View>
        <Text variant="caption" color="muted" style={{ marginTop: 2 }}>
          {order.restaurantName} · {createdAt ? createdAt.toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' }) : ''}
        </Text>
        <Text variant="caption" color="muted" style={{ marginTop: 2 }}>
          {order.fulfillment === 'delivery' ? 'Livraison' : order.fulfillment === 'pickup' ? 'Retrait' : 'Sur place'}
        </Text>
      </Card>

      {order.fulfillment === 'delivery' && order.delivery ? (
        <Card style={{ marginTop: spacing.md }}>
          <Text variant="bodyStrong">Adresse de livraison</Text>
          <Text variant="body" style={{ marginTop: 4 }}>
            {order.delivery.address.label ? `${order.delivery.address.label} · ` : ''}
            {order.delivery.address.line1}
          </Text>
        </Card>
      ) : null}

      <Card style={{ marginTop: spacing.md }}>
        <Text variant="bodyStrong" style={{ marginBottom: spacing.sm }}>
          Articles
        </Text>
        {order.items.map((item) => (
          <View key={item.lineId} style={styles.itemRow}>
            <Text variant="body" style={{ flex: 1 }}>
              {item.quantity} × {item.name}
            </Text>
            <Text variant="body">{money(item.totalCents)}</Text>
          </View>
        ))}
        <View style={styles.divider} />
        <SummaryLine label="Sous-total" value={money(order.amounts.subtotalCents)} />
        {order.amounts.deliveryFeeCents > 0 ? <SummaryLine label="Livraison" value={money(order.amounts.deliveryFeeCents)} /> : null}
        {order.amounts.serviceFeeCents > 0 ? <SummaryLine label="Frais de service" value={money(order.amounts.serviceFeeCents)} /> : null}
        {order.amounts.discount.totalCents > 0 ? <SummaryLine label="Réduction" value={`− ${money(order.amounts.discount.totalCents)}`} /> : null}
        <View style={styles.totalRow}>
          <Text variant="bodyStrong">Total</Text>
          <Text variant="bodyStrong" color="primary">
            {money(order.amounts.totalCents)}
          </Text>
        </View>
        <Text variant="caption" color="muted" style={{ marginTop: spacing.xs }}>
          {order.payment.method === 'card' ? 'Carte' : order.payment.method === 'cash' ? 'Espèces' : order.payment.method}
          {order.payment.label ? ` · ${order.payment.label}` : ''}
        </Text>
      </Card>

      {order.status === 'delivered' ? (
        review ? (
          <Card style={{ marginTop: spacing.md }}>
            <Text variant="bodyStrong">Votre avis</Text>
            <Text variant="body" style={{ marginTop: 4 }}>
              {'⭐'.repeat(review.restaurantRating)}
            </Text>
            {review.comment ? (
              <Text variant="caption" color="muted" style={{ marginTop: 4 }}>
                {review.comment}
              </Text>
            ) : null}
          </Card>
        ) : (
          <Button label="Noter cette commande" variant="outline" onPress={() => navigation.navigate('RateOrder', { orderId })} style={{ marginTop: spacing.lg }} />
        )
      ) : order.status !== 'cancelled' ? (
        <Button label="Suivre la commande" onPress={() => navigation.navigate('Tracking', { orderId })} style={{ marginTop: spacing.lg }} />
      ) : null}

      <Button label="Signaler un problème" variant="outline" onPress={() => navigation.navigate('Support', { orderId })} style={{ marginTop: spacing.sm }} />
    </ScrollView>
  );
}

function SummaryLine({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.xs }}>
      <Text variant="body" color="muted">
        {label}
      </Text>
      <Text variant="body">{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.canvas },
  center: { alignItems: 'center', justifyContent: 'center' },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  itemRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginVertical: spacing.sm },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.sm, paddingTop: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
});
