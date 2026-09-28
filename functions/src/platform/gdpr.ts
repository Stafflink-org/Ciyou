// Légal et RGPD (cahier §29) : versions des CGU/CGV par public avec ré-acceptation,
// demandes d'exercice de droits (délai légal d'un mois), suppression/anonymisation en
// conservant les obligations légales, durées de conservation avec anonymisation
// planifiée, signalements de contenus.
import {
  CONSENT_KEYS,
  COLLECTIONS,
  LEGAL_DOCUMENT_TYPES,
  RESTAURANT_PRIVATE_DOCS,
  SETTINGS_DOCS,
  SUBCOLLECTIONS,
  type ConsentKey,
  type GdprRequest,
  type LegalAcceptance,
  type RetentionRunSummary,
  type UserProfile,
} from '@golink/shared';
import { logger } from 'firebase-functions/v2';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { eraseCustomerAccount } from '../admin/acteurs/customers';
import { auth, db, FieldValue, storage, Timestamp } from '../lib/admin';
import { actorFromCaller, writeAudit } from '../lib/audit';
import { fail } from '../lib/errors';
import { currentPublishedLegalDocument } from '../lib/legal';
import { requireAuth, requireRestaurantAccess } from '../lib/permissions';
import { z, zEmail, zId, zReason } from '../lib/validation';
import { PLATFORM_SCHEDULE_RUNTIME, TIMEZONE, platformCallable, recordSettingsChange, requireSecureAdmin } from './runtime';

const DAY_MS = 86_400_000;

// ------------------------------------------------------------------ Documents légaux

export const saveLegalDocument = platformCallable(
  z.object({
    documentId: zId.nullish(),
    type: z.enum(['terms_client', 'terms_sale', 'terms_restaurant', 'terms_driver', 'privacy_policy', 'cookie_policy', 'legal_notice']),
    countryId: zId,
    version: z.string().trim().min(1).max(20),
    title: z.string().trim().min(2).max(200),
    content: z.string().trim().min(20).max(200_000),
    status: z.enum(['draft', 'published', 'archived']),
    effectiveAt: z.number().int().nullable(),
    requiresReacceptance: z.boolean(),
    changeSummary: z.string().trim().max(500).nullable(),
    reason: zReason,
  }),
  async (data, request) => {
    const { caller } = await requireSecureAdmin(request, 'legal.edit');
    const ref = data.documentId ? db.collection(COLLECTIONS.legalDocuments).doc(data.documentId) : db.collection(COLLECTIONS.legalDocuments).doc();
    const snap = await ref.get();
    const before = (snap.data() ?? null) as Record<string, unknown> | null;
    if (before && before.status === 'published' && data.status === 'draft') throw fail.invalid('Un document publié ne peut pas repasser en brouillon : archivez-le plutôt.');
    // Une version publiée est figée (§29) : seuls le statut, l'échéance et le résumé de changement restent modifiables ; toute évolution de contenu se fait par une nouvelle version.
    if (before?.status === 'published' && (before.title as { fr?: string } | undefined)?.fr !== data.title) throw fail.invalid('Le titre d’une version publiée ne peut plus être modifié : créez une nouvelle version.');
    if (before?.status === 'published' && (before.content as { fr?: string } | undefined)?.fr !== data.content) throw fail.invalid('Le contenu d’une version publiée ne peut plus être modifié : créez une nouvelle version.');
    if (before?.status === 'published' && before.version !== data.version) throw fail.invalid('Le numéro d’une version publiée ne peut plus être modifié.');
    const next = {
      type: data.type,
      countryId: data.countryId,
      version: data.version,
      title: { fr: data.title },
      content: { fr: data.content },
      status: data.status,
      publishedAt: data.status === 'published' ? (before?.publishedAt ?? Timestamp.now()) : (before?.publishedAt ?? null),
      effectiveAt: data.effectiveAt ? Timestamp.fromMillis(data.effectiveAt) : null,
      requiresReacceptance: data.requiresReacceptance,
      changeSummary: data.changeSummary,
    };
    const change = await recordSettingsChange({ docPath: `${COLLECTIONS.legalDocuments}/${ref.id}`, before, after: next, reason: data.reason, caller });
    await ref.set({ ...next, updatedAt: FieldValue.serverTimestamp(), updatedBy: caller.uid, createdAt: before?.createdAt ?? FieldValue.serverTimestamp(), createdBy: before?.createdBy ?? caller.uid }, { merge: true });
    await writeAudit({
      actor: actorFromCaller(caller, 'admin'),
      action: data.documentId ? 'legal_document.updated' : 'legal_document.created',
      target: { type: 'other', id: ref.id, label: `${data.type} ${data.countryId} v${data.version}` },
      reason: data.reason,
      before: change.before,
      after: change.after,
      request,
    });
    return { documentId: ref.id };
  },
);

// ------------------------------------------------------------------ Demandes RGPD

const GDPR_DEADLINE_DAYS = 30;

export const receiveGdprRequest = platformCallable(
  z.object({
    type: z.enum(['access', 'portability', 'rectification', 'erasure', 'objection']),
    subjectType: z.enum(['client', 'restaurant', 'driver']),
    subjectId: zId.nullish(),
    email: zEmail,
    notes: z.string().trim().max(1000).nullable(),
    /** Motif de l'enregistrement (origine de la demande : courrier, appel, e-mail…). */
    reason: zReason,
  }),
  async (data, request) => {
    const { caller } = await requireSecureAdmin(request, 'gdpr.handle');
    const now = Timestamp.now();
    const ref = db.collection(COLLECTIONS.gdprRequests).doc();
    const record: Omit<GdprRequest, 'createdAt' | 'updatedAt'> = {
      type: data.type,
      subjectType: data.subjectType,
      subjectId: data.subjectId ?? null,
      email: data.email,
      status: 'received',
      receivedAt: now,
      dueAt: Timestamp.fromMillis(now.toMillis() + GDPR_DEADLINE_DAYS * DAY_MS),
      completedAt: null,
      assigneeId: caller.uid,
      export: null,
      retainedData: [],
      notes: data.notes,
      createdBy: caller.uid,
      updatedBy: caller.uid,
    };
    await ref.set({ ...record, createdAt: now, updatedAt: now });
    await writeAudit({
      actor: actorFromCaller(caller, 'admin'),
      action: 'gdpr_request.received',
      target: { type: data.subjectType, id: data.subjectId ?? data.email, label: data.email },
      reason: data.reason,
      sensitive: true,
      request,
    });
    return { requestId: ref.id, dueAt: record.dueAt.toMillis() };
  },
);

/**
 * Dépôt d'une demande RGPD par la personne elle-même (et non par l'équipe support) :
 * un commerce authentifié pour son propre établissement, ou tout compte authentifié
 * pour ses propres données. Une seule demande ouverte à la fois par sujet.
 */
export const submitGdprRequest = platformCallable(
  z.object({
    type: z.enum(['access', 'portability', 'rectification', 'erasure', 'objection']),
    /** Renseigné pour une demande déposée par un commerce, pour son propre établissement. */
    restaurantId: zId.nullish(),
    notes: z.string().trim().max(1000).nullable(),
  }),
  async (data, request) => {
    const caller = requireAuth(request);
    let subjectType: GdprRequest['subjectType'];
    let subjectId: string;
    let email: string;
    if (data.restaurantId) {
      await requireRestaurantAccess(request, data.restaurantId, 'settings.manage');
      subjectType = 'restaurant';
      subjectId = data.restaurantId;
      const restaurant = await db.collection(COLLECTIONS.restaurants).doc(data.restaurantId).get();
      email = (restaurant.data()?.email as string | undefined) ?? caller.email ?? '';
    } else if (caller.claims.role === 'driver') {
      subjectType = 'driver';
      subjectId = caller.uid;
      email = caller.email ?? '';
    } else {
      subjectType = 'client';
      subjectId = caller.uid;
      email = caller.email ?? '';
    }
    const open = await db
      .collection(COLLECTIONS.gdprRequests)
      .where('subjectId', '==', subjectId)
      .where('status', 'in', ['received', 'identity_check', 'in_progress'])
      .limit(1)
      .get();
    if (!open.empty) throw fail.invalid('Une demande est déjà en cours de traitement pour ce compte.');
    const now = Timestamp.now();
    const ref = db.collection(COLLECTIONS.gdprRequests).doc();
    const record: Omit<GdprRequest, 'createdAt' | 'updatedAt'> = {
      type: data.type,
      subjectType,
      subjectId,
      email,
      status: 'received',
      receivedAt: now,
      dueAt: Timestamp.fromMillis(now.toMillis() + GDPR_DEADLINE_DAYS * DAY_MS),
      completedAt: null,
      assigneeId: null,
      export: null,
      retainedData: [],
      notes: data.notes,
      createdBy: caller.uid,
      updatedBy: caller.uid,
    };
    await ref.set({ ...record, createdAt: now, updatedAt: now });
    await writeAudit({
      actor: actorFromCaller(caller),
      action: 'gdpr_request.submitted',
      target: { type: subjectType, id: subjectId, label: email },
      reason: 'Demande déposée par la personne elle-même (auto-service)',
      sensitive: true,
      request,
    });
    return { requestId: ref.id, dueAt: record.dueAt.toMillis() };
  },
);

async function collectPersonalData(subjectType: GdprRequest['subjectType'], subjectId: string): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  if (subjectType === 'client') {
    const user = await db.collection(COLLECTIONS.users).doc(subjectId).get();
    out.profile = user.data() ?? null;
    const orders = await db.collection(COLLECTIONS.orders).where('customerId', '==', subjectId).limit(500).get();
    out.orders = orders.docs.map((d) => ({ id: d.id, ...d.data() }));
  } else if (subjectType === 'driver') {
    const driver = await db.collection(COLLECTIONS.drivers).doc(subjectId).get();
    out.profile = driver.data() ?? null;
  } else {
    const restaurant = await db.collection(COLLECTIONS.restaurants).doc(subjectId).get();
    out.profile = restaurant.data() ?? null;
  }
  return out;
}

const RETAINED_FOR_LEGAL = ['Factures et écritures comptables (10 ans)', 'Historique des commandes livrées (litiges, 5 ans)'];

export const handleGdprRequest = platformCallable(
  z.object({
    requestId: zId,
    status: z.enum(['identity_check', 'in_progress', 'completed', 'rejected']),
    note: z.string().trim().max(1000).nullable(),
  }),
  async (data, request) => {
    const { caller } = await requireSecureAdmin(request, 'gdpr.handle');
    const ref = db.collection(COLLECTIONS.gdprRequests).doc(data.requestId);
    const snap = await ref.get();
    if (!snap.exists) throw fail.notFound('Demande RGPD');
    const gdprRequest = snap.data() as GdprRequest;

    let exportFile: GdprRequest['export'] = gdprRequest.export ?? null;
    let retainedData = gdprRequest.retainedData;

    if (data.status === 'completed' && (gdprRequest.type === 'access' || gdprRequest.type === 'portability') && gdprRequest.subjectId) {
      const payload = await collectPersonalData(gdprRequest.subjectType, gdprRequest.subjectId);
      const path = `gdpr-exports/${ref.id}.json`;
      await storage.bucket().file(path).save(Buffer.from(JSON.stringify(payload, null, 2)), { contentType: 'application/json' });
      exportFile = { path, contentType: 'application/json', size: Buffer.byteLength(JSON.stringify(payload)), name: `export-${gdprRequest.subjectType}-${ref.id}.json`, uploadedAt: Timestamp.now(), uploadedBy: caller.uid };
    }

    if (data.status === 'completed' && gdprRequest.type === 'erasure' && gdprRequest.subjectId) {
      retainedData = RETAINED_FOR_LEGAL;
      if (gdprRequest.subjectType === 'client') {
        // Moteur d'effacement complet (commandes/avis/tickets anonymisés, sous-collections
        // supprimées, compte Auth supprimé) : le même que « Supprimer le compte » côté fiche client.
        await eraseCustomerAccount({
          userId: gdprRequest.subjectId,
          reason: data.note ?? 'Demande RGPD',
          actorUid: caller.uid,
          auditActor: actorFromCaller(caller, 'admin'),
          gdprRequestId: ref.id,
          request,
        });
      } else if (gdprRequest.subjectType === 'restaurant') {
        // Pas de fermeture définitive automatique du commerce (décision opérationnelle à part) :
        // seules les données personnelles du dossier légal sont anonymisées.
        const legalRef = db.collection(COLLECTIONS.restaurants).doc(gdprRequest.subjectId).collection(SUBCOLLECTIONS.restaurants.private).doc(RESTAURANT_PRIVATE_DOCS.legal);
        await legalRef.set({ managerName: 'Gérant supprimé', managerEmail: null, managerPhone: null, anonymizedAt: FieldValue.serverTimestamp() }, { merge: true }).catch(() => undefined);
      } else if (gdprRequest.subjectType === 'driver') {
        const driverRef = db.collection(COLLECTIONS.drivers).doc(gdprRequest.subjectId);
        await driverRef.set({ displayName: 'Livreur supprimé', email: null, phone: 'anonymise', avatar: null, anonymizedAt: FieldValue.serverTimestamp() }, { merge: true }).catch(() => undefined);
        try {
          await auth.updateUser(gdprRequest.subjectId, { disabled: true });
        } catch (error) {
          logger.warn('Désactivation du compte livreur impossible', { subjectId: gdprRequest.subjectId, error: String(error) });
        }
      }
    }

    await ref.update({
      status: data.status,
      completedAt: data.status === 'completed' || data.status === 'rejected' ? FieldValue.serverTimestamp() : null,
      notes: data.note ?? gdprRequest.notes ?? null,
      export: exportFile,
      retainedData,
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: caller.uid,
    });
    await writeAudit({
      actor: actorFromCaller(caller, 'admin'),
      action: `gdpr_request.${data.status}`,
      target: { type: gdprRequest.subjectType, id: gdprRequest.subjectId ?? gdprRequest.email, label: gdprRequest.email },
      reason: data.note,
      sensitive: true,
      request,
    });
    return { status: data.status };
  },
);

// ------------------------------------------------------------------ Signalements de contenus

export const reportContent = platformCallable(
  z.object({
    entityType: z.enum(['review', 'product', 'restaurant', 'photo']),
    entityId: zId,
    reason: zReason,
  }),
  async (data, request) => {
    const { caller } = await requireSecureAdmin(request);
    const ref = db.collection('contentReports').doc();
    await ref.set({ entityType: data.entityType, entityId: data.entityId, reason: data.reason, status: 'open', createdAt: FieldValue.serverTimestamp(), createdBy: caller.uid });
    await writeAudit({ actor: actorFromCaller(caller, 'admin'), action: 'content.reported', target: { type: 'other', id: data.entityId, label: data.entityType }, reason: data.reason, request });
    return { reportId: ref.id };
  },
);

// ------------------------------------------------------------------ Acceptations et consentements (§29)

/** Un client, un livreur ou un commerce accepte la version en vigueur d'un document (CGU/CGV, confidentialité...). */
export const acceptLegalDocument = platformCallable(
  z.object({ documentType: z.enum(LEGAL_DOCUMENT_TYPES), countryId: zId }),
  async (data, request) => {
    const caller = requireAuth(request);
    const doc = await currentPublishedLegalDocument(data.documentType, data.countryId);
    if (!doc) throw fail.notFound('Document légal en vigueur');
    const now = Timestamp.now();
    const userRef = db.collection(COLLECTIONS.users).doc(caller.uid);
    const userSnap = await userRef.get();
    const profile = userSnap.data() as UserProfile | undefined;
    const userType: LegalAcceptance['userType'] = profile?.role === 'restaurant' ? 'restaurant' : profile?.role === 'driver' ? 'driver' : 'client';
    const acceptance: LegalAcceptance = {
      userId: caller.uid,
      userType,
      documentId: doc.id,
      documentType: data.documentType,
      version: doc.version,
      acceptedAt: now,
      ipHash: null,
      userAgent: request.rawRequest.get('user-agent')?.slice(0, 300) ?? null,
      signatureName: caller.name,
    };
    await db.collection(COLLECTIONS.legalAcceptances).add(acceptance);
    await userRef.set({ acceptedLegal: { [data.documentType]: doc.version }, updatedAt: now }, { merge: true });
    await writeAudit({
      actor: actorFromCaller(caller, userType === 'client' ? 'client' : userType === 'driver' ? 'driver' : 'restaurant'),
      action: 'legal_document.accepted',
      target: { type: 'other', id: doc.id, label: `${data.documentType} v${doc.version}` },
      after: { documentType: data.documentType, version: doc.version },
      request,
    });
    return { accepted: true, version: doc.version };
  },
);

/** Consentement marketing/cookies (§29) : journalisé par utilisateur, jamais écrit directement par le client. */
export const setConsent = platformCallable(
  z.object({ key: z.enum(CONSENT_KEYS), granted: z.boolean() }),
  async (data, request) => {
    const caller = requireAuth(request);
    const now = Timestamp.now();
    const userRef = db.collection(COLLECTIONS.users).doc(caller.uid);
    await userRef.set({ consents: { [data.key]: data.granted }, updatedAt: now }, { merge: true });
    await userRef.collection('consents').add({
      key: data.key as ConsentKey,
      granted: data.granted,
      at: now,
      ipHash: null,
      userAgent: request.rawRequest.get('user-agent')?.slice(0, 300) ?? null,
    });
    return { key: data.key, granted: data.granted };
  },
);

// ------------------------------------------------------------------ Conservation et anonymisation planifiée

export const anonymizeExpiredData = onSchedule(
  { schedule: '0 4 * * *', timeZone: TIMEZONE, ...PLATFORM_SCHEDULE_RUNTIME, timeoutSeconds: 300, memory: '512MiB' },
  async () => {
    const settingsSnap = await db.collection(COLLECTIONS.settings).doc(SETTINGS_DOCS.retention).get();
    const settings = (settingsSnap.data() as Record<string, unknown> | undefined) ?? {};
    // Active par défaut (obligation légale, §29) : seul un réglage explicite à `false` la désactive.
    if (settings.autoAnonymize === false) {
      logger.info('Anonymisation planifiée désactivée par réglage explicite');
      return;
    }
    const now = Date.now();
    const summary: RetentionRunSummary = { dryRun: false, inactiveAccounts: 0, ordersAnonymized: 0, driverLocationsDeleted: 0, trashPurged: 0, at: now };

    const inactiveMonths = Number(settings.inactiveAccountMonths ?? 24);
    const inactiveCutoff = Timestamp.fromMillis(now - inactiveMonths * 30 * DAY_MS);
    // Champ réel du profil client : stats.lastOrderAt (voir models/users, index.json).
    const inactiveUsers = await db.collection(COLLECTIONS.users).where('stats.lastOrderAt', '<', inactiveCutoff).limit(200).get();
    for (const doc of inactiveUsers.docs) {
      if (doc.get('anonymizedAt')) continue;
      await doc.ref.set({ displayName: 'Client inactif', email: null, phone: null, anonymizedAt: Timestamp.now() }, { merge: true });
      summary.inactiveAccounts += 1;
    }

    const ordersMonths = Number(settings.anonymizeOrdersAfterMonths ?? 36);
    const ordersCutoff = Timestamp.fromMillis(now - ordersMonths * 30 * DAY_MS);
    // Filtrage en mémoire (pas d'index composite dédié) : le volume à cette échéance
    // reste faible et cette tâche tourne une fois par nuit.
    const oldOrders = await db.collection(COLLECTIONS.orders).where('createdAt', '<', ordersCutoff).limit(300).get();
    for (const doc of oldOrders.docs) {
      if (doc.get('anonymized') === true) continue;
      await doc.ref.set({ customerName: 'Client anonymisé', deliveryAddress: null, anonymized: true }, { merge: true });
      summary.ordersAnonymized += 1;
    }

    // Remarque : la plateforme ne conserve pas aujourd'hui d'historique de position des
    // livreurs dans une sous-collection dédiée (seule la position courante est stockée
    // sur la fiche livreur) ; ce compteur reste à 0 tant qu'un tel historique n'existe pas.

    // `purgeAt` est déjà l'échéance calculée par `moveToTrash` (dépôt + délai) : comparer
    // directement à maintenant, sans soustraire une seconde fois le délai (sinon la
    // corbeille n'est jamais purgée avant le double du délai réglé).
    const oldTrash = await db.collection(COLLECTIONS.trash).where('purgeAt', '<=', Timestamp.fromMillis(now)).where('restoredAt', '==', null).limit(300).get();
    if (!oldTrash.empty) {
      const batch = db.batch();
      for (const doc of oldTrash.docs) batch.delete(doc.ref);
      await batch.commit();
      summary.trashPurged = oldTrash.size;
    }

    // Journal d'audit : conservé `keepAuditLogsYears` (réglable), au-delà purgé (aucune obligation de conservation illimitée).
    const auditYears = Number(settings.keepAuditLogsYears ?? 3);
    const auditCutoff = Timestamp.fromMillis(now - auditYears * 365 * DAY_MS);
    const oldAuditLogs = await db.collection(COLLECTIONS.auditLogs).where('at', '<', auditCutoff).limit(300).get();
    if (!oldAuditLogs.empty) {
      const batch = db.batch();
      for (const doc of oldAuditLogs.docs) batch.delete(doc.ref);
      await batch.commit();
    }

    await db.collection(COLLECTIONS.settings).doc(SETTINGS_DOCS.retention).set({ lastRunAt: Timestamp.now(), lastRunSummary: summary }, { merge: true });
    logger.info('Anonymisation planifiée exécutée', summary);
  },
);

/** Aperçu manuel (sans écrire) du volume concerné par la prochaine anonymisation. */
export const previewRetentionRun = platformCallable(z.object({}).optional(), async (_data, request) => {
  await requireSecureAdmin(request, 'legal.edit');
  const settingsSnap = await db.collection(COLLECTIONS.settings).doc(SETTINGS_DOCS.retention).get();
  const settings = settingsSnap.data() as Record<string, unknown> | undefined;
  const now = Date.now();
  const inactiveCutoff = Timestamp.fromMillis(now - Number(settings?.inactiveAccountMonths ?? 24) * 30 * DAY_MS);
  const inactiveUsers = await db.collection(COLLECTIONS.users).where('stats.lastOrderAt', '<', inactiveCutoff).count().get();
  const trashCount = await db.collection(COLLECTIONS.trash).where('purgeAt', '<=', Timestamp.fromMillis(now)).where('restoredAt', '==', null).count().get();
  return { inactiveAccounts: inactiveUsers.data().count, trashToPurge: trashCount.data().count };
});
