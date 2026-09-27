// Avis et notes : filtre automatique à la création, modération motivée (avis et
// réponses des restaurants), décisions sur les signalements (DSA), notes moyennes
// recalculées, suivi qualité des notes en baisse.
import {
  COLLECTIONS,
  DEFAULT_MODERATION_RULES,
  DEFAULT_RATING_WATCH,
  SETTINGS_DOCS,
  scanReviewText,
  type AdminUser,
  type ContentReport,
  type DisplaySettings,
  type Driver,
  type ModerationRule,
  type ModerationTerm,
  type RatingWatch,
  type RatingWatchThresholds,
  type Restaurant,
  type Review,
} from '@golink/shared';
import { logger } from 'firebase-functions/v2';
import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { AggregateField } from 'firebase-admin/firestore';
import { db, FieldValue, Timestamp } from '../../lib/admin';
import { actorFromCaller, SYSTEM_ACTOR, writeAudit } from '../../lib/audit';
import { fail } from '../../lib/errors';
import { assertAdminCovers, requireAdmin, type Caller } from '../../lib/permissions';
import { z, zId, zReason } from '../../lib/validation';
import { EXPERIENCE_RUNTIME, experienceCallable, notify, restaurantRecipients } from './common';

const DAY = 86_400_000;

// ------------------------------------------------------------------ Termes du filtre

let termsCache: { at: number; rules: Array<ModerationRule & { id?: string }> } | null = null;

async function moderationRules(): Promise<Array<ModerationRule & { id?: string }>> {
  if (termsCache && Date.now() - termsCache.at < 5 * 60_000) return termsCache.rules;
  const snap = await db.collection(COLLECTIONS.moderationTerms).where('active', '==', true).get();
  const custom = snap.docs.map((d) => {
    const t = d.data() as ModerationTerm;
    return { id: d.id, term: t.term, category: t.category, action: t.action };
  });
  termsCache = { at: Date.now(), rules: [...DEFAULT_MODERATION_RULES, ...custom] };
  return termsCache.rules;
}

// ------------------------------------------------------------------ Notes moyennes

/** Moyenne et nombre d'avis publiés, arrondis au dixième, sur le restaurant et le livreur. */
export async function recomputeRatings(restaurantId: string | null | undefined, driverId: string | null | undefined): Promise<void> {
  const reviews = db.collection(COLLECTIONS.reviews);
  if (restaurantId) {
    const agg = await reviews.where('restaurantId', '==', restaurantId).where('status', '==', 'published')
      .aggregate({ count: AggregateField.count(), avg: AggregateField.average('restaurantRating') }).get();
    const { count, avg } = agg.data();
    await db.collection(COLLECTIONS.restaurants).doc(restaurantId).set(
      { rating: { average: avg ? Math.round(avg * 10) / 10 : 0, count } },
      { merge: true },
    );
  }
  if (driverId) {
    const snap = await reviews.where('driverId', '==', driverId).where('status', '==', 'published').select('driverRating').get();
    const ratings = snap.docs.map((d) => d.get('driverRating') as number | null).filter((r): r is number => typeof r === 'number' && r > 0);
    const average = ratings.length ? Math.round((ratings.reduce((a, b) => a + b, 0) / ratings.length) * 10) / 10 : 0;
    const driverRef = db.collection(COLLECTIONS.drivers).doc(driverId);
    if ((await driverRef.get()).exists) await driverRef.set({ rating: { average, count: ratings.length } }, { merge: true });
  }
}

// ------------------------------------------------------------------ Filtre automatique

export const onReviewCreated = onDocumentCreated(
  { document: `${COLLECTIONS.reviews}/{orderId}`, retry: false, ...EXPERIENCE_RUNTIME },
  async (event) => {
    const review = event.data?.data() as Review | undefined;
    if (!review || review.status !== 'pending_moderation' || review.autoModeration) return;
    const rules = await moderationRules();
    const verdict = scanReviewText(review.comment, rules);
    const ref = db.collection(COLLECTIONS.reviews).doc(event.params.orderId);
    const status = verdict.blocked ? 'pending_moderation' : 'published';
    await db.runTransaction(async (tx) => {
      const current = (await tx.get(ref)).data() as Review | undefined;
      if (!current || current.autoModeration) return;
      tx.update(ref, { status, autoModeration: { flagged: verdict.flagged, reasons: verdict.reasons }, updatedAt: Timestamp.now() });
    });
    // Compteurs d'occurrence des termes éditables.
    for (const match of verdict.matches) {
      const custom = rules.find((r) => r.id && r.term.toLowerCase() === match.term);
      if (custom?.id) await db.collection(COLLECTIONS.moderationTerms).doc(custom.id).update({ hits: FieldValue.increment(1) });
    }
    if (status === 'published') await recomputeRatings(review.restaurantId, review.driverId);
    if (verdict.blocked) {
      await writeAudit({
        actor: SYSTEM_ACTOR,
        action: 'review.auto_held',
        target: { type: 'review', id: event.params.orderId, label: `${review.restaurantRating}/5 · ${review.customerDisplayName}` },
        reason: verdict.reasons.join(', '),
        countryId: review.countryId,
        cityId: review.cityId,
      });
    }
  },
);

// ------------------------------------------------------------------ Modération

const REVIEW_STATUS_OF = { hide: 'hidden', remove: 'removed', restore: 'published', publish: 'published' } as const;

async function applyReviewModeration(
  caller: Caller,
  admin: AdminUser,
  input: { orderId: string; target: 'review' | 'reply'; action: 'hide' | 'remove' | 'restore' | 'publish'; reason: string; reportId?: string | null },
  request?: Parameters<typeof writeAudit>[0]['request'],
): Promise<Review> {
  const ref = db.collection(COLLECTIONS.reviews).doc(input.orderId);
  const review = (await ref.get()).data() as Review | undefined;
  if (!review) throw fail.notFound('Avis');
  assertAdminCovers(admin, review.cityId);
  const at = Timestamp.now();
  let before: Record<string, unknown>;
  let after: Record<string, unknown>;

  if (input.target === 'reply') {
    if (!review.reply) throw fail.precondition('Ce restaurant n’a pas répondu à cet avis.');
    if (input.action === 'remove') throw fail.invalid('Une réponse peut être masquée ou rétablie.');
    const hidden = input.action === 'hide';
    if ((review.reply.status === 'hidden') === hidden) throw fail.precondition(hidden ? 'Cette réponse est déjà masquée.' : 'Cette réponse est déjà visible.');
    before = { replyStatus: review.reply.status };
    after = { replyStatus: hidden ? 'hidden' : 'published' };
    await ref.update({
      'reply.status': hidden ? 'hidden' : 'published',
      'reply.moderation': { action: hidden ? 'hidden' : 'restored', reason: input.reason, by: caller.uid, at },
      updatedAt: at,
    });
  } else {
    const status = REVIEW_STATUS_OF[input.action];
    if (review.status === status) throw fail.precondition('Cet avis a déjà ce statut.');
    before = { status: review.status };
    after = { status };
    await ref.update({
      status,
      moderation: { action: status === 'published' ? 'restored' : status, reason: input.reason, by: caller.uid, at },
      updatedAt: at,
    });
    await recomputeRatings(review.restaurantId, review.driverId);
  }

  if (input.reportId) {
    await db.collection(COLLECTIONS.contentReports).doc(input.reportId).set({
      status: input.action === 'restore' || input.action === 'publish' ? 'dismissed' : 'actioned',
      decision: {
        action: input.action === 'hide' ? 'hidden' : input.action === 'remove' ? 'removed' : 'no_action',
        reason: input.reason,
        by: caller.uid,
        at,
        notifiedReporter: true,
      },
    }, { merge: true });
  }

  await writeAudit({
    actor: actorFromCaller(caller, 'admin'),
    action: `review.${input.target === 'reply' ? 'reply_' : ''}${input.action === 'hide' ? 'hidden' : input.action === 'remove' ? 'removed' : 'restored'}`,
    target: { type: 'review', id: input.orderId, label: `${review.restaurantRating}/5 · ${review.customerDisplayName}` },
    reason: input.reason,
    before,
    after,
    countryId: review.countryId,
    cityId: review.cityId,
    request,
  });

  // Exposé des motifs (DSA) : l'auteur du contenu est informé de la décision.
  if (input.target === 'review' && (input.action === 'hide' || input.action === 'remove')) {
    await notify(review.customerId, {
      title: 'Votre avis a été retiré',
      body: `Après examen, votre avis n’est plus affiché : ${input.reason}. Vous pouvez contester cette décision auprès du support.`,
      category: 'account',
      link: { type: 'order', target: input.orderId },
    });
  }
  if (input.target === 'reply' && input.action === 'hide') {
    for (const uid of await restaurantRecipients(review.restaurantId)) {
      await notify(uid, {
        title: 'Votre réponse à un avis a été masquée',
        body: `La modération Ciyou Eats a masqué votre réponse : ${input.reason}.`,
        category: 'account',
        link: null,
      });
    }
  }
  return review;
}

export const moderateReview = experienceCallable(
  z.object({
    orderId: zId,
    target: z.enum(['review', 'reply']).default('review'),
    action: z.enum(['hide', 'remove', 'restore', 'publish']),
    reason: zReason,
    reportId: zId.nullable().default(null),
  }),
  async (data, request) => {
    const { caller, admin } = await requireAdmin(request, 'reviews.moderate');
    await applyReviewModeration(caller, admin, data, request);
    return { ok: true };
  },
);

/** Décision sur un signalement : aucune suite, masquage ou suppression du contenu visé. */
export const decideContentReport = experienceCallable(
  z.object({ reportId: zId, decision: z.enum(['no_action', 'hidden', 'removed']), reason: zReason }),
  async (data, request) => {
    const { caller, admin } = await requireAdmin(request, 'reviews.moderate');
    const ref = db.collection(COLLECTIONS.contentReports).doc(data.reportId);
    const report = (await ref.get()).data() as ContentReport | undefined;
    if (!report) throw fail.notFound('Signalement');
    if (report.status === 'actioned' || report.status === 'dismissed') throw fail.precondition('Ce signalement a déjà été traité.');
    const reviewId = report.targetPath.startsWith(`${COLLECTIONS.reviews}/`) ? report.targetPath.split('/')[1] : null;

    if (data.decision !== 'no_action' && reviewId && (report.targetType === 'review' || report.targetType === 'review_reply')) {
      await applyReviewModeration(caller, admin, {
        orderId: reviewId,
        target: report.targetType === 'review_reply' ? 'reply' : 'review',
        action: data.decision === 'hidden' || report.targetType === 'review_reply' ? 'hide' : 'remove',
        reason: data.reason,
        reportId: data.reportId,
      }, request);
    } else {
      await ref.update({
        status: data.decision === 'no_action' ? 'dismissed' : 'actioned',
        decision: { action: data.decision, reason: data.reason, by: caller.uid, at: Timestamp.now(), notifiedReporter: Boolean(report.reporterId) },
      });
      await writeAudit({
        actor: actorFromCaller(caller, 'admin'),
        action: data.decision === 'no_action' ? 'report.dismissed' : 'report.actioned',
        target: { type: 'review', id: reviewId ?? data.reportId, label: report.targetPath },
        reason: data.reason,
        request,
      });
    }
    if (report.reporterId) {
      await notify(report.reporterId, {
        title: 'Votre signalement a été examiné',
        body: data.decision === 'no_action'
          ? `Après examen, le contenu signalé reste en ligne : ${data.reason}.`
          : `Le contenu signalé a été retiré : ${data.reason}.`,
        category: 'account',
        link: null,
      });
    }
    return { ok: true };
  },
);

// ------------------------------------------------------------------ Suivi qualité

async function loadThresholds(): Promise<RatingWatchThresholds> {
  const display = (await db.collection(COLLECTIONS.settings).doc(SETTINGS_DOCS.display).get()).data() as DisplaySettings | undefined;
  return { ...DEFAULT_RATING_WATCH, ...(display?.qualityWatch ?? {}) };
}

interface Bucket {
  current: number[];
  previous: number[];
  weekly: number[][];
  cityId: string | null;
  countryId: string | null;
}

const round = (n: number | null) => (n === null ? null : Math.round(n * 100) / 100);
const mean = (list: number[]) => (list.length ? list.reduce((a, b) => a + b, 0) / list.length : null);

/** Calcule les tendances sur 2 × 30 jours et met à jour `ratingWatch`. */
export async function computeRatingWatch(): Promise<{ watched: number; alerts: number }> {
  const thresholds = await loadThresholds();
  const now = Date.now();
  const since = Timestamp.fromMillis(now - 60 * DAY);
  const snap = await db.collection(COLLECTIONS.reviews).where('createdAt', '>=', since).get();
  const buckets = new Map<string, Bucket>();
  const push = (key: string, rating: number, createdAt: number, review: Review) => {
    const bucket = buckets.get(key) ?? { current: [], previous: [], weekly: Array.from({ length: 8 }, () => []), cityId: review.cityId, countryId: review.countryId };
    const age = now - createdAt;
    (age <= 30 * DAY ? bucket.current : bucket.previous).push(rating);
    const week = Math.floor(age / (7 * DAY));
    if (week < 8) bucket.weekly[7 - week]!.push(rating);
    buckets.set(key, bucket);
  };
  for (const doc of snap.docs) {
    const review = doc.data() as Review;
    if (review.status === 'removed') continue;
    const at = review.createdAt.toMillis();
    push(`restaurant_${review.restaurantId}`, review.restaurantRating, at, review);
    if (review.driverId && review.driverRating) push(`driver_${review.driverId}`, review.driverRating, at, review);
  }

  const existing = await db.collection(COLLECTIONS.ratingWatch).get();
  const previousDocs = new Map(existing.docs.map((d) => [d.id, d.data() as RatingWatch]));
  const keys = new Set([...buckets.keys(), ...previousDocs.keys()]);
  const restaurantIds = [...keys].filter((k) => k.startsWith('restaurant_')).map((k) => k.slice(11));
  const driverIds = [...keys].filter((k) => k.startsWith('driver_')).map((k) => k.slice(7));
  const names = new Map<string, { name: string; overall: number | null }>();
  for (let i = 0; i < restaurantIds.length; i += 100) {
    const snaps = await db.getAll(...restaurantIds.slice(i, i + 100).map((id) => db.collection(COLLECTIONS.restaurants).doc(id)));
    for (const s of snaps) if (s.exists) { const r = s.data() as Restaurant; names.set(`restaurant_${s.id}`, { name: r.name, overall: r.rating?.average ?? null }); }
  }
  for (let i = 0; i < driverIds.length; i += 100) {
    const snaps = await db.getAll(...driverIds.slice(i, i + 100).map((id) => db.collection(COLLECTIONS.drivers).doc(id)));
    for (const s of snaps) if (s.exists) { const d = s.data() as Driver; names.set(`driver_${s.id}`, { name: d.displayName || `${d.firstName} ${d.lastName}`, overall: d.rating?.average ?? null }); }
  }

  let watched = 0;
  let alerts = 0;
  const batch = db.batch();
  const at = Timestamp.now();
  for (const key of keys) {
    const bucket = buckets.get(key);
    const entityType = key.startsWith('restaurant_') ? 'restaurant' : 'driver';
    const entityId = key.slice(entityType === 'restaurant' ? 11 : 7);
    const info = names.get(key);
    if (!info) continue;
    const current = bucket ? mean(bucket.current) : null;
    const previous = bucket ? mean(bucket.previous) : null;
    const currentCount = bucket?.current.length ?? 0;
    const delta = current !== null && previous !== null ? current - previous : null;
    const lowRatings = bucket?.current.filter((r) => r <= 2).length ?? 0;
    let level: RatingWatch['level'] = 'ok';
    if (currentCount >= thresholds.minReviews && current !== null) {
      if ((delta !== null && delta <= -thresholds.alertDrop) || current < thresholds.alertBelow) level = 'alert';
      else if ((delta !== null && delta <= -thresholds.watchDrop) || lowRatings >= Math.max(3, Math.ceil(currentCount * 0.25))) level = 'watch';
    }
    const before = previousDocs.get(key);
    if (level === 'ok' && !before) continue;
    const doc: RatingWatch = {
      entityType,
      entityId,
      name: info.name,
      countryId: bucket?.countryId ?? before?.countryId ?? null,
      cityId: bucket?.cityId ?? before?.cityId ?? null,
      currentAverage: round(current),
      previousAverage: round(previous),
      currentCount,
      previousCount: bucket?.previous.length ?? 0,
      delta: round(delta),
      lowRatings,
      overallAverage: info.overall,
      level,
      weekly: bucket ? bucket.weekly.map((w) => round(mean(w))) : [],
      // L'acquittement tombe si la situation s'aggrave.
      acknowledgedAt: before && before.level === level ? (before.acknowledgedAt ?? null) : null,
      acknowledgedBy: before && before.level === level ? (before.acknowledgedBy ?? null) : null,
      note: before?.note ?? null,
      computedAt: at,
    };
    batch.set(db.collection(COLLECTIONS.ratingWatch).doc(key), doc);
    if (level !== 'ok') watched += 1;
    if (level === 'alert') alerts += 1;
  }
  await batch.commit();
  return { watched, alerts };
}

export const detectRatingDrops = onSchedule(
  { schedule: '15 6 * * *', timeZone: 'Europe/Paris', retryCount: 1, ...EXPERIENCE_RUNTIME, memory: '512MiB', timeoutSeconds: 300 },
  async () => {
    const result = await computeRatingWatch();
    logger.info('Suivi qualité des notes', result);
  },
);

export const runRatingWatchNow = experienceCallable(z.object({}), async (_data, request) => {
  const { caller } = await requireAdmin(request, 'reviews.moderate');
  const result = await computeRatingWatch();
  await writeAudit({ actor: actorFromCaller(caller, 'admin'), action: 'quality.recomputed', target: { type: 'other', id: 'ratingWatch', label: 'Suivi qualité des notes' }, after: result, request });
  return result;
}, { memory: '512MiB', timeoutSeconds: 120 });
