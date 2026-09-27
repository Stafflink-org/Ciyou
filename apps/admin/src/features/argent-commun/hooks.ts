// Hooks communs des rubriques « Argent » : filtre géographique appliqué aux requêtes,
// période d'analyse mémorisée, appels de fonctions en lecture, annuaire des
// commerces et livreurs (noms, villes).
import { useEffect, useMemo, useRef, useState } from 'react';
import { collection, doc, limit, onSnapshot, orderBy, query, where, type QueryConstraint } from 'firebase/firestore';
import { COLLECTIONS, RESTAURANT_PRIVATE_DOCS, SUBCOLLECTIONS, type Driver, type Restaurant, type RestaurantCommercial } from '@golink/shared';
import { useAuth, usePersistentState } from '@golink/web';
import { useCan } from '@/auth/AdminAccess';
import type { GeoScope } from '@/layout/GeoScope';
import { db } from '@/lib/firebase';
import { useCollection } from '@/lib/firestore';
import { addDays, isoDay } from './format';

/** Contraintes Firestore du filtre pays / ville courant (au plus 30 villes par `in`). */
export function scopeConstraints(geo: Pick<GeoScope, 'cityIds' | 'countryId'>, field = 'cityId'): QueryConstraint[] {
  if (geo.cityIds) return geo.cityIds.length ? [where(field, 'in', geo.cityIds.slice(0, 30))] : [where(field, '==', '__aucune__')];
  if (geo.countryId) return [where('countryId', '==', geo.countryId)];
  return [];
}

/** Le document appartient-il au filtre courant ? (filtrage côté client des petites listes) */
export function inGeo(geo: Pick<GeoScope, 'cityIds' | 'countryId'>, doc: { countryId?: string | null; cityId?: string | null }): boolean {
  if (geo.cityIds) return Boolean(doc.cityId && geo.cityIds.includes(doc.cityId));
  if (geo.countryId) return doc.countryId === geo.countryId;
  return true;
}

export type PeriodPreset = '7d' | '30d' | '90d' | 'month' | 'prev_month' | 'ytd' | 'custom';

export interface Period {
  preset: PeriodPreset;
  from: string;
  to: string;
  days: number;
}

function resolve(preset: PeriodPreset, custom: { from: string; to: string } | null, today: string): Period {
  let from = today;
  let to = today;
  switch (preset) {
    case '7d':
      from = addDays(today, -6);
      break;
    case '30d':
      from = addDays(today, -29);
      break;
    case '90d':
      from = addDays(today, -89);
      break;
    case 'month':
      from = `${today.slice(0, 7)}-01`;
      break;
    case 'prev_month': {
      const first = `${today.slice(0, 7)}-01`;
      to = addDays(first, -1);
      from = `${to.slice(0, 7)}-01`;
      break;
    }
    case 'ytd':
      from = `${today.slice(0, 4)}-01-01`;
      break;
    case 'custom':
      from = custom?.from ?? addDays(today, -29);
      to = custom?.to ?? today;
      break;
  }
  const days = Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
  return { preset, from, to, days };
}

/** Période d'analyse des écrans financiers, mémorisée par administrateur. */
export function useFinancePeriod(key: string, fallback: PeriodPreset = '30d') {
  const { user } = useAuth();
  const [stored, setStored] = usePersistentState<{ preset: PeriodPreset; custom: { from: string; to: string } | null }>(
    `golink:admin:argent:${key}:${user?.uid ?? ''}`,
    { preset: fallback, custom: null },
  );
  const today = isoDay(new Date());
  const period = useMemo(() => resolve(stored.preset, stored.custom, today), [stored.preset, stored.custom, today]);
  return {
    period,
    setPreset: (preset: Exclude<PeriodPreset, 'custom'>) => setStored({ preset, custom: null }),
    setCustom: (from: string, to: string) => setStored({ preset: 'custom', custom: { from, to } }),
  };
}

export interface CallableQueryState<T> {
  data: T | null;
  loading: boolean;
  refreshing: boolean;
  error: unknown;
  reload: () => void;
}

/** Lecture via une Cloud Function ; relance quand `key` change, ignore les réponses obsolètes. */
export function useCallableQuery<I, O>(fn: (input: I) => Promise<O>, input: I | null, key: string): CallableQueryState<O> {
  const [state, setState] = useState<{ key: string | null; data: O | null; error: unknown; loading: boolean }>({ key: null, data: null, error: null, loading: input !== null });
  const [nonce, setNonce] = useState(0);
  const inputRef = useRef(input);
  inputRef.current = input;
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const enabled = input !== null;

  useEffect(() => {
    const current = inputRef.current;
    if (current === null) return;
    let cancelled = false;
    setState((prev) => ({ ...prev, loading: true, error: null }));
    const run = (retry: boolean): Promise<O> =>
      fnRef.current(current).catch((error: unknown) => {
        const code = (error as { code?: string } | null)?.code ?? '';
        // Démarrage à froid saturé : une seconde tentative après un court délai.
        if (retry && ['functions/internal', 'functions/unavailable', 'functions/deadline-exceeded'].includes(code)) {
          return new Promise<O>((resolve, reject) => window.setTimeout(() => run(false).then(resolve, reject), 2_500));
        }
        throw error;
      });
    run(true)
      .then((data) => {
        if (!cancelled) setState({ key, data, error: null, loading: false });
      })
      .catch((error: unknown) => {
        if (!cancelled) setState((prev) => ({ ...prev, key, error, loading: false }));
      });
    return () => {
      cancelled = true;
    };
  }, [key, nonce, enabled]);

  return {
    data: state.data,
    loading: state.loading && state.data === null,
    refreshing: state.loading && state.data !== null,
    error: state.error,
    reload: () => setNonce((n) => n + 1),
  };
}

export interface DirectoryEntry {
  id: string;
  name: string;
  cityId: string | null;
  countryId: string | null;
  kind: 'restaurant' | 'driver';
  detail?: string | null;
}

/** Annuaire des commerces et livreurs (noms et villes) pour les listes et les sélecteurs. */
export function useDirectory() {
  const can = useCan();
  const canRestaurants = can('restaurants.view');
  const canDrivers = can('drivers.view');
  const restaurantsQuery = useMemo(() => (canRestaurants ? query(collection(db, COLLECTIONS.restaurants), orderBy('name'), limit(500)) : null), [canRestaurants]);
  const driversQuery = useMemo(() => (canDrivers ? query(collection(db, COLLECTIONS.drivers), limit(1000)) : null), [canDrivers]);
  const restaurants = useCollection<Restaurant>(restaurantsQuery);
  const drivers = useCollection<Driver>(driversQuery);
  return useMemo(() => {
    const byId = new Map<string, DirectoryEntry>();
    for (const r of restaurants.data) byId.set(`restaurant:${r.id}`, { id: r.id, name: r.name, cityId: r.cityId, countryId: r.countryId, kind: 'restaurant', detail: r.address?.city ?? null });
    for (const d of drivers.data) {
      byId.set(`driver:${d.id}`, { id: d.id, name: `${d.firstName} ${d.lastName}`.trim(), cityId: d.cityId ?? null, countryId: d.countryId ?? null, kind: 'driver', detail: d.type === 'platform' ? 'Livreur indépendant' : 'Livreur du commerce' });
    }
    return {
      loading: restaurants.loading || drivers.loading,
      restaurants: restaurants.data,
      drivers: drivers.data,
      get: (kind: 'restaurant' | 'driver', id: string) => byId.get(`${kind}:${id}`) ?? null,
      name: (kind: 'restaurant' | 'driver', id: string) => byId.get(`${kind}:${id}`)?.name ?? id,
    };
  }, [restaurants.data, drivers.data, restaurants.loading, drivers.loading]);
}

/** Conditions commerciales (restaurants/{rid}/private/commercial) de plusieurs commerces, en temps réel, par identifiant. */
export function useCommercials(restaurantIds: readonly string[]) {
  const key = restaurantIds.join('|');
  const [state, setState] = useState<{ key: string; byId: Record<string, RestaurantCommercial | null>; error: unknown }>({ key: '', byId: {}, error: null });
  useEffect(() => {
    if (!key) return;
    const ids = key.split('|');
    const byId: Record<string, RestaurantCommercial | null> = {};
    let error: unknown = null;
    const publish = () => {
      if (Object.keys(byId).length === ids.length) setState({ key, byId: { ...byId }, error });
    };
    const unsubscribes = ids.map((id) =>
      onSnapshot(
        doc(db, COLLECTIONS.restaurants, id, SUBCOLLECTIONS.restaurants.private, RESTAURANT_PRIVATE_DOCS.commercial),
        (snap) => {
          byId[id] = snap.exists() ? (snap.data() as RestaurantCommercial) : null;
          publish();
        },
        (err) => {
          error ??= err;
          byId[id] = null;
          publish();
        },
      ),
    );
    return () => unsubscribes.forEach((u) => u());
  }, [key]);
  return { byId: state.byId, loading: Boolean(key) && state.key !== key, error: state.error };
}
