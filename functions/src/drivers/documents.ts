// Justificatifs (KYC, véhicule) du livreur.
// Le fichier est déposé dans Storage (drivers/{uid}/private/documents/…) par l'app
// livreur (autorisé par firebase/rules/storage/files.rules, `isSelf`) ; cette fonction
// vérifie l'objet et enregistre la pièce pour vérification, sur le modèle exact de
// functions/src/restaurant/documents.ts (uploadDocument), sans le réinventer.
import { COLLECTIONS, STORAGE_PATHS, type Driver, type PartnerDocument } from '@golink/shared';
import { db, storage, Timestamp } from '../lib/admin';
import { actorFromCaller, writeAudit } from '../lib/audit';
import { callable } from '../lib/callable';
import { fail } from '../lib/errors';
import { requireAuth } from '../lib/permissions';
import { CONFIG_FUNCTION_OPTIONS } from '../restaurant/config-context';
import { z, zId } from '../lib/validation';

/** Pièces demandées à un livreur (le contrôle véhicule ne s'applique qu'aux motorisés, filtré côté app). */
export const DRIVER_DOCUMENT_TYPES = [
  'identity',
  'residence_permit',
  'work_permit',
  'siret_registration',
  'urssaf_certificate',
  'insurance',
  'driving_license',
  'vehicle_registration',
  'other',
] as const;

const ACCEPTED_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic'];
const MAX_SIZE = 10 * 1024 * 1024;

const uploadSchema = z.object({
  driverId: zId,
  type: z.enum(DRIVER_DOCUMENT_TYPES),
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

export const uploadDriverDocument = callable(uploadSchema, async (data, request) => {
  const caller = requireAuth(request);
  if (caller.uid !== data.driverId) throw fail.forbidden('Vous ne pouvez déposer un justificatif que pour votre propre dossier.');

  const driverSnap = await db.collection(COLLECTIONS.drivers).doc(data.driverId).get();
  if (!driverSnap.exists) throw fail.notFound('Livreur');
  const driver = driverSnap.data() as Driver;

  const prefix = `${STORAGE_PATHS.driverPrivate(data.driverId)}/documents/`;
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
    ownerType: 'driver',
    ownerId: data.driverId,
    countryId: driver.countryId,
    cityId: driver.cityId,
    type: data.type,
    file: {
      path: data.storagePath,
      url: null,
      contentType,
      size,
      name: data.fileName,
      uploadedAt: now,
      uploadedBy: caller.uid,
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
    createdBy: caller.uid,
    updatedAt: now,
    updatedBy: caller.uid,
  };
  await ref.set(document);

  await writeAudit({
    actor: actorFromCaller(caller, 'driver'),
    action: 'document.submitted',
    target: { type: 'document', id: ref.id, label: `${driver.displayName} · ${data.type}` },
    after: { type: data.type, driverId: data.driverId, expiresAt: data.expiresAt },
    countryId: driver.countryId,
    cityId: driver.cityId,
    request,
  });
  return { documentId: ref.id };
},
  CONFIG_FUNCTION_OPTIONS,
);
