import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeProductOffersDiscount, type ActiveProductOffer, type ProductOfferLineInput } from '../src/pricing';

test('bogo : une paire vendue offre la seconde unité', () => {
  const lines: ProductOfferLineInput[] = [{ productId: 'p1', unitPriceCents: 1000, quantity: 2 }];
  const offers: ActiveProductOffer[] = [{ productId: 'p1', kind: 'bogo' }];
  const result = computeProductOffersDiscount(lines, offers);
  assert.equal(result.totalDiscountCents, 1000);
  assert.deepEqual(result.byProduct, { p1: 1000 });
  assert.deepEqual(result.appliedOfferProductIds, ['p1']);
});

test('half_second : la seconde unité de la paire est à -50 %, arrondie', () => {
  const lines: ProductOfferLineInput[] = [{ productId: 'p1', unitPriceCents: 999, quantity: 2 }];
  const offers: ActiveProductOffer[] = [{ productId: 'p1', kind: 'half_second' }];
  const result = computeProductOffersDiscount(lines, offers);
  // 999 / 2 = 499,5 -> arrondi à 500.
  assert.equal(result.totalDiscountCents, 500);
});

test('paires = quantité / 2 (arrondi inférieur) : une quantité impaire ne double pas la remise', () => {
  const lines: ProductOfferLineInput[] = [{ productId: 'p1', unitPriceCents: 1000, quantity: 5 }];
  const offers: ActiveProductOffer[] = [{ productId: 'p1', kind: 'bogo' }];
  const result = computeProductOffersDiscount(lines, offers);
  // 5 unités -> 2 paires, la 5e reste payante en entier.
  assert.equal(result.totalDiscountCents, 2000);
});

test('quantité < 2 : aucune remise', () => {
  const lines: ProductOfferLineInput[] = [{ productId: 'p1', unitPriceCents: 1000, quantity: 1 }];
  const offers: ActiveProductOffer[] = [{ productId: 'p1', kind: 'bogo' }];
  const result = computeProductOffersDiscount(lines, offers);
  assert.equal(result.totalDiscountCents, 0);
  assert.deepEqual(result.byProduct, {});
  assert.deepEqual(result.appliedOfferProductIds, []);
});

test('les suppléments/options ne sont jamais remisés (calcul sur unitPriceCents seul)', () => {
  // Le prix des options n'est simplement jamais passé à la fonction : on vérifie que seul le
  // prix du plat (ici 800) sert de base, quel que soit le montant réel payé par le client.
  const lines: ProductOfferLineInput[] = [{ productId: 'p1', unitPriceCents: 800, quantity: 4 }];
  const offers: ActiveProductOffer[] = [{ productId: 'p1', kind: 'bogo' }];
  const result = computeProductOffersDiscount(lines, offers);
  assert.equal(result.totalDiscountCents, 1600);
});

test('« offert » (bogo) prime sur « -50 % » (half_second) en cas de doublon sur le même plat', () => {
  const lines: ProductOfferLineInput[] = [{ productId: 'p1', unitPriceCents: 1000, quantity: 2 }];
  const offers: ActiveProductOffer[] = [
    { productId: 'p1', kind: 'half_second' },
    { productId: 'p1', kind: 'bogo' },
  ];
  const result = computeProductOffersDiscount(lines, offers);
  assert.equal(result.totalDiscountCents, 1000);
});

test('plusieurs plats : remise additionnée, chacune plafonnée à ses propres paires', () => {
  const lines: ProductOfferLineInput[] = [
    { productId: 'p1', unitPriceCents: 1000, quantity: 2 },
    { productId: 'p2', unitPriceCents: 500, quantity: 3 },
    { productId: 'p3', unitPriceCents: 1200, quantity: 1 },
  ];
  const offers: ActiveProductOffer[] = [
    { productId: 'p1', kind: 'bogo' },
    { productId: 'p2', kind: 'half_second' },
  ];
  const result = computeProductOffersDiscount(lines, offers);
  assert.equal(result.byProduct.p1, 1000);
  assert.equal(result.byProduct.p2, 250);
  assert.equal(result.byProduct.p3, undefined);
  assert.equal(result.totalDiscountCents, 1250);
});

test('total jamais négatif (défensif, même avec un prix nul ou négatif malformé)', () => {
  const lines: ProductOfferLineInput[] = [{ productId: 'p1', unitPriceCents: 0, quantity: 4 }];
  const offers: ActiveProductOffer[] = [{ productId: 'p1', kind: 'bogo' }];
  const result = computeProductOffersDiscount(lines, offers);
  assert.equal(result.totalDiscountCents, 0);
});

test('aucune offre active sur le plat : aucune remise', () => {
  const lines: ProductOfferLineInput[] = [{ productId: 'p1', unitPriceCents: 1000, quantity: 4 }];
  const result = computeProductOffersDiscount(lines, []);
  assert.equal(result.totalDiscountCents, 0);
});
