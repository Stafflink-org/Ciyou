import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_PRICING_FR,
  commissionKeyOf,
  computeQuote,
  computeSettlement,
  resolveCommission,
  type Quote,
  type Settlement,
} from '../src/pricing';

const panier = {
  fulfillment: 'delivery' as const,
  deliveredBy: 'restaurant' as const,
  distanceMeters: 1200,
  lines: [{ unitPriceCents: 1500, quantity: 2, vatCategory: 'food' as const }],
};

function conservation(quote: Quote, s: Settlement): number {
  const courier = s.courier ? s.courier.totalCents : 0;
  return s.restaurant.payoutCents + courier + s.payment.totalCents + s.platform.vatDueCents + s.platform.marginCents - quote.totalCents;
}

test('priorité de commission : négocié > groupe > ville > formule > pays', () => {
  const base = { marketBps: 3000, planBps: 2500, cityBps: 2200, groupBps: 2000, negotiatedBps: 1800 };
  assert.deepEqual(resolveCommission(base), { bps: 1800, baseBps: 1800, source: 'negotiated', billingMode: 'commission' });
  assert.equal(resolveCommission({ ...base, negotiatedBps: null }).source, 'group');
  assert.equal(resolveCommission({ ...base, negotiatedBps: null, groupBps: null }).source, 'city');
  assert.equal(resolveCommission({ ...base, negotiatedBps: null, groupBps: null, cityBps: null }).source, 'plan');
  // Formule qui hérite du pays (aucun taux de formule) : le barème du pays s'applique.
  const inherited = resolveCommission({ marketBps: 3000, planBps: null });
  assert.equal(inherited.source, 'market');
  assert.equal(inherited.bps, 3000);
});

test('le taux du pays ou de la ville change vraiment la commission', () => {
  // Avant correction, le taux de la formule masquait toujours ceux-ci.
  assert.equal(resolveCommission({ marketBps: 2800, planBps: null }).bps, 2800);
  assert.equal(resolveCommission({ marketBps: 3000, cityBps: 2100, planBps: 2700 }).bps, 2100);
});

test('mode de facturation : commission, abonnement seul, les deux', () => {
  assert.equal(resolveCommission({ marketBps: 3000, billingMode: 'commission' }).bps, 3000);
  const subscription = resolveCommission({ marketBps: 3000, planBps: 2500, billingMode: 'subscription' });
  assert.equal(subscription.bps, 0);
  assert.equal(subscription.source, 'subscription');
  assert.equal(resolveCommission({ marketBps: 3000, planBps: 2500, billingMode: 'hybrid' }).bps, 2500);
});

test('offre spéciale déduite du taux retenu, sans passer sous zéro', () => {
  assert.equal(resolveCommission({ marketBps: 3000, offerReductionBps: 500 }).bps, 2500);
  assert.equal(resolveCommission({ marketBps: 300, offerReductionBps: 500 }).bps, 0);
});

test('clé du taux selon le mode de commande', () => {
  assert.equal(commissionKeyOf('delivery', 'platform'), 'platformDeliveryBps');
  assert.equal(commissionKeyOf('delivery', 'restaurant'), 'restaurantDeliveryBps');
  assert.equal(commissionKeyOf('pickup', null), 'pickupBps');
  assert.equal(commissionKeyOf('dine_in', null), 'dineInBps');
});

test('portefeuille : frais de carte et espèces ne portent que sur le reste à payer', () => {
  const quote = computeQuote(panier, DEFAULT_PRICING_FR);
  assert.equal(quote.ok, true);
  const wallet = 1000;
  const card = computeSettlement({ quote, paymentMethod: 'card', commissionBps: 1500, walletAppliedCents: wallet }, DEFAULT_PRICING_FR);
  const cardFull = computeSettlement({ quote, paymentMethod: 'card', commissionBps: 1500 }, DEFAULT_PRICING_FR);
  assert.ok(card.payment.totalCents < cardFull.payment.totalCents, 'moins de frais de carte quand le portefeuille règle une part');
  assert.equal(conservation(quote, card), 0);
  const cash = computeSettlement({ quote, paymentMethod: 'cash', commissionBps: 1500, walletAppliedCents: wallet }, DEFAULT_PRICING_FR);
  assert.equal(cash.payment.cashCollectedCents, quote.totalCents - wallet);
  const allWallet = computeSettlement({ quote, paymentMethod: 'wallet', commissionBps: 1500, walletAppliedCents: quote.totalCents }, DEFAULT_PRICING_FR);
  assert.equal(allWallet.payment.totalCents, 0);
  assert.equal(allWallet.payment.cashCollectedCents, 0);
});
