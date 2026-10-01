// Comptes clients (cahier §7) : avoirs crédités par l'équipe, blocage motivé et
// suppression du compte conforme au RGPD (anonymisation, données légales conservées).
import {
  ACTIVE_ORDER_STATUSES,
  COLLECTIONS,
  CUSTOMER_CREDIT_REASON_LABELS,
  CUSTOMER_RETAINED_DATA,
  formatPrice,
  type GdprRequest,
  type LedgerEntry,
  type Order,
  type UserProfile,
  type WalletTransaction,
} from '@golink/shared';
import { createHash } from 'node:crypto';
import { logger } from 'firebase-functions/v2';
import { auth, db, Timestamp } from '../../lib/admin';
import { writeAudit } from '../../lib/audit';
import { fail, isAuthError } from '../../lib/errors';
import { assertAdminCovers, requireAdmin } from '../../lib/permissions';
import { z, zId, zReason } from '../../lib/validation';
import { maxCreditOf, refundLimitOf } from '../experience/common';
import { acteursCallable, adminActor, parisDay } from './common';


async function loadCustomer(userId: string): Promise<{ ref: FirebaseFirestore.DocumentReference; data: UserProfile }> {
  const ref = db.collection(COLLECTIONS.users).doc(userId);
  const snap = await ref.get();
  if (!snap.exists) throw fail.notFound('Client');
  const data = snap.data() as UserProfile;
  if (data.role !== 'client') throw fail.precondition('Ce compte n’est pas un compte client.');
  if (data.status === 'deleted') throw fail.precondition('Ce compte a été supprimé.');
  return { ref, data };
}

function customerTarget(userId: string, user: UserProfile) {
  return { type: 'client' as const, id: userId, label: user.displayName };
}

/**
 * Anonymise le nom et l'adresse du client dans les enregistrements CONSERVÉS pour
 * obligation légale (commandes, avis, tickets) : les montants, dates et identifiants
 * restent intacts (comptabilité), seules les données personnelles disparaissent.
 * Limité aux 1000 documents les plus récents par collection (volume raisonnable pour
 * un client ; un très gros volume résiduel serait traité par une reprise manuelle).
 */
async function anonymizeCustomerRecords(userId: string): Promise<{ orders: number; reviews: number; tickets: number }> {
  const anonName = 'Client supprimé';
  const [orders, reviews, tickets] = await Promise.all([
    db.collection(COLLECTIONS.orders).where('customerId', '==', userId).limit(1000).get(),
    db.collection(COLLECTIONS.reviews).where('customerId', '==', userId).limit(1000).get(),
    db.collection(COLLECTIONS.supportTickets).where('requesterId', '==', userId).limit(1000).get(),
  ]);
  let batch = db.batch();
  let pending = 0;
  const flush = async () => {
    if (pending) await batch.commit();
    batch = db.batch();
    pending = 0;
  };
  for (const doc of orders.docs) {
    const data = doc.data() as Order;
    batch.update(doc.ref, {
      customerName: anonName,
      customerPhoneMasked: null,
      ...(data.delivery
        ? {
            'delivery.address.line1': 'Adresse supprimée',
            'delivery.address.line2': null,
            'delivery.address.details': null,
            'delivery.address.instructions': null,
          }
        : {}),
    });
    pending += 1;
    if (pending >= 400) await flush();
  }
  for (const doc of reviews.docs) {
    batch.update(doc.ref, { customerDisplayName: anonName });
    pending += 1;
    if (pending >= 400) await flush();
  }
  for (const doc of tickets.docs) {
    batch.update(doc.ref, { requesterName: anonName });
    pending += 1;
    if (pending >= 400) await flush();
  }
  await flush();
  return { orders: orders.size, reviews: reviews.size, tickets: tickets.size };
}

// ------------------------------------------------------------------ Avoirs

const creditSchema = z.object({
  userId: zId,
  amountCents: z.number().int().min(50, 'Montant minimal : 0,50 €').max(10_000_000),
  reason: z.enum(['commercial_gesture', 'late_delivery', 'refund', 'adjustment']),
  note: z.string().trim().min(3, 'Précisez le contexte').max(500),
  orderId: zId.nullish(),
  validityDays: z.number().int().min(7).max(730).nullish(),
});

export const creditCustomer = acteursCallable(creditSchema, async (data, request) => {
  const { caller, admin } = await requireAdmin(request, 'customers.credit');
  // Plafond unique (plafond de l'agent, du rôle, seuil de la plateforme) : voir refundLimitOf.
  const limit = await refundLimitOf(admin);
  const maxCredit = await maxCreditOf();
  if (data.amountCents > maxCredit) throw fail.invalid(`Un avoir est limité à ${formatPrice(maxCredit)}.`);
  if (data.amountCents > limit) {
    throw fail.forbidden(`Au-delà de votre plafond (${formatPrice(limit)}), l’avoir doit être accordé par un responsable dont le plafond est suffisant.`);
  }
  const customer = await loadCustomer(data.userId);
  assertAdminCovers(admin, customer.data.cityId ?? null);

  let order: (Order & { id: string }) | null = null;
  if (data.orderId) {
    const o = await db.collection(COLLECTIONS.orders).doc(data.orderId).get();
    if (!o.exists) throw fail.notFound('Commande');
    order = { id: o.id, ...(o.data() as Order) };
    if (order.customerId !== data.userId) throw fail.invalid('Cette commande n’appartient pas à ce client.');
  }
  // Décision client : les remboursements liés à une commande sont imputés au commerce.
  const chargeRestaurant = Boolean(order && (data.reason === 'refund' || data.reason === 'late_delivery'));

  const now = Timestamp.now();
  const txRef = db.collection(COLLECTIONS.walletTransactions).doc();
  let balanceAfter = 0;
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(customer.ref);
    const current = (snap.get('walletBalanceCents') as number | undefined) ?? 0;
    balanceAfter = current + data.amountCents;
    const entry: WalletTransaction = {
      userId: data.userId,
      type: 'credit',
      amountCents: data.amountCents,
      balanceAfterCents: balanceAfter,
      reason: data.reason,
      orderId: data.orderId ?? null,
      ticketId: null,
      refundId: null,
      expiresAt: data.validityDays ? Timestamp.fromMillis(now.toMillis() + data.validityDays * 86_400_000) : null,
      note: data.note,
      createdAt: now,
      createdBy: caller.uid,
    };
    tx.set(txRef, entry);
    tx.update(customer.ref, { walletBalanceCents: balanceAfter, updatedAt: now, updatedBy: caller.uid });
    const bookingDate = parisDay();
    const walletLedger: LedgerEntry = {
      accountType: 'customer_wallet',
      accountId: data.userId,
      type: 'wallet_credit',
      amountCents: data.amountCents,
      currency: 'EUR',
      orderId: data.orderId ?? null,
      description: `Avoir : ${CUSTOMER_CREDIT_REASON_LABELS[data.reason]}`,
      reason: data.note,
      bookingDate,
      countryId: customer.data.countryId ?? 'FR',
      cityId: customer.data.cityId ?? null,
      createdAt: now,
      createdBy: caller.uid,
    };
    tx.set(db.collection(COLLECTIONS.ledgerEntries).doc(), walletLedger);
    if (chargeRestaurant && order) {
      const charge: LedgerEntry = {
        accountType: 'restaurant',
        accountId: order.restaurantId,
        type: 'refund_charge',
        amountCents: -data.amountCents,
        currency: 'EUR',
        orderId: order.id,
        description: `Avoir client imputé (commande ${order.number})`,
        reason: data.note,
        bookingDate,
        countryId: order.countryId,
        cityId: order.cityId,
        createdAt: now,
        createdBy: caller.uid,
      };
      tx.set(db.collection(COLLECTIONS.ledgerEntries).doc(), charge);
    }
  });

  await writeAudit({
    actor: adminActor(caller),
    action: 'customer.credited',
    target: customerTarget(data.userId, customer.data),
    reason: data.note,
    after: { amountCents: data.amountCents, reason: data.reason, orderId: data.orderId ?? null, balanceAfterCents: balanceAfter, chargedToRestaurant: chargeRestaurant ? order?.restaurantId : null },
    countryId: customer.data.countryId ?? null,
    cityId: customer.data.cityId ?? null,
    sensitive: true,
    request,
  });
  return { transactionId: txRef.id, balanceAfterCents: balanceAfter, chargedToRestaurant: chargeRestaurant };
});

// ------------------------------------------------------------------ Blocage

export const blockCustomer = acteursCallable(
  z.object({ userId: zId, blocked: z.boolean(), reason: zReason }),
  async (data, request) => {
    const { caller, admin } = await requireAdmin(request, 'customers.block');
    const customer = await loadCustomer(data.userId);
    assertAdminCovers(admin, customer.data.cityId ?? null);
    const isBlocked = customer.data.status === 'blocked';
    if (isBlocked === data.blocked) throw fail.precondition(data.blocked ? 'Ce compte est déjà bloqué.' : 'Ce compte n’est pas bloqué.');
    const now = Timestamp.now();
    await customer.ref.update({
      status: data.blocked ? 'blocked' : 'active',
      blockedReason: data.blocked ? data.reason : null,
      blockedAt: data.blocked ? now : null,
      blockedBy: data.blocked ? caller.uid : null,
      updatedAt: now,
      updatedBy: caller.uid,
    });
    // Compte d'authentification désactivé et sessions révoquées pendant le blocage.
    let authUpdated = true;
    try {
      await auth.updateUser(data.userId, { disabled: data.blocked });
      if (data.blocked) await auth.revokeRefreshTokens(data.userId);
    } catch (error) {
      authUpdated = false;
      if (!isAuthError(error, 'user-not-found')) logger.warn('Compte d’authentification non mis à jour', { userId: data.userId, error: String(error) });
    }
    await writeAudit({
      actor: adminActor(caller),
      action: data.blocked ? 'customer.blocked' : 'customer.unblocked',
      target: customerTarget(data.userId, customer.data),
      reason: data.reason,
      before: { status: customer.data.status },
      after: { status: data.blocked ? 'blocked' : 'active', authUpdated },
      countryId: customer.data.countryId ?? null,
      cityId: customer.data.cityId ?? null,
      sensitive: true,
      request,
    });
    return { status: data.blocked ? 'blocked' : 'active', authUpdated };
  },
);

// ------------------------------------------------------------------ Suppression RGPD

async function deleteSubcollection(ref: FirebaseFirestore.DocumentReference, name: string): Promise<number> {
  const snap = await ref.collection(name).get();
  const batch = db.batch();
  snap.docs.forEach((d) => batch.delete(d.ref));
  if (snap.size > 0) await batch.commit();
  return snap.size;
}

/**
 * Suppression RGPD complète d'un compte client : avoir annulé, sous-collections
 * personnelles supprimées, profil et données privées anonymisés, compte Auth
 * supprimé, PII effacée des enregistrements conservés (commandes, avis, tickets),
 * demande RGPD clôturée. Utilisée par `deleteCustomerAccount` (fiche client) et par
 * `handleGdprRequest` (écran Légal & RGPD) : un seul moteur d'effacement, pas deux.
 */
export async function eraseCustomerAccount(input: {
  userId: string;
  reason: string;
  actorUid: string;
  auditActor: Parameters<typeof writeAudit>[0]['actor'];
  gdprRequestId?: string | null;
  request?: Parameters<typeof writeAudit>[0]['request'];
}): Promise<{ authDeleted: boolean; forfeitedCents: number }> {
  const customer = await loadCustomer(input.userId);
  const recent = await db.collection(COLLECTIONS.orders).where('customerId', '==', input.userId).orderBy('createdAt', 'desc').limit(20).get();
  const active = recent.docs.filter((d) => ACTIVE_ORDER_STATUSES.includes((d.data() as Order).status));
  if (active.length > 0) throw fail.precondition('Une commande est en cours : attendez sa clôture avant de supprimer le compte.');

  const now = Timestamp.now();
  const hash = createHash('sha256').update(`${input.userId}:${customer.data.email}`).digest('hex').slice(0, 16);
  const balance = customer.data.walletBalanceCents ?? 0;
  if (balance > 0) {
    const expiry: WalletTransaction = {
      userId: input.userId,
      type: 'expiry',
      amountCents: -balance,
      balanceAfterCents: 0,
      reason: 'expiry',
      note: 'Solde annulé à la suppression du compte',
      createdAt: now,
      createdBy: input.actorUid,
    };
    await db.collection(COLLECTIONS.walletTransactions).add(expiry);
  }
  const counts: Record<string, number> = {};
  for (const sub of ['addresses', 'favorites', 'devices', 'paymentMethods', 'notifications']) {
    counts[sub] = await deleteSubcollection(customer.ref, sub);
  }
  await customer.ref.update({
    firstName: 'Client',
    lastName: 'supprimé',
    displayName: 'Client supprimé',
    email: `supprime-${hash}@anonyme.invalid`,
    emailVerified: false,
    phone: null,
    phoneVerified: false,
    avatar: null,
    status: 'deleted',
    blockedReason: null,
    defaultAddressId: null,
    consents: {},
    notificationPrefs: { orderUpdates: false, promotions: false, newsletter: false },
    walletBalanceCents: 0,
    searchKeywords: [],
    deletedAt: now,
    deletedBy: input.actorUid,
    deleteReason: input.reason,
    updatedAt: now,
    updatedBy: input.actorUid,
  });
  await db
    .collection(COLLECTIONS.userPrivate)
    .doc(input.userId)
    .set({ stripeCustomerId: null, deviceHashes: [], cardFingerprints: [], phoneHash: null, updatedAt: now }, { merge: true });
  const anonymized = await anonymizeCustomerRecords(input.userId);
  let authDeleted = true;
  try {
    await auth.deleteUser(input.userId);
  } catch (error) {
    authDeleted = false;
    if (!isAuthError(error, 'user-not-found')) throw error;
  }

  const retained = [...CUSTOMER_RETAINED_DATA];
  if (input.gdprRequestId) {
    await db.collection(COLLECTIONS.gdprRequests).doc(input.gdprRequestId).set(
      { status: 'completed', completedAt: now, retainedData: retained, updatedAt: now, updatedBy: input.actorUid },
      { merge: true },
    );
  } else {
    const requestDoc: GdprRequest = {
      type: 'erasure',
      subjectType: 'client',
      subjectId: input.userId,
      email: `supprime-${hash}@anonyme.invalid`,
      status: 'completed',
      receivedAt: now,
      dueAt: now,
      completedAt: now,
      assigneeId: input.actorUid,
      retainedData: retained,
      notes: input.reason,
      createdAt: now,
      createdBy: input.actorUid,
      updatedAt: now,
      updatedBy: input.actorUid,
    };
    await db.collection(COLLECTIONS.gdprRequests).add(requestDoc);
  }
  await writeAudit({
    actor: input.auditActor,
    action: 'customer.deleted',
    target: { type: 'client', id: input.userId, label: 'Client supprimé' },
    reason: input.reason,
    before: { status: customer.data.status, walletBalanceCents: balance },
    after: { status: 'deleted', authDeleted, removed: counts, anonymized, retained },
    countryId: customer.data.countryId ?? null,
    cityId: customer.data.cityId ?? null,
    sensitive: true,
    request: input.request,
  });
  return { authDeleted, forfeitedCents: balance };
}

export const deleteCustomerAccount = acteursCallable(
  z.object({ userId: zId, reason: zReason, gdprRequestId: zId.nullish() }),
  async (data, request) => {
    const { caller, admin } = await requireAdmin(request, 'customers.delete');
    const customer = await loadCustomer(data.userId);
    assertAdminCovers(admin, customer.data.cityId ?? null);
    return eraseCustomerAccount({ userId: data.userId, reason: data.reason, actorUid: caller.uid, auditActor: adminActor(caller), gdprRequestId: data.gdprRequestId, request });
  },
);

/**
 * Trace au journal d'audit l'export CSV des clients (cahier §7 « Liste et filtres ») : l'export
 * lui-même reste généré côté navigateur (`ClientsPage.tsx::exportRows`), mais jusqu'ici aucun
 * droit ni aucune trace n'étaient exigés pour une liste contenant des données personnelles —
 * même défaut déjà corrigé pour les livreurs (`auditDriversExport`, `cdc-fix-residuals-3`),
 * jamais appliqué aux clients. Le bouton d'export n'est affiché côté client que si l'appelant a
 * `exports.run` ; ce contrôle est revérifié ici côté serveur.
 */
export const auditCustomersExport = acteursCallable(
  z.object({ userIds: z.array(zId).min(1).max(2000), reason: zReason }),
  async (data, request) => {
    const { caller } = await requireAdmin(request, 'exports.run');
    await writeAudit({
      actor: adminActor(caller),
      action: 'customer.exported',
      target: { type: 'other', id: `customers-export-${Date.now()}`, label: `Export CSV clients (${data.userIds.length})` },
      reason: data.reason,
      after: { count: data.userIds.length, userIds: data.userIds.slice(0, 50) },
      sensitive: true,
      request,
    });
    return { ok: true as const };
  },
);

