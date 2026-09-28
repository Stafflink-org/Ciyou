// Fiche restaurant (`RestaurantScreen`, §18.1, §5 client.md) — menu, options,
// avis : lot « fiche restaurant / produit » à venir. Lit déjà le vrai document
// Firestore (nom, note, image) pour que la coquille ne soit pas vide.
import { ScrollView, Image, View, StyleSheet } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { MainStackParamList } from '../../navigation/types';
import { useDoc, docAt } from '../../lib/firestore';
import type { Restaurant } from '@golink/shared';
import { paths } from '@golink/shared';
import { colors, spacing, radius } from '../../theme/tokens';
import { Text } from '../../ui/Text';
import { Badge } from '../../ui/Badge';
import { PlaceholderScreen } from '../shared/PlaceholderScreen';

type Props = NativeStackScreenProps<MainStackParamList, 'Restaurant'>;

export function RestaurantScreen({ route }: Props) {
  const { restaurantId } = route.params;
  const { data: restaurant, loading } = useDoc<Restaurant>(docAt(paths.restaurant(restaurantId)));

  if (!loading && !restaurant) {
    return <PlaceholderScreen icon="🏬" title="Commerce introuvable" />;
  }

  return (
    <ScrollView style={styles.root} contentContainerStyle={{ paddingBottom: spacing.xxl }}>
      {restaurant?.cover?.url ? <Image source={{ uri: restaurant.cover.url }} style={styles.cover} /> : <View style={[styles.cover, styles.coverFallback]} />}
      <View style={styles.body}>
        <Text variant="title">{restaurant?.name ?? '…'}</Text>
        <View style={styles.metaRow}>
          <Badge label={`★ ${(restaurant?.rating.average ?? 0).toFixed(1)}`} tone="primary" />
          <Badge label={`${restaurant?.etaMinutes.min ?? 20}–${restaurant?.etaMinutes.max ?? 35} min`} tone="neutral" />
          <Badge label={restaurant?.isOpen ? 'Ouvert' : 'Fermé'} tone={restaurant?.isOpen ? 'success' : 'danger'} />
        </View>
        <Text variant="body" color="muted" style={{ marginTop: spacing.md }}>
          {restaurant?.description ?? 'Menu et fiche complète disponibles au prochain lot.'}
        </Text>
      </View>
      <PlaceholderScreen icon="📋" title="Menu à venir" note="La liste des produits, options et le panier arrivent dans le lot « fiche produit / panier »." />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.canvas },
  cover: { width: '100%', height: 200 },
  coverFallback: { backgroundColor: colors.surfaceRaised },
  body: { padding: spacing.lg, gap: spacing.xs, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, backgroundColor: colors.canvas, marginTop: -radius.xl },
  metaRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
});
