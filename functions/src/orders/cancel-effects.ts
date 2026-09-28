// Effets d'une annulation de commande sur ce qui avait été consommé à la commande :
// utilisation d'une offre libérée, avoirs GoLink rendus au portefeuille du client.
// Chaque effet est rejouable sans doublon (identifiants déterministes).
import { COLLECTIONS, type LedgerEntry, type Order, type WalletTransaction } from '@golink/shared';
import { db, Timestamp } from '../lib/admin';
import { releasePromotion } from './promotions';

const today = (): string => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

/** Rend au client les avoirs utilisés pour régler la commande annulée. */
export async function restoreWalletForCancelledOrder(orderId: string, order: Order): Promise<number> {
  const applied = order.amounts.walletAppliedCents ?? 0;
  if (applied <= 0) return 0;
  const userRef = db.collection(COLLECTIONS.users).doc(order.customerId);
  const txRef = db.collection(COLLECTIONS.walletTransactions).doc(`wr-${orderId}`);
  const test = (order as Order & { test?: boolean }).test === true;
  return db.runTransaction(async (tx) => {
    const [done, user] = await Promise.all([tx.get(txRef), tx.get(userRef)]);
    if (done.exists || !user.exists) return 0;
    const at = Timestamp.now();
    const balanceAfter = ((user.get('walletBalanceCents') as number | undefined) ?? 0) + applied;
    const entry: WalletTransaction = {
      userId: order.customerId,
      type: 'reversal',
      amountCents: applied,
      balanceAfterCents: balanceAfter,
      reason: 'order_payment',
      orderId,
      ticketId: null,
      refundId: null,
      expiresAt: null,
      note: `Commande ${order.number} annulée : avoirs rendus`,
      createdAt: at,
      createdBy: 'system',
    };
    tx.set(txRef, { ...entry, ...(test ? { test: true } : {}) });
    tx.update(userRef, { walletBalanceCents: balanceAfter, updatedAt: at });
    const ledger: LedgerEntry = {
      countryId: order.countryId,
      cityId: order.cityId,
      accountType: 'customer_wallet',
      accountId: order.customerId,
      type: 'wallet_credit',
      amountCents: applied,
      currency: 'EUR',
      orderId,
      description: `Avoirs rendus ${order.number}`,
      bookingDate: today(),
      createdAt: at,
      createdBy: 'system',
    };
    tx.set(db.collection(COLLECTIONS.ledgerEntries).doc(`wr-${orderId}`), { ...ledger, ...(test ? { test: true } : {}) });
    return applied;
  });
}

/** Commande annulée : offre libérée et avoirs rendus. */
export async function applyCancellationEffects(orderId: string, order: Order): Promise<{ promotionReleased: boolean; walletRestoredCents: number }> {
  const promotionReleased = await releasePromotion(orderId, order);
  const walletRestoredCents = await restoreWalletForCancelledOrder(orderId, order);
  return { promotionReleased, walletRestoredCents };
}
