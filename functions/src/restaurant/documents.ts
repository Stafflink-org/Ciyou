// Justificatifs (KYC) et contrat partenaire du restaurant.
// Le fichier est déposé dans Storage (restaurants/{rid}/private/documents/…) par
// l'application ; uploadDocument vérifie l'objet et enregistre la pièce à valider.
import {
  COLLECTIONS,
  REQUIRED_RESTAURANT_DOCUMENTS,
  STORAGE_PATHS,
  type LegalAcceptance,
  type LegalDocument,
  type PartnerDocument,
  type Restaurant,
} from '@golink/shared';
import { createHash } from 'node:crypto';
import { logger } from 'firebase-functions/v2';
import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { db, storage, Timestamp } from '../lib/admin';
import { actorFromCaller, SYSTEM_ACTOR, writeAudit } from '../lib/audit';
import { callable } from '../lib/callable';
import { fail } from '../lib/errors';
import { requireRestaurantAccess } from '../lib/permissions';
import { z, zId } from '../lib/validation';
import { EMAIL_SECRETS } from '../lib/secrets';
import { tryAutoValidateRestaurant } from './auto-validation';
import { legalRef, loadRestaurant, restaurantRef, CONFIG_FUNCTION_OPTIONS, CONFIG_TRIGGER_OPTIONS } from './config-context';

/** Pièces demandées à un commerce (vente d'alcool interdite : aucune licence demandée). */
export const RESTAURANT_DOCUMENT_TYPES = ['kbis', 'siret_notice', 'manager_id', 'bank_details', 'hygiene_certificate', 'other'] as const;

const ACCEPTED_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic'];
const MAX_SIZE = 10 * 1024 * 1024;

const uploadSchema = z.object({
  restaurantId: zId,
  type: z.enum(RESTAURANT_DOCUMENT_TYPES),
  storagePath: z.string().trim().min(10).max(400),
  fileName: z.string().trim().min(1).max(160),
  number: z
    .string()
    .trim()
    .max(60)
    .nullish()
    .transform((v) => v || null),
  issuedAt: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullish()
    .transform((v) => v ?? null),
  expiresAt: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullish()
    .transform((v) => v ?? null),
});

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export const uploadDocument = callable(uploadSchema, async (data, request) => {
  const actor = await requireRestaurantAccess(request, data.restaurantId, 'settings.manage');
  const restaurant = await loadRestaurant(data.restaurantId);
  const prefix = `${STORAGE_PATHS.restaurantPrivate(data.restaurantId)}/documents/`;
  if (!data.storagePath.startsWith(prefix) || data.storagePath.includes('..')) {
    throw fail.invalid('Emplacement du fichier invalide.');
  }
  if (data.expiresAt && data.expiresAt <= today()) throw fail.invalid('Ce document est déjà expiré : déposez une version en cours de validité.');
  if (data.issuedAt && data.issuedAt > today()) throw fail.invalid('La date de délivrance ne peut pas être dans le futur.');

  const file = storage.bucket().file(data.storagePath);
  const [exists] = await file.exists();
  if (!exists) throw fail.precondition('Le fichier n’a pas été reçu. Recommencez le dépôt.');
  const [metadata] = await file.getMetadata();
  const size = Number(metadata.size ?? 0);
  const contentType = metadata.contentType ?? 'application/octet-stream';
  if (size <= 0 || size > MAX_SIZE) throw fail.invalid('Fichier vide ou trop volumineux (10 Mo au plus).');
  if (!ACCEPTED_TYPES.includes(contentType)) throw fail.invalid('Format non accepté : PDF, JPG, PNG, WEBP ou HEIC.');

  const already = await db.collection(COLLECTIONS.partnerDocuments).where('file.path', '==', data.storagePath).limit(1).get();
  if (!already.empty) throw fail.alreadyExists('Ce fichier a déjà été enregistré.');

  const now = Timestamp.now();
  const ref = db.collection(COLLECTIONS.partnerDocuments).doc();
  const document: PartnerDocument = {
    ownerType: 'restaurant',
    ownerId: data.restaurantId,
    countryId: restaurant.countryId,
    cityId: restaurant.cityId,
    type: data.type,
    file: {
      path: data.storagePath,
      url: null,
      contentType,
      size,
      name: data.fileName,
      uploadedAt: now,
      uploadedBy: actor.caller.uid,
    },
    status: 'pending',
    number: data.number,
    issuedAt: data.issuedAt,
    expiresAt: data.expiresAt,
    reviewedBy: null,
    reviewedAt: null,
    rejectionReason: null,
    remindersSent: 0,
    lastReminderAt: null,
    createdAt: now,
    createdBy: actor.caller.uid,
    updatedAt: now,
    updatedBy: actor.caller.uid,
  };
  await ref.set(document);

  await writeAudit({
    actor: actorFromCaller(actor.caller, actor.kind === 'admin' ? 'admin' : 'restaurant'),
    action: 'document.submitted',
    target: { type: 'document', id: ref.id, label: `${restaurant.name} · ${data.type}` },
    after: { type: data.type, restaurantId: data.restaurantId, expiresAt: data.expiresAt },
    countryId: restaurant.countryId,
    cityId: restaurant.cityId,
    request,
  });
  return { documentId: ref.id };
},
  CONFIG_FUNCTION_OPTIONS,
);

/**
 * Nouveau justificatif : si toutes les pièces indispensables sont déposées, un
 * dossier « documents manquants » repasse « en attente » de validation.
 */
export const onDocumentUploaded = onDocumentCreated({ document: `${COLLECTIONS.partnerDocuments}/{documentId}`, ...CONFIG_TRIGGER_OPTIONS, secrets: EMAIL_SECRETS }, async (event) => {
  const doc = event.data?.data() as PartnerDocument | undefined;
  if (!doc || doc.ownerType !== 'restaurant') return;
  const rRef = restaurantRef(doc.ownerId);
  const snap = await rRef.get();
  if (!snap.exists) return;
  const restaurant = snap.data() as Restaurant;
  if (restaurant.onboardingStatus !== 'documents_missing' && restaurant.onboardingStatus !== 'pending') return;

  const docs = await db
    .collection(COLLECTIONS.partnerDocuments)
    .where('ownerType', '==', 'restaurant')
    .where('ownerId', '==', doc.ownerId)
    .get();
  const provided = new Set(
    docs.docs.map((d) => d.data() as PartnerDocument).filter((d) => d.status === 'pending' || d.status === 'approved').map((d) => d.type),
  );
  // Pièces indispensables : chaque groupe (Kbis OU avis SIRET, identité, RIB) doit être représenté.
  if (!REQUIRED_RESTAURANT_DOCUMENTS.every((group) => group.types.some((type) => provided.has(type)))) return;

  if (restaurant.onboardingStatus === 'documents_missing') {
    await rRef.update({ onboardingStatus: 'pending', updatedAt: Timestamp.now(), updatedBy: 'system' });
    await writeAudit({
      actor: SYSTEM_ACTOR,
      action: 'restaurant.documents_completed',
      target: { type: 'restaurant', id: doc.ownerId, label: restaurant.name },
      before: { onboardingStatus: 'documents_missing' },
      after: { onboardingStatus: 'pending' },
      countryId: restaurant.countryId,
      cityId: restaurant.cityId,
    });
    logger.info('Dossier complet, en attente de validation', { restaurantId: doc.ownerId });
  }
  // Dossier complet : validation automatique si la règle est activée.
  await tryAutoValidateRestaurant(doc.ownerId, 'document').catch((error: unknown) =>
    logger.error('Validation automatique en échec', { restaurantId: doc.ownerId, error: error instanceof Error ? error.stack : String(error) }),
  );
});

// ------------------------------------------------------------------ Contrat partenaire

const contractSchema = z.object({
  restaurantId: zId,
  documentId: zId,
  signatureName: z.string().trim().min(3, 'Saisissez vos nom et prénom').max(80),
  accept: z.literal(true, { message: 'Cochez la case d’acceptation.' }),
});

export const acceptPartnerContract = callable(contractSchema, async (data, request) => {
  const actor = await requireRestaurantAccess(request, data.restaurantId, 'settings.manage');
  if (actor.kind !== 'member' || actor.member.role !== 'owner') {
    throw fail.forbidden('Seul le propriétaire (représentant légal) peut signer le contrat partenaire.');
  }
  const restaurant = await loadRestaurant(data.restaurantId);
  const legalDocSnap = await db.collection(COLLECTIONS.legalDocuments).doc(data.documentId).get();
  if (!legalDocSnap.exists) throw fail.notFound('Contrat');
  const legalDoc = legalDocSnap.data() as LegalDocument;
  if (legalDoc.type !== 'terms_restaurant' || legalDoc.status !== 'published') throw fail.precondition('Cette version du contrat n’est pas en vigueur.');
  if (legalDoc.countryId !== restaurant.countryId) throw fail.precondition('Ce contrat ne concerne pas le pays de votre établissement.');

  const raw = request.rawRequest;
  const now = Timestamp.now();
  const acceptanceId = `${data.documentId}_${data.restaurantId}_${actor.caller.uid}`;
  const acceptance: LegalAcceptance = {
    userId: actor.caller.uid,
    userType: 'restaurant',
    restaurantId: data.restaurantId,
    documentId: data.documentId,
    documentType: 'terms_restaurant',
    version: legalDoc.version,
    acceptedAt: now,
    ipHash: raw?.ip ? createHash('sha256').update(raw.ip).digest('hex').slice(0, 32) : null,
    userAgent: raw?.get('user-agent')?.slice(0, 300) ?? null,
    signatureName: data.signatureName,
  };
  const acceptanceRef = db.collection(COLLECTIONS.legalAcceptances).doc(acceptanceId);
  await db.runTransaction(async (tx) => {
    const existing = await tx.get(acceptanceRef);
    if (existing.exists) throw fail.alreadyExists('Vous avez déjà accepté cette version du contrat.');
    tx.set(acceptanceRef, acceptance);
    tx.set(
      legalRef(data.restaurantId),
      {
        partnerTermsVersion: legalDoc.version,
        partnerTermsAcceptedAt: now,
        partnerTermsDocumentId: data.documentId,
        partnerTermsAcceptedBy: actor.caller.uid,
        partnerTermsSignatureName: data.signatureName,
        updatedAt: now,
      },
      { merge: true },
    );
  });

  await tryAutoValidateRestaurant(data.restaurantId, 'contract').catch((error: unknown) =>
    logger.error('Validation automatique en échec', { restaurantId: data.restaurantId, error: error instanceof Error ? error.stack : String(error) }),
  );
  await writeAudit({
    actor: actorFromCaller(actor.caller, 'restaurant'),
    action: 'restaurant.partner_contract_accepted',
    target: { type: 'restaurant', id: data.restaurantId, label: restaurant.name },
    after: { documentId: data.documentId, version: legalDoc.version, signatureName: data.signatureName },
    countryId: restaurant.countryId,
    cityId: restaurant.cityId,
    sensitive: true,
    request,
  });
  return { version: legalDoc.version };
},
  { ...CONFIG_FUNCTION_OPTIONS, secrets: EMAIL_SECRETS },
);
