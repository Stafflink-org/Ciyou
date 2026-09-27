// Conformité des livreurs : état des documents obligatoires, blocage et déblocage
// automatiques (documents expirés), recalcul de la date de validité du dossier.
import {
  COLLECTIONS,
  driverDocumentRequirements,
  type Driver,
  type PartnerDocument,
  type PartnerDocumentType,
} from '@golink/shared';
import { db, FieldValue, Timestamp } from '../../lib/admin';

export interface DriverDocumentState {
  /** Pièces obligatoires sans document validé en cours de validité. */
  missing: PartnerDocumentType[];
  /** Pièces obligatoires dont le dernier document validé a expiré. */
  expired: PartnerDocumentType[];
  /** Première échéance parmi les pièces obligatoires validées (AAAA-MM-JJ). */
  validUntil: string | null;
  documents: Array<PartnerDocument & { id: string }>;
}

/** Évalue les documents d'un livreur par rapport aux pièces exigées. */
export async function evaluateDriverDocuments(driverId: string, driver: Pick<Driver, 'type' | 'vehicle'>, today: string): Promise<DriverDocumentState> {
  const snap = await db.collection(COLLECTIONS.partnerDocuments).where('ownerType', '==', 'driver').where('ownerId', '==', driverId).get();
  const documents = snap.docs.map((d) => ({ id: d.id, ...(d.data() as PartnerDocument) }));
  const missing: PartnerDocumentType[] = [];
  const expired: PartnerDocumentType[] = [];
  let validUntil: string | null = null;
  for (const requirement of driverDocumentRequirements(driver)) {
    if (!requirement.required) continue;
    const ofType = documents.filter((d) => d.type === requirement.type);
    const valid = ofType.filter((d) => d.status === 'approved' && (!d.expiresAt || d.expiresAt >= today));
    if (valid.length > 0) {
      const latest = valid.map((d) => d.expiresAt).filter((v): v is string => Boolean(v)).sort().pop() ?? null;
      if (latest && (!validUntil || latest < validUntil)) validUntil = latest;
      continue;
    }
    if (ofType.some((d) => d.status === 'expired' || (d.status === 'approved' && d.expiresAt && d.expiresAt < today))) expired.push(requirement.type);
    else missing.push(requirement.type);
  }
  return { missing, expired, validUntil, documents };
}

/**
 * Applique l'état documentaire au livreur : blocage automatique si une pièce
 * obligatoire a expiré, déblocage quand tout est de nouveau valide. Renvoie
 * `unblocked` si le livreur vient d'être réactivé.
 */
export async function applyDocumentState(
  driverId: string,
  driver: Driver,
  state: DriverDocumentState,
): Promise<{ blocked: boolean; unblocked: boolean }> {
  const ref = db.collection(COLLECTIONS.drivers).doc(driverId);
  const update: Record<string, unknown> = { documentsValidUntil: state.validUntil };
  let blocked = false;
  let unblocked = false;
  if (driver.status === 'active' && state.expired.length > 0) {
    blocked = true;
    Object.assign(update, {
      status: 'suspended',
      availability: driver.activeOrderIds.length > 0 ? driver.availability : 'offline',
      blocked: {
        reason: 'documents_expired',
        since: Timestamp.now(),
        details: `Pièces expirées : ${state.expired.join(', ')}`,
        documentIds: state.documents.filter((d) => state.expired.includes(d.type)).map((d) => d.id),
      },
    });
  } else if (driver.status === 'suspended' && driver.blocked?.reason === 'documents_expired' && state.expired.length === 0 && state.missing.length === 0) {
    unblocked = true;
    Object.assign(update, { status: 'active', blocked: null });
  }
  if (driver.status === 'onboarding') update.missingDocuments = state.missing;
  update.updatedAt = FieldValue.serverTimestamp();
  update.updatedBy = 'system';
  await ref.update(update);
  return { blocked, unblocked };
}
