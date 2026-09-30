// Règles métier chiffrées réglables depuis le super admin : résolution de la commission,
// imputation des remboursements, remboursement à l'annulation, gestes automatiques
// de retard et seuils déclaratifs DAC7.
import type { FulfillmentMode, PaymentMethod } from '../constants/enums';
import { allocateProRata, applyBps, type Bps, type Cents } from './money';
import type { BillingMode } from './types';

// ---------------------------------------------------------------- Commission

export interface CommissionSources {
  /** Taux du marché pour le mode de la commande (marketCommissionBps). */
  marketBps: Bps;
  /** Taux lié à la formule d'abonnement du restaurant. */
  planBps?: Bps | null;
  /** Taux spécifique à la ville. */
  cityBps?: Bps | null;
  /** Taux négocié pour le restaurant. */
  negotiatedBps?: Bps | null;
  /** Taux négocié pour le groupe du restaurant (après le taux propre au commerce). */
  groupBps?: Bps | null;
  /** Remise commerciale temporaire (offre spéciale), en points retirés du taux. */
  offerReductionBps?: Bps | null;
  /** Mode de facturation effectif : `subscription` = aucune commission. */
  billingMode?: BillingMode | null;
}

/** Origine du taux de commission retenu pour une commande. */
export type CommissionSource = 'negotiated' | 'group' | 'city' | 'plan' | 'market' | 'subscription';

export interface CommissionResolution {
  /** Taux appliqué (offre spéciale déduite). */
  bps: Bps;
  /** Taux avant offre spéciale. */
  baseBps: Bps;
  source: CommissionSource;
  billingMode: BillingMode;
}

/**
 * Priorité (décision client, du plus spécifique au plus général) :
 * négocié pour le commerce > négocié pour son groupe > barème de la ville > taux de la formule > barème du pays,
 * puis offre spéciale temporaire retirée. Une formule qui « hérite » (planBps absent)
 * laisse le barème du pays s'appliquer. En mode `subscription`, aucune commission n'est
 * prélevée sur les ventes ; en mode `hybrid`, la commission et l'abonnement s'additionnent.
 */
export function resolveCommission(sources: CommissionSources): CommissionResolution {
  const billingMode: BillingMode = sources.billingMode ?? 'commission';
  const picks: Array<[CommissionSource, Bps | null | undefined]> = [
    ['negotiated', sources.negotiatedBps],
    ['group', sources.groupBps],
    ['city', sources.cityBps],
    ['plan', sources.planBps],
  ];
  const found = picks.find(([, value]) => value !== null && value !== undefined);
  const source: CommissionSource = found ? found[0] : 'market';
  const baseBps = (found ? found[1] : sources.marketBps) as Bps;
  if (billingMode === 'subscription') return { bps: 0, baseBps, source: 'subscription', billingMode };
  return { bps: Math.max(0, baseBps - (sources.offerReductionBps ?? 0)), baseBps, source, billingMode };
}

/** Clé du taux de commission d'un mode de commande dans un barème (pays, ville, formule). */
export function commissionKeyOf(
  fulfillment: FulfillmentMode,
  deliveredBy: 'platform' | 'restaurant' | 'merchant' | null | undefined,
): 'platformDeliveryBps' | 'restaurantDeliveryBps' | 'pickupBps' | 'dineInBps' {
  if (fulfillment === 'pickup') return 'pickupBps';
  if (fulfillment === 'dine_in') return 'dineInBps';
  return deliveredBy === 'restaurant' || deliveredBy === 'merchant' ? 'restaurantDeliveryBps' : 'platformDeliveryBps';
}

/** Taux seul (compatibilité) : voir `resolveCommission`. */
export function resolveCommissionBps(sources: CommissionSources): Bps {
  return resolveCommission(sources).bps;
}

/** Mode de facturation effectif : commerce > formule > marché (défaut `commission`). */
export function resolveBillingMode(sources: {
  restaurant?: BillingMode | null;
  plan?: BillingMode | null;
  market?: BillingMode | null;
}): BillingMode {
  return sources.restaurant ?? sources.plan ?? sources.market ?? 'commission';
}

/** L'abonnement de la formule est-il facturé dans ce mode ? */
export function billingModeChargesSubscription(mode: BillingMode): boolean {
  return mode !== 'commission';
}

/** Une commission est-elle prélevée sur les ventes dans ce mode ? */
export function billingModeChargesCommission(mode: BillingMode): boolean {
  return mode !== 'subscription';
}

// ---------------------------------------------------------------- Remboursements

export type RefundCause =
  | 'restaurant_error'
  | 'restaurant_cancelled'
  | 'restaurant_timeout'
  | 'item_unavailable'
  | 'missing_item'
  | 'food_quality'
  | 'delivery_late'
  | 'delivery_issue'
  | 'courier_error'
  | 'customer_absent'
  | 'customer_cancelled'
  | 'commercial_gesture'
  | 'platform_error'
  | 'payment_issue'
  /** Vente au poids ou à prix variable : écart entre le montant autorisé et le poids/prix réel constaté à la préparation. */
  | 'weight_adjustment';

export type RefundPayer = 'restaurant' | 'courier' | 'platform';

/** Répartition (en bps) de la charge d'un remboursement selon sa cause. */
export type RefundLiabilityRules = Record<RefundCause, Partial<Record<RefundPayer, Bps>>>;

export const REFUND_CAUSES: readonly RefundCause[] = [
  'restaurant_error',
  'restaurant_cancelled',
  'restaurant_timeout',
  'item_unavailable',
  'missing_item',
  'food_quality',
  'delivery_late',
  'delivery_issue',
  'courier_error',
  'customer_absent',
  'customer_cancelled',
  'commercial_gesture',
  'platform_error',
  'payment_issue',
  'weight_adjustment',
];

/**
 * Décision client : le commerce paie tous les remboursements, quelle qu'en soit la
 * cause (déduits de son prochain reversement). La règle reste paramétrable
 * (`settings/orderRules.refundLiability`).
 */
export const DEFAULT_REFUND_LIABILITY: RefundLiabilityRules = Object.fromEntries(
  REFUND_CAUSES.map((cause) => [cause, { restaurant: 10_000 }]),
) as RefundLiabilityRules;

/** Ancienne répartition par cause (erreurs du commerce au commerce ; livraison et gestes à la plateforme). */
export const CAUSE_BASED_REFUND_LIABILITY: RefundLiabilityRules = {
  restaurant_error: { restaurant: 10_000 },
  restaurant_cancelled: { restaurant: 10_000 },
  restaurant_timeout: { restaurant: 10_000 },
  item_unavailable: { restaurant: 10_000 },
  missing_item: { restaurant: 10_000 },
  food_quality: { restaurant: 10_000 },
  delivery_late: { platform: 10_000 },
  delivery_issue: { platform: 10_000 },
  courier_error: { platform: 10_000 },
  customer_absent: {},
  customer_cancelled: {},
  commercial_gesture: { platform: 10_000 },
  platform_error: { platform: 10_000 },
  payment_issue: { platform: 10_000 },
  weight_adjustment: { restaurant: 10_000 },
};

export interface RefundAllocation {
  restaurantCents: Cents;
  courierCents: Cents;
  platformCents: Cents;
}

/** Impute un remboursement (imputation déduite du prochain reversement de chaque payeur). */
export function allocateRefund(
  amountCents: Cents,
  cause: RefundCause,
  rules: RefundLiabilityRules = DEFAULT_REFUND_LIABILITY,
): RefundAllocation {
  const rule = rules[cause];
  const payers: RefundPayer[] = ['restaurant', 'courier', 'platform'];
  const weights = payers.map((p) => rule[p] ?? 0);
  const covered = weights.reduce((a, b) => a + b, 0);
  // Part non couverte par la règle : supportée par la plateforme.
  const uncovered = Math.max(0, 10_000 - covered);
  const [restaurant, courier, platform] = allocateProRata(amountCents, [
    weights[0],
    weights[1],
    weights[2] + uncovered,
  ]);
  return { restaurantCents: restaurant, courierCents: courier, platformCents: platform };
}

// ---------------------------------------------------------------- Annulation client

export type CancellableStage = 'pending' | 'accepted' | 'preparing' | 'ready' | 'picked_up';

/** Part remboursée (bps) quand le client annule à une étape donnée. */
export type CustomerCancellationPolicy = Record<CancellableStage, Bps | null>;

/** null = annulation impossible à cette étape. */
export const DEFAULT_CUSTOMER_CANCELLATION: CustomerCancellationPolicy = {
  pending: 10_000,
  accepted: 5_000,
  preparing: 0,
  ready: null,
  picked_up: null,
};

export function computeCancellationRefund(
  totalCents: Cents,
  tipCents: Cents,
  stage: CancellableStage,
  policy: CustomerCancellationPolicy = DEFAULT_CUSTOMER_CANCELLATION,
): { allowed: boolean; refundCents: Cents } {
  const rate = policy[stage];
  if (rate === null) return { allowed: false, refundCents: 0 };
  // Le pourboire est toujours rendu : aucune course n'a eu lieu.
  return { allowed: true, refundCents: applyBps(totalCents - tipCents, rate) + tipCents };
}

// ---------------------------------------------------------------- Gestes automatiques

export interface LateCreditTier {
  /** À partir de ce retard (minutes) par rapport à l'heure promise. */
  fromMinutes: number;
  /** Avoir en pourcentage du total (bps), plafonné par `maxCents`. */
  rateBps: Bps;
  maxCents: Cents;
}

export const DEFAULT_LATE_CREDIT_TIERS: readonly LateCreditTier[] = [
  { fromMinutes: 20, rateBps: 1000, maxCents: 500 },
  { fromMinutes: 40, rateBps: 3000, maxCents: 1500 },
];

export function computeLateCredit(
  minutesLate: number,
  totalCents: Cents,
  tiers: readonly LateCreditTier[] = DEFAULT_LATE_CREDIT_TIERS,
): Cents {
  const tier = [...tiers].sort((a, b) => b.fromMinutes - a.fromMinutes).find((t) => minutesLate >= t.fromMinutes);
  return tier ? Math.min(applyBps(totalCents, tier.rateBps), tier.maxCents) : 0;
}

// ---------------------------------------------------------------- Espèces

export interface CashContext {
  fulfillment: FulfillmentMode;
  /** Qui livre : `restaurant` (ou `merchant`) = livreur salarié du commerce. */
  deliveredBy?: 'platform' | 'restaurant' | 'merchant' | null;
  /** Type du livreur assigné, s'il est connu (`restaurant` ou `merchant` = salarié du commerce). */
  driverType?: 'platform' | 'restaurant' | 'merchant' | null;
  /** Interrupteur plateforme, pays ou commerce (settings/payments.cash.enabled). */
  cashEnabled?: boolean;
  /** Espèces acceptées au retrait ou sur place (décision client : non, défaut false). */
  allowOnPickup?: boolean;
}

/** Livreur salarié rattaché au commerce ? */
export function isMerchantCourier(type: string | null | undefined): boolean {
  return type === 'restaurant' || type === 'merchant';
}

/**
 * Décision client : les espèces ne sont proposées que si la livraison est faite par
 * un livreur salarié du commerce ; avec un livreur indépendant Ciyou Eats, le paiement
 * en ligne est obligatoire.
 */
export function isCashAllowed(ctx: CashContext): boolean {
  if (ctx.cashEnabled === false) return false;
  if (ctx.fulfillment !== 'delivery') return ctx.allowOnPickup === true;
  if (!isMerchantCourier(ctx.deliveredBy ?? null)) return false;
  if (ctx.driverType != null && !isMerchantCourier(ctx.driverType)) return false;
  return true;
}

/** Moyens de paiement désactivés par décision client (titres-restaurant). */
export const DISABLED_PAYMENT_METHODS: readonly PaymentMethod[] = ['meal_voucher'];

/** Filtre des moyens de paiement : espèces conditionnelles, titres-restaurant exclus. */
export function allowedPaymentMethodsFor(methods: readonly PaymentMethod[], ctx: CashContext): PaymentMethod[] {
  return methods.filter((m) => !DISABLED_PAYMENT_METHODS.includes(m) && (m !== 'cash' || isCashAllowed(ctx)));
}

// ---------------------------------------------------------------- Règles de commande

/** Règles automatiques issues des décisions client (valeurs par défaut, toutes paramétrables). */
export interface OrderAutomationRules {
  /** Délai d'acceptation avant annulation automatique et remboursement (secondes). */
  acceptanceTimeoutSeconds: number;
  /** Pause automatique après N commandes manquées d'affilée (0 = désactivée). */
  autoPauseAfterMissedOrders: number;
  /** Client absent : attente du livreur (minutes), puis clôture sans remboursement. */
  customerAbsentWaitMinutes: number;
  /** Inactivité : alerte après N jours sans commande, retrait N jours après l'alerte. */
  inactivityAlertDays: number;
  inactivityRemovalDaysAfterAlert: number;
}

export const DEFAULT_ORDER_AUTOMATION: OrderAutomationRules = {
  acceptanceTimeoutSeconds: 300,
  autoPauseAfterMissedOrders: 3,
  customerAbsentWaitMinutes: 10,
  inactivityAlertDays: 15,
  inactivityRemovalDaysAfterAlert: 30,
};

/** Le commerce doit-il être mis en pause automatiquement ? */
export function shouldAutoPauseMerchant(
  consecutiveMissedOrders: number,
  threshold: number = DEFAULT_ORDER_AUTOMATION.autoPauseAfterMissedOrders,
): boolean {
  return threshold > 0 && consecutiveMissedOrders >= threshold;
}

/** Délai d'acceptation dépassé ? (annulation automatique et remboursement intégral du client) */
export function isAcceptanceExpired(
  placedAtMs: number,
  nowMs: number,
  timeoutSeconds: number = DEFAULT_ORDER_AUTOMATION.acceptanceTimeoutSeconds,
): boolean {
  return nowMs - placedAtMs >= timeoutSeconds * 1000;
}

export type InactivityAction = 'none' | 'alert' | 'remove';

/** Action selon le nombre de jours sans commande (alerte à 15 j, retrait 30 j après l'alerte). */
export function merchantInactivityAction(
  daysWithoutOrder: number,
  rules: Pick<OrderAutomationRules, 'inactivityAlertDays' | 'inactivityRemovalDaysAfterAlert'> = DEFAULT_ORDER_AUTOMATION,
): InactivityAction {
  if (daysWithoutOrder >= rules.inactivityAlertDays + rules.inactivityRemovalDaysAfterAlert) return 'remove';
  if (daysWithoutOrder >= rules.inactivityAlertDays) return 'alert';
  return 'none';
}

/** Client absent : aucun remboursement ; livreur et commerce payés normalement. */
export function customerAbsentOutcome(): { refundCents: Cents; payDriver: boolean; payRestaurant: boolean } {
  return { refundCents: 0, payDriver: true, payRestaurant: true };
}

// ---------------------------------------------------------------- DAC7

export type Dac7ActivityKind = 'sale_of_goods' | 'personal_services';

/**
 * Vendeur déclarable ? Pour les ventes de biens, exclusion sous 30 ventes ET 2 000 €
 * dans l'année ; pour les services personnels (livreurs), déclaration dès le premier euro.
 */
export function isDac7Reportable(kind: Dac7ActivityKind, transactionsCount: number, grossCents: Cents): boolean {
  if (transactionsCount === 0 && grossCents === 0) return false;
  if (kind === 'personal_services') return true;
  return transactionsCount >= 30 || grossCents >= 200_000;
}

export interface Dac7Transaction {
  /** Date du paiement (ISO ou Date). */
  paidAt: Date;
  grossCents: Cents;
  /** Commissions et frais retenus par la plateforme. */
  feesCents: Cents;
  /**
   * false pour un ajustement (remboursement imputé au vendeur, `grossCents` négatif) qui
   * réduit le montant déclaré sans compter comme une vente supplémentaire (cahier §16,
   * « les remboursements ne sont pas déduits des montants déclarés » : corrigé pour les
   * commerces, cdc-fix-residuals-3). Par défaut `true` (comportement inchangé).
   */
  countsAsTransaction?: boolean;
}

export interface Dac7Quarter {
  quarter: 1 | 2 | 3 | 4;
  grossCents: Cents;
  feesCents: Cents;
  transactionsCount: number;
}

/** Agrégats trimestriels d'un vendeur pour l'année donnée (fuseau UTC). */
export function aggregateDac7(transactions: readonly Dac7Transaction[], year: number): Dac7Quarter[] {
  const quarters: Dac7Quarter[] = [1, 2, 3, 4].map((q) => ({
    quarter: q as Dac7Quarter['quarter'],
    grossCents: 0,
    feesCents: 0,
    transactionsCount: 0,
  }));
  for (const t of transactions) {
    if (t.paidAt.getUTCFullYear() !== year) continue;
    const q = quarters[Math.floor(t.paidAt.getUTCMonth() / 3)];
    q.grossCents += t.grossCents;
    q.feesCents += t.feesCents;
    if (t.countsAsTransaction !== false) q.transactionsCount += 1;
  }
  return quarters;
}
