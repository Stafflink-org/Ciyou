// Messages financiers automatiques (facture, reversement, relances d'abonnement, espèces) :
// texte modifiable dans le super admin, remis aux membres du commerce qui gèrent les finances.
import { COLLECTIONS, SUBCOLLECTIONS, memberHasPermission, type PlatformMessageKey, type RestaurantMember } from '@golink/shared';
import { db } from '../../lib/admin';
import { sendPlatformMessage, type MessageTarget, type SendMessageOptions } from '../../notifications/messages';

/** Membres actifs du commerce qui voient les finances (propriétaire, gérant, comptable). */
export async function restaurantFinanceTargets(restaurantId: string, demo: boolean): Promise<MessageTarget[]> {
  const snap = await db.collection(COLLECTIONS.restaurants).doc(restaurantId).collection(SUBCOLLECTIONS.restaurants.members).where('active', '==', true).get();
  return snap.docs.filter((doc) => memberHasPermission(doc.data() as RestaurantMember, 'finance.view')).map((doc) => ({ uid: doc.id, type: 'restaurant' as const, demo }));
}

/** Remet un message financier à tous les responsables financiers du commerce (idempotent par clé). */
export async function messageRestaurantFinance(
  restaurantId: string,
  key: PlatformMessageKey,
  values: Record<string, string | number | null | undefined>,
  options: SendMessageOptions,
  demo = false,
): Promise<number> {
  const targets = await restaurantFinanceTargets(restaurantId, demo);
  await Promise.all(targets.map((t) => sendPlatformMessage(key, t, values, options)));
  return targets.length;
}
