// Composants de l'accueil — calqués fidèlement sur la maquette Replit V2
// (`golink-maquette/v2/client.md` §3, captures `v2/captures/client/mobile/01-home.png`) :
// mêmes blocs, mêmes proportions, mêmes libellés (adaptés à la marque Ciyou Eats
// et au FR sans « ShopyLink »/« démo »), avec l'identité visuelle définie dans
// `theme/tokens.ts` (elle-même la palette du thème « restaurant » de packages/ui,
// déjà celle qu'utilisait la maquette : corail / encre / crème).
//
// Aucune bibliothèque d'icônes n'est ajoutée dans ce lot (RAM limitée, un seul
// paquet à la fois) : les icônes sont des glyphes Unicode, choisis proches de
// ceux de la maquette (cloche, sac, cœur, épingle).
import { useEffect } from 'react';
import { Image, Pressable, ScrollView, View, StyleSheet } from 'react-native';
import type { Restaurant, WithId } from '@golink/shared';
import { colors, radius, spacing, shadow } from '../../theme/tokens';
import { Text } from '../../ui/Text';
import { Badge } from '../../ui/Badge';
import { useTranslation } from '../../i18n/I18nProvider';
import { trackSponsoredEvent } from '../../lib/sponsored';
import type { FeaturedProduct } from './hooks';

/* --------------------------------- En-tête ---------------------------------- */

export function HomeHeader({
  cityLabel,
  firstName,
  onOpenNotifications,
  onOpenCart,
  onOpenMenu,
}: {
  cityLabel: string;
  firstName: string;
  onOpenNotifications: () => void;
  onOpenCart: () => void;
  onOpenMenu: () => void;
}) {
  const { t } = useTranslation('home');
  return (
    <View style={styles.header}>
      <View style={styles.headerTopRow}>
        <Pressable onPress={onOpenMenu} hitSlop={10} accessibilityLabel={t('header.menu')}>
          <Text style={styles.headerGlyph}>☰</Text>
        </Pressable>
        <Text variant="eyebrow" color="muted">
          Ciyou Eats {cityLabel ? `· ${cityLabel.toUpperCase()}` : ''}
        </Text>
        <View style={{ width: 22 }} />
      </View>
      <View style={styles.headerGreetingRow}>
        <Text variant="title" style={styles.greeting}>
          {t('header.greeting', { firstName: firstName || '' })}
        </Text>
        <View style={styles.headerActions}>
          <IconButton glyph="🔔" onPress={onOpenNotifications} accessibilityLabel={t('header.notifications')} />
          <IconButton glyph="🛍️" onPress={onOpenCart} accessibilityLabel={t('header.cart')} />
        </View>
      </View>
    </View>
  );
}

function IconButton({ glyph, onPress, accessibilityLabel }: { glyph: string; onPress: () => void; accessibilityLabel: string }) {
  return (
    <Pressable onPress={onPress} style={styles.iconButton} accessibilityRole="button" accessibilityLabel={accessibilityLabel} hitSlop={8}>
      <Text style={styles.headerGlyph}>{glyph}</Text>
    </Pressable>
  );
}

/* ---------------------------- Contexte de livraison -------------------------- */

export function DeliveryContextBar({
  addressLabel,
  addressLine,
  mode,
  onPressAddress,
  onToggleMode,
}: {
  addressLabel: string;
  addressLine: string;
  mode: 'delivery' | 'pickup';
  onPressAddress: () => void;
  onToggleMode: () => void;
}) {
  const { t } = useTranslation('home');
  return (
    <View style={styles.contextRow}>
      <Pressable onPress={onPressAddress} style={styles.contextAddress}>
        <Text style={{ fontSize: 15 }}>📍</Text>
        <View>
          <Text variant="caption" color="muted">
            {t('delivery.prefix')} · {addressLabel}
          </Text>
          <Text variant="bodyStrong" numberOfLines={1}>
            {addressLine}
          </Text>
        </View>
      </Pressable>
      <Pressable onPress={onToggleMode} style={styles.modePill}>
        <Text variant="label" style={{ color: colors.primaryFg }}>
          {mode === 'delivery' ? t('delivery.modeDelivery') : t('delivery.modePickup')} ⌄
        </Text>
      </Pressable>
    </View>
  );
}

/* ----------------------------------- Héros ------------------------------------ */

export function HomeHero({ addressLine, query, onChangeQuery, onSubmit }: { addressLine: string; query: string; onChangeQuery: (v: string) => void; onSubmit: () => void }) {
  const { t } = useTranslation('home');
  return (
    <View style={styles.hero}>
      <Text variant="eyebrow" style={styles.heroEyebrow}>
        {t('hero.eyebrow')}
      </Text>
      <Text variant="display" color="inverted" style={styles.heroTitle}>
        {t('hero.title')}
      </Text>
      <View style={styles.heroAddressRow}>
        <Text style={{ fontSize: 13 }}>📍</Text>
        <Text variant="caption" color="inverted" style={{ opacity: 0.85 }} numberOfLines={1}>
          {addressLine}
        </Text>
      </View>
      <View style={styles.heroSearch}>
        <Text style={{ fontSize: 16, opacity: 0.6 }}>⌕</Text>
        <View style={{ flex: 1 }}>
          {/* Champ contrôlé minimal : la vraie saisie/instantanéité arrive avec l'écran Recherche. */}
          <Pressable onPress={onSubmit}>
            <Text variant="body" color="inverted" style={{ opacity: query ? 1 : 0.55 }} numberOfLines={1}>
              {query || t('hero.placeholder')}
            </Text>
          </Pressable>
        </View>
        <Pressable onPress={onSubmit} style={styles.heroSearchButton} accessibilityLabel={t('hero.search')}>
          <Text style={{ color: colors.primaryFg, fontSize: 16 }}>→</Text>
        </Pressable>
      </View>
    </View>
  );
}

/* ------------------------------- Types d'envie -------------------------------- */

export interface FoodType {
  key: string;
  label: string;
  emoji: string;
  bg: string;
}

export const FOOD_TYPES: FoodType[] = [
  { key: 'burgers', label: 'Burgers', emoji: '🍔', bg: '#FBE3D3' },
  { key: 'pates', label: 'Pâtes', emoji: '🍝', bg: '#DCEFE1' },
  { key: 'ramen', label: 'Ramen', emoji: '🍜', bg: '#DCE9F7' },
  { key: 'sushis', label: 'Sushis', emoji: '🍣', bg: '#F6E4EE' },
  { key: 'bowls', label: 'Bowls', emoji: '🥗', bg: '#EAF3D9' },
  { key: 'brunch', label: 'Brunch', emoji: '🥐', bg: '#FCEBD0' },
  { key: 'street-food', label: 'Street food', emoji: '🌮', bg: '#FDE2DC' },
  { key: 'cafe', label: 'Café', emoji: '☕', bg: '#E9E0D6' },
];

export function FoodTypeTiles({ onPress }: { onPress: (foodType: FoodType) => void }) {
  const { t } = useTranslation('home');
  return (
    <View>
      <SectionHeading eyebrow={t('foodTypes.eyebrow')} title={t('foodTypes.title')} subtitle={t('foodTypes.subtitle')} />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.foodTypeRow}>
        {FOOD_TYPES.map((item) => (
          <Pressable key={item.key} onPress={() => onPress(item)} style={styles.foodTypeTile}>
            <View style={[styles.foodTypeCircle, { backgroundColor: item.bg }]}>
              <Text style={{ fontSize: 26 }}>{item.emoji}</Text>
            </View>
            <Text variant="caption" align="center" style={{ marginTop: 6 }}>
              {t(`foodTypes.items.${item.key}`)}
            </Text>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

/* ---------------------------------- Sections ----------------------------------- */

export function SectionHeading({ eyebrow, title, action }: { eyebrow: string; title: string; subtitle?: string; action?: { label: string; onPress: () => void } }) {
  return (
    <View style={styles.sectionHeadingRow}>
      <View style={{ flex: 1 }}>
        <Text variant="eyebrow" color="muted">
          {eyebrow}
        </Text>
        <Text variant="title" style={{ marginTop: 2 }}>
          {title}
        </Text>
      </View>
      {action ? (
        <Pressable onPress={action.onPress}>
          <Text variant="bodyStrong" color="primary">
            {action.label} →
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/* ----------------------------------- Offres ------------------------------------ */

export function OfferCard({ title, description, badge }: { title: string; description: string; badge?: string }) {
  return (
    <View style={styles.offerCard}>
      <Text style={{ fontSize: 20 }}>✉️</Text>
      <Text variant="subtitle" color="inverted" style={{ marginTop: spacing.sm }}>
        {title}
      </Text>
      <Text variant="caption" color="inverted" style={{ opacity: 0.8, marginTop: 4 }}>
        {description}
      </Text>
      {badge ? (
        <View style={styles.offerBadge}>
          <Text variant="label" style={{ color: colors.primaryFg }}>
            {badge}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

/* -------------------------------- Carte restaurant ------------------------------- */

export function RestaurantCard({ restaurant, onPress, onToggleFavorite, favorite }: { restaurant: WithId<Restaurant>; onPress: () => void; onToggleFavorite: () => void; favorite: boolean }) {
  const { t } = useTranslation('home');
  const initials = restaurant.mark || restaurant.name.slice(0, 2).toUpperCase();
  const cuisines = (restaurant.cuisineIds ?? []).slice(0, 2).join(' · ');
  // §11 « Mise en avant payante » : impressions/clics jamais comptés faute d'appel côté client.
  useEffect(() => {
    if (restaurant.sponsored) trackSponsoredEvent('impression', restaurant.id);
  }, [restaurant.sponsored, restaurant.id]);
  const handlePress = () => {
    if (restaurant.sponsored) trackSponsoredEvent('click', restaurant.id);
    onPress();
  };
  return (
    <Pressable onPress={handlePress} style={styles.restaurantCard}>
      <View style={[styles.restaurantBanner, { backgroundColor: restaurant.accent || colors.primary }]}>
        {restaurant.cover?.url ? (
          <Image source={{ uri: restaurant.cover.url }} style={StyleSheet.absoluteFill} resizeMode="cover" />
        ) : (
          <Text style={styles.restaurantInitials}>{initials}</Text>
        )}
        <View style={styles.etaBadge}>
          <Text variant="caption" color="inverted">
            {restaurant.etaMinutes?.min ?? 20}–{restaurant.etaMinutes?.max ?? 35} min
          </Text>
        </View>
        <Pressable onPress={onToggleFavorite} style={styles.favoriteButton} hitSlop={8}>
          <Text style={{ fontSize: 15 }}>{favorite ? '❤️' : '🤍'}</Text>
        </Pressable>
        {!restaurant.isOpen ? (
          <View style={styles.closedBadge}>
            <Text variant="label" color="inverted">
              {t('restaurantCard.closed')}
            </Text>
          </View>
        ) : null}
        {restaurant.sponsored ? (
          <View style={styles.sponsoredBadge}>
            <Text variant="label" style={{ color: colors.primaryFg }}>
              {t('restaurantCard.sponsored')}
            </Text>
          </View>
        ) : null}
      </View>
      <View style={styles.restaurantBody}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <Text variant="subtitle" style={{ flex: 1 }} numberOfLines={1}>
            {restaurant.name}
          </Text>
          <Badge label={`★ ${(restaurant.rating?.average ?? 0).toFixed(1)}`} tone="primary" />
        </View>
        {cuisines ? (
          <Text variant="caption" color="muted" numberOfLines={1}>
            {cuisines} · {restaurant.address?.city ?? ''}
          </Text>
        ) : null}
        <Text variant="caption" color="primary" style={{ marginTop: 2 }}>
          {restaurant.ownDeliveryFeeCents != null
            ? t('restaurantCard.deliveryFee', { amount: (restaurant.ownDeliveryFeeCents / 100).toFixed(2).replace('.', ',') })
            : t('restaurantCard.freeDelivery')}
        </Text>
      </View>
    </Pressable>
  );
}

/* -------------------------------- Ligne produit ---------------------------------- */

export function FeaturedProductRow({ product, onPress, onToggleFavorite, favorite }: { product: FeaturedProduct; onPress: () => void; onToggleFavorite: () => void; favorite: boolean }) {
  const { t } = useTranslation('home');
  return (
    <Pressable onPress={onPress} style={styles.productRow}>
      <View style={{ flex: 1, paddingRight: spacing.md }}>
        <Text variant="eyebrow" color="muted">
          {product.tags?.[0] ?? t('product.suggestion')}
        </Text>
        <Text variant="bodyStrong" numberOfLines={1} style={{ marginTop: 2 }}>
          {product.name}
        </Text>
        {product.description ? (
          <Text variant="caption" color="muted" numberOfLines={2} style={{ marginTop: 2 }}>
            {product.description}
          </Text>
        ) : null}
        <Text variant="bodyStrong" color="primary" style={{ marginTop: 4 }}>
          {(product.priceCents / 100).toFixed(2).replace('.', ',')} €
        </Text>
      </View>
      <View style={styles.productThumbWrap}>
        {product.image?.url ? <Image source={{ uri: product.image.url }} style={styles.productThumb} resizeMode="cover" /> : <View style={[styles.productThumb, styles.productThumbFallback]} />}
        <Pressable onPress={onToggleFavorite} style={styles.productHeart} hitSlop={8}>
          <Text style={{ fontSize: 13 }}>{favorite ? '❤️' : '🤍'}</Text>
        </Pressable>
        <Pressable onPress={onPress} style={styles.productAdd} hitSlop={8} accessibilityLabel={t('product.add')}>
          <Text style={{ color: colors.primaryFg, fontSize: 16, fontWeight: '700' }}>+</Text>
        </Pressable>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, gap: spacing.sm },
  headerTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  headerGreetingRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  greeting: { flex: 1 },
  headerActions: { flexDirection: 'row', gap: spacing.sm },
  headerGlyph: { fontSize: 20 },
  iconButton: { width: 40, height: 40, borderRadius: radius.pill, backgroundColor: colors.surfaceRaised, alignItems: 'center', justifyContent: 'center' },

  contextRow: {
    marginTop: spacing.md,
    marginHorizontal: spacing.lg,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    padding: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  contextAddress: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flex: 1 },
  modePill: { backgroundColor: colors.primary, borderRadius: radius.pill, paddingHorizontal: 12, paddingVertical: 8 },

  hero: { marginTop: spacing.lg, marginHorizontal: spacing.lg, backgroundColor: colors.ink, borderRadius: radius.xl, padding: spacing.xl, ...shadow.card },
  heroEyebrow: { color: colors.onDark, opacity: 0.75 },
  heroTitle: { marginTop: spacing.sm },
  heroAddressRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: spacing.md },
  heroSearch: {
    marginTop: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
  },
  heroSearchButton: { width: 32, height: 32, borderRadius: radius.pill, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },

  sectionHeadingRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', paddingHorizontal: spacing.lg, marginTop: spacing.xl, marginBottom: spacing.md },

  foodTypeRow: { paddingHorizontal: spacing.lg, gap: spacing.lg },
  foodTypeTile: { alignItems: 'center', width: 72 },
  foodTypeCircle: { width: 64, height: 64, borderRadius: radius.lg, alignItems: 'center', justifyContent: 'center' },

  offerCard: { width: 260, backgroundColor: colors.ink, borderRadius: radius.lg, padding: spacing.lg, marginRight: spacing.md, minHeight: 120 },
  offerBadge: { marginTop: spacing.sm, alignSelf: 'flex-start', backgroundColor: colors.primary, borderRadius: radius.sm, paddingHorizontal: 10, paddingVertical: 4 },

  restaurantCard: { marginHorizontal: spacing.lg, marginBottom: spacing.lg, borderRadius: radius.lg, backgroundColor: colors.surface, overflow: 'hidden', ...shadow.card },
  restaurantBanner: { height: 132, alignItems: 'center', justifyContent: 'center' },
  restaurantInitials: { fontSize: 34, fontWeight: '800', color: 'rgba(255,255,255,0.92)', letterSpacing: 1 },
  etaBadge: { position: 'absolute', top: 10, left: 10, backgroundColor: 'rgba(15,34,39,0.55)', borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 4 },
  favoriteButton: { position: 'absolute', top: 10, right: 10, width: 30, height: 30, borderRadius: radius.pill, backgroundColor: colors.white, alignItems: 'center', justifyContent: 'center' },
  closedBadge: { position: 'absolute', bottom: 10, left: 10, backgroundColor: colors.danger, borderRadius: radius.sm, paddingHorizontal: 8, paddingVertical: 4 },
  sponsoredBadge: { position: 'absolute', bottom: 10, right: 10, backgroundColor: colors.primary, borderRadius: radius.sm, paddingHorizontal: 8, paddingVertical: 4 },
  restaurantBody: { padding: spacing.md, gap: 2 },

  productRow: { flexDirection: 'row', alignItems: 'center', marginHorizontal: spacing.lg, marginBottom: spacing.md, backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.md, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  productThumbWrap: { width: 76, height: 76 },
  productThumb: { width: 76, height: 76, borderRadius: radius.md },
  productThumbFallback: { backgroundColor: colors.surfaceRaised },
  productHeart: { position: 'absolute', top: -6, left: -6, width: 24, height: 24, borderRadius: radius.pill, backgroundColor: colors.white, alignItems: 'center', justifyContent: 'center' },
  productAdd: { position: 'absolute', bottom: -6, right: -6, width: 26, height: 26, borderRadius: radius.pill, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
});
