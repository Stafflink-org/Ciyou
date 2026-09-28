// Rubrique Restaurants du super admin : fonctions serveur, lecture des commerces
// du périmètre, statuts et libellés.
import { useMemo } from 'react';
import { collection, limit, query, where, type QueryConstraint } from 'firebase/firestore';
import type { StatusMeta } from '@golink/ui';
import {
  COLLECTIONS,
  type ApplicationDecision,
  type BulkActionResult,
  type BulkRestaurantActionInput,
  type CommercialTermsInput,
  type CurrencyCode,
  type OnboardingStatus,
  type PartnerDocumentType,
  type Restaurant,
  type RestaurantImportReport,
  type RestaurantImportRow,
  type RestaurantStatus,
  type WithId,
} from '@golink/shared';
import { useGeoScope } from '@/layout/GeoScope';
import { db } from '@/lib/firebase';
import { callFunction, useCollection } from '@/lib/firestore';
import { callFunctionWithReason } from '@/lib/reason';

// ------------------------------------------------------------------ Fonctions

export const reviewRestaurantApplication = callFunctionWithReason<
  { restaurantId: string; decision: ApplicationDecision; reason?: string | null; missingDocuments?: PartnerDocumentType[]; goLive?: boolean; currency?: CurrencyCode },
  { onboardingStatus: string; status: string; emailSimulated: boolean }
>('reviewRestaurantApplication', { title: 'Décision sur le dossier', description: 'Le motif est conservé dans le journal d’audit (et transmis au commerce en cas de refus).' });
export const reviewDocument = callFunction<
  { documentId: string; decision: 'approve' | 'reject'; reason?: string | null; expiresAt?: string | null },
  { status: string; unblocked: boolean }
>('reviewDocument');
export const sendDocumentReminder = callFunction<{ restaurantId: string; documentTypes: PartnerDocumentType[]; message?: string | null }, { notified: boolean }>(
  'sendDocumentReminder',
);
export const runDocumentExpiryNow = callFunction<Record<string, never>, { checked: number; reminded: number; expired: number; blocked: number }>(
  'runDocumentExpiryNow',
);
export const suspendRestaurant = callFunction<
  { restaurantId: string; kind: 'temporary' | 'permanent'; until?: string | null; reason: string; message?: string | null },
  { status: RestaurantStatus }
>('suspendRestaurant');
export const reactivateRestaurant = callFunction<{ restaurantId: string; reason: string }, { status: RestaurantStatus }>('reactivateRestaurant');
export const updateCommercialTerms = callFunction<CommercialTermsInput, { commissionRuleId: string | null }>('updateCommercialTerms');
export const adminUpdateRestaurant = callFunction<Record<string, unknown>, { changed: string[] }>('adminUpdateRestaurant');
export const saveRestaurantGroup = callFunction<Record<string, unknown>, { groupId: string }>('saveRestaurantGroup');
export const bulkRestaurantAction = callFunction<BulkRestaurantActionInput, BulkActionResult>('bulkRestaurantAction');
export const importRestaurants = callFunctionWithReason<
  { rows: Array<Partial<RestaurantImportRow>>; dryRun: boolean; inviteOwners?: boolean },
  RestaurantImportReport
>('importRestaurants', { title: 'Créer les commerces de l’import', description: 'Création de comptes et envoi d’accès : indiquez le motif de l’import.' }, (input) => input.dryRun);
export const startImpersonation = callFunction<{ restaurantId: string; reason: string; durationMinutes: number }, { sessionId: string; expiresAt: number }>(
  'startImpersonation',
);
export const refreshRestaurantScores = callFunction<{ restaurantId?: string | null }, { computed: number; failed: number; score: number | null }>(
  'refreshRestaurantScores',
);

// ------------------------------------------------------------------ Lecture

/** Contraintes du filtre pays / ville courant (au plus 30 villes par `in`). */
export function useScopeConstraints(): QueryConstraint[] | null {
  const scope = useGeoScope();
  return useMemo(() => {
    if (scope.cityIds) return scope.cityIds.length ? [where('cityId', 'in', scope.cityIds.slice(0, 30))] : null;
    if (scope.countryId) return [where('countryId', '==', scope.countryId)];
    return [];
  }, [scope.cityIds, scope.countryId]);
}

/** Commerces du périmètre (temps réel). */
export function useScopedRestaurants() {
  const constraints = useScopeConstraints();
  const q = useMemo(
    () => (constraints ? query(collection(db, COLLECTIONS.restaurants), ...constraints, limit(1000)) : null),
    [constraints],
  );
  const state = useCollection<Restaurant>(q);
  const data = useMemo(() => state.data.filter((r) => !r.deletedAt), [state.data]);
  return { ...state, data, empty: constraints === null };
}

// ------------------------------------------------------------------ Statuts

export const RESTAURANT_STATUS_META: Record<RestaurantStatus, StatusMeta> = {
  onboarding: { label: 'En inscription', tone: 'info' },
  active: { label: 'Actif', tone: 'success' },
  paused: { label: 'En pause', tone: 'amber' },
  suspended: { label: 'Suspendu', tone: 'danger' },
  closed: { label: 'Fermé', tone: 'neutral' },
};

export const ONBOARDING_META: Record<OnboardingStatus, StatusMeta> = {
  draft: { label: 'Inscription en cours', tone: 'neutral' },
  pending: { label: 'En attente', tone: 'info', pulse: true },
  documents_missing: { label: 'Documents manquants', tone: 'amber' },
  approved: { label: 'Validé', tone: 'success' },
  rejected: { label: 'Refusé', tone: 'danger' },
};

export const DOCUMENT_STATUS_META: Record<string, StatusMeta> = {
  pending: { label: 'À vérifier', tone: 'info', pulse: true },
  approved: { label: 'Validé', tone: 'success' },
  rejected: { label: 'Refusé', tone: 'danger' },
  expired: { label: 'Expiré', tone: 'danger' },
};

export const PLAN_LABELS: Record<string, string> = { basic: 'Basic', pro: 'Pro', premium: 'Premium' };

export type RestaurantRow = WithId<Restaurant>;

/** Nombre de dossiers à traiter dans le périmètre (pastille du menu). */
export function isInValidationQueue(r: Restaurant): boolean {
  return r.onboardingStatus === 'pending' || r.onboardingStatus === 'documents_missing';
}

/** Jours restants avant une date AAAA-MM-JJ (négatif si dépassée). */
export function daysUntil(day: string | null | undefined): number | null {
  if (!day) return null;
  const target = Date.parse(`${day}T12:00:00`);
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  return Math.round((target - today.getTime()) / 86_400_000);
}

export function formatDay(day: string | null | undefined): string {
  if (!day) return '—';
  const [y, m, d] = day.split('-');
  return `${d}/${m}/${y}`;
}
