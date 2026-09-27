import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_PRICING_FR,
  DEFAULT_PRICING_LU,
  aggregateDac7,
  allocateProRata,
  allocateRefund,
  computeCancellationRefund,
  computeCourierPay,
  computeHourlyGuaranteeTopUp,
  computeLateCredit,
  computeQuote,
  computeSettlement,
  deliveryFeeForDistance,
  htFromTtc,
  isDac7Reportable,
  marketCommissionBps,
  mergePricing,
  resolveCommissionBps,
  type Quote,
  type QuoteInput,
  type Settlement,
  CAUSE_BASED_REFUND_LIABILITY,
  DEFAULT_PLANS,
  DEFAULT_PRICING_BY_COUNTRY,
  DEFAULT_PRICING_DZ,
  DEFAULT_PRICING_TN,
  allowedPaymentMethodsFor,
  customerAbsentOutcome,
  formatMoney,
  isAcceptanceExpired,
  isCashAllowed,
  isHourlyGuaranteeEnabled,
  merchantInactivityAction,
  resolveBillingMode,
  shouldAutoPauseMerchant,
  toMinorUnits,
} from '../src/pricing';
import {
  SELECTABLE_VAT_CATEGORIES,
  checkProductAlcohol,
  detectAlcoholKeywords,
  isVatCategorySelectable,
  normalizeForMatch,
} from '../src';

/**
 * Configuration « tous mécanismes actifs » : frais de service et de petite commande
 * activés, ancien barème livreur, frais de paiement à la charge de la plateforme.
 * Elle couvre les mécanismes du moteur, désactivés par défaut depuis les décisions client.
 */
const LEGACY_OVERRIDE = {
  serviceFee: { enabled: true, rateBps: 1000, minCents: 49, maxCents: 349 },
  smallOrderFee: { enabled: true },
  payment: { payer: 'platform' as const },
  courier: { model: 'pickup_dropoff_per_km' as const },
};
const FR = mergePricing(DEFAULT_PRICING_FR, LEGACY_OVERRIDE);
const LU_LEGACY = mergePricing(DEFAULT_PRICING_LU, LEGACY_OVERRIDE);

const basket: QuoteInput = {
  fulfillment: 'delivery',
  distanceMeters: 2500,
  lines: [
    { unitPriceCents: 1250, optionsPriceCents: 150, quantity: 2, vatCategory: 'food' },
    { unitPriceCents: 350, quantity: 1, vatCategory: 'soft_drink' },
    { unitPriceCents: 600, quantity: 1, vatCategory: 'alcohol' },
  ],
};

/** Vérifie que tous les flux d'une répartition égalent le montant payé. */
function assertConservation(quote: Quote, s: Settlement): void {
  const courier = s.courier ? s.courier.totalCents : 0;
  assert.equal(
    s.restaurant.payoutCents + courier + s.payment.totalCents + s.platform.vatDueCents + s.platform.marginCents,
    quote.totalCents,
  );
  // La marge se décompose aussi par composantes.
  const platformOnDelivery = quote.discount.onDeliveryCents - quote.discount.restaurantOnDeliveryCents;
  const deliveryDiscountInRevenue = quote.deliveredBy === 'platform' && quote.fulfillment === 'delivery' ? platformOnDelivery : 0;
  assert.equal(
    s.platform.marginCents,
    s.platform.serviceFeeHtCents +
      s.platform.smallOrderFeeHtCents +
      s.platform.deliveryFeeHtCents +
      s.platform.commissionHtCents -
      s.platform.courierCostCents -
      (s.platform.promoCostCents - deliveryDiscountInRevenue) -
      s.platform.paymentCostCents,
  );
}

test('allocateProRata répartit sans perte', () => {
  assert.deepEqual(allocateProRata(100, [1, 1, 1]), [34, 33, 33]);
  assert.deepEqual(allocateProRata(0, [5, 5]), [0, 0]);
  assert.equal(allocateProRata(999, [3, 7, 11]).reduce((a, b) => a + b, 0), 999);
});

test('TVA extraite d’un TTC', () => {
  assert.equal(htFromTtc(1100, 1000), 1000);
  assert.equal(htFromTtc(120, 2000), 100);
});

test('paliers de livraison et hors zone', () => {
  assert.equal(deliveryFeeForDistance(1500, FR.delivery.tiers, 9000), 99);
  assert.equal(deliveryFeeForDistance(1501, FR.delivery.tiers, 9000), 199);
  assert.equal(deliveryFeeForDistance(9001, FR.delivery.tiers, 9000), null);
});

test('devis standard : sous-total, frais de service plafonnés, livraison, TVA par taux', () => {
  const q = computeQuote(basket, FR);
  assert.equal(q.ok, true);
  assert.equal(q.subtotalCents, 2 * 1400 + 350 + 600); // 3 750
  assert.equal(q.itemsCount, 4);
  assert.equal(q.serviceFeeCents, 349); // 10 % = 375 → plafond 3,49 €
  assert.equal(q.smallOrderFeeCents, 0);
  assert.equal(q.deliveryFeeCents, 199);
  assert.equal(q.totalCents, 3750 + 349 + 199);
  const food = q.itemsVat.find((l) => l.category === 'food');
  const alcohol = q.itemsVat.find((l) => l.category === 'alcohol');
  assert.equal(food?.vatCents, 2800 - htFromTtc(2800, 1000));
  assert.equal(alcohol?.rateBps, 2000);
});

test('petite commande : l’écart jusqu’au seuil, plafonné', () => {
  const small = computeQuote({ ...basket, lines: [{ unitPriceCents: 800, quantity: 1, vatCategory: 'food' }] }, FR);
  assert.equal(small.smallOrderFeeCents, 200);
  assert.equal(small.serviceFeeCents, 80);
  const tiny = computeQuote({ ...basket, lines: [{ unitPriceCents: 300, quantity: 1, vatCategory: 'food' }] }, FR);
  assert.equal(tiny.smallOrderFeeCents, 300);
  assert.equal(tiny.serviceFeeCents, 49); // plancher
});

test('retrait : ni livraison ni frais de service ni petite commande', () => {
  const q = computeQuote({ ...basket, fulfillment: 'pickup', distanceMeters: undefined }, FR);
  assert.equal(q.deliveryFeeCents + q.serviceFeeCents + q.smallOrderFeeCents, 0);
  assert.equal(q.totalCents, q.subtotalCents);
  assert.equal(q.deliveredBy, 'restaurant');
});

test('hors zone et minimum de commande bloquent le devis', () => {
  assert.deepEqual(computeQuote({ ...basket, distanceMeters: 12_000 }, FR).issues, ['out_of_delivery_range']);
  const q = computeQuote({ ...basket, minOrderCents: 5000 }, FR);
  assert.equal(q.ok, false);
  assert.ok(q.issues.includes('below_minimum_order'));
});

test('heure de pointe : majoration bornée par le maximum du marché', () => {
  const q = computeQuote({ ...basket, surge: { multiplierBps: 30_000, flatCents: 50 } }, FR);
  // 199 × 1,5 = 298,5 → 299 ; + 0,50 €
  assert.equal(q.deliveryFeeCents, 299 + 50);
  assert.equal(q.surgeFeeCents, 100 + 50);
});

test('remise pourcentage financée par le restaurant : réduit la base de TVA', () => {
  const q = computeQuote(
    { ...basket, promotion: { kind: 'percentage', value: 2000, funding: 'restaurant', maxDiscountCents: 500 } },
    FR,
  );
  assert.equal(q.discount.totalCents, 500);
  assert.equal(q.discount.restaurantFundedCents, 500);
  const vatBase = q.itemsVat.reduce((a, l) => a + l.ttcCents, 0);
  assert.equal(vatBase, 3750 - 500);
});

test('remise partagée et livraison offerte', () => {
  const shared = computeQuote(
    { ...basket, promotion: { kind: 'fixed', value: 400, funding: 'shared', restaurantShareBps: 2500 } },
    FR,
  );
  assert.equal(shared.discount.restaurantFundedCents, 100);
  assert.equal(shared.discount.platformFundedCents, 300);
  const free = computeQuote({ ...basket, promotion: { kind: 'free_delivery', value: 0, funding: 'platform' } }, FR);
  assert.equal(free.discount.onDeliveryCents, 199);
  assert.equal(free.totalCents, 3750 + 349);
});

test('minimum de promotion non atteint : pas de remise, devis valide', () => {
  const q = computeQuote({ ...basket, promotion: { kind: 'fixed', value: 500, funding: 'platform', minSubtotalCents: 5000 } }, FR);
  assert.equal(q.discount.totalCents, 0);
  assert.equal(q.ok, true);
  assert.deepEqual(q.issues, ['promo_minimum_not_reached']);
});

test('pourboire : plafonné, refusé hors livraison', () => {
  assert.equal(computeQuote({ ...basket, tipCents: 9999 }, FR).tipCents, 5000);
  const pickup = computeQuote({ ...basket, fulfillment: 'pickup', tipCents: 200 }, FR);
  assert.equal(pickup.tipCents, 0);
  assert.ok(pickup.issues.includes('tips_disabled'));
});

test('rémunération livreur : barème, minimum garanti, attente, pourboire intégral', () => {
  const pay = computeCourierPay({ distanceMeters: 3200, durationMinutes: 18, waitingMinutes: 9, tipCents: 200 }, FR);
  assert.equal(pay.distanceCents, 256);
  assert.equal(pay.waitingCents, 80);
  assert.equal(pay.earningsCents, 200 + 100 + 256 + 80);
  assert.equal(pay.totalCents, pay.earningsCents + 200);
  const short = computeCourierPay({ distanceMeters: 0, durationMinutes: 5 }, LU_LEGACY);
  assert.equal(short.earningsCents, 400);
  assert.equal(short.minimumTopUpCents, 0);
  const tiny = computeCourierPay({ distanceMeters: 0, durationMinutes: 5 }, mergePricing(FR, { courier: { pickupCents: 100 } }));
  assert.equal(tiny.minimumTopUpCents, 100);
});

test('garantie horaire hebdomadaire', () => {
  assert.equal(computeHourlyGuaranteeTopUp(15_000, 600, 1900), 4000);
  assert.equal(computeHourlyGuaranteeTopUp(30_000, 600, 1900), 0);
});

test('répartition livraison plateforme : conservation des flux', () => {
  const q = computeQuote({ ...basket, tipCents: 200 }, FR);
  const s = computeSettlement(
    {
      quote: q,
      paymentMethod: 'card',
      commissionBps: marketCommissionBps(q.fulfillment, q.deliveredBy, FR),
      courier: { distanceMeters: 2500, durationMinutes: 16 },
    },
    FR,
  );
  assert.equal(s.restaurant.commissionHtCents, 1125); // 30 % de 37,50 €
  assert.equal(s.restaurant.commissionVatCents, 225);
  assert.equal(s.restaurant.payoutCents, 3750 - 1350);
  assert.equal(s.courier?.tipCents, 200);
  assert.equal(s.payment.processingCents, Math.round((q.totalCents * 150) / 10000) + 25);
  assertConservation(q, s);
});

test('répartition avec remises, livreurs du restaurant, retrait, espèces', () => {
  const promos: QuoteInput['promotion'][] = [
    { kind: 'percentage', value: 1500, funding: 'shared', restaurantShareBps: 5000 },
    { kind: 'free_delivery', value: 0, funding: 'restaurant' },
    { kind: 'free_delivery', value: 0, funding: 'platform' },
    { kind: 'fixed', value: 300, funding: 'platform' },
  ];
  for (const promotion of promos) {
    for (const deliveredBy of ['platform', 'restaurant'] as const) {
      for (const paymentMethod of ['card', 'cash'] as const) {
        const q = computeQuote({ ...basket, deliveredBy, promotion, tipCents: 150 }, FR);
        const s = computeSettlement(
          {
            quote: q,
            paymentMethod,
            commissionBps: marketCommissionBps(q.fulfillment, q.deliveredBy, FR),
            courier: { distanceMeters: 2500, durationMinutes: 14 },
          },
          FR,
        );
        assertConservation(q, s);
      }
    }
  }
  const pickup = computeQuote({ ...basket, fulfillment: 'pickup' }, FR);
  const sp = computeSettlement({ quote: pickup, paymentMethod: 'card', commissionBps: FR.commission.pickupBps }, FR);
  assert.equal(sp.courier, null);
  assertConservation(pickup, sp);
  const restaurantPays = mergePricing(FR, { payment: { payer: 'restaurant' } });
  const sr = computeSettlement({ quote: pickup, paymentMethod: 'card', commissionBps: 1200 }, restaurantPays);
  assert.equal(sr.platform.paymentCostCents, 0);
  assertConservation(pickup, sr);
});

test('répartition au Luxembourg : TVA 17 % sur la commission', () => {
  const q = computeQuote(basket, DEFAULT_PRICING_LU);
  const s = computeSettlement(
    { quote: q, paymentMethod: 'card', commissionBps: 3000, courier: { distanceMeters: 2500, durationMinutes: 15 } },
    DEFAULT_PRICING_LU,
  );
  assert.equal(s.restaurant.commissionVatCents, Math.round(1125 * 0.17));
  assert.equal(q.itemsVat.find((l) => l.category === 'food')?.rateBps, 300);
  assertConservation(q, s);
});

test('résolution de la commission', () => {
  assert.equal(resolveCommissionBps({ marketBps: 3000 }), 3000);
  assert.equal(resolveCommissionBps({ marketBps: 3000, planBps: 2700 }), 2700);
  assert.equal(resolveCommissionBps({ marketBps: 3000, planBps: 2700, cityBps: 2800 }), 2800);
  assert.equal(resolveCommissionBps({ marketBps: 3000, planBps: 2700, negotiatedBps: 2000, offerReductionBps: 500 }), 1500);
});

test('imputation des remboursements', () => {
  assert.deepEqual(allocateRefund(1000, 'missing_item'), { restaurantCents: 1000, courierCents: 0, platformCents: 0 });
  // Décision client : le commerce paie tous les remboursements, quelle qu'en soit la cause.
  assert.deepEqual(allocateRefund(1000, 'delivery_late'), { restaurantCents: 1000, courierCents: 0, platformCents: 0 });
  assert.deepEqual(allocateRefund(1000, 'platform_error'), { restaurantCents: 1000, courierCents: 0, platformCents: 0 });
  // Ancienne règle par cause, toujours disponible comme paramètre.
  assert.deepEqual(allocateRefund(1000, 'customer_absent', CAUSE_BASED_REFUND_LIABILITY), { restaurantCents: 0, courierCents: 0, platformCents: 1000 });
  const split = allocateRefund(1001, 'delivery_late', { ...allocateRules(), delivery_late: { restaurant: 5000, platform: 5000 } });
  assert.equal(split.restaurantCents + split.platformCents, 1001);
});

function allocateRules() {
  return {
    restaurant_error: {},
    restaurant_cancelled: {},
    restaurant_timeout: {},
    item_unavailable: {},
    missing_item: {},
    food_quality: {},
    delivery_late: {},
    delivery_issue: {},
    courier_error: {},
    customer_absent: {},
    customer_cancelled: {},
    commercial_gesture: {},
    platform_error: {},
    payment_issue: {},
  };
}

test('annulation client selon l’étape', () => {
  assert.deepEqual(computeCancellationRefund(3000, 200, 'pending'), { allowed: true, refundCents: 3000 });
  assert.deepEqual(computeCancellationRefund(3000, 200, 'accepted'), { allowed: true, refundCents: 1400 + 200 });
  assert.deepEqual(computeCancellationRefund(3000, 200, 'ready'), { allowed: false, refundCents: 0 });
});

test('avoir automatique de retard', () => {
  assert.equal(computeLateCredit(10, 3000), 0);
  assert.equal(computeLateCredit(25, 3000), 300);
  assert.equal(computeLateCredit(45, 6000), 1500);
});

test('DAC7 : seuils et agrégats trimestriels', () => {
  assert.equal(isDac7Reportable('sale_of_goods', 29, 199_999), false);
  assert.equal(isDac7Reportable('sale_of_goods', 30, 1000), true);
  assert.equal(isDac7Reportable('sale_of_goods', 3, 200_000), true);
  assert.equal(isDac7Reportable('personal_services', 1, 450), true);
  const q = aggregateDac7(
    [
      { paidAt: new Date(Date.UTC(2026, 0, 10)), grossCents: 1000, feesCents: 300 },
      { paidAt: new Date(Date.UTC(2026, 5, 30)), grossCents: 2000, feesCents: 600 },
      { paidAt: new Date(Date.UTC(2025, 11, 31)), grossCents: 9999, feesCents: 1 },
    ],
    2026,
  );
  assert.equal(q[0].grossCents, 1000);
  assert.equal(q[1].transactionsCount, 1);
  assert.equal(q[3].transactionsCount, 0);
});

// ---------------------------------------------------------------- Décisions du client (26/09/2026)

const DFR = DEFAULT_PRICING_FR;

test('décisions : pas de frais de service ni de petite commande par défaut', () => {
  const q = computeQuote(basket, DFR);
  assert.equal(q.serviceFeeCents, 0);
  assert.equal(q.smallOrderFeeCents, 0);
  assert.equal(q.totalCents, 3750 + 199);
});

test('décisions : commission sur articles TTC hors livraison et pourboire, frais de paiement déduits du reversement', () => {
  const q = computeQuote({ ...basket, tipCents: 200 }, DFR);
  const s = computeSettlement(
    { quote: q, paymentMethod: 'card', commissionBps: 3000, courier: { distanceMeters: 2500, durationMinutes: 15 } },
    DFR,
  );
  assert.equal(s.restaurant.commissionBaseCents, 3750);
  assert.equal(s.restaurant.commissionHtCents, 1125);
  assert.equal(s.payment.payer, 'restaurant');
  assert.equal(s.restaurant.paymentFeeCents, s.payment.totalCents);
  assert.equal(s.restaurant.payoutCents, 3750 - 1350 - s.payment.totalCents);
  assert.equal(s.platform.paymentCostCents, 0);
  assertConservation(q, s);
  // Remise financée par le commerce : l'assiette est le montant payé par le client.
  const promo = computeQuote({ ...basket, promotion: { kind: 'fixed', value: 500, funding: 'restaurant' } }, DFR);
  const sp = computeSettlement({ quote: promo, paymentMethod: 'card', commissionBps: 3000 }, DFR);
  assert.equal(sp.restaurant.commissionBaseCents, 3250);
});

test('décisions : mode de facturation', () => {
  assert.equal(resolveBillingMode({ market: 'commission', plan: 'hybrid', restaurant: 'subscription' }), 'subscription');
  assert.equal(resolveBillingMode({ plan: 'hybrid' }), 'hybrid');
  assert.equal(resolveBillingMode({}), 'commission');
  assert.equal(resolveCommissionBps({ marketBps: 3000, billingMode: 'subscription' }), 0);
  assert.equal(resolveCommissionBps({ marketBps: 3000, billingMode: 'hybrid' }), 3000);
});

test('décisions : livreur au forfait sous 2 km puis au km, bonus de pointe, pourboire intégral', () => {
  assert.equal(computeCourierPay({ distanceMeters: 1500, durationMinutes: 10 }, DFR).earningsCents, 400);
  const far = computeCourierPay({ distanceMeters: 2500, durationMinutes: 15, isPeak: true, tipCents: 300 }, DFR);
  assert.equal(far.model, 'flat_then_per_km');
  assert.equal(far.flatCents, 400);
  assert.equal(far.distanceCents, 40);
  assert.equal(far.peakBonusCents, 100);
  assert.equal(far.earningsCents, 540);
  assert.equal(far.totalCents, 840);
  // Paramétrable par ville (surcharge) : distance totale au km, forfait en plancher.
  const city = mergePricing(DFR, { courier: { perKmMode: 'full_distance', flatDistanceThresholdMeters: 1000 } });
  const short = computeCourierPay({ distanceMeters: 3000, durationMinutes: 12 }, city);
  assert.equal(short.distanceCents + short.minimumTopUpCents, 400);
  assert.equal(computeCourierPay({ distanceMeters: 6000, durationMinutes: 20 }, city).earningsCents, 480);
  // Garantie horaire : paramètre optionnel, désactivé hors France.
  assert.equal(isHourlyGuaranteeEnabled(DFR), true);
  assert.equal(isHourlyGuaranteeEnabled(DEFAULT_PRICING_LU), false);
  assert.equal(isHourlyGuaranteeEnabled(DEFAULT_PRICING_DZ), false);
});

test('décisions : frais et minimum de la zone du commerce, bornes plateforme optionnelles', () => {
  const zone = { feeCents: 250, minOrderCents: 1500 };
  const q = computeQuote({ ...basket, distanceMeters: 20_000, merchantZone: zone }, DFR);
  assert.equal(q.ok, true);
  assert.equal(q.deliveryFeeCents, 250);
  assert.ok(computeQuote({ ...basket, merchantZone: { feeCents: 250, minOrderCents: 5000 } }, DFR).issues.includes('below_minimum_order'));
  assert.equal(computeQuote({ ...basket, merchantZone: { feeCents: 250, freeAboveCents: 3000 } }, DFR).deliveryFeeCents, 0);
  const bounded = mergePricing(DFR, { merchantDelivery: { maxFeeCents: 200 } });
  assert.equal(computeQuote({ ...basket, merchantZone: zone }, bounded).deliveryFeeCents, 200);
  // Livreur salarié du commerce : frais et pourboire reviennent au commerce, hors assiette.
  const own = computeQuote({ ...basket, deliveredBy: 'restaurant', merchantZone: zone, tipCents: 200 }, DFR);
  const s = computeSettlement({ quote: own, paymentMethod: 'cash', commissionBps: 1500 }, DFR);
  assert.equal(s.restaurant.commissionBaseCents, 3750);
  assert.equal(s.restaurant.deliveryFeeCents, 250);
  assert.equal(s.restaurant.tipCents, 200);
  assertConservation(own, s);
});

test('décisions : espèces seulement avec un livreur salarié du commerce', () => {
  assert.equal(isCashAllowed({ fulfillment: 'delivery', deliveredBy: 'restaurant' }), true);
  assert.equal(isCashAllowed({ fulfillment: 'delivery', deliveredBy: 'merchant', driverType: 'merchant' }), true);
  assert.equal(isCashAllowed({ fulfillment: 'delivery', deliveredBy: 'platform' }), false);
  assert.equal(isCashAllowed({ fulfillment: 'delivery', deliveredBy: 'restaurant', driverType: 'platform' }), false);
  assert.equal(isCashAllowed({ fulfillment: 'delivery', deliveredBy: 'restaurant', cashEnabled: false }), false);
  assert.equal(isCashAllowed({ fulfillment: 'pickup' }), false);
  assert.deepEqual(
    allowedPaymentMethodsFor(['card', 'cash', 'meal_voucher', 'wallet'], { fulfillment: 'delivery', deliveredBy: 'platform' }),
    ['card', 'wallet'],
  );
});

test('décisions : règles de commande par défaut', () => {
  assert.equal(isAcceptanceExpired(0, 299_000), false);
  assert.equal(isAcceptanceExpired(0, 300_000), true);
  assert.equal(shouldAutoPauseMerchant(2), false);
  assert.equal(shouldAutoPauseMerchant(3), true);
  assert.equal(merchantInactivityAction(14), 'none');
  assert.equal(merchantInactivityAction(15), 'alert');
  assert.equal(merchantInactivityAction(45), 'remove');
  assert.deepEqual(customerAbsentOutcome(), { refundCents: 0, payDriver: true, payRestaurant: true });
});

test('décisions : formules vides mais paramétrables', () => {
  assert.deepEqual(DEFAULT_PLANS.map((p) => p.code), ['basic', 'pro', 'premium']);
  for (const p of DEFAULT_PLANS) {
    assert.equal(p.monthlyPriceHtCents, 0);
    assert.equal(p.yearlyPriceHtCents, 0);
    assert.equal(p.trialDays, 0);
    assert.equal(p.commitmentMonths, 0);
    assert.equal(p.gracePeriodDays, 0);
    assert.equal(p.cardRequired, false);
    assert.equal(p.features.length, 0);
  }
});

test('décisions : marchés multi-devises en unités mineures', () => {
  assert.deepEqual(Object.keys(DEFAULT_PRICING_BY_COUNTRY).sort(), ['BE', 'DZ', 'FR', 'LU', 'MA', 'TN']);
  assert.equal(DEFAULT_PRICING_BY_COUNTRY.MA?.currency, 'MAD');
  assert.equal(DEFAULT_PRICING_TN.currency, 'TND');
  assert.equal(toMinorUnits(12.5, 'TND'), 12_500);
  assert.equal(toMinorUnits(12.5, 'EUR'), 1250);
  assert.ok(formatMoney(1250, 'EUR').includes('12,50'));
  assert.ok(formatMoney(12_500, 'TND').includes('12,500'));
  const q = computeQuote(basket, DEFAULT_PRICING_TN);
  const s = computeSettlement(
    { quote: q, paymentMethod: 'card', commissionBps: 3000, courier: { distanceMeters: 2500, durationMinutes: 15 } },
    DEFAULT_PRICING_TN,
  );
  assertConservation(q, s);
});

test('décisions : vente au poids et taux de TVA propre à la ligne', () => {
  const q = computeQuote(
    {
      fulfillment: 'pickup',
      lines: [
        { unitPriceCents: 0, saleUnit: 'weight', pricePerKgCents: 1290, weightGrams: 750, quantity: 1, vatCategory: 'grocery' },
        { unitPriceCents: 1500, quantity: 1, vatCategory: 'grocery', vatRateBpsOverride: 2000 },
      ],
    },
    DFR,
  );
  assert.equal(q.subtotalCents, 968 + 1500);
  assert.deepEqual(q.itemsVat.map((l) => l.rateBps), [550, 2000]);
});

test('décisions : alcool interdit, détection par mots-clés FR/EN/AR', () => {
  assert.equal(isVatCategorySelectable('alcohol'), false);
  assert.ok(!SELECTABLE_VAT_CATEGORIES.includes('alcohol'));
  assert.equal(normalizeForMatch('BIÈRE  Blonde!'), 'biere blonde');
  assert.equal(detectAlcoholKeywords('Bières artisanales').matched, true);
  assert.equal(detectAlcoholKeywords('Coq au vin').matched, true);
  assert.equal(detectAlcoholKeywords('Vinaigrette maison', 'Salade gingembre').matched, false);
  assert.equal(detectAlcoholKeywords('Bouquet de roses').matched, false);
  assert.equal(detectAlcoholKeywords('Red wine').matched, true);
  assert.equal(detectAlcoholKeywords('بيرة باردة').matched, true);
  assert.equal(detectAlcoholKeywords('والنَّبيذ الأحمر').matched, true);
  const soft = detectAlcoholKeywords('Bière sans alcool');
  assert.equal(soft.matched, true);
  assert.equal(soft.nonAlcoholicMention, true);
  assert.equal(checkProductAlcohol({ name: 'Jus d’orange', vatCategory: 'soft_drink' }).blocked, false);
  assert.deepEqual(checkProductAlcohol({ name: 'Rouge', vatCategory: 'alcohol', containsAlcohol: true }).reasons, [
    'vat_category_alcohol',
    'contains_alcohol',
  ]);
  const flagged = checkProductAlcohol({ name: 'Mojito', description: 'Rhum, menthe', vatCategory: 'soft_drink' });
  assert.equal(flagged.blocked, false);
  assert.equal(flagged.flagged, true);
});
