// Favoris (`FavoritesScreen`, onglet, §18.1, §13 client.md) : lot « favoris » à venir
// (persistance `users/{uid}/favorites`, cf. packages/shared/src/models/users.ts).
import { PlaceholderScreen } from '../shared/PlaceholderScreen';

export function FavoritesScreen() {
  return <PlaceholderScreen icon="❤️" title="Vos favoris" note="Restaurants et plats favoris arriveront dans un prochain lot." />;
}
