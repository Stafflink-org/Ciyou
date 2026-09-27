// Messages automatiques de l'établissement (restaurants/{rid}/marketing/autoMessages) :
// messages de suivi de commande dans la messagerie et remerciement des avis positifs.
// Chaque envoi a un identifiant fixe : un trigger rejoué ne crée pas de doublon.
import {
  AUTO_MESSAGE_DEFINITIONS,
  COLLECTIONS,
  RESTAURANT_MARKETING_DOCS,
  SUBCOLLECTIONS,
  renderMessageTemplate,
  type AutoMessageKey,
  type ConversationMessage,
  type Order,
  type Restaurant,
  type RestaurantAutoMessages,
  type Review,
} from '@golink/shared';
import { logger } from 'firebase-functions/v2';
import { onDocumentUpdated, onDocumentWritten } from 'firebase-functions/v2/firestore';
import { db, Timestamp } from '../../lib/admin';
import { isFirestoreAlreadyExists } from '../../lib/errors';
import { firstName } from '../../marketing/restaurant/helpers';
import { ensureOrderConversation } from './conversations';

async function loadAutoMessages(restaurantId: string): Promise<RestaurantAutoMessages['messages'] | null> {
  const snap = await db
    .collection(COLLECTIONS.restaurants)
    .doc(restaurantId)
    .collection(SUBCOLLECTIONS.restaurants.marketing)
    .doc(RESTAURANT_MARKETING_DOCS.autoMessages)
    .get();
  return snap.exists ? (snap.data() as RestaurantAutoMessages).messages : null;
}

function enabledBody(settings: RestaurantAutoMessages['messages'] | null, key: AutoMessageKey): string | null {
  const setting = settings?.[key];
  if (!setting?.enabled) return null;
  return setting.body?.trim() || AUTO_MESSAGE_DEFINITIONS[key].defaultBody;
}

/** Les messages de l'étape à envoyer pour une transition de commande. */
function dueMessages(before: Order, after: Order): Array<{ key: AutoMessageKey; minutes?: number }> {
  const due: Array<{ key: AutoMessageKey; minutes?: number }> = [];
  if (before.status !== after.status) {
    if (after.status === 'accepted') due.push({ key: 'order_accepted' });
    if (after.status === 'ready' && after.fulfillment === 'pickup') due.push({ key: 'order_ready_pickup' });
    if (after.status === 'ready' && after.fulfillment === 'delivery' && after.driverId) due.push({ key: 'driver_order_ready' });
    if (after.status === 'delivered') due.push({ key: 'order_delivered_thanks' });
  }
  const extended = (after.prepExtendedMinutes ?? 0) - (before.prepExtendedMinutes ?? 0);
  if (extended > 0 && ['accepted', 'preparing'].includes(after.status)) due.push({ key: 'order_delayed', minutes: extended });
  return due;
}

export const onOrderAutoMessages = onDocumentUpdated(`${COLLECTIONS.orders}/{orderId}`, async (event) => {
  const before = event.data?.before.data() as Order | undefined;
  const after = event.data?.after.data() as Order | undefined;
  if (!before || !after) return;
  const due = dueMessages(before, after);
  if (due.length === 0) return;
  const settings = await loadAutoMessages(after.restaurantId);
  if (!settings) return;
  const restaurant = (await db.collection(COLLECTIONS.restaurants).doc(after.restaurantId).get()).data() as Restaurant | undefined;
  if (!restaurant) return;

  for (const { key, minutes } of due) {
    const body = enabledBody(settings, key);
    if (!body) continue;
    const definition = AUTO_MESSAGE_DEFINITIONS[key];
    try {
      const { id } = await ensureOrderConversation(event.params.orderId, definition.audience, []);
      const text = renderMessageTemplate(body, {
        prenom: firstName(after.customerName),
        restaurant: restaurant.name,
        commande: after.number,
        code: after.pickupCode ?? '',
        minutes: minutes ? String(minutes) : '',
        livreur: firstName(after.delivery?.driverName),
      });
      const message: ConversationMessage = {
        senderId: restaurant.ownerId,
        senderRole: 'restaurant',
        senderName: `${restaurant.name} · message automatique`,
        text,
        attachments: [],
        readBy: [restaurant.ownerId],
        createdAt: Timestamp.now(),
        auto: key,
        processedAt: null,
      };
      // Identifiant fixe par étape (le retard peut se répéter : horodaté).
      const messageId = key === 'order_delayed' ? `auto-${key}-${after.prepExtendedMinutes}` : `auto-${key}`;
      await db
        .collection(COLLECTIONS.conversations)
        .doc(id)
        .collection(SUBCOLLECTIONS.conversations.messages)
        .doc(messageId)
        .create(message);
    } catch (error) {
      if (isFirestoreAlreadyExists(error)) continue;
      logger.warn('Message automatique non envoyé', { orderId: event.params.orderId, key, error: error instanceof Error ? error.message : String(error) });
    }
  }
});

/** Réponse automatique aux avis de 4 et 5 étoiles au moment de leur publication. */
export const onReviewAutoReply = onDocumentWritten(`${COLLECTIONS.reviews}/{orderId}`, async (event) => {
  const before = event.data?.before.data() as Review | undefined;
  const after = event.data?.after.data() as Review | undefined;
  if (!after || after.status !== 'published' || after.reply || after.restaurantRating < 4) return;
  if (before?.status === 'published') return;
  const settings = await loadAutoMessages(after.restaurantId);
  const body = enabledBody(settings, 'review_thanks');
  if (!body) return;
  const restaurant = (await db.collection(COLLECTIONS.restaurants).doc(after.restaurantId).get()).data() as Restaurant | undefined;
  if (!restaurant) return;
  const ref = db.collection(COLLECTIONS.reviews).doc(event.params.orderId);
  await db.runTransaction(async (tx) => {
    const current = (await tx.get(ref)).data() as Review | undefined;
    if (!current || current.reply || current.status !== 'published') return;
    tx.update(ref, {
      reply: {
        text: renderMessageTemplate(body, { prenom: firstName(after.customerDisplayName), restaurant: restaurant.name }),
        by: 'system',
        at: Timestamp.now(),
        status: 'published',
      },
      updatedAt: Timestamp.now(),
    });
  });
});
