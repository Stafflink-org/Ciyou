// Lectures partagées des rubriques d'exploitation : livreurs, zones, villes du
// périmètre, historique des réglages, appels de fonctions en lecture.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { collection, documentId, limit, orderBy, query, where, type QueryConstraint } from 'firebase/firestore';
import {
  COLLECTIONS,
  type City,
  type Driver,
  type DriverLocation,
  type SettingsHistoryEntry,
  type WithId,
  type Zone,
} from '@golink/shared';
import { useGeoScope } from '@/layout/GeoScope';
import { db } from '@/lib/firebase';
import { useCollection } from '@/lib/firestore';

/** Filtre de ville d'une requête selon le périmètre choisi en barre supérieure. */
export function useCityConstraint(): { constraints: QueryConstraint[]; key: string; cityIds: string[] | null } {
  const geo = useGeoScope();
  return useMemo(() => {
    if (geo.cityIds && geo.cityIds.length > 0) {
      const ids = geo.cityIds.slice(0, 30);
      return { constraints: [ids.length === 1 ? where('cityId', '==', ids[0]) : where('cityId', 'in', ids)], key: ids.join(','), cityIds: ids };
    }
    if (geo.countryId) return { constraints: [where('countryId', '==', geo.countryId)], key: geo.countryId, cityIds: null };
    return { constraints: [], key: 'all', cityIds: null };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geo.cityIds?.join(','), geo.countryId]);
}

/** Livreurs du périmètre (temps réel, 500 au plus). */
export function useScopedDrivers() {
  const { constraints, key } = useCityConstraint();
  const q = useMemo(() => query(collection(db, COLLECTIONS.drivers), ...constraints, limit(500)), [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return useCollection<Driver>(q);
}

/** Zones du périmètre (temps réel). */
export function useScopedZones() {
  const { constraints, key } = useCityConstraint();
  const q = useMemo(() => query(collection(db, COLLECTIONS.zones), ...constraints), [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return useCollection<Zone>(q);
}

/** Positions des livreurs connectés du périmètre (temps réel). */
export function useScopedLocations() {
  const { cityIds, key } = useCityConstraint();
  const geo = useGeoScope();
  const q = useMemo(() => {
    const base = collection(db, COLLECTIONS.driverLocations);
    const available = where('availability', 'in', ['online', 'on_delivery', 'paused']);
    if (cityIds) return query(base, cityIds.length === 1 ? where('cityId', '==', cityIds[0]) : where('cityId', 'in', cityIds), available);
    if (geo.countryId) {
      const ids = geo.cities.filter((c) => c.countryId === geo.countryId).map((c) => c.id).slice(0, 30);
      return ids.length ? query(base, where('cityId', 'in', ids), available) : null;
    }
    return query(base, available);
  }, [key, geo.countryId, geo.cities]); // eslint-disable-line react-hooks/exhaustive-deps
  return useCollection<DriverLocation>(q);
}

/** Villes du périmètre, triées par nom. */
export function useScopedCities(): WithId<City>[] {
  const geo = useGeoScope();
  return useMemo(() => {
    const list = geo.cities.filter((c) => (!geo.countryId || c.countryId === geo.countryId) && (!geo.cityId || c.id === geo.cityId));
    return [...list].sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  }, [geo.cities, geo.countryId, geo.cityId]);
}

/** Noms des villes et des zones (affichage). */
export function useNames() {
  const geo = useGeoScope();
  const zones = useScopedZones().data;
  return useMemo(
    () => ({
      city: (id: string | null | undefined) => (id ? (geo.cities.find((c) => c.id === id)?.name ?? id) : '—'),
      zone: (id: string | null | undefined) => (id ? (zones.find((z) => z.id === id)?.name ?? id) : '—'),
    }),
    [geo.cities, zones],
  );
}

/** Historique des réglages pour une liste de documents (settingsHistory). */
export function useSettingsHistory(docPaths: string[], max = 30) {
  const key = docPaths.join('|');
  const q = useMemo(
    () => (docPaths.length ? query(collection(db, COLLECTIONS.settingsHistory), where('docPath', 'in', docPaths.slice(0, 30)), orderBy('changedAt', 'desc'), limit(max)) : null),
    [key, max], // eslint-disable-line react-hooks/exhaustive-deps
  );
  return useCollection<SettingsHistoryEntry & { changedByName?: string }>(q);
}

/** Plusieurs livreurs par identifiant (lots de 30). */
export function useDriversByIds(ids: string[]) {
  const unique = useMemo(() => [...new Set(ids.filter(Boolean))].sort().slice(0, 30), [ids.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps
  const q = useMemo(() => (unique.length ? query(collection(db, COLLECTIONS.drivers), where(documentId(), 'in', unique)) : null), [unique.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps
  return useCollection<Driver>(q);
}

export interface CallState<T> {
  data: T | null;
  loading: boolean;
  error: unknown;
  reload: () => void;
}

/** Lecture par Cloud Function, relancée quand `key` change. */
export function useCall<I, O>(fn: (input: I) => Promise<O>, input: I | null, key: string): CallState<O> {
  const [state, setState] = useState<{ data: O | null; loading: boolean; error: unknown }>({ data: null, loading: input !== null, error: null });
  const [nonce, setNonce] = useState(0);
  const latest = useRef(0);
  useEffect(() => {
    if (input === null) return;
    const id = ++latest.current;
    setState((s) => ({ ...s, loading: true, error: null }));
    fn(input)
      .then((data) => id === latest.current && setState({ data, loading: false, error: null }))
      .catch((error: unknown) => id === latest.current && setState((s) => ({ ...s, loading: false, error })));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, nonce]);
  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return { ...state, reload };
}

/** Horloge rafraîchie périodiquement (durées écoulées, comptes à rebours). */
export function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);
  return now;
}
