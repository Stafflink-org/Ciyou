// Gestes depuis un ticket : remboursement (plafond selon l'agent, validation d'un
// responsable au-delà), validation ou refus d'un remboursement en attente, avoir
// sur le compte du client. Décision client : les remboursements sont imputés au
// commerce (règle `refundLiability`, paramétrable), déduits de son reversement.
import {
  COLLECTIONS,
  REFUND_CAUSES,
  SETTINGS_DOCS,
  allocateRefund,
  type AdminUser,
  type LedgerEntry,
  type Order,
  type Refund,
  type RefundCause,
  type RefundSettings,
  type SupportTicket,
  type UserProfile as User,
  type WalletTransaction,
} from '@golink/shared';
import { logger } from 'firebase-functions/v2';
import { db, FieldValue, Timestamp } from '../../lib/admin';
import { actorFromCaller, writeAudit } from '../../lib/audit';
import { fail } from '../../lib/errors';
import { loadAdmin, requireAdmin } from '../../lib/permissions';
import { getStripe } from '../../lib/stripe';
import { z, zId, zReason } from '../../lib/validation';
import { addEvent, loadMarket, loadOrderRules, type EventActor } from '../../orders/context';
import {
  addTicketMessage,
  agentPublicName,
  euros,
  experienceCallable,
  loadTicketFor,
  maxCreditOf,
  notify,
  parisDay,
  preview,
  refundLimitOf,
  systemMessage,
  ticketRef,
} from './common';

const CAUSE_LABELS: Record<RefundCause, string> = {
  restaurant_error: 'Erreur du restaurant',
  restaurant_cancelled: 'Annulation par le restaurant',
  restaurant_timeout: 'Commande non acceptée à temps',
  item_unavailable: 'Article indisponible',
  missing_item: 'Article manquant',
  food_quality: 'Qualité du repas',
  delivery_late: 'Retard de livraison',
  delivery_issue: 'Problème de livraison',
  courier_error: 'Erreur du livreur',
  customer_absent: 'Client absent',
  customer_cancelled: 'Annulation par le client',
  commercial_gesture: 'Geste commercial',
  platform_error: 'Erreur de la plateforme',
  payment_issue: 'Problème de paiement',
  weight_adjustment: 'Ajustement poids/prix variable',
};

function adminActor(admin: AdminUser, uid: string): EventActor {
  return { type: 'admin', uid, name: admin.displayName };
}

/** Montant encore remboursable : encaissé - déjà remboursé - remboursements en attente. */
async function refundableCents(orderId: string, order: Order): Promise<number> {
  const pending = await db.collection(COLLECTIONS.refunds).where('orderId', '==', orderId).where('status', 'in', ['pending_approval', 'approved']).get();
  const reserved = pending.docs.reduce((sum, d) => sum + ((d.get('amountCents') as number) ?? 0), 0);
  return Math.max(0, order.amounts.chargedCents - order.amounts.refundedCents - reserved);
}

/**
 * Exécute un remboursement approuvé : Stripe (remboursement partiel ou total de
 * l'intention de paiement), puis mise à jour de la commande et du paiement.
 * Commandes sans paiement Stripe (données de démonstration) : remboursement
 * enregistré sans appel au prestataire.
 */
async function executeRefund(refundId: string, refund: Refund, actor: EventActor): Promise<'processed' | 'failed'> {
  const orderRef = db.collection(COLLECTIONS.orders).doc(refund.orderId);
  const order = (await orderRef.get()).data() as Order | undefined;
  if (!order) throw fail.notFound('Commande');
  let providerRefundId: string | null = null;
  const paymentId = order.payment.paymentId ?? null;
  const payment = paymentId ? await db.collection(COLLECTIONS.payments).doc(paymentId).get() : null;
  const intentId = (payment?.get('providerIntentId') as string | null | undefined) ?? null;
  // Paiements de démonstration (jeu d'essai) : aucune intention Stripe réelle à rembourser.
  const simulated = !intentId || intentId.startsWith('pi_seed') || payment?.get('seed') === true;
  if (intentId && !simulated) {
    try {
      const stripeRefund = await getStripe().refunds.create(
        { payment_intent: intentId, amount: refund.amountCents, metadata: { orderId: refund.orderId, refundId, ticketId: refund.ticketId ?? '', platform: 'golink' } },
        { idempotencyKey: `ticket-refund-${refundId}` },
      );
      providerRefundId = stripeRefund.id;
    } catch (error) {
      logger.error('Remboursement Stripe depuis un ticket en échec', { refundId, error: error instanceof Error ? error.message : String(error) });
      await db.collection(COLLECTIONS.refunds).doc(refundId).update({ status: 'failed', processedAt: Timestamp.now() });
      return 'failed';
    }
  }
  const at = Timestamp.now();
  await db.runTransaction(async (tx) => {
    const fresh = (await tx.get(orderRef)).data() as Order;
    const refunded = fresh.amounts.refundedCents + refund.amountCents;
    tx.update(orderRef, { 'amounts.refundedCents': refunded, 'flags.refunded': true, updatedAt: at });
    addEvent(tx, refund.orderId, actor, {
      type: 'refund_issued',
      from: null,
      to: null,
      visibleToCustomer: true,
      message: `Remboursement de ${euros(refund.amountCents)} sur le moyen de paiement d’origine.`,
      data: { refundCents: refund.amountCents, restaurantCents: refund.allocation.restaurantCents, platformCents: refund.allocation.platformCents, ticketId: refund.ticketId ?? null },
    }, at);
    tx.update(db.collection(COLLECTIONS.refunds).doc(refundId), { status: 'processed', providerRefundId, processedAt: at });
    if (paymentId) {
      tx.set(db.collection(COLLECTIONS.payments).doc(paymentId), {
        refundedCents: refunded,
        status: refunded >= fresh.amounts.chargedCents ? 'refunded' : 'partially_refunded',
        updatedAt: at,
      }, { merge: true });
    }
  });
  return 'processed';
}

// ------------------------------------------------------------------ Remboursement

export const refundFromTicket = experienceCallable(
  z.object({
    ticketId: zId,
    amountCents: z.number().int().min(50, 'Montant minimum : 0,50 €.').max(1_000_000),
    cause: z.enum(REFUND_CAUSES as [RefundCause, ...RefundCause[]]),
    reason: zReason,
  }),
  async (data, request) => {
    const { caller, admin } = await requireAdmin(request, 'refunds.create');
    const ticket = await loadTicketFor(admin, data.ticketId);
    if (!ticket.orderId) throw fail.precondition('Ce ticket n’est lié à aucune commande : proposez plutôt un avoir.');
    if (ticket.pendingRefundId) throw fail.precondition('Un remboursement attend déjà la validation d’un responsable.');
    const orderId = ticket.orderId;
    const order = (await db.collection(COLLECTIONS.orders).doc(orderId).get()).data() as Order | undefined;
    if (!order) throw fail.notFound('Commande');
    if (order.payment.method === 'cash') throw fail.precondition('Commande réglée en espèces : aucun remboursement en ligne possible, proposez un avoir.');
    const refundable = await refundableCents(orderId, order);
    if (data.amountCents > refundable) throw fail.invalid(`Montant trop élevé : ${euros(refundable)} remboursables au maximum sur cette commande.`);

    const rules = await loadOrderRules(await loadMarket(order.countryId, order.cityId));
    const allocation = allocateRefund(data.amountCents, data.cause, rules.refundLiability);
    const limit = await refundLimitOf(admin);
    const needsApproval = data.amountCents > limit;
    const refundRef = db.collection(COLLECTIONS.refunds).doc();
    const at = Timestamp.now();
    const refund: Refund = {
      orderId,
      orderNumber: order.number,
      countryId: order.countryId,
      cityId: order.cityId,
      customerId: order.customerId,
      restaurantId: order.restaurantId,
      driverId: order.driverId ?? null,
      ticketId: data.ticketId,
      amountCents: data.amountCents,
      method: 'original_payment',
      cause: data.cause,
      allocation,
      items: null,
      status: needsApproval ? 'pending_approval' : 'approved',
      automatic: false,
      reason: data.reason,
      requestedBy: caller.uid,
      requestedAt: at,
      approvedBy: needsApproval ? null : caller.uid,
      approvedAt: needsApproval ? null : at,
      rejectionReason: null,
      providerRefundId: null,
      creditNoteId: null,
      processedAt: null,
    };
    const test = (order as Order & { test?: boolean }).test === true;
    await db.runTransaction(async (tx) => {
      tx.create(refundRef, { ...refund, ...(test ? { test: true } : {}) });
      tx.update(ticketRef(data.ticketId), {
        ...(needsApproval ? { pendingRefundId: refundRef.id } : { refundIds: FieldValue.arrayUnion(refundRef.id), compensationCents: FieldValue.increment(data.amountCents) }),
        updatedAt: at,
        updatedBy: caller.uid,
      });
      addTicketMessage(
        tx,
        data.ticketId,
        systemMessage(
          admin,
          caller.uid,
          needsApproval
            ? `Remboursement de ${euros(data.amountCents)} demandé (${CAUSE_LABELS[data.cause]}) : au-delà du plafond de ${euros(limit)}, validation d’un responsable requise. Motif : ${data.reason}`
            : `Remboursement de ${euros(data.amountCents)} (${CAUSE_LABELS[data.cause]}) : ${data.reason}. Imputation : commerce ${euros(allocation.restaurantCents)}, Ciyou Eats ${euros(allocation.platformCents)}${allocation.courierCents ? `, livreur ${euros(allocation.courierCents)}` : ''}.`,
          { type: 'refund', detail: `${euros(data.amountCents)}${needsApproval ? ' (en attente)' : ''}` },
        ),
        at,
      );
    });

    let status: 'processed' | 'pending_approval' | 'failed' = 'pending_approval';
    if (!needsApproval) {
      status = await executeRefund(refundRef.id, refund, adminActor(admin, caller.uid));
      await announceRefund(ticket, data.ticketId, admin, caller.uid, data.amountCents, status);
    }
    await writeAudit({
      actor: actorFromCaller(caller, 'admin'),
      action: needsApproval ? 'refund.requested' : 'refund.created',
      target: { type: 'refund', id: refundRef.id, label: `${order.number} · ${euros(data.amountCents)}` },
      reason: data.reason,
      after: { amountCents: data.amountCents, cause: data.cause, ticketId: data.ticketId, status, allocation },
      countryId: order.countryId,
      cityId: order.cityId,
      sensitive: true,
      request,
    });
    return { refundId: refundRef.id, status };
  },
);

async function announceRefund(ticket: SupportTicket, ticketId: string, admin: AdminUser, uid: string, amountCents: number, status: 'processed' | 'failed'): Promise<void> {
  const at = Timestamp.now();
  if (status === 'failed') {
    await db.runTransaction(async (tx) => {
      addTicketMessage(tx, ticketId, systemMessage(admin, uid, `Le prestataire de paiement a refusé le remboursement de ${euros(amountCents)} : à reprendre depuis la rubrique Paiements.`, { type: 'refund', detail: 'échec' }), at);
    });
    return;
  }
  const body = `Nous avons procédé au remboursement de ${euros(amountCents)} sur votre moyen de paiement d’origine. Il apparaîtra sous 5 à 10 jours ouvrés selon votre banque.`;
  await db.runTransaction(async (tx) => {
    addTicketMessage(tx, ticketId, { authorType: 'agent', authorId: uid, authorName: agentPublicName(admin), body, internal: false, attachments: [], action: { type: 'refund', detail: euros(amountCents) } }, at);
    tx.update(ticketRef(ticketId), { lastMessageAt: at, lastMessagePreview: preview(body), unreadByRequester: FieldValue.increment(1), ...(ticket.firstResponseAt ? {} : { firstResponseAt: at }) });
  });
  if (ticket.requesterType === 'client') {
    await notify(ticket.requesterId, { title: 'Remboursement effectué', body, category: 'support', link: { type: 'ticket', target: ticketId } });
  }
}

// ------------------------------------------------------------------ Validation d'un responsable

export const reviewTicketRefund = experienceCallable(
  z.object({ refundId: zId, decision: z.enum(['approve', 'reject']), reason: zReason }),
  async (data, request) => {
    const { caller, admin } = await requireAdmin(request, 'refunds.approve');
    const ref = db.collection(COLLECTIONS.refunds).doc(data.refundId);
    const refund = (await ref.get()).data() as Refund | undefined;
    if (!refund) throw fail.notFound('Remboursement');
    if (refund.status !== 'pending_approval') throw fail.precondition('Ce remboursement a déjà été traité.');
    if (!refund.ticketId) throw fail.precondition('Ce remboursement ne provient pas d’un ticket : traitez-le depuis la rubrique Paiements.');
    const ticket = await loadTicketFor(admin, refund.ticketId);
    if (refund.requestedBy === caller.uid && admin.role !== 'super_admin') {
      throw fail.forbidden('Un remboursement doit être validé par une autre personne que celle qui l’a demandé.');
    }
    if (data.decision === 'approve' && refund.amountCents > (await refundLimitOf(admin))) {
      throw fail.forbidden('Ce montant dépasse votre propre plafond de validation.');
    }
    const at = Timestamp.now();
    const requester = await loadAdmin(refund.requestedBy);
    const ticketId = refund.ticketId;

    if (data.decision === 'reject') {
      await db.runTransaction(async (tx) => {
        tx.update(ref, { status: 'rejected', rejectionReason: data.reason, approvedBy: caller.uid, approvedAt: at });
        tx.update(ticketRef(ticketId), { pendingRefundId: null, updatedAt: at, updatedBy: caller.uid });
        addTicketMessage(tx, ticketId, systemMessage(admin, caller.uid, `Remboursement de ${euros(refund.amountCents)} refusé par ${admin.displayName} : ${data.reason}`, { type: 'refund', detail: 'refusé' }), at);
      });
    } else {
      await db.runTransaction(async (tx) => {
        tx.update(ref, { status: 'approved', approvedBy: caller.uid, approvedAt: at });
        tx.update(ticketRef(ticketId), {
          pendingRefundId: null,
          refundIds: FieldValue.arrayUnion(data.refundId),
          compensationCents: FieldValue.increment(refund.amountCents),
          updatedAt: at,
          updatedBy: caller.uid,
        });
        addTicketMessage(tx, ticketId, systemMessage(admin, caller.uid, `Remboursement de ${euros(refund.amountCents)} validé par ${admin.displayName} : ${data.reason}`, { type: 'refund', detail: 'validé' }), at);
      });
      const status = await executeRefund(data.refundId, { ...refund, status: 'approved' }, adminActor(admin, caller.uid));
      await announceRefund(ticket, ticketId, requester ?? admin, requester ? refund.requestedBy : caller.uid, refund.amountCents, status);
    }
    await writeAudit({
      actor: actorFromCaller(caller, 'admin'),
      action: data.decision === 'approve' ? 'refund.approved' : 'refund.rejected',
      target: { type: 'refund', id: data.refundId, label: `${refund.orderNumber} · ${euros(refund.amountCents)}` },
      reason: data.reason,
      before: { status: 'pending_approval' },
      after: { status: data.decision === 'approve' ? 'approved' : 'rejected' },
      countryId: refund.countryId,
      cityId: refund.cityId ?? null,
      sensitive: true,
      request,
    });
    if (requester && refund.requestedBy !== caller.uid) {
      await notify(refund.requestedBy, {
        title: data.decision === 'approve' ? 'Remboursement validé' : 'Remboursement refusé',
        body: `${ticket.number} · ${euros(refund.amountCents)} — ${data.reason}`,
        category: 'support',
        link: { type: 'ticket', target: ticketId },
      });
    }
    return { status: data.decision === 'approve' ? 'approved' : 'rejected' };
  },
);

// ------------------------------------------------------------------ Avoir

export const creditFromTicket = experienceCallable(
  z.object({
    ticketId: zId,
    amountCents: z.number().int().min(50, 'Montant minimum : 0,50 €.').max(10_000_000),
    reason: zReason,
    chargedTo: z.enum(['restaurant', 'platform']).default('restaurant'),
    validityDays: z.number().int().min(1).max(730).nullable().default(null),
  }),
  async (data, request) => {
    const { caller, admin } = await requireAdmin(request, 'customers.credit');
    const ticket = await loadTicketFor(admin, data.ticketId);
    if (ticket.requesterType !== 'client') throw fail.precondition('Un avoir ne peut être accordé qu’à un client.');
    if (data.chargedTo === 'restaurant' && !ticket.restaurantId) throw fail.invalid('Aucun commerce n’est lié à ce ticket : imputez l’avoir à Ciyou Eats.');
    const limit = await refundLimitOf(admin);
    const maxCredit = await maxCreditOf();
    if (data.amountCents > maxCredit) throw fail.invalid(`Un avoir est limité à ${euros(maxCredit)}.`);
    // Pas d'auto-validation : la permission de valider les remboursements ne lève pas le plafond.
    if (data.amountCents > limit) {
      throw fail.forbidden(`Au-delà de votre plafond (${euros(limit)}) : escaladez le ticket à un responsable dont le plafond est suffisant.`);
    }
    const refundSettings = (await db.collection(COLLECTIONS.settings).doc(SETTINGS_DOCS.refunds).get()).data() as RefundSettings | undefined;
    const validityDays = data.validityDays ?? refundSettings?.walletCreditValidityDays ?? 180;
    const userRef = db.collection(COLLECTIONS.users).doc(ticket.requesterId);
    const txRef = db.collection(COLLECTIONS.walletTransactions).doc();
    const at = Timestamp.now();
    const expiresAt = Timestamp.fromMillis(at.toMillis() + validityDays * 86_400_000);
    const body = `Un avoir de ${euros(data.amountCents)} a été ajouté à votre compte Ciyou Eats, valable jusqu’au ${expiresAt.toDate().toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris' })}. Il sera déduit automatiquement de votre prochaine commande.`;

    const balance = await db.runTransaction(async (tx) => {
      const user = (await tx.get(userRef)).data() as User | undefined;
      if (!user) throw fail.notFound('Client');
      const next = (user.walletBalanceCents ?? 0) + data.amountCents;
      const wallet: WalletTransaction = {
        userId: ticket.requesterId,
        type: 'credit',
        amountCents: data.amountCents,
        balanceAfterCents: next,
        reason: 'commercial_gesture',
        orderId: ticket.orderId ?? null,
        ticketId: data.ticketId,
        refundId: null,
        expiresAt,
        note: data.reason,
        createdAt: at,
        createdBy: caller.uid,
      };
      tx.update(userRef, { walletBalanceCents: next, updatedAt: at });
      tx.create(txRef, wallet);
      const base = {
        currency: 'EUR' as const,
        bookingDate: parisDay(at.toDate()),
        countryId: ticket.countryId,
        cityId: ticket.cityId ?? null,
        orderId: ticket.orderId ?? null,
        refundId: null,
        payoutId: null,
        vatCents: null,
        createdAt: at,
        createdBy: caller.uid,
        reason: data.reason,
      };
      const walletEntry: LedgerEntry = { ...base, accountType: 'customer_wallet', accountId: ticket.requesterId, type: 'wallet_credit', amountCents: data.amountCents, description: `Avoir ticket ${ticket.number}` };
      const chargeEntry: LedgerEntry = data.chargedTo === 'restaurant'
        ? { ...base, accountType: 'restaurant', accountId: ticket.restaurantId!, type: 'refund_charge', amountCents: -data.amountCents, description: `Avoir client imputé · ticket ${ticket.number}` }
        : { ...base, accountType: 'platform', accountId: 'golink', type: 'wallet_credit', amountCents: -data.amountCents, description: `Geste commercial · ticket ${ticket.number}` };
      tx.create(db.collection(COLLECTIONS.ledgerEntries).doc(`wc-${txRef.id}`), walletEntry);
      tx.create(db.collection(COLLECTIONS.ledgerEntries).doc(`wc-${txRef.id}-charge`), chargeEntry);
      tx.update(ticketRef(data.ticketId), {
        creditedCents: FieldValue.increment(data.amountCents),
        compensationCents: FieldValue.increment(data.amountCents),
        lastMessageAt: at,
        lastMessagePreview: preview(body),
        unreadByRequester: FieldValue.increment(1),
        ...(ticket.firstResponseAt ? {} : { firstResponseAt: at }),
        updatedAt: at,
        updatedBy: caller.uid,
      });
      addTicketMessage(tx, data.ticketId, systemMessage(admin, caller.uid, `Avoir de ${euros(data.amountCents)} accordé (${data.chargedTo === 'restaurant' ? 'imputé au commerce' : 'geste commercial Ciyou Eats'}), valable ${validityDays} jours : ${data.reason}`, { type: 'credit', detail: euros(data.amountCents) }), at);
      addTicketMessage(tx, data.ticketId, { authorType: 'agent', authorId: caller.uid, authorName: agentPublicName(admin), body, internal: false, attachments: [], action: { type: 'credit', detail: euros(data.amountCents) } }, at);
      return next;
    });
    await notify(ticket.requesterId, { title: 'Avoir ajouté à votre compte', body, category: 'support', link: { type: 'ticket', target: data.ticketId } });
    await writeAudit({
      actor: actorFromCaller(caller, 'admin'),
      action: 'wallet.credited',
      target: { type: 'client', id: ticket.requesterId, label: ticket.requesterName },
      reason: data.reason,
      after: { amountCents: data.amountCents, ticketId: data.ticketId, chargedTo: data.chargedTo, validityDays, balanceAfterCents: balance },
      countryId: ticket.countryId,
      cityId: ticket.cityId ?? null,
      sensitive: true,
      request,
    });
    return { walletTransactionId: txRef.id, balanceCents: balance };
  },
);

// ------------------------------------------------------------------ Politique de plafond (lecture)

/** Plafonds applicables à l'administrateur connecté, pour les écrans (remboursement, avoir). */
export const getRefundPolicy = experienceCallable(z.object({}).optional(), async (_data, request) => {
  const { admin } = await requireAdmin(request);
  const limit = await refundLimitOf(admin);
  const settings = (await db.collection(COLLECTIONS.settings).doc(SETTINGS_DOCS.refunds).get()).data() as RefundSettings | undefined;
  return {
    limitCents: limit >= Number.MAX_SAFE_INTEGER ? null : limit,
    approvalThresholdCents: settings?.approvalThresholdCents ?? 0,
    maxCreditCents: await maxCreditOf(),
    walletCreditValidityDays: settings?.walletCreditValidityDays ?? 180,
  };
});
