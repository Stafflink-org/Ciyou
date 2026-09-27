// Validation automatique des commerces (décision client n° 14) : dès que le dossier est
// complet et que les contrôles réglés par le super admin passent, le commerce est validé
// et mis en ligne sans intervention. Sinon il reste dans la file de validation manuelle,
// avec le détail des contrôles échoués. Règle activable (`settings/merchantValidation`).
import {
  COLLECTIONS,
  DEFAULT_MERCHANT_VALIDATION,
  PARTNER_DOCUMENT_LABELS,
  REQUIRED_RESTAURANT_DOCUMENTS,
  SETTINGS_DOCS,
  MERCHANT_VALIDATION_MODES,
  checkRegistrationNumber,
  type City,
  type MerchantAutoValidation,
  type MerchantValidationCheck,
  type MerchantValidationSettings,
  type PartnerDocument,
  type PlatformAlert,
  type Restaurant,
  type RestaurantLegal,
  type UserProfile,
} from '@golink/shared';
import { logger } from 'firebase-functions/v2';
import { db, FieldValue, storage, Timestamp } from '../lib/admin';
import { actorFromCaller, SYSTEM_ACTOR, writeAudit } from '../lib/audit';
import { callable } from '../lib/callable';
import { fail } from '../lib/errors';
import { requireAdmin } from '../lib/permissions';
import { EMAIL_SECRETS } from '../lib/secrets';
import { z, zId, zReason } from '../lib/validation';
import { plain, writeSettingsHistory, OPS_RUNTIME } from '../admin/operations/common';
import { sendPlatformMessage } from '../notifications/messages';
import { legalRef, restaurantRef } from './config-context';

function parisDay(date = new Date()): string {
  return new Intl.DateTimeFormat('fr-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

function addDaysIso(day: string, days: number): string {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

export async function loadMerchantValidation(): Promise<Omit<MerchantValidationSettings, 'updatedAt' | 'updatedBy'>> {
  const snap = await db.collection(COLLECTIONS.settings).doc(SETTINGS_DOCS.merchantValidation).get();
  return { ...DEFAULT_MERCHANT_VALIDATION, ...((snap.data() as Partial<MerchantValidationSettings> | undefined) ?? {}) };
}

export interface EvaluationResult {
  eligible: boolean;
  checks: MerchantValidationCheck[];
  /** Pièces à passer en « validée » si le dossier est accepté. */
  documentIdsToApprove: string[];
}

/** Examine un dossier : renvoie chaque contrôle (réussi ou non) sans rien modifier. */
export async function evaluateRestaurantApplication(restaurantId: string, settings: Omit<MerchantValidationSettings, 'updatedAt' | 'updatedBy'>): Promise<EvaluationResult> {
  const checks: MerchantValidationCheck[] = [];
  const rSnap = await restaurantRef(restaurantId).get();
  const restaurant = rSnap.data() as Restaurant | undefined;
  if (!restaurant) throw fail.notFound('Restaurant');
  const today = parisDay();
  const push = (code: MerchantValidationCheck['code'], ok: boolean, detail: string) => checks.push({ code, ok, detail });

  // Pays concerné.
  push(
    'country_allowed',
    !settings.countryIds || settings.countryIds.includes(restaurant.countryId),
    settings.countryIds && !settings.countryIds.includes(restaurant.countryId) ? `La validation automatique n’est pas activée pour ${restaurant.countryId}.` : 'Pays concerné par la validation automatique.',
  );

  // Pièces obligatoires déposées.
  const docsSnap = await db.collection(COLLECTIONS.partnerDocuments).where('ownerType', '==', 'restaurant').where('ownerId', '==', restaurantId).get();
  const docs = docsSnap.docs
    .map((d) => ({ id: d.id, ...(d.data() as PartnerDocument) }))
    .filter((d) => d.status === 'pending' || d.status === 'approved')
    .sort((a, b) => (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0));
  const missing = REQUIRED_RESTAURANT_DOCUMENTS.filter((group) => !docs.some((d) => group.types.includes(d.type)));
  push('documents_complete', missing.length === 0, missing.length ? `Pièces manquantes : ${missing.map((g) => g.label).join(', ')}.` : 'Toutes les pièces obligatoires sont déposées.');

  // Validité de chaque pièce retenue (la plus récente de chaque groupe).
  const chosen = REQUIRED_RESTAURANT_DOCUMENTS.map((group) => docs.find((d) => group.types.includes(d.type))).filter((d): d is (typeof docs)[number] => Boolean(d));
  const problems: string[] = [];
  const minValidUntil = addDaysIso(today, settings.minDocumentValidityDays);
  for (const doc of chosen) {
    const label = PARTNER_DOCUMENT_LABELS[doc.type];
    const [exists] = await storage.bucket().file(doc.file.path).exists();
    if (!exists || !doc.file.size || doc.file.size <= 0) problems.push(`${label} : fichier introuvable ou vide.`);
    if (doc.type === 'manager_id' && !doc.expiresAt) problems.push(`${label} : date d’expiration non renseignée.`);
    if (doc.expiresAt && doc.expiresAt < minValidUntil) problems.push(`${label} : valable moins de ${settings.minDocumentValidityDays} jours (expire le ${doc.expiresAt}).`);
  }
  push('documents_valid', problems.length === 0, problems.length ? problems.join(' ') : 'Fichiers présents et dates de validité suffisantes.');

  // Ancienneté de l'extrait d'immatriculation.
  const registration = chosen.find((d) => d.type === 'kbis' || d.type === 'siret_notice');
  if (settings.registrationDocumentMaxAgeDays > 0 && registration) {
    const limit = addDaysIso(today, -settings.registrationDocumentMaxAgeDays);
    const recent = registration.type === 'siret_notice' ? !registration.issuedAt || registration.issuedAt >= limit : Boolean(registration.issuedAt) && (registration.issuedAt as string) >= limit;
    push(
      'documents_recent',
      recent,
      recent ? `Extrait d’immatriculation de moins de ${settings.registrationDocumentMaxAgeDays} jours.` : `Extrait d’immatriculation délivré il y a plus de ${settings.registrationDocumentMaxAgeDays} jours ou sans date de délivrance.`,
    );
  }

  // Numéro d'immatriculation.
  const legalSnap = await legalRef(restaurantId).get();
  const legal = legalSnap.data() as RestaurantLegal | undefined;
  if (settings.checkRegistrationNumber) {
    const check = legal?.siret ? checkRegistrationNumber(restaurant.countryId, legal.siret) : null;
    push('registration_number', Boolean(check?.ok), check ? check.detail : 'Numéro d’immatriculation non renseigné.');
  }

  // Contrat partenaire.
  if (settings.requireContract) {
    push('contract_accepted', Boolean(legal?.partnerTermsAcceptedAt), legal?.partnerTermsAcceptedAt ? `Contrat accepté (version ${legal.partnerTermsVersion ?? 'en vigueur'}).` : 'Contrat partenaire non accepté.');
  }

  // Ville ouverte au service.
  if (settings.requireActiveCity) {
    const city = (await db.collection(COLLECTIONS.cities).doc(restaurant.cityId).get()).data() as City | undefined;
    const zones = await db.collection(COLLECTIONS.zones).where('cityId', '==', restaurant.cityId).where('active', '==', true).limit(1).get();
    const open = Boolean(city?.active) && !zones.empty;
    push('city_active', open, open ? 'Ville active avec une zone de livraison.' : 'La ville n’est pas encore ouverte ou n’a aucune zone active.');
  }

  // Compte propriétaire sain.
  const owner = (await db.collection(COLLECTIONS.users).doc(restaurant.ownerId).get()).data() as UserProfile | undefined;
  push('not_blocked', owner?.status === 'active', owner?.status === 'active' ? 'Compte du gérant actif.' : 'Compte du gérant introuvable ou bloqué.');

  // Garde-fou quotidien.
  if (settings.maxPerDay > 0) {
    const count = await db.collection(COLLECTIONS.restaurants).where('autoValidatedDay', '==', today).count().get();
    push('daily_limit', count.data().count < settings.maxPerDay, count.data().count < settings.maxPerDay ? 'Plafond quotidien non atteint.' : `Plafond de ${settings.maxPerDay} validations automatiques atteint aujourd’hui.`);
  }

  return { eligible: checks.every((c) => c.ok), checks, documentIdsToApprove: chosen.filter((d) => d.status === 'pending').map((d) => d.id) };
}

async function resolveValidationAlerts(restaurantId: string): Promise<void> {
  const snap = await db.collection(COLLECTIONS.platformAlerts).where('target.id', '==', restaurantId).get();
  const batch = db.batch();
  let count = 0;
  for (const d of snap.docs) {
    const alert = d.data() as PlatformAlert;
    if (alert.kind === 'restaurant_to_validate' && alert.status !== 'resolved' && alert.status !== 'dismissed') {
      batch.update(d.ref, { status: 'resolved', resolvedAt: FieldValue.serverTimestamp() });
      count += 1;
    }
  }
  if (count > 0) await batch.commit();
}

export type AutoValidationOutcome = 'approved' | 'suggested' | 'not_eligible' | 'skipped';

/**
 * Examine un dossier et, selon le mode, le valide automatiquement. Idempotent : un dossier
 * déjà validé, refusé ou hors inscription est ignoré. Lancé manuellement par un administrateur,
 * l'examen se fait même en mode `off` (sans jamais valider dans ce mode).
 */
export async function tryAutoValidateRestaurant(
  restaurantId: string,
  source: 'signup' | 'document' | 'contract' | 'sweep' | 'manual',
  options: { apply?: boolean; actor?: Parameters<typeof writeAudit>[0]['actor'] } = {},
): Promise<{ outcome: AutoValidationOutcome; checks: MerchantValidationCheck[] }> {
  const settings = await loadMerchantValidation();
  const ref = restaurantRef(restaurantId);
  const snap = await ref.get();
  const restaurant = snap.data() as Restaurant | undefined;
  if (!restaurant || restaurant.deletedAt || restaurant.status !== 'onboarding' || !['pending', 'documents_missing'].includes(restaurant.onboardingStatus)) {
    return { outcome: 'skipped', checks: [] };
  }
  if (settings.mode === 'off' && source !== 'manual') return { outcome: 'skipped', checks: [] };

  const evaluation = await evaluateRestaurantApplication(restaurantId, settings);
  // Mode automatique : décision immédiate. Mode suggestion : un agent confirme en un clic (`apply`).
  const decide = evaluation.eligible && (settings.mode === 'auto' || (options.apply === true && settings.mode === 'suggest'));
  const actor = options.actor ?? SYSTEM_ACTOR;
  const byUid = options.actor?.uid ?? 'system';
  const now = Timestamp.now();
  const record: MerchantAutoValidation = { at: now, mode: settings.mode, eligible: evaluation.eligible, decided: decide, checks: evaluation.checks };

  if (!decide) {
    await ref.update({ autoValidation: record });
    return { outcome: evaluation.eligible && settings.mode !== 'off' ? 'suggested' : 'not_eligible', checks: evaluation.checks };
  }

  // Validation automatique : pièces, dossier, mise en ligne.
  const batch = db.batch();
  for (const documentId of evaluation.documentIdsToApprove) {
    batch.update(db.collection(COLLECTIONS.partnerDocuments).doc(documentId), { status: 'approved', reviewedBy: byUid, reviewedAt: now, rejectionReason: null, updatedAt: now, updatedBy: byUid });
  }
  const goLive = settings.goLive;
  batch.update(ref, {
    onboardingStatus: 'approved',
    rejectionReason: null,
    missingDocuments: [],
    ...(goLive ? { status: 'active', launchedAt: now } : {}),
    autoValidation: record,
    autoValidatedDay: parisDay(),
    updatedAt: now,
    updatedBy: byUid,
  });
  await batch.commit();
  await resolveValidationAlerts(restaurantId);

  const summary = evaluation.checks.map((c) => c.detail).join(' · ');
  for (const documentId of evaluation.documentIdsToApprove) {
    await writeAudit({
      actor,
      action: 'document.auto_approved',
      target: { type: 'document', id: documentId, label: restaurant.name },
      reason: 'Validation automatique du dossier',
      after: { status: 'approved', restaurantId },
      countryId: restaurant.countryId,
      cityId: restaurant.cityId,
    });
  }
  await writeAudit({
    actor,
    action: 'restaurant.auto_approved',
    target: { type: 'restaurant', id: restaurantId, label: restaurant.name },
    reason: `Contrôles réussis (${source}) : ${summary}`.slice(0, 900),
    before: { onboardingStatus: restaurant.onboardingStatus, status: restaurant.status },
    after: { onboardingStatus: 'approved', status: goLive ? 'active' : restaurant.status, checks: evaluation.checks.length },
    countryId: restaurant.countryId,
    cityId: restaurant.cityId,
  });
  await sendPlatformMessage(
    'restaurant_auto_approved',
    { uid: restaurant.ownerId, type: 'restaurant', email: restaurant.email ?? null, demo: (snap.get('seed') as boolean | undefined) === true || (snap.get('test') as boolean | undefined) === true },
    { restaurantName: restaurant.name },
    { dedupeKey: restaurantId, link: { type: 'page', target: '/' } },
  );
  logger.info('Commerce validé automatiquement', { restaurantId, source });
  return { outcome: 'approved', checks: evaluation.checks };
}

// ------------------------------------------------------------------ Réglage (super admin)

const settingsSchema = z.object({
  mode: z.enum(MERCHANT_VALIDATION_MODES),
  requireContract: z.boolean(),
  checkRegistrationNumber: z.boolean(),
  minDocumentValidityDays: z.number().int().min(0).max(365),
  registrationDocumentMaxAgeDays: z.number().int().min(0).max(730),
  requireActiveCity: z.boolean(),
  goLive: z.boolean(),
  countryIds: z.array(z.string().trim().min(2).max(3)).max(12).nullable(),
  maxPerDay: z.number().int().min(0).max(1000),
  reason: zReason,
});

export const updateMerchantValidation = callable(
  settingsSchema,
  async (data, request) => {
    const { caller, admin } = await requireAdmin(request, 'restaurants.validate');
    if (admin.role !== 'super_admin' && (admin.cityIds.length > 0 || admin.countryIds.length > 0)) {
      throw fail.forbidden('La validation automatique s’applique à toute la plateforme : réglage réservé à l’équipe centrale.');
    }
    const { reason, ...next } = data;
    const ref = db.collection(COLLECTIONS.settings).doc(SETTINGS_DOCS.merchantValidation);
    const before = plain((await ref.get()).data() ?? DEFAULT_MERCHANT_VALIDATION);
    await ref.set({ ...next, updatedAt: FieldValue.serverTimestamp(), updatedBy: caller.uid });
    const fields = await writeSettingsHistory({ docPath: `${COLLECTIONS.settings}/${SETTINGS_DOCS.merchantValidation}`, before, after: next as unknown as Record<string, unknown>, reason, caller });
    await writeAudit({
      actor: actorFromCaller(caller, 'admin'),
      action: 'merchant_validation.updated',
      target: { type: 'setting', id: SETTINGS_DOCS.merchantValidation, label: 'Validation automatique des commerces' },
      reason,
      before,
      after: next as unknown as Record<string, unknown>,
      sensitive: true,
      request,
    });
    return { updatedFields: fields };
  },
  { ...OPS_RUNTIME },
);

/** « Vérifier maintenant » : rejoue les contrôles sur un dossier (sans jamais le valider à la main). */
export const runMerchantValidationCheck = callable(
  z.object({ restaurantId: zId, apply: z.boolean().default(false) }),
  async (data, request) => {
    const { caller, admin } = await requireAdmin(request, 'restaurants.validate');
    const snap = await restaurantRef(data.restaurantId).get();
    if (!snap.exists) throw fail.notFound('Restaurant');
    const city = snap.get('cityId') as string | undefined;
    if (admin.role !== 'super_admin' && admin.cityIds.length > 0 && (!city || !admin.cityIds.includes(city))) throw fail.forbidden('Ce dossier est hors de votre périmètre.');
    const result = await tryAutoValidateRestaurant(data.restaurantId, 'manual', { apply: data.apply, actor: actorFromCaller(caller, 'admin') });
    return { outcome: result.outcome, checks: result.checks };
  },
  { ...OPS_RUNTIME, secrets: EMAIL_SECRETS },
);
