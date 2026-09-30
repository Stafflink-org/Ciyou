// Fonctionnalités incluses dans la formule active de l'établissement (StaffLink : équipe,
// planning, pointages, congés, tâches, documents, paie… + marketing : codes promo, fidélité,
// campagnes…). Même logique que le serveur (functions/src/finance/argent/entitlements.ts) :
// une formule sans fonctionnalité listée ne restreint rien (formules vides, décision client).
// `restaurant.planCode` (document public du commerce) évite de dépendre de
// `restaurants/{rid}/private/commercial`, lisible seulement par les membres ayant
// la permission finance.view — tous les membres doivent pouvoir savoir ce que voit le menu.
import { useMemo } from 'react';
import { COLLECTIONS, type Plan, type PlanFeatureKey, type WithId } from '@golink/shared';
import { docAt, useDoc } from '@/lib/firestore';
import { useActiveRestaurant } from './RestaurantAccess';

export interface Entitlements {
  /** Formule active (null tant qu'elle charge ou si le code de formule est introuvable). */
  plan: WithId<Plan> | null;
  loading: boolean;
  /** Vrai si la fonctionnalité est incluse dans la formule active (ou si la formule est vide : aucune restriction). */
  hasFeature: (key: PlanFeatureKey) => boolean;
}

/** Formule active de l'établissement courant et ses fonctionnalités incluses. */
export function useEntitlements(): Entitlements {
  const restaurant = useActiveRestaurant();
  const planState = useDoc<Plan>(restaurant.planCode ? docAt(`${COLLECTIONS.plans}/${restaurant.planCode}`) : null);
  const plan = planState.data ?? null;
  const hasFeature = useMemo(() => {
    const features = plan?.features ?? [];
    return (key: PlanFeatureKey) => features.length === 0 || features.includes(key);
  }, [plan]);
  return { plan, loading: planState.loading, hasFeature };
}
