// Contexte de configuration d'un établissement : fiche, conditions commerciales,
// marché, formule et fonctionnalités activées. Sert de référence aux contrôles
// des réglages (les limites de la plateforme priment sur les choix du restaurant).
import {
  COLLECTIONS,
  DEFAULT_PLANS,
  DEFAULT_PRICING_BY_COUNTRY,
  DISABLED_PAYMENT_METHODS,
  PAYMENT_METHODS,
  mergePricing,
  RESTAURANT_PRIVATE_DOCS,
  SUBCOLLECTIONS,
  type City,
  type Country,
  type FeatureFlag,
  type MerchantDeliveryBounds,
  type FeatureKey,
  type PaymentMethod,
  type Plan,
  type PlanCode,
  type Restaurant,
  type RestaurantCommercial,
} from '@golink/shared';
import type { DocumentReference, Transaction } from 'firebase-admin/firestore';
import { db } from '../lib/admin';
import { fail } from '../lib/errors';

/** Déclencheurs des réglages : faible trafic, instances limitées (quota CPU régional partagé). */
export const CONFIG_TRIGGER_OPTIONS = { maxInstances: 5, cpu: 'gcf_gen1' } as const;

/** Fonctions appelables des réglages : mêmes limites, appel public (l'accès est contrôlé dans la fonction). */
export const CONFIG_FUNCTION_OPTIONS = { ...CONFIG_TRIGGER_OPTIONS, invoker: 'public' } as const;

export function restaurantRef(restaurantId: string): DocumentReference {
  return db.collection(COLLECTIONS.restaurants).doc(restaurantId);
}

export function restaurantSubRef(
  restaurantId: string,
  sub: keyof typeof SUBCOLLECTIONS.restaurants,
  docId: string,
): DocumentReference {
  return restaurantRef(restaurantId).collection(SUBCOLLECTIONS.restaurants[sub]).doc(docId);
}

export function commercialRef(restaurantId: string): DocumentReference {
  return restaurantSubRef(restaurantId, 'private', RESTAURANT_PRIVATE_DOCS.commercial);
}

export function legalRef(restaurantId: string): DocumentReference {
  return restaurantSubRef(restaurantId, 'private', RESTAURANT_PRIVATE_DOCS.legal);
}

export async function loadRestaurant(restaurantId: string, tx?: Transaction): Promise<Restaurant> {
  const ref = restaurantRef(restaurantId);
  const snap = tx ? await tx.get(ref) : await ref.get();
  if (!snap.exists) throw fail.notFound('Restaurant');
  return snap.data() as Restaurant;
}

/** Fonctionnalité active pour ce restaurant (restaurant > formule > ville > pays > plateforme). */
export function featureEnabled(flag: FeatureFlag | undefined, restaurantId: string, restaurant: Restaurant): boolean {
  if (!flag) return true;
  const order: Array<[FeatureFlag['overrides'][number]['scope'], string | null | undefined]> = [
    ['restaurant', restaurantId],
    ['plan', restaurant.planCode],
    ['city', restaurant.cityId],
    ['country', restaurant.countryId],
  ];
  for (const [scope, id] of order) {
    const override = flag.overrides?.find((o) => o.scope === scope && o.scopeId === id);
    if (override) return override.enabled;
  }
  return flag.enabled;
}

export interface ConfigContext {
  restaurant: Restaurant;
  commercial: RestaurantCommercial | null;
  country: Country | null;
  city: City | null;
  flags: Map<string, FeatureFlag>;
  plan: Pick<Plan, 'code' | 'name' | 'maxDeliveryRadiusMeters' | 'monthlyPriceHtCents' | 'trialDays' | 'commission'>;
  isEnabled: (key: FeatureKey) => boolean;
}

export async function loadPlan(code: PlanCode): Promise<Plan | null> {
  const snap = await db.collection(COLLECTIONS.plans).doc(code).get();
  return snap.exists ? (snap.data() as Plan) : null;
}

export function fallbackPlan(code: PlanCode) {
  const plan = DEFAULT_PLANS.find((p) => p.code === code) ?? DEFAULT_PLANS[0]!;
  return {
    code: plan.code,
    name: plan.name,
    maxDeliveryRadiusMeters: plan.maxDeliveryRadiusMeters,
    monthlyPriceHtCents: plan.monthlyPriceHtCents,
    trialDays: plan.trialDays,
    commission: plan.commission,
  };
}

export async function loadConfigContext(restaurantId: string, restaurant?: Restaurant): Promise<ConfigContext> {
  const resolved = restaurant ?? (await loadRestaurant(restaurantId));
  const [commercialSnap, countrySnap, citySnap, flagsSnap, plan] = await Promise.all([
    commercialRef(restaurantId).get(),
    db.collection(COLLECTIONS.countries).doc(resolved.countryId).get(),
    resolved.cityId ? db.collection(COLLECTIONS.cities).doc(resolved.cityId).get() : Promise.resolve(null),
    db.collection(COLLECTIONS.featureFlags).get(),
    loadPlan(resolved.planCode),
  ]);
  const flags = new Map(flagsSnap.docs.map((d) => [d.id, d.data() as FeatureFlag]));
  return {
    restaurant: resolved,
    commercial: commercialSnap.exists ? (commercialSnap.data() as RestaurantCommercial) : null,
    country: countrySnap.exists ? (countrySnap.data() as Country) : null,
    city: citySnap?.exists ? (citySnap.data() as City) : null,
    flags,
    plan: plan ?? fallbackPlan(resolved.planCode),
    isEnabled: (key) => featureEnabled(flags.get(key), restaurantId, resolved),
  };
}

/** Modes de commande restant proposés une fois appliqués les interrupteurs de fonctionnalités (§24). */
export function enabledFulfillmentModes(ctx: Pick<ConfigContext, 'isEnabled'>, modes: Restaurant['fulfillmentModes']): Restaurant['fulfillmentModes'] {
  return modes.filter((mode) => ctx.isEnabled(mode === 'delivery' ? 'delivery' : mode === 'pickup' ? 'pickup' : 'dine_in'));
}

/**
 * Moyens de paiement que la plateforme autorise pour ce restaurant. Décisions du
 * client : titres-restaurant désactivés ; espèces seulement quand le commerce livre
 * avec ses propres livreurs salariés (le choix par commande reste fait par isCashAllowed).
 */
export function allowedPaymentMethods(ctx: ConfigContext): PaymentMethod[] {
  const commercial = ctx.commercial?.allowedPaymentMethods;
  const ownCouriers = (ctx.restaurant.deliveredBy ?? 'platform') !== 'platform' && ctx.restaurant.fulfillmentModes?.includes('delivery') !== false;
  return PAYMENT_METHODS.filter((method) => {
    if (DISABLED_PAYMENT_METHODS.includes(method)) return false;
    if (method === 'cash' && !ownCouriers) return false;
    // L'avoir GoLink est un moyen de la plateforme : seul le pays peut le désactiver.
    if (commercial && method !== 'wallet' && !commercial.includes(method)) return false;
    if (ctx.country && ctx.country.paymentMethods && ctx.country.paymentMethods[method] === false) return false;
    if ((method === 'card' || method === 'apple_pay' || method === 'google_pay') && !ctx.isEnabled('card_payment')) return false;
    if (method === 'cash' && !ctx.isEnabled('cash_payment')) return false;
    return true;
  });
}

/**
 * Bornes fixées par la plateforme sur les zones de livraison des commerces
 * (tarification du pays surchargée par la ville). Valeurs absentes : pas de borne.
 */
export function merchantDeliveryBounds(ctx: ConfigContext): MerchantDeliveryBounds {
  const base = ctx.country?.pricing ?? DEFAULT_PRICING_BY_COUNTRY[ctx.restaurant.countryId];
  if (!base) return {};
  return mergePricing(base, ctx.city?.pricing ?? null).merchantDelivery ?? {};
}

/** Différences entre deux objets plats (pour l'audit : seuls les champs modifiés). */
export function diff(
  before: Record<string, unknown> | null | undefined,
  after: Record<string, unknown>,
): { before: Record<string, unknown>; after: Record<string, unknown>; changed: string[] } {
  const changed = Object.keys(after).filter((key) => JSON.stringify(before?.[key] ?? null) !== JSON.stringify(after[key] ?? null));
  return {
    before: Object.fromEntries(changed.map((key) => [key, before?.[key] ?? null])),
    after: Object.fromEntries(changed.map((key) => [key, after[key] ?? null])),
    changed,
  };
}
