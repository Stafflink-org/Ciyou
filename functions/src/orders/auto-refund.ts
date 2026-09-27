// Remboursement partiel automatique d'une commande (article retiré, geste sur réclamation,
// client absent remboursé si le réglage l'exige) : document `refunds` (imputation selon
// `refundLiability`, décision client : le commerce paie), remboursement Stripe idempotent,
// mise à jour de la commande et de sa chronologie. Le trigger `onRefundProcessed` du module
// finance déduit ensuite la part imputée du prochain reversement.
import { COLLECTIONS, allocateRefund, formatPrice, type Order, type Refund, type RefundCause } from '@golink/shared';
import { logger } from 'firebase-functions/v2';
import { db, Timestamp } from '../lib/admin';
import { getStripe } from '../lib/stripe';
import { addEvent, loadMarket, loadOrderRules, orderRef, type EventActor } from './context';

export interface AutoRefundInput {
  orderId: string;
  /** Clé d'idempotence de ce geste (ex. `item-<ligne>`, `absent`, `claim-<id>`). */
  key: string;
  amountCents: number;
  cause: RefundCause;
  reason: string;
  actor: EventActor;
  /** Lignes concernées (traçabilité). */
  lineIds?: string[];
  ticketId?: string | null;
}

export interface AutoRefundResult {
  refundId: string | null;
  status: 'processed' | 'failed' | 'skipped';
  amountCents: number;
}

/** Montant encore remboursable : encaissé − déjà remboursé − remboursements en attente. */
export async function refundableCents(orderId: string, order: Order): Promise<number> {
  const pending = await db.collection(COLLECTIONS.refunds).where('orderId', '==', orderId).where('status', 'in', ['pending_approval', 'approved']).get();
  const reserved = pending.docs.reduce((sum, d) => sum + ((d.get('amountCents') as number | undefined) ?? 0), 0);
  return Math.max(0, order.amounts.chargedCents - order.amounts.refundedCents - reserved);
}

export async function issueAutoRefund(input: AutoRefundInput): Promise<AutoRefundResult> {
  const refundId = `rf-${input.orderId}-${input.key}`;
  const refundRef = db.collection(COLLECTIONS.refunds).doc(refundId);
  const existing = await refundRef.get();
  if (existing.exists) return { refundId, status: existing.get('status') === 'processed' ? 'processed' : 'failed', amountCents: (existing.get('amountCents') as number) ?? 0 };

  const orderSnap = await orderRef(input.orderId).get();
  const order = orderSnap.data() as Order | undefined;
  if (!order) return { refundId: null, status: 'skipped', amountCents: 0 };
  // Espèces : rien n'a été encaissé en ligne, donc rien à rembourser.
  if (order.payment.method === 'cash') return { refundId: null, status: 'skipped', amountCents: 0 };
  const amount = Math.min(input.amountCents, await refundableCents(input.orderId, order));
  if (amount <= 0) return { refundId: null, status: 'skipped', amountCents: 0 };

  const rules = await loadOrderRules(await loadMarket(order.countryId, order.cityId));
  const allocation = allocateRefund(amount, input.cause, rules.refundLiability);
  const at = Timestamp.now();
  const refund: Refund = {
    orderId: input.orderId,
    orderNumber: order.number,
    countryId: order.countryId,
    cityId: order.cityId,
    customerId: order.customerId,
    restaurantId: order.restaurantId,
    driverId: order.driverId ?? null,
    ticketId: input.ticketId ?? null,
    amountCents: amount,
    method: 'original_payment',
    cause: input.cause,
    allocation,
    items: null,
    status: 'approved',
    automatic: true,
    reason: input.reason,
    requestedBy: input.actor.uid ?? 'system',
    requestedAt: at,
    approvedBy: 'system',
    approvedAt: at,
    rejectionReason: null,
    providerRefundId: null,
    creditNoteId: null,
    processedAt: null,
  };
  await refundRef.set({ ...refund, ...(order.test ? { test: true } : {}), ...(input.lineIds?.length ? { lineIds: input.lineIds } : {}) });

  // Paiement : remboursement Stripe (sauf paiement de démonstration sans intention réelle).
  let providerRefundId: string | null = null;
  const paymentId = order.payment.paymentId ?? null;
  const payment = paymentId ? await db.collection(COLLECTIONS.payments).doc(paymentId).get() : null;
  const intentId = (payment?.get('providerIntentId') as string | null | undefined) ?? null;
  const simulated = !intentId || intentId.startsWith('pi_seed') || payment?.get('seed') === true;
  if (intentId && !simulated) {
    try {
      const stripeRefund = await getStripe().refunds.create(
        { payment_intent: intentId, amount, metadata: { orderId: input.orderId, refundId, platform: 'golink' } },
        { idempotencyKey: `auto-refund-${refundId}` },
      );
      providerRefundId = stripeRefund.id;
    } catch (error) {
      logger.error('Remboursement automatique Stripe en échec', { refundId, error: error instanceof Error ? error.message : String(error) });
      await refundRef.update({ status: 'failed', processedAt: Timestamp.now() });
      return { refundId, status: 'failed', amountCents: amount };
    }
  }

  await db.runTransaction(async (tx) => {
    const fresh = (await tx.get(orderRef(input.orderId))).data() as Order;
    const refunded = fresh.amounts.refundedCents + amount;
    tx.update(orderRef(input.orderId), { 'amounts.refundedCents': refunded, 'flags.refunded': true, updatedAt: at });
    addEvent(
      tx,
      input.orderId,
      input.actor,
      {
        type: 'refund_issued',
        from: null,
        to: null,
        visibleToCustomer: true,
        message: `${input.reason} · remboursement de ${formatPrice(amount)} sur le moyen de paiement d’origine.`,
        data: { refundCents: amount, restaurantCents: allocation.restaurantCents, platformCents: allocation.platformCents, cause: input.cause },
      },
      at,
    );
    tx.update(refundRef, { status: 'processed', providerRefundId, processedAt: at });
    if (paymentId) {
      tx.set(
        db.collection(COLLECTIONS.payments).doc(paymentId),
        { refundedCents: refunded, status: refunded >= fresh.amounts.chargedCents ? 'refunded' : 'partially_refunded', updatedAt: at },
        { merge: true },
      );
    }
  });
  return { refundId, status: 'processed', amountCents: amount };
}
