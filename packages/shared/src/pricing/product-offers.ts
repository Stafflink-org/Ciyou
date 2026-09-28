// Calcul pur de la remise des offres automatiques sur un plat (« 1 acheté, 1 offert », « Le 2e à
// -50 % »), lot B3 de PLAN_ECARTS.md. Aucun accès Firestore ici : les fonctions appelantes
// (functions/src/orders) chargent les offres actives et appliquent ce calcul avant le code promo.
import type { ProductOfferKind } from '../models/restaurant-marketing';
import type { Cents } from './money';

/** Ligne de panier éligible : prix unitaire du plat seul, suppléments exclus. */
export interface ProductOfferLineInput {
  productId: string;
  /** Prix du plat seul (hors suppléments/options), en centimes. */
  unitPriceCents: Cents;
  quantity: number;
}

/** Offre active à considérer, une par plat au plus (la plus avantageuse en cas de doublon). */
export interface ActiveProductOffer {
  productId: string;
  kind: ProductOfferKind;
}

export interface ProductOfferDiscountResult {
  /** Remise totale, jamais négative. */
  totalDiscountCents: Cents;
  /** Remise par plat concerné (pour l'affichage panier et l'imputation de commission). */
  byProduct: Record<string, Cents>;
  /** Identifiants des offres réellement appliquées (au moins une paire vendue). */
  appliedOfferProductIds: string[];
}

/**
 * En cas d'offres actives concurrentes sur le même plat (ne devrait pas arriver, mais le calcul
 * doit rester défini), « offert » (bogo) est toujours plus avantageux pour le client que « -50 % »
 * (half_second) et prime donc sur lui.
 */
function bestKind(a: ProductOfferKind, b: ProductOfferKind): ProductOfferKind {
  return a === 'bogo' || b === 'bogo' ? 'bogo' : 'half_second';
}

/**
 * Remise des offres automatiques sur les plats du panier. Une offre s'applique par paire d'unités
 * du même plat (`quantite / 2`, arrondi à l'entier inférieur) ; les suppléments/options ne sont
 * jamais concernés (calculés sur `unitPriceCents` seul). Le total ne peut jamais devenir négatif.
 */
export function computeProductOffersDiscount(lines: readonly ProductOfferLineInput[], offers: readonly ActiveProductOffer[]): ProductOfferDiscountResult {
  const kindByProduct = new Map<string, ProductOfferKind>();
  for (const offer of offers) {
    const existing = kindByProduct.get(offer.productId);
    kindByProduct.set(offer.productId, existing ? bestKind(existing, offer.kind) : offer.kind);
  }

  const byProduct: Record<string, Cents> = {};
  const appliedOfferProductIds: string[] = [];
  let total = 0;

  for (const line of lines) {
    const kind = kindByProduct.get(line.productId);
    if (!kind || line.unitPriceCents <= 0) continue;
    const pairs = Math.floor(Math.max(0, line.quantity) / 2);
    if (pairs <= 0) continue;
    const perPairDiscount = kind === 'bogo' ? line.unitPriceCents : Math.round(line.unitPriceCents / 2);
    const lineDiscount = Math.max(0, pairs * perPairDiscount);
    if (lineDiscount <= 0) continue;
    byProduct[line.productId] = (byProduct[line.productId] ?? 0) + lineDiscount;
    appliedOfferProductIds.push(line.productId);
    total += lineDiscount;
  }

  return { totalDiscountCents: Math.max(0, total), byProduct, appliedOfferProductIds };
}
