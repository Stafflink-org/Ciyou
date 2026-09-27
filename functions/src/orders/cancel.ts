// Annulation et refus : statut, remboursement selon les règles (imputation
// restaurant / livreur / plateforme), remise en stock, promotion, livreur,
// journal d'audit.
import {
  CANCEL_REASONS,
  CANCEL_REASON_LABELS,
  CANCELLABLE_FROM,
  COLLECTIONS,
  ORDER_REJECT_REASONS,
  ORDER_REJECT_REASON_LABELS,
  SUBCOLLECTIONS,
  allocateRefund,
  computeCancellationRefund,
  formatPrice,
  type CancelOrderResult,
  type CancelReason,
  type CancellableStage,
  type Order,
  type OrderRules,
  type Product,
  type Refund,
  type RefundCause,
  type StockMovement,
} from '@golink/shared';
import { logger } from 'firebase-functions/v2';
import type { CallableRequest } from 'firebase-functions/v2/https';
import { db, FieldValue, Timestamp } from '../lib/admin';
import { actorFromCaller, SYSTEM_ACTOR, writeAudit } from '../lib/audit';
import { ordersCallable as callable } from './runtime';
import { fail } from '../lib/errors';
import { requireAuth, type RestaurantActor } from '../lib/permissions';
import { STRIPE_SECRET_KEY } from '../lib/secrets';
import { z, zId } from '../lib/validation';
import { addEvent, eventActorOf, loadMarket, loadOrder, loadOrderRules, orderRef, requireOrderStaff, SYSTEM_EVENT_ACTOR, type EventActor } from './context';
import { readDriver, releaseDriverInTransaction } from './dispatch';
import { releaseOrRefund } from './payment';

/** Étape d'annulation client correspondant au statut (politique `customerCancellation`). */
const CUSTOMER_STAGE: Partial<Record<Order['status'], CancellableStage>> = {
  scheduled: 'pending',
  new: 'pending',
  accepted: 'accepted',
  preparing: 'preparing',
};

/** Cause de remboursement (imputation) selon le motif et l'auteur de l'annulation. */
function refundCauseOf(reason: CancelReason, actor: EventActor['type']): RefundCause {
  switch (reason) {
    case 'restaurant_timeout':
      return 'restaurant_timeout';
    case 'item_unavailable':
      return 'item_unavailable';
    case 'restaurant_rejected':
    case 'restaurant_closed':
      return 'restaurant_cancelled';
    case 'customer_request':
      return 'customer_cancelled';
    case 'customer_absent':
      return 'customer_absent';
    case 'no_driver_available':
    case 'address_unreachable':
      return 'delivery_issue';
    case 'payment_failed':
      return 'payment_issue';
    case 'fraud_suspected':
    case 'duplicate':
      return 'platform_error';
    default:
      return actor === 'restaurant' ? 'restaurant_cancelled' : 'platform_error';
  }
}

export interface CancelInput {
  orderId: string;
  actor: EventActor;
  reason: CancelReason;
  details: string | null;
  restock: boolean;
}

/**
 * Annule une commande (toute origine). Le montant remboursé dépend de l'auteur :
 * le client selon la politique d'annulation, le restaurant et Ciyou Eats en totalité
 * (sauf client absent, selon les règles).
 */
export async function cancelOrderInternal(input: CancelInput): Promise<CancelOrderResult & { order: Order }> {
  const order = await loadOrder(input.orderId);
  const market = await loadMarket(order.countryId, order.cityId);
  const rules: OrderRules = await loadOrderRules(market);

  const outcome = await db.runTransaction(async (tx) => {
    const snap = await tx.get(orderRef(input.orderId));
    const current = snap.data() as Order;
    if (!CANCELLABLE_FROM[input.actor.type].includes(current.status)) {
      throw fail.precondition(current.status === 'cancelled' ? 'Cette commande est déjà annulée.' : 'Cette commande ne peut plus être annulée.');
    }
    const refundable = current.amounts.chargedCents - current.amounts.refundedCents;
    let refundCents = refundable;
    if (input.actor.type === 'customer') {
      const stage = CUSTOMER_STAGE[current.status];
      const policy = stage ? computeCancellationRefund(current.amounts.chargedCents, current.amounts.tipCents, stage, rules.customerCancellation) : { allowed: false, refundCents: 0 };
      if (!policy.allowed) throw fail.precondition('Votre commande est déjà en préparation et ne peut plus être annulée.');
      refundCents = Math.min(refundable, policy.refundCents);
    } else if (input.reason === 'customer_absent' && rules.customerAbsent && !rules.customerAbsent.refundCustomer) {
      refundCents = 0;
    }
    if (current.payment.method === 'cash') refundCents = 0;
    const cause = refundCauseOf(input.reason, input.actor.type);
    const allocation = allocateRefund(refundCents, cause, rules.refundLiability);

    // Lectures avant écritures : produits à remettre en stock, livreur.
    const restaurantRef = db.collection(COLLECTIONS.restaurants).doc(current.restaurantId);
    const stockRefs = input.restock ? [...new Set(current.items.map((i) => i.productId))].map((id) => restaurantRef.collection(SUBCOLLECTIONS.restaurants.products).doc(id)) : [];
    const stockSnaps = stockRefs.length ? await tx.getAll(...stockRefs) : [];
    const driverState = current.driverId ? await readDriver(tx, current.driverId) : null;

    const at = Timestamp.now();
    const refundId = refundCents > 0 ? `rf-${input.orderId}` : null;
    tx.update(snap.ref, {
      status: 'cancelled',
      'timeline.cancelled': at,
      cancellation: {
        reason: input.reason,
        details: input.details,
        by: input.actor.type,
        byUid: input.actor.uid,
        at,
        refundCents,
        restaurantChargeCents: allocation.restaurantCents,
      },
      'amounts.refundedCents': current.amounts.refundedCents + refundCents,
      'flags.refunded': refundCents > 0,
      acceptDeadline: null,
      ...(current.delivery ? { 'delivery.dispatchStatus': null } : {}),
      updatedAt: at,
    });
    addEvent(tx, input.orderId, input.actor, {
      type: 'status_changed',
      from: current.status,
      to: 'cancelled',
      visibleToCustomer: true,
      message: input.details ? `${CANCEL_REASON_LABELS[input.reason]} · ${input.details}` : CANCEL_REASON_LABELS[input.reason],
      data: { reason: input.reason },
    }, at);
    if (refundCents > 0) {
      addEvent(tx, input.orderId, input.actor, {
        type: 'refund_issued',
        from: null,
        to: null,
        visibleToCustomer: true,
        message: `Remboursement de ${formatPrice(refundCents)} sur le moyen de paiement d’origine.`,
        data: { refundCents, restaurantCents: allocation.restaurantCents, platformCents: allocation.platformCents },
      }, at);
      const refund: Refund = {
        orderId: input.orderId,
        orderNumber: current.number,
        countryId: current.countryId,
        cityId: current.cityId,
        customerId: current.customerId,
        restaurantId: current.restaurantId,
        driverId: current.driverId ?? null,
        ticketId: null,
        amountCents: refundCents,
        method: 'original_payment',
        cause,
        allocation,
        items: null,
        status: 'approved',
        automatic: true,
        reason: input.details ?? CANCEL_REASON_LABELS[input.reason],
        requestedBy: input.actor.uid ?? 'system',
        requestedAt: at,
        approvedBy: 'system',
        approvedAt: at,
        rejectionReason: null,
        providerRefundId: null,
        creditNoteId: null,
        processedAt: null,
      };
      tx.set(db.collection(COLLECTIONS.refunds).doc(refundId as string), { ...refund, ...(current.test ? { test: true } : {}) });
    }

    // Remise en stock des articles suivis.
    for (const stockSnap of stockSnaps) {
      const product = stockSnap.data() as Product | undefined;
      if (!product || product.stock === null || product.stock === undefined) continue;
      const qty = current.items.filter((i) => i.productId === stockSnap.id).reduce((s, i) => s + i.quantity, 0);
      if (qty === 0) continue;
      tx.update(stockSnap.ref, { stock: product.stock + qty, updatedAt: at, updatedBy: 'system' });
      const movement: StockMovement = { productId: stockSnap.id, productName: product.name, delta: qty, stockAfter: product.stock + qty, reason: 'order_cancelled', orderId: input.orderId, note: current.number, createdAt: at, createdBy: input.actor.uid ?? 'system' };
      tx.set(restaurantRef.collection(SUBCOLLECTIONS.restaurants.stockMovements).doc(), movement);
    }

    // Promotion : l'utilisation est rendue au client.
    if (current.promotionId && current.amounts.discount.totalCents > 0) {
      tx.set(db.collection(COLLECTIONS.promotionRedemptions).doc(input.orderId), { status: 'reversed', reversedAt: at, reversedReason: 'Commande annulée' }, { merge: true });
      tx.update(db.collection(COLLECTIONS.promotions).doc(current.promotionId), {
        'stats.redemptions': FieldValue.increment(-1),
        'stats.discountCents': FieldValue.increment(-current.amounts.discount.totalCents),
        'stats.ordersSubtotalCents': FieldValue.increment(-current.amounts.subtotalCents),
        ...(current.flags?.firstOrder ? { 'stats.newCustomers': FieldValue.increment(-1) } : {}),
      });
    }
    if (current.driverId && driverState) releaseDriverInTransaction(tx, current.driverId, input.orderId, driverState.driver, driverState.location);
    return { current, refundCents, refundId };
  });

  // Paiement : libération de l'autorisation ou remboursement Stripe.
  const payment = await releaseOrRefund(input.orderId, outcome.current, outcome.refundCents);
  const after: Record<string, unknown> = { 'payment.status': payment.failed ? outcome.current.payment.status : payment.status, updatedAt: Timestamp.now() };
  await orderRef(input.orderId).update(after);
  if (outcome.refundId) {
    await db.collection(COLLECTIONS.refunds).doc(outcome.refundId).update(
      payment.failed
        ? { status: 'failed' }
        : { status: 'processed', providerRefundId: payment.providerRefundId, processedAt: Timestamp.now() },
    );
  }
  if (payment.failed) logger.error('Remboursement à reprendre manuellement', { orderId: input.orderId });
  return { refundCents: outcome.refundCents, refundId: outcome.refundId, order: outcome.current };
}

async function auditCancellation(
  request: CallableRequest<unknown> | null,
  actor: RestaurantActor | null,
  orderId: string,
  order: Order,
  action: string,
  reason: string,
  refundCents: number,
): Promise<void> {
  await writeAudit({
    actor: actor ? actorFromCaller(actor.caller, actor.kind === 'admin' ? 'admin' : 'restaurant') : request ? actorFromCaller(requireAuth(request)) : SYSTEM_ACTOR,
    action,
    target: { type: 'order', id: orderId, label: `${order.number} · ${order.restaurantName}` },
    reason,
    before: { status: order.status, totalCents: order.amounts.totalCents },
    after: { status: 'cancelled', refundCents },
    countryId: order.countryId,
    cityId: order.cityId ?? null,
    request: request ?? undefined,
  });
}

/** Refus d'une nouvelle commande par le restaurant (remboursement intégral). */
export const rejectOrder = callable(
  z.object({ orderId: zId, reason: z.enum(ORDER_REJECT_REASONS), details: z.string().trim().max(500).nullish() }),
  async (data, request): Promise<CancelOrderResult> => {
    const order = await loadOrder(data.orderId);
    const actor = await requireOrderStaff(request, order, 'orders.manage');
    if (order.status !== 'new') throw fail.precondition('Seule une nouvelle commande peut être refusée.');
    if (data.reason === 'restaurant_rejected' && !data.details) throw fail.invalid('Précisez le motif du refus.');
    const result = await cancelOrderInternal({ orderId: data.orderId, actor: eventActorOf(actor), reason: data.reason, details: data.details ?? null, restock: true });
    await auditCancellation(request, actor, data.orderId, order, 'order.rejected', data.details || ORDER_REJECT_REASON_LABELS[data.reason], result.refundCents);
    return { refundCents: result.refundCents, refundId: result.refundId };
  },
  { secrets: [STRIPE_SECRET_KEY] },
);

/**
 * Annulation d'une commande en cours : par le restaurant (orders.cancel), un
 * administrateur habilité, ou le client lui-même selon la politique d'annulation.
 */
export const cancelOrder = callable(
  z.object({ orderId: zId, reason: z.enum(CANCEL_REASONS), details: z.string().trim().min(3, 'Indiquez un motif').max(500), restock: z.boolean().optional() }),
  async (data, request): Promise<CancelOrderResult> => {
    const caller = requireAuth(request);
    const order = await loadOrder(data.orderId);
    let actor: RestaurantActor | null = null;
    let eventActor: EventActor;
    if (order.customerId === caller.uid) {
      if (data.reason !== 'customer_request') throw fail.invalid('Motif d’annulation invalide.');
      eventActor = { type: 'customer', uid: caller.uid, name: order.customerName };
    } else {
      actor = await requireOrderStaff(request, order, 'orders.cancel');
      eventActor = eventActorOf(actor);
    }
    const result = await cancelOrderInternal({ orderId: data.orderId, actor: eventActor, reason: data.reason, details: data.details, restock: data.restock ?? true });
    await auditCancellation(request, actor, data.orderId, order, 'order.cancelled', data.details, result.refundCents);
    return { refundCents: result.refundCents, refundId: result.refundId };
  },
  { secrets: [STRIPE_SECRET_KEY] },
);

/** Annulation automatique (délai d'acceptation dépassé, paiement non abouti). */
export async function cancelBySystem(orderId: string, reason: CancelReason, details: string): Promise<void> {
  const result = await cancelOrderInternal({ orderId, actor: SYSTEM_EVENT_ACTOR, reason, details, restock: true });
  await auditCancellation(null, null, orderId, result.order, 'order.auto_cancelled', details, result.refundCents);
}
