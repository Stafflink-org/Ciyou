// Affichage de l'app client : publication versionnée des pages d'information et
// des documents légaux, vente d'emplacements sponsorisés (prix du catalogue,
// capacité, crédit publicitaire), cycle de vie des emplacements, réglages de
// classement et du support.
import {
  COLLECTIONS,
  RESTAURANT_PRIVATE_DOCS,
  SETTINGS_DOCS,
  SUBCOLLECTIONS,
  type ContentPage,
  type ContentPageVersion,
  type LegalDocument,
  type Restaurant,
  type RestaurantCommercial,
  type SponsoredOffer,
  type SponsoredPlacement,
} from '@golink/shared';
import { logger } from 'firebase-functions/v2';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { db, FieldValue, Timestamp } from '../../lib/admin';
import { actorFromCaller, writeAudit } from '../../lib/audit';
import { fail } from '../../lib/errors';
import { assertAdminCovers, requireAdmin } from '../../lib/permissions';
import { z, zId, zReason } from '../../lib/validation';
import { EXPERIENCE_RUNTIME, euros, experienceCallable, parisDay } from './common';
import { recordSettingsChange } from '../../platform/runtime';
import { recomputeRankingScores } from './ranking';

const DAY = 86_400_000;

// ------------------------------------------------------------------ Pages et documents légaux

export const publishPage = experienceCallable(
  z.object({
    kind: z.enum(['page', 'legal']),
    id: z.string().trim().min(1).max(128).regex(/^[a-z0-9_-]+$/i, 'Identifiant invalide'),
    /** Motif de la publication (obligatoire) : résumé du changement conservé dans le journal d'audit. */
    changeSummary: z.string().trim().min(3, 'Indiquez le motif de la publication.').max(300),
    requiresReacceptance: z.boolean().default(false),
  }),
  async (data, request) => {
    if (data.kind === 'legal') {
      const { caller } = await requireAdmin(request, 'legal.edit');
      const ref = db.collection(COLLECTIONS.legalDocuments).doc(data.id);
      const doc = (await ref.get()).data() as LegalDocument | undefined;
      if (!doc) throw fail.notFound('Document légal');
      if (doc.status !== 'draft') throw fail.precondition('Seul un brouillon peut être publié.');
      if (!doc.content?.fr?.trim()) throw fail.invalid('Le document est vide.');
      const previous = await db.collection(COLLECTIONS.legalDocuments)
        .where('type', '==', doc.type).where('countryId', '==', doc.countryId).where('status', '==', 'published').get();
      const at = Timestamp.now();
      await db.runTransaction(async (tx) => {
        for (const p of previous.docs) tx.update(p.ref, { status: 'archived', updatedAt: at, updatedBy: caller.uid });
        tx.update(ref, {
          status: 'published',
          publishedAt: at,
          effectiveAt: at,
          requiresReacceptance: data.requiresReacceptance,
          changeSummary: data.changeSummary ?? doc.changeSummary ?? null,
          updatedAt: at,
          updatedBy: caller.uid,
        });
      });
      await writeAudit({
        actor: actorFromCaller(caller, 'admin'),
        action: 'legal.published',
        target: { type: 'other', id: data.id, label: `${doc.title.fr} · ${doc.version}` },
        reason: data.changeSummary,
        after: { version: doc.version, countryId: doc.countryId, requiresReacceptance: data.requiresReacceptance, archived: previous.size },
        countryId: doc.countryId,
        request,
      });
      return { version: doc.version };
    }

    const { caller, admin } = await requireAdmin(request, 'display.edit');
    const ref = db.collection(COLLECTIONS.pages).doc(data.id);
    const page = (await ref.get()).data() as ContentPage | undefined;
    if (!page) throw fail.notFound('Page');
    const draft = page.draft;
    if (!draft) throw fail.precondition('Aucune modification à publier.');
    if (!draft.title.fr?.trim()) throw fail.invalid('Le titre est obligatoire.');
    if ((page.kind ?? 'page') === 'faq' ? !(draft.faqItems?.length) : !draft.body.fr?.trim()) {
      throw fail.invalid((page.kind ?? 'page') === 'faq' ? 'Ajoutez au moins une question.' : 'Le contenu est vide.');
    }
    const version = (page.version ?? 0) + 1;
    const at = Timestamp.now();
    const snapshot: ContentPageVersion = {
      version,
      title: draft.title,
      body: draft.body,
      faqItems: draft.faqItems ?? null,
      audience: draft.audience,
      changeSummary: data.changeSummary,
      publishedAt: at,
      publishedBy: caller.uid,
      publishedByName: admin.displayName,
    };
    await db.runTransaction(async (tx) => {
      tx.update(ref, {
        title: draft.title,
        body: draft.body,
        faqItems: draft.faqItems ?? null,
        audience: draft.audience,
        draft: null,
        published: true,
        version,
        publishedAt: at,
        publishedBy: caller.uid,
        updatedAt: at,
        updatedBy: caller.uid,
      });
      tx.create(ref.collection(SUBCOLLECTIONS.pages.versions).doc(String(version)), snapshot);
    });
    await writeAudit({
      actor: actorFromCaller(caller, 'admin'),
      action: 'page.published',
      target: { type: 'other', id: data.id, label: draft.title.fr },
      reason: data.changeSummary,
      after: { version },
      request,
    });
    return { version };
  },
);

// ------------------------------------------------------------------ Mise en avant payante

const ACTIVE_PLACEMENT = ['scheduled', 'active'] as const;

function parisMidnight(day: string): Timestamp {
  // Minuit à Paris : décalage calculé à partir de l'heure locale du jour.
  const utc = new Date(`${day}T00:00:00Z`);
  const local = new Date(utc.toLocaleString('en-US', { timeZone: 'Europe/Paris' }));
  return Timestamp.fromMillis(utc.getTime() - (local.getTime() - utc.getTime()));
}

export const bookSponsoredPlacement = experienceCallable(
  z.object({
    restaurantId: zId,
    offerId: zId,
    startDay: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date de début invalide.'),
    periods: z.number().int().min(1).max(12),
    billing: z.enum(['invoice', 'ad_credit', 'offered']),
    categoryId: zId.nullable().default(null),
    /** Motif de la vente (obligatoire : facture, crédit publicitaire ou offert). */
    note: z.string().trim().min(3, 'Indiquez le motif de la vente.').max(300),
  }),
  async (data, request) => {
    const { caller, admin } = await requireAdmin(request, 'display.edit');
    if (data.startDay < parisDay(new Date())) throw fail.invalid('La date de début est passée.');
    const offer = (await db.collection(COLLECTIONS.sponsoredOffers).doc(data.offerId).get()).data() as SponsoredOffer | undefined;
    if (!offer?.active) throw fail.invalid('Cette offre n’est plus proposée.');
    const restaurantRef = db.collection(COLLECTIONS.restaurants).doc(data.restaurantId);
    const restaurant = (await restaurantRef.get()).data() as Restaurant | undefined;
    if (!restaurant) throw fail.notFound('Restaurant');
    assertAdminCovers(admin, restaurant.cityId);
    if (restaurant.status !== 'active') throw fail.precondition('Seul un commerce en ligne peut être mis en avant.');
    if (offer.cityIds && !offer.cityIds.includes(restaurant.cityId)) throw fail.invalid('Cette offre n’est pas proposée dans la ville du commerce.');
    if (offer.slot === 'category_top' && !data.categoryId) throw fail.invalid('Choisissez la catégorie concernée.');

    const startsAt = parisMidnight(data.startDay);
    const endsAt = Timestamp.fromMillis(startsAt.toMillis() + offer.durationDays * data.periods * DAY);
    const listPrice = offer.priceHtCents * data.periods;

    // Capacité : placements du même emplacement et de la même ville qui chevauchent la période.
    const overlapping = await db.collection(COLLECTIONS.sponsoredPlacements)
      .where('cityId', '==', restaurant.cityId).where('slot', '==', offer.slot).where('status', 'in', [...ACTIVE_PLACEMENT, 'pending_payment']).get();
    const concurrent = overlapping.docs.filter((d) => {
      const p = d.data() as SponsoredPlacement;
      if (offer.slot === 'category_top' && p.categoryId !== data.categoryId) return false;
      return p.startsAt.toMillis() < endsAt.toMillis() && p.endsAt.toMillis() > startsAt.toMillis();
    });
    if (concurrent.some((d) => d.get('restaurantId') === data.restaurantId)) throw fail.alreadyExists('Ce commerce est déjà mis en avant sur cet emplacement pendant cette période.');
    if (concurrent.length >= offer.maxConcurrent) throw fail.precondition(`Emplacement complet sur cette période (${offer.maxConcurrent} commerce${offer.maxConcurrent > 1 ? 's' : ''} au maximum).`);

    const ref = db.collection(COLLECTIONS.sponsoredPlacements).doc();
    const commercialRef = restaurantRef.collection(SUBCOLLECTIONS.restaurants.private).doc(RESTAURANT_PRIVATE_DOCS.commercial);
    const at = Timestamp.now();
    const status: SponsoredPlacement['status'] = startsAt.toMillis() <= Date.now() ? 'active' : 'scheduled';
    const adCreditUsed = await db.runTransaction(async (tx) => {
      let used = 0;
      if (data.billing === 'ad_credit') {
        const commercial = (await tx.get(commercialRef)).data() as RestaurantCommercial | undefined;
        const credit = commercial?.adCreditCents ?? 0;
        if (credit < listPrice) throw fail.precondition(`Crédit publicitaire insuffisant : ${euros(credit)} disponibles pour ${euros(listPrice)} HT.`);
        used = listPrice;
        tx.set(commercialRef, { adCreditCents: credit - listPrice, updatedAt: at }, { merge: true });
      }
      const placement: SponsoredPlacement = {
        restaurantId: data.restaurantId,
        restaurantName: restaurant.name,
        countryId: restaurant.countryId,
        cityId: restaurant.cityId,
        slot: offer.slot,
        categoryId: data.categoryId,
        offerId: data.offerId,
        priceHtCents: data.billing === 'invoice' ? listPrice : 0,
        listPriceHtCents: listPrice,
        adCreditUsedCents: used,
        billing: data.billing,
        startsAt,
        endsAt,
        status,
        invoiceId: null,
        impressions: 0,
        clicks: 0,
        orders: 0,
        cancellation: null,
        createdAt: at,
        createdBy: caller.uid,
        updatedAt: at,
        updatedBy: caller.uid,
      };
      tx.create(ref, placement);
      if (status === 'active') tx.update(restaurantRef, { sponsored: true });
      return used;
    });
    await writeAudit({
      actor: actorFromCaller(caller, 'admin'),
      action: 'sponsored.booked',
      target: { type: 'restaurant', id: data.restaurantId, label: restaurant.name },
      reason: data.note,
      after: { placementId: ref.id, slot: offer.slot, startDay: data.startDay, periods: data.periods, listPriceHtCents: listPrice, billing: data.billing, adCreditUsed },
      countryId: restaurant.countryId,
      cityId: restaurant.cityId,
      request,
    });
    return { placementId: ref.id, status, priceHtCents: data.billing === 'invoice' ? listPrice : 0 };
  },
);

export const cancelSponsoredPlacement = experienceCallable(
  z.object({ placementId: zId, reason: z.string().trim().min(3, 'Indiquez un motif').max(500), refundAdCredit: z.boolean().default(true) }),
  async (data, request) => {
    const { caller, admin } = await requireAdmin(request, 'display.edit');
    const ref = db.collection(COLLECTIONS.sponsoredPlacements).doc(data.placementId);
    const placement = (await ref.get()).data() as SponsoredPlacement | undefined;
    if (!placement) throw fail.notFound('Emplacement');
    assertAdminCovers(admin, placement.cityId);
    if (placement.status === 'cancelled' || placement.status === 'ended') throw fail.precondition('Cet emplacement est déjà terminé.');
    if (placement.invoiceId) throw fail.precondition('Cet emplacement est déjà facturé : émettez un avoir depuis la facturation.');
    const at = Timestamp.now();
    const commercialRef = db.collection(COLLECTIONS.restaurants).doc(placement.restaurantId).collection(SUBCOLLECTIONS.restaurants.private).doc(RESTAURANT_PRIVATE_DOCS.commercial);
    await db.runTransaction(async (tx) => {
      const credit = data.refundAdCredit && (placement.adCreditUsedCents ?? 0) > 0 ? placement.adCreditUsedCents! : 0;
      if (credit > 0) tx.set(commercialRef, { adCreditCents: FieldValue.increment(credit), updatedAt: at }, { merge: true });
      tx.update(ref, { status: 'cancelled', cancellation: { reason: data.reason, by: caller.uid, at }, updatedAt: at, updatedBy: caller.uid });
    });
    await syncRestaurantSponsored(placement.restaurantId);
    await writeAudit({
      actor: actorFromCaller(caller, 'admin'),
      action: 'sponsored.cancelled',
      target: { type: 'restaurant', id: placement.restaurantId, label: placement.restaurantName ?? placement.restaurantId },
      reason: data.reason,
      before: { status: placement.status },
      after: { status: 'cancelled', placementId: data.placementId },
      countryId: placement.countryId ?? null,
      cityId: placement.cityId,
      request,
    });
    return { ok: true };
  },
);

async function syncRestaurantSponsored(restaurantId: string): Promise<void> {
  const active = await db.collection(COLLECTIONS.sponsoredPlacements).where('restaurantId', '==', restaurantId).where('status', '==', 'active').limit(1).get();
  const ref = db.collection(COLLECTIONS.restaurants).doc(restaurantId);
  const current = (await ref.get()).get('sponsored') === true;
  if (current !== !active.empty) await ref.update({ sponsored: !active.empty });
}

/** Démarre et termine les emplacements à l'heure, et tient à jour `restaurants.sponsored`. */
export async function syncPlacements(): Promise<{ started: number; ended: number }> {
  const now = Timestamp.now();
  const touched = new Set<string>();
  let started = 0;
  let ended = 0;
  const toStart = await db.collection(COLLECTIONS.sponsoredPlacements).where('status', '==', 'scheduled').where('startsAt', '<=', now).get();
  for (const doc of toStart.docs) {
    const p = doc.data() as SponsoredPlacement;
    await doc.ref.update({ status: p.endsAt.toMillis() <= now.toMillis() ? 'ended' : 'active', updatedAt: now, updatedBy: 'system' });
    touched.add(p.restaurantId);
    started += 1;
  }
  const toEnd = await db.collection(COLLECTIONS.sponsoredPlacements).where('status', '==', 'active').where('endsAt', '<=', now).get();
  for (const doc of toEnd.docs) {
    await doc.ref.update({ status: 'ended', updatedAt: now, updatedBy: 'system' });
    touched.add(doc.get('restaurantId') as string);
    ended += 1;
  }
  for (const id of touched) await syncRestaurantSponsored(id);
  return { started, ended };
}

export const syncSponsoredPlacements = onSchedule(
  { schedule: '5 * * * *', timeZone: 'Europe/Paris', retryCount: 1, ...EXPERIENCE_RUNTIME },
  async () => {
    const result = await syncPlacements();
    if (result.started || result.ended) logger.info('Emplacements sponsorisés', result);
  },
);

// ------------------------------------------------------------------ Réglages

const weight = z.number().min(0).max(1);
const displaySchema = z.object({
  ranking: z.object({
    distanceWeight: weight,
    ratingWeight: weight,
    popularityWeight: weight,
    planWeight: weight,
    sponsoredWeight: weight,
    newRestaurantBoostDays: z.number().int().min(0).max(365),
  }),
  sponsoredLabel: z.string().trim().min(3, 'La mention est obligatoire (obligation légale).').max(30),
  qualityWatch: z.object({
    minReviews: z.number().int().min(1).max(100),
    watchDrop: z.number().min(0.05).max(3),
    alertDrop: z.number().min(0.1).max(4),
    alertBelow: z.number().min(1).max(5),
  }).optional(),
});
const priorities = z.object({ low: z.number().int().min(1), normal: z.number().int().min(1), high: z.number().int().min(1), urgent: z.number().int().min(1) });
const merchantNotice = z
  .object({
    enabled: z.boolean(),
    title: z.object({ fr: z.string().trim().min(2).max(80) }).passthrough(),
    body: z.object({ fr: z.string().trim().min(2).max(300) }).passthrough(),
  })
  .nullable();
const supportSchema = z.object({
  firstResponseTargetMinutes: priorities,
  resolutionTargetHours: priorities,
  autoEscalateAfterMinutes: z.number().int().min(5).max(1440),
  liveChatEnabled: z.boolean(),
  autoCloseResolvedAfterDays: z.number().int().min(1).max(60),
  /** Message affiché en tête de « Support » dans le back-office des commerces (H6). */
  merchantNotice: merchantNotice.optional(),
});

export const updateExperienceSettings = experienceCallable(
  z.object({ doc: z.enum(['display', 'support']), values: z.record(z.string(), z.unknown()), reason: zReason }),
  async (data, request) => {
    const { caller } = await requireAdmin(request, data.doc === 'display' ? 'display.edit' : 'support.configure');
    let values: Record<string, unknown>;
    if (data.doc === 'display') {
      const parsed = displaySchema.safeParse(data.values);
      if (!parsed.success) throw fail.invalid(parsed.error.issues[0]?.message ?? 'Réglages invalides.');
      const r = parsed.data.ranking;
      const total = r.distanceWeight + r.ratingWeight + r.popularityWeight + r.planWeight + r.sponsoredWeight;
      if (Math.abs(total - 1) > 0.001) throw fail.invalid('La somme des pondérations doit faire 100 %.');
      if (parsed.data.qualityWatch && parsed.data.qualityWatch.alertDrop <= parsed.data.qualityWatch.watchDrop) {
        throw fail.invalid('Le seuil d’alerte doit être supérieur au seuil de surveillance.');
      }
      values = parsed.data;
    } else {
      const parsed = supportSchema.safeParse(data.values);
      if (!parsed.success) throw fail.invalid(parsed.error.issues[0]?.message ?? 'Réglages invalides.');
      values = parsed.data;
    }
    const ref = db.collection(COLLECTIONS.settings).doc(data.doc === 'display' ? SETTINGS_DOCS.display : SETTINGS_DOCS.support);
    const before = (await ref.get()).data() ?? {};
    const changed = Object.keys(values).filter((k) => JSON.stringify(before[k]) !== JSON.stringify(values[k]));
    if (changed.length === 0) return { changed: [] };
    await ref.set({ ...values, updatedAt: FieldValue.serverTimestamp(), updatedBy: caller.uid }, { merge: true });
    const pick = (source: Record<string, unknown>) => Object.fromEntries(changed.map((k) => [k, source[k] ?? null]));
    await db.collection(COLLECTIONS.settingsHistory).add({
      docPath: ref.path,
      changedFields: changed,
      before: pick(before),
      after: pick(values),
      reason: data.reason,
      changedBy: caller.uid,
      changedAt: FieldValue.serverTimestamp(),
    });
    await writeAudit({
      actor: actorFromCaller(caller, 'admin'),
      action: 'settings.updated',
      target: { type: 'other', id: ref.path, label: data.doc === 'display' ? 'Classement et affichage' : 'Délais du support' },
      reason: data.reason,
      before: pick(before),
      after: pick(values),
      request,
    });
    // Le classement et la mention « Sponsorisé » suivent immédiatement les nouveaux réglages.
    if (data.doc === 'display' && (changed.includes('ranking') || changed.includes('sponsoredLabel'))) {
      await recomputeRankingScores().catch((error: unknown) => logger.error('Recalcul du classement en échec', { error: error instanceof Error ? error.message : String(error) }));
    }
    return { changed };
  },
);

// ------------------------------------------------------------------ Catalogue des offres de mise en avant

const offerSchema = z.object({
  offerId: zId.nullish(),
  label: z.string().trim().min(3).max(80),
  description: z.string().trim().max(300).nullish(),
  slot: z.enum(['home_top', 'home_featured', 'search_top', 'category_top', 'banner']),
  priceHtCents: z.number().int().min(0).max(10_000_000),
  durationDays: z.number().int().min(1).max(365),
  maxConcurrent: z.number().int().min(1).max(100),
  cityIds: z.array(zId).max(100).nullable(),
  active: z.boolean(),
  reason: zReason,
});

/** Création ou modification d'une offre du catalogue (le prix est de l'argent : motif, historique, audit). */
export const saveSponsoredOffer = experienceCallable(offerSchema, async (data, request) => {
  const { caller, admin } = await requireAdmin(request, 'display.edit');
  if (data.cityIds) {
    for (const cityId of data.cityIds) assertAdminCovers(admin, cityId);
  } else if (admin.role !== 'super_admin' && admin.cityIds.length > 0) {
    throw fail.forbidden('Une offre proposée dans toutes les villes est réservée à l’équipe centrale.');
  }
  const col = db.collection(COLLECTIONS.sponsoredOffers);
  const ref = data.offerId ? col.doc(data.offerId) : col.doc();
  const snap = await ref.get();
  if (data.offerId && !snap.exists) throw fail.notFound('Offre');
  const before = (snap.data() ?? null) as SponsoredOffer | null;
  const fields = {
    label: data.label,
    description: data.description?.trim() || null,
    slot: data.slot,
    priceHtCents: data.priceHtCents,
    durationDays: data.durationDays,
    maxConcurrent: data.maxConcurrent,
    cityIds: data.cityIds,
    active: data.active,
  };
  const at = Timestamp.now();
  if (before) {
    await ref.update({ ...fields, updatedAt: at, updatedBy: caller.uid });
  } else {
    const count = (await col.count().get()).data().count;
    await ref.set({ ...fields, order: count, createdAt: at, createdBy: caller.uid, updatedAt: at, updatedBy: caller.uid });
  }
  await recordSettingsChange({
    docPath: `${COLLECTIONS.sponsoredOffers}/${ref.id}`,
    before: before ? { ...before } as unknown as Record<string, unknown> : null,
    after: { ...fields },
    reason: data.reason,
    caller,
  });
  await writeAudit({
    actor: actorFromCaller(caller, 'admin'),
    action: before ? 'sponsored_offer.updated' : 'sponsored_offer.created',
    target: { type: 'setting', id: `${COLLECTIONS.sponsoredOffers}/${ref.id}`, label: data.label },
    reason: data.reason,
    before: before ? { priceHtCents: before.priceHtCents, durationDays: before.durationDays, maxConcurrent: before.maxConcurrent, active: before.active } : null,
    after: { priceHtCents: data.priceHtCents, durationDays: data.durationDays, maxConcurrent: data.maxConcurrent, active: data.active },
    sensitive: !before || before.priceHtCents !== data.priceHtCents,
    request,
  });
  return { offerId: ref.id };
});
