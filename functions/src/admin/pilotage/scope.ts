// Périmètre géographique des requêtes de pilotage : les filtres reçus (pays, villes)
// sont recoupés avec le périmètre de l'administrateur (admins/{uid}.countryIds / cityIds).
import { COLLECTIONS, type AdminUser, type City, type Country } from '@golink/shared';
import { db } from '../../lib/admin';
import { fail } from '../../lib/errors';

export interface CityInfo {
  id: string;
  name: string;
  countryId: string;
  active: boolean;
  timezone: string;
}

export interface Markets {
  cities: Map<string, CityInfo>;
  countries: Map<string, { id: string; name: string; currency: string }>;
}

let cache: { at: number; value: Markets } | null = null;

/** Villes et pays (mis en cache 5 minutes par instance). */
export async function loadMarkets(): Promise<Markets> {
  if (cache && Date.now() - cache.at < 5 * 60_000) return cache.value;
  const [cities, countries] = await Promise.all([db.collection(COLLECTIONS.cities).get(), db.collection(COLLECTIONS.countries).get()]);
  const value: Markets = {
    cities: new Map(
      cities.docs.map((doc) => {
        const c = doc.data() as City;
        return [doc.id, { id: doc.id, name: c.name, countryId: c.countryId, active: c.active, timezone: c.timezone ?? 'Europe/Paris' }];
      }),
    ),
    countries: new Map(
      countries.docs.map((doc) => {
        const c = doc.data() as Country;
        return [doc.id, { id: doc.id, name: c.name, currency: c.currency ?? 'EUR' }];
      }),
    ),
  };
  cache = { at: Date.now(), value };
  return value;
}

export interface ResolvedScope {
  /** Villes à filtrer ; null = aucune restriction (toute la plateforme). */
  cityIds: string[] | null;
  countryId: string | null;
  /** Portée statsDaily correspondante. */
  statsScope: { scope: 'platform' | 'country' | 'city'; ids: string[] };
  markets: Markets;
}

/**
 * Recoupe le filtre demandé avec le périmètre de l'administrateur. Un responsable de
 * ville ne peut jamais sortir de ses villes ; un filtre hors périmètre est refusé.
 */
export async function resolveScope(admin: AdminUser, requested: { countryId?: string | null; cityIds?: string[] | null }): Promise<ResolvedScope> {
  const markets = await loadMarkets();
  const allCities = [...markets.cities.values()];
  const cityScoped = admin.role !== 'super_admin' && admin.cityIds.length > 0;
  const countryScoped = admin.role !== 'super_admin' && admin.countryIds.length > 0;
  const allowed = allCities.filter(
    (c) => (!cityScoped || admin.cityIds.includes(c.id)) && (!countryScoped || admin.countryIds.includes(c.countryId)),
  );

  const countryId = requested.countryId ?? null;
  if (countryId && countryScoped && !admin.countryIds.includes(countryId)) throw fail.forbidden('Ce pays est hors de votre périmètre.');

  let cityIds: string[] | null = null;
  if (requested.cityIds && requested.cityIds.length > 0) {
    for (const id of requested.cityIds) {
      if (!allowed.some((c) => c.id === id)) throw fail.forbidden('Cette ville est hors de votre périmètre.');
    }
    cityIds = [...new Set(requested.cityIds)];
  } else if (cityScoped || countryScoped) {
    cityIds = allowed.filter((c) => !countryId || c.countryId === countryId).map((c) => c.id);
  } else if (countryId) {
    cityIds = allowed.filter((c) => c.countryId === countryId).map((c) => c.id);
  }
  if (cityIds && cityIds.length > 30) cityIds = cityIds.slice(0, 30);

  let statsScope: ResolvedScope['statsScope'];
  if (requested.cityIds && requested.cityIds.length > 0) statsScope = { scope: 'city', ids: cityIds ?? [] };
  else if (cityScoped || countryScoped) statsScope = { scope: 'city', ids: cityIds ?? [] };
  else if (countryId) statsScope = { scope: 'country', ids: [countryId] };
  else statsScope = { scope: 'platform', ids: ['all'] };

  return { cityIds, countryId, statsScope, markets };
}

/** Découpe une liste en paquets (limite de 30 valeurs des filtres `in`). */
export function chunks<T>(list: T[], size = 30): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

export function cityAllowed(scope: ResolvedScope, cityId: string | null | undefined): boolean {
  if (!scope.cityIds) return true;
  return Boolean(cityId && scope.cityIds.includes(cityId));
}
