// Favoris réels (`users/{uid}/favorites`, §13 client.md) — identifiant
// déterministe (`r_{restaurantId}` pour un restaurant, `p_{restaurantId}_{productId}`
// pour un plat, voir packages/shared/src/models/users.ts) : un `setDoc`/`deleteDoc`
// direct suffit, pas de Cloud Function (règles Firestore : create/delete par le
// propriétaire, update interdit — on ne modifie jamais un favori, on le recrée).
import { useCallback, useMemo } from 'react';
import { collection, deleteDoc, doc, serverTimestamp, setDoc } from 'firebase/firestore';
import type { Favorite } from '@golink/shared';
import { db } from '../../lib/firebase';
import { useCollection } from '../../lib/firestore';
import { useAuth } from '../../auth/AuthContext';

export function restaurantFavoriteId(restaurantId: string): string {
  return `r_${restaurantId}`;
}

export function productFavoriteId(restaurantId: string, productId: string): string {
  return `p_${restaurantId}_${productId}`;
}

/** Favoris de l'utilisateur connecté, temps réel (vide et non chargé si déconnecté). */
export function useFavorites() {
  const { user } = useAuth();
  const q = user ? collection(db, `users/${user.uid}/favorites`) : null;
  const { data, loading } = useCollection<Favorite>(q);
  const restaurantIds = useMemo(() => new Set(data.filter((f) => f.type === 'restaurant').map((f) => f.restaurantId)), [data]);
  const productIds = useMemo(() => new Set(data.filter((f) => f.type === 'product').map((f) => f.productId ?? '')), [data]);

  const isFavoriteRestaurant = useCallback((restaurantId: string) => restaurantIds.has(restaurantId), [restaurantIds]);
  const isFavoriteProduct = useCallback((productId: string) => productIds.has(productId), [productIds]);

  const toggleRestaurant = useCallback(
    async (restaurantId: string) => {
      if (!user) return;
      const ref = doc(db, `users/${user.uid}/favorites/${restaurantFavoriteId(restaurantId)}`);
      if (isFavoriteRestaurant(restaurantId)) {
        await deleteDoc(ref);
      } else {
        const favorite: Favorite = { type: 'restaurant', restaurantId, productId: null, createdAt: serverTimestamp() as never };
        await setDoc(ref, favorite);
      }
    },
    [user, isFavoriteRestaurant],
  );

  const toggleProduct = useCallback(
    async (restaurantId: string, productId: string) => {
      if (!user) return;
      const ref = doc(db, `users/${user.uid}/favorites/${productFavoriteId(restaurantId, productId)}`);
      if (isFavoriteProduct(productId)) {
        await deleteDoc(ref);
      } else {
        const favorite: Favorite = { type: 'product', restaurantId, productId, createdAt: serverTimestamp() as never };
        await setDoc(ref, favorite);
      }
    },
    [user, isFavoriteProduct],
  );

  return { data, loading, isFavoriteRestaurant, isFavoriteProduct, toggleRestaurant, toggleProduct };
}
