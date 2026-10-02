// Panier (`CartScreen`, §18.1, §7 client.md) — lignes réelles, quantités liées
// au stock, code promo (transmis à la confirmation, voir `pricing.ts`), aperçu
// de devis calculé par le vrai moteur de tarification (`computeQuote`).
import { useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { MainStackParamList } from '../../navigation/types';
import { docAt, useDoc } from '../../lib/firestore';
import type { Restaurant } from '@golink/shared';
import { colors, radius, spacing } from '../../theme/tokens';
import { Text } from '../../ui/Text';
import { Input } from '../../ui/Input';
import { Button } from '../../ui/Button';
import { useToast } from '../../ui/Toast';
import { PlaceholderScreen } from '../shared/PlaceholderScreen';
import { useCart, cartLineTotal, type CartLine } from './CartContext';
import { previewQuote, pricingConfigFor } from './pricing';
import { useTranslation } from '../../i18n/I18nProvider';

type Props = NativeStackScreenProps<MainStackParamList, 'Cart'>;

const money = (cents: number) => `${(cents / 100).toFixed(2).replace('.', ',')} €`;

export function CartScreen({ navigation }: Props) {
  const { t } = useTranslation('cart');
  const cart = useCart();
  const toast = useToast();
  const [promoCode, setPromoCode] = useState(cart.promoCode ?? '');
  const { data: restaurant } = useDoc<Restaurant>(cart.restaurantId ? docAt(`restaurants/${cart.restaurantId}`) : null);

  if (cart.loaded && cart.lines.length === 0) {
    return (
      <PlaceholderScreen
        icon="🛒"
        title={t('emptyTitle')}
        note={t('emptyNote')}
      />
    );
  }

  const config = pricingConfigFor(restaurant?.countryId);
  const quote = previewQuote(cart.lines, 'delivery', restaurant?.ownDeliveryFeeCents ?? null, restaurant?.minOrderCents ?? 0, config);

  const applyPromo = () => {
    const trimmed = promoCode.trim();
    if (!trimmed) {
      toast.show(t('promoEmptyToast'), 'danger');
      return;
    }
    cart.setPromoCode(trimmed);
    toast.show(t('promoSavedToast'));
  };

  return (
    <View style={styles.root}>
      <ScrollView contentContainerStyle={{ paddingBottom: 160 }}>
        <View style={styles.header}>
          <Pressable onPress={() => navigation.navigate('Restaurant', { restaurantId: cart.restaurantId! })}>
            <Text variant="bodyStrong" color="primary">
              {t('continueExploring')}
            </Text>
          </Pressable>
          <Text variant="caption" color="muted" style={{ marginTop: spacing.sm }}>
            {t('itemCount', { count: cart.itemsCount }).toUpperCase()}
          </Text>
          <Text variant="title">{t('title')}</Text>
          <Text variant="bodyStrong" color="muted">
            {cart.restaurantName ?? restaurant?.name ?? ''}
          </Text>
        </View>

        {cart.lines.map((line) => (
          <CartLineRow key={line.lineId} line={line} navigation={navigation} />
        ))}

        <Pressable onPress={() => navigation.navigate('Restaurant', { restaurantId: cart.restaurantId! })} style={styles.addMore} testID="button-add-more-items">
          <Text variant="bodyStrong" color="primary">
            {t('addMore')}
          </Text>
        </Pressable>

        <View style={styles.summaryCard}>
          <Text variant="title">{t('summaryTitle')}</Text>

          <Text variant="bodyStrong" style={{ marginTop: spacing.md }}>
            {t('promoQuestion')}
          </Text>
          <View style={styles.promoRow}>
            <View style={{ flex: 1 }}>
              <Input placeholder={t('promoPlaceholder')} autoCapitalize="characters" value={promoCode} onChangeText={setPromoCode} testID="input-promo" />
            </View>
            <Pressable onPress={applyPromo} style={styles.promoButton} testID="button-apply-promo">
              <Text variant="bodyStrong" style={{ color: colors.primaryFg }}>
                {t('apply')}
              </Text>
            </Pressable>
          </View>

          <SummaryLine label={t('subtotal')} value={money(quote.subtotalCents)} />
          <SummaryLine label={t('delivery')} value={quote.deliveryFeeCents > 0 ? money(quote.deliveryFeeCents) : t('deliveryFree')} />
          <SummaryLine label={t('serviceFee')} value={money(quote.serviceFeeCents)} />
          {quote.subtotalCents > 0 && restaurant?.minOrderCents ? (
            <Text variant="caption" color="muted" style={{ marginTop: 2 }}>
              {t('minOrderNote', { amount: money(restaurant.minOrderCents) })}
            </Text>
          ) : null}
          <View style={styles.totalRow}>
            <Text variant="title">{t('total')}</Text>
            <Text variant="title" color="primary" testID="text-cart-total">
              {money(quote.totalCents)}
            </Text>
          </View>
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <Button label={t('checkout')} onPress={() => navigation.navigate('Checkout')} testID="button-go-checkout" />
      </View>
    </View>
  );
}

function CartLineRow({ line, navigation }: { line: CartLine; navigation: Props['navigation'] }) {
  const { t } = useTranslation('cart');
  const cart = useCart();
  const toast = useToast();
  const optionsLabel = line.options.map((o) => o.name).join(' · ');

  return (
    <View style={styles.lineRow} testID={`cart-line-${line.lineId}`}>
      {line.imageUrl ? <Image source={{ uri: line.imageUrl }} style={styles.lineThumb} /> : <View style={[styles.lineThumb, styles.lineThumbFallback]} />}
      <View style={{ flex: 1 }}>
        <Text variant="bodyStrong">{line.name}</Text>
        {optionsLabel ? (
          <Text variant="caption" color="muted" numberOfLines={2} style={{ marginTop: 2 }}>
            {optionsLabel}
          </Text>
        ) : null}
        {line.comment ? (
          <Text variant="caption" color="muted" style={{ marginTop: 2, fontStyle: 'italic' }}>
            « {line.comment} »
          </Text>
        ) : null}
        <Text variant="bodyStrong" color="primary" style={{ marginTop: 4 }}>
          {money(cartLineTotal(line))}
        </Text>
        <View style={styles.lineActionsRow}>
          <View style={styles.qtyStepper}>
            <Pressable onPress={() => cart.decreaseLine(line.lineId)} style={styles.qtyButton} testID={`button-decrease-line-${line.lineId}`}>
              <Text variant="bodyStrong">−</Text>
            </Pressable>
            <Text variant="bodyStrong" style={{ minWidth: 20, textAlign: 'center' }}>
              {line.quantity}
            </Text>
            <Pressable
              onPress={() => {
                const result = cart.increaseLine(line.lineId);
                if (!result.ok) toast.show(t('stockMaxToast'), 'danger');
              }}
              style={styles.qtyButton}
              testID={`button-increase-line-${line.lineId}`}
            >
              <Text variant="bodyStrong">+</Text>
            </Pressable>
          </View>
          <Pressable onPress={() => navigation.navigate('Product', { productId: line.productId, restaurantId: line.restaurantId, lineId: line.lineId })} testID={`button-edit-line-${line.lineId}`}>
            <Text variant="bodyStrong" color="primary">
              {t('options')}
            </Text>
          </Pressable>
          <Pressable onPress={() => cart.removeLine(line.lineId)} testID={`button-remove-line-${line.lineId}`}>
            <Text variant="bodyStrong" color="danger">
              {t('remove')}
            </Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

function SummaryLine({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.summaryLine}>
      <Text variant="body" color="muted">
        {label}
      </Text>
      <Text variant="bodyStrong">{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.canvas },
  header: { padding: spacing.lg, gap: 2 },
  lineRow: { flexDirection: 'row', gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  lineThumb: { width: 68, height: 68, borderRadius: radius.md, backgroundColor: colors.surfaceRaised },
  lineThumbFallback: {},
  lineActionsRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg, marginTop: spacing.sm },
  qtyStepper: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  qtyButton: { width: 28, height: 28, borderRadius: radius.pill, backgroundColor: colors.surfaceRaised, alignItems: 'center', justifyContent: 'center' },
  addMore: { paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  summaryCard: { margin: spacing.lg, padding: spacing.lg, backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, gap: spacing.xs },
  promoRow: { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start' },
  promoButton: { backgroundColor: colors.ink, paddingHorizontal: spacing.lg, height: 50, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  summaryLine: { flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.sm },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.md, paddingTop: spacing.md, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  footer: { padding: spacing.lg, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, backgroundColor: colors.surface },
});
