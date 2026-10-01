// Droits d'un commerce selon son abonnement : fonctionnalités et limites de sa formule, et
// restrictions appliquées pendant un impayé (règles de relance du super admin). Une formule
// sans fonctionnalité listée ne restreint rien (formules vides par décision client) ; une
// limite absente (null) est illimitée.
import { COLLECTIONS, RESTAURANT_PRIVATE_DOCS, SUBCOLLECTIONS, type Plan, type PlanFeatureKey, type RestaurantCommercial } from '@golink/shared';
import { db } from '../../lib/admin';
import { fail } from '../../lib/errors';
import { loadDunning } from './billing';

export type RestrictableFeature = PlanFeatureKey;
export type PlanLimitKey = 'maxProducts' | 'maxStaff' | 'maxPromotions';

interface Entitlements {
  status: RestaurantCommercial['subscriptionStatus'] | null;
  plan: Plan | null;
  restricted: string[];
}

async function load(restaurantId: string): Promise<Entitlements> {
  const commercialSnap = await db.collection(COLLECTIONS.restaurants).doc(restaurantId).collection(SUBCOLLECTIONS.restaurants.private).doc(RESTAURANT_PRIVATE_DOCS.commercial).get();
  const commercial = commercialSnap.data() as RestaurantCommercial | undefined;
  if (!commercial) return { status: null, plan: null, restricted: [] };
  const planSnap = await db.collection(COLLECTIONS.plans).doc(commercial.planCode).get();
  const settings = await loadDunning();
  const impaired = commercial.subscriptionStatus === 'restricted' || commercial.subscriptionStatus === 'suspended';
  return { status: commercial.subscriptionStatus, plan: planSnap.exists ? (planSnap.data() as Plan) : null, restricted: impaired && settings.enabled ? settings.restrictedFeatures : [] };
}

/** Refuse l'accès à une fonctionnalité coupée par l'impayé ou absente de la formule. */
export async function assertFeatureAllowed(restaurantId: string, feature: RestrictableFeature): Promise<void> {
  const e = await load(restaurantId);
  if (e.restricted.includes(feature)) {
    throw fail.precondition('Cette fonction est momentanément restreinte : votre abonnement est impayé. Régularisez-le depuis « Abonnement » pour la retrouver.');
  }
  if (e.plan && e.plan.features.length > 0 && !e.plan.features.includes(feature)) {
    throw fail.precondition(`Votre formule ${e.plan.name} ne comprend pas cette fonction. Changez de formule depuis « Abonnement ».`);
  }
}

/** Refuse la création d'un élément au-delà de la limite de la formule. */
export async function assertWithinLimit(restaurantId: string, key: PlanLimitKey, currentCount: number, label: string): Promise<void> {
  const e = await load(restaurantId);
  const limit = e.plan?.limits?.[key];
  if (limit !== null && limit !== undefined && currentCount >= limit) {
    throw fail.precondition(`Votre formule ${e.plan?.name ?? ''} est limitée à ${limit} ${label}. Changez de formule depuis « Abonnement » pour en ajouter.`.replace('  ', ' '));
  }
}

/**
 * Limite numérique actuelle de la formule pour cette clé (`null` = illimité), pour un traitement
 * ligne à ligne (ex. import CSV) qui doit collecter une erreur par ligne plutôt que lever une
 * exception qui annulerait tout le lot — contrairement à `assertWithinLimit`, pensée pour une
 * création isolée (un seul produit, un seul membre d'équipe…).
 */
export async function planLimitOf(restaurantId: string, key: PlanLimitKey): Promise<number | null> {
  const e = await load(restaurantId);
  return e.plan?.limits?.[key] ?? null;
}

/** Un commerce dont l'abonnement est suspendu ne reçoit plus de nouvelles commandes. */
export async function isSubscriptionSuspended(restaurantId: string): Promise<boolean> {
  const e = await load(restaurantId);
  return e.status === 'suspended';
}
