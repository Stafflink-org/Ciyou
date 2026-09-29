// Accueil (`HomeScreen`, §18.1) — calqué sur la maquette Replit V2 (client.md §3,
// capture `v2/captures/client/mobile/01-home.png`) : contexte de livraison,
// héros de recherche, types de nourriture, offres, restaurants populaires et
// plats mis en avant. Restaurants et plats viennent de la vraie base
// golink-9f16d (aucune donnée fictive) ; les favoris sont réels (`useFavorites`,
// lot 3, mêmes cœurs que `FavoritesScreen`) ; adresse et mode restent des
// états locaux (lot « adresses dans le tunnel d'achat » hors périmètre —
// voir docs/CONTRAT_MODULES.md).
import { useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import type { CompositeScreenProps } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { MainStackParamList, MainTabsParamList } from '../../navigation/types';
import { useAuth } from '../../auth/AuthContext';
import { colors, spacing } from '../../theme/tokens';
import { Text } from '../../ui/Text';
import { RestaurantCardSkeleton } from '../../ui/Skeleton';
import { useCityRestaurants, useDefaultCity, useFeaturedProducts } from './hooks';
import { useFavorites } from '../favorites/hooks';
import {
  DeliveryContextBar,
  FOOD_TYPES,
  FeaturedProductRow,
  FoodTypeTiles,
  HomeHeader,
  HomeHero,
  OfferCard,
  RestaurantCard,
  SectionHeading,
  type FoodType,
} from './components';

type Props = CompositeScreenProps<BottomTabScreenProps<MainTabsParamList, 'Home'>, NativeStackScreenProps<MainStackParamList>>;

export function HomeScreen({ navigation }: Props) {
  const { user } = useAuth();
  const { city, loading: cityLoading } = useDefaultCity();
  const { data: restaurants, loading: restaurantsLoading } = useCityRestaurants(city?.id ?? null);
  const { data: featuredProducts, loading: productsLoading } = useFeaturedProducts();
  const [mode, setMode] = useState<'delivery' | 'pickup'>('delivery');
  const [query, setQuery] = useState('');
  const favorites = useFavorites();
  const [refreshTick, setRefreshTick] = useState(0);

  const firstName = user?.displayName?.split(' ')[0] ?? '';
  const cityLabel = city?.name ?? '';
  const addressLine = cityLabel ? `${cityLabel}` : 'Choisissez votre ville';

  const goToSearch = (params?: MainTabsParamList['Search']) => navigation.navigate('MainTabs', { screen: 'Search', params } as never);
  const onPressFoodType = (foodType: FoodType) => goToSearch({ foodType: foodType.key });

  const loading = cityLoading || restaurantsLoading;

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={{ paddingBottom: spacing.xxl * 2 }}
      refreshControl={<RefreshControl refreshing={false} onRefresh={() => setRefreshTick((t) => t + 1)} tintColor={colors.primary} />}
      key={refreshTick}
    >
      <HomeHeader
        cityLabel={cityLabel}
        firstName={firstName}
        onOpenNotifications={() => navigation.navigate('Notifications')}
        onOpenCart={() => navigation.navigate('Cart')}
        onOpenMenu={() => navigation.navigate('MainTabs', { screen: 'Profile' } as never)}
      />

      <DeliveryContextBar
        addressLabel="Adresse principale"
        addressLine={addressLine}
        mode={mode}
        onPressAddress={() => navigation.navigate('Addresses')}
        onToggleMode={() => setMode((m) => (m === 'delivery' ? 'pickup' : 'delivery'))}
      />

      <HomeHero addressLine={addressLine} query={query} onChangeQuery={setQuery} onSubmit={() => goToSearch({ query: query || undefined })} />

      <FoodTypeTiles onPress={onPressFoodType} />

      <SectionHeading eyebrow="Petits plaisirs, belles économies" title="Les offres du moment" action={{ label: 'Toutes les offres', onPress: () => navigation.navigate('Promotions') }} />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: spacing.lg }}>
        <OfferCard title="Bienvenue chez Ciyou Eats" description="20 % de remise sur votre première commande, dans les commerces participants." badge="CIYOU20" />
        <OfferCard title="Le plat du quartier" description="Une remise chez une sélection de commerces partenaires ce mois-ci." />
      </ScrollView>

      <SectionHeading eyebrow="Sélection du quartier" title="Restaurants populaires" action={{ label: 'Voir tout', onPress: () => goToSearch() }} />
      {loading ? (
        <View style={{ paddingHorizontal: spacing.lg, gap: spacing.lg }}>
          <RestaurantCardSkeleton />
          <RestaurantCardSkeleton />
        </View>
      ) : restaurants.length === 0 ? (
        <EmptyNote text={city ? 'Aucun commerce actif dans cette ville pour le moment.' : "Aucune ville n'est encore active sur Ciyou Eats."} />
      ) : (
        restaurants
          .slice()
          .sort((a, b) => b.rankingScore - a.rankingScore)
          .map((restaurant) => (
            <RestaurantCard
              key={restaurant.id}
              restaurant={restaurant}
              favorite={favorites.isFavoriteRestaurant(restaurant.id)}
              onToggleFavorite={() => favorites.toggleRestaurant(restaurant.id)}
              onPress={() => navigation.navigate('Restaurant', { restaurantId: restaurant.id })}
            />
          ))
      )}

      <SectionHeading eyebrow="À goûter absolument" title="Les plats qui font envie" />
      {productsLoading ? (
        <View style={{ paddingHorizontal: spacing.lg }}>
          <RestaurantCardSkeleton />
        </View>
      ) : featuredProducts.length === 0 ? (
        <EmptyNote text="Aucun plat mis en avant pour l'instant." />
      ) : (
        featuredProducts.map((product) => (
          <FeaturedProductRow
            key={product.id}
            product={product}
            favorite={favorites.isFavoriteProduct(product.id)}
            onToggleFavorite={() => favorites.toggleProduct(product.restaurantId, product.id)}
            onPress={() => navigation.navigate('Product', { productId: product.id, restaurantId: product.restaurantId })}
          />
        ))
      )}
    </ScrollView>
  );
}

function EmptyNote({ text }: { text: string }) {
  return (
    <View style={{ paddingHorizontal: spacing.lg }}>
      <Text variant="body" color="muted">
        {text}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.canvas },
});

// Types de nourriture réexportés pour la recherche (lot suivant).
export { FOOD_TYPES };
