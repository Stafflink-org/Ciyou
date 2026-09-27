// Valeurs par défaut des marchés de lancement (FR, BE, LU, DZ, MA, TN). Elles sont
// réglables depuis le super admin (countries, cities) : ce fichier ne sert que
// d'amorçage et de référence. Décisions du client : docs/DECISIONS_CLIENT.md ;
// justification des valeurs : docs/MODELE_ECONOMIQUE.md.
// Montants en unités mineures de la devise du marché (centimes, millimes pour TND).
import type { MarketPricingConfig } from './types';

/**
 * France. Décisions client appliquées : frais de service 0, pas de frais de petite
 * commande plateforme, frais de paiement déduits du reversement du commerce,
 * livreur au forfait sous 2 km puis au km, promotions des commerces sans plafond.
 */
export const DEFAULT_PRICING_FR: MarketPricingConfig = {
  countryCode: 'FR',
  currency: 'EUR',
  vat: {
    standardBps: 2000,
    byCategory: { food: 1000, soft_drink: 1000, alcohol: 2000, grocery: 550 },
  },
  serviceFee: { enabled: false, rateBps: 0, minCents: 0, maxCents: 0, appliesTo: ['delivery'] },
  smallOrderFee: {
    enabled: false,
    thresholdCents: 1000,
    mode: 'difference',
    flatCents: 200,
    maxCents: 300,
    appliesTo: ['delivery'],
  },
  delivery: {
    // Repli quand le commerce n'a pas de zone : les frais et le minimum sont fixés
    // par le commerce sur ses zones (restaurants/{rid}/deliveryZones).
    tiers: [
      { upToMeters: 1500, feeCents: 99 },
      { upToMeters: 3000, feeCents: 199 },
      { upToMeters: 5000, feeCents: 299 },
      { upToMeters: 7000, feeCents: 399 },
      { upToMeters: 9000, feeCents: 499 },
    ],
    maxDistanceMeters: 9000,
    freeAboveSubtotalCents: null,
    maxSurgeMultiplierBps: 15000,
  },
  commission: {
    platformDeliveryBps: 3000,
    restaurantDeliveryBps: 1500,
    pickupBps: 1200,
    dineInBps: 1200,
    base: 'subtotal_after_restaurant_discount',
    billingMode: 'commission',
  },
  payment: { percentBps: 150, fixedCents: 25, connectPercentBps: 25, payer: 'restaurant' },
  courier: {
    model: 'flat_then_per_km',
    flatDistanceThresholdMeters: 2000,
    flatAmountCents: 400,
    perKmMode: 'beyond_threshold',
    peakBonusCents: 100,
    // Déjeuner (12-14h) et dîner (19-21h) : heures de forte demande par défaut.
    peakHours: [12, 13, 19, 20],
    // Ancien barème (modèle `pickup_dropoff_per_km`), conservé pour compatibilité.
    pickupCents: 200,
    dropoffCents: 100,
    perKmCents: 80,
    perMinuteCents: 0,
    minimumPerOrderCents: 300,
    freeWaitMinutes: 5,
    waitingPerMinuteCents: 20,
    hourlyGuaranteeCents: 1900,
    hourlyGuaranteeEnabled: true,
  },
  tips: { enabled: true, presetsCents: [100, 200, 300, 500], maxCents: 5000 },
  promotions: { restaurantMaxPercentBps: 10_000, capEnabled: false },
  merchantDelivery: { minFeeCents: null, maxFeeCents: null, minOrderFloorCents: null, minOrderCeilingCents: null, maxRadiusMeters: null },
};

const EUR_TIERS_HIGH = [
  { upToMeters: 1500, feeCents: 149 },
  { upToMeters: 3000, feeCents: 249 },
  { upToMeters: 5000, feeCents: 349 },
  { upToMeters: 7000, feeCents: 449 },
  { upToMeters: 9000, feeCents: 549 },
];

/** Luxembourg (TVA 17 % / 3 %). */
export const DEFAULT_PRICING_LU: MarketPricingConfig = {
  ...DEFAULT_PRICING_FR,
  countryCode: 'LU',
  vat: {
    standardBps: 1700,
    byCategory: { food: 300, soft_drink: 300, alcohol: 1700, grocery: 300 },
  },
  delivery: { ...DEFAULT_PRICING_FR.delivery, tiers: EUR_TIERS_HIGH },
  courier: {
    ...DEFAULT_PRICING_FR.courier,
    flatAmountCents: 450,
    pickupCents: 250,
    dropoffCents: 150,
    perKmCents: 90,
    minimumPerOrderCents: 400,
    hourlyGuaranteeEnabled: false,
  },
};

/** Belgique (TVA 21 % ; plats à emporter ou livrés 6 %, à faire valider). */
export const DEFAULT_PRICING_BE: MarketPricingConfig = {
  ...DEFAULT_PRICING_FR,
  countryCode: 'BE',
  vat: {
    standardBps: 2100,
    byCategory: { food: 600, soft_drink: 600, alcohol: 2100, grocery: 600 },
  },
  delivery: { ...DEFAULT_PRICING_FR.delivery, tiers: EUR_TIERS_HIGH },
  courier: {
    ...DEFAULT_PRICING_FR.courier,
    flatAmountCents: 450,
    perKmCents: 90,
    minimumPerOrderCents: 400,
    hourlyGuaranteeCents: 0,
    hourlyGuaranteeEnabled: false,
  },
};

/** Base des marchés du Maghreb : pas de Stripe (prestataire local), pas de garantie horaire. */
function maghrebMarket(
  countryCode: 'DZ' | 'MA' | 'TN',
  currency: MarketPricingConfig['currency'],
  vat: MarketPricingConfig['vat'],
  unit: number,
): MarketPricingConfig {
  // `unit` = unités mineures pour une unité « de référence » du marché, utilisée
  // pour dériver les montants par défaut (à ajuster dans le super admin).
  const u = (n: number) => Math.round(n * unit);
  return {
    ...DEFAULT_PRICING_FR,
    countryCode,
    currency,
    vat,
    smallOrderFee: { ...DEFAULT_PRICING_FR.smallOrderFee, thresholdCents: u(10), flatCents: u(2), maxCents: u(3) },
    delivery: {
      ...DEFAULT_PRICING_FR.delivery,
      tiers: [
        { upToMeters: 1500, feeCents: u(1) },
        { upToMeters: 3000, feeCents: u(1.5) },
        { upToMeters: 5000, feeCents: u(2) },
        { upToMeters: 7000, feeCents: u(2.5) },
        { upToMeters: 9000, feeCents: u(3) },
      ],
    },
    // Prestataire de paiement local : taux indicatif, sans part fixe ni Connect.
    payment: { percentBps: 200, fixedCents: 0, connectPercentBps: 0, payer: 'restaurant' },
    courier: {
      ...DEFAULT_PRICING_FR.courier,
      flatAmountCents: u(2),
      peakBonusCents: u(0.5),
      pickupCents: u(1),
      dropoffCents: u(0.5),
      perKmCents: u(0.4),
      minimumPerOrderCents: u(2),
      waitingPerMinuteCents: 0,
      hourlyGuaranteeCents: 0,
      hourlyGuaranteeEnabled: false,
    },
    tips: { enabled: true, presetsCents: [u(0.5), u(1), u(2)], maxCents: u(20) },
  };
}

/** Algérie (DZD, 1 DA = 100 centimes). TVA 19 % / 9 % : à faire valider. Référence : 100 DA. */
export const DEFAULT_PRICING_DZ: MarketPricingConfig = maghrebMarket(
  'DZ',
  'DZD',
  { standardBps: 1900, byCategory: { food: 1900, soft_drink: 1900, alcohol: 1900, grocery: 900 } },
  100 * 100,
);

/** Maroc (MAD, 1 DH = 100 centimes). TVA 20 %, restauration 10 %, 7 % : à faire valider. Référence : 10 DH. */
export const DEFAULT_PRICING_MA: MarketPricingConfig = maghrebMarket(
  'MA',
  'MAD',
  { standardBps: 2000, byCategory: { food: 1000, soft_drink: 1000, alcohol: 2000, grocery: 700 } },
  10 * 100,
);

/** Tunisie (TND, 1 DT = 1 000 millimes). TVA 19 %, 13 %, 7 % : à faire valider. Référence : 3 DT. */
export const DEFAULT_PRICING_TN: MarketPricingConfig = maghrebMarket(
  'TN',
  'TND',
  { standardBps: 1900, byCategory: { food: 1300, soft_drink: 1300, alcohol: 1900, grocery: 700 } },
  3 * 1000,
);

export const DEFAULT_PRICING_BY_COUNTRY: Readonly<Record<string, MarketPricingConfig>> = {
  FR: DEFAULT_PRICING_FR,
  BE: DEFAULT_PRICING_BE,
  LU: DEFAULT_PRICING_LU,
  DZ: DEFAULT_PRICING_DZ,
  MA: DEFAULT_PRICING_MA,
  TN: DEFAULT_PRICING_TN,
};

/** Taux de TVA par défaut dont la validation par un expert-comptable reste à obtenir. */
export const VAT_DEFAULTS_TO_VALIDATE: Readonly<Record<string, string>> = {
  FR: 'Taux connus (20 %, 10 %, 5,5 %) ; confirmer 20 % sur les services de la plateforme.',
  BE: 'Plats à emporter ou livrés 6 % (réforme 2026 discutée), boissons sans alcool 6 % ou 21 % selon le sucre ajouté.',
  LU: 'Taux connus (17 %, 3 %).',
  DZ: 'Taux normal 19 %, réduit 9 % : taux de la restauration livrée à confirmer.',
  MA: 'Taux normal 20 %, restauration 10 %, certains produits 7 % : à confirmer.',
  TN: 'Taux normal 19 %, réduits 13 % et 7 % : taux de la restauration livrée à confirmer.',
};


/** Surcharge partielle d'une configuration (ville, formule, restaurant). */
export type PricingOverride = {
  [K in keyof MarketPricingConfig]?: MarketPricingConfig[K] extends readonly unknown[]
    ? MarketPricingConfig[K]
    : MarketPricingConfig[K] extends object
      ? Partial<MarketPricingConfig[K]>
      : MarketPricingConfig[K];
};

/** Fusionne des surcharges successives (marché → ville → restaurant) sur une configuration. */
export function mergePricing(
  base: MarketPricingConfig,
  ...overrides: ReadonlyArray<PricingOverride | null | undefined>
): MarketPricingConfig {
  let result: MarketPricingConfig = base;
  for (const override of overrides) {
    if (!override) continue;
    const next = { ...result } as Record<string, unknown>;
    for (const [key, value] of Object.entries(override)) {
      if (value === undefined) continue;
      const current = next[key];
      next[key] =
        value !== null && typeof value === 'object' && !Array.isArray(value) && typeof current === 'object'
          ? { ...(current as object), ...(value as object) }
          : value;
    }
    result = next as unknown as MarketPricingConfig;
  }
  return result;
}
