// Recherche (`SearchScreen`, §18.1, §4 client.md) — recherche instantanée réelle
// (Firestore golink-9f16d) de restaurants et de plats de la ville active, filtres
// « Tout/Restaurants/Plats » et cuisine (adaptation documentée dans
// docs/CONTRAT_MODULES.md §10 : le modèle réel n'a pas la liste figée à 45
// catégories de la maquette, remplacée par la vraie taxonomie `cuisineCategories`).
import { useEffect, useState } from 'react';
import { FlatList, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import type { CompositeScreenProps } from '@react-navigation/native';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { MainStackParamList, MainTabsParamList } from '../../navigation/types';
import { colors, radius, spacing } from '../../theme/tokens';
import { Text } from '../../ui/Text';
import { Input } from '../../ui/Input';
import { RestaurantCardSkeleton } from '../../ui/Skeleton';
import { useDefaultCity, useCityRestaurants } from '../home/hooks';
import { RestaurantCard, FeaturedProductRow } from '../home/components';
import { FOOD_TYPES } from '../home/HomeScreen';
import { useCuisineCategories, useSearchProducts, useSearchRestaurants } from './hooks';
import { FloatingCartButton } from '../cart/FloatingCartButton';

type Props = CompositeScreenProps<BottomTabScreenProps<MainTabsParamList, 'Search'>, NativeStackScreenProps<MainStackParamList>>;

type Kind = 'all' | 'restaurants' | 'dishes';

export function SearchScreen({ route, navigation }: Props) {
  const { city } = useDefaultCity();
  const [text, setText] = useState(route.params?.query ?? '');
  const [foodTypeKey, setFoodTypeKey] = useState<string | null>(route.params?.foodType ?? null);
  const [kind, setKind] = useState<Kind>('all');
  const [cuisineId, setCuisineId] = useState<string | null>(null);

  // Un type d'envie choisi depuis l'accueil vaut recherche sur son libellé (§4 : « Une envie de
  // burgers ? » + bouton pour retirer le filtre) tant qu'il n'y a pas de taxonomie de plats dédiée.
  const foodType = FOOD_TYPES.find((f) => f.key === foodTypeKey) ?? null;
  const effectiveText = foodType ? foodType.label : text;

  useEffect(() => {
    if (route.params?.query !== undefined) setText(route.params.query ?? '');
    if (route.params?.foodType !== undefined) setFoodTypeKey(route.params.foodType ?? null);
  }, [route.params?.query, route.params?.foodType]);

  const { data: cuisines } = useCuisineCategories();
  const { data: cityRestaurants } = useCityRestaurants(city?.id ?? null);
  const cityRestaurantIds = cityRestaurants.map((r) => r.id);

  const searchActive = effectiveText.trim().length > 0 || cuisineId !== null;
  const { data: restaurants, loading: restaurantsLoading } = useSearchRestaurants(city?.id ?? null, searchActive ? effectiveText : '', cuisineId);
  const cuisineRestaurantIds = cuisineId ? restaurants.map((r) => r.id) : null;
  const { data: products, loading: productsLoading } = useSearchProducts(cityRestaurantIds, effectiveText, cuisineId, cuisineRestaurantIds);

  // Sans recherche ni filtre : on affiche les commerces de la ville (comme l'accueil) plutôt que
  // rien, pour un écran qui ne soit jamais vide au premier affichage.
  const restaurantResults = searchActive ? restaurants : cityRestaurants;
  const productResults = searchActive ? products : [];
  const loading = restaurantsLoading || productsLoading;

  const showRestaurants = kind !== 'dishes';
  const showDishes = kind !== 'restaurants';
  const totalCount = (showRestaurants ? restaurantResults.length : 0) + (showDishes ? productResults.length : 0);

  const clearFilters = () => {
    setText('');
    setFoodTypeKey(null);
    setKind('all');
    setCuisineId(null);
  };

  return (
    <View style={styles.root}>
      <ScrollView contentContainerStyle={{ paddingBottom: spacing.xxl * 2 }}>
        <View>
            <View style={styles.headerBlock}>
              <Text variant="eyebrow" color="muted">
                TROUVEZ VOTRE PROCHAIN REPAS
              </Text>
              <Text variant="title" style={{ marginTop: 2 }}>
                Explorer {city?.name ?? '…'}
              </Text>
            </View>

            <View style={styles.searchRow}>
              <View style={{ flex: 1 }}>
                <Input
                  placeholder="Un plat, un restaurant, une envie…"
                  value={foodType ? '' : text}
                  onChangeText={(v) => {
                    setText(v);
                    if (foodTypeKey) setFoodTypeKey(null);
                  }}
                  editable={!foodType}
                  testID="input-search"
                />
              </View>
              {text || foodType ? (
                <Pressable
                  testID="button-clear-search"
                  onPress={() => {
                    setText('');
                    setFoodTypeKey(null);
                  }}
                  style={styles.clearButton}
                >
                  <Text variant="bodyStrong">✕</Text>
                </Pressable>
              ) : null}
            </View>

            {foodType ? (
              <View style={styles.foodTypePill}>
                <Text variant="bodyStrong">
                  {foodType.emoji} Une envie de {foodType.label.toLowerCase()} ?
                </Text>
                <Pressable testID="button-clear-food-type" onPress={() => setFoodTypeKey(null)}>
                  <Text variant="bodyStrong" color="primary">
                    Retirer
                  </Text>
                </Pressable>
              </View>
            ) : null}

            <View style={styles.filterRow}>
              {(
                [
                  ['all', 'Tout'],
                  ['restaurants', 'Restaurants'],
                  ['dishes', 'Plats'],
                ] as const
              ).map(([key, label]) => (
                <Pressable key={key} testID={`button-filter-kind-${key === 'dishes' ? 'Plats' : key === 'restaurants' ? 'Restaurants' : 'Tout'}`} onPress={() => setKind(key)} style={[styles.kindChip, kind === key && styles.kindChipActive]}>
                  <Text variant="bodyStrong" style={{ color: kind === key ? colors.primaryFg : colors.fg }}>
                    {label}
                  </Text>
                </Pressable>
              ))}
            </View>

            {cuisines.length > 0 ? (
              <FlatList
                horizontal
                showsHorizontalScrollIndicator={false}
                data={[{ id: null, name: { fr: 'Toutes cuisines' } }, ...cuisines]}
                keyExtractor={(item) => item.id ?? 'all'}
                contentContainerStyle={{ paddingHorizontal: spacing.lg, gap: spacing.sm }}
                renderItem={({ item }) => (
                  <Pressable onPress={() => setCuisineId(item.id)} style={[styles.cuisineChip, cuisineId === item.id && styles.cuisineChipActive]} testID="select-category">
                    <Text variant="caption" style={{ color: cuisineId === item.id ? colors.primaryFg : colors.fgMuted }}>
                      {item.name.fr}
                    </Text>
                  </Pressable>
                )}
                style={{ marginTop: spacing.sm }}
              />
            ) : null}

            <Text variant="caption" color="muted" style={styles.countLine}>
              {loading ? 'Recherche…' : `${totalCount} résultat${totalCount > 1 ? 's' : ''}`}
            </Text>

            {!loading && totalCount === 0 ? (
              <View style={styles.emptyBlock}>
                <Text variant="subtitle">Rien trouvé pour le moment</Text>
                <Text variant="body" color="muted" style={{ marginTop: 4 }}>
                  Essayez un autre mot-clé ou retirez un filtre.
                </Text>
                <Pressable testID="button-empty-action" onPress={clearFilters} style={styles.emptyButton}>
                  <Text variant="bodyStrong" style={{ color: colors.primaryFg }}>
                    Effacer les filtres
                  </Text>
                </Pressable>
              </View>
            ) : null}

            {loading ? (
              <View style={{ paddingHorizontal: spacing.lg, gap: spacing.lg }}>
                <RestaurantCardSkeleton />
                <RestaurantCardSkeleton />
              </View>
            ) : (
              <>
                {showRestaurants && restaurantResults.length > 0 ? (
                  <View>
                    <Text variant="bodyStrong" style={styles.blockTitle}>
                      Restaurants
                    </Text>
                    {restaurantResults
                      .slice()
                      .sort((a, b) => Number(b.sponsored) - Number(a.sponsored) || b.rankingScore - a.rankingScore)
                      .map((restaurant) => (
                        <RestaurantCard
                          key={restaurant.id}
                          restaurant={restaurant}
                          favorite={false}
                          onToggleFavorite={() => undefined}
                          onPress={() => navigation.navigate('Restaurant', { restaurantId: restaurant.id })}
                        />
                      ))}
                  </View>
                ) : null}

                {showDishes && productResults.length > 0 ? (
                  <View>
                    <Text variant="bodyStrong" style={styles.blockTitle}>
                      Plats
                    </Text>
                    {productResults
                      .slice()
                      .sort((a, b) => Number(b.featured) - Number(a.featured))
                      .map((product) => (
                        <FeaturedProductRow
                          key={`${product.restaurantId}-${product.id}`}
                          product={product}
                          favorite={false}
                          onToggleFavorite={() => undefined}
                          onPress={() => navigation.navigate('Product', { productId: product.id, restaurantId: product.restaurantId })}
                        />
                      ))}
                  </View>
                ) : null}
              </>
            )}
        </View>
      </ScrollView>
      <FloatingCartButton />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.canvas },
  headerBlock: { paddingHorizontal: spacing.lg, paddingTop: spacing.md },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.lg, marginTop: spacing.md },
  clearButton: { padding: spacing.sm },
  foodTypePill: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginHorizontal: spacing.lg,
    marginTop: spacing.sm,
    padding: spacing.md,
    backgroundColor: colors.primarySoft,
    borderRadius: radius.md,
  },
  filterRow: { flexDirection: 'row', gap: spacing.sm, paddingHorizontal: spacing.lg, marginTop: spacing.md },
  kindChip: { paddingVertical: 8, paddingHorizontal: spacing.md, borderRadius: radius.pill, backgroundColor: colors.surfaceRaised },
  kindChipActive: { backgroundColor: colors.ink },
  cuisineChip: { paddingVertical: 6, paddingHorizontal: spacing.md, borderRadius: radius.pill, backgroundColor: colors.surfaceRaised },
  cuisineChipActive: { backgroundColor: colors.primary },
  countLine: { paddingHorizontal: spacing.lg, marginTop: spacing.lg, marginBottom: spacing.xs },
  emptyBlock: { alignItems: 'center', paddingHorizontal: spacing.lg, paddingVertical: spacing.xxl },
  emptyButton: { marginTop: spacing.md, backgroundColor: colors.primary, paddingHorizontal: spacing.lg, paddingVertical: 10, borderRadius: radius.pill },
  blockTitle: { paddingHorizontal: spacing.lg, marginTop: spacing.sm, marginBottom: spacing.xs },
});
