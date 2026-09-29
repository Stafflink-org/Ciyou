// Favoris (`FavoritesScreen`, onglet, §18.1, §13 client.md) — sections
// Restaurants / Plats, lecture réelle de `users/{uid}/favorites` (aucun mock,
// aucun stockage local séparé comme la maquette : le compte fait foi).
import { ScrollView, StyleSheet, View } from 'react-native';
import type { CompositeScreenProps } from '@react-navigation/native';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { MainStackParamList, MainTabsParamList } from '../../navigation/types';
import { docAt, useDoc } from '../../lib/firestore';
import type { Product, Restaurant, WithId } from '@golink/shared';
import { colors, spacing } from '../../theme/tokens';
import { Text } from '../../ui/Text';
import { Skeleton } from '../../ui/Skeleton';
import { PlaceholderScreen } from '../shared/PlaceholderScreen';
import { RestaurantCard, FeaturedProductRow } from '../home/components';
import type { FeaturedProduct } from '../home/hooks';
import { useFavorites } from './hooks';

type Props = CompositeScreenProps<BottomTabScreenProps<MainTabsParamList, 'Favorites'>, NativeStackScreenProps<MainStackParamList>>;

export function FavoritesScreen({ navigation }: Props) {
  const favorites = useFavorites();
  const restaurantFavorites = favorites.data.filter((f) => f.type === 'restaurant');
  const productFavorites = favorites.data.filter((f) => f.type === 'product' && f.productId);

  if (!favorites.loading && favorites.data.length === 0) {
    return (
      <PlaceholderScreen
        icon="🤍"
        title="Vos favoris commencent ici"
        note="Touchez le cœur d'un restaurant ou d'un plat pour le retrouver facilement."
      />
    );
  }

  return (
    <ScrollView style={styles.root} contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xxl }}>
      <Text variant="eyebrow" color="muted">
        TOUT PRÈS DU CŒUR
      </Text>
      <Text variant="title" style={{ marginTop: 4, marginBottom: spacing.md }}>
        Vos favoris
      </Text>

      {favorites.loading ? (
        <View style={{ gap: spacing.md }}>
          <Skeleton style={{ height: 180, borderRadius: 16 }} />
          <Skeleton style={{ height: 180, borderRadius: 16 }} />
        </View>
      ) : (
        <>
          {restaurantFavorites.length > 0 ? (
            <View style={{ marginBottom: spacing.lg }}>
              <Text variant="bodyStrong" style={{ marginBottom: spacing.sm }}>
                Restaurants
              </Text>
              <View style={styles.restaurantGrid}>
                {restaurantFavorites.map((f) => (
                  <FavoriteRestaurantCard key={f.id} restaurantId={f.restaurantId} navigation={navigation} onToggle={() => favorites.toggleRestaurant(f.restaurantId)} />
                ))}
              </View>
            </View>
          ) : null}

          {productFavorites.length > 0 ? (
            <View>
              <Text variant="bodyStrong" style={{ marginBottom: spacing.sm }}>
                Plats
              </Text>
              {productFavorites.map((f) => (
                <FavoriteProductRow
                  key={f.id}
                  restaurantId={f.restaurantId}
                  productId={f.productId as string}
                  navigation={navigation}
                  onToggle={() => favorites.toggleProduct(f.restaurantId, f.productId as string)}
                />
              ))}
            </View>
          ) : null}
        </>
      )}
    </ScrollView>
  );
}

function FavoriteRestaurantCard({ restaurantId, navigation, onToggle }: { restaurantId: string; navigation: Props['navigation']; onToggle: () => void }) {
  const { data: restaurant } = useDoc<Restaurant>(docAt(`restaurants/${restaurantId}`));
  if (!restaurant) return null;
  return (
    <View style={styles.restaurantCardWrap}>
      <RestaurantCard restaurant={restaurant as WithId<Restaurant>} favorite onToggleFavorite={onToggle} onPress={() => navigation.navigate('Restaurant', { restaurantId })} />
    </View>
  );
}

function FavoriteProductRow({ restaurantId, productId, navigation, onToggle }: { restaurantId: string; productId: string; navigation: Props['navigation']; onToggle: () => void }) {
  const { data: product } = useDoc<Product>(docAt(`restaurants/${restaurantId}/products/${productId}`));
  if (!product) return null;
  const featured: FeaturedProduct = { ...(product as WithId<Product>), restaurantId };
  return (
    <FeaturedProductRow
      product={featured}
      favorite
      onToggleFavorite={onToggle}
      onPress={() => navigation.navigate('Product', { productId, restaurantId })}
    />
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.canvas },
  restaurantGrid: { gap: spacing.md },
  restaurantCardWrap: {},
});
