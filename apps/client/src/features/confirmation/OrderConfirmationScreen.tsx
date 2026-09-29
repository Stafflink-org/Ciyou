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
import { useTranslation } from '../../i18n/I18nProvider';
import { intlLocale } from '../../i18n/core';

type Props = NativeStackScreenProps<MainStackParamList, 'Confirmation'>;

const money = (cents: number) => `${(cents / 100).toFixed(2).replace('.', ',')} €`;

export function OrderConfirmationScreen({ route, navigation }: Props) {
  const { t, locale } = useTranslation('confirmation');
  const { orderId } = route.params;
  const { data: order, loading } = useDoc<Order>(orderId ? docAt(`orders/${orderId}`) : undefined);

  if (!orderId) {
    return (
      <View style={styles.root}>
        <Text variant="eyebrow" color="muted">
          {t('eyebrow')}
        </Text>
        <Text variant="title" style={{ marginTop: 4 }}>
          {t('title')}
        </Text>
        <Text variant="body" color="muted" style={{ marginTop: spacing.sm }}>
          {t('reference')} : <Text variant="bodyStrong" testID="text-confirmation-id">#</Text>
        </Text>
      </View>
    );
  }

  if (!loading && !order) {
    return <PlaceholderScreen icon="✅" title={t('notFoundTitle')} note={t('notFoundNote')} />;
  }

  const scheduledLabel = order?.scheduledFor
    ? new Date(order.scheduledFor.toMillis()).toLocaleString(intlLocale(locale), { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
    : null;

  return (
    <ScrollView contentContainerStyle={styles.root}>
      <Text variant="eyebrow" color="muted">
        {t('eyebrow')}
      </Text>
      <Text variant="title" style={{ marginTop: 4 }}>
        {t('title')}
      </Text>
      <Text variant="body" color="muted" style={{ marginTop: spacing.sm }}>
        {t('body', { restaurant: order?.restaurantName ?? '…' })}
      </Text>

      <View style={styles.card}>
        <Text variant="caption" color="muted">
          {t('reference')}
        </Text>
        <Text variant="bodyStrong" testID="text-confirmation-id">
          #{order?.number ?? ''}
        </Text>
        <Text variant="caption" color="muted" style={{ marginTop: spacing.sm }}>
          {t('toPayDemo')}
        </Text>
        <Text variant="title" color="primary">
          {money(order?.amounts.chargedCents ?? 0)}
        </Text>
        {scheduledLabel ? (
          <Text variant="body" style={{ marginTop: spacing.sm }}>
            {t('scheduledOn', { date: scheduledLabel })}
          </Text>
        ) : null}
      </View>

      {order?.pickupCode ? (
        <View style={styles.pickupCard} testID="pickup-code-confirmation">
          <Text variant="eyebrow" color="muted">
            {t('pickupCodeEyebrow')}
          </Text>
          <Text variant="display" style={{ marginTop: spacing.xs }}>
            {order.pickupCode}
          </Text>
        </View>
      ) : null}

      <View style={{ gap: spacing.sm, marginTop: spacing.xl }}>
        <Button
          label={t('trackOrder')}
          onPress={() => order && navigation.replace('Tracking', { orderId: order.id })}
          testID="button-confirmation-track"
        />
        <Pressable onPress={() => navigation.navigate('MainTabs', { screen: 'Home' } as never)} style={styles.homeLink} testID="button-confirmation-home">
          <Text variant="bodyStrong" color="primary" align="center">
            {t('backHome')}
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
