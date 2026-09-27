// Formules d'abonnement des commerces par défaut (amorçage de la collection `plans`).
// Décision client : Basic, Pro et Premium existent mais sont vides pour l'instant
// (prix 0, aucun contenu, sans engagement, sans essai, délai d'impayé 0) ; tout est
// paramétrable depuis le super admin (prix mensuel et annuel, mode de facturation,
// fonctionnalités, limites, engagement, essai, carte requise, délai avant suspension).
import type { Bps, Cents } from './money';
import type { BillingMode } from './types';

export type PlanCode = 'basic' | 'pro' | 'premium';

/** Limites d'une formule (null = illimité). */
export interface PlanLimits {
  maxProducts?: number | null;
  maxStaff?: number | null;
  maxPromotions?: number | null;
}

export interface PlanDefinition {
  code: PlanCode;
  name: string;
  monthlyPriceHtCents: Cents;
  trialDays: number;
  commission: {
    platformDeliveryBps: Bps;
    restaurantDeliveryBps: Bps;
    pickupBps: Bps;
  };
  /** Bonus de classement dans l'app client (0 = neutre). */
  rankingBoost: number;
  /** Rayon de livraison maximal autorisé. */
  maxDeliveryRadiusMeters: number;
  /** Nombre d'établissements inclus (au-delà : un abonnement par établissement). */
  includedOutlets: number;
  /** Clés de fonctionnalités incluses (voir FEATURE_KEYS). */
  features: readonly string[];
  /** Prix annuel HT (null = pas d'offre annuelle). */
  yearlyPriceHtCents?: Cents | null;
  /** Mode de facturation de la formule (surchargeable par commerce). */
  billingMode?: BillingMode;
  /** Durée d'engagement en mois (0 = sans engagement). */
  commitmentMonths?: number;
  /** Carte bancaire exigée à la souscription (ou au début de l'essai). */
  cardRequired?: boolean;
  /** Délai de grâce après un impayé avant suspension (jours ; 0 = immédiat). */
  gracePeriodDays?: number;
  limits?: PlanLimits;
}

/** Commission par défaut des formules : identique au barème du marché (aucune différenciation). */
const MARKET_COMMISSION = { platformDeliveryBps: 3000, restaurantDeliveryBps: 1500, pickupBps: 1200 } as const;

function emptyPlan(code: PlanCode, name: string): PlanDefinition {
  return {
    code,
    name,
    monthlyPriceHtCents: 0,
    yearlyPriceHtCents: 0,
    trialDays: 0,
    billingMode: 'commission',
    commitmentMonths: 0,
    cardRequired: false,
    gracePeriodDays: 0,
    commission: { ...MARKET_COMMISSION },
    rankingBoost: 0,
    maxDeliveryRadiusMeters: 9000,
    includedOutlets: 1,
    features: [],
    limits: { maxProducts: null, maxStaff: null, maxPromotions: null },
  };
}

export const DEFAULT_PLANS: readonly PlanDefinition[] = [
  emptyPlan('basic', 'Basic'),
  emptyPlan('pro', 'Pro'),
  emptyPlan('premium', 'Premium'),
];
