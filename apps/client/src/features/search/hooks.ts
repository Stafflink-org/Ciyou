// Recherche réelle (§4 client.md, adaptée au modèle Firestore réel — voir
// docs/CONTRAT_MODULES.md §10) : restaurants et plats de la ville active,
// filtrés par mot-clé (`searchKeywords`, préfixes déjà indexés) et par cuisine
// (`cuisineCategories`, remplace la liste figée à 45 catégories de la maquette,
// qui n'existe pas dans le modèle réel — les plats sont classés par section
// propre à chaque restaurant, pas par une taxonomie globale).
import { useEffect, useState } from 'react';
import { collection, collectionGroup, limit, onSnapshot, query, where, type FirestoreError } from 'firebase/firestore';
import { COLLECTIONS, SUBCOLLECTIONS, normalizeText, type CuisineCategory, type Product, type Restaurant, type WithId } from '@golink/shared';
import { db } from '../../lib/firebase';
import { useCollection } from '../../lib/firestore';

export function useCuisineCategories(): { data: WithId<CuisineCategory>[]; loading: boolean } {
  const q = query(collection(db, COLLECTIONS.cuisineCategories), where('active', '==', true), limit(30));
  const { data, loading } = useCollection<CuisineCategory>(q);
  return { data: data.slice().sort((a, b) => a.order - b.order), loading };
}

export interface SearchProduct extends WithId<Product> {
  restaurantId: string;
}

/** Premier mot normalisé d'une saisie : suffit à interroger `searchKeywords` (préfixes déjà indexés). */
function firstToken(text: string): string | null {
  const normalized = normalizeText(text);
  const word = normalized.split(/[\s,@.'’-]+/)[0] ?? '';
  return word.length >= 2 ? word : null;
}

/** Un résultat correspond-il vraiment à la saisie complète (le token ne filtre que sur le premier mot) ? */
export function matchesQuery(searchKeywords: string[], text: string): boolean {
  const normalized = normalizeText(text).replace(/\s+/g, ' ').trim();
  if (!normalized) return true;
  return normalized.split(' ').every((word) => searchKeywords.some((k) => k.startsWith(word) || word.startsWith(k)));
}

export function useSearchRestaurants(cityId: string | null, searchText: string, cuisineId: string | null): { data: WithId<Restaurant>[]; loading: boolean; error: FirestoreError | null } {
  const [state, setState] = useState<{ data: WithId<Restaurant>[]; loading: boolean; error: FirestoreError | null }>({ data: [], loading: false, error: null });

  useEffect(() => {
    if (!cityId) {
      setState({ data: [], loading: false, error: null });
      return;
    }
    const token = firstToken(searchText);
    const clauses = [where('cityId', '==', cityId), where('status', '==', 'active')] as const;
    const q = token
      ? query(collection(db, COLLECTIONS.restaurants), ...clauses, where('searchKeywords', 'array-contains', token), limit(40))
      : cuisineId
        ? query(collection(db, COLLECTIONS.restaurants), ...clauses, where('cuisineIds', 'array-contains', cuisineId), limit(40))
        : query(collection(db, COLLECTIONS.restaurants), ...clauses, limit(40));
    setState((s) => ({ ...s, loading: true }));
    return onSnapshot(
      q,
      (snap) => {
        let rows = snap.docs.map((d) => ({ ...(d.data() as Restaurant), id: d.id }));
        if (token) rows = rows.filter((r) => matchesQuery(r.searchKeywords, searchText));
        if (cuisineId) rows = rows.filter((r) => r.cuisineIds.includes(cuisineId));
        setState({ data: rows, loading: false, error: null });
      },
      (error) => setState({ data: [], loading: false, error }),
    );
  }, [cityId, searchText, cuisineId]);

  return state;
}

/**
 * Plats correspondant à la recherche, tous restaurants confondus (`collectionGroup`, comme
 * `useFeaturedProducts` du lot 1). Limite connue : le produit ne porte pas l'identifiant de
 * ville, le filtrage par ville se fait donc après coup, sur la liste des restaurants de la
 * ville déjà chargée (`restaurantIdsInCity`) — comme le lot 1 l'a déjà accepté pour l'accueil.
 */
export function useSearchProducts(
  restaurantIdsInCity: string[] | null,
  searchText: string,
  cuisineId: string | null,
  cuisineRestaurantIds: string[] | null,
): { data: SearchProduct[]; loading: boolean; error: FirestoreError | null } {
  const [state, setState] = useState<{ data: SearchProduct[]; loading: boolean; error: FirestoreError | null }>({ data: [], loading: false, error: null });
  const token = firstToken(searchText);

  useEffect(() => {
    if (!restaurantIdsInCity || (!token && !cuisineId)) {
      setState({ data: [], loading: false, error: null });
      return;
    }
    const cityIdSet = new Set(restaurantIdsInCity);
    const cuisineIdSet = cuisineRestaurantIds ? new Set(cuisineRestaurantIds) : null;
    const q = token
      ? query(collectionGroup(db, SUBCOLLECTIONS.restaurants.products), where('available', '==', true), where('searchKeywords', 'array-contains', token), limit(60))
      : query(collectionGroup(db, SUBCOLLECTIONS.restaurants.products), where('available', '==', true), limit(60));
    setState((s) => ({ ...s, loading: true }));
    return onSnapshot(
      q,
      (snap) => {
        let rows = snap.docs
          .map((d) => ({ ...(d.data() as Product), id: d.id, restaurantId: d.ref.parent.parent?.id ?? '' }))
          .filter((p) => cityIdSet.has(p.restaurantId) && (p.stock === null || p.stock > 0));
        if (token) rows = rows.filter((p) => matchesQuery(p.searchKeywords, searchText));
        if (cuisineIdSet) rows = rows.filter((p) => cuisineIdSet.has(p.restaurantId));
        setState({ data: rows, loading: false, error: null });
      },
      (error) => setState({ data: [], loading: false, error }),
    );
  }, [restaurantIdsInCity ? restaurantIdsInCity.join(',') : null, token, searchText, cuisineId, cuisineRestaurantIds ? cuisineRestaurantIds.join(',') : null]);

  return state;
}
