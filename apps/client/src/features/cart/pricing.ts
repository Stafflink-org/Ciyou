// Aperçu du devis panier/checkout : réutilise le vrai moteur de tarification de
// `packages/shared` (`computeQuote`), le même que celui exécuté par la Cloud
// Function `placeOrder`. C'est un APERÇU : le montant qui fait foi est celui que
// `placeOrder` renvoie à la confirmation (recalcul serveur complet — zones,
// promotions, offres). Le code promo n'est pas prévisualisable ici : les règles
// Firestore n'autorisent pas un client à lire une promotion par son code (seules
// les vitrines publiques le sont) ; il est donc seulement transmis à `placeOrder`,
// qui le valide réellement (voir CheckoutScreen).
import { DEFAULT_PRICING_BY_COUNTRY, DEFAULT_PRICING_FR, computeQuote, type FulfillmentMode, type MarketPricingConfig, type Quote } from '@golink/shared';
import type { CartLine } from './CartContext';

export function pricingConfigFor(countryId: string | undefined | null): MarketPricingConfig {
  return (countryId && DEFAULT_PRICING_BY_COUNTRY[countryId]) || DEFAULT_PRICING_FR;
}

export function previewQuote(lines: CartLine[], fulfillment: FulfillmentMode, deliveryFeeOverrideCents: number | null, minOrderCents: number, config: MarketPricingConfig): Quote {
  return computeQuote(
    {
      lines: lines.map((l) => ({ unitPriceCents: l.unitPriceCents, optionsPriceCents: l.optionsPriceCents, quantity: l.quantity, vatCategory: 'food' as const })),
      fulfillment,
      deliveryFeeOverrideCents: fulfillment === 'delivery' ? (deliveryFeeOverrideCents ?? undefined) : undefined,
      minOrderCents,
    },
    config,
  );
}
