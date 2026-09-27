// Parrainages (cahier §19) : récompense du parrain et du filleul après la première
// commande livrée du client ; primes des restaurants (crédit publicitaire) et des
// livreurs qui en font inscrire d'autres. Montants et seuils : settings/referral.
import {
  COLLECTIONS,
  RESTAURANT_PRIVATE_DOCS,
  SUBCOLLECTIONS,
  formatPrice,
  type Driver,
  type DriverEarning,
  type LedgerEntry,
  type MessageTemplate,
  type Order,
  type Referral,
  type Restaurant,
  type WalletTransaction,
} from '@golink/shared';
import { logger } from 'firebase-functions/v2';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { db, FieldValue, Timestamp } from '../../lib/admin';
import { actorFromCaller, SYSTEM_ACTOR, writeAudit } from '../../lib/audit';
import { callable } from '../../lib/callable';
import { fail } from '../../lib/errors';
import { isFeatureOn } from '../../lib/features';
import { requireAdmin } from '../../lib/permissions';
import { z, zId, zReason } from '../../lib/validation';
import { fillVariables, loadReferralSettings, pushInApp } from './common';

function parisDay(date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

/** Texte du message automatique « parrainage récompensé » (modifiable dans le super admin). */
async function referralMessage(amountCents: number, role: 'referrer' | 'referee'): Promise<{ title: string; body: string } | null> {
  const snap = await db.collection(COLLECTIONS.messageTemplates).doc('referral_rewarded').get();
  const tpl = snap.data() as MessageTemplate | undefined;
  const values = { amount: formatPrice(amountCents), role: role === 'referrer' ? 'parrain' : 'filleul' };
  if (tpl && !tpl.active) return null;
  if (!tpl) {
    return { title: 'Parrainage récompensé', body: `${formatPrice(amountCents)} ont été ajoutés à votre solde GoLink. Merci !` };
  }
  return { title: fillVariables(tpl.title?.fr ?? 'Parrainage récompensé', values), body: fillVariables(tpl.body.fr, values) };
}

/** Crédite le porte-monnaie d'un client (transaction existante). */
function creditWallet(tx: FirebaseFirestore.Transaction, userId: string, current: number, amountCents: number, order: Order & { id: string }, note: string) {
  const now = Timestamp.now();
  const balanceAfter = current + amountCents;
  const entry: WalletTransaction = {
    userId,
    type: 'credit',
    amountCents,
    balanceAfterCents: balanceAfter,
    reason: 'referral',
    orderId: order.id,
    ticketId: null,
    refundId: null,
    expiresAt: null,
    note,
    createdAt: now,
    createdBy: 'system',
  };
  tx.set(db.collection(COLLECTIONS.walletTransactions).doc(), entry);
  tx.update(db.collection(COLLECTIONS.users).doc(userId), { walletBalanceCents: balanceAfter, updatedAt: now });
  const ledger: LedgerEntry = {
    accountType: 'customer_wallet',
    accountId: userId,
    type: 'wallet_credit',
    amountCents,
    currency: 'EUR',
    orderId: order.id,
    description: 'Avoir : parrainage',
    reason: note,
    bookingDate: parisDay(),
    countryId: order.countryId ?? 'FR',
    cityId: order.cityId ?? null,
    createdAt: now,
    createdBy: 'system',
  };
  tx.set(db.collection(COLLECTIONS.ledgerEntries).doc(), ledger);
}

async function rewardClient(orderId: string, raw: Order) {
  const order = { ...raw, id: orderId };
  const settings = (await loadReferralSettings()).client;
  if (!settings.enabled) return;
  const pending = await db
    .collection(COLLECTIONS.referrals)
    .where('refereeId', '==', order.customerId)
    .where('status', '==', 'pending')
    .limit(5)
    .get();
  const doc = pending.docs.find((d) => (d.data() as Referral).program === 'client');
  if (!doc) return;
  // Seule la vraie première commande qualifie : sous le minimum, le parrainage expire (une commande ultérieure ne rattrape pas).
  if (order.flags?.firstOrder !== true) return;
  if ((order.amounts?.subtotalCents ?? 0) < settings.minFirstOrderCents) {
    await doc.ref.update({ status: 'expired', rejectedAt: Timestamp.now(), rejectedReason: 'Première commande sous le minimum de parrainage' });
    return;
  }

  const referral = doc.data() as Referral;
  const referrerRef = db.collection(COLLECTIONS.users).doc(referral.referrerId);
  const refereeRef = db.collection(COLLECTIONS.users).doc(referral.refereeId);
  const rewarded = await db.runTransaction(async (tx) => {
    const [fresh, referrer, referee] = await Promise.all([tx.get(doc.ref), tx.get(referrerRef), tx.get(refereeRef)]);
    if ((fresh.data() as Referral | undefined)?.status !== 'pending') return false;
    const now = Timestamp.now();
    if (referrer.exists && settings.referrerRewardCents > 0) {
      creditWallet(tx, referrer.id, (referrer.get('walletBalanceCents') as number | undefined) ?? 0, settings.referrerRewardCents, order, `Parrainage de ${order.customerName}`);
    }
    if (referee.exists && settings.refereeRewardCents > 0) {
      creditWallet(tx, referee.id, (referee.get('walletBalanceCents') as number | undefined) ?? 0, settings.refereeRewardCents, order, 'Bienvenue : parrainage');
    }
    tx.update(doc.ref, {
      status: 'rewarded',
      qualifyingOrderId: orderId,
      qualifiedAt: now,
      rewardedAt: now,
      referrerRewardCents: settings.referrerRewardCents,
      refereeRewardCents: settings.refereeRewardCents,
    });
    return true;
  });
  if (!rewarded) return;
  const [a, b] = await Promise.all([referralMessage(settings.referrerRewardCents, 'referrer'), referralMessage(settings.refereeRewardCents, 'referee')]);
  if (a && settings.referrerRewardCents > 0) await pushInApp(referral.referrerId, { ...a, category: 'account', link: null });
  if (b && settings.refereeRewardCents > 0) await pushInApp(referral.refereeId, { ...b, category: 'account', link: null });
  await writeAudit({
    actor: SYSTEM_ACTOR,
    action: 'referral.rewarded',
    target: { type: 'client', id: referral.refereeId },
    after: { program: 'client', referrerRewardCents: settings.referrerRewardCents, refereeRewardCents: settings.refereeRewardCents, orderId },
    countryId: order.countryId,
    cityId: order.cityId,
  });
}

/**
 * Prime du commerce parrain. Déclenchée à la validation du commerce parrainé quand le nombre de
 * commandes exigé est 0, sinon quand le commerce parrainé atteint ce nombre de commandes livrées.
 */
async function rewardRestaurant(order: Pick<Order, 'restaurantId' | 'countryId' | 'cityId'>, trigger: 'order' | 'activation' = 'order') {
  const settings = (await loadReferralSettings()).restaurant;
  if (!settings.enabled) return;
  const pending = await db.collection(COLLECTIONS.referrals).where('refereeId', '==', order.restaurantId).where('status', '==', 'pending').limit(5).get();
  const doc = pending.docs.find((d) => (d.data() as Referral).program === 'restaurant');
  if (!doc) return;
  if (trigger === 'activation') {
    if (settings.qualifyingOrders > 0) return;
  } else {
    const delivered = await db.collection(COLLECTIONS.orders).where('restaurantId', '==', order.restaurantId).where('status', '==', 'delivered').count().get();
    if (delivered.data().count < Math.max(1, settings.qualifyingOrders)) return;
  }
  const referral = doc.data() as Referral;
  const commercialRef = db
    .collection(COLLECTIONS.restaurants)
    .doc(referral.referrerId)
    .collection(SUBCOLLECTIONS.restaurants.private)
    .doc(RESTAURANT_PRIVATE_DOCS.commercial);
  const adCredit = settings.rewardType !== 'cash';
  const done = await db.runTransaction(async (tx) => {
    const fresh = await tx.get(doc.ref);
    if ((fresh.data() as Referral | undefined)?.status !== 'pending') return false;
    const now = Timestamp.now();
    if (adCredit) {
      tx.set(commercialRef, { adCreditCents: FieldValue.increment(settings.rewardCents) }, { merge: true });
      tx.update(doc.ref, { status: 'rewarded', qualifiedAt: now, rewardedAt: now, referrerRewardCents: settings.rewardCents });
    } else {
      // Prime en argent : validée puis versée par l'équipe finance (decideReferral).
      tx.update(doc.ref, { status: 'qualified', qualifiedAt: now, referrerRewardCents: settings.rewardCents });
    }
    return true;
  });
  if (!done) return;
  const referrer = await db.collection(COLLECTIONS.restaurants).doc(referral.referrerId).get();
  const ownerId = referrer.get('ownerId') as string | undefined;
  if (ownerId && adCredit) {
    await pushInApp(ownerId, {
      title: 'Parrainage récompensé',
      body: `${formatPrice(settings.rewardCents)} de crédit publicitaire ont été ajoutés à votre compte : l’établissement que vous avez parrainé a reçu ses premières commandes.`,
      category: 'account',
      link: null,
    });
  }
  await writeAudit({
    actor: SYSTEM_ACTOR,
    action: adCredit ? 'referral.rewarded' : 'referral.qualified',
    target: { type: 'restaurant', id: referral.referrerId },
    after: { program: 'restaurant', refereeId: referral.refereeId, rewardCents: settings.rewardCents, rewardType: settings.rewardType ?? 'ad_credit' },
    countryId: order.countryId,
    cityId: order.cityId,
  });
}

async function rewardDriver(order: Order) {
  if (!order.driverId) return;
  const settings = (await loadReferralSettings()).driver;
  if (!settings.enabled) return;
  const pending = await db.collection(COLLECTIONS.referrals).where('refereeId', '==', order.driverId).where('status', '==', 'pending').limit(5).get();
  const doc = pending.docs.find((d) => (d.data() as Referral).program === 'driver');
  if (!doc) return;
  const driver = (await db.collection(COLLECTIONS.drivers).doc(order.driverId).get()).data() as Driver | undefined;
  if ((driver?.stats?.deliveries ?? 0) < settings.qualifyingDeliveries) return;
  const referral = doc.data() as Referral;
  const referrer = (await db.collection(COLLECTIONS.drivers).doc(referral.referrerId).get()).data() as Driver | undefined;
  const done = await db.runTransaction(async (tx) => {
    const fresh = await tx.get(doc.ref);
    if ((fresh.data() as Referral | undefined)?.status !== 'pending') return false;
    const now = Timestamp.now();
    const earning: DriverEarning = {
      driverId: referral.referrerId,
      cityId: referrer?.cityId ?? order.cityId,
      kind: 'referral',
      orderId: null,
      breakdown: null,
      amountCents: settings.rewardCents,
      tipCents: 0,
      payoutId: null,
      earnedAt: now,
      note: `Prime de parrainage : ${driver?.displayName ?? 'nouveau livreur'}`,
    };
    tx.set(db.collection(COLLECTIONS.driverEarnings).doc(`parrainage-${doc.id}`), earning);
    tx.update(doc.ref, { status: 'rewarded', qualifiedAt: now, rewardedAt: now, referrerRewardCents: settings.rewardCents });
    return true;
  });
  if (!done) return;
  await pushInApp(referral.referrerId, {
    title: 'Prime de parrainage',
    body: `${formatPrice(settings.rewardCents)} seront versés avec votre prochain paiement : votre filleul a atteint ${settings.qualifyingDeliveries} livraisons.`,
    category: 'payout',
    link: null,
  });
  await writeAudit({
    actor: SYSTEM_ACTOR,
    action: 'referral.rewarded',
    target: { type: 'driver', id: referral.referrerId },
    after: { program: 'driver', refereeId: referral.refereeId, rewardCents: settings.rewardCents },
    countryId: order.countryId,
    cityId: order.cityId,
  });
}

/** Commerce validé (passage en ligne) : prime du commerce parrain quand aucune commande n'est exigée. */
export const onRestaurantActivatedReferral = onDocumentWritten({ document: `${COLLECTIONS.restaurants}/{restaurantId}`, maxInstances: 2, cpu: 'gcf_gen1' }, async (event) => {
  const before = event.data?.before.data() as Restaurant | undefined;
  const after = event.data?.after.data() as Restaurant | undefined;
  if (!after || after.status !== 'active' || before?.status === 'active') return;
  try {
    await rewardRestaurant({ restaurantId: event.params.restaurantId, countryId: after.countryId, cityId: after.cityId }, 'activation');
  } catch (error) {
    logger.error('Parrainage du commerce non traité', { restaurantId: event.params.restaurantId, error: error instanceof Error ? error.stack : String(error) });
  }
});

/** Commande livrée : parrainages client (1re commande), restaurant et livreur. Rejouable sans doublon. */
export const onFirstOrderReferral = onDocumentWritten(`${COLLECTIONS.orders}/{orderId}`, async (event) => {
  const before = event.data?.before.data() as Order | undefined;
  const after = event.data?.after.data() as Order | undefined;
  if (!after || after.status !== 'delivered' || before?.status === 'delivered') return;
  // Interrupteur « Parrainage » (§24) : éteint, aucune prime n'est déclenchée.
  if (!(await isFeatureOn('referral', { restaurantId: after.restaurantId, cityId: after.cityId, countryId: after.countryId }))) return;
  const orderId = event.params.orderId;
  for (const [name, run] of [
    ['client', () => rewardClient(orderId, after)],
    ['restaurant', () => rewardRestaurant(after, 'order')],
    ['driver', () => rewardDriver(after)],
  ] as const) {
    try {
      await run();
    } catch (error) {
      logger.error('Parrainage non traité', { program: name, orderId, error: error instanceof Error ? error.stack : String(error) });
    }
  }
});

// ------------------------------------------------------------------ Décision manuelle

/** Refus (fraude, auto-parrainage) ou versement d'une prime validée en argent. */
export const decideReferral = callable(
  z.object({ referralId: zId, decision: z.enum(['reject', 'mark_paid']), reason: zReason }),
  async (data, request) => {
    const { caller } = await requireAdmin(request, 'loyalty.edit');
    const ref = db.collection(COLLECTIONS.referrals).doc(data.referralId);
    const before = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const r = snap.data() as Referral | undefined;
      if (!r) throw fail.notFound('Parrainage');
      const now = Timestamp.now();
      if (data.decision === 'reject') {
        if (!['pending', 'qualified'].includes(r.status)) throw fail.precondition('Ce parrainage est déjà récompensé ou clos.');
        tx.update(ref, { status: 'rejected', rejectedAt: now, rejectedReason: data.reason });
      } else {
        if (r.status !== 'qualified') throw fail.precondition('Seule une prime validée peut être marquée comme versée.');
        tx.update(ref, { status: 'rewarded', rewardedAt: now });
      }
      return r;
    });
    await writeAudit({
      actor: actorFromCaller(caller, 'admin'),
      action: data.decision === 'reject' ? 'referral.rejected' : 'referral.rewarded',
      target: { type: before.referrerType === 'client' ? 'client' : before.referrerType, id: before.referrerId },
      reason: data.reason,
      before: { status: before.status },
      after: { status: data.decision === 'reject' ? 'rejected' : 'rewarded', program: before.program, refereeId: before.refereeId },
      request,
    });
    return { referralId: ref.id };
  },
);
