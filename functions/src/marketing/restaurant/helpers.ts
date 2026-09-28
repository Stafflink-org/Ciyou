// Outils communs aux fonctions marketing et messagerie du back-office restaurant.
import { COLLECTIONS, SUBCOLLECTIONS, type Restaurant, type UserNotification } from '@golink/shared';
import { db, FieldValue } from '../../lib/admin';
import { fail } from '../../lib/errors';
import type { RestaurantActor } from '../../lib/permissions';

export const PARIS_TZ = 'Europe/Paris';

export type RestaurantDoc = Restaurant & { id: string };

export async function loadRestaurant(restaurantId: string): Promise<RestaurantDoc> {
  const snap = await db.collection(COLLECTIONS.restaurants).doc(restaurantId).get();
  if (!snap.exists) throw fail.notFound('Établissement');
  return { id: snap.id, ...(snap.data() as Restaurant) };
}

/** Nom lisible de l'auteur d'une action (membre de l'équipe ou administrateur). */
export function actorDisplayName(actor: RestaurantActor): string {
  if (actor.kind === 'member') return actor.member.displayName?.trim() || actor.caller.name;
  return actor.admin.displayName || actor.caller.name;
}

/** Heure (0-23) à Paris pour une date donnée. */
export function parisHour(date: Date): number {
  return Number(new Intl.DateTimeFormat('fr-FR', { hour: 'numeric', hourCycle: 'h23', timeZone: PARIS_TZ }).format(date));
}

/** Premier mot d'un nom affiché (« Jade P. » → « Jade »). */
export function firstName(name: string | null | undefined): string {
  return (name ?? '').trim().split(/\s+/)[0] ?? '';
}

/** Notification dans l'app (centre de notifications du client ou du livreur). */
export async function notifyUser(
  uid: string,
  notification: Pick<UserNotification, 'title' | 'body' | 'category' | 'link'>,
): Promise<void> {
  if (!uid || uid === 'system') return;
  await db
    .collection(COLLECTIONS.users)
    .doc(uid)
    .collection(SUBCOLLECTIONS.users.notifications)
    .add({ ...notification, read: false, readAt: null, createdAt: FieldValue.serverTimestamp() });
}

/** Coordonnées ou adresses dans un texte public (réponse à un avis). */
export function containsContactDetails(text: string): boolean {
  const email = /[\w.+-]+@[\w-]+\.[\w.]+/;
  const phone = /(?:\+|00)?\d(?:[\s.-]?\d){8,}/;
  return email.test(text) || phone.test(text);
}
