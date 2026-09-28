// Messages automatiques liés aux commandes : confirmation, prêt au retrait, livreur en
// route, livrée, annulée, client absent, remboursement, nouvelle commande du commerce.
// Appelé par le trigger `onOrderWritten` à chaque écriture de commande ; idempotent
// (une clé par commande et par message).
import { CANCEL_REASON_LABELS, COLLECTIONS, SUBCOLLECTIONS, formatPrice, memberHasPermission, type Order, type RestaurantMember } from '@golink/shared';
import { db } from '../lib/admin';
import { sendPlatformMessage, type MessageTarget } from './messages';

function timeLabel(ms: number | null | undefined): string {
  if (!ms) return 'bientôt';
  return new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit' }).format(new Date(ms)).replace(':', ' h ');
}

/** Équipe du commerce autorisée à suivre les commandes (destinataires des messages de service). */
export async function restaurantStaffTargets(restaurantId: string, demo: boolean): Promise<MessageTarget[]> {
  const snap = await db.collection(COLLECTIONS.restaurants).doc(restaurantId).collection(SUBCOLLECTIONS.restaurants.members).where('active', '==', true).get();
  return snap.docs
    .filter((doc) => memberHasPermission(doc.data() as RestaurantMember, 'orders.view'))
    .map((doc) => ({ uid: doc.id, type: 'restaurant' as const, demo }));
}

/** Émet les messages correspondant au changement d'état de la commande. */
export async function notifyOrderChange(orderId: string, before: Order | undefined, after: Order | undefined): Promise<void> {
  if (!after) return;
  const customer: MessageTarget = { uid: after.customerId, type: 'client', name: after.customerName, demo: after.test === true };
  const link = { type: 'order' as const, target: orderId };
  const changed = before?.status !== after.status;

  // Nouvelle commande : le commerce n'est prévenu qu'une fois le paiement confirmé.
  const awaitingPayment = (o: Order) => o.payment.status === 'requires_action' || (o.payment.status === 'pending' && o.payment.method !== 'cash');
  const becameVisible = after.status === 'new' && (!before ? !awaitingPayment(after) : awaitingPayment(before) && !awaitingPayment(after));
  if (becameVisible) {
    const total = formatPrice(after.amounts.totalCents);
    const targets = await restaurantStaffTargets(after.restaurantId, after.test === true);
    await Promise.all(
      targets.map((t) => sendPlatformMessage('restaurant_new_order', t, { orderNumber: after.number, itemsCount: after.itemsCount, total }, { dedupeKey: orderId, link })),
    );
  }
  if (!before) return;

  if (changed && (after.status === 'preparing' || after.status === 'accepted') && before.status === 'new') {
    await sendPlatformMessage('order_confirmed', customer, { restaurantName: after.restaurantName, orderNumber: after.number }, { dedupeKey: orderId, link });
  }
  if (changed && after.status === 'ready' && after.fulfillment !== 'delivery') {
    await sendPlatformMessage('order_ready_pickup', customer, { restaurantName: after.restaurantName, orderNumber: after.number, code: after.pickupCode ?? '' }, { dedupeKey: orderId, link });
  }
  if (changed && after.status === 'picked_up') {
    await sendPlatformMessage(
      'order_picked_up',
      customer,
      { driverName: after.delivery?.driverName ?? 'Votre livreur', eta: timeLabel(after.delivery?.estimatedArrivalAt?.toMillis()) },
      { dedupeKey: orderId, link },
    );
  }
  if (changed && after.status === 'delivered' && after.closedAs !== 'customer_absent') {
    await sendPlatformMessage('order_delivered', customer, { orderNumber: after.number }, { dedupeKey: orderId, link, ctaUrl: null });
  }
  if (after.closedAs === 'customer_absent' && before.closedAs !== 'customer_absent') {
    const waited = after.customerAbsence?.waitMinutes ?? (after.customerAbsence ? Math.max(1, Math.round((after.customerAbsence.waitUntil.toMillis() - after.customerAbsence.arrivedAt.toMillis()) / 60_000)) : 10);
    await sendPlatformMessage('order_customer_absent', customer, { orderNumber: after.number, waitMinutes: waited }, { dedupeKey: orderId, link });
  }
  if (changed && after.status === 'cancelled' && after.cancellation) {
    await sendPlatformMessage(
      'order_cancelled',
      customer,
      { orderNumber: after.number, reason: CANCEL_REASON_LABELS[after.cancellation.reason].toLowerCase(), amount: formatPrice(after.cancellation.refundCents) },
      { dedupeKey: orderId, link },
    );
  }
  // Remboursement partiel ou tardif (hors annulation, déjà couverte par son propre message).
  const refundDelta = after.amounts.refundedCents - before.amounts.refundedCents;
  if (refundDelta > 0 && !(changed && after.status === 'cancelled')) {
    await sendPlatformMessage('refund_issued', customer, { orderNumber: after.number, amount: formatPrice(refundDelta) }, { dedupeKey: `${orderId}-${after.amounts.refundedCents}`, link });
  }
}
