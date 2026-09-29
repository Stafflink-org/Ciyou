// Données réelles de la fiche restaurant (§5 client.md) : sections, produits,
// offres automatiques actives (§9). Sous-collections de `restaurants/{rid}`.
import { collection, orderBy, query, where } from 'firebase/firestore';
import { SUBCOLLECTIONS, type MenuSection, type Product, type ProductOffer } from '@golink/shared';
import { db } from '../../lib/firebase';
import { useCollection } from '../../lib/firestore';

export function useMenuSections(restaurantId: string | null) {
  const q = restaurantId ? query(collection(db, `restaurants/${restaurantId}/${SUBCOLLECTIONS.restaurants.sections}`), where('enabled', '==', true)) : null;
  const { data, loading } = useCollection<MenuSection>(q);
  return { data: data.slice().sort((a, b) => a.order - b.order), loading };
}

export function useMenuProducts(restaurantId: string | null) {
  const q = restaurantId ? query(collection(db, `restaurants/${restaurantId}/${SUBCOLLECTIONS.restaurants.products}`), orderBy('order', 'asc')) : null;
  return useCollection<Product>(q);
}

export function useActiveProductOffers(restaurantId: string | null) {
  const q = restaurantId ? query(collection(db, `restaurants/${restaurantId}/${SUBCOLLECTIONS.restaurants.productOffers}`), where('active', '==', true)) : null;
  return useCollection<ProductOffer>(q);
}
