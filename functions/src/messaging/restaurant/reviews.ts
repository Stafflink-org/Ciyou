// Avis clients côté restaurant : réponse publique et signalement d'un avis
// abusif (transmis à la modération Ciyou Eats, conformément au DSA).
import {
  COLLECTIONS,
  REVIEW_REPORT_REASONS,
  SUBCOLLECTIONS,
  type ContentReport,
  type ReplyTemplate,
  type Review,
} from '@golink/shared';
import { db, FieldValue, Timestamp } from '../../lib/admin';
import { actorFromCaller, writeAudit } from '../../lib/audit';
import { callable } from '../../lib/callable';
import { fail, isFirestoreAlreadyExists } from '../../lib/errors';
import { requireRestaurantAccess } from '../../lib/permissions';
import { z, zId } from '../../lib/validation';
import { containsContactDetails, loadRestaurant, notifyUser } from '../../marketing/restaurant/helpers';

async function loadReview(orderId: string): Promise<Review> {
  const snap = await db.collection(COLLECTIONS.reviews).doc(orderId).get();
  if (!snap.exists) throw fail.notFound('Avis');
  return snap.data() as Review;
}

/** Compteur d'utilisation d'une réponse type (sans bloquer l'action principale). */
export async function countTemplateUse(restaurantId: string, templateId: string | null | undefined): Promise<void> {
  if (!templateId) return;
  const ref = db.collection(COLLECTIONS.restaurants).doc(restaurantId).collection(SUBCOLLECTIONS.restaurants.replyTemplates).doc(templateId);
  const snap = await ref.get();
  if (!snap.exists) return;
  await ref.update({ usageCount: FieldValue.increment(1), lastUsedAt: Timestamp.now() } satisfies Partial<Record<keyof ReplyTemplate, unknown>>);
}

export const replyToReview = callable(
  z.object({
    orderId: zId,
    /** null : retirer la réponse publiée. */
    text: z.string().trim().min(2, 'Votre réponse est trop courte.').max(1000).nullable(),
    templateId: zId.nullable().default(null),
  }),
  async (data, request) => {
    const review = await loadReview(data.orderId);
    const actor = await requireRestaurantAccess(request, review.restaurantId, 'reviews.reply', 'reviews.moderate');
    if (review.status === 'removed') throw fail.precondition('Cet avis a été supprimé par la modération.');
    if (review.reply?.status === 'hidden') {
      throw fail.precondition('Votre réponse a été masquée par la modération Ciyou Eats : contactez le support pour la modifier.');
    }
    if (data.text && containsContactDetails(data.text)) {
      throw fail.invalid('Une réponse publique ne doit contenir ni adresse e-mail ni numéro de téléphone.');
    }
    const restaurant = await loadRestaurant(review.restaurantId);
    const ref = db.collection(COLLECTIONS.reviews).doc(data.orderId);
    const reply = data.text ? { text: data.text, by: actor.caller.uid, at: Timestamp.now(), status: 'published' as const } : null;
    await ref.update({ reply, updatedAt: Timestamp.now() });

    await countTemplateUse(review.restaurantId, data.templateId);
    if (reply && !review.reply) {
      await notifyUser(review.customerId, {
        title: `${restaurant.name} vous a répondu`,
        body: data.text!.length > 140 ? `${data.text!.slice(0, 137)}…` : data.text!,
        category: 'order',
        link: { type: 'order', target: data.orderId },
      });
    }
    await writeAudit({
      actor: actorFromCaller(actor.caller, actor.kind === 'admin' ? 'admin' : 'restaurant'),
      action: reply ? (review.reply ? 'review.reply_updated' : 'review.replied') : 'review.reply_removed',
      target: { type: 'review', id: data.orderId, label: `${review.restaurantRating}/5 · ${review.customerDisplayName}` },
      before: review.reply ? { text: review.reply.text } : null,
      after: reply ? { text: reply.text } : null,
      countryId: review.countryId,
      cityId: review.cityId,
      request,
    });
    return { replied: Boolean(reply) };
  },
);

export const reportReview = callable(
  z.object({
    orderId: zId,
    reason: z.enum(REVIEW_REPORT_REASONS),
    details: z.string().trim().min(10, 'Expliquez en quelques mots ce qui pose problème.').max(2000),
  }),
  async (data, request) => {
    const review = await loadReview(data.orderId);
    const actor = await requireRestaurantAccess(request, review.restaurantId, 'reviews.reply');
    if (review.restaurantReport) throw fail.alreadyExists('Vous avez déjà signalé cet avis : la modération Ciyou Eats l’examine.');
    const reportRef = db.collection(COLLECTIONS.contentReports).doc(`avis-${data.orderId}-${review.restaurantId}`);
    const reviewRef = db.collection(COLLECTIONS.reviews).doc(data.orderId);
    const now = Timestamp.now();
    const report: ContentReport = {
      targetType: 'review',
      targetPath: `${COLLECTIONS.reviews}/${data.orderId}`,
      restaurantId: review.restaurantId,
      reporterId: actor.caller.uid,
      reporterType: 'restaurant',
      reason: data.reason,
      details: data.details,
      status: 'open',
      decision: null,
      createdAt: now,
    };
    try {
      await db.runTransaction(async (tx) => {
        tx.create(reportRef, report);
        tx.update(reviewRef, {
          reportsCount: FieldValue.increment(1),
          restaurantReport: { reason: data.reason, at: now, by: actor.caller.uid, reportId: reportRef.id },
          updatedAt: now,
        });
      });
    } catch (error) {
      if (isFirestoreAlreadyExists(error)) throw fail.alreadyExists('Vous avez déjà signalé cet avis : la modération Ciyou Eats l’examine.');
      throw error;
    }
    await writeAudit({
      actor: actorFromCaller(actor.caller, 'restaurant'),
      action: 'review.reported',
      target: { type: 'review', id: data.orderId, label: `${review.restaurantRating}/5 · ${review.customerDisplayName}` },
      reason: data.details,
      after: { reason: data.reason, reportId: reportRef.id },
      countryId: review.countryId,
      cityId: review.cityId,
      request,
    });
    return { reportId: reportRef.id };
  },
);
