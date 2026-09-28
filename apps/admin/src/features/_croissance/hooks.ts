// Lectures partagées des rubriques Croissance.
import { useEffect, useMemo, useState } from 'react';
import { collection, orderBy, query } from 'firebase/firestore';
import { COLLECTIONS, type Restaurant } from '@golink/shared';
import { useAdminAccess } from '@/auth/AdminAccess';
import { useGeoScope } from '@/layout/GeoScope';
import { db } from '@/lib/firebase';
import { useCollection } from '@/lib/firestore';
import { getSalesTeam, type SalesRep } from './api';

export interface RestaurantOption {
  id: string;
  name: string;
  cityId: string;
  countryId: string;
  planCode: Restaurant['planCode'];
  status: Restaurant['status'];
}

/** Restaurants (nom, ville, formule) pour les sélecteurs et les libellés. */
export function useRestaurantOptions() {
  const { can } = useAdminAccess();
  const q = useMemo(() => (can('restaurants.view') ? query(collection(db, COLLECTIONS.restaurants), orderBy('name')) : null), [can]);
  const { data, loading, error } = useCollection<Restaurant>(q);
  const options = useMemo<RestaurantOption[]>(
    () =>
      data
        .filter((r) => !r.deletedAt)
        .map((r) => ({ id: r.id, name: r.name, cityId: r.cityId, countryId: r.countryId, planCode: r.planCode, status: r.status })),
    [data],
  );
  const byId = useMemo(() => new Map(options.map((o) => [o.id, o])), [options]);
  return { options, byId, loading, error };
}

/** Villes et pays du périmètre (identifiant → nom). */
export function useGeoNames() {
  const geo = useGeoScope();
  return useMemo(
    () => ({
      city: (id: string | null | undefined) => (id ? (geo.cities.find((c) => c.id === id)?.name ?? id) : ''),
      country: (id: string | null | undefined) => (id ? (geo.countries.find((c) => c.id === id)?.name ?? id) : ''),
    }),
    [geo.cities, geo.countries],
  );
}

let salesTeamCache: Promise<SalesRep[]> | null = null;

/** Commerciaux ayant accès à la prospection (liste mise en cache pour la session). */
export function useSalesTeam(enabled = true) {
  const [reps, setReps] = useState<SalesRep[]>([]);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    salesTeamCache ??= getSalesTeam({}).then((r) => r.reps);
    salesTeamCache
      .then((list) => alive && setReps(list))
      .catch((e: unknown) => {
        salesTeamCache = null;
        if (alive) setError(e);
      })
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [enabled]);
  const byId = useMemo(() => new Map(reps.map((r) => [r.uid, r])), [reps]);
  return { reps, byId, loading, error };
}

/** Horodatage courant, rafraîchi chaque minute (comptes à rebours, statuts dépendants du temps). */
export function useNow(intervalMs = 60_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}
