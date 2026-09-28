// Abonnements temps réel du domaine « Plateforme & sécurité ».
import { useMemo } from 'react';
import { collection, doc, orderBy, query, where } from 'firebase/firestore';
import {
  COLLECTIONS,
  SETTINGS_DOCS,
  type AdminMfaSecret,
  type AdminRoleDefinition,
  type AdminSessionRecord,
  type AdminUser,
  type Backup,
  type BlocklistEntry,
  type Country,
  type FeatureFlag,
  type FraudCase,
  type GdprRequest,
  type Incident,
  type LegalDocument,
  type MapsSettings,
  type PlatformIntegration,
  type SecurityAlert,
  type ServiceStatus,
  type TranslatorSettings,
  type TrashItem,
} from '@golink/shared';
import { db } from '@/lib/firebase';
import { useCollection, useDoc } from '@/lib/firestore';
import type { SecurityPolicy } from '@golink/shared';

export function useAdmins() {
  const q = useMemo(() => query(collection(db, COLLECTIONS.admins), orderBy('displayName', 'asc')), []);
  return useCollection<AdminUser>(q);
}

export function useAdminRoleDefinitions() {
  const q = useMemo(() => collection(db, COLLECTIONS.adminRoles), []);
  return useCollection<AdminRoleDefinition>(q);
}

export function useAdminSessions(adminId: string | null) {
  const q = useMemo(() => (adminId ? query(collection(db, COLLECTIONS.adminSessions), where('adminId', '==', adminId), orderBy('createdAt', 'desc')) : null), [adminId]);
  return useCollection<AdminSessionRecord>(q);
}

export function useMyMfaSecret(uid: string | null) {
  return useDoc<AdminMfaSecret>(uid ? doc(db, COLLECTIONS.adminSecrets, uid) : null);
}

export function useSecurityAlerts(status: 'open' | 'all' = 'open') {
  const q = useMemo(
    () =>
      status === 'open'
        ? query(collection(db, COLLECTIONS.securityAlerts), where('status', '==', 'open'), orderBy('detectedAt', 'desc'))
        : query(collection(db, COLLECTIONS.securityAlerts), orderBy('detectedAt', 'desc')),
    [status],
  );
  return useCollection<SecurityAlert>(q);
}

export function useSecurityPolicy() {
  return useDoc<SecurityPolicy>(doc(db, COLLECTIONS.settings, SETTINGS_DOCS.security));
}

export function useRetentionSettings() {
  return useDoc(doc(db, COLLECTIONS.settings, SETTINGS_DOCS.retention));
}

export function useGeneralSettings() {
  return useDoc(doc(db, COLLECTIONS.settings, SETTINGS_DOCS.general));
}

export function useCountries() {
  const q = useMemo(() => query(collection(db, COLLECTIONS.countries), orderBy('name', 'asc')), []);
  return useCollection<Country>(q);
}

export function useCitiesOf(countryId: string | null) {
  const q = useMemo(() => (countryId ? query(collection(db, COLLECTIONS.cities), where('countryId', '==', countryId), orderBy('name', 'asc')) : null), [countryId]);
  return useCollection(q);
}

export function useAllCities() {
  const q = useMemo(() => query(collection(db, COLLECTIONS.cities), orderBy('name', 'asc')), []);
  return useCollection<{ name: string; countryId: string }>(q);
}

export function useFeatureFlags() {
  const q = useMemo(() => collection(db, COLLECTIONS.featureFlags), []);
  return useCollection<FeatureFlag>(q);
}

export function useIntegrations() {
  const q = useMemo(() => collection(db, COLLECTIONS.integrations), []);
  return useCollection<PlatformIntegration>(q);
}

export function useServiceStatuses() {
  const q = useMemo(() => collection(db, COLLECTIONS.serviceStatus), []);
  return useCollection<ServiceStatus>(q);
}

export function useAppVersions() {
  const q = useMemo(() => collection(db, COLLECTIONS.appVersions), []);
  return useCollection(q);
}

export function useIncidents() {
  const q = useMemo(() => query(collection(db, COLLECTIONS.incidents), orderBy('startedAt', 'desc')), []);
  return useCollection<Incident>(q);
}

export function useFraudCases(status?: FraudCase['status']) {
  const q = useMemo(
    () => (status ? query(collection(db, COLLECTIONS.fraudCases), where('status', '==', status), orderBy('riskScore', 'desc')) : query(collection(db, COLLECTIONS.fraudCases), orderBy('riskScore', 'desc'))),
    [status],
  );
  return useCollection<FraudCase>(q);
}

export function useBlocklist() {
  const q = useMemo(() => query(collection(db, COLLECTIONS.blocklist), where('active', '==', true), orderBy('createdAt', 'desc')), []);
  return useCollection<BlocklistEntry>(q);
}

export function useLegalDocuments() {
  const q = useMemo(() => query(collection(db, COLLECTIONS.legalDocuments), orderBy('createdAt', 'desc')), []);
  return useCollection<LegalDocument>(q);
}

export function useGdprRequests() {
  const q = useMemo(() => query(collection(db, COLLECTIONS.gdprRequests), orderBy('receivedAt', 'desc')), []);
  return useCollection<GdprRequest>(q);
}

export function useBackups() {
  const q = useMemo(() => query(collection(db, COLLECTIONS.backups), orderBy('startedAt', 'desc')), []);
  return useCollection<Backup & { operationName?: string | null }>(q);
}

export function useTranslatorSettings() {
  return useDoc<TranslatorSettings>(doc(db, COLLECTIONS.settings, SETTINGS_DOCS.translator));
}

export function useMapsSettings() {
  return useDoc<MapsSettings>(doc(db, COLLECTIONS.settings, SETTINGS_DOCS.maps));
}

export function useTrash() {
  const q = useMemo(() => query(collection(db, COLLECTIONS.trash), where('restoredAt', '==', null), orderBy('deletedAt', 'desc')), []);
  return useCollection<TrashItem>(q);
}
