// Commission d'une commande : priorité négocié > ville > formule > pays, mode de
// facturation (commission, abonnement, les deux) et offre spéciale temporaire.
// Tout vient de la base (barèmes versionnés, formule, conditions du commerce).
import {
  COLLECTIONS,
  type CommissionRule,
  DEFAULT_PLANS,
  commissionKeyOf,
  marketCommissionBps,
  resolveBillingMode,
  resolveCommission,
  type CommissionResolution,
  type FulfillmentMode,
  type MarketPricingConfig,
  type Plan,
  type PlanCode,
  type RestaurantCommercial,
} from '@golink/shared';
import { db } from '../lib/admin';
import type { Market } from './context';

/** Barème négocié en cours pour un groupe de commerces (le plus récent non clos). */
export async function loadGroupRule(groupId: string | null | undefined, nowMs: number): Promise<CommissionRule | null> {
  if (!groupId) return null;
  const snap = await db.collection(COLLECTIONS.commissionRules).where('scope', '==', 'group').where('scopeId', '==', groupId).orderBy('validFrom', 'desc').limit(3).get();
  const rule = snap.docs.map((d) => d.data() as CommissionRule).find((r) => r.validFrom.toMillis() <= nowMs && (!r.validTo || r.validTo.toMillis() > nowMs));
  return rule ?? null;
}

export type PlanRates = Pick<Plan, 'commission' | 'commissionInherit' | 'billingMode'>;

export async function loadPlan(planCode: string): Promise<PlanRates | null> {
  const snap = await db.collection(COLLECTIONS.plans).doc(planCode).get();
  if (snap.exists) return snap.data() as Plan;
  const fallback = DEFAULT_PLANS.find((p) => p.code === (planCode as PlanCode));
  return fallback ? { commission: fallback.commission, billingMode: fallback.billingMode } : null;
}

/** Résolution complète du taux, avec l'origine et le mode de facturation retenus. */
export function resolveOrderCommission(input: {
  fulfillment: FulfillmentMode;
  deliveredBy: 'platform' | 'restaurant';
  config: MarketPricingConfig;
  market: Market;
  plan: PlanRates | null;
  commercial: RestaurantCommercial | null;
  groupRule?: CommissionRule | null;
  nowMs: number;
}): CommissionResolution {
  const { fulfillment, deliveredBy, config, market, plan, commercial, groupRule, nowMs } = input;
  const key = commissionKeyOf(fulfillment, deliveredBy);
  // Formules et barèmes négociés n'ont pas de taux « sur place » : ils reprennent celui du retrait.
  const planKey = key === 'dineInBps' ? 'pickupBps' : key;
  const negotiatedRule = commercial?.negotiatedCommission;
  const negotiatedValid = negotiatedRule && (!negotiatedRule.validUntil || negotiatedRule.validUntil.toMillis() > nowMs);
  const negotiatedBps = negotiatedValid ? ((negotiatedRule as Record<string, unknown>)[planKey] as number | null | undefined) ?? null : null;
  const groupBps = groupRule ? ((groupRule as unknown as Record<string, number | null | undefined>)[planKey] ?? null) : null;
  const offer = commercial?.specialOffer && commercial.specialOffer.endsAt.toMillis() > nowMs ? commercial.specialOffer.commissionReductionBps : null;
  // Barème de la ville : surcharge explicite du barème du pays (règle de portée « ville »).
  const cityRates = market.city?.pricing?.commission as Partial<Record<typeof key, number>> | undefined;
  const cityBps = cityRates?.[key] ?? market.city?.commissionOverrideBps ?? null;
  const planBps = plan && !plan.commissionInherit ? (plan.commission as Record<string, number | null | undefined>)[planKey] ?? null : null;
  const billingMode = resolveBillingMode({
    restaurant: commercial?.billingMode ?? null,
    plan: plan?.billingMode ?? null,
    market: config.commission.billingMode ?? null,
  });
  return resolveCommission({ marketBps: marketCommissionBps(fulfillment, deliveredBy, config), planBps, cityBps, negotiatedBps, groupBps, offerReductionBps: offer, billingMode });
}
