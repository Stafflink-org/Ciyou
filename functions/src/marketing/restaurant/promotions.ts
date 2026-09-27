// Promotions créées par un établissement : codes promo et offres automatiques
// financés par le restaurant, encadrés par les plafonds de settings/promotions.
import {
  COLLECTIONS,
  FULFILLMENT_MODES,
  PROMOTION_KINDS,
  PROMOTION_TARGETS,
  PROMO_CODE_PATTERN,
  RESTAURANT_PROMOTION_RULES,
  SETTINGS_DOCS,
  formatPrice,
  type Promotion,
  type PromotionSettings,
  type PromotionStatus,
} from '@golink/shared';
import { db, Timestamp } from '../../lib/admin';
import { actorFromCaller, writeAudit } from '../../lib/audit';
import { callable } from '../../lib/callable';
import { fail } from '../../lib/errors';
import { assertFeatureOn, scopeOfRestaurant } from '../../lib/features';
import { requireRestaurantAccess, type RestaurantActor } from '../../lib/permissions';
import { z, zId } from '../../lib/validation';
import { assertFeatureAllowed, assertWithinLimit } from '../../finance/argent/entitlements';
import { moveToTrash } from '../../platform/backups';
import { loadRestaurant, type RestaurantDoc } from './helpers';

const DAY = 86_400_000;

const DEFAULT_SETTINGS: Pick<PromotionSettings, 'capsEnabled' | 'restaurantMaxPercentBps' | 'restaurantMaxFixedCents' | 'restaurantRequiresReview' | 'maxActivePerRestaurant'> = {
  // Décision client : promotions des commerces sans limite ni validation (aligné sur les réglages de la plateforme).
  capsEnabled: false,
  restaurantMaxPercentBps: 5000,
  restaurantMaxFixedCents: 1500,
  restaurantRequiresReview: false,
  maxActivePerRestaurant: 3,
};

async function loadSettings() {
  const snap = await db.collection(COLLECTIONS.settings).doc(SETTINGS_DOCS.promotions).get();
  return { ...DEFAULT_SETTINGS, ...((snap.data() as Partial<PromotionSettings> | undefined) ?? {}) };
}

const fieldsSchema = z.object({
  title: z.string().trim().min(3, 'Le titre doit contenir au moins 3 caractères.').max(RESTAURANT_PROMOTION_RULES.titleMax),
  description: z.string().trim().max(RESTAURANT_PROMOTION_RULES.descriptionMax).nullable().default(null),
  code: z
    .string()
    .trim()
    .transform((v) => v.toUpperCase().replace(/\s+/g, ''))
    .pipe(z.string().regex(PROMO_CODE_PATTERN, 'Le code doit contenir 3 à 24 lettres, chiffres, tirets ou tirets bas.'))
    .nullable(),
  kind: z.enum(PROMOTION_KINDS),
  /** Points de base pour un pourcentage, centimes pour un montant fixe, 0 pour la livraison offerte. */
  value: z.number().int().min(0).max(100_000),
  maxDiscountCents: z.number().int().min(100).max(100_000).nullable().default(null),
  minSubtotalCents: z.number().int().min(0).max(RESTAURANT_PROMOTION_RULES.maxMinSubtotalCents),
  target: z.enum(PROMOTION_TARGETS),
  inactiveDays: z
    .number()
    .int()
    .min(RESTAURANT_PROMOTION_RULES.inactiveDaysMin)
    .max(RESTAURANT_PROMOTION_RULES.inactiveDaysMax)
    .nullable()
    .default(null),
  modes: z.array(z.enum(FULFILLMENT_MODES)).min(1, 'Choisissez au moins un mode de commande.').max(3),
  totalUsageLimit: z.number().int().min(1).max(RESTAURANT_PROMOTION_RULES.maxTotalUsageLimit).nullable().default(null),
  perCustomerLimit: z.number().int().min(1).max(RESTAURANT_PROMOTION_RULES.maxPerCustomerLimit),
  /** Millisecondes depuis l'époque. */
  startsAt: z.number().int(),
  endsAt: z.number().int().nullable(),
});
type PromotionFields = z.output<typeof fieldsSchema>;

/** Plafonds techniques, appliqués même lorsque la plateforme ne fixe aucun plafond. */
const HARD_MAX_PERCENT_BPS = 10_000;
const HARD_MAX_FIXED_CENTS = 20_000;

/** Règles métier et plafonds de la plateforme ; renvoie les champs normalisés. */
function validateFields(fields: PromotionFields, settings: Awaited<ReturnType<typeof loadSettings>>, isNew: boolean) {
  const now = Date.now();
  const capped = settings.capsEnabled !== false;
  const f = { ...fields, modes: [...new Set(fields.modes)] };
  if (f.kind === 'percentage') {
    if (f.value < 100) throw fail.invalid('Le pourcentage doit être d’au moins 1 %.');
    if (f.value > HARD_MAX_PERCENT_BPS) throw fail.invalid('Le pourcentage ne peut pas dépasser 100 %.');
    if (capped && f.value > settings.restaurantMaxPercentBps) {
      throw fail.invalid(`GoLink limite les remises des établissements à ${settings.restaurantMaxPercentBps / 100} %.`);
    }
  } else {
    f.maxDiscountCents = null;
  }
  if (f.kind === 'fixed') {
    if (f.value < 50) throw fail.invalid('La remise doit être d’au moins 0,50 €.');
    if (f.value > HARD_MAX_FIXED_CENTS) throw fail.invalid(`La remise ne peut pas dépasser ${formatPrice(HARD_MAX_FIXED_CENTS)}.`);
    if (capped && f.value > settings.restaurantMaxFixedCents) {
      throw fail.invalid(`GoLink limite les remises fixes des établissements à ${formatPrice(settings.restaurantMaxFixedCents)}.`);
    }
    if (f.minSubtotalCents < f.value) throw fail.invalid('Fixez un panier minimum au moins égal au montant de la remise.');
  }
  if (f.kind === 'free_delivery') {
    f.value = 0;
    if (!f.modes.includes('delivery')) throw fail.invalid('La livraison offerte doit s’appliquer au mode Livraison.');
  }
  if (f.target === 'inactive_customers') {
    f.inactiveDays ??= 45;
  } else {
    f.inactiveDays = null;
  }
  if (isNew && f.startsAt < now - DAY) throw fail.invalid('La date de début ne peut pas être dans le passé.');
  const startsAt = Math.max(f.startsAt, isNew ? now : f.startsAt);
  if (f.endsAt !== null) {
    if (f.endsAt <= startsAt) throw fail.invalid('La date de fin doit être postérieure à la date de début.');
    if (f.endsAt < now) throw fail.invalid('La date de fin est déjà passée.');
    if (f.endsAt - startsAt > RESTAURANT_PROMOTION_RULES.maxDurationDays * DAY) {
      throw fail.invalid('Une offre ne peut pas durer plus d’un an.');
    }
  }
  if (f.totalUsageLimit !== null && f.totalUsageLimit < f.perCustomerLimit) {
    throw fail.invalid('Le nombre total d’utilisations doit être au moins égal à la limite par client.');
  }
  return { ...f, startsAt };
}

function restaurantPromotions(restaurantId: string) {
  return db.collection(COLLECTIONS.promotions).where('scope', '==', 'restaurant').where('restaurantId', '==', restaurantId);
}

/** Un code ne peut exister qu'une fois parmi les offres vivantes de l'établissement et les offres GoLink. */
async function assertCodeAvailable(restaurantId: string, code: string | null, exceptId?: string) {
  if (!code) return;
  const live: PromotionStatus[] = ['draft', 'pending_review', 'active', 'paused'];
  const snap = await db.collection(COLLECTIONS.promotions).where('code', '==', code).get();
  for (const doc of snap.docs) {
    if (doc.id === exceptId) continue;
    const p = doc.data() as Promotion;
    if (!live.includes(p.status)) continue;
    if (p.scope === 'restaurant' && p.restaurantId === restaurantId) throw fail.alreadyExists('Ce code existe déjà pour cet établissement.');
    if (p.scope !== 'restaurant') throw fail.alreadyExists('Ce code est déjà utilisé par une offre GoLink. Choisissez-en un autre.');
  }
}

/** Nombre d'offres actives ou en validation (plafond fixé par la plateforme, s'il est activé). */
async function assertActiveQuota(restaurantId: string, settings: Awaited<ReturnType<typeof loadSettings>>, exceptId?: string) {
  if (settings.capsEnabled === false) return;
  const max = settings.maxActivePerRestaurant;
  const snap = await restaurantPromotions(restaurantId).where('status', 'in', ['active', 'pending_review']).get();
  const count = snap.docs.filter((d) => d.id !== exceptId).length;
  if (count >= max) {
    throw fail.precondition(`Vous avez déjà ${count} offre${count > 1 ? 's' : ''} en ligne ou en validation (maximum ${max}). Mettez-en une en pause ou terminez-la.`);
  }
}

function toStoredFields(f: ReturnType<typeof validateFields>) {
  return {
    title: { fr: f.title },
    description: f.description ? { fr: f.description } : null,
    code: f.code,
    kind: f.kind,
    value: f.value,
    maxDiscountCents: f.maxDiscountCents,
    minSubtotalCents: f.minSubtotalCents,
    target: f.target,
    inactiveDays: f.inactiveDays,
    modes: f.modes,
    totalUsageLimit: f.totalUsageLimit,
    perCustomerLimit: f.perCustomerLimit,
    startsAt: Timestamp.fromMillis(f.startsAt),
    endsAt: f.endsAt === null ? null : Timestamp.fromMillis(f.endsAt),
  };
}

function auditBase(actor: RestaurantActor, restaurant: RestaurantDoc) {
  return {
    actor: actorFromCaller(actor.caller, actor.kind === 'admin' ? 'admin' : 'restaurant'),
    countryId: restaurant.countryId,
    cityId: restaurant.cityId,
  };
}

/** Statut atteint à la soumission : validation GoLink, ou mise en ligne directe. */
function submittedState(settings: Awaited<ReturnType<typeof loadSettings>>, code: string | null) {
  const now = Timestamp.now();
  return settings.restaurantRequiresReview
    ? { status: 'pending_review' as const, submittedAt: now, reviewNote: null }
    : { status: 'active' as const, submittedAt: now, approvedAt: now, showcase: code === null, reviewNote: null };
}

// ------------------------------------------------------------------ Création

export const createPromotion = callable(
  fieldsSchema.extend({ restaurantId: zId, submit: z.boolean().default(false) }),
  async (data, request) => {
    const actor = await requireRestaurantAccess(request, data.restaurantId, 'marketing.manage', 'promotions.edit');
    const [restaurant, settings] = await Promise.all([loadRestaurant(data.restaurantId), loadSettings()]);
    // Formule et impayé : « codes promo » coupé pendant une restriction, nombre d'offres limité par la formule.
    await assertFeatureAllowed(restaurant.id, 'promo_codes');
    await assertFeatureOn('promotions', scopeOfRestaurant(restaurant, data.restaurantId), 'Les promotions sont désactivées par GoLink pour cet établissement.');
    const live = await restaurantPromotions(restaurant.id).where('status', 'in', ['active', 'pending_review']).get();
    await assertWithinLimit(restaurant.id, 'maxPromotions', live.size, 'offres en ligne');
    const f = validateFields(data, settings, true);
    await assertCodeAvailable(restaurant.id, f.code);
    if (data.submit) await assertActiveQuota(restaurant.id, settings);

    const now = Timestamp.now();
    const ref = db.collection(COLLECTIONS.promotions).doc();
    const lifecycle = data.submit ? submittedState(settings, f.code) : { status: 'draft' as const, reviewNote: null, submittedAt: null };
    const promotion: Promotion = {
      scope: 'restaurant',
      countryId: restaurant.countryId,
      cityIds: [restaurant.cityId],
      restaurantId: restaurant.id,
      restaurantIds: [],
      ...toStoredFields(f),
      funding: 'restaurant',
      restaurantShareBps: null,
      showcase: false,
      accent: restaurant.accent ?? null,
      stats: { redemptions: 0, discountCents: 0, ordersSubtotalCents: 0, newCustomers: 0 },
      approvedAt: null,
      pausedAt: null,
      endedAt: null,
      createdAt: now,
      createdBy: actor.caller.uid,
      updatedAt: now,
      updatedBy: actor.caller.uid,
      ...lifecycle,
    };
    await ref.set(promotion);
    await writeAudit({
      ...auditBase(actor, restaurant),
      action: 'promotion.created',
      target: { type: 'promotion', id: ref.id, label: f.code ?? f.title },
      after: { status: promotion.status, kind: f.kind, value: f.value, code: f.code },
      request,
    });
    return { promotionId: ref.id, status: promotion.status };
  },
);

// ------------------------------------------------------------------ Modification et cycle de vie

const updateSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('edit'), promotionId: zId, fields: fieldsSchema, submit: z.boolean().default(false) }),
  z.object({ action: z.enum(['submit', 'withdraw', 'pause', 'resume', 'end', 'delete']), promotionId: zId }),
]);

const ACTION_LABELS = {
  submit: 'promotion.submitted',
  withdraw: 'promotion.withdrawn',
  pause: 'promotion.paused',
  resume: 'promotion.resumed',
  end: 'promotion.ended',
  delete: 'promotion.deleted',
} as const;

/** Champs dont la modification change l'offre elle-même (nouvelle validation). */
const MATERIAL_FIELDS = ['code', 'kind', 'value', 'maxDiscountCents', 'minSubtotalCents', 'target', 'inactiveDays', 'modes'] as const;

export const updatePromotion = callable(updateSchema, async (data, request) => {
  const ref = db.collection(COLLECTIONS.promotions).doc(data.promotionId);
  const snap = await ref.get();
  if (!snap.exists) throw fail.notFound('Offre');
  const current = snap.data() as Promotion;
  if (current.scope !== 'restaurant' || !current.restaurantId) throw fail.forbidden('Cette offre est gérée par GoLink.');
  const actor = await requireRestaurantAccess(request, current.restaurantId, 'marketing.manage', 'promotions.edit');
  const [restaurant, settings] = await Promise.all([loadRestaurant(current.restaurantId), loadSettings()]);
  const now = Timestamp.now();
  const stamp = { updatedAt: now, updatedBy: actor.caller.uid };
  const expired = current.endsAt ? current.endsAt.toMillis() < Date.now() : false;
  let patch: Partial<Promotion> & Record<string, unknown>;

  switch (data.action) {
    case 'edit': {
      if (current.status === 'ended') throw fail.precondition('Une offre terminée ne peut plus être modifiée.');
      const f = validateFields(data.fields, settings, false);
      const stored = toStoredFields(f);
      const materialChange = MATERIAL_FIELDS.some((key) => JSON.stringify(stored[key]) !== JSON.stringify(current[key] ?? null));
      if (current.stats.redemptions > 0 && materialChange) {
        throw fail.precondition('Cette offre a déjà été utilisée : pour changer la remise, le code ou les conditions, terminez-la et créez-en une nouvelle.');
      }
      if (f.code !== current.code) await assertCodeAvailable(restaurant.id, f.code, ref.id);
      patch = { ...stored, ...stamp };
      const live = current.status === 'active' || current.status === 'paused';
      if (live && materialChange && settings.restaurantRequiresReview) {
        patch = { ...patch, status: 'pending_review', submittedAt: now, reviewNote: null, showcase: false };
      } else if (data.submit && (current.status === 'draft' || current.status === 'rejected')) {
        await assertActiveQuota(restaurant.id, settings, ref.id);
        patch = { ...patch, ...submittedState(settings, f.code) };
      }
      break;
    }
    case 'submit':
      if (current.status !== 'draft' && current.status !== 'rejected') throw fail.precondition('Seul un brouillon peut être soumis.');
      if (expired) throw fail.precondition('La date de fin est passée : modifiez les dates avant de soumettre.');
      await assertActiveQuota(restaurant.id, settings, ref.id);
      patch = { ...submittedState(settings, current.code ?? null), ...stamp };
      break;
    case 'withdraw':
      if (current.status !== 'pending_review') throw fail.precondition('Cette offre n’est pas en validation.');
      patch = { status: 'draft', submittedAt: null, ...stamp };
      break;
    case 'pause':
      if (current.status !== 'active') throw fail.precondition('Seule une offre en ligne peut être mise en pause.');
      patch = { status: 'paused', pausedAt: now, showcase: false, ...stamp };
      break;
    case 'resume': {
      if (current.status !== 'paused') throw fail.precondition('Cette offre n’est pas en pause.');
      if (expired) throw fail.precondition('Cette offre a expiré : prolongez sa date de fin pour la relancer.');
      await assertActiveQuota(restaurant.id, settings, ref.id);
      const approved = Boolean(current.approvedAt) || !settings.restaurantRequiresReview;
      patch = approved
        ? { status: 'active', pausedAt: null, showcase: (current.code ?? null) === null, ...stamp }
        : { ...submittedState(settings, current.code ?? null), pausedAt: null, ...stamp };
      break;
    }
    case 'end':
      if (!['active', 'paused', 'pending_review'].includes(current.status)) throw fail.precondition('Cette offre n’est pas en cours.');
      patch = { status: 'ended', endedAt: now, showcase: false, ...stamp };
      break;
    case 'delete':
      if (!['draft', 'rejected'].includes(current.status) || current.stats.redemptions > 0) {
        throw fail.precondition('Seul un brouillon jamais utilisé peut être supprimé. Terminez plutôt cette offre.');
      }
      // Corbeille générique (§31) : restaurable pendant le délai réglé, avant suppression réelle.
      await moveToTrash({
        entity: { type: 'promotion', id: ref.id, label: current.code ?? current.title.fr },
        path: ref.path,
        snapshot: current as unknown as Record<string, unknown>,
        restaurantId: current.restaurantId ?? null,
        deletedBy: actor.caller.uid,
        reason: 'Suppression du brouillon par le commerce',
      });
      await ref.delete();
      await writeAudit({
        ...auditBase(actor, restaurant),
        action: ACTION_LABELS.delete,
        target: { type: 'promotion', id: ref.id, label: current.code ?? current.title.fr },
        before: { status: current.status, code: current.code ?? null },
        request,
      });
      return { promotionId: ref.id, status: 'deleted' as const };
  }

  await ref.update(patch);
  await writeAudit({
    ...auditBase(actor, restaurant),
    action: data.action === 'edit' ? 'promotion.updated' : ACTION_LABELS[data.action],
    target: { type: 'promotion', id: ref.id, label: current.code ?? current.title.fr },
    before: { status: current.status },
    after: { status: (patch.status as string | undefined) ?? current.status },
    request,
  });
  return { promotionId: ref.id, status: (patch.status as PromotionStatus | undefined) ?? current.status };
});
