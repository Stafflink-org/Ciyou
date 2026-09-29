// Suivi (`OrderTrackingScreen`, §18.1, §11 client.md) — statut réel en temps
// réel, frise des étapes, position du livreur si assigné (carte, pattern
// `RouteMap` repris de l'app livreur, lot 2 driver).
import { ScrollView, StyleSheet, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { MainStackParamList } from '../../navigation/types';
import { docAt, useDoc } from '../../lib/firestore';
import type { Restaurant } from '@golink/shared';
import { colors, radius, spacing } from '../../theme/tokens';
import { Text } from '../../ui/Text';
import { Badge } from '../../ui/Badge';
import { Card } from '../../ui/Card';
import { Button } from '../../ui/Button';
import { Skeleton } from '../../ui/Skeleton';
import { useGoogleMapsWebKey } from '../../lib/mapsKey';
import { RouteMap } from './RouteMap';
import { useDriverLocation, useTrackedOrder, trackingSteps } from './hooks';
import { useTranslation } from '../../i18n/I18nProvider';
import { intlLocale } from '../../i18n/core';

type Props = NativeStackScreenProps<MainStackParamList, 'Tracking'>;

export function OrderTrackingScreen({ route, navigation }: Props) {
  const { t, locale } = useTranslation('tracking');
  const { orderId } = route.params;
  const { data: order, loading, missing } = useTrackedOrder(orderId);
  const { data: restaurant } = useDoc<Restaurant>(order ? docAt(`restaurants/${order.restaurantId}`) : null);
  const mapsKey = useGoogleMapsWebKey();
  const driverPoint = useDriverLocation(order?.driverId ?? null);

  if (loading) {
    return (
      <View style={styles.root}>
        <Skeleton style={{ height: 160, margin: spacing.lg, borderRadius: 16 }} />
      </View>
    );
  }
  if (missing || !order) {
    return (
      <View style={[styles.root, styles.center]}>
        <Text variant="body" color="muted">
          {t('orderNotFound')}
        </Text>
      </View>
    );
  }

  const steps = trackingSteps(order, t);
  const restaurantGeo = restaurant?.address.geo;
  const destGeo = order.delivery?.geo;

  return (
    <ScrollView style={styles.root} contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xxl }}>
      <Card>
        <View style={styles.headerRow}>
          <Text variant="subtitle">{t('orderNumber', { number: order.number })}</Text>
          <Badge label={order.status === 'cancelled' ? t('statusCancelled') : order.status === 'delivered' ? t('statusDelivered') : t('statusOngoing')} tone={order.status === 'cancelled' ? 'danger' : order.status === 'delivered' ? 'success' : 'primary'} />
        </View>
        <Text variant="caption" color="muted" style={{ marginTop: 2 }}>
          {order.restaurantName}
        </Text>
      </Card>

      {order.fulfillment === 'delivery' && order.status === 'picked_up' && order.driverId && restaurantGeo && destGeo ? (
        <View style={{ marginTop: spacing.lg }}>
          <RouteMap
            apiKey={mapsKey}
            origin={driverPoint ? { lat: driverPoint.lat, lng: driverPoint.lng } : { lat: restaurantGeo.latitude, lng: restaurantGeo.longitude }}
            destination={{ lat: destGeo.latitude, lng: destGeo.longitude }}
          />
        </View>
      ) : null}

      {order.delivery?.driverName ? (
        <Card style={{ marginTop: spacing.lg }}>
          <Text variant="bodyStrong">{t('yourDriver')}</Text>
          <Text variant="body" style={{ marginTop: 2 }}>
            {order.delivery.driverName}
            {order.delivery.driverVehicle ? ` · ${order.delivery.driverVehicle}` : ''}
          </Text>
          {order.delivery.driverPhoneMasked ? (
            <Text variant="caption" color="muted" style={{ marginTop: 2 }}>
              {order.delivery.driverPhoneMasked}
            </Text>
          ) : null}
        </Card>
      ) : null}

      <View style={styles.steps}>
        {steps.map((step) => (
          <View key={step.key} style={styles.stepRow}>
            <View style={[styles.dot, step.done && styles.dotDone, step.current && styles.dotCurrent]} />
            <View style={{ flex: 1 }}>
              <Text variant={step.current ? 'bodyStrong' : 'body'} color={step.done || step.current ? undefined : 'subtle'}>
                {step.label}
              </Text>
              {step.at ? (
                <Text variant="caption" color="muted">
                  {new Date(step.at).toLocaleTimeString(intlLocale(locale), { hour: '2-digit', minute: '2-digit' })}
                </Text>
              ) : null}
            </View>
          </View>
        ))}
      </View>

      {order.status === 'delivered' ? (
        <Button label={t('rateOrder')} onPress={() => navigation.navigate('RateOrder', { orderId })} style={{ marginTop: spacing.lg }} />
      ) : null}
      <Button
        label={t('viewOrderDetail')}
        variant="outline"
        onPress={() => navigation.navigate('OrderDetail', { orderId })}
        style={{ marginTop: spacing.sm }}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.canvas },
  center: { alignItems: 'center', justifyContent: 'center' },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  steps: { marginTop: spacing.xl, gap: spacing.md },
  stepRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  dot: { width: 12, height: 12, borderRadius: 6, backgroundColor: colors.border, marginTop: 4 },
  dotDone: { backgroundColor: colors.success },
  dotCurrent: { backgroundColor: colors.primary },
});
