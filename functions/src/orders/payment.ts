// Paiement des commandes (Stripe, mode déterminé par la clé) : autorisation à la
// commande, encaissement à l'acceptation, libération ou remboursement à l'annulation.
import { COLLECTIONS, formatCardLabel, type CurrencyCode, type Order, type PaymentMethod, type PaymentStatus } from '@golink/shared';
import { logger } from 'firebase-functions/v2';
import type Stripe from 'stripe';
import { db, Timestamp } from '../lib/admin';
import { fail } from '../lib/errors';
import { getStripe, isStripeLiveMode } from '../lib/stripe';

/** Refus de la carte à l'autorisation (banque) : tracé dans les paiements par la commande. */
export class CardRefusedError extends Error {
  constructor(
    readonly failureCode: string,
    message: string,
  ) {
    super(message);
  }
}

/** Moyens réglés par carte via Stripe (Apple Pay et Google Pay produisent aussi un pm_…). */
export const STRIPE_METHODS: readonly PaymentMethod[] = ['card', 'apple_pay', 'google_pay', 'meal_voucher'];

/**
 * Trace un paiement refusé avant la création de la commande (aucune commande n'existe encore) :
 * il apparaît dans le suivi des paiements échoués, et le compteur de tentatives du client augmente.
 */
export async function recordRefusedPayment(input: {
  uid: string;
  clientRequestId: string;
  restaurant: { id: string; countryId: string; cityId: string };
  method: PaymentMethod;
  amountCents: number;
  currency: CurrencyCode;
  failureCode: string;
  message: string;
  isTest: boolean;
}): Promise<void> {
  const now = Timestamp.now();
  const ref = db.collection(COLLECTIONS.payments).doc(`payf-${input.uid}-${input.clientRequestId}`.slice(0, 200));
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    tx.set(
      ref,
      {
        countryId: input.restaurant.countryId,
        cityId: input.restaurant.cityId,
        purpose: 'order',
        orderId: null,
        subscriptionId: null,
        invoiceId: null,
        payerType: 'client',
        payerId: input.uid,
        restaurantId: input.restaurant.id,
        method: input.method,
        amountCents: input.amountCents,
        currency: input.currency,
        status: 'failed',
        provider: 'stripe',
        providerIntentId: null,
        providerChargeId: null,
        feeCents: 0,
        failureCode: input.failureCode,
        failureMessage: input.message,
        attempts: ((snap.get('attempts') as number | undefined) ?? 0) + 1,
        refundedCents: 0,
        createdAt: snap.exists ? snap.get('createdAt') : now,
        updatedAt: now,
        ...(input.isTest ? { test: true } : {}),
      },
      { merge: true },
    );
  });
  const bucket = new Date().toISOString().slice(0, 13);
  const limitRef = db.collection('rateLimits').doc(`payfail_${input.uid}_${bucket}`);
  await db.runTransaction(async (tx) => {
    const count = ((await tx.get(limitRef)).get('count') as number | undefined) ?? 0;
    tx.set(limitRef, { count: count + 1, expiresAt: Timestamp.fromMillis(Date.now() + 2 * 3_600_000) });
  });
}

export interface Authorization {
  status: PaymentStatus;
  intentId: string | null;
  clientSecret: string | null;
  label: string | null;
  fingerprint: string | null;
}

function statusOfIntent(intent: Stripe.PaymentIntent): PaymentStatus {
  switch (intent.status) {
    case 'requires_capture':
      return 'authorized';
    case 'succeeded':
      return 'paid';
    case 'requires_action':
    case 'requires_confirmation':
      return 'requires_action';
    case 'canceled':
      return 'cancelled';
    case 'processing':
      return 'pending';
    default:
      return 'failed';
  }
}

/**
 * Autorise le montant sur le moyen de paiement du client (capture différée à
 * l'acceptation par le restaurant). Les moyens de test Stripe (pm_card_…) ne
 * sont acceptés qu'avec une clé de test.
 */
export async function authorizePayment(input: {
  amountCents: number;
  /** Devise du marché (unités mineures). */
  currency?: CurrencyCode;
  paymentMethodId: string;
  requestId: string;
  customerId: string;
  restaurantId: string;
  restaurantName: string;
}): Promise<Authorization> {
  if (input.paymentMethodId.startsWith('pm_card_') && isStripeLiveMode()) {
    throw fail.invalid('Moyen de paiement invalide.');
  }
  let intent: Stripe.PaymentIntent;
  try {
    intent = await getStripe().paymentIntents.create(
      {
        amount: input.amountCents,
        currency: (input.currency ?? 'EUR').toLowerCase(),
        capture_method: 'manual',
        payment_method: input.paymentMethodId,
        confirm: true,
        automatic_payment_methods: { enabled: true, allow_redirects: 'never' },
        description: `Commande Ciyou Eats · ${input.restaurantName}`,
        metadata: { customerId: input.customerId, restaurantId: input.restaurantId, requestId: input.requestId, platform: 'golink' },
        expand: ['payment_method'],
      },
      { idempotencyKey: `order-pi-${input.requestId}` },
    );
  } catch (error) {
    const stripeError = error as { type?: string; message?: string; code?: string };
    if (stripeError.type === 'StripeCardError') {
      throw new CardRefusedError(stripeError.code ?? 'card_declined', stripeError.message ?? 'Paiement refusé par la banque.');
    }
    logger.error('Autorisation Stripe en échec', { error: stripeError.message, code: stripeError.code });
    throw fail.unavailable('Le paiement n’a pas pu être traité. Réessayez dans un instant.');
  }
  const pm = typeof intent.payment_method === 'object' ? intent.payment_method : null;
  const card = pm?.card;
  return {
    status: statusOfIntent(intent),
    intentId: intent.id,
    clientSecret: intent.status === 'requires_action' ? intent.client_secret : null,
    label: card ? formatCardLabel(card.brand, card.last4) : null,
    fingerprint: card?.fingerprint ?? null,
  };
}

/**
 * Empreinte de la carte avant de l'autoriser (liste de blocage, §28). `null` si le
 * moyen n'est pas une carte ou si Stripe est momentanément indisponible (l'autorisation
 * suivra son cours normal ; ce contrôle est une prévention supplémentaire, pas la seule).
 */
export async function retrieveCardFingerprint(paymentMethodId: string): Promise<string | null> {
  try {
    const pm = await getStripe().paymentMethods.retrieve(paymentMethodId);
    return pm.card?.fingerprint ?? null;
  } catch {
    return null;
  }
}

/** Dernier état de l'intention de paiement (après authentification forte côté app). */
export async function refreshIntentStatus(intentId: string): Promise<PaymentStatus> {
  const intent = await getStripe().paymentIntents.retrieve(intentId);
  return statusOfIntent(intent);
}

async function intentIdOf(order: Order): Promise<string | null> {
  if (!order.payment.paymentId) return null;
  const snap = await db.collection(COLLECTIONS.payments).doc(order.payment.paymentId).get();
  return (snap.get('providerIntentId') as string | null | undefined) ?? null;
}

async function updatePaymentDoc(order: Order, fields: Record<string, unknown>): Promise<void> {
  if (!order.payment.paymentId) return;
  await db
    .collection(COLLECTIONS.payments)
    .doc(order.payment.paymentId)
    .set({ ...fields, updatedAt: Timestamp.now() }, { merge: true });
}

/** Appel Stripe brut de capture, partagé par tous les chemins d'acceptation (manuel ou automatique). */
async function captureIntentRaw(intentId: string, idempotencyKey: string): Promise<{ status: PaymentStatus; providerChargeId: string | null }> {
  const intent = await getStripe().paymentIntents.capture(intentId, {}, { idempotencyKey });
  return {
    status: statusOfIntent(intent),
    providerChargeId: typeof intent.latest_charge === 'string' ? intent.latest_charge : (intent.latest_charge?.id ?? null),
  };
}

/** Encaisse le montant autorisé (acceptation par le restaurant). */
export async function capturePayment(orderId: string, order: Order): Promise<PaymentStatus> {
  if (order.payment.status !== 'authorized') return order.payment.status;
  const intentId = await intentIdOf(order);
  if (!intentId) return order.payment.status;
  try {
    const { status, providerChargeId } = await captureIntentRaw(intentId, `order-capture-${orderId}`);
    await updatePaymentDoc(order, { status, providerChargeId });
    return status;
  } catch (error) {
    logger.error('Encaissement Stripe en échec', { orderId, error: error instanceof Error ? error.message : String(error) });
    await updatePaymentDoc(order, { status: 'failed', failureMessage: 'Encaissement impossible' });
    return 'failed';
  }
}

/**
 * Encaisse immédiatement une autorisation lors d'une acceptation automatique à la création de la
 * commande (réglage restaurant `autoAccept`) : à ce stade le document `payments` n'existe pas encore
 * (l'identifiant de commande n'est attribué que dans la transaction qui suit), donc cette fonction ne
 * touche pas Firestore — l'appelant écrit `status`/`providerChargeId` directement dans les documents
 * qu'il crée. Ne lève jamais d'exception : un échec renvoie `status: 'failed'`, à charge de l'appelant
 * de créer la commande en attente d'acceptation manuelle (qui retentera l'encaissement).
 */
export async function captureAuthorizedIntent(intentId: string, idempotencyKey: string, orderContext: string): Promise<{ status: PaymentStatus; providerChargeId: string | null }> {
  try {
    return await captureIntentRaw(intentId, idempotencyKey);
  } catch (error) {
    logger.error('Encaissement Stripe en échec (acceptation automatique)', { orderContext, error: error instanceof Error ? error.message : String(error) });
    return { status: 'failed', providerChargeId: null };
  }
}

/**
 * Rembourse `refundCents` (ou libère l'autorisation). Renvoie le nouvel état du
 * paiement et l'identifiant du remboursement Stripe le cas échéant.
 */
export async function releaseOrRefund(
  orderId: string,
  order: Order,
  refundCents: number,
): Promise<{ status: PaymentStatus; providerRefundId: string | null; failed: boolean }> {
  const charged = order.amounts.chargedCents;
  if (order.payment.method === 'cash' || order.payment.method === 'wallet') {
    await updatePaymentDoc(order, { status: 'cancelled' });
    return { status: 'cancelled', providerRefundId: null, failed: false };
  }
  const intentId = await intentIdOf(order);
  if (!intentId) return { status: refundCents >= charged ? 'refunded' : 'partially_refunded', providerRefundId: null, failed: false };
  const stripe = getStripe();
  try {
    if (order.payment.status === 'authorized' || order.payment.status === 'requires_action' || order.payment.status === 'pending') {
      if (refundCents >= charged) {
        await stripe.paymentIntents.cancel(intentId, {}, { idempotencyKey: `order-cancel-${orderId}` });
        await updatePaymentDoc(order, { status: 'cancelled', refundedCents: charged });
        return { status: 'cancelled', providerRefundId: null, failed: false };
      }
      // Annulation partiellement remboursée : on n'encaisse que la part retenue.
      await stripe.paymentIntents.capture(intentId, { amount_to_capture: charged - refundCents }, { idempotencyKey: `order-capture-${orderId}` });
      await updatePaymentDoc(order, { status: 'partially_refunded', refundedCents: refundCents });
      return { status: 'partially_refunded', providerRefundId: null, failed: false };
    }
    if (refundCents <= 0) return { status: order.payment.status, providerRefundId: null, failed: false };
    const refund = await stripe.refunds.create(
      { payment_intent: intentId, amount: refundCents, metadata: { orderId, platform: 'golink' } },
      { idempotencyKey: `order-refund-${orderId}-${refundCents}` },
    );
    const status: PaymentStatus = refundCents >= charged ? 'refunded' : 'partially_refunded';
    await updatePaymentDoc(order, { status, refundedCents: order.amounts.refundedCents + refundCents });
    return { status, providerRefundId: refund.id, failed: false };
  } catch (error) {
    logger.error('Remboursement Stripe en échec', { orderId, error: error instanceof Error ? error.message : String(error) });
    return { status: order.payment.status, providerRefundId: null, failed: true };
  }
}
