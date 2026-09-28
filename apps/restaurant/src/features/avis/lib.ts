import { limit, orderBy, query, where } from 'firebase/firestore';
import { COLLECTIONS, type Review, type WithId } from '@golink/shared';
import { useAuth } from '@golink/web';
import { useCan, useRestaurantAccess } from '@/auth/RestaurantAccess';
import { callFunction, collectionAt, useCollection } from '@/lib/firestore';

export type ReviewRow = WithId<Review>;

/** Avis de l'établissement (les 500 plus récents), en temps réel. */
export function useRestaurantReviews(max = 500) {
  const { restaurantId } = useRestaurantAccess();
  const can = useCan();
  const { user } = useAuth();
  const q =
    can('reviews.reply') && user
      ? query(collectionAt(COLLECTIONS.reviews), where('restaurantId', '==', restaurantId), orderBy('createdAt', 'desc'), limit(max))
      : null;
  return useCollection<Review>(q);
}

/** Pastille de menu : avis négatifs récents restés sans réponse. */
export function useUnansweredReviewsCount(): number | null {
  const { data } = useRestaurantReviews(40);
  const count = data.filter((r) => r.status === 'published' && !r.reply && r.restaurantRating <= 3).length;
  return count > 0 ? count : null;
}

export const replyToReview = callFunction<{ orderId: string; text: string | null; templateId: string | null }, { replied: boolean }>('replyToReview');
export const reportReview = callFunction<{ orderId: string; reason: string; details: string }, { reportId: string }>('reportReview');
