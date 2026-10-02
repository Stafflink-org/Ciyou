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
import { useTranslation } from '../../i18n/I18nProvider';
import { intlLocale } from '../../i18n/core';

type Props = NativeStackScreenProps<MainStackParamList, 'OrderDetail'>;

const money = (cents: number) => `${(cents / 100).toFixed(2).replace('.', ',')} €`;

export function OrderDetailScreen({ route, navigation }: Props) {
  const { t, locale } = useTranslation('orders');
  const { t: tTracking } = useTranslation('tracking');
  const { orderId } = route.params;
  const { data: order, loading, missing } = useOrder(orderId);
  const { data: review } = useOrderReview(orderId);

  if (loading) {
    return <Skeleton style={{ height: 200, margin: spacing.lg, borderRadius: 16 }} />;
  }
  if (missing || !order) {
    return (
      <View style={[styles.root, styles.center]}>
        <Text color="muted">{t('orderNotFound')}</Text>
      </View>
    );
  }

  const createdAt = order.timeline?.placedAt && 'toDate' in order.timeline.placedAt ? order.timeline.placedAt.toDate() : null;

  return (
    <ScrollView style={styles.root} contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xxl }}>
      <Card>
        <View style={styles.row}>
          <Text variant="subtitle">{order.number}</Text>
          <Badge label={stepLabel(order.status, tTracking)} tone={order.status === 'delivered' ? 'success' : order.status === 'cancelled' ? 'danger' : 'primary'} />
        </View>
        <Text variant="caption" color="muted" style={{ marginTop: 2 }}>
          {order.restaurantName} · {createdAt ? createdAt.toLocaleString(intlLocale(locale), { dateStyle: 'medium', timeStyle: 'short' }) : ''}
        </Text>
        <Text variant="caption" color="muted" style={{ marginTop: 2 }}>
          {order.fulfillment === 'delivery' ? t('delivery') : order.fulfillment === 'pickup' ? t('pickup') : t('dineIn')}
        </Text>
      </Card>

      {order.fulfillment === 'delivery' && order.delivery?.address ? (
        <Card style={{ marginTop: spacing.md }}>
          <Text variant="bodyStrong">{t('deliveryAddress')}</Text>
          <Text variant="body" style={{ marginTop: 4 }}>
            {order.delivery.address.label ? `${order.delivery.address.label} · ` : ''}
            {order.delivery.address.line1}
          </Text>
        </Card>
      ) : null}

      <Card style={{ marginTop: spacing.md }}>
        <Text variant="bodyStrong" style={{ marginBottom: spacing.sm }}>
          {t('articles')}
        </Text>
        {(order.items ?? []).map((item) => (
          <View key={item.lineId} style={styles.itemRow}>
            <Text variant="body" style={{ flex: 1 }}>
              {item.quantity} × {item.name}
            </Text>
            <Text variant="body">{money(item.totalCents)}</Text>
          </View>
        ))}
        <View style={styles.divider} />
        <SummaryLine label={t('subtotal')} value={money(order.amounts?.subtotalCents ?? 0)} />
        {(order.amounts?.deliveryFeeCents ?? 0) > 0 ? <SummaryLine label={t('deliveryFee')} value={money(order.amounts.deliveryFeeCents)} /> : null}
        {(order.amounts?.serviceFeeCents ?? 0) > 0 ? <SummaryLine label={t('serviceFee')} value={money(order.amounts.serviceFeeCents)} /> : null}
        {(order.amounts?.discount?.totalCents ?? 0) > 0 ? <SummaryLine label={t('discount')} value={`− ${money(order.amounts.discount.totalCents)}`} /> : null}
        <View style={styles.totalRow}>
          <Text variant="bodyStrong">{t('total')}</Text>
          <Text variant="bodyStrong" color="primary">
            {money(order.amounts?.totalCents ?? 0)}
          </Text>
        </View>
        <Text variant="caption" color="muted" style={{ marginTop: spacing.xs }}>
          {order.payment?.method === 'card' ? t('paymentCard') : order.payment?.method === 'cash' ? t('paymentCash') : (order.payment?.method ?? '')}
          {order.payment?.label ? ` · ${order.payment.label}` : ''}
        </Text>
      </Card>

      {order.status === 'cancelled' && order.cancellation ? (
        <Card style={{ marginTop: spacing.md }}>
          <Text variant="bodyStrong">{t('cancelled.title')}</Text>
          <SummaryLine
            label={t('cancelled.refund')}
            value={order.cancellation.refundCents > 0 ? money(order.cancellation.refundCents) : t('cancelled.noRefund')}
          />
        </Card>
      ) : null}

      {order.status === 'delivered' ? (
        review ? (
          <Card style={{ marginTop: spacing.md }}>
            <Text variant="bodyStrong">{t('yourReview')}</Text>
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
          <Button label={t('rateThisOrder')} variant="outline" onPress={() => navigation.navigate('RateOrder', { orderId })} style={{ marginTop: spacing.lg }} />
        )
      ) : order.status !== 'cancelled' ? (
        <Button label={t('trackOrder')} onPress={() => navigation.navigate('Tracking', { orderId })} style={{ marginTop: spacing.lg }} />
      ) : null}

      <Button label={t('reportProblem')} variant="outline" onPress={() => navigation.navigate('Support', { orderId })} style={{ marginTop: spacing.sm }} />
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
