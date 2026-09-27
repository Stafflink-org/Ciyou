// Lectures temps réel et état de formulaire partagés par les rubriques de configuration.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { collection, query } from 'firebase/firestore';
import {
  COLLECTIONS,
  DEFAULT_PLANS,
  DEFAULT_PRICING_BY_COUNTRY,
  DISABLED_PAYMENT_METHODS,
  PAYMENT_METHODS,
  mergePricing,
  RESTAURANT_PRIVATE_DOCS,
  paths,
  type City,
  type Country,
  type FeatureFlag,
  type MerchantDeliveryBounds,
  type FeatureKey,
  type PaymentMethod,
  type Plan,
  type PlanCode,
  type RestaurantCommercial,
  type RestaurantSettingsDocId,
} from '@golink/shared';
import { useCan, useRestaurantAccess } from '@/auth/RestaurantAccess';
import { db } from '@/lib/firebase';
import { docAt, useCollection, useDoc } from '@/lib/firestore';

/** Document restaurants/{rid}/settings/{docId} en temps réel. */
export function useRestaurantSettings<T>(docId: RestaurantSettingsDocId) {
  const { restaurantId } = useRestaurantAccess();
  return useDoc<T>(docAt(paths.restaurantSettings(restaurantId, docId)));
}

/** Conditions commerciales (lecture réservée aux membres ayant finance.view). */
export function useCommercial() {
  const { restaurantId } = useRestaurantAccess();
  const can = useCan();
  return useDoc<RestaurantCommercial>(
    can('finance.view') ? docAt(`${paths.restaurant(restaurantId)}/private/${RESTAURANT_PRIVATE_DOCS.commercial}`) : null,
  );
}

export function usePlans() {
  return useCollection<Plan>(query(collection(db, COLLECTIONS.plans)));
}

/** Formule (document plans/{code}, repli sur les valeurs par défaut). */
export function planOf(plans: Array<Plan & { id?: string }>, code: PlanCode) {
  const stored = plans.find((p) => p.code === code || p.id === code);
  const fallback = DEFAULT_PLANS.find((p) => p.code === code) ?? DEFAULT_PLANS[0]!;
  return {
    code,
    name: stored?.name ?? fallback.name,
    monthlyPriceHtCents: stored?.monthlyPriceHtCents ?? fallback.monthlyPriceHtCents,
    trialDays: stored?.trialDays ?? fallback.trialDays,
    commission: stored?.commission ?? fallback.commission,
    maxDeliveryRadiusMeters: stored?.maxDeliveryRadiusMeters ?? fallback.maxDeliveryRadiusMeters,
    includedOutlets: stored?.includedOutlets ?? fallback.includedOutlets,
    features: stored?.features ?? [...fallback.features],
    description: stored?.description ?? '',
    rankingBoost: stored?.rankingBoost ?? fallback.rankingBoost,
    yearlyPriceHtCents: stored?.yearlyPriceHtCents ?? null,
    billingMode: stored?.billingMode ?? fallback.billingMode ?? 'commission',
    commitmentMonths: stored?.commitmentMonths ?? fallback.commitmentMonths ?? 0,
  };
}

/**
 * Limites fixées par GoLink pour l'établissement actif : fonctionnalités
 * activées, moyens de paiement autorisés, rayon maximal de la formule.
 * Le serveur refait les mêmes contrôles (ceux-ci ne servent qu'à l'affichage).
 */
export function useConfigLimits() {
  const { restaurant, restaurantId } = useRestaurantAccess();
  const flags = useCollection<FeatureFlag>(query(collection(db, COLLECTIONS.featureFlags)));
  const country = useDoc<Country>(docAt(`${COLLECTIONS.countries}/${restaurant.countryId}`));
  const city = useDoc<City>(restaurant.cityId ? docAt(`${COLLECTIONS.cities}/${restaurant.cityId}`) : null);
  const commercial = useCommercial();
  const plans = usePlans();

  return useMemo(() => {
    const byKey = new Map(flags.data.map((flag) => [flag.id, flag]));
    const isEnabled = (key: FeatureKey): boolean => {
      const flag = byKey.get(key);
      if (!flag) return true;
      const order: Array<[string, string]> = [
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
    };
    const allowedByCommercial = commercial.data?.allowedPaymentMethods ?? null;
    // Espèces : seulement si le commerce livre avec ses propres livreurs salariés.
    const ownCouriers = restaurant.deliveredBy !== 'platform' && restaurant.fulfillmentModes.includes('delivery');
    const allowedPayments: PaymentMethod[] = PAYMENT_METHODS.filter((method) => {
      if (DISABLED_PAYMENT_METHODS.includes(method)) return false;
      if (method === 'cash' && !ownCouriers) return false;
      if (allowedByCommercial && method !== 'wallet' && !allowedByCommercial.includes(method)) return false;
      if (country.data?.paymentMethods && country.data.paymentMethods[method] === false) return false;
      if ((method === 'card' || method === 'apple_pay' || method === 'google_pay') && !isEnabled('card_payment')) return false;
      if (method === 'cash' && !isEnabled('cash_payment')) return false;
      return true;
    });
    const plan = planOf(plans.data, restaurant.planCode);
    const pricingBase = country.data?.pricing ?? DEFAULT_PRICING_BY_COUNTRY[restaurant.countryId];
    const zoneBounds: MerchantDeliveryBounds = pricingBase ? (mergePricing(pricingBase, city.data?.pricing ?? null).merchantDelivery ?? {}) : {};
    return {
      loading: flags.loading || country.loading || city.loading || plans.loading,
      isEnabled,
      allowedPayments,
      country: country.data,
      plan,
      maxRadiusMeters: Math.min(plan.maxDeliveryRadiusMeters, zoneBounds.maxRadiusMeters ?? Number.MAX_SAFE_INTEGER),
      /** Bornes de la plateforme sur les frais et minimums des zones. */
      zoneBounds,
      ownCouriers,
    };
  }, [flags.data, flags.loading, country.data, country.loading, city.data, city.loading, commercial.data, plans.data, plans.loading, restaurant, restaurantId]);
}

/**
 * Brouillon d'un formulaire initialisé depuis une source temps réel :
 * tant que l'utilisateur n'a rien modifié, le brouillon suit la source.
 */
export function useDraft<T>(source: T | null, resetKey: string) {
  const [draft, setDraft] = useState<T | null>(source);
  const [dirty, setDirty] = useState(false);
  const dirtyRef = useRef(false);
  const key = useRef(resetKey);

  // Suit la source tant qu'aucune modification n'est en cours (pas de retour
  // visuel à l'ancienne valeur juste après un enregistrement).
  useEffect(() => {
    if (key.current !== resetKey) {
      key.current = resetKey;
      dirtyRef.current = false;
      setDirty(false);
      setDraft(source);
      return;
    }
    if (!dirtyRef.current) setDraft(source);
  }, [source, resetKey]);

  const update = useCallback((patch: Partial<T> | ((current: T) => T)) => {
    setDraft((current) => {
      if (current === null) return current;
      return typeof patch === 'function' ? (patch as (c: T) => T)(current) : { ...current, ...patch };
    });
    dirtyRef.current = true;
    setDirty(true);
  }, []);

  const reset = useCallback(() => {
    dirtyRef.current = false;
    setDirty(false);
    setDraft(source);
  }, [source]);

  const markSaved = useCallback(() => {
    dirtyRef.current = false;
    setDirty(false);
  }, []);

  return { draft, setDraft: update, dirty, reset, markSaved };
}

/** Prévient la perte de modifications non enregistrées (fermeture ou rechargement de l'onglet). */
export function useUnsavedGuard(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);
}
