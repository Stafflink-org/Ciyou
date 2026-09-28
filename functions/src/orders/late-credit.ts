// Geste automatique de retard (cahier §9) : une commande livrée avec plus de X minutes de retard
// sur l'heure promise donne droit à un avoir sur le porte-monnaie du client, selon les paliers
// réglés par ville (`lateCredit.tiers`). L'avoir est imputé selon `refundLiability` (décision
// client : le commerce paie). Idempotent : identifiants déterministes et marqueur sur la commande.
import {
  COLLECTIONS,
  allocateRefund,
  computeLateCredit,
  formatPrice,
  type LedgerEntry,
  type Order,
  type UserProfile,
  type WalletTransaction,
} from '@golink/shared';
import { db, Timestamp } from '../lib/admin';
import { SYSTEM_ACTOR, writeAudit } from '../lib/audit';
import { sendPlatformMessage } from '../notifications/messages';
import { addEvent, loadMarket, loadOrderRules, orderRef, SYSTEM_EVENT_ACTOR } from './context';

function parisDay(date: Date): string {
  return new Intl.DateTimeFormat('fr-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

function frDate(ms: number): string {
  return new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(ms));
}

export type LateCreditOutcome = 'credited' | 'not_late' | 'disabled' | 'already_done' | 'not_applicable';

/** Crédite l'avoir de retard d'une commande livrée, une seule fois. */
export async function applyLateCredit(orderId: string): Promise<{ outcome: LateCreditOutcome; amountCents: number }> {
  const snap = await orderRef(orderId).get();
  const order = snap.data() as Order | undefined;
  if (!order || order.status !== 'delivered' || order.fulfillment !== 'delivery' || order.closedAs === 'customer_absent') return { outcome: 'not_applicable', amountCents: 0 };
  if (order.processed?.lateCreditDone) return { outcome: 'already_done', amountCents: 0 };
  const rules = await loadOrderRules(await loadMarket(order.countryId, order.cityId));
  const lateMinutes = order.flags.lateMinutes ?? 0;

  const markDone = () => orderRef(orderId).update({ 'processed.lateCreditDone': true });
  if (!rules.lateCredit.enabled) return { outcome: 'disabled', amountCents: 0 };
  // Base de l'avoir : le total payé hors pourboire (le pourboire revient au livreur).
  const credit = computeLateCredit(lateMinutes, order.amounts.totalCents - order.amounts.tipCents, rules.lateCredit.tiers);
  if (credit <= 0) {
    await markDone();
    return { outcome: 'not_late', amountCents: 0 };
  }

  const allocation = allocateRefund(credit, 'delivery_late', rules.refundLiability);
  const at = Timestamp.now();
  const expiresAt = Timestamp.fromMillis(at.toMillis() + rules.lateCredit.creditValidityDays * 86_400_000);
  const userRef = db.collection(COLLECTIONS.users).doc(order.customerId);
  const walletRef = db.collection(COLLECTIONS.walletTransactions).doc(`lc-${orderId}`);
  const done = await db.runTransaction(async (tx) => {
    const [fresh, wallet, user] = await Promise.all([tx.get(orderRef(orderId)), tx.get(walletRef), tx.get(userRef)]);
    if ((fresh.data() as Order).processed?.lateCreditDone || wallet.exists) return null;
    const profile = user.data() as UserProfile | undefined;
    if (!profile) return null;
    const balanceAfter = (profile.walletBalanceCents ?? 0) + credit;
    const entry: WalletTransaction = {
      userId: order.customerId,
      type: 'credit',
      amountCents: credit,
      balanceAfterCents: balanceAfter,
      reason: 'late_delivery',
      orderId,
      ticketId: null,
      refundId: null,
      expiresAt,
      note: `Retard de ${lateMinutes} minutes sur la commande ${order.number}`,
      createdAt: at,
      createdBy: 'system',
    };
    tx.create(walletRef, { ...entry, ...(order.test ? { test: true } : {}) });
    tx.update(userRef, { walletBalanceCents: balanceAfter, updatedAt: at });
    const base = { currency: 'EUR' as const, bookingDate: parisDay(at.toDate()), countryId: order.countryId, cityId: order.cityId ?? null, orderId, refundId: null, payoutId: null, vatCents: null, createdAt: at, createdBy: 'system', reason: `Retard de ${lateMinutes} minutes`, ...(order.test ? { test: true } : {}) };
    const ledger: Array<[string, LedgerEntry]> = [
      [`lc-${orderId}-w`, { ...base, accountType: 'customer_wallet', accountId: order.customerId, type: 'wallet_credit', amountCents: credit, description: `Avoir de retard ${order.number}` }],
    ];
    if (allocation.restaurantCents > 0) ledger.push([`lc-${orderId}-r`, { ...base, accountType: 'restaurant', accountId: order.restaurantId, type: 'refund_charge', amountCents: -allocation.restaurantCents, description: `Avoir de retard imputé ${order.number}` }]);
    if (allocation.courierCents > 0 && order.driverId) ledger.push([`lc-${orderId}-l`, { ...base, accountType: 'driver', accountId: order.driverId, type: 'refund_charge', amountCents: -allocation.courierCents, description: `Avoir de retard imputé ${order.number}` }]);
    if (allocation.platformCents > 0) ledger.push([`lc-${orderId}-p`, { ...base, accountType: 'platform', accountId: 'golink', type: 'wallet_credit', amountCents: -allocation.platformCents, description: `Geste de retard ${order.number}` }]);
    for (const [id, doc] of ledger) tx.create(db.collection(COLLECTIONS.ledgerEntries).doc(id), doc);
    tx.update(orderRef(orderId), { 'processed.lateCreditDone': true, updatedAt: at });
    addEvent(tx, orderId, SYSTEM_EVENT_ACTOR, {
      type: 'credit_issued',
      from: null,
      to: null,
      visibleToCustomer: true,
      message: `Avoir de retard de ${formatPrice(credit)} crédité (${lateMinutes} minutes de retard).`,
      data: { creditCents: credit, lateMinutes, restaurantCents: allocation.restaurantCents, platformCents: allocation.platformCents },
    }, at);
    return balanceAfter;
  });
  if (done === null) return { outcome: 'already_done', amountCents: 0 };

  await writeAudit({
    actor: SYSTEM_ACTOR,
    action: 'wallet.late_credit_issued',
    target: { type: 'order', id: orderId, label: `${order.number} · ${order.restaurantName}` },
    reason: `Retard de ${lateMinutes} minutes : palier automatique de la ville`,
    after: { creditCents: credit, lateMinutes, balanceAfterCents: done, chargedToRestaurantCents: allocation.restaurantCents, chargedToPlatformCents: allocation.platformCents },
    countryId: order.countryId,
    cityId: order.cityId ?? null,
    sensitive: false,
  });
  await sendPlatformMessage(
    'late_credit_issued',
    { uid: order.customerId, type: 'client', name: order.customerName, demo: order.test === true },
    { orderNumber: order.number, lateMinutes, amount: formatPrice(credit), date: frDate(expiresAt.toMillis()) },
    { dedupeKey: orderId, link: { type: 'order', target: orderId } },
  );
  return { outcome: 'credited', amountCents: credit };
}
