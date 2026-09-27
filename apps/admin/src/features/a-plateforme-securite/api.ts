// Appels des Cloud Functions du domaine « Plateforme & sécurité » (cahier §22 à §31).
import { callFunction } from '@/lib/firestore';
import { callFunctionWithReason } from '@/lib/reason';

// §22 Paramètres plateforme
export const updatePlatformSettings = callFunction<
  | { doc: 'general'; reason: string; data: Record<string, unknown> }
  | { doc: 'branding'; reason: string; data: Record<string, unknown> }
  | { doc: 'security'; reason: string; data: Record<string, unknown> }
  | { doc: 'retention'; reason: string; data: Record<string, unknown> },
  { changedFields: string[] }
>('updatePlatformSettings');

// §23 Multi-pays
export const updateCountry = callFunction<{ countryId: string; reason: string; section: string; data: Record<string, unknown> }, { changedFields: string[] }>('updateCountry');
export const createCountry = callFunction<
  { countryId: string; name: string; currency: string; locales: string[]; defaultLocale: string; timezone: string; phonePrefix: string; stripeAvailable: boolean; templateCountryId?: string | null; reason: string },
  { countryId: string }
>('createCountry');
export const setCountryActive = callFunction<{ countryId: string; active: boolean; reason: string }, { active: boolean }>('setCountryActive');

// §24 Fonctionnalités
export const setFeatureFlag = callFunction<
  { key: string; enabled: boolean; overrides: { scope: string; scopeId: string; enabled: boolean }[]; description?: string; reason: string },
  { changedFields: string[] }
>('setFeatureFlag');

// §25 Connexions
export const updateIntegration = callFunctionWithReason<{ key: string; enabled: boolean; mode: 'test' | 'live'; publicConfig: Record<string, string | number | boolean> }, { changedFields: string[] }>('updateIntegration', { title: 'Modifier cette connexion', description: 'Activation, mode test ou production : le motif est conservé dans le journal d’audit.' });
export const runHealthCheck = callFunction<void, Record<string, { status: string; latencyMs: number | null; message: string | null }>>('runHealthCheck');

// §26 Administrateurs
export const updateAdminRole = callFunction<
  { adminId: string; role: string; cityIds: string[]; countryIds: string[]; refundLimitCents: number | null; active: boolean; reason: string },
  { changedFields: string[] }
>('updateAdminRole');
export const updateAdminRoleDefinition = callFunction<
  { role: string; label: string; description: string; permissions: string[]; defaultRefundLimitCents: number; reason: string },
  { changedFields: string[]; affectedAdmins: number }
>('updateAdminRoleDefinition');
export const inviteAdmin = callFunction<
  { email: string; firstName: string; lastName: string; adminRole: string; cityIds: string[]; countryIds: string[]; reason: string },
  { uid: string; newAccount: boolean; emailSent: boolean }
>('inviteAdmin');

// §27 Sécurité
export const enrollTotp = callFunction<{ action: 'start' } | { action: 'confirm'; code: string }, { secret?: string; uri?: string; account?: string; recoveryCodes?: string[] }>('enrollTotp');
export const verifyTotp = callFunction<{ code: string; method?: 'totp' | 'recovery_code' }, { verified: boolean; remainingRecoveryCodes: number }>('verifyTotp');
export const regenerateRecoveryCodes = callFunction<{ code: string }, { recoveryCodes: string[] }>('regenerateRecoveryCodes');
export const getMfaStatus = callFunction<void, { enrolled: boolean; enrolledAt: number | null; recoveryCodesLeft: number; currentStep: number }>('getMfaStatus');
export const resetAdminMfa = callFunctionWithReason<{ adminId: string }, { sessionsRevoked: number }>('resetAdminMfa', { title: 'Réinitialiser la double authentification', description: 'Le compte devra enrôler un nouvel appareil et ses sessions sont fermées. Indiquez la raison (appareil perdu, changement de téléphone…).', confirmLabel: 'Réinitialiser' });
export const revokeSessions = callFunction<{ adminId: string; sessionId?: string | null; reason: string }, { revoked: number }>('revokeSessions');
export const handleSecurityAlert = callFunction<{ alertId: string; status: 'acknowledged' | 'resolved' | 'dismissed'; note?: string | null }, { status: string }>('handleSecurityAlert');
export const trackAdminSession = callFunction<void, { sessionId: string; mfaEnrolled: boolean; mfaVerified: boolean; mfaRequired: boolean; enforcementDeadline: number | null; revoked: boolean; expired: boolean; expiresAt: number | null }>('trackAdminSession');

// §28 Fraude
export const decideFraudCase = callFunction<{ caseId: string; status: string; action?: string; note: string }, { status: string }>('decideFraudCase');
export const addBlocklistEntry = callFunction<{ type: string; value: string; reason: string; fraudCaseId?: string | null; expiresAt: number | null }, { id: string }>('addBlocklistEntry');
export const removeBlocklistEntry = callFunction<{ entryId: string; reason: string }, { removed: boolean }>('removeBlocklistEntry');
export const updateFraudSettings = callFunction<Record<string, unknown> & { reason: string }, { ok: true }>('updateFraudSettings');

// §29 Légal et RGPD
export const saveLegalDocument = callFunction<
  { documentId?: string | null; type: string; countryId: string; version: string; title: string; content: string; status: string; effectiveAt: number | null; requiresReacceptance: boolean; changeSummary: string | null; reason: string },
  { documentId: string }
>('saveLegalDocument');
export const receiveGdprRequest = callFunctionWithReason<{ type: string; subjectType: string; subjectId?: string | null; email: string; notes: string | null }, { requestId: string; dueAt: number }>('receiveGdprRequest', { title: 'Enregistrer la demande RGPD', description: 'Indiquez l’origine de la demande (courrier, appel, e-mail).' });
export const handleGdprRequest = callFunction<{ requestId: string; status: string; note: string | null }, { status: string }>('handleGdprRequest');
export const previewRetentionRun = callFunction<void, { inactiveAccounts: number; trashToPurge: number }>('previewRetentionRun');

// §30 Santé et maintenance
export const setMaintenanceMode = callFunction<{ app: string; enabled: boolean; message: string | null; until: number | null; reason: string }, { enabled: boolean }>('setMaintenanceMode');
export const updateAppVersion = callFunction<
  { app: string; latestVersion: string; minimumVersion: string; forceUpdate: boolean; message: string | null; storeUrls: { ios: string | null; android: string | null } | null; reason: string },
  { changedFields: string[] }
>('updateAppVersion');
export const saveIncident = callFunction<
  { incidentId?: string | null; title: string; services: string[]; severity: string; status: string; update: string; publicMessage: string | null; postMortem: string | null },
  { incidentId: string }
>('saveIncident');

// §31 Données et sauvegardes
export const runManualBackup = callFunctionWithReason<{ collections: string[] | null }, { backupId: string }>('runManualBackup', { title: 'Lancer une sauvegarde manuelle' });
export const checkBackupStatus = callFunction<{ backupId: string }, { status: string }>('checkBackupStatus');
export const restoreFromTrash = callFunction<{ trashId: string; reason: string }, { restored: boolean; path: string }>('restoreFromTrash');
export const purgeTrashItem = callFunction<{ trashId: string; reason: string }, { purged: boolean }>('purgeTrashItem');

// Journal d'audit (§27), export
export const exportAuditLogs = callFunctionWithReason<
  { from: number; to: number; actionPrefix?: string | null; actorUid?: string | null; targetType?: string | null; sensitiveOnly?: boolean; search?: string | null },
  { fileName: string; mimeType: string; contentBase64: string; rowCount: number; truncated: boolean }
>('exportAuditLogs', { title: 'Exporter le journal d’audit', description: 'Cet export est lui-même tracé : indiquez pourquoi.' });

// Traduction automatique (Azure Translator, cahier « translation-azure »)
export const saveTranslatorSettings = callFunction<
  { apiKey: string; region: string; endpoint: string; enabled: boolean; activeLocales: string[]; monthlyCharacterCap: number; reason: string },
  { configured: boolean; keyLast4: string | null; changedFields: string[] }
>('saveTranslatorSettings');
export const testTranslatorConnection = callFunction<
  { apiKey?: string | null; region?: string | null; endpoint?: string | null },
  { ok: boolean; translated: string | null; error: string | null }
>('testTranslatorConnection');

// Cartographie (Google Maps, tâche « maps-settings »)
export const saveMapsSettings = callFunction<
  { webApiKey: string; mobileApiKey: string; allowedWebReferrers: string[]; allowedMobileIdentifiers: string[]; reason: string },
  { configuredWeb: boolean; webKeyLast4: string | null; configuredMobile: boolean; mobileKeyLast4: string | null; changedFields: string[] }
>('saveMapsSettings');
export const testMapsConnection = callFunction<
  { which?: 'web' | 'mobile'; apiKey?: string | null },
  { ok: boolean; error: string | null }
>('testMapsConnection');

// §25 Logiciels de caisse
export const savePosConnection = callFunction<
  { connectionId?: string | null; restaurantId: string; provider: string; label?: string | null; webhookUrl: string; externalLocationId?: string | null; pushOrders: boolean; reason: string },
  { connectionId: string; secret: string | null }
>('savePosConnection');
export const testPosConnection = callFunction<{ connectionId: string; reason: string }, { ok: boolean; httpStatus: number | null; error: string | null }>('testPosConnection');
export const disconnectPosConnection = callFunction<{ connectionId: string; reason: string }, { status: string }>('disconnectPosConnection');
