// Pastille du menu « Ventes & stocks » : nombre de produits en rupture.
import { limit, query, where } from 'firebase/firestore';
import { paths, type Product } from '@golink/shared';
import { useCan, useRestaurantAccess } from '@/auth/RestaurantAccess';
import { collectionAt, useCollection } from '@/lib/firestore';

export function useSoldOutCount(): number | null {
  const { restaurantId } = useRestaurantAccess();
  const allowed = useCan()('menu.view');
  const state = useCollection<Product>(
    allowed ? query(collectionAt(paths.restaurantSub(restaurantId, 'products')), where('stock', '==', 0), limit(99)) : null,
  );
  return allowed && state.data.length > 0 ? state.data.length : null;
}
