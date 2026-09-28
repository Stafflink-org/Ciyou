// Types du moteur de tarification : configuration d'un marché, entrées d'un panier,
// devis client (ce que paie le client) et répartition (qui reçoit quoi).
import type {
  FulfillmentMode,
  PaymentMethod,
  PromotionFunding,
  PromotionKind,
  VatCategory,
} from '../constants/enums';
import type { Bps, Cents } from './money';
import type { CurrencyCode } from './currency';

/** Qui réalise la livraison : flotte GoLink ou livreurs propres du restaurant. */
export type DeliveredBy = 'platform' | 'restaurant';

/** Qui supporte les frais de paiement (Stripe). */
export type PaymentFeePayer = 'platform' | 'restaurant';

/**
 * Mode de facturation d'un commerce : commission sur les ventes, abonnement seul,
 * ou les deux. Paramétré par formule et surchargeable par commerce.
 */
export type BillingMode = 'commission' | 'subscription' | 'hybrid';
export const BILLING_MODES: readonly BillingMode[] = ['commission', 'subscription', 'hybrid'];

/**
 * Modèle de rémunération des livreurs :
 * - `flat_then_per_km` (décision client) : montant fixe sous le seuil de distance,
 *   au-delà prix au km, plus bonus d'heure de pointe ;
 * - `pickup_dropoff_per_km` (ancien barème) : prise en charge + remise + km + minute.
 */
export type CourierPayModel = 'flat_then_per_km' | 'pickup_dropoff_per_km';

/** Au-delà du seuil : km au-delà du seuil ajoutés au fixe, ou distance totale au km (fixe = plancher). */
export type CourierPerKmMode = 'beyond_threshold' | 'full_distance';

/** Bornes optionnelles fixées par la plateforme sur les conditions de livraison des commerces. */
export interface MerchantDeliveryBounds {
  minFeeCents?: Cents | null;
  maxFeeCents?: Cents | null;
  minOrderFloorCents?: Cents | null;
  minOrderCeilingCents?: Cents | null;
  maxRadiusMeters?: number | null;
}

/** Conditions de la zone de livraison du commerce (restaurants/{rid}/deliveryZones). */
export interface MerchantZoneTerms {
  feeCents: Cents;
  minOrderCents?: Cents | null;
  /** Livraison offerte à partir de ce sous-total. */
  freeAboveCents?: Cents | null;
}

/** Palier de frais de livraison : jusqu'à `upToMeters` inclus, le client paie `feeCents`. */
export interface DeliveryFeeTier {
  upToMeters: number;
  feeCents: Cents;
}

/** Configuration tarifaire d'un marché (pays), surchargée par ville puis par restaurant. */
export interface MarketPricingConfig {
  countryCode: string;
  /** Devise du marché ; tous les montants de la configuration sont en unités mineures de cette devise. */
  currency: CurrencyCode;
  vat: {
    /** Taux normal : commission, frais de service, frais de livraison plateforme. */
    standardBps: Bps;
    /** Taux par catégorie d'article vendu par le restaurant. */
    byCategory: Record<VatCategory, Bps>;
  };
  serviceFee: {
    enabled: boolean;
    rateBps: Bps;
    minCents: Cents;
    maxCents: Cents;
    appliesTo: readonly FulfillmentMode[];
  };
  smallOrderFee: {
    enabled: boolean;
    /** En dessous de ce sous-total, des frais de petite commande s'appliquent. */
    thresholdCents: Cents;
    /** `difference` : le client paie l'écart jusqu'au seuil ; `flat` : montant fixe. */
    mode: 'difference' | 'flat';
    flatCents: Cents;
    maxCents: Cents;
    appliesTo: readonly FulfillmentMode[];
  };
  delivery: {
    tiers: readonly DeliveryFeeTier[];
    /** Distance maximale livrable (au-delà : hors zone). */
    maxDistanceMeters: number;
    /** Livraison offerte au-delà de ce sous-total (null = jamais). */
    freeAboveSubtotalCents: Cents | null;
    /** Majoration maximale autorisée en heure de pointe (15 000 = ×1,5). */
    maxSurgeMultiplierBps: Bps;
  };
  commission: {
    /** Livraison par la flotte GoLink. */
    platformDeliveryBps: Bps;
    /** Livraison par les livreurs du restaurant (marketplace). */
    restaurantDeliveryBps: Bps;
    pickupBps: Bps;
    dineInBps: Bps;
    /**
     * Assiette : sous-total articles TTC payé par le client, après remises financées
     * par le commerce (décision client), ou sous-total brut. Toujours hors livraison et pourboires.
     */
    base: 'subtotal' | 'subtotal_after_restaurant_discount';
    /** Mode de facturation par défaut du marché (surchargé par formule puis par commerce). */
    billingMode?: BillingMode;
  };
  payment: {
    /** Frais carte : pourcentage + fixe (Stripe cartes EEE standard : 1,5 % + 0,25 €). */
    percentBps: Bps;
    fixedCents: Cents;
    /** Frais Stripe Connect sur le volume reversé. */
    connectPercentBps: Bps;
    payer: PaymentFeePayer;
  };
  courier: {
    pickupCents: Cents;
    dropoffCents: Cents;
    perKmCents: Cents;
    perMinuteCents: Cents;
    /** Minimum garanti par course (hors pourboire). */
    minimumPerOrderCents: Cents;
    /** Attente gratuite chez le client avant rémunération de l'attente. */
    freeWaitMinutes: number;
    waitingPerMinuteCents: Cents;
    /** Revenu horaire minimum garanti (hors pourboires), apprécié à la semaine. */
    hourlyGuaranteeCents: Cents;
    /** Garantie horaire active (défaut : active seulement en France). Absent = active si montant > 0. */
    hourlyGuaranteeEnabled?: boolean;
    /** Modèle de rémunération ; absent = ancien barème (`pickup_dropoff_per_km`). */
    model?: CourierPayModel;
    /** Seuil de distance sous lequel la course est payée au forfait (défaut 2 000 m). */
    flatDistanceThresholdMeters?: number;
    /** Forfait des courses courtes. */
    flatAmountCents?: Cents;
    perKmMode?: CourierPerKmMode;
    /** Bonus par course en heure de pointe (s'ajoute aux primes des règles de pointe). */
    peakBonusCents?: Cents;
    /** Heures locales (0 à 23) considérées « heure de pointe » : le bonus s'applique à la commande. */
    peakHours?: number[];
  };
  tips: {
    enabled: boolean;
    presetsCents: readonly Cents[];
    maxCents: Cents;
  };
  promotions: {
    /** Plafond d'une remise créée par un restaurant (en % du sous-total). */
    restaurantMaxPercentBps: Bps;
    /** Plafond appliqué ? (décision client : promotions des commerces sans limite, false). */
    capEnabled?: boolean;
  };
  /** Bornes plateforme des frais et minimums fixés par les commerces sur leurs zones. */
  merchantDelivery?: MerchantDeliveryBounds;
}

/** Ligne de panier telle que reçue par le moteur (prix TTC, options comprises à part). */
export interface QuoteLineInput {
  unitPriceCents: Cents;
  /** Somme des suppléments d'options pour une unité. */
  optionsPriceCents?: Cents;
  quantity: number;
  vatCategory: VatCategory;
  /** Taux de TVA propre à la ligne (commerces non alimentaires : fleurs, parapharmacie…). */
  vatRateBpsOverride?: Bps;
  /** Vente au poids : prix au kg et poids (grammes) ; `unitPriceCents` est alors ignoré. */
  saleUnit?: 'unit' | 'weight' | 'variable';
  pricePerKgCents?: Cents;
  weightGrams?: number;
}

export interface PromotionInput {
  kind: PromotionKind;
  /** Pourcentage en bps pour `percentage`, centimes pour `fixed`, ignoré pour `free_delivery`. */
  value: number;
  /** Plafond de remise (centimes), null = pas de plafond. */
  maxDiscountCents?: Cents | null;
  minSubtotalCents?: Cents;
  funding: PromotionFunding;
  /** Part financée par le restaurant quand `funding = shared` (bps). */
  restaurantShareBps?: Bps;
}

export interface SurgeInput {
  /** Multiplicateur des frais de livraison (12 500 = ×1,25). */
  multiplierBps: Bps;
  /** Supplément fixe ajouté aux frais de livraison. */
  flatCents?: Cents;
  /** Prime versée au livreur pour la course. */
  courierBonusCents?: Cents;
}

export interface QuoteInput {
  lines: readonly QuoteLineInput[];
  fulfillment: FulfillmentMode;
  deliveredBy?: DeliveredBy;
  /** Distance restaurant → client (livraison). */
  distanceMeters?: number;
  /** Paliers propres à la zone ou à la ville (sinon ceux du marché). */
  zoneTiers?: readonly DeliveryFeeTier[];
  /** Frais de livraison imposés (livreurs du restaurant ou tarif négocié). */
  deliveryFeeOverrideCents?: Cents;
  /**
   * Zone de livraison du commerce (décision client : frais et minimum fixés par le commerce).
   * Prioritaire sur les paliers ; ignorée si `deliveryFeeOverrideCents` est fourni.
   */
  merchantZone?: MerchantZoneTerms | null;
  /** Minimum de commande du restaurant ou de la zone. */
  minOrderCents?: Cents;
  surge?: SurgeInput;
  promotion?: PromotionInput;
  tipCents?: Cents;
}

export type QuoteIssueCode =
  | 'empty_cart'
  | 'below_minimum_order'
  | 'out_of_delivery_range'
  | 'distance_required'
  | 'promo_minimum_not_reached'
  | 'tips_disabled'
  | 'tip_above_maximum';

export interface VatLine {
  category: VatCategory | 'platform_fees';
  rateBps: Bps;
  ttcCents: Cents;
  htCents: Cents;
  vatCents: Cents;
}

export interface DiscountBreakdown {
  totalCents: Cents;
  onItemsCents: Cents;
  onDeliveryCents: Cents;
  platformFundedCents: Cents;
  restaurantFundedCents: Cents;
  /** Part de la remise sur articles financée par le restaurant. */
  restaurantOnItemsCents: Cents;
  restaurantOnDeliveryCents: Cents;
}

/** Devis client : tous les montants TTC. */
export interface Quote {
  ok: boolean;
  issues: QuoteIssueCode[];
  fulfillment: FulfillmentMode;
  deliveredBy: DeliveredBy;
  itemsCount: number;
  subtotalCents: Cents;
  serviceFeeCents: Cents;
  smallOrderFeeCents: Cents;
  /** Frais de livraison avant remise, majoration comprise. */
  deliveryFeeCents: Cents;
  /** Part de majoration heure de pointe incluse dans les frais de livraison. */
  surgeFeeCents: Cents;
  discount: DiscountBreakdown;
  tipCents: Cents;
  totalCents: Cents;
  /** TVA des articles (vendus par le restaurant), après remises financées par le restaurant. */
  itemsVat: VatLine[];
  /** Sous-total par catégorie de TVA (avant remise). */
  subtotalByCategory: Partial<Record<VatCategory, Cents>>;
}

export interface SettlementInput {
  quote: Quote;
  paymentMethod: PaymentMethod;
  /** Commission applicable (issue de resolveCommissionBps). */
  commissionBps: Bps;
  /** Données de course (livraison par la flotte GoLink). */
  courier?: {
    distanceMeters: number;
    durationMinutes: number;
    waitingMinutes?: number;
    /** Course en heure de pointe : ajoute `courier.peakBonusCents`. */
    isPeak?: boolean;
  };
  surgeCourierBonusCents?: Cents;
  /** Part du total réglée avec le portefeuille du client : ni frais de carte ni espèces sur cette part. */
  walletAppliedCents?: Cents;
}

export interface CourierPay {
  /** Modèle appliqué (absent sur les anciens documents : ancien barème). */
  model?: CourierPayModel;
  /** Forfait course courte (modèle `flat_then_per_km`). */
  flatCents?: Cents;
  /** Bonus heure de pointe inclus dans `surgeBonusCents`. */
  peakBonusCents?: Cents;
  pickupCents: Cents;
  dropoffCents: Cents;
  distanceCents: Cents;
  timeCents: Cents;
  waitingCents: Cents;
  surgeBonusCents: Cents;
  minimumTopUpCents: Cents;
  /** Gains hors pourboire. */
  earningsCents: Cents;
  tipCents: Cents;
  totalCents: Cents;
}

/** Répartition d'une commande payée. Somme des flux = montant payé par le client. */
export interface Settlement {
  customerPaidCents: Cents;
  restaurant: {
    grossCents: Cents;
    discountFundedCents: Cents;
    commissionBaseCents: Cents;
    commissionBps: Bps;
    commissionHtCents: Cents;
    commissionVatCents: Cents;
    commissionTtcCents: Cents;
    /** Frais de livraison conservés (livreurs propres). */
    deliveryFeeCents: Cents;
    /** Frais de paiement déduits du reversement (ligne dédiée du relevé). */
    paymentFeeCents: Cents;
    /** Pourboire reversé au commerce pour son livreur salarié (100 % au livreur). */
    tipCents?: Cents;
    payoutCents: Cents;
  };
  courier: CourierPay | null;
  payment: {
    method: PaymentMethod;
    processingCents: Cents;
    connectCents: Cents;
    totalCents: Cents;
    payer: PaymentFeePayer;
    /** Espèces encaissées par le livreur, à reverser à la plateforme. */
    cashCollectedCents: Cents;
  };
  platform: {
    serviceFeeHtCents: Cents;
    smallOrderFeeHtCents: Cents;
    deliveryFeeHtCents: Cents;
    commissionHtCents: Cents;
    vatDueCents: Cents;
    courierCostCents: Cents;
    promoCostCents: Cents;
    paymentCostCents: Cents;
    /** Marge nette plateforme (HT) sur la commande. */
    marginCents: Cents;
  };
}
