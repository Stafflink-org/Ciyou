// Calcul du devis client : sous-total, frais, remise, pourboire, total et TVA des articles.
// Fonction pure : aucune lecture de base, aucune date. Utilisée à l'identique par
// l'app client (affichage) et par la Cloud Function de commande (montant faisant foi).
import {
  allocateProRata,
  applyBps,
  assertCents,
  clamp,
  htFromTtc,
  sum,
  type Cents,
} from './money';
import type {
  DeliveryFeeTier,
  DiscountBreakdown,
  MarketPricingConfig,
  PromotionInput,
  Quote,
  QuoteInput,
  QuoteIssueCode,
  VatLine,
} from './types';
import { VAT_CATEGORIES, type VatCategory } from '../constants/enums';

/** Prix d'une unité de la ligne : prix unitaire, ou prix au kg × poids pour la vente au poids. */
export function lineUnitPriceCents(line: QuoteInput['lines'][number]): Cents {
  if (line.saleUnit === 'weight' && line.pricePerKgCents !== undefined && line.weightGrams !== undefined) {
    return Math.round((line.pricePerKgCents * Math.max(0, line.weightGrams)) / 1000);
  }
  return line.unitPriceCents;
}

export function lineTotalCents(line: QuoteInput['lines'][number]): Cents {
  return (lineUnitPriceCents(line) + (line.optionsPriceCents ?? 0)) * line.quantity;
}

/** Frais de livraison d'une zone du commerce, dans les bornes éventuelles de la plateforme. */
export function merchantZoneDeliveryFee(
  zone: NonNullable<QuoteInput['merchantZone']>,
  subtotal: Cents,
  config: MarketPricingConfig,
): Cents {
  if (zone.freeAboveCents != null && subtotal >= zone.freeAboveCents) return 0;
  const b = config.merchantDelivery;
  return clamp(zone.feeCents, b?.minFeeCents ?? 0, b?.maxFeeCents ?? Number.MAX_SAFE_INTEGER);
}

/** Minimum de commande effectif : le plus élevé des minimums fournis, dans les bornes de la plateforme. */
export function effectiveMinOrderCents(
  input: Pick<QuoteInput, 'minOrderCents' | 'merchantZone'> & { fulfillment?: QuoteInput['fulfillment'] },
  config: MarketPricingConfig,
): Cents | undefined {
  const zoneMin = input.fulfillment === undefined || input.fulfillment === 'delivery' ? input.merchantZone?.minOrderCents : undefined;
  const candidates = [input.minOrderCents, zoneMin ?? undefined].filter(
    (v): v is Cents => v !== undefined && v !== null,
  );
  const b = config.merchantDelivery;
  if (candidates.length === 0) return b?.minOrderFloorCents ?? undefined;
  return clamp(Math.max(...candidates), b?.minOrderFloorCents ?? 0, b?.minOrderCeilingCents ?? Number.MAX_SAFE_INTEGER);
}

/** Frais de service : pourcentage du sous-total borné par un plancher et un plafond. */
export function computeServiceFee(subtotal: Cents, input: QuoteInput, config: MarketPricingConfig): Cents {
  const rule = config.serviceFee;
  if (!rule.enabled || subtotal === 0 || !rule.appliesTo.includes(input.fulfillment)) return 0;
  return clamp(applyBps(subtotal, rule.rateBps), rule.minCents, rule.maxCents);
}

/** Frais de petite commande, sous le seuil configuré. */
export function computeSmallOrderFee(subtotal: Cents, input: QuoteInput, config: MarketPricingConfig): Cents {
  const rule = config.smallOrderFee;
  if (!rule.enabled || subtotal === 0 || subtotal >= rule.thresholdCents) return 0;
  if (!rule.appliesTo.includes(input.fulfillment)) return 0;
  const fee = rule.mode === 'flat' ? rule.flatCents : rule.thresholdCents - subtotal;
  return Math.min(fee, rule.maxCents);
}

/** Frais de livraison selon la distance (paliers). Retourne null si hors zone. */
export function deliveryFeeForDistance(
  distanceMeters: number,
  tiers: readonly DeliveryFeeTier[],
  maxDistanceMeters: number,
): Cents | null {
  if (distanceMeters < 0 || distanceMeters > maxDistanceMeters) return null;
  const sorted = [...tiers].sort((a, b) => a.upToMeters - b.upToMeters);
  const tier = sorted.find((t) => distanceMeters <= t.upToMeters);
  return tier ? tier.feeCents : null;
}

interface DeliveryComputation {
  feeCents: Cents;
  surgeCents: Cents;
  issue?: QuoteIssueCode;
}

function computeDelivery(subtotal: Cents, input: QuoteInput, config: MarketPricingConfig): DeliveryComputation {
  if (input.fulfillment !== 'delivery' || subtotal === 0) return { feeCents: 0, surgeCents: 0 };
  let base: Cents;
  if (input.deliveryFeeOverrideCents !== undefined) {
    assertCents(input.deliveryFeeOverrideCents, 'deliveryFeeOverrideCents');
    base = input.deliveryFeeOverrideCents;
  } else if (input.merchantZone) {
    assertCents(input.merchantZone.feeCents, 'merchantZone.feeCents');
    base = merchantZoneDeliveryFee(input.merchantZone, subtotal, config);
  } else {
    if (input.distanceMeters === undefined) return { feeCents: 0, surgeCents: 0, issue: 'distance_required' };
    const fee = deliveryFeeForDistance(
      input.distanceMeters,
      input.zoneTiers ?? config.delivery.tiers,
      config.delivery.maxDistanceMeters,
    );
    if (fee === null) return { feeCents: 0, surgeCents: 0, issue: 'out_of_delivery_range' };
    base = fee;
  }
  const free = config.delivery.freeAboveSubtotalCents;
  if (free !== null && subtotal >= free) return { feeCents: 0, surgeCents: 0 };
  let surgeCents = 0;
  if (input.surge) {
    const multiplier = clamp(input.surge.multiplierBps, 10_000, config.delivery.maxSurgeMultiplierBps);
    surgeCents = applyBps(base, multiplier) - base + (input.surge.flatCents ?? 0);
  }
  return { feeCents: base + surgeCents, surgeCents };
}

/** Part d'une remise financée par le restaurant, en centimes. */
export function restaurantShareOf(amount: Cents, promo: PromotionInput): Cents {
  if (promo.funding === 'restaurant') return amount;
  if (promo.funding === 'platform') return 0;
  return applyBps(amount, clamp(promo.restaurantShareBps ?? 5000, 0, 10_000));
}

function computeDiscount(
  subtotal: Cents,
  deliveryFee: Cents,
  promo: PromotionInput | undefined,
  issues: QuoteIssueCode[],
): DiscountBreakdown {
  const none: DiscountBreakdown = {
    totalCents: 0,
    onItemsCents: 0,
    onDeliveryCents: 0,
    platformFundedCents: 0,
    restaurantFundedCents: 0,
    restaurantOnItemsCents: 0,
    restaurantOnDeliveryCents: 0,
  };
  if (!promo || subtotal === 0) return none;
  if (promo.minSubtotalCents !== undefined && subtotal < promo.minSubtotalCents) {
    issues.push('promo_minimum_not_reached');
    return none;
  }
  let onItems = 0;
  let onDelivery = 0;
  if (promo.kind === 'percentage') onItems = applyBps(subtotal, clamp(promo.value, 0, 10_000));
  else if (promo.kind === 'fixed') onItems = Math.max(0, Math.round(promo.value));
  else onDelivery = deliveryFee;
  const cap = promo.maxDiscountCents ?? null;
  if (cap !== null) {
    onItems = Math.min(onItems, cap);
    onDelivery = Math.min(onDelivery, cap);
  }
  onItems = Math.min(onItems, subtotal);
  const restaurantOnItems = restaurantShareOf(onItems, promo);
  const restaurantOnDelivery = restaurantShareOf(onDelivery, promo);
  const total = onItems + onDelivery;
  const restaurantFunded = restaurantOnItems + restaurantOnDelivery;
  return {
    totalCents: total,
    onItemsCents: onItems,
    onDeliveryCents: onDelivery,
    platformFundedCents: total - restaurantFunded,
    restaurantFundedCents: restaurantFunded,
    restaurantOnItemsCents: restaurantOnItems,
    restaurantOnDeliveryCents: restaurantOnDelivery,
  };
}

/**
 * TVA des articles vendus par le restaurant. La remise financée par le restaurant
 * réduit la base imposable (réparties au prorata des catégories) ; la remise financée
 * par la plateforme est un paiement pour le compte du client et ne la réduit pas.
 */
function computeItemsVat(
  lines: QuoteInput['lines'],
  restaurantDiscountOnItems: Cents,
  config: MarketPricingConfig,
): VatLine[] {
  // Regroupement par catégorie puis par taux (un taux propre à la ligne crée son propre groupe).
  const groups: Array<{ category: VatCategory; rateBps: number; amount: Cents }> = [];
  for (const category of VAT_CATEGORIES) {
    for (const line of lines) {
      if (line.vatCategory !== category) continue;
      const rateBps = line.vatRateBpsOverride ?? config.vat.byCategory[category];
      const amount = lineTotalCents(line);
      const group = groups.find((g) => g.category === category && g.rateBps === rateBps);
      if (group) group.amount += amount;
      else groups.push({ category, rateBps, amount });
    }
  }
  const nonEmpty = groups.filter((g) => g.amount > 0);
  const discounts = allocateProRata(restaurantDiscountOnItems, nonEmpty.map((g) => g.amount));
  return nonEmpty.map((g, i) => {
    const ttcCents = g.amount - discounts[i];
    const htCents = htFromTtc(ttcCents, g.rateBps);
    return { category: g.category, rateBps: g.rateBps, ttcCents, htCents, vatCents: ttcCents - htCents };
  });
}

/** Devis complet d'un panier. */
export function computeQuote(input: QuoteInput, config: MarketPricingConfig): Quote {
  const issues: QuoteIssueCode[] = [];
  for (const line of input.lines) {
    assertCents(line.unitPriceCents, 'unitPriceCents');
    if (line.saleUnit === 'weight') {
      assertCents(line.pricePerKgCents ?? 0, 'pricePerKgCents');
      if (line.weightGrams !== undefined && (!Number.isFinite(line.weightGrams) || line.weightGrams < 0)) {
        throw new RangeError(`Poids invalide : ${line.weightGrams}.`);
      }
    }
    assertCents(line.optionsPriceCents ?? 0, 'optionsPriceCents');
    if (!Number.isInteger(line.quantity) || line.quantity < 1) {
      throw new RangeError(`Quantité invalide : ${line.quantity}.`);
    }
  }
  const subtotalByCategory: Partial<Record<VatCategory, Cents>> = {};
  for (const line of input.lines) {
    subtotalByCategory[line.vatCategory] = (subtotalByCategory[line.vatCategory] ?? 0) + lineTotalCents(line);
  }
  const subtotal = sum(input.lines.map(lineTotalCents));
  const itemsCount = sum(input.lines.map((l) => l.quantity));
  if (subtotal === 0) issues.push('empty_cart');
  const minOrderCents = effectiveMinOrderCents(input, config);
  if (minOrderCents !== undefined && subtotal > 0 && subtotal < minOrderCents) {
    issues.push('below_minimum_order');
  }

  const deliveredBy = input.fulfillment === 'delivery' ? (input.deliveredBy ?? 'platform') : 'restaurant';
  const serviceFee = computeServiceFee(subtotal, input, config);
  const smallOrderFee = computeSmallOrderFee(subtotal, input, config);
  const delivery = computeDelivery(subtotal, input, config);
  if (delivery.issue) issues.push(delivery.issue);

  const discount = computeDiscount(subtotal, delivery.feeCents, input.promotion, issues);

  let tip = input.tipCents ?? 0;
  assertCents(tip, 'tipCents');
  if (tip > 0 && (!config.tips.enabled || input.fulfillment !== 'delivery')) {
    issues.push('tips_disabled');
    tip = 0;
  } else if (tip > config.tips.maxCents) {
    issues.push('tip_above_maximum');
    tip = config.tips.maxCents;
  }

  const total = subtotal + serviceFee + smallOrderFee + delivery.feeCents - discount.totalCents + tip;
  const blocking: readonly QuoteIssueCode[] = [
    'empty_cart',
    'below_minimum_order',
    'out_of_delivery_range',
    'distance_required',
  ];

  return {
    ok: !issues.some((i) => blocking.includes(i)),
    issues,
    fulfillment: input.fulfillment,
    deliveredBy,
    itemsCount,
    subtotalCents: subtotal,
    serviceFeeCents: serviceFee,
    smallOrderFeeCents: smallOrderFee,
    deliveryFeeCents: delivery.feeCents,
    surgeFeeCents: delivery.surgeCents,
    discount,
    tipCents: tip,
    totalCents: total,
    itemsVat: computeItemsVat(input.lines, discount.restaurantOnItemsCents, config),
    subtotalByCategory,
  };
}
