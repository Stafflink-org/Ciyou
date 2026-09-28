// Réacceptation forcée des CGU/CGV (§29) : compare la version acceptée par
// l'utilisateur à la version en vigueur ; bloque l'action si le document en vigueur
// exige une réacceptation et que l'utilisateur a déjà accepté une version antérieure.
// Un utilisateur qui n'a JAMAIS accepté (aucune application ne le lui a encore demandé)
// n'est pas bloqué : seule la RÉACCEPTATION après modification est imposée ici.
import { COLLECTIONS, type LegalDocument, type LegalDocumentType, type UserProfile } from '@golink/shared';
import { db } from './admin';
import { fail } from './errors';

export async function currentPublishedLegalDocument(type: LegalDocumentType, countryId: string): Promise<(LegalDocument & { id: string }) | null> {
  const snap = await db
    .collection(COLLECTIONS.legalDocuments)
    .where('type', '==', type)
    .where('countryId', '==', countryId)
    .where('status', '==', 'published')
    .orderBy('publishedAt', 'desc')
    .limit(1)
    .get();
  const doc = snap.docs[0];
  return doc ? ({ id: doc.id, ...(doc.data() as LegalDocument) }) : null;
}

export async function assertLegalReaccepted(profile: Pick<UserProfile, 'acceptedLegal'> | null, type: LegalDocumentType, countryId: string): Promise<void> {
  const doc = await currentPublishedLegalDocument(type, countryId);
  if (!doc || !doc.requiresReacceptance) return;
  const accepted = profile?.acceptedLegal?.[type];
  if (!accepted || accepted === doc.version) return;
  throw fail.precondition(`Les conditions ont été mises à jour (version ${doc.version}) : merci de les accepter à nouveau avant de continuer.`);
}
