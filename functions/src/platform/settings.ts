// Paramètres de la plateforme (cahier §22) : identité, marque, réglages régionaux,
// politique de sécurité et durées de conservation. Chaque modification est historisée
// (ancienne et nouvelle valeur, auteur, motif) et auditée.
import { APP_LOCALES, COLLECTIONS, CURRENCY_CODES, LOCALES, SETTINGS_DOCS } from '@golink/shared';
import { db, FieldValue, Timestamp } from '../lib/admin';
import { actorFromCaller, writeAudit } from '../lib/audit';
import { fail } from '../lib/errors';
import { z, zEmail, zReason } from '../lib/validation';
import { platformCallable, raiseSecurityAlert, recordSettingsChange, requireSecureAdmin } from './runtime';

const zHex = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Couleur hexadécimale attendue (#RRGGBB)');
const zImage = z.object({ url: z.url(), path: z.string().max(300).nullish(), width: z.number().int().nullish(), height: z.number().int().nullish(), alt: z.string().max(120).nullish() }).nullable();

const settingsSchema = z.discriminatedUnion('doc', [
  z.object({
    doc: z.literal('general'),
    reason: zReason,
    data: z.object({
      platformName: z.string().trim().min(2).max(40),
      legalEntityName: z.string().trim().min(2).max(120),
      supportEmail: zEmail,
      supportPhone: z.string().trim().max(30).nullable(),
      defaultCountryId: z.string().trim().length(2),
      defaultLocale: z.enum(LOCALES),
      defaultTimezone: z.string().trim().min(3).max(60),
      currency: z.enum(CURRENCY_CODES),
      supportedLocales: z.array(z.enum(LOCALES)).min(1).max(LOCALES.length),
    }),
  }),
  z.object({
    doc: z.literal('branding'),
    reason: zReason,
    data: z.object({
      logo: zImage,
      logoDark: zImage,
      favicon: zImage,
      colors: z.object({ primary: zHex, secondary: zHex, accent: zHex, background: zHex }),
    }),
  }),
  z.object({
    doc: z.literal('security'),
    reason: zReason,
    data: z.object({
      requireMfaForAdmins: z.boolean(),
      /** Date d'effet de l'obligation (ms), null = immédiate. */
      mfaEnforcedFrom: z.number().int().nullable(),
      adminSessionMaxHours: z.number().int().min(1).max(168),
      mfaMaxAttempts: z.number().int().min(3).max(10),
      mfaLockMinutes: z.number().int().min(1).max(1440),
      alertOnNewDevice: z.boolean(),
      /** Plage horaire de connexion inhabituelle (heure de Paris), from = to : désactivée. */
      unusualLoginHours: z.object({ fromHour: z.number().int().min(0).max(23), toHour: z.number().int().min(0).max(24) }),
      alerts: z.object({
        massExportRows: z.number().int().min(100).max(1_000_000),
        refundsPerAgentPerHour: z.number().int().min(1).max(1000),
        failedLoginsPerHour: z.number().int().min(1).max(1000),
      }),
    }),
  }),
  z.object({
    doc: z.literal('retention'),
    reason: zReason,
    data: z.object({
      inactiveAccountMonths: z.number().int().min(6).max(120),
      anonymizeOrdersAfterMonths: z.number().int().min(12).max(240),
      keepInvoicesYears: z.number().int().min(10).max(30),
      keepAuditLogsYears: z.number().int().min(1).max(30),
      deleteDriverLocationsAfterDays: z.number().int().min(1).max(365),
      trashRetentionDays: z.number().int().min(7).max(365),
      autoAnonymize: z.boolean(),
    }),
  }),
]);

const LABELS: Record<string, string> = {
  general: 'Identité et réglages régionaux',
  branding: 'Marque',
  security: 'Politique de sécurité',
  retention: 'Durées de conservation',
};

export const updatePlatformSettings = platformCallable(settingsSchema, async (input, request) => {
  const permission = input.doc === 'security' ? 'security.manage' : 'settings.edit';
  const { caller, admin } = await requireSecureAdmin(request, permission);
  if (input.doc === 'general' && !input.data.supportedLocales.includes(input.data.defaultLocale)) {
    throw fail.invalid('La langue par défaut doit faire partie des langues proposées.');
  }
  if (input.doc === 'general') {
    const unsupported = input.data.supportedLocales.filter((l) => !(APP_LOCALES as readonly string[]).includes(l));
    if (unsupported.length) throw fail.invalid(`Langues non traduites dans les applications : ${unsupported.join(', ')}.`);
    const country = await db.collection(COLLECTIONS.countries).doc(input.data.defaultCountryId).get();
    if (!country.exists) throw fail.invalid('Pays par défaut inconnu.');
  }

  const docId = SETTINGS_DOCS[input.doc];
  const ref = db.collection(COLLECTIONS.settings).doc(docId);
  const snap = await ref.get();
  const before = (snap.data() ?? null) as Record<string, unknown> | null;
  const data: Record<string, unknown> = { ...input.data };
  if (input.doc === 'security') {
    // La double authentification est obligatoire pour tous les administrateurs (cahier §27) : une fois exigée,
    // elle ne peut plus être désactivée ni repoussée. Aucun compte enrôlé n'est jamais désactivé par ce réglage.
    const enforcedNow = before?.requireMfaForAdmins === true && (!(before.mfaEnforcedFrom as { toMillis?: () => number } | null | undefined)?.toMillis || (before.mfaEnforcedFrom as { toMillis: () => number }).toMillis() <= Date.now());
    if (enforcedNow && (!input.data.requireMfaForAdmins || (input.data.mfaEnforcedFrom !== null && input.data.mfaEnforcedFrom > Date.now()))) {
      throw fail.precondition('La double authentification est obligatoire pour tous les administrateurs : elle ne peut pas être désactivée ni repoussée.');
    }
    data.mfaEnforcedFrom = input.data.mfaEnforcedFrom === null ? null : Timestamp.fromMillis(input.data.mfaEnforcedFrom);
  }
  const change = await recordSettingsChange({ docPath: `${COLLECTIONS.settings}/${docId}`, before, after: { ...(before ?? {}), ...data }, reason: input.reason, caller });
  if (change.fields.length === 0) return { changedFields: [] };
  await ref.set({ ...data, updatedAt: FieldValue.serverTimestamp(), updatedBy: caller.uid }, { merge: true });
  await writeAudit({
    actor: actorFromCaller(caller, 'admin'),
    action: 'settings.updated',
    target: { type: 'setting', id: `${COLLECTIONS.settings}/${docId}`, label: LABELS[input.doc] ?? docId },
    reason: input.reason,
    before: change.before,
    after: change.after,
    sensitive: input.doc === 'security',
    request,
  });
  if (input.doc === 'security' && before?.requireMfaForAdmins === true && input.data.requireMfaForAdmins === false) {
    await raiseSecurityAlert({ type: 'mfa_disabled', adminId: caller.uid, severity: 'critical', details: `Obligation de double authentification désactivée par ${admin.displayName} : ${input.reason}` });
  }
  return { changedFields: change.fields };
});
