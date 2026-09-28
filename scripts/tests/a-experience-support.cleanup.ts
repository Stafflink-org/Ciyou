// Nettoyage après le parcours a-experience-support.flow.mjs : supprime le ticket de
// test et annule ses effets (remboursements, avoirs, écritures comptables, montants
// de la commande et du paiement, notifications). Le journal d'audit est conservé.
// Usage : npx tsx scripts/tests/a-experience-support.cleanup.ts [ticketId]
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FieldValue } from '@google-cloud/firestore';
import { COLLECTIONS, SUBCOLLECTIONS, type Order, type Refund, type SupportTicket, type WalletTransaction } from '@golink/shared';
import { db } from '../lib/admin.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const ticketId = process.argv[2] ?? readFileSync(join(root, '.smoke', 'a-experience-support', 'flow-ticket.txt'), 'utf8').trim();

async function main(): Promise<void> {
  const ticketRef = db.collection(COLLECTIONS.supportTickets).doc(ticketId);
  const ticket = (await ticketRef.get()).data() as SupportTicket | undefined;
  if (!ticket) {
    console.log(`Ticket ${ticketId} introuvable : rien à nettoyer.`);
    return;
  }
  if (!ticket.subject.startsWith('Test')) throw new Error('Ce ticket ne provient pas du parcours de test : nettoyage refusé.');

  const refunds = await db.collection(COLLECTIONS.refunds).where('ticketId', '==', ticketId).get();
  const wallet = await db.collection(COLLECTIONS.walletTransactions).where('ticketId', '==', ticketId).get();
  const processed = refunds.docs.map((d) => ({ id: d.id, ...(d.data() as Refund) })).filter((r) => r.status === 'processed');
  const refundedCents = processed.reduce((s, r) => s + r.amountCents, 0);
  const creditCents = wallet.docs.reduce((s, d) => s + (d.data() as WalletTransaction).amountCents, 0);

  const batch = db.batch();
  for (const r of refunds.docs) {
    batch.delete(r.ref);
    const ledger = await db.collection(COLLECTIONS.ledgerEntries).where('refundId', '==', r.id).get();
    ledger.docs.forEach((d) => batch.delete(d.ref));
    batch.delete(db.collection(COLLECTIONS.invoices).doc(`av-${r.id}`));
  }
  for (const w of wallet.docs) {
    batch.delete(w.ref);
    batch.delete(db.collection(COLLECTIONS.ledgerEntries).doc(`wc-${w.id}`));
    batch.delete(db.collection(COLLECTIONS.ledgerEntries).doc(`wc-${w.id}-charge`));
  }
  if (creditCents) batch.update(db.collection(COLLECTIONS.users).doc(ticket.requesterId), { walletBalanceCents: FieldValue.increment(-creditCents) });

  if (ticket.orderId) {
    const orderRef = db.collection(COLLECTIONS.orders).doc(ticket.orderId);
    const order = (await orderRef.get()).data() as Order;
    const remaining = Math.max(0, order.amounts.refundedCents - refundedCents);
    batch.update(orderRef, { 'amounts.refundedCents': remaining, 'flags.refunded': remaining > 0, 'flags.disputed': false, ticketIds: FieldValue.arrayRemove(ticketId) });
    if (order.payment.paymentId) batch.set(db.collection(COLLECTIONS.payments).doc(order.payment.paymentId), { refundedCents: remaining, status: remaining > 0 ? 'partially_refunded' : 'paid' }, { merge: true });
    const events = await orderRef.collection(SUBCOLLECTIONS.orders.events).where('type', '==', 'refund_issued').get();
    events.docs.filter((e) => (e.get('data') as Record<string, unknown> | null)?.ticketId === ticketId).forEach((e) => batch.delete(e.ref));
    const finRef = db.collection(COLLECTIONS.orderFinancials).doc(ticket.orderId);
    const fin = await finRef.get();
    if (fin.exists) {
      const ids = new Set(processed.map((r) => r.id));
      const list = ((fin.get('refunds') as Array<{ refundId: string; platformCents: number }> | undefined) ?? []);
      const removed = list.filter((x) => ids.has(x.refundId));
      batch.update(finRef, {
        refunds: list.filter((x) => !ids.has(x.refundId)),
        finalMarginCents: FieldValue.increment(removed.reduce((s, x) => s + (x.platformCents ?? 0), 0)),
      });
    }
  }

  const messages = await ticketRef.collection(SUBCOLLECTIONS.supportTickets.messages).get();
  messages.docs.forEach((m) => batch.delete(m.ref));
  batch.delete(ticketRef);

  // Notifications envoyées pendant le test.
  for (const uid of new Set([ticket.requesterId, 'test-support', 'test-super-admin', 'test-finance'])) {
    const notes = await db.collection(COLLECTIONS.users).doc(uid).collection(SUBCOLLECTIONS.users.notifications).where('link.target', '==', ticketId).get();
    notes.docs.forEach((n) => batch.delete(n.ref));
  }
  await batch.commit();
  console.log(`Ticket ${ticket.number} supprimé : ${refunds.size} remboursement(s), ${wallet.size} avoir(s), ${(refundedCents / 100).toFixed(2)} € restitués à la commande.`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
