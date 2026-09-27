// Interrupteurs de fonctionnalités (cahier §24) lus au moment de l'exécution par les
// modules concernés (commande, promotions, fidélité, parrainage, stock, suivi livreur…).
// Portée résolue du plus précis au plus général : commerce > formule > ville > pays > plateforme.
// Une fonctionnalité jamais configurée est considérée comme active.
import { COLLECTIONS, FEATURE_LABELS, type FeatureFlag, type FeatureKey } from '@golink/shared';
import { db } from './admin';
import { fail } from './errors';

export interface FeatureScopeContext {
  restaurantId?: string | null;
  planCode?: string | null;
  cityId?: string | null;
  countryId?: string | null;
}

let cache: { at: number; flags: Map<string, FeatureFlag> } | null = null;
const CACHE_MS = 10_000;

/** Tous les interrupteurs (18 documents), mis en cache 10 secondes par instance. */
export async function loadFeatureFlags(fresh = false): Promise<Map<string, FeatureFlag>> {
  if (!fresh && cache && Date.now() - cache.at < CACHE_MS) return cache.flags;
  const snap = await db.collection(COLLECTIONS.featureFlags).get();
  const flags = new Map(snap.docs.map((doc) => [doc.id, doc.data() as FeatureFlag]));
  cache = { at: Date.now(), flags };
  return flags;
}

export function resolveFeature(flag: FeatureFlag | undefined, scope: FeatureScopeContext): boolean {
  if (!flag) return true;
  const order: Array<[FeatureFlag['overrides'][number]['scope'], string | null | undefined]> = [
    ['restaurant', scope.restaurantId],
    ['plan', scope.planCode],
    ['city', scope.cityId],
    ['country', scope.countryId],
  ];
  for (const [kind, id] of order) {
    if (!id) continue;
    const override = flag.overrides?.find((o) => o.scope === kind && o.scopeId === id);
    if (override) return override.enabled;
  }
  return flag.enabled;
}

export async function isFeatureOn(key: FeatureKey, scope: FeatureScopeContext = {}): Promise<boolean> {
  return resolveFeature((await loadFeatureFlags()).get(key), scope);
}

/** Refuse l'action quand l'interrupteur est éteint pour cette portée. */
export async function assertFeatureOn(key: FeatureKey, scope: FeatureScopeContext = {}, message?: string): Promise<void> {
  if (!(await isFeatureOn(key, scope))) {
    throw fail.precondition(message ?? `« ${FEATURE_LABELS[key]} » n’est pas disponible pour le moment.`);
  }
}

/** Contexte de portée d'un restaurant (pour les modules qui ont déjà chargé sa fiche). */
export function scopeOfRestaurant(restaurant: { id?: string; planCode?: string | null; cityId?: string | null; countryId?: string | null }, restaurantId?: string): FeatureScopeContext {
  return { restaurantId: restaurantId ?? restaurant.id ?? null, planCode: restaurant.planCode ?? null, cityId: restaurant.cityId ?? null, countryId: restaurant.countryId ?? null };
}
