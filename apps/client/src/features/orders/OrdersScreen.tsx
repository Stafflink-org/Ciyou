// Historique (`OrdersScreen`, onglet « Commandes », §18.1, §12 client.md) —
// liste réelle des commandes du client (`orders`, filtrées `customerId`).
import { ScrollView, StyleSheet, View } from 'react-native';
import type { CompositeScreenProps } from '@react-navigation/native';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { MainStackParamList, MainTabsParamList } from '../../navigation/types';
import { colors, radius, spacing } from '../../theme/tokens';
import { Text } from '../../ui/Text';
import { Badge, type BadgeTone } from '../../ui/Badge';
import { Card } from '../../ui/Card';
import { Skeleton } from '../../ui/Skeleton';
import { PlaceholderScreen } from '../shared/PlaceholderScreen';
import { useMyOrders, isActiveOrder } from './hooks';
import { stepLabel } from '../tracking/hooks';
import { useTranslation } from '../../i18n/I18nProvider';

type Props = CompositeScreenProps<BottomTabScreenProps<MainTabsParamList, 'Orders'>, NativeStackScreenProps<MainStackParamList>>;

const money = (cents: number) => `${(cents / 100).toFixed(2).replace('.', ',')} €`;

const STATUS_TONE: Record<string, BadgeTone> = {
  delivered: 'success',
  cancelled: 'danger',
};

export function OrdersScreen({ navigation }: Props) {
  const { t } = useTranslation('orders');
  const { t: tTracking } = useTranslation('tracking');
  const { data: orders, loading } = useMyOrders();

  if (loading) {
    return (
      <View style={{ padding: spacing.lg, gap: spacing.md }}>
        <Skeleton style={{ height: 88, borderRadius: 16 }} />
        <Skeleton style={{ height: 88, borderRadius: 16 }} />
      </View>
    );
  }

  if (orders.length === 0) {
    return <PlaceholderScreen icon="🧾" title={t('emptyTitle')} note={t('emptyNote')} />;
  }

  const active = orders.filter(isActiveOrder);
  const past = orders.filter((o) => !isActiveOrder(o));

  return (
    <ScrollView style={styles.root} contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xxl }}>
      <Text variant="eyebrow" color="muted">
        {t('eyebrow')}
      </Text>
      <Text variant="title" style={{ marginTop: 4, marginBottom: spacing.md }}>
        {t('title')}
      </Text>

      {active.length > 0 ? (
        <View style={{ marginBottom: spacing.lg, gap: spacing.sm }}>
          <Text variant="bodyStrong">{t('ongoing')}</Text>
          {active.map((order) => (
            <Card key={order.id} onPress={() => navigation.navigate('Tracking', { orderId: order.id })} style={styles.card}>
              <View style={styles.row}>
                <Text variant="bodyStrong">{order.restaurantName}</Text>
                <Badge label={stepLabel(order.status, tTracking)} tone="primary" />
              </View>
              <Text variant="caption" color="muted" style={{ marginTop: 4 }}>
                {t('itemsLine', { number: order.number, count: order.itemsCount, amount: money(order.amounts?.totalCents ?? 0) })}
              </Text>
            </Card>
          ))}
        </View>
      ) : null}

      {past.length > 0 ? (
        <View style={{ gap: spacing.sm }}>
          <Text variant="bodyStrong">{t('history')}</Text>
          {past.map((order) => (
            <Card key={order.id} onPress={() => navigation.navigate('OrderDetail', { orderId: order.id })} style={styles.card}>
              <View style={styles.row}>
                <Text variant="bodyStrong">{order.restaurantName}</Text>
                <Badge label={stepLabel(order.status, tTracking)} tone={STATUS_TONE[order.status] ?? 'neutral'} />
              </View>
              <Text variant="caption" color="muted" style={{ marginTop: 4 }}>
                {t('itemsLine', { number: order.number, count: order.itemsCount, amount: money(order.amounts?.totalCents ?? 0) })}
              </Text>
            </Card>
          ))}
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.canvas },
  card: { marginBottom: 0 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
});
