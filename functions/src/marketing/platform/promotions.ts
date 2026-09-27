// Promotions du super admin (cahier §18) : offres plateforme, pays, ville ou
// restaurant, financement GoLink / restaurant / partagé, ciblage ; validation
// et cycle de vie des offres créées par les restaurants.
import {
  COLLECTIONS,
  FULFILLMENT_MODES,
  PROMOTION_FUNDINGS,
  PROMOTION_KINDS,
  PROMOTION_SCOPES,
  PROMOTION_TARGETS,
  PROMO_CODE_PATTERN,
  formatPrice,
  type AdminUser,
  type Promotion,
  type PromotionStatus,
  type Restaurant,
} from '@golink/shared';
import { db, Timestamp } from '../../lib/admin';
import { actorFromCaller, writeAudit } from '../../lib/audit';
import { callable } from '../../lib/callable';
import { fail } from '../../lib/errors';
import { assertFeatureOn } from '../../lib/features';
import { assertAdminCovers, requireAdmin } from '../../lib/permissions';
import { z, zId, zReason } from '../../lib/validation';
import { pushInApp } from './common';

const LIVE: PromotionStatus[] = ['draft', 'pending_review', 'active', 'paused'];

const schema = z.object({
  /** Motif de la création ou de la modification (remise financée par la plateforme). */
  reason: zReason,
  promotionId: zId.nullish(),
  scope: z.enum(PROMOTION_SCOPES),
  countryId: z.string().trim().min(2).max(3).nullable().default(null),
  cityIds: z.array(zId).max(30).default([]),
  /** Restaurants participants (offre plateforme) ou restaurant unique (portée restaurant). */
  restaurantIds: z.array(zId).max(100).default([]),
  title: z.string().trim().min(3, 'Le titre doit contenir au moins 3 caractères.').max(80),
  description: z.string().trim().max(240).nullable().default(null),
  code: z
    .string()
    .trim()
    .transform((v) => v.toUpperCase().replace(/\s+/g, ''))
    .pipe(z.string().regex(PROMO_CODE_PATTERN, 'Le code doit contenir 3 à 24 lettres, chiffres, tirets ou tirets bas.'))
    .nullable()
    .default(null),
  kind: z.enum(PROMOTION_KINDS),
  value: z.number().int().min(0).max(100_000),
  maxDiscountCents: z.number().int().min(100).max(100_000).nullable().default(null),
  minSubtotalCents: z.number().int().min(0).max(100_000),
  funding: z.enum(PROMOTION_FUNDINGS),
  restaurantShareBps: z.number().int().min(100).max(9900).nullable().default(null),
  target: z.enum(PROMOTION_TARGETS),
  inactiveDays: z.number().int().min(7).max(365).nullable().default(null),
  modes: z.array(z.enum(FULFILLMENT_MODES)).min(1, 'Choisissez au moins un mode de commande.').max(3),
  totalUsageLimit: z.number().int().min(1).max(1_000_000).nullable().default(null),
  perCustomerLimit: z.number().int().min(1).max(100),
  startsAt: z.number().int(),
  endsAt: z.number().int().nullable().default(null),
  showcase: z.boolean().default(true),
  publish: z.boolean().default(false),
});

type Input = z.output<typeof schema>;

async function loadRestaurants(ids: string[]): Promise<Array<Restaurant & { id: string }>> {
  if (ids.length === 0) return [];
  const snaps = await db.getAll(...ids.map((id) => db.collection(COLLECTIONS.restaurants).doc(id)));
  return snaps.map((s) => {
    if (!s.exists) throw fail.notFound('Restaurant');
    return { id: s.id, ...(s.data() as Restaurant) };
  });
}

/** Portée de l'offre dans le périmètre de l'administrateur. */
function assertScopeCovered(admin: AdminUser, scope: Promotion['scope'], cityIds: string[]) {
  if (admin.role === 'super_admin' || admin.cityIds.length === 0) return;
  if (scope === 'platform' || scope === 'country') {
    throw fail.forbidden('Une offre nationale ou plateforme dépasse votre périmètre : limitez-la à vos villes.');
  }
  for (const cityId of cityIds) assertAdminCovers(admin, cityId);
}

function normalize(data: Input) {
  const f = { ...data, modes: [...new Set(data.modes)] };
  if (f.kind === 'percentage') {
    if (f.value < 100 || f.value > 10_000) throw fail.invalid('Le pourcentage doit être compris entre 1 % et 100 %.');
  } else {
    f.maxDiscountCents = null;
  }
  if (f.kind === 'fixed') {
    if (f.value < 50) throw fail.invalid('La remise doit être d’au moins 0,50 €.');
    if (f.minSubtotalCents < f.value) throw fail.invalid(`Fixez un panier minimum d’au moins ${formatPrice(f.value)} (montant de la remise).`);
  }
  if (f.kind === 'free_delivery') {
    f.value = 0;
    if (!f.modes.includes('delivery')) throw fail.invalid('La livraison offerte doit s’appliquer au mode Livraison.');
  }
  if (f.target === 'inactive_customers') f.inactiveDays ??= 30;
  else f.inactiveDays = null;
  if (f.funding === 'shared') {
    if (!f.restaurantShareBps) throw fail.invalid('Indiquez la part financée par les restaurants.');
  } else {
    f.restaurantShareBps = null;
  }
  if (f.endsAt !== null && f.endsAt <= f.startsAt) throw fail.invalid('La date de fin doit être postérieure à la date de début.');
  if (f.endsAt !== null && f.endsAt < Date.now()) throw fail.invalid('La date de fin est déjà passée.');
  if (f.totalUsageLimit !== null && f.totalUsageLimit < f.perCustomerLimit) {
    throw fail.invalid('Le nombre total d’utilisations doit être au moins égal à la limite par client.');
  }
  return f;
}

async function assertCodeFree(code: string | null, exceptId?: string | null) {
  if (!code) return;
  const snap = await db.collection(COLLECTIONS.promotions).where('code', '==', code).get();
  const clash = snap.docs.find((d) => d.id !== exceptId && LIVE.includes((d.data() as Promotion).status));
  if (clash) throw fail.alreadyExists(`Le code ${code} est déjà utilisé par une offre en cours.`);
}

/** Création ou modification d'une offre par l'équipe GoLink. */
export const createPlatformPromotion = callable(schema, async (data, request) => {
  const { caller, admin } = await requireAdmin(request, 'promotions.edit');
  await assertFeatureOn('promotions', {}, 'Les promotions sont désactivées : réactivez la fonctionnalité pour créer une offre.');
  const f = normalize(data);

  let countryId: string | null = f.countryId;
  let cityIds = [...new Set(f.cityIds)];
  let restaurantId: string | null = null;
  let restaurantIds = [...new Set(f.restaurantIds)];

  if (f.scope === 'restaurant') {
    if (restaurantIds.length !== 1) throw fail.invalid('Choisissez le restaurant concerné par l’offre.');
    const [restaurant] = await loadRestaurants(restaurantIds);
    if (!restaurant) throw fail.notFound('Restaurant');
    restaurantId = restaurant.id;
    restaurantIds = [];
    cityIds = [restaurant.cityId];
    countryId = restaurant.countryId;
  } else {
    const participants = await loadRestaurants(restaurantIds);
    if (f.scope === 'platform') {
      countryId = null;
      cityIds = [];
    }
    if (f.scope === 'country') {
      if (!countryId) throw fail.invalid('Choisissez le pays de l’offre.');
      cityIds = [];
    }
    if (f.scope === 'city') {
      if (cityIds.length === 0) throw fail.invalid('Choisissez au moins une ville.');
      const cities = await db.getAll(...cityIds.map((id) => db.collection(COLLECTIONS.cities).doc(id)));
      if (cities.some((c) => !c.exists)) throw fail.notFound('Ville');
      const countries = new Set(cities.map((c) => c.get('countryId') as string));
      if (countries.size > 1) throw fail.invalid('Les villes d’une même offre doivent appartenir au même pays.');
      countryId = [...countries][0] ?? null;
    }
    for (const r of participants) {
      if (f.scope === 'city' && !cityIds.includes(r.cityId)) throw fail.invalid(`${r.name} n’est pas dans les villes de l’offre.`);
      if (f.scope === 'country' && r.countryId !== countryId) throw fail.invalid(`${r.name} n’est pas dans le pays de l’offre.`);
    }
    if (f.funding !== 'platform' && participants.length === 0) {
      throw fail.invalid('Une offre financée par les restaurants doit lister les restaurants participants.');
    }
  }
  assertScopeCovered(admin, f.scope, cityIds);
  await assertCodeFree(f.code, data.promotionId);

  const now = Timestamp.now();
  const fields = {
    scope: f.scope,
    countryId,
    cityIds,
    restaurantId,
    restaurantIds,
    title: { fr: f.title },
    description: f.description ? { fr: f.description } : null,
    code: f.code,
    kind: f.kind,
    value: f.value,
    maxDiscountCents: f.maxDiscountCents,
    minSubtotalCents: f.minSubtotalCents,
    funding: f.funding,
    restaurantShareBps: f.restaurantShareBps,
    target: f.target,
    inactiveDays: f.inactiveDays,
    modes: f.modes,
    totalUsageLimit: f.totalUsageLimit,
    perCustomerLimit: f.perCustomerLimit,
    startsAt: Timestamp.fromMillis(f.startsAt),
    endsAt: f.endsAt === null ? null : Timestamp.fromMillis(f.endsAt),
    showcase: f.showcase,
    updatedAt: now,
    updatedBy: caller.uid,
  };

  const audit = {
    actor: actorFromCaller(caller, 'admin'),
    reason: data.reason,
    countryId,
    cityId: cityIds.length === 1 ? cityIds[0] : null,
    request,
  };

  if (data.promotionId) {
    const ref = db.collection(COLLECTIONS.promotions).doc(data.promotionId);
    const snap = await ref.get();
    const before = snap.data() as Promotion | undefined;
    if (!before) throw fail.notFound('Offre');
    if (before.status === 'ended' || before.status === 'rejected') throw fail.precondition('Cette offre est close : dupliquez-la pour la relancer.');
    assertScopeCovered(admin, before.scope, before.cityIds ?? []);
    const status: PromotionStatus = data.publish && before.status === 'draft' ? 'active' : before.status;
    await ref.update({ ...fields, status, ...(status === 'active' && before.status !== 'active' ? { approvedAt: now } : {}) });
    await writeAudit({
      ...audit,
      action: 'promotion.updated',
      target: { type: 'promotion', id: ref.id, label: f.title },
      before: { kind: before.kind, value: before.value, funding: before.funding, status: before.status, code: before.code ?? null },
      after: { kind: f.kind, value: f.value, funding: f.funding, status, code: f.code },
    });
    return { promotionId: ref.id, status };
  }

  const ref = db.collection(COLLECTIONS.promotions).doc();
  const status: PromotionStatus = data.publish ? 'active' : 'draft';
  await ref.set({
    ...fields,
    status,
    reviewNote: null,
    accent: null,
    stats: { redemptions: 0, discountCents: 0, ordersSubtotalCents: 0, newCustomers: 0 },
    submittedAt: null,
    approvedAt: status === 'active' ? now : null,
    pausedAt: null,
    endedAt: null,
    createdAt: now,
    createdBy: caller.uid,
  });
  await writeAudit({
    ...audit,
    action: 'promotion.created',
    target: { type: 'promotion', id: ref.id, label: f.title },
    after: { scope: f.scope, kind: f.kind, value: f.value, funding: f.funding, target: f.target, status, code: f.code },
  });
  return { promotionId: ref.id, status };
});

// ------------------------------------------------------------------ Cycle de vie

const statusSchema = z.object({
  promotionId: zId,
  action: z.enum(['approve', 'reject', 'pause', 'resume', 'end']),
  reason: zReason.nullish(),
});

const TRANSITIONS: Record<z.output<typeof statusSchema>['action'], { from: PromotionStatus[]; to: PromotionStatus; needsReason: boolean; audit: string }> = {
  approve: { from: ['pending_review'], to: 'active', needsReason: false, audit: 'promotion.approved' },
  reject: { from: ['pending_review'], to: 'rejected', needsReason: true, audit: 'promotion.rejected' },
  pause: { from: ['active'], to: 'paused', needsReason: true, audit: 'promotion.paused' },
  resume: { from: ['paused', 'draft'], to: 'active', needsReason: false, audit: 'promotion.activated' },
  end: { from: ['draft', 'pending_review', 'active', 'paused'], to: 'ended', needsReason: true, audit: 'promotion.ended' },
};

/** Validation, refus, pause, reprise ou arrêt d'une offre (motif conservé dans le journal). */
export const setPromotionStatus = callable(statusSchema, async (data, request) => {
  const { caller, admin } = await requireAdmin(request, 'promotions.edit');
  const rule = TRANSITIONS[data.action];
  if (rule.needsReason && !data.reason) throw fail.invalid('Indiquez un motif : il est conservé dans le journal d’audit.');
  const ref = db.collection(COLLECTIONS.promotions).doc(data.promotionId);
  const now = Timestamp.now();

  const before = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const promo = snap.data() as Promotion | undefined;
    if (!promo) throw fail.notFound('Offre');
    assertScopeCovered(admin, promo.scope, promo.cityIds ?? []);
    if (!rule.from.includes(promo.status)) throw fail.precondition('Cette action n’est plus possible : l’offre a changé de statut.');
    if (rule.to === 'active' && promo.endsAt && promo.endsAt.toMillis() < Date.now()) {
      throw fail.precondition('La date de fin de l’offre est passée : prolongez-la avant de la remettre en ligne.');
    }
    const patch: Record<string, unknown> = { status: rule.to, updatedAt: now, updatedBy: caller.uid };
    if (data.action === 'approve') Object.assign(patch, { approvedAt: now, reviewNote: data.reason ?? 'Validée par GoLink.' });
    if (data.action === 'reject') Object.assign(patch, { reviewNote: data.reason, showcase: false });
    if (data.action === 'pause') Object.assign(patch, { pausedAt: now });
    if (data.action === 'resume' && promo.status === 'draft') Object.assign(patch, { approvedAt: now });
    if (data.action === 'end') Object.assign(patch, { endedAt: now, ...(promo.endsAt && promo.endsAt.toMillis() < now.toMillis() ? {} : { endsAt: now }) });
    tx.update(ref, patch);
    return promo;
  });

  await writeAudit({
    actor: actorFromCaller(caller, 'admin'),
    action: rule.audit,
    target: { type: 'promotion', id: ref.id, label: before.title.fr },
    reason: data.reason ?? null,
    before: { status: before.status },
    after: { status: rule.to },
    countryId: before.countryId ?? null,
    cityId: before.cityIds?.[0] ?? null,
    request,
  });

  // Le restaurant est prévenu des décisions sur ses offres.
  if (before.scope === 'restaurant' && before.restaurantId && ['approve', 'reject', 'pause', 'end'].includes(data.action)) {
    const restaurant = await db.collection(COLLECTIONS.restaurants).doc(before.restaurantId).get();
    const ownerId = restaurant.get('ownerId') as string | undefined;
    const title = before.title.fr;
    const messages = {
      approve: { t: 'Offre validée', b: `Votre offre « ${title} » est validée et visible des clients.` },
      reject: { t: 'Offre refusée', b: `Votre offre « ${title} » n’a pas été validée : ${data.reason}` },
      pause: { t: 'Offre mise en pause', b: `GoLink a mis en pause votre offre « ${title} » : ${data.reason}` },
      end: { t: 'Offre arrêtée', b: `GoLink a arrêté votre offre « ${title} » : ${data.reason}` },
    } as const;
    const m = messages[data.action as keyof typeof messages];
    if (ownerId && m) await pushInApp(ownerId, { title: m.t, body: m.b, category: 'promotion', link: { type: 'page', target: '/promotions' } });
  }
  return { promotionId: ref.id, status: rule.to };
});

