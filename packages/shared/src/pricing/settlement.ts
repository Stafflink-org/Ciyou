// Répartition d'une commande payée entre restaurant, livreur, prestataire de
// paiement, État (TVA) et plateforme. La marge plateforme est le solde : la somme
// de tous les flux est toujours égale au montant payé par le client.
import { applyBps, htFromTtc, roundCents, type Bps, type Cents } from './money';
import type { CourierPay, MarketPricingConfig, Settlement, SettlementInput } from './types';

export interface CourierPayInput {
  distanceMeters: number;
  durationMinutes: number;
  waitingMinutes?: number;
  surgeBonusCents?: Cents;
  tipCents?: Cents;
  /** Course en heure de pointe : ajoute `courier.peakBonusCents`. */
  isPeak?: boolean;
}

/** Seuil par défaut du forfait course courte (décision client : 2 km). */
export const DEFAULT_COURIER_FLAT_THRESHOLD_METERS = 2000;

/**
 * Rémunération d'une course.
 * - Modèle `flat_then_per_km` (décision client) : forfait sous le seuil ; au-delà,
 *   forfait + km au-delà du seuil (ou distance totale au km, forfait en plancher) ;
 *   + attente + bonus de pointe.
 * - Ancien modèle : prise en charge + remise + km + temps + attente + prime, avec minimum.
 * Les pourboires sont reversés à 100 %.
 */
export function computeCourierPay(input: CourierPayInput, config: MarketPricingConfig): CourierPay {
  const rule = config.courier;
  if (rule.model === 'flat_then_per_km') return computeFlatThenPerKmPay(input, config);
  const distanceCents = roundCents((Math.max(0, input.distanceMeters) / 1000) * rule.perKmCents);
  const timeCents = roundCents(Math.max(0, input.durationMinutes) * rule.perMinuteCents);
  const billableWait = Math.max(0, (input.waitingMinutes ?? 0) - rule.freeWaitMinutes);
  const waitingCents = roundCents(billableWait * rule.waitingPerMinuteCents);
  const peakBonusCents = input.isPeak ? (rule.peakBonusCents ?? 0) : 0;
  const surgeBonusCents = (input.surgeBonusCents ?? 0) + peakBonusCents;
  const raw = rule.pickupCents + rule.dropoffCents + distanceCents + timeCents + waitingCents;
  const minimumTopUpCents = Math.max(0, rule.minimumPerOrderCents - raw);
  const earningsCents = raw + minimumTopUpCents + surgeBonusCents;
  const tipCents = input.tipCents ?? 0;
  return {
    model: 'pickup_dropoff_per_km',
    peakBonusCents,
    pickupCents: rule.pickupCents,
    dropoffCents: rule.dropoffCents,
    distanceCents,
    timeCents,
    waitingCents,
    surgeBonusCents,
    minimumTopUpCents,
    earningsCents,
    tipCents,
    totalCents: earningsCents + tipCents,
  };
}

function computeFlatThenPerKmPay(input: CourierPayInput, config: MarketPricingConfig): CourierPay {
  const rule = config.courier;
  const threshold = rule.flatDistanceThresholdMeters ?? DEFAULT_COURIER_FLAT_THRESHOLD_METERS;
  const flat = rule.flatAmountCents ?? rule.minimumPerOrderCents;
  const distance = Math.max(0, input.distanceMeters);
  let flatCents = flat;
  let distanceCents = 0;
  let minimumTopUpCents = 0;
  if (distance >= threshold) {
    if ((rule.perKmMode ?? 'beyond_threshold') === 'full_distance') {
      const perKm = roundCents((distance / 1000) * rule.perKmCents);
      flatCents = 0;
      distanceCents = perKm;
      minimumTopUpCents = Math.max(0, flat - perKm);
    } else {
      distanceCents = roundCents(((distance - threshold) / 1000) * rule.perKmCents);
    }
  }
  const billableWait = Math.max(0, (input.waitingMinutes ?? 0) - rule.freeWaitMinutes);
  const waitingCents = roundCents(billableWait * rule.waitingPerMinuteCents);
  const peakBonusCents = input.isPeak ? (rule.peakBonusCents ?? 0) : 0;
  const surgeBonusCents = (input.surgeBonusCents ?? 0) + peakBonusCents;
  const earningsCents = flatCents + distanceCents + minimumTopUpCents + waitingCents + surgeBonusCents;
  const tipCents = input.tipCents ?? 0;
  return {
    model: 'flat_then_per_km',
    flatCents,
    peakBonusCents,
    pickupCents: 0,
    dropoffCents: 0,
    distanceCents,
    timeCents: 0,
    waitingCents,
    surgeBonusCents,
    minimumTopUpCents,
    earningsCents,
    tipCents,
    totalCents: earningsCents + tipCents,
  };
}

/** La garantie horaire s'applique-t-elle sur ce marché ? (désactivée par défaut hors France) */
export function isHourlyGuaranteeEnabled(config: MarketPricingConfig): boolean {
  return (config.courier.hourlyGuaranteeEnabled ?? true) && config.courier.hourlyGuaranteeCents > 0;
}

/** Complément dû au livreur pour atteindre le revenu horaire garanti sur la période (semaine). */
export function computeHourlyGuaranteeTopUp(
  earningsExcludingTipsCents: Cents,
  activeMinutes: number,
  hourlyGuaranteeCents: Cents,
): Cents {
  const guaranteed = roundCents((Math.max(0, activeMinutes) / 60) * hourlyGuaranteeCents);
  return Math.max(0, guaranteed - earningsExcludingTipsCents);
}

/** Frais de paiement par carte (Stripe) sur un montant encaissé. */
export function computePaymentFees(
  amountCents: Cents,
  method: SettlementInput['paymentMethod'],
  config: MarketPricingConfig,
): { processingCents: Cents; connectCents: Cents } {
  if (amountCents === 0 || method === 'cash' || method === 'wallet') return { processingCents: 0, connectCents: 0 };
  return {
    processingCents: applyBps(amountCents, config.payment.percentBps) + config.payment.fixedCents,
    connectCents: applyBps(amountCents, config.payment.connectPercentBps),
  };
}

/** Taux de commission applicable au mode de la commande selon la configuration du marché. */
export function marketCommissionBps(
  fulfillment: SettlementInput['quote']['fulfillment'],
  deliveredBy: SettlementInput['quote']['deliveredBy'],
  config: MarketPricingConfig,
): Bps {
  if (fulfillment === 'pickup') return config.commission.pickupBps;
  if (fulfillment === 'dine_in') return config.commission.dineInBps;
  return deliveredBy === 'platform' ? config.commission.platformDeliveryBps : config.commission.restaurantDeliveryBps;
}

export function computeSettlement(input: SettlementInput, config: MarketPricingConfig): Settlement {
  const { quote } = input;
  const d = quote.discount;
  const platformDelivers = quote.fulfillment === 'delivery' && quote.deliveredBy === 'platform';
  const standard = config.vat.standardBps;

  // Commission : assiette = sous-total articles TTC payé par le client (moins remises
  // financées par le commerce), hors frais de livraison, frais de service et pourboires.
  const commissionBase =
    config.commission.base === 'subtotal' ? quote.subtotalCents : quote.subtotalCents - d.restaurantOnItemsCents;
  const commissionHt = applyBps(commissionBase, input.commissionBps);
  const commissionVat = applyBps(commissionHt, standard);
  const commissionTtc = commissionHt + commissionVat;

  // Frais facturés par la plateforme au client (TTC, TVA au taux normal).
  const serviceFeeHt = htFromTtc(quote.serviceFeeCents, standard);
  const smallOrderFeeHt = htFromTtc(quote.smallOrderFeeCents, standard);
  // Livraison plateforme : la part offerte par la plateforme n'est pas encaissée ;
  // la part offerte par le restaurant lui est refacturée et reste une recette.
  const platformDeliveryRevenue = platformDelivers ? quote.deliveryFeeCents - (d.onDeliveryCents - d.restaurantOnDeliveryCents) : 0;
  const deliveryFeeHt = htFromTtc(platformDeliveryRevenue, standard);
  const feesVat =
    quote.serviceFeeCents - serviceFeeHt + (quote.smallOrderFeeCents - smallOrderFeeHt) + (platformDeliveryRevenue - deliveryFeeHt);

  // Paiement.
  // Le portefeuille règle une part du total : les frais de carte et les espèces ne portent que sur le reste.
  const chargedCents = Math.max(0, quote.totalCents - (input.walletAppliedCents ?? 0));
  const fees = computePaymentFees(chargedCents, input.paymentMethod, config);
  const paymentTotal = fees.processingCents + fees.connectCents;
  const restaurantPaysFees = config.payment.payer === 'restaurant';

  // Livreur.
  const courier =
    platformDelivers && input.courier
      ? computeCourierPay(
          {
            distanceMeters: input.courier.distanceMeters,
            durationMinutes: input.courier.durationMinutes,
            waitingMinutes: input.courier.waitingMinutes,
            isPeak: input.courier.isPeak,
            surgeBonusCents: input.surgeCourierBonusCents,
            tipCents: quote.tipCents,
          },
          config,
        )
      : null;

  // Restaurant : sous-total − remises financées − commission TTC (+ livraison s'il livre lui-même).
  const restaurantDeliveryFee = quote.fulfillment === 'delivery' && !platformDelivers ? quote.deliveryFeeCents : 0;
  const restaurantTip = quote.fulfillment === 'delivery' && !platformDelivers ? quote.tipCents : 0;
  const restaurantPaymentFee = restaurantPaysFees ? paymentTotal : 0;
  const payout =
    quote.subtotalCents -
    d.restaurantFundedCents -
    commissionTtc +
    restaurantDeliveryFee +
    restaurantTip -
    restaurantPaymentFee;

  const courierTotal = courier ? courier.totalCents : 0;
  const vatDue = feesVat + commissionVat;
  const margin = quote.totalCents - payout - courierTotal - paymentTotal - vatDue;

  return {
    customerPaidCents: quote.totalCents,
    restaurant: {
      grossCents: quote.subtotalCents,
      discountFundedCents: d.restaurantFundedCents,
      commissionBaseCents: commissionBase,
      commissionBps: input.commissionBps,
      commissionHtCents: commissionHt,
      commissionVatCents: commissionVat,
      commissionTtcCents: commissionTtc,
      deliveryFeeCents: restaurantDeliveryFee,
      paymentFeeCents: restaurantPaymentFee,
      tipCents: restaurantTip,
      payoutCents: payout,
    },
    courier,
    payment: {
      method: input.paymentMethod,
      processingCents: fees.processingCents,
      connectCents: fees.connectCents,
      totalCents: paymentTotal,
      payer: config.payment.payer,
      cashCollectedCents: input.paymentMethod === 'cash' ? chargedCents : 0,
    },
    platform: {
      serviceFeeHtCents: serviceFeeHt,
      smallOrderFeeHtCents: smallOrderFeeHt,
      deliveryFeeHtCents: deliveryFeeHt,
      commissionHtCents: commissionHt,
      vatDueCents: vatDue,
      courierCostCents: courier ? courier.earningsCents : 0,
      promoCostCents: d.platformFundedCents,
      paymentCostCents: restaurantPaysFees ? 0 : paymentTotal,
      marginCents: margin,
    },
  };
}
