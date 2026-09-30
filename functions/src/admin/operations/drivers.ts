// Gestion des livreurs par le super admin (cahier §6) : validation des inscriptions,
// revue des documents et des selfies, sanctions et contestations, actions groupées.
// Chaque décision est vérifiée côté serveur (permission, périmètre) et auditée.
import {
  COLLECTIONS,
  PARTNER_DOCUMENT_LABELS,
  PARTNER_DOCUMENT_TYPES,
  SANCTION_TYPE_LABELS,
  driverDocumentRequirements,
  type BulkResult,
  type DriverSanction,
  type IdentityCheck,
  type PartnerDocument,
  type ReviewDriverApplicationResult,
  type ReviewDriverDocumentResult,
  type StoredFile,
} from '@golink/shared';
import { callable } from '../../lib/callable';
import { db, FieldValue, storage, Timestamp } from '../../lib/admin';
import { actorFromCaller, writeAudit } from '../../lib/audit';
import { fail } from '../../lib/errors';
import { requireAdmin, requireAuth } from '../../lib/permissions';
import { EMAIL_SECRETS } from '../../lib/secrets';
import { z, zId, zReason } from '../../lib/validation';
import { auditDriver, loadDriverFor, notifyDriver, opsCallable, parisDay, type DriverWithRef } from './common';
import { applyDocumentState, evaluateDriverDocuments } from './compliance';
import { driverApprovedEmail, driverDocumentsMissingEmail, driverRejectedEmail, driverSanctionEmail } from './emails';

const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date attendue au format AAAA-MM-JJ');

// ------------------------------------------------------------------ Inscription

export const reviewDriverApplication = opsCallable(
  z.object({
    driverId: zId,
    decision: z.enum(['approve', 'request_documents', 'reject']),
    reason: z.string().trim().max(500).nullish(),
    missingDocuments: z.array(z.enum(PARTNER_DOCUMENT_TYPES)).max(12).nullish(),
  }),
  async (data, request): Promise<ReviewDriverApplicationResult> => {
    const { caller, admin } = await requireAdmin(request, 'drivers.validate');
    const driver = await loadDriverFor(admin, data.driverId);
    const d = driver.data;
    if (d.onboardingStatus === 'approved' && data.decision !== 'reject') throw fail.precondition('Ce livreur est déjà validé.');
    if (d.onboardingStatus === 'rejected') throw fail.precondition('Cette inscription a déjà été refusée.');
    const reason = data.reason?.trim() || null;
    // Motif obligatoire pour toute décision : transmis au livreur en cas de refus ou de demande de pièces, conservé dans le journal d'audit pour une validation.
    if (!reason || reason.length < 3) throw fail.invalid(data.decision === 'approve' ? 'Indiquez le motif de la validation (conservé dans le journal d’audit).' : 'Indiquez un motif : il est transmis au livreur.');

    const today = parisDay();
    const state = await evaluateDriverDocuments(driver.id, d, today);
    const before = { status: d.status, onboardingStatus: d.onboardingStatus };
    let after: ReviewDriverApplicationResult;
    const cityName = ((await db.collection(COLLECTIONS.cities).doc(d.cityId).get()).get('name') as string | undefined) ?? d.cityId;

    if (data.decision === 'approve') {
      const blocking = [...state.missing, ...state.expired];
      if (blocking.length > 0) {
        throw fail.precondition(`Documents obligatoires non validés : ${blocking.map((t) => PARTNER_DOCUMENT_LABELS[t]).join(', ')}.`);
      }
      after = { status: 'active', onboardingStatus: 'approved' };
      await driver.ref.update({
        ...after,
        rejectionReason: null,
        missingDocuments: [],
        documentsValidUntil: state.validUntil,
        blocked: null,
        reviewedBy: caller.uid,
        reviewedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: caller.uid,
      });
      await notifyDriver(driver, {
        title: 'Votre compte est validé',
        body: 'Passez « En ligne » dans l’application pour recevoir vos premières courses.',
        category: 'account',
        email: driverApprovedEmail(d.firstName, cityName),
        templateKey: 'driver_approved',
        message: { key: 'driver_approved', values: {}, dedupeKey: `${driver.id}-${Date.now()}` },
      });
    } else if (data.decision === 'request_documents') {
      const missing = data.missingDocuments?.length ? data.missingDocuments : [...state.missing, ...state.expired];
      if (missing.length === 0) throw fail.invalid('Sélectionnez au moins un document à demander.');
      after = { status: 'onboarding', onboardingStatus: 'documents_missing' };
      await driver.ref.update({
        ...after,
        missingDocuments: missing,
        rejectionReason: reason,
        reviewedBy: caller.uid,
        reviewedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: caller.uid,
      });
      await notifyDriver(driver, {
        title: 'Documents à compléter',
        body: `${reason} Pièces attendues : ${missing.map((t) => PARTNER_DOCUMENT_LABELS[t]).join(', ')}.`,
        category: 'document',
        email: driverDocumentsMissingEmail(d.firstName, missing, reason ?? ''),
        templateKey: 'driver_documents_missing',
      });
    } else {
      if (d.activeOrderIds.length > 0) throw fail.precondition('Ce livreur a une course en cours : réessayez après la livraison.');
      after = { status: 'deactivated', onboardingStatus: 'rejected' };
      await driver.ref.update({
        ...after,
        availability: 'offline',
        rejectionReason: reason,
        reviewedBy: caller.uid,
        reviewedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: caller.uid,
      });
      await notifyDriver(driver, {
        title: 'Inscription non retenue',
        body: reason ?? '',
        category: 'account',
        email: driverRejectedEmail(d.firstName, reason ?? ''),
        templateKey: 'driver_rejected',
      });
    }
    await auditDriver(caller, driver, `driver.application_${data.decision === 'approve' ? 'approved' : data.decision === 'reject' ? 'rejected' : 'documents_requested'}`, {
      reason,
      before,
      after: { ...after, missingDocuments: data.decision === 'request_documents' ? (data.missingDocuments ?? null) : null },
      request,
    });
    return after;
  },
  { secrets: EMAIL_SECRETS },
);

// ------------------------------------------------------------------ Documents

export const reviewDriverDocument = opsCallable(
  z.object({
    documentId: zId,
    decision: z.enum(['approve', 'reject']),
    reason: z.string().trim().max(500).nullish(),
    expiresAt: isoDay.nullish(),
  }),
  async (data, request): Promise<ReviewDriverDocumentResult> => {
    const { caller, admin } = await requireAdmin(request, 'drivers.validate');
    const ref = db.collection(COLLECTIONS.partnerDocuments).doc(data.documentId);
    const snap = await ref.get();
    if (!snap.exists) throw fail.notFound('Document');
    const doc = snap.data() as PartnerDocument;
    if (doc.ownerType !== 'driver') throw fail.precondition('Ce document n’appartient pas à un livreur.');
    const driver = await loadDriverFor(admin, doc.ownerId);
    const today = parisDay();
    const requirement = driverDocumentRequirements(driver.data).find((r) => r.type === doc.type);
    const reason = data.reason?.trim() || null;

    if (!reason || reason.length < 3) throw fail.invalid(data.decision === 'reject' ? 'Indiquez le motif du refus : il est transmis au livreur.' : 'Indiquez le motif de la validation du document (conservé dans le journal d’audit).');
    if (data.decision === 'reject') {
      // Motif vérifié ci-dessus.
    } else {
      const expiresAt = data.expiresAt ?? doc.expiresAt ?? null;
      if (requirement?.expires && !expiresAt) throw fail.invalid('Indiquez la date d’expiration relevée sur le document.');
      if (expiresAt && expiresAt < today) throw fail.invalid('Ce document est déjà expiré : refusez-le et demandez une version à jour.');
    }
    const status = data.decision === 'approve' ? 'approved' : 'rejected';
    await ref.update({
      status,
      expiresAt: data.decision === 'approve' ? (data.expiresAt ?? doc.expiresAt ?? null) : (doc.expiresAt ?? null),
      rejectionReason: data.decision === 'reject' ? reason : null,
      reviewedBy: caller.uid,
      reviewedAt: FieldValue.serverTimestamp(),
      remindersSent: 0,
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: caller.uid,
    });
    const fresh = (await driver.ref.get()).data() as DriverWithRef['data'];
    const state = await evaluateDriverDocuments(driver.id, fresh, today);
    const applied = await applyDocumentState(driver.id, fresh, state);
    if (data.decision === 'reject') {
      await notifyDriver(driver, {
        title: `${PARTNER_DOCUMENT_LABELS[doc.type]} refusé`,
        body: `${reason} Déposez une nouvelle version depuis l’application.`,
        category: 'document',
        templateKey: 'driver_document_rejected',
      });
    } else if (applied.unblocked) {
      await notifyDriver(driver, {
        title: 'Votre compte est réactivé',
        body: 'Vos documents sont à jour : les courses peuvent de nouveau vous être proposées.',
        category: 'account',
        templateKey: 'driver_unblocked',
      });
    }
    await auditDriver(caller, driver, `driver.document_${status}`, {
      reason,
      before: { documentId: data.documentId, type: doc.type, status: doc.status, expiresAt: doc.expiresAt ?? null },
      after: { documentId: data.documentId, type: doc.type, status, expiresAt: data.expiresAt ?? doc.expiresAt ?? null, driverUnblocked: applied.unblocked },
      request,
    });
    return { status, driverUnblocked: applied.unblocked };
  },
);

// ------------------------------------------------------------------ Vérification d'identité

export const reviewIdentityCheck = opsCallable(
  z.object({ checkId: zId, decision: z.enum(['pass', 'fail']), reason: z.string().trim().max(500).nullish() }),
  async (data, request): Promise<{ status: IdentityCheck['status'] }> => {
    const { caller, admin } = await requireAdmin(request, 'drivers.validate');
    const ref = db.collection(COLLECTIONS.identityChecks).doc(data.checkId);
    const snap = await ref.get();
    if (!snap.exists) throw fail.notFound('Contrôle d’identité');
    const check = snap.data() as IdentityCheck;
    if (check.status !== 'submitted') throw fail.precondition('Ce contrôle n’attend pas de décision.');
    const driver = await loadDriverFor(admin, check.driverId);
    const reason = data.reason?.trim() || null;
    if (data.decision === 'fail' && (!reason || reason.length < 3)) throw fail.invalid('Indiquez pourquoi le selfie ne correspond pas.');
    const status: IdentityCheck['status'] = data.decision === 'pass' ? 'passed' : 'failed';
    const now = Timestamp.now();
    await db.runTransaction(async (tx) => {
      const fresh = await tx.get(driver.ref);
      const d = fresh.data() as DriverWithRef['data'];
      tx.update(ref, { status, reviewedBy: caller.uid, reviewedAt: now, reviewNote: reason });
      if (data.decision === 'pass') {
        tx.update(driver.ref, { lastIdentityCheckAt: now, updatedAt: now, updatedBy: caller.uid });
      } else {
        tx.update(driver.ref, {
          status: 'suspended',
          availability: d.activeOrderIds.length > 0 ? d.availability : 'offline',
          blocked: { reason: 'identity_check_failed', since: now, details: reason, documentIds: [] },
          updatedAt: now,
          updatedBy: caller.uid,
        });
      }
    });
    if (data.decision === 'fail') {
      await notifyDriver(driver, {
        title: 'Vérification d’identité non concluante',
        body: 'Votre compte est suspendu le temps d’un échange avec notre équipe. Contactez le support depuis l’application.',
        category: 'account',
        templateKey: 'driver_identity_failed',
      });
    }
    await auditDriver(caller, driver, `driver.identity_check_${status}`, {
      reason,
      before: { checkId: data.checkId, status: check.status },
      after: { checkId: data.checkId, status },
      sensitive: data.decision === 'fail',
      request,
    });
    return { status };
  },
);

/**
 * Dépôt du selfie par le livreur pour un contrôle d'identité en attente (§6). Contrat
 * attendu de l'application livreur : documenté dans docs/CONTRATS_APPS_MOBILES.md.
 * Aucune similarité automatique n'est calculée (pas de service de reconnaissance faciale
 * dans ce projet) : le selfie est comparé visuellement par un agent à la pièce d'identité
 * validée (`reviewIdentityCheck`).
 */
export const submitIdentitySelfie = callable(
  z.object({
    checkId: zId,
    /** Chemin Storage du selfie déposé au préalable par l'application (`drivers/{driverId}/private/...`). */
    photoPath: z.string().trim().min(10).max(300),
  }),
  async (data, request): Promise<{ status: IdentityCheck['status'] }> => {
    const caller = requireAuth(request);
    const ref = db.collection(COLLECTIONS.identityChecks).doc(data.checkId);
    const snap = await ref.get();
    if (!snap.exists) throw fail.notFound('Contrôle d’identité');
    const check = snap.data() as IdentityCheck;
    if (check.driverId !== caller.uid) throw fail.forbidden();
    if (check.status !== 'requested') throw fail.precondition('Ce contrôle n’attend pas de photo.');
    const prefix = `drivers/${caller.uid}/private/`;
    if (!data.photoPath.startsWith(prefix) || data.photoPath.includes('..')) throw fail.invalid('Emplacement de photo invalide.');
    const file = storage.bucket().file(data.photoPath);
    const [exists] = await file.exists();
    if (!exists) throw fail.precondition('La photo n’a pas été reçue : recommencez son envoi.');
    const [metadata] = await file.getMetadata();
    const size = Number(metadata.size ?? 0);
    if (size <= 0 || size > 10 * 1024 * 1024) throw fail.invalid('Photo vide ou trop volumineuse (10 Mo au plus).');
    const now = Timestamp.now();
    const selfie: StoredFile = { path: data.photoPath, contentType: metadata.contentType ?? 'application/octet-stream', size, name: 'selfie', uploadedAt: now, uploadedBy: caller.uid };
    await ref.update({ status: 'submitted', selfie, submittedAt: now, matchScore: null });
    return { status: 'submitted' };
  },
);

export const requestIdentityChecks = opsCallable(
  z.object({ driverIds: z.array(zId).min(1).max(200), reason: zReason }),
  async (data, request): Promise<BulkResult> => {
    const { caller, admin } = await requireAdmin(request, 'drivers.validate');
    const result: BulkResult = { succeeded: 0, failed: 0, errors: [] };
    for (const id of [...new Set(data.driverIds)]) {
      try {
        const driver = await loadDriverFor(admin, id);
        if (driver.data.status !== 'active') throw fail.precondition('Livreur inactif.');
        const pending = await db.collection(COLLECTIONS.identityChecks).where('driverId', '==', id).where('status', 'in', ['requested', 'submitted']).limit(1).get();
        if (!pending.empty) throw fail.precondition('Un contrôle est déjà en cours.');
        await db.collection(COLLECTIONS.identityChecks).add({
          driverId: id,
          cityId: driver.data.cityId,
          requestedAt: FieldValue.serverTimestamp(),
          requestedBy: caller.uid,
          trigger: 'manual',
          selfie: null,
          status: 'requested',
          matchScore: null,
          reviewedBy: null,
          reviewedAt: null,
        });
        await notifyDriver(driver, {
          title: 'Vérification d’identité demandée',
          body: 'Prenez un selfie depuis l’application avant votre prochaine course.',
          category: 'account',
          templateKey: 'driver_identity_requested',
        });
        await auditDriver(caller, driver, 'driver.identity_check_requested', { reason: data.reason, request });
        result.succeeded += 1;
      } catch (error) {
        result.failed += 1;
        result.errors.push({ id, message: error instanceof Error ? error.message : String(error) });
      }
    }
    return result;
  },
);

// ------------------------------------------------------------------ Sanctions

/** Lève l'effet d'une sanction sur le profil (dans une transaction). */
function liftSanctionOnDriver(tx: FirebaseFirestore.Transaction, driver: DriverWithRef['data'], ref: FirebaseFirestore.DocumentReference, sanctionId: string, by: string): void {
  if (driver.activeSanctionId !== sanctionId) return;
  const documentsBlocked = driver.blocked?.reason === 'documents_expired' || driver.blocked?.reason === 'identity_check_failed';
  tx.update(ref, {
    activeSanctionId: null,
    ...(documentsBlocked ? {} : { status: driver.onboardingStatus === 'approved' ? 'active' : driver.status, blocked: null }),
    updatedAt: Timestamp.now(),
    updatedBy: by,
  });
}

export const sanctionDriver = opsCallable(
  z.object({
    driverIds: z.array(zId).min(1).max(200),
    type: z.enum(['warning', 'temporary_suspension', 'deactivation']),
    reason: zReason,
    details: z.string().trim().max(2000).nullish(),
    durationDays: z.number().int().min(1).max(90).nullish(),
  }),
  async (data, request): Promise<BulkResult> => {
    const { caller, admin } = await requireAdmin(request, 'drivers.sanction');
    if (data.type === 'temporary_suspension' && !data.durationDays) throw fail.invalid('Indiquez la durée de la suspension.');
    const result: BulkResult = { succeeded: 0, failed: 0, errors: [] };
    const now = Timestamp.now();
    // Un avertissement reste actif 30 jours (historique de conduite), une désactivation n'a pas de terme.
    const endsAt =
      data.type === 'temporary_suspension'
        ? Timestamp.fromMillis(now.toMillis() + (data.durationDays ?? 1) * 86_400_000)
        : data.type === 'warning'
          ? Timestamp.fromMillis(now.toMillis() + 30 * 86_400_000)
          : null;
    for (const id of [...new Set(data.driverIds)]) {
      try {
        const driver = await loadDriverFor(admin, id);
        const sanctionRef = db.collection(COLLECTIONS.driverSanctions).doc();
        await db.runTransaction(async (tx) => {
          const fresh = await tx.get(driver.ref);
          const d = fresh.data() as DriverWithRef['data'];
          if (data.type !== 'warning' && d.activeOrderIds.length > 0) {
            throw fail.precondition('Course en cours : réattribuez-la ou attendez la livraison.');
          }
          if (data.type !== 'warning' && d.status === 'deactivated') throw fail.precondition('Compte déjà désactivé.');
          const sanction: Omit<DriverSanction, 'createdAt' | 'updatedAt'> & { createdAt: Timestamp; updatedAt: Timestamp } = {
            driverId: id,
            type: data.type,
            reason: data.reason,
            details: data.details ?? null,
            status: 'active',
            startsAt: now,
            endsAt,
            contest: null,
            createdAt: now,
            createdBy: caller.uid,
            updatedAt: now,
            updatedBy: caller.uid,
          };
          tx.set(sanctionRef, { ...sanction, cityId: d.cityId, countryId: d.countryId, createdByName: caller.name });
          if (data.type !== 'warning') {
            tx.update(driver.ref, {
              status: data.type === 'deactivation' ? 'deactivated' : 'suspended',
              availability: 'offline',
              activeSanctionId: sanctionRef.id,
              blocked: d.blocked?.reason === 'documents_expired' || d.blocked?.reason === 'identity_check_failed' ? d.blocked : { reason: 'sanction', since: now, details: data.reason, documentIds: [] },
              updatedAt: now,
              updatedBy: caller.uid,
            });
          }
        });
        await notifyDriver(driver, {
          title: SANCTION_TYPE_LABELS[data.type],
          body: `${data.reason} Vous pouvez contester cette décision depuis l’application.`,
          category: 'account',
          email: driverSanctionEmail(driver.data.firstName, data.type, data.reason, data.type === 'temporary_suspension' && endsAt ? endsAt.toDate() : null),
          templateKey: `driver_sanction_${data.type}`,
        });
        await auditDriver(caller, driver, `driver.sanction_${data.type}`, {
          reason: data.reason,
          before: { status: driver.data.status },
          after: { sanctionId: sanctionRef.id, type: data.type, durationDays: data.durationDays ?? null },
          sensitive: data.type !== 'warning',
          request,
        });
        result.succeeded += 1;
      } catch (error) {
        result.failed += 1;
        result.errors.push({ id, message: error instanceof Error ? error.message : String(error) });
      }
    }
    return result;
  },
  { secrets: EMAIL_SECRETS },
);

export const decideSanctionContest = opsCallable(
  z.object({ sanctionId: zId, decision: z.enum(['upheld', 'overturned']), note: zReason }),
  async (data, request): Promise<{ status: DriverSanction['status'] }> => {
    const { caller, admin } = await requireAdmin(request, 'drivers.sanction');
    const ref = db.collection(COLLECTIONS.driverSanctions).doc(data.sanctionId);
    const snap = await ref.get();
    if (!snap.exists) throw fail.notFound('Sanction');
    const sanction = snap.data() as DriverSanction;
    if (sanction.status !== 'contested' || !sanction.contest) throw fail.precondition('Cette sanction n’est pas contestée.');
    const driver = await loadDriverFor(admin, sanction.driverId);
    const now = Timestamp.now();
    await db.runTransaction(async (tx) => {
      const fresh = await tx.get(driver.ref);
      const d = fresh.data() as DriverWithRef['data'];
      tx.update(ref, {
        status: data.decision,
        'contest.decision': data.decision,
        'contest.decidedBy': caller.uid,
        'contest.decidedAt': now,
        'contest.decisionNote': data.note,
        ...(data.decision === 'overturned' ? { endsAt: now } : {}),
        updatedAt: now,
        updatedBy: caller.uid,
      });
      if (data.decision === 'overturned') liftSanctionOnDriver(tx, d, driver.ref, data.sanctionId, caller.uid);
    });
    await notifyDriver(driver, {
      title: data.decision === 'overturned' ? 'Contestation acceptée' : 'Contestation rejetée',
      body: data.decision === 'overturned' ? `La sanction est annulée. ${data.note}` : `La sanction est maintenue. ${data.note}`,
      category: 'account',
      templateKey: `driver_contest_${data.decision}`,
    });
    await auditDriver(caller, driver, `driver.sanction_contest_${data.decision}`, {
      reason: data.note,
      before: { sanctionId: data.sanctionId, status: sanction.status },
      after: { sanctionId: data.sanctionId, status: data.decision },
      request,
    });
    return { status: data.decision };
  },
);

// ------------------------------------------------------------------ Actions groupées

export const bulkUpdateDrivers = opsCallable(
  z.object({
    driverIds: z.array(zId).min(1).max(300),
    action: z.enum(['activate', 'deactivate', 'message', 'set_cash', 'set_zones']),
    reason: zReason,
    message: z.object({ title: z.string().trim().min(2).max(80), body: z.string().trim().min(2).max(600) }).nullish(),
    acceptsCash: z.boolean().nullish(),
    zoneIds: z.array(zId).max(30).nullish(),
  }),
  async (data, request): Promise<BulkResult> => {
    const permission = data.action === 'message' ? 'drivers.view' : data.action === 'activate' || data.action === 'deactivate' ? 'drivers.sanction' : 'drivers.edit';
    const { caller, admin } = await requireAdmin(request, permission);
    // Cahier §6 « Actions groupées » (cdc-fix-residuals-3) : le message groupé échappait au
    // contrôle `drivers.bulk` (seul `drivers.view` était exigé) — un profil en lecture seule
    // pouvait notifier jusqu'à 300 livreurs. Corrigé : même contrôle que les autres actions
    // groupées dès plus d'un destinataire.
    if (data.driverIds.length > 1 && !admin.permissions.includes('drivers.bulk') && admin.role !== 'super_admin') {
      throw fail.forbidden('Les actions groupées sur les livreurs ne font pas partie de vos droits.');
    }
    if (data.action === 'message' && !data.message) throw fail.invalid('Rédigez le message à envoyer.');
    if (data.action === 'set_cash' && typeof data.acceptsCash !== 'boolean') throw fail.invalid('Choisissez d’autoriser ou non les espèces.');
    if (data.action === 'set_zones' && !data.zoneIds) throw fail.invalid('Choisissez les zones.');
    const zones = data.action === 'set_zones' ? await Promise.all((data.zoneIds ?? []).map((id) => db.collection(COLLECTIONS.zones).doc(id).get())) : [];
    const zoneCity = new Map(zones.filter((z) => z.exists).map((z) => [z.id, z.get('cityId') as string]));

    const result: BulkResult = { succeeded: 0, failed: 0, errors: [] };
    const now = Timestamp.now();
    for (const id of [...new Set(data.driverIds)]) {
      try {
        const driver = await loadDriverFor(admin, id);
        const d = driver.data;
        let before: Record<string, unknown> = {};
        let after: Record<string, unknown> = {};
        if (data.action === 'activate') {
          if (d.onboardingStatus !== 'approved') throw fail.precondition('Inscription non validée.');
          if (d.status === 'active') throw fail.precondition('Déjà actif.');
          const state = await evaluateDriverDocuments(id, d, parisDay());
          if (state.expired.length || state.missing.length) throw fail.precondition('Documents obligatoires non valides.');
          await db.runTransaction(async (tx) => {
            if (d.activeSanctionId) {
              const sRef = db.collection(COLLECTIONS.driverSanctions).doc(d.activeSanctionId);
              tx.update(sRef, { status: 'expired', endsAt: now, updatedAt: now, updatedBy: caller.uid, liftedEarly: true });
            }
            tx.update(driver.ref, { status: 'active', blocked: null, activeSanctionId: null, updatedAt: now, updatedBy: caller.uid });
          });
          before = { status: d.status, blocked: d.blocked?.reason ?? null };
          after = { status: 'active' };
          await notifyDriver(driver, { title: 'Compte réactivé', body: 'Les courses peuvent de nouveau vous être proposées.', category: 'account', templateKey: 'driver_reactivated' });
        } else if (data.action === 'deactivate') {
          if (d.status === 'deactivated') throw fail.precondition('Déjà désactivé.');
          if (d.activeOrderIds.length > 0) throw fail.precondition('Course en cours.');
          await driver.ref.update({ status: 'deactivated', availability: 'offline', updatedAt: now, updatedBy: caller.uid });
          before = { status: d.status };
          after = { status: 'deactivated' };
          await notifyDriver(driver, { title: 'Compte désactivé', body: data.reason, category: 'account', templateKey: 'driver_deactivated' });
        } else if (data.action === 'message') {
          const sent = await notifyDriver(driver, { title: data.message!.title, body: data.message!.body, category: 'announcement', templateKey: 'driver_message' });
          if (!sent.notified) throw fail.unavailable('Message non distribué.');
          after = { title: data.message!.title };
        } else if (data.action === 'set_cash') {
          // Décision du client : espèces uniquement avec un livreur salarié du commerce.
          if (data.acceptsCash && d.type !== 'restaurant') throw fail.precondition('Espèces réservées aux livreurs salariés d’un commerce.');
          await driver.ref.update({ acceptsCash: data.acceptsCash, updatedAt: now, updatedBy: caller.uid });
          before = { acceptsCash: d.acceptsCash };
          after = { acceptsCash: data.acceptsCash };
        } else {
          const zoneIds = (data.zoneIds ?? []).filter((zid) => zoneCity.get(zid) === d.cityId);
          if ((data.zoneIds ?? []).length > 0 && zoneIds.length === 0) throw fail.precondition('Aucune des zones choisies n’est dans la ville du livreur.');
          await driver.ref.update({ zoneIds, updatedAt: now, updatedBy: caller.uid });
          before = { zoneIds: d.zoneIds };
          after = { zoneIds };
        }
        await auditDriver(caller, driver, `driver.bulk_${data.action}`, { reason: data.reason, before, after, request });
        result.succeeded += 1;
      } catch (error) {
        result.failed += 1;
        result.errors.push({ id, message: error instanceof Error ? error.message : String(error) });
      }
    }
    return result;
  },
);

/**
 * Trace au journal d'audit l'export CSV des livreurs (cahier §6 « Actions groupées ») :
 * l'export lui-même reste généré côté navigateur (`exportDriversCsv`, colonnes déjà
 * masquées selon le rôle), mais jusqu'ici aucun droit ni aucune trace n'étaient exigés
 * pour une liste contenant des données personnelles — corrigé (cdc-fix-residuals-3).
 * Le bouton d'export n'est affiché côté client que si l'appelant a `exports.run`
 * (voir `apps/admin/src/features/livreurs/DriversPage.tsx`) ; ce contrôle est
 * revérifié ici côté serveur.
 */
export const auditDriversExport = opsCallable(
  z.object({ driverIds: z.array(zId).min(1).max(2000), reason: zReason }),
  async (data, request) => {
    const { caller } = await requireAdmin(request, 'exports.run');
    await writeAudit({
      actor: actorFromCaller(caller, 'admin'),
      action: 'driver.export',
      target: { type: 'other', id: `drivers-export-${Date.now()}`, label: `Export CSV livreurs (${data.driverIds.length})` },
      reason: data.reason,
      after: { count: data.driverIds.length, driverIds: data.driverIds.slice(0, 50) },
      sensitive: true,
      request,
    });
    return { ok: true as const };
  },
);

// ------------------------------------------------------------------ Fichiers justificatifs

/**
 * Lecture d'un justificatif ou d'un selfie privé d'un livreur (8 Mo au plus), pour
 * l'aperçu dans le super admin : droit de validation et périmètre vérifiés ici.
 */
export const getDriverFile = opsCallable(
  z.object({ path: z.string().trim().min(10).max(300).regex(/^drivers\/[A-Za-z0-9_-]+\/private\/[^/]+$/, 'Chemin de fichier invalide') }),
  async (data, request): Promise<{ contentType: string; dataBase64: string; name: string }> => {
    const { caller, admin } = await requireAdmin(request, 'drivers.validate');
    const driverId = data.path.split('/')[1]!;
    const driver = await loadDriverFor(admin, driverId);
    const file = storage.bucket().file(data.path);
    const [exists] = await file.exists();
    if (!exists) throw fail.notFound('Fichier');
    const [metadata] = await file.getMetadata();
    if (Number(metadata.size ?? 0) > 8 * 1024 * 1024) throw fail.precondition('Fichier trop volumineux pour l’aperçu.');
    const [buffer] = await file.download();
    // Consultation d'une pièce d'identité ou d'un justificatif : tracée (donnée personnelle sensible).
    await auditDriver(caller, driver, 'driver.file_viewed', { after: { file: data.path.split('/').pop() ?? null, contentType: metadata.contentType ?? null }, sensitive: true, request });
    return { contentType: metadata.contentType ?? 'application/octet-stream', dataBase64: buffer.toString('base64'), name: data.path.split('/').pop()! };
  },
);
