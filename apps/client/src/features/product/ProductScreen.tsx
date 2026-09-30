// Fiche produit (`ProductScreen`, §18.1, §6 client.md) — groupes d'options,
// commentaire, quantité, ajout/mise à jour du panier. Panier mono-restaurant :
// une confirmation native remplace `window.confirm` de la maquette.
import { useMemo, useState } from 'react';
import { Alert, Image, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { MainStackParamList } from '../../navigation/types';
import { docAt, useDoc } from '../../lib/firestore';
import type { Product } from '@golink/shared';
import { colors, radius, spacing } from '../../theme/tokens';
import { Text } from '../../ui/Text';
import { Input } from '../../ui/Input';
import { Button } from '../../ui/Button';
import { useToast } from '../../ui/Toast';
import { trackFunnelEvent } from '../../lib/funnel';
import { PlaceholderScreen } from '../shared/PlaceholderScreen';
import { useActiveProductOffers, useMenuProducts } from '../restaurant/hooks';
import { useMenuOptions, useOptionGroups } from './hooks';
import { useCart, type CartLineOption } from '../cart/CartContext';
import { useFavorites } from '../favorites/hooks';
import { useTranslation } from '../../i18n/I18nProvider';

type Props = NativeStackScreenProps<MainStackParamList, 'Product'>;

const money = (cents: number) => `${(cents / 100).toFixed(2).replace('.', ',')} €`;

export function ProductScreen({ route, navigation }: Props) {
  const { t } = useTranslation('product');
  const { productId, restaurantId, lineId } = route.params;
  const { data: restaurant } = useDoc<{ name: string; countryId: string; cityId: string }>(docAt(`restaurants/${restaurantId}`));
  const { data: product, loading } = useDoc<Product>(docAt(`restaurants/${restaurantId}/products/${productId}`));
  const { data: groups } = useOptionGroups(restaurantId, product?.optionGroupIds ?? []);
  const groupIds = groups.map((g) => g.id);
  const optionIds = [...new Set(groups.flatMap((g) => g.optionIds))];
  const { data: options } = useMenuOptions(restaurantId, optionIds);
  const { data: offers } = useActiveProductOffers(restaurantId);
  const toast = useToast();
  const cart = useCart();
  const favorites = useFavorites();
  const favorite = favorites.isFavoriteProduct(productId);

  const editingLine = lineId ? cart.lines.find((l) => l.lineId === lineId) : null;
  const [selected, setSelected] = useState<Record<string, string[]>>(() => {
    if (!editingLine) return {};
    const byGroup: Record<string, string[]> = {};
    for (const o of editingLine.options) byGroup[o.groupId] = [...(byGroup[o.groupId] ?? []), o.optionId];
    return byGroup;
  });
  const [comment, setComment] = useState(editingLine?.comment ?? '');
  const [quantity, setQuantity] = useState(editingLine?.quantity ?? 1);

  const today = new Date().toISOString().slice(0, 10);
  const activeOffer = product ? offers.find((o) => o.productId === product.id && o.active && !o.disabledByPlatform && o.startDay <= today && (!o.endDay || o.endDay >= today)) : null;

  const orderedGroups = useMemo(() => groups.filter((g) => (product?.optionGroupIds ?? []).includes(g.id)).sort((a, b) => (product?.optionGroupIds ?? []).indexOf(a.id) - (product?.optionGroupIds ?? []).indexOf(b.id)), [groups, product]);

  if (!loading && !product) {
    return <PlaceholderScreen icon="🍽️" title={t('notFound')} />;
  }

  const optionById = new Map(options.map((o) => [o.id, o]));
  const selectedOptionsPriceCents = Object.values(selected)
    .flat()
    .reduce((sum, id) => sum + (optionById.get(id)?.priceCents ?? 0), 0);
  const unitTotal = (product?.priceCents ?? 0) + selectedOptionsPriceCents;
  const totalCents = unitTotal * quantity;

  const toggleOption = (group: (typeof orderedGroups)[number], optionId: string) => {
    setSelected((prev) => {
      const current = prev[group.id] ?? [];
      if (!group.multiple) {
        return { ...prev, [group.id]: current.includes(optionId) ? [] : [optionId] };
      }
      if (current.includes(optionId)) return { ...prev, [group.id]: current.filter((id) => id !== optionId) };
      if (current.length >= group.max) {
        toast.show(t('maxChoiceToast', { max: group.max, group: group.name.toLowerCase() }), 'danger');
        return prev;
      }
      return { ...prev, [group.id]: [...current, optionId] };
    });
  };

  const stock = product?.stock ?? null;
  const alreadyInCartOtherLines = product ? cart.lines.filter((l) => l.productId === product.id && l.lineId !== lineId).reduce((s, l) => s + l.quantity, 0) : 0;
  const remainingStock = stock !== null ? Math.max(0, stock - alreadyInCartOtherLines) : null;

  const increaseQuantity = () => {
    if (remainingStock !== null && quantity + 1 > remainingStock) {
      toast.show(t('stockLimitedToast', { count: remainingStock }), 'danger');
      return;
    }
    setQuantity((q) => q + 1);
  };
  const decreaseQuantity = () => setQuantity((q) => Math.max(1, q - 1));

  const performAdd = () => {
    if (!product || !restaurant) return;
    if (!product.available || product.stock === 0) {
      toast.show(t('unavailableToast'), 'danger');
      return;
    }
    for (const group of orderedGroups) {
      const count = (selected[group.id] ?? []).length;
      if (count < group.min) {
        toast.show(t('minChoiceToast', { min: group.min, group: group.name }), 'danger');
        return;
      }
    }
    const cartOptions: CartLineOption[] = orderedGroups.flatMap((group) =>
      (selected[group.id] ?? []).map((optionId) => {
        const option = optionById.get(optionId);
        return { optionId, groupId: group.id, groupName: group.name, name: option?.name ?? '', priceCents: option?.priceCents ?? 0, quantity: 1 };
      }),
    );
    const result = cart.addLine({
      restaurantId,
      restaurantName: restaurant.name,
      productId: product.id,
      name: product.name,
      imageUrl: product.image?.thumbUrl ?? product.image?.url ?? null,
      unitPriceCents: product.priceCents,
      optionsPriceCents: selectedOptionsPriceCents,
      quantity,
      options: cartOptions,
      comment: comment.trim() || null,
      stock: product.stock,
      editingLineId: lineId,
    });
    if (!result.ok) {
      toast.show(t('stockMaxToast'), 'danger');
      return;
    }
    // Tunnel de commande (§3 Analytics) : uniquement un vrai ajout (pas une modification
    // de ligne existante, déjà comptée à son premier ajout).
    if (!lineId) trackFunnelEvent('add_to_cart', restaurant);
    toast.show(lineId ? t('updatedInCartToast') : t('addedToCartToast'));
    navigation.navigate('Cart');
  };

  const onPressAdd = () => {
    if (!lineId && cart.belongsToOtherRestaurant(restaurantId)) {
      Alert.alert(t('replaceCartTitle'), t('replaceCartBody'), [
        { text: t('cancel'), style: 'cancel' },
        { text: t('replace'), style: 'destructive', onPress: () => { cart.clear(); performAdd(); } },
      ]);
      return;
    }
    performAdd();
  };

  return (
    <View style={styles.root}>
      <ScrollView contentContainerStyle={{ paddingBottom: 120 }}>
        <Pressable onPress={() => (lineId ? navigation.navigate('Cart') : navigation.navigate('Restaurant', { restaurantId }))}>
          <Text variant="bodyStrong" color="primary" style={styles.backLink}>
            {lineId ? t('backToCart') : t('backToRestaurant')}
          </Text>
        </Pressable>

        {product?.image?.url ? <Image source={{ uri: product.image.url }} style={styles.cover} /> : <View style={[styles.cover, styles.coverFallback]} />}

        <View style={styles.body}>
          <Text variant="eyebrow" color="muted">
            {(restaurant?.name ?? '').toUpperCase()}
          </Text>
          <View style={styles.titleRow}>
            <Text variant="title" style={{ flex: 1 }}>
              {product?.name ?? '…'}
            </Text>
            <Pressable onPress={() => favorites.toggleProduct(restaurantId, productId)} accessibilityRole="button" testID="button-favorite-current-product" hitSlop={10}>
              <Text style={{ fontSize: 22 }}>{favorite ? '❤️' : '🤍'}</Text>
            </Pressable>
          </View>
          {product?.description ? (
            <Text variant="body" color="muted" style={{ marginTop: 4 }}>
              {product.description}
            </Text>
          ) : null}
          <Text variant="title" color="primary" style={{ marginTop: spacing.sm }}>
            {money(product?.priceCents ?? 0)}
          </Text>

          {activeOffer ? (
            <View style={styles.offerBox} testID="product-active-offer">
              <Text variant="bodyStrong">{activeOffer.kind === 'bogo' ? t('offerBogo') : t('offerHalfSecond')}</Text>
              <Text variant="caption" color="muted" style={{ marginTop: 4 }}>
                {t('offerHint')}
              </Text>
            </View>
          ) : null}

          {orderedGroups.map((group) => (
            <View key={group.id} style={styles.groupBlock} testID={`button-option-${group.id}`}>
              <View style={styles.groupHeader}>
                <Text variant="bodyStrong">{group.name}</Text>
                <View style={styles.groupBadge}>
                  <Text variant="label" color="muted">
                    {group.multiple ? t('groupMultiple') : t('groupSingle')}
                  </Text>
                </View>
              </View>
              <Text variant="caption" color="muted">
                {group.multiple ? t('chooseUpTo', { max: group.max }) : t('oneChoiceOnly')}
                {group.min > 0 ? t('minimumCount', { min: group.min }) : t('optional')}
              </Text>
              {(group.optionIds.map((id) => optionById.get(id)).filter(Boolean) as NonNullable<ReturnType<typeof optionById.get>>[]).map((option) => {
                const isSelected = (selected[group.id] ?? []).includes(option.id);
                return (
                  <Pressable key={option.id} onPress={() => option.enabled && toggleOption(group, option.id)} style={styles.optionRow} disabled={!option.enabled}>
                    <View style={[styles.optionCheck, group.multiple ? styles.optionCheckSquare : styles.optionCheckRound, isSelected && styles.optionCheckActive]}>
                      {isSelected ? <View style={styles.optionCheckDot} /> : null}
                    </View>
                    <Text variant="body" style={{ flex: 1, opacity: option.enabled ? 1 : 0.5 }}>
                      {option.name}
                    </Text>
                    <Text variant="caption" color="muted">
                      {option.priceCents > 0 ? `+ ${money(option.priceCents)}` : t('included')}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          ))}

          <View style={styles.groupBlock}>
            <Text variant="bodyStrong">{t('commentTitle')}</Text>
            <Input placeholder={t('commentPlaceholder')} value={comment} onChangeText={setComment} multiline testID="input-product-comment" />
          </View>

          <View style={styles.quantityRow}>
            <Text variant="bodyStrong">{t('quantity')}</Text>
            <View style={styles.stepper}>
              <Pressable onPress={decreaseQuantity} style={styles.stepperButton} testID="button-product-decrease">
                <Text variant="title">−</Text>
              </Pressable>
              <Text variant="bodyStrong" style={styles.stepperValue} testID="text-product-quantity">
                {quantity}
              </Text>
              <Pressable onPress={increaseQuantity} style={styles.stepperButton} testID="button-product-increase">
                <Text variant="title">+</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <Button label={`${lineId ? t('update') : t('addToCart')} · ${money(totalCents)}`} onPress={onPressAdd} testID="button-product-add-to-cart" />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.canvas },
  backLink: { paddingHorizontal: spacing.lg, paddingTop: spacing.md },
  cover: { width: '100%', height: 220, marginTop: spacing.sm },
  coverFallback: { backgroundColor: colors.surfaceRaised },
  body: { padding: spacing.lg, gap: 2 },
  titleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  offerBox: { backgroundColor: colors.primarySoft, borderRadius: radius.md, padding: spacing.md, marginTop: spacing.md },
  groupBlock: { marginTop: spacing.lg, gap: spacing.xs },
  groupHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  groupBadge: { backgroundColor: colors.surfaceRaised, paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.pill },
  optionRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.sm },
  optionCheck: { width: 20, height: 20, borderWidth: 1.5, borderColor: colors.borderStrong, alignItems: 'center', justifyContent: 'center' },
  optionCheckRound: { borderRadius: radius.pill },
  optionCheckSquare: { borderRadius: 5 },
  optionCheckActive: { borderColor: colors.primary },
  optionCheckDot: { width: 10, height: 10, borderRadius: radius.pill, backgroundColor: colors.primary },
  quantityRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: spacing.xl },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  stepperButton: { width: 34, height: 34, borderRadius: radius.pill, backgroundColor: colors.surfaceRaised, alignItems: 'center', justifyContent: 'center' },
  stepperValue: { minWidth: 24, textAlign: 'center' },
  footer: { padding: spacing.lg, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, backgroundColor: colors.surface },
});
