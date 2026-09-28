// Outils de la rubrique Livreurs : coordonnées masquées selon le rôle, état des
// documents exigés, compteurs de la file de validation, export CSV.
import { useMemo } from 'react';
import { collection, limit, query, where } from 'firebase/firestore';
import {
  COLLECTIONS,
  DRIVER_STATUS_LABELS,
  DRIVER_TYPE_LABELS,
  VEHICLE_LABELS,
  driverDocumentRequirements,
  maskEmail,
  maskPhone,
  type Driver,
  type DriverDocumentRequirement,
  type IdentityCheck,
  type PartnerDocument,
  type WithId,
} from '@golink/shared';
import { useAdminAccess } from '@/auth/AdminAccess';
import { db } from '@/lib/firebase';
import { useCollection } from '@/lib/firestore';
import { useCityConstraint } from '../_operations/hooks';

/** Coordonnées complètes visibles seulement avec la permission `personal_data.view` (source unique, aussi appliquée par les règles et les fonctions). */
export function useContactMask() {
  const { can } = useAdminAccess();
  const masked = !can('personal_data.view');
  return useMemo(
    () => ({
      masked,
      phone: (value: string | null | undefined) => (value ? (masked ? maskPhone(value) : value) : '—'),
      email: (value: string | null | undefined) => (value ? (masked ? maskEmail(value) : value) : '—'),
    }),
    [masked],
  );
}

export interface RequirementState extends DriverDocumentRequirement {
  document: WithId<PartnerDocument> | null;
  state: 'valid' | 'pending' | 'rejected' | 'expired' | 'missing' | 'expiring';
}

/** Rapproche les pièces exigées et les documents déposés (le plus récent par type). */
export function requirementStates(driver: Pick<Driver, 'type' | 'vehicle'>, documents: WithId<PartnerDocument>[], today: string): RequirementState[] {
  const soon = new Date(Date.parse(today) + 30 * 86_400_000).toISOString().slice(0, 10);
  return driverDocumentRequirements(driver).map((req) => {
    const ofType = documents
      .filter((d) => d.type === req.type)
      .sort((a, b) => (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0));
    const valid = ofType.find((d) => d.status === 'approved' && (!d.expiresAt || d.expiresAt >= today));
    const document = valid ?? ofType[0] ?? null;
    let state: RequirementState['state'] = 'missing';
    if (valid) state = valid.expiresAt && valid.expiresAt <= soon ? 'expiring' : 'valid';
    else if (document?.status === 'pending') state = 'pending';
    else if (document?.status === 'rejected') state = 'rejected';
    else if (document && (document.status === 'expired' || document.status === 'approved')) state = 'expired';
    return { ...req, document, state };
  });
}

export function todayIso(): string {
  return new Intl.DateTimeFormat('fr-CA', { timeZone: 'Europe/Paris' }).format(new Date());
}

/** Inscriptions à examiner dans le périmètre (badge du menu, onglet Validation). */
export function useApplicationsQueue(enabled = true) {
  const { constraints, key } = useCityConstraint();
  const q = useMemo(
    () => (enabled ? query(collection(db, COLLECTIONS.drivers), ...constraints, where('status', '==', 'onboarding'), limit(200)) : null),
    [key, enabled], // eslint-disable-line react-hooks/exhaustive-deps
  );
  return useCollection<Driver>(q);
}

/** Selfies envoyés, en attente de décision. */
export function useSubmittedChecks(enabled = true) {
  const q = useMemo(() => (enabled ? query(collection(db, COLLECTIONS.identityChecks), where('status', '==', 'submitted'), limit(100)) : null), [enabled]);
  return useCollection<IdentityCheck & { cityId?: string }>(q);
}

/** Documents de livreurs à vérifier. */
export function usePendingDriverDocuments(enabled = true) {
  const q = useMemo(
    () => (enabled ? query(collection(db, COLLECTIONS.partnerDocuments), where('ownerType', '==', 'driver'), where('status', '==', 'pending'), limit(200)) : null),
    [enabled],
  );
  return useCollection<PartnerDocument>(q);
}

/** Pastille du menu : inscriptions en attente de décision. */
export function useDriversToReviewCount(): number | null {
  const { can } = useAdminAccess();
  const allowed = can('drivers.validate');
  const queue = useApplicationsQueue(allowed).data;
  if (!allowed) return null;
  return queue.filter((d) => d.onboardingStatus === 'pending').length || null;
}

/** Export CSV d'une sélection de livreurs (séparateur « ; », compatible tableur français). */
export async function exportDriversCsv(drivers: WithId<Driver>[], cityName: (id: string) => string, masked: boolean): Promise<void> {
  const Papa = (await import('papaparse')).default;
  const rows = drivers.map((d) => ({
    Identifiant: d.id,
    Prénom: d.firstName,
    Nom: d.lastName,
    Téléphone: masked ? maskPhone(d.phone) : d.phone,
    'E-mail': masked ? maskEmail(d.email) : d.email,
    Type: DRIVER_TYPE_LABELS[d.type],
    Ville: cityName(d.cityId),
    Véhicule: VEHICLE_LABELS[d.vehicle.type],
    Statut: DRIVER_STATUS_LABELS[d.status],
    Livraisons: d.stats.deliveries,
    'Taux d’acceptation': `${Math.round(d.stats.acceptanceRate * 100)} %`,
    'Taux d’annulation': `${(d.stats.cancellationRate * 100).toFixed(1)} %`,
    Ponctualité: `${Math.round(d.stats.onTimeRate * 100)} %`,
    'Note moyenne': d.rating.count ? d.rating.average.toFixed(2) : '',
    'Documents valides jusqu’au': d.documentsValidUntil ?? '',
  }));
  const csv = Papa.unparse(rows, { delimiter: ';' });
  const blob = new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `livreurs-${todayIso()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
