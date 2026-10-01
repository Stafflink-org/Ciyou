// Fraude (cahier §28) : détection automatique de signaux (clients, promotions,
// livreurs, commerces), dossiers à traiter et liste de blocage (téléphone, e-mail,
// appareil, empreinte carte). Les détections planifiées créent ou complètent des
// dossiers ; le traitement donne un effet réel (blocage, suspension, gel des
// reversements), audité avec motif.
import {
  COLLECTIONS,
  DEFAULT_FRAUD_SETTINGS,
  SETTINGS_DOCS,
  haversineMeters,
  type BlocklistType,
  type Driver,
  type FraudCase,
  type FraudSettings,
  type FraudSubjectType,
  type Order,
  type OrderClaim,
  type PromotionRedemption,
} from '@golink/shared';
import { createHash } from 'node:crypto';
import { logger } from 'firebase-functions/v2';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { auth, db, FieldValue, Timestamp } from '../lib/admin';
import { actorFromCaller, writeAudit } from '../lib/audit';
import { fail } from '../lib/errors';
import { requireAdmin } from '../lib/permissions';
import { z, zId, zReason } from '../lib/validation';
import { PLATFORM_RUNTIME, PLATFORM_SCHEDULE_RUNTIME, TIMEZONE, platformCallable, requireSecureAdmin } from './runtime';

export async function loadFraudSettings(): Promise<Omit<FraudSettings, 'updatedAt' | 'updatedBy'>> {
  const snap = await db.collection(COLLECTIONS.settings).doc(SETTINGS_DOCS.fraud).get();
  const data = (snap.data() as Partial<FraudSettings> | undefined) ?? {};
  return { ...DEFAULT_FRAUD_SETTINGS, ...data, scores: { ...DEFAULT_FRAUD_SETTINGS.scores, ...(data.scores ?? {}) } };
}

export const updateFraudSettings = platformCallable(
  z.object({
    lookbackDays: z.number().int().min(1).max(90),
    clientMinOrders: z.number().int().min(1).max(1000),
    clientNotReceivedThreshold: z.number().int().min(1).max(100),
    clientRepeatedClaimsThreshold: z.number().int().min(1).max(100),
    clientCancellationRate: z.number().min(0.05).max(1),
    promoAbuseCodesThreshold: z.number().int().min(2).max(100),
    restaurantMinOrders: z.number().int().min(1).max(10_000),
    restaurantRefundRate: z.number().min(0.05).max(1),
    fakeOrderCancelWithinSeconds: z.number().int().min(10).max(3600),
    fakeOrderThreshold: z.number().int().min(2).max(100),
    driverOffAddressMeters: z.number().int().min(50).max(5000),
    driverOffAddressThreshold: z.number().int().min(1).max(50),
    driverCancellationsThreshold: z.number().int().min(1).max(50),
    scores: z.object({
      frequentNotReceived: z.number().int().min(1).max(100),
      repeatedClaims: z.number().int().min(1).max(100),
      abnormalCancellations: z.number().int().min(1).max(100),
      promoAbuse: z.number().int().min(1).max(100),
      refundRate: z.number().int().min(1).max(100),
      fakeOrders: z.number().int().min(1).max(100),
      offAddressDelivery: z.number().int().min(1).max(100),
      driverCancellations: z.number().int().min(1).max(100),
      sharedAccount: z.number().int().min(1).max(100),
      linkedAccounts: z.number().int().min(1).max(100),
    }),
    reason: zReason,
  }),
  async (data, request) => {
    const { caller } = await requireAdmin(request, 'settings.edit');
    const before = await loadFraudSettings();
    const { reason, ...values } = data;
    await db.collection(COLLECTIONS.settings).doc(SETTINGS_DOCS.fraud).set({ ...values, updatedAt: FieldValue.serverTimestamp(), updatedBy: caller.uid });
    await db.collection(COLLECTIONS.settingsHistory).add({
      docPath: `${COLLECTIONS.settings}/${SETTINGS_DOCS.fraud}`,
      changedFields: ['fraud_settings'],
      before,
      after: values,
      reason,
      changedBy: caller.uid,
      changedAt: FieldValue.serverTimestamp(),
    });
    await writeAudit({ actor: actorFromCaller(caller, 'admin'), action: 'fraud_settings.updated', target: { type: 'other', id: 'fraud', label: 'Seuils de détection de fraude' }, reason, before, after: values, sensitive: true, request });
    return { ok: true as const };
  },
);

function fraudRef(subjectType: FraudSubjectType, subjectId: string) {
  return db.collection(COLLECTIONS.fraudCases).doc(`${subjectType}_${subjectId}`);
}

/**
 * Ouvre ou complète un dossier de fraude avec un signal donné (§28). Exportée pour être
 * appelée depuis un autre module qu'une détection planifiée nocturne : c'est le cas du
 * contrôle d'identité livreur (`admin/operations/drivers.ts reviewIdentityCheck`), un
 * échec est un signal fort et immédiat, il n'a pas à attendre le passage de
 * `detectFraudSignals` la nuit suivante.
 */
export async function upsertSignal(
  subjectType: FraudSubjectType,
  subjectId: string,
  subjectName: string,
  countryId: string,
  signal: { code: FraudCase['signals'][number]['code']; detail: string; score: number },
): Promise<void> {
  const ref = fraudRef(subjectType, subjectId);
  const snap = await ref.get();
  const now = Timestamp.now();
  const entry = { ...signal, at: now };
  if (!snap.exists) {
    const record: Omit<FraudCase, 'createdAt' | 'updatedAt'> & { createdAt: FieldValue; updatedAt: FieldValue } = {
      subjectType,
      subjectId,
      subjectName,
      countryId,
      cityId: null,
      signals: [entry],
      riskScore: signal.score,
      status: 'open',
      assigneeId: null,
      decision: null,
      linkedEntities: [{ type: subjectType, id: subjectId, label: subjectName }],
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      createdBy: 'system',
      updatedBy: 'system',
    } as unknown as Omit<FraudCase, 'createdAt' | 'updatedAt'> & { createdAt: FieldValue; updatedAt: FieldValue };
    await ref.set(record);
    return;
  }
  const existing = snap.data() as FraudCase;
  const already = existing.signals.some((s) => s.code === signal.code && s.detail === signal.detail);
  if (already && existing.status !== 'dismissed') return;
  const signals = existing.status === 'dismissed' ? [entry] : [...existing.signals, entry];
  const riskScore = Math.min(100, signals.reduce((sum, s) => sum + s.score, 0));
  await ref.update({
    signals,
    riskScore,
    status: existing.status === 'dismissed' ? 'open' : existing.status,
    updatedAt: FieldValue.serverTimestamp(),
    updatedBy: 'system',
  });
}

/**
 * La fiche client (§7 « Indicateurs de risque ») lit `userPrivate/{uid}.riskScore`/`.riskFlags`
 * — jamais alimentés par aucune fonction jusqu'ici (seule l'écriture à la création du compte,
 * à 0/[], existait) : un client avec un dossier de fraude réel ouvert dans `fraudCases` restait
 * donc affiché sans aucun signal de risque. Recopie ici le score et les codes de signaux dès
 * qu'un dossier client est créé ou complété.
 */
export const onFraudCaseWritten = onDocumentWritten({ document: `${COLLECTIONS.fraudCases}/{caseId}`, ...PLATFORM_RUNTIME }, async (event) => {
  const after = event.data?.after.data() as FraudCase | undefined;
  if (!after || after.subjectType !== 'client') return;
  const riskFlags = [...new Set(after.signals.map((s) => s.code))];
  // Un seul dossier par client (identifiant `client_{uid}`, cf. fraudRef) : fraudCaseIds reflète
  // simplement son existence, lue par la fiche client (ClientPage.tsx) sans jamais être posée.
  const fraudCaseIds = [event.params.caseId as string];
  const ref = db.collection(COLLECTIONS.userPrivate).doc(after.subjectId);
  const snap = await ref.get();
  if (!snap.exists) return; // Compte supprimé entre-temps : rien à synchroniser.
  if (snap.get('riskScore') === after.riskScore && JSON.stringify(snap.get('riskFlags') ?? []) === JSON.stringify(riskFlags)) return;
  await ref.update({ riskScore: after.riskScore, riskFlags, fraudCaseIds, updatedAt: Timestamp.now() });
});

/** Clients : réclamations répétées, « non reçu » fréquent, annulations anormales, comptes liés (§28). */
async function detectClientSignals(since: Timestamp, settings: Omit<FraudSettings, 'updatedAt' | 'updatedBy'>): Promise<number> {
  const [orders, claims] = await Promise.all([
    db.collection(COLLECTIONS.orders).where('createdAt', '>=', since).get(),
    db.collection(COLLECTIONS.orderClaims).where('createdAt', '>=', since).get(),
  ]);
  const byCustomer = new Map<string, { name: string; countryId: string; cancelled: number; total: number }>();
  for (const doc of orders.docs) {
    const data = doc.data() as Order;
    const customerId = data.customerId;
    if (!customerId) continue;
    const entry = byCustomer.get(customerId) ?? { name: data.customerName ?? customerId, countryId: data.countryId ?? '', cancelled: 0, total: 0 };
    entry.total += 1;
    if (data.status === 'cancelled') entry.cancelled += 1;
    byCustomer.set(customerId, entry);
  }
  const claimsByCustomer = new Map<string, { name: string; countryId: string; notReceived: number; total: number }>();
  for (const doc of claims.docs) {
    const data = doc.data() as OrderClaim;
    if (data.status === 'rejected') continue;
    const entry = claimsByCustomer.get(data.customerId) ?? { name: data.customerName, countryId: data.countryId, notReceived: 0, total: 0 };
    entry.total += 1;
    if (data.type === 'not_received') entry.notReceived += 1;
    claimsByCustomer.set(data.customerId, entry);
  }
  let count = 0;
  for (const [id, entry] of byCustomer) {
    if (entry.total < settings.clientMinOrders) continue;
    if (entry.cancelled / entry.total >= settings.clientCancellationRate) {
      await upsertSignal('client', id, entry.name, entry.countryId, { code: 'abnormal_cancellations', detail: `${entry.cancelled} annulations sur ${entry.total} commandes (${Math.round((entry.cancelled / entry.total) * 100)} %) en ${settings.lookbackDays} jours.`, score: settings.scores.abnormalCancellations });
      count += 1;
    }
  }
  for (const [id, entry] of claimsByCustomer) {
    const clientOrders = byCustomer.get(id);
    if (entry.notReceived >= settings.clientNotReceivedThreshold) {
      await upsertSignal('client', id, entry.name, entry.countryId, { code: 'frequent_not_received', detail: `${entry.notReceived} réclamations « commande non reçue » en ${settings.lookbackDays} jours.`, score: settings.scores.frequentNotReceived });
      count += 1;
    }
    if (entry.total >= settings.clientRepeatedClaimsThreshold) {
      await upsertSignal('client', id, entry.name, entry.countryId, { code: 'repeated_claims', detail: `${entry.total} réclamations en ${settings.lookbackDays} jours${clientOrders ? ` sur ${clientOrders.total} commandes` : ''}.`, score: settings.scores.repeatedClaims });
      count += 1;
    }
  }
  return count;
}

/** Comptes clients multiples liés au même appareil, téléphone ou empreinte de carte (§28). */
async function detectLinkedAccounts(settings: Omit<FraudSettings, 'updatedAt' | 'updatedBy'>): Promise<number> {
  const privateSnap = await db.collection(COLLECTIONS.userPrivate).where('deviceHashes', '!=', []).limit(5000).get();
  const byDevice = new Map<string, Set<string>>();
  const byCard = new Map<string, Set<string>>();
  const byPhone = new Map<string, Set<string>>();
  for (const doc of privateSnap.docs) {
    const data = doc.data() as { deviceHashes?: string[]; cardFingerprints?: string[]; phoneHash?: string | null };
    for (const h of data.deviceHashes ?? []) {
      const set = byDevice.get(h) ?? new Set<string>();
      set.add(doc.id);
      byDevice.set(h, set);
    }
    for (const h of data.cardFingerprints ?? []) {
      const set = byCard.get(h) ?? new Set<string>();
      set.add(doc.id);
      byCard.set(h, set);
    }
    if (data.phoneHash) {
      const set = byPhone.get(data.phoneHash) ?? new Set<string>();
      set.add(doc.id);
      byPhone.set(data.phoneHash, set);
    }
  }
  const linked = new Map<string, Set<string>>();
  const merge = (label: string, groups: Map<string, Set<string>>) => {
    for (const ids of groups.values()) {
      if (ids.size < 2) continue;
      for (const id of ids) {
        const set = linked.get(id) ?? new Set<string>();
        for (const other of ids) if (other !== id) set.add(`${other}:${label}`);
        linked.set(id, set);
      }
    }
  };
  merge('appareil', byDevice);
  merge('carte', byCard);
  merge('téléphone', byPhone);
  let count = 0;
  for (const [id, others] of linked) {
    if (others.size === 0) continue;
    const userSnap = await db.collection(COLLECTIONS.users).doc(id).get();
    const name = (userSnap.data()?.displayName as string | undefined) ?? id;
    const countryId = (userSnap.data()?.countryId as string | undefined) ?? '';
    await upsertSignal('client', id, name, countryId, { code: 'linked_accounts', detail: `Compte lié à ${others.size} autre(s) compte(s) par ${[...others].map((o) => o.split(':')[1]).filter((v, i, a) => a.indexOf(v) === i).join(', ')}.`, score: settings.scores.linkedAccounts });
    count += 1;
  }
  return count;
}

/** Abus de promotions : réutilisation de codes par un même client (données réelles `promotionRedemptions`). */
async function detectPromoAbuse(since: Timestamp, settings: Omit<FraudSettings, 'updatedAt' | 'updatedBy'>): Promise<number> {
  const redemptions = await db.collection(COLLECTIONS.promotionRedemptions).where('createdAt', '>=', since).get();
  const byCustomer = new Map<string, { countryId: string; codes: Set<string> }>();
  for (const doc of redemptions.docs) {
    const data = doc.data() as PromotionRedemption;
    if (data.status !== 'applied') continue;
    const entry = byCustomer.get(data.userId) ?? { countryId: data.cityId ?? '', codes: new Set<string>() };
    entry.codes.add(data.promotionId);
    byCustomer.set(data.userId, entry);
  }
  let count = 0;
  for (const [id, entry] of byCustomer) {
    if (entry.codes.size >= settings.promoAbuseCodesThreshold) {
      const userSnap = await db.collection(COLLECTIONS.users).doc(id).get();
      const name = (userSnap.data()?.displayName as string | undefined) ?? id;
      await upsertSignal('client', id, name, entry.countryId, { code: 'promo_abuse', detail: `${entry.codes.size} codes promotionnels différents utilisés en ${settings.lookbackDays} jours.`, score: settings.scores.promoAbuse });
      count += 1;
    }
  }
  return count;
}

/** Commerces : taux de remboursement réel et commandes fictives (annulées par le commerce juste après création). */
async function detectRestaurantSignals(since: Timestamp, settings: Omit<FraudSettings, 'updatedAt' | 'updatedBy'>): Promise<number> {
  const [refunds, orders] = await Promise.all([
    db.collection(COLLECTIONS.refunds).where('requestedAt', '>=', since).get().catch(() => ({ docs: [] as FirebaseFirestore.QueryDocumentSnapshot[] })),
    db.collection(COLLECTIONS.orders).where('createdAt', '>=', since).get(),
  ]);
  const byRestaurant = new Map<string, { name: string; countryId: string; refunded: number; total: number; fastCancels: number }>();
  for (const doc of orders.docs) {
    const data = doc.data() as Order;
    const entry = byRestaurant.get(data.restaurantId) ?? { name: data.restaurantName, countryId: data.countryId, refunded: 0, total: 0, fastCancels: 0 };
    entry.total += 1;
    if (data.status === 'cancelled' && data.cancellation?.by === 'restaurant') {
      const cancelledAtMs = data.cancellation.at.toMillis();
      const placedAtMs = data.timeline.placedAt.toMillis();
      if (cancelledAtMs - placedAtMs <= settings.fakeOrderCancelWithinSeconds * 1000) entry.fastCancels += 1;
    }
    byRestaurant.set(data.restaurantId, entry);
  }
  for (const doc of refunds.docs) {
    const data = doc.data() as Record<string, unknown>;
    const restaurantId = data.restaurantId as string | undefined;
    if (!restaurantId) continue;
    const entry = byRestaurant.get(restaurantId);
    if (entry) entry.refunded += 1;
  }
  let count = 0;
  for (const [id, entry] of byRestaurant) {
    if (entry.total >= settings.restaurantMinOrders && entry.refunded / entry.total >= settings.restaurantRefundRate) {
      await upsertSignal('restaurant', id, entry.name, entry.countryId, { code: 'refund_rate', detail: `${entry.refunded} remboursements sur ${entry.total} commandes (${Math.round((entry.refunded / entry.total) * 100)} %) en ${settings.lookbackDays} jours.`, score: settings.scores.refundRate });
      count += 1;
    }
    if (entry.fastCancels >= settings.fakeOrderThreshold) {
      await upsertSignal('restaurant', id, entry.name, entry.countryId, { code: 'fake_orders', detail: `${entry.fastCancels} commandes annulées par le commerce dans les ${settings.fakeOrderCancelWithinSeconds} s suivant leur création, en ${settings.lookbackDays} jours.`, score: settings.scores.fakeOrders });
      count += 1;
    }
  }
  return count;
}

/** Livreurs : livraisons hors adresse, annulations imputables au livreur, comptes partagés (téléphone commun). */
async function detectDriverSignals(since: Timestamp, settings: Omit<FraudSettings, 'updatedAt' | 'updatedBy'>): Promise<number> {
  const orders = await db.collection(COLLECTIONS.orders).where('createdAt', '>=', since).where('fulfillment', '==', 'delivery').get();
  const byDriver = new Map<string, { name: string; countryId: string; offAddress: number; cancellations: number }>();
  for (const doc of orders.docs) {
    const data = doc.data() as Order;
    const driverId = data.driverId;
    if (!driverId || data.delivery?.deliveredBy !== 'platform') continue;
    const entry = byDriver.get(driverId) ?? { name: data.delivery?.driverName ?? driverId, countryId: data.countryId, offAddress: 0, cancellations: 0 };
    if (data.status === 'delivered' && data.delivery?.proof?.geo && data.delivery.geo) {
      const distance = haversineMeters(
        { lat: data.delivery.proof.geo.latitude, lng: data.delivery.proof.geo.longitude },
        { lat: data.delivery.geo.latitude, lng: data.delivery.geo.longitude },
      );
      if (distance > settings.driverOffAddressMeters) entry.offAddress += 1;
    }
    if (data.status === 'cancelled' && (data.cancellation?.by === 'driver' || data.cancellation?.reason === 'address_unreachable')) entry.cancellations += 1;
    byDriver.set(driverId, entry);
  }
  let count = 0;
  for (const [id, entry] of byDriver) {
    if (entry.offAddress >= settings.driverOffAddressThreshold) {
      await upsertSignal('driver', id, entry.name, entry.countryId, { code: 'off_address_delivery', detail: `${entry.offAddress} livraison(s) confirmée(s) à plus de ${settings.driverOffAddressMeters} m de l’adresse du client en ${settings.lookbackDays} jours.`, score: settings.scores.offAddressDelivery });
      count += 1;
    }
    if (entry.cancellations >= settings.driverCancellationsThreshold) {
      await upsertSignal('driver', id, entry.name, entry.countryId, { code: 'abnormal_cancellations', detail: `${entry.cancellations} livraisons non menées à terme par ce livreur en ${settings.lookbackDays} jours.`, score: settings.scores.driverCancellations });
      count += 1;
    }
  }
  // Comptes partagés : plusieurs fiches livreur actives avec le même numéro de téléphone.
  const driversSnap = await db.collection(COLLECTIONS.drivers).where('status', '==', 'active').get();
  const byPhone = new Map<string, Array<{ id: string; name: string; countryId: string }>>();
  for (const doc of driversSnap.docs) {
    const data = doc.data() as Driver;
    if (!data.phone) continue;
    const list = byPhone.get(data.phone) ?? [];
    list.push({ id: doc.id, name: data.displayName, countryId: data.cityId });
    byPhone.set(data.phone, list);
  }
  for (const list of byPhone.values()) {
    if (list.length < 2) continue;
    for (const d of list) {
      await upsertSignal('driver', d.id, d.name, d.countryId, { code: 'shared_account', detail: `Numéro de téléphone partagé avec ${list.length - 1} autre(s) fiche(s) livreur.`, score: settings.scores.sharedAccount });
      count += 1;
    }
  }
  return count;
}

// ------------------------------------------------------------------ Effet des décisions

/** Applique réellement une décision de fraude au compte concerné (§28) : sans cela le dossier n'a aucun effet. */
async function applyFraudDecision(fraudCase: FraudCase, action: 'blocked' | 'suspended' | 'payout_hold', reason: string): Promise<void> {
  const { subjectType, subjectId } = fraudCase;
  const now = Timestamp.now();
  if (action === 'payout_hold') {
    const collection = subjectType === 'restaurant' ? COLLECTIONS.restaurants : subjectType === 'driver' ? COLLECTIONS.drivers : null;
    if (collection) {
      await db.collection(collection).doc(subjectId).set({ payoutHold: true, payoutHoldReason: reason, payoutHoldAt: now }, { merge: true });
    }
    return;
  }
  const status = action === 'blocked' ? 'blocked' : 'suspended';
  if (subjectType === 'client') {
    await db.collection(COLLECTIONS.users).doc(subjectId).set({ status, blockedReason: reason, blockedAt: now, blockedBy: 'fraud_case', updatedAt: now }, { merge: true });
    await auth.updateUser(subjectId, { disabled: true }).catch(() => undefined);
    await auth.revokeRefreshTokens(subjectId).catch(() => undefined);
  } else if (subjectType === 'restaurant') {
    await db.collection(COLLECTIONS.restaurants).doc(subjectId).set({ status, updatedAt: now }, { merge: true });
  } else if (subjectType === 'driver') {
    await db
      .collection(COLLECTIONS.drivers)
      .doc(subjectId)
      .set({ status, blocked: { reason: 'fraud_case', at: now, note: reason } }, { merge: true });
  }
}

/** Toutes les nuits : recalcule les signaux de fraude automatiques (§28). */
export const detectFraudSignals = onSchedule(
  { schedule: '30 3 * * *', timeZone: TIMEZONE, ...PLATFORM_SCHEDULE_RUNTIME, timeoutSeconds: 300, memory: '512MiB' },
  async () => {
    const settings = await loadFraudSettings();
    const since = Timestamp.fromMillis(Date.now() - settings.lookbackDays * 86_400_000);
    const [clients, linked, promos, restaurants, drivers] = await Promise.all([
      detectClientSignals(since, settings).catch((error) => { logger.error('Détection clients échouée', { error: String(error) }); return 0; }),
      detectLinkedAccounts(settings).catch((error) => { logger.error('Détection comptes liés échouée', { error: String(error) }); return 0; }),
      detectPromoAbuse(since, settings).catch((error) => { logger.error('Détection promotions échouée', { error: String(error) }); return 0; }),
      detectRestaurantSignals(since, settings).catch((error) => { logger.error('Détection commerces échouée', { error: String(error) }); return 0; }),
      detectDriverSignals(since, settings).catch((error) => { logger.error('Détection livreurs échouée', { error: String(error) }); return 0; }),
    ]);
    logger.info('Signaux de fraude détectés', { clients, linked, promos, restaurants, drivers });
  },
);

// ------------------------------------------------------------------ Traitement des dossiers

export const decideFraudCase = platformCallable(
  z.object({
    caseId: zId,
    status: z.enum(['open', 'investigating', 'confirmed', 'dismissed']),
    action: z.enum(['none', 'warning', 'blocked', 'suspended', 'payout_hold']).optional(),
    note: zReason,
  }),
  async (data, request) => {
    const { caller } = await requireSecureAdmin(request, 'fraud.manage');
    const ref = db.collection(COLLECTIONS.fraudCases).doc(data.caseId);
    const snap = await ref.get();
    if (!snap.exists) throw fail.notFound('Dossier de fraude');
    const fraudCase = snap.data() as FraudCase;
    const decision = data.action ? { action: data.action, note: data.note, by: caller.uid, at: Timestamp.now() } : (fraudCase.decision ?? null);
    await ref.update({
      status: data.status,
      assigneeId: caller.uid,
      decision,
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: caller.uid,
    });
    // Effet réel de la décision (§28) : sans cela le dossier ne fait que documenter, il ne protège pas la plateforme.
    if (data.action === 'blocked' || data.action === 'suspended' || data.action === 'payout_hold') {
      await applyFraudDecision(fraudCase, data.action, data.note);
    }
    await writeAudit({
      actor: actorFromCaller(caller, 'admin'),
      action: 'fraud_case.decided',
      target: { type: fraudCase.subjectType, id: fraudCase.subjectId, label: fraudCase.subjectName },
      reason: data.note,
      after: { status: data.status, action: data.action ?? null, effectApplied: data.action === 'blocked' || data.action === 'suspended' || data.action === 'payout_hold' },
      sensitive: true,
      request,
    });
    return { status: data.status };
  },
);

// ------------------------------------------------------------------ Liste de blocage

export function hashValue(value: string): string {
  return createHash('sha256').update(value.trim().toLowerCase()).digest('hex');
}

function previewOf(type: BlocklistType, value: string): string {
  const trimmed = value.trim();
  if (type === 'email') {
    const [user, domain] = trimmed.split('@');
    if (!domain) return '••••';
    return `${(user ?? '').slice(0, 2)}••@${domain}`;
  }
  if (type === 'phone') {
    return trimmed.length > 4 ? `${trimmed.slice(0, 4)} ** ** ** ${trimmed.slice(-2)}` : '••••';
  }
  return `${trimmed.slice(0, 4)}••••${trimmed.slice(-4)}`;
}

export const addBlocklistEntry = platformCallable(
  z.object({
    type: z.enum(['phone', 'email', 'device', 'card_fingerprint', 'iban', 'ip']),
    value: z.string().trim().min(3).max(200),
    reason: zReason,
    fraudCaseId: zId.nullish(),
    expiresAt: z.number().int().nullable(),
  }),
  async (data, request) => {
    const { caller } = await requireSecureAdmin(request, 'fraud.manage');
    const valueHash = hashValue(data.value);
    const existing = await db.collection(COLLECTIONS.blocklist).where('type', '==', data.type).where('valueHash', '==', valueHash).where('active', '==', true).limit(1).get();
    if (!existing.empty) throw fail.alreadyExists('Cette valeur est déjà bloquée.');
    const ref = db.collection(COLLECTIONS.blocklist).doc();
    await ref.set({
      type: data.type,
      valueHash,
      valuePreview: previewOf(data.type, data.value),
      reason: data.reason,
      fraudCaseId: data.fraudCaseId ?? null,
      expiresAt: data.expiresAt ? Timestamp.fromMillis(data.expiresAt) : null,
      active: true,
      createdAt: FieldValue.serverTimestamp(),
      createdBy: caller.uid,
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: caller.uid,
    });
    await writeAudit({
      actor: actorFromCaller(caller, 'admin'),
      action: 'blocklist.added',
      target: { type: 'other', id: ref.id, label: previewOf(data.type, data.value) },
      reason: data.reason,
      sensitive: true,
      request,
    });
    return { id: ref.id };
  },
);

export const removeBlocklistEntry = platformCallable(
  z.object({ entryId: zId, reason: zReason }),
  async (data, request) => {
    const { caller } = await requireSecureAdmin(request, 'fraud.manage');
    const ref = db.collection(COLLECTIONS.blocklist).doc(data.entryId);
    const snap = await ref.get();
    if (!snap.exists) throw fail.notFound('Entrée de la liste de blocage');
    await ref.update({ active: false, updatedAt: FieldValue.serverTimestamp(), updatedBy: caller.uid });
    await writeAudit({
      actor: actorFromCaller(caller, 'admin'),
      action: 'blocklist.removed',
      target: { type: 'other', id: data.entryId, label: String(snap.get('valuePreview') ?? '') },
      reason: data.reason,
      sensitive: true,
      request,
    });
    return { removed: true };
  },
);

/** Utilisée par les fonctions de commande/inscription pour vérifier un blocage actif. */
export async function isBlocked(type: BlocklistType, value: string): Promise<boolean> {
  const valueHash = hashValue(value);
  const now = Timestamp.now();
  const snap = await db.collection(COLLECTIONS.blocklist).where('type', '==', type).where('valueHash', '==', valueHash).where('active', '==', true).limit(1).get();
  if (snap.empty) return false;
  const entry = snap.docs[0]!.data();
  const expiresAt = entry.expiresAt as Timestamp | null;
  return !expiresAt || expiresAt.toMillis() > now.toMillis();
}
