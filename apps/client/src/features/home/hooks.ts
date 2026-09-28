// Données réelles de l'accueil (Firestore, base golink-9f16d) : villes actives,
// restaurants d'une ville, plats mis en avant. Pas de mock : ce que l'accueil
// affiche vient de la vraie base, comme les back-offices.
import { useEffect, useState } from 'react';
import { collection, collectionGroup, limit, onSnapshot, query, where, type FirestoreError } from 'firebase/firestore';
import { COLLECTIONS, SUBCOLLECTIONS, type City, type Product, type Restaurant, type WithId } from '@golink/shared';
import { db } from '../../lib/firebase';
import { useCollection, withId } from '../../lib/firestore';

/**
 * Ville de travail de l'accueil : la première ville active (tri alphabétique,
 * fait côté client) tant qu'il n'y a pas de sélecteur d'adresse (lot
 * « adresses », à venir — voir docs/CONTRAT_MODULES.md). Suffisant pour
 * afficher de vraies données en lot 1.
 *
 * Pas de `orderBy` dans la requête : une égalité sur `active` combinée à un tri
 * sur `name` demanderait un index composite dédié (`cities` n'en a pas) ; le
 * tri se fait donc en mémoire sur les quelques villes actives (peu nombreuses).
 */
export function useDefaultCity(): { city: WithId<City> | null; loading: boolean } {
  const citiesQuery = query(collection(db, COLLECTIONS.cities), where('active', '==', true), limit(20));
  const { data, loading } = useCollection<City>(citiesQuery);
  const sorted = data.slice().sort((a, b) => a.name.localeCompare(b.name));
  return { city: sorted[0] ?? null, loading };
}

/** Restaurants actifs d'une ville, comme `useCityRestaurants` des back-offices (même requête, même index). */
export function useCityRestaurants(cityId: string | null) {
  const restaurantsQuery = cityId ? query(collection(db, COLLECTIONS.restaurants), where('cityId', '==', cityId), where('status', '==', 'active'), limit(20)) : null;
  return useCollection<Restaurant>(restaurantsQuery);
}

export interface FeaturedProduct extends WithId<Product> {
  restaurantId: string;
}

/**
 * Plats mis en avant (`featured=true`, disponibles) tous restaurants confondus
 * d'une ville — section « Les plats qui font envie » de l'accueil. Requête en
 * groupe de collections (`products` sous chaque restaurant) : l'identifiant du
 * restaurant n'est pas stocké sur le produit, on le lit sur le chemin du document.
 */
export function useFeaturedProducts(limitCount = 6): { data: FeaturedProduct[]; loading: boolean; error: FirestoreError | null } {
  const [state, setState] = useState<{ data: FeaturedProduct[]; loading: boolean; error: FirestoreError | null }>({ data: [], loading: true, error: null });

  useEffect(() => {
    const q = query(collectionGroup(db, SUBCOLLECTIONS.restaurants.products), where('available', '==', true), where('featured', '==', true), limit(limitCount));
    return onSnapshot(
      q,
      (snap) => {
        const data = snap.docs.map((d) => ({ ...withId<Product>(d), restaurantId: d.ref.parent.parent?.id ?? '' }));
        setState({ data, loading: false, error: null });
      },
      (error) => setState({ data: [], loading: false, error }),
    );
  }, [limitCount]);

  return state;
}
