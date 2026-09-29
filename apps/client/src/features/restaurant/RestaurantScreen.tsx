// Fiche restaurant (`RestaurantScreen`, §18.1, §5 client.md) — entête réelle
// (lot 1) + menu complet réel : sections en onglets collants (avec repérage au
// défilement simplifié — mesure des sections, pas de bibliothèque tierce),
// cartes produit, indisponibilité, offres automatiques, bandeau fermeture.
import { useRef, useState } from 'react';
import { Image, Pressable, ScrollView, View, StyleSheet, type NativeSyntheticEvent, type NativeScrollEvent } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { MainStackParamList } from '../../navigation/types';
import { useDoc, docAt } from '../../lib/firestore';
import type { Product, Restaurant, WithId } from '@golink/shared';
import { paths } from '@golink/shared';
import { colors, spacing, radius, shadow } from '../../theme/tokens';
import { Text } from '../../ui/Text';
import { Badge } from '../../ui/Badge';
import { useToast } from '../../ui/Toast';
import { PlaceholderScreen } from '../shared/PlaceholderScreen';
import { useActiveProductOffers, useMenuProducts, useMenuSections } from './hooks';
import { FloatingCartButton } from '../cart/FloatingCartButton';
import { useFavorites } from '../favorites/hooks';

type Props = NativeStackScreenProps<MainStackParamList, 'Restaurant'>;

const OFFER_LABEL: Record<string, string> = { bogo: '1 acheté, 1 offert', half_second: 'Le 2e à −50 %' };

export function RestaurantScreen({ route, navigation }: Props) {
  const { restaurantId } = route.params;
  const { data: restaurant, loading } = useDoc<Restaurant>(docAt(paths.restaurant(restaurantId)));
  const { data: sections } = useMenuSections(restaurantId);
  const { data: products } = useMenuProducts(restaurantId);
  const { data: offers } = useActiveProductOffers(restaurantId);
  const toast = useToast();
  const favorites = useFavorites();
  const favorite = favorites.isFavoriteRestaurant(restaurantId);
  const [activeSectionId, setActiveSectionId] = useState<string | null>(null);
  const scrollRef = useRef<ScrollView>(null);
  const sectionOffsets = useRef<Record<string, number>>({});
  const today = new Date().toISOString().slice(0, 10);

  const offerByProduct = new Map(
    offers
      .filter((o) => {
        const status = o.disabledByPlatform ? 'disabled' : !o.active ? 'paused' : o.startDay > today ? 'scheduled' : o.endDay && o.endDay < today ? 'ended' : 'live';
        return status === 'live';
      })
      .map((o) => [o.productId, o.kind] as const),
  );

  if (!loading && !restaurant) {
    return <PlaceholderScreen icon="🏬" title="Restaurant introuvable" note="Cette adresse n'est plus disponible. Retrouvez les restaurants du quartier." />;
  }

  const visibleSections = sections.filter((s) => products.some((p) => p.sectionId === s.id));
  const productsBySection = (sectionId: string) => products.filter((p) => p.sectionId === sectionId);

  const scrollToSection = (sectionId: string) => {
    setActiveSectionId(sectionId);
    const y = sectionOffsets.current[sectionId];
    if (y !== undefined) scrollRef.current?.scrollTo({ y: y - 8, animated: true });
  };

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const y = e.nativeEvent.contentOffset.y + 140;
    let current: string | null = null;
    for (const s of visibleSections) {
      const top = sectionOffsets.current[s.id];
      if (top !== undefined && top <= y) current = s.id;
    }
    if (current && current !== activeSectionId) setActiveSectionId(current);
  };

  const toggleFavorite = () => {
    favorites.toggleRestaurant(restaurantId);
    toast.show(favorite ? 'Retiré des favoris' : 'Ajouté aux favoris');
  };

  return (
    <View style={styles.root}>
      <ScrollView ref={scrollRef} onScroll={onScroll} scrollEventThrottle={32} contentContainerStyle={{ paddingBottom: spacing.xxl * 3 }}>
        {restaurant?.cover?.url ? <Image source={{ uri: restaurant.cover.url }} style={styles.cover} /> : <View style={[styles.cover, styles.coverFallback]} />}
        <View style={styles.body}>
          <Text variant="eyebrow" color="muted">
            {[restaurant?.cuisineIds[0], restaurant?.address.city].filter(Boolean).join(' · ').toUpperCase()}
          </Text>
          <View style={styles.titleRow}>
            <Text variant="title" style={{ flex: 1 }}>
              {restaurant?.name ?? '…'}
            </Text>
            <Pressable
              onPress={toggleFavorite}
              accessibilityRole="button"
              accessibilityState={{ selected: favorite }}
              testID="button-favorite-current-restaurant"
              hitSlop={10}
            >
              <Text style={{ fontSize: 22 }}>{favorite ? '❤️' : '🤍'}</Text>
            </Pressable>
          </View>
          <Text variant="body" color="muted" style={{ marginTop: 4 }}>
            {restaurant?.description ?? ''}
          </Text>
          <View style={styles.metaRow}>
            <Badge label={`★ ${(restaurant?.rating.average ?? 0).toFixed(1)}`} tone="primary" />
            <Badge label={`${restaurant?.etaMinutes.min ?? 20}–${restaurant?.etaMinutes.max ?? 35} min`} tone="neutral" />
            <Badge label={restaurant?.ownDeliveryFeeCents != null ? `Livraison ${(restaurant.ownDeliveryFeeCents / 100).toFixed(2).replace('.', ',')} €` : 'Livraison offerte'} tone="neutral" />
          </View>
        </View>

        {visibleSections.length > 0 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tabsBar} contentContainerStyle={{ paddingHorizontal: spacing.lg, gap: spacing.sm }}>
            {visibleSections.map((section) => (
              <Pressable
                key={section.id}
                testID={`button-menu-section-${section.name}`}
                onPress={() => scrollToSection(section.id)}
                style={[styles.tabChip, activeSectionId === section.id && styles.tabChipActive]}
              >
                <Text variant="bodyStrong" style={{ color: activeSectionId === section.id ? colors.primaryFg : colors.fg }}>
                  {section.name}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        ) : null}

        {visibleSections.length === 0 ? (
          <View style={{ paddingHorizontal: spacing.lg, paddingVertical: spacing.xxl }}>
            <Text variant="body" color="muted" align="center">
              Menu bientôt disponible.
            </Text>
          </View>
        ) : (
          visibleSections.map((section) => {
            const items = productsBySection(section.id);
            return (
              <View key={section.id} testID={`section-menu-${section.name}`} onLayout={(e) => (sectionOffsets.current[section.id] = e.nativeEvent.layout.y)}>
                <View style={styles.sectionHeader}>
                  <Text variant="title">{section.name}</Text>
                  <Text variant="caption" color="muted">
                    {items.length} plat{items.length > 1 ? 's' : ''}
                  </Text>
                </View>
                {items.map((product) => (
                  <ProductRow
                    key={product.id}
                    product={product}
                    offerLabel={offerByProduct.has(product.id) ? OFFER_LABEL[offerByProduct.get(product.id) as string] : null}
                    onPress={() => {
                      if (!product.available || product.stock === 0) {
                        toast.show('Ce plat n’est plus disponible.', 'danger');
                        return;
                      }
                      navigation.navigate('Product', { productId: product.id, restaurantId });
                    }}
                  />
                ))}
              </View>
            );
          })
        )}

        <Text variant="caption" color="subtle" style={styles.footerNote}>
          Frais affichés fixes pour la démo : les zones ne sont pas calculées par géolocalisation.
        </Text>
      </ScrollView>

      {restaurant && !restaurant.isOpen ? (
        <View style={styles.closedBanner}>
          <Text variant="bodyStrong" style={{ color: colors.onDark }} align="center">
            Restaurant fermé temporairement : les commandes sont suspendues.
          </Text>
        </View>
      ) : (
        <FloatingCartButton />
      )}
    </View>
  );
}

function ProductRow({ product, offerLabel, onPress }: { product: WithId<Product>; offerLabel: string | null; onPress: () => void }) {
  const unavailable = !product.available || product.stock === 0;
  return (
    <Pressable
      onPress={onPress}
      disabled={unavailable}
      testID={`button-open-product-${product.id}`}
      style={[styles.productCard, unavailable && styles.productCardDisabled]}
    >
      {product.image?.url ? <Image source={{ uri: product.image.url }} style={styles.productThumb} /> : <View style={[styles.productThumb, styles.productThumbFallback]} />}
      <View style={{ flex: 1 }}>
        <Text variant="bodyStrong" numberOfLines={1}>
          {product.name}
        </Text>
        {product.description ? (
          <Text variant="caption" color="muted" numberOfLines={2} style={{ marginTop: 2 }}>
            {product.description}
          </Text>
        ) : null}
        {offerLabel ? (
          <Text variant="label" color="primary" style={{ marginTop: 4 }}>
            {offerLabel}
          </Text>
        ) : null}
        <Text variant="bodyStrong" color="primary" testID={`text-price-${product.id}`} style={{ marginTop: 4 }}>
          {(product.priceCents / 100).toFixed(2).replace('.', ',')} €
        </Text>
        {unavailable ? (
          <Text variant="label" color="danger" testID={`status-product-unavailable-${product.id}`} style={{ marginTop: 4 }}>
            Produit indisponible
          </Text>
        ) : null}
      </View>
      {!unavailable ? (
        <View style={styles.addBubble}>
          <Text style={{ color: colors.primaryFg, fontWeight: '700', fontSize: 18 }}>+</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.canvas },
  cover: { width: '100%', height: 200 },
  coverFallback: { backgroundColor: colors.surfaceRaised },
  body: { padding: spacing.lg, gap: 2, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, backgroundColor: colors.canvas, marginTop: -radius.xl },
  titleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  metaRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm, flexWrap: 'wrap' },
  tabsBar: { marginTop: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border, paddingBottom: spacing.sm },
  tabChip: { paddingVertical: 8, paddingHorizontal: spacing.md, borderRadius: radius.pill, backgroundColor: colors.surfaceRaised },
  tabChipActive: { backgroundColor: colors.ink },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', paddingHorizontal: spacing.lg, marginTop: spacing.lg, marginBottom: spacing.xs },
  productCard: { flexDirection: 'row', gap: spacing.md, alignItems: 'center', paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  productCardDisabled: { opacity: 0.5 },
  productThumb: { width: 68, height: 68, borderRadius: radius.md, backgroundColor: colors.surfaceRaised },
  productThumbFallback: {},
  addBubble: { width: 32, height: 32, borderRadius: radius.pill, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  footerNote: { paddingHorizontal: spacing.lg, marginTop: spacing.xl, textAlign: 'center' },
  closedBanner: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: colors.ink, padding: spacing.lg, ...shadow.card },
});
