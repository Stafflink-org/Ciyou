// Évènements Stripe du domaine financier : remboursements, litiges, virements
// Connect annulés et virements bancaires en échec des comptes connectés.
import { COLLECTIONS, RESTAURANT_PRIVATE_DOCS, SUBCOLLECTIONS, type LedgerEntry, type Payment, type Payout } from '@golink/shared';
import { logger } from 'firebase-functions/v2';
import type Stripe from 'stripe';
import { db, Timestamp } from '../lib/admin';
import { SYSTEM_ACTOR, writeAudit } from '../lib/audit';
import { raiseAlert } from '../finance/argent/alerts';
import { euros, parisDay } from '../finance/argent/common';

async function paymentForCharge(charge: Stripe.Charge) {
  const byCharge = await db.collection(COLLECTIONS.payments).where('providerChargeId', '==', charge.id).limit(1).get();
  if (byCharge.docs[0]) return byCharge.docs[0];
  const intentId = typeof charge.payment_intent === 'string' ? charge.payment_intent : charge.payment_intent?.id;
  if (!intentId) return null;
  const byIntent = await db.collection(COLLECTIONS.payments).where('providerIntentId', '==', intentId).limit(1).get();
  return byIntent.docs[0] ?? null;
}

async function onChargeRefunded(charge: Stripe.Charge): Promise<void> {
  const doc = await paymentForCharge(charge);
  if (!doc) return;
  const payment = doc.data() as Payment;
  const refunded = charge.amount_refunded;
  await doc.ref.update({
    refundedCents: refunded,
    status: refunded >= payment.amountCents ? 'refunded' : 'partially_refunded',
    providerChargeId: charge.id,
    updatedAt: Timestamp.now(),
  });
  // Remboursements Ciyou Eats confirmés par Stripe.
  for (const refund of charge.refunds?.data ?? []) {
    const snap = await db.collection(COLLECTIONS.refunds).where('providerRefundId', '==', refund.id).limit(1).get();
    const r = snap.docs[0];
    if (r && refund.status === 'succeeded' && r.get('status') !== 'processed') await r.ref.update({ status: 'processed', processedAt: Timestamp.now() });
    if (r && refund.status === 'failed') await r.ref.update({ status: 'failed' });
  }
}

async function onDisputeCreated(dispute: Stripe.Dispute): Promise<void> {
  const chargeId = typeof dispute.charge === 'string' ? dispute.charge : dispute.charge.id;
  const snap = await db.collection(COLLECTIONS.payments).where('providerChargeId', '==', chargeId).limit(1).get();
  const doc = snap.docs[0];
  const payment = doc?.data() as Payment | undefined;
  if (payment?.orderId) await db.collection(COLLECTIONS.orders).doc(payment.orderId).set({ flags: { disputed: true } }, { merge: true });
  await raiseAlert({
    kind: 'fraud_signal',
    severity: 'warning',
    title: 'Contestation de paiement ouverte',
    message: `${euros(dispute.amount)} contestés (${dispute.reason}).${payment?.orderId ? ` Commande ${payment.orderId}.` : ''}`,
    target: payment?.orderId ? { type: 'order', id: payment.orderId } : { type: 'other', id: dispute.id },
    countryId: payment?.countryId ?? null,
    cityId: payment?.cityId ?? null,
    metric: null,
    dedupKey: `dispute:${dispute.id}`,
  });
}

async function onTransferReversed(transfer: Stripe.Transfer): Promise<void> {
  const payoutId = transfer.metadata?.payoutId ?? (typeof transfer.transfer_group === 'string' ? transfer.transfer_group : null);
  if (!payoutId) return;
  const ref = db.collection(COLLECTIONS.payouts).doc(payoutId);
  const snap = await ref.get();
  if (!snap.exists) return;
  const payout = snap.data() as Payout;
  const reversed = transfer.amount_reversed;
  if (reversed <= 0) return;
  const now = Timestamp.now();
  const entry: LedgerEntry = {
    countryId: payout.countryId,
    cityId: payout.cityId ?? null,
    accountType: payout.beneficiaryType === 'restaurant' ? 'restaurant' : 'driver',
    accountId: payout.beneficiaryId,
    type: 'payout_reversal',
    amountCents: reversed,
    currency: 'EUR',
    vatCents: null,
    payoutId: null,
    description: `Virement annulé (${payoutId})`,
    bookingDate: parisDay(now.toDate()),
    createdAt: now,
    createdBy: 'system',
  };
  await db.collection(COLLECTIONS.ledgerEntries).doc(`${payoutId}-annul`).set(entry);
  await ref.update({ status: 'failed', failureReason: 'Virement annulé chez Stripe : le montant sera repris au prochain reversement.', updatedAt: now });
  await writeAudit({ actor: SYSTEM_ACTOR, action: 'payout.reversed', target: { type: 'payout', id: payoutId, label: payout.beneficiaryName }, after: { reversedCents: reversed }, countryId: payout.countryId, cityId: payout.cityId ?? null, sensitive: true });
}

/** Virement du compte connecté vers la banque du commerce refusé. */
async function onConnectedPayoutFailed(payout: Stripe.Payout, accountId: string | undefined): Promise<void> {
  if (!accountId) return;
  const snap = await db.collectionGroup(SUBCOLLECTIONS.restaurants.private).where('stripeAccountId', '==', accountId).limit(1).get();
  const doc = snap.docs.find((d) => d.id === RESTAURANT_PRIVATE_DOCS.commercial);
  const restaurantId = doc?.ref.parent.parent?.id;
  await raiseAlert({
    kind: 'payout_failed',
    severity: 'warning',
    title: 'Virement bancaire refusé',
    message: `${euros(payout.amount)} n’ont pas pu être virés sur le compte bancaire du bénéficiaire (${payout.failure_message ?? payout.failure_code ?? 'motif inconnu'}).`,
    target: restaurantId ? { type: 'restaurant', id: restaurantId } : { type: 'other', id: accountId },
    countryId: null,
    cityId: null,
    metric: null,
    dedupKey: `connect_payout_failed:${payout.id}`,
  });
}

/** Traite un évènement du domaine financier ; renvoie false s'il n'est pas géré ici. */
export async function handleFinanceEvent(event: Stripe.Event): Promise<boolean> {
  switch (event.type) {
    case 'charge.refunded':
      await onChargeRefunded(event.data.object);
      return true;
    case 'charge.dispute.created':
      await onDisputeCreated(event.data.object);
      return true;
    case 'transfer.reversed':
      await onTransferReversed(event.data.object);
      return true;
    case 'payout.failed':
      await onConnectedPayoutFailed(event.data.object, event.account);
      return true;
    default:
      logger.debug('Évènement financier non géré', { type: event.type });
      return false;
  }
}
