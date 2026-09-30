// Justificatifs du restaurant et contrat partenaire : lectures partagées par la page et la pastille du menu.
import { useMemo } from 'react';
import { collection, orderBy, query, where } from 'firebase/firestore';
import {
  COLLECTIONS,
  REQUIRED_RESTAURANT_DOCUMENTS,
  RESTAURANT_PRIVATE_DOCS,
  paths,
  type GdprRequest,
  type LegalDocument,
  type PartnerDocument,
  type PartnerDocumentType,
  type RestaurantLegal,
  type WithId,
} from '@golink/shared';
import { useCan, useRestaurantAccess } from '@/auth/RestaurantAccess';
import { db } from '@/lib/firebase';
import { docAt, useCollection, useDoc } from '@/lib/firestore';

export interface DocumentRequirement {
  type: PartnerDocumentType;
  required: boolean;
  /** Clé du groupe de pièces alternatives (ex. Kbis OU avis SIRET) : une seule pièce du groupe suffit, aligné sur `REQUIRED_RESTAURANT_DOCUMENTS` côté serveur. */
  group?: string;
  /** Date d'expiration demandée au dépôt. */
  expires: boolean;
  /** Numéro demandé au dépôt. */
  number: boolean;
  hint: string;
}

/** Clé du groupe « pièce d'immatriculation » (Kbis ou avis SIRET), partagée par les deux pièces alternatives. */
const REGISTRATION_GROUP = REQUIRED_RESTAURANT_DOCUMENTS.find((g) => g.types.includes('kbis'))?.key ?? 'registration';

/** Pièces demandées, dans l'ordre d'affichage (vente d'alcool interdite : aucune licence). */
export function requirementsFor(): DocumentRequirement[] {
  return [
    { type: 'kbis', required: true, group: REGISTRATION_GROUP, expires: false, number: false, hint: 'Extrait de moins de 3 mois (ou avis de situation RCS au Luxembourg). Vous pouvez déposer l’avis de situation SIRET ci-dessous à la place.' },
    { type: 'manager_id', required: true, expires: true, number: false, hint: 'Carte d’identité ou passeport du représentant légal, recto verso.' },
    { type: 'bank_details', required: true, expires: false, number: false, hint: 'RIB au nom de la société, identique au compte de versement.' },
    { type: 'hygiene_certificate', required: false, expires: true, number: false, hint: 'Attestation de formation HACCP d’un membre de l’équipe.' },
    { type: 'siret_notice', required: true, group: REGISTRATION_GROUP, expires: false, number: false, hint: 'Avis de situation au répertoire SIRENE, accepté à la place de l’extrait Kbis.' },
  ];
}

/** Une pièce du groupe alternatif (ex. Kbis / avis SIRET) est satisfaite dès qu'une des pièces du même groupe est déposée et non rejetée/expirée/manquante — aligné sur `missingRequiredGroups` côté serveur (`functions/src/admin/acteurs/applications.ts`). */
export function requirementBlocking(rows: ReadonlyArray<{ req: DocumentRequirement; state: RequirementState }>, row: { req: DocumentRequirement; state: RequirementState }): boolean {
  if (!row.req.required || !['missing', 'rejected', 'expired'].includes(row.state)) return false;
  if (!row.req.group) return true;
  return !rows.some((r) => r.req.group === row.req.group && r.req.type !== row.req.type && ['approved', 'pending', 'expiring'].includes(r.state));
}

export type RequirementState = 'missing' | 'pending' | 'approved' | 'rejected' | 'expired' | 'expiring';

/** Justificatifs de l'établissement actif (du plus récent au plus ancien). */
export function usePartnerDocuments(enabled = true) {
  const { restaurantId } = useRestaurantAccess();
  return useCollection<PartnerDocument>(
    enabled
      ? query(
          collection(db, COLLECTIONS.partnerDocuments),
          where('ownerType', '==', 'restaurant'),
          where('ownerId', '==', restaurantId),
          orderBy('createdAt', 'desc'),
        )
      : null,
  );
}

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function daysUntil(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  const target = new Date(y, m - 1, d).getTime();
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  return Math.round((target - today) / 86_400_000);
}

/** État d'une pièce à partir de son dépôt le plus récent. */
export function requirementState(latest: WithId<PartnerDocument> | undefined): RequirementState {
  if (!latest) return 'missing';
  if (latest.status === 'expired' || (latest.expiresAt && latest.expiresAt < todayIso())) return 'expired';
  if (latest.status === 'rejected') return 'rejected';
  if (latest.status === 'pending') return 'pending';
  if (latest.expiresAt && daysUntil(latest.expiresAt) <= 30) return 'expiring';
  return 'approved';
}

/** Dernière version publiée du contrat partenaire du pays de l'établissement. */
export function usePartnerContract(enabled = true) {
  const { restaurant } = useRestaurantAccess();
  const docs = useCollection<LegalDocument>(
    enabled
      ? query(
          collection(db, COLLECTIONS.legalDocuments),
          where('type', '==', 'terms_restaurant'),
          where('countryId', '==', restaurant.countryId),
          where('status', '==', 'published'),
        )
      : null,
  );
  const latest = useMemo(
    () => [...docs.data].sort((a, b) => (b.publishedAt?.toMillis?.() ?? 0) - (a.publishedAt?.toMillis?.() ?? 0) || b.version.localeCompare(a.version))[0] ?? null,
    [docs.data],
  );
  return { latest, loading: docs.loading, error: docs.error };
}

export function useRestaurantLegal(enabled = true) {
  const { restaurantId } = useRestaurantAccess();
  return useDoc<RestaurantLegal>(enabled ? docAt(`${paths.restaurant(restaurantId)}/private/${RESTAURANT_PRIVATE_DOCS.legal}`) : null);
}

/** Demandes RGPD déposées par l'établissement lui-même (§29, auto-service), les plus récentes d'abord. */
export function useGdprRequests() {
  const { restaurantId } = useRestaurantAccess();
  return useCollection<GdprRequest>(
    query(
      collection(db, COLLECTIONS.gdprRequests),
      where('subjectType', '==', 'restaurant'),
      where('subjectId', '==', restaurantId),
      orderBy('receivedAt', 'desc'),
    ),
  );
}

/** Pièces à reprendre (manquantes, refusées, expirées) et contrat à signer : pastille du menu. */
export function useDocumentsBadge(): number | null {
  const can = useCan();
  const allowed = can('settings.manage');
  const docs = usePartnerDocuments(allowed);
  const contract = usePartnerContract(allowed);
  const legal = useRestaurantLegal(allowed);
  if (!allowed || docs.loading) return null;
  const rows = requirementsFor().map((req) => ({ req, state: requirementState(docs.data.find((d) => d.type === req.type)) }));
  const todo = rows.filter((row) => requirementBlocking(rows, row)).length;
  const unsigned = contract.latest && !legal.loading && legal.data?.partnerTermsVersion !== contract.latest.version ? 1 : 0;
  return todo + unsigned || null;
}
