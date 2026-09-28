// Messagerie de l'établissement avec ses clients et ses livreurs, liée aux
// commandes. Les compteurs de non-lus et le dernier message de chaque fil sont
// tenus par le trigger `onConversationMessageCreated` (idempotent).
import {
  COLLECTIONS,
  SUBCOLLECTIONS,
  type Conversation,
  type ConversationMessage,
  type Order,
  type Restaurant,
  type StoredFile,
} from '@golink/shared';
import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { db, Timestamp } from '../../lib/admin';
import { callable } from '../../lib/callable';
import { fail } from '../../lib/errors';
import { requireRestaurantAccess } from '../../lib/permissions';
import { z, zId } from '../../lib/validation';
import { actorDisplayName, notifyUser } from '../../marketing/restaurant/helpers';
import { countTemplateUse } from './reviews';

const DAY = 86_400_000;
/** Durée pendant laquelle un fil peut être ouvert après la commande. */
const CONVERSATION_WINDOW_DAYS = 7;

export function conversationIdFor(orderId: string, kind: 'client' | 'driver'): string {
  return kind === 'client' ? `conv-${orderId}` : `convd-${orderId}`;
}

/**
 * Crée (ou rouvre) le fil d'une commande avec le client ou le livreur. Le
 * propriétaire de l'établissement et `staffUids` en sont participants.
 */
export async function ensureOrderConversation(
  orderId: string,
  kind: 'client' | 'driver',
  staffUids: string[],
): Promise<{ id: string; created: boolean }> {
  const orderSnap = await db.collection(COLLECTIONS.orders).doc(orderId).get();
  if (!orderSnap.exists) throw fail.notFound('Commande');
  const order = orderSnap.data() as Order;
  const restaurantSnap = await db.collection(COLLECTIONS.restaurants).doc(order.restaurantId).get();
  const restaurant = restaurantSnap.data() as Restaurant;
  const counterpartId = kind === 'client' ? order.customerId : (order.driverId ?? order.delivery?.driverId ?? null);
  if (!counterpartId) throw fail.precondition('Aucun livreur n’est encore assigné à cette commande.');
  const counterpartName = kind === 'client' ? order.customerName : (order.delivery?.driverName ?? 'Livreur');

  const ref = db.collection(COLLECTIONS.conversations).doc(conversationIdFor(orderId, kind));
  const staff = [...new Set([restaurant.ownerId, ...staffUids].filter(Boolean))];
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (snap.exists) {
      const current = snap.data() as Conversation;
      const missing = staff.filter((uid) => !current.participantIds.includes(uid));
      const patch: Record<string, unknown> = {};
      if (missing.length) {
        patch.participantIds = [...current.participantIds, ...missing];
        for (const uid of missing) patch[`participants.${uid}`] = { name: restaurant.name, role: 'restaurant' };
      }
      if (current.closed) patch.closed = false;
      if (Object.keys(patch).length) tx.update(ref, patch);
      return { id: ref.id, created: false };
    }
    const participants: Conversation['participants'] = {
      [counterpartId]: { name: counterpartName, role: kind === 'client' ? 'client' : 'driver' },
    };
    for (const uid of staff) participants[uid] = { name: restaurant.name, role: 'restaurant' };
    const conversation: Conversation & { orderNumber?: string } = {
      type: kind === 'client' ? 'restaurant_client' : 'restaurant_driver',
      restaurantId: order.restaurantId,
      orderId,
      orderNumber: order.number,
      ticketId: null,
      participantIds: [counterpartId, ...staff],
      participants,
      lastMessage: '',
      lastMessageAt: Timestamp.now(),
      unread: {},
      closed: false,
      createdAt: Timestamp.now(),
    };
    tx.create(ref, conversation);
    return { id: ref.id, created: true };
  });
}

export const openOrderConversation = callable(
  z.object({ orderId: zId, with: z.enum(['client', 'driver']) }),
  async (data, request) => {
    const order = (await db.collection(COLLECTIONS.orders).doc(data.orderId).get()).data() as Order | undefined;
    if (!order) throw fail.notFound('Commande');
    const actor = await requireRestaurantAccess(request, order.restaurantId, 'messages.use', 'support.view');
    const placedAt = order.timeline?.placedAt?.toMillis() ?? order.createdAt.toMillis();
    if (Date.now() - placedAt > CONVERSATION_WINDOW_DAYS * DAY) {
      throw fail.precondition(`La messagerie est disponible pendant ${CONVERSATION_WINDOW_DAYS} jours après la commande. Passez par le support pour une commande plus ancienne.`);
    }
    return ensureOrderConversation(data.orderId, data.with, [actor.caller.uid]);
  },
);

const attachmentSchema = z.object({
  path: z.string().min(1).max(300),
  url: z.string().url().max(2000).nullable().default(null),
  contentType: z.string().regex(/^image\/(jpeg|png|webp|avif)$/, 'Seules les images sont acceptées.'),
  size: z.number().int().min(1).max(5 * 1024 * 1024, 'Une image ne doit pas dépasser 5 Mo.'),
  name: z.string().max(200).nullable().default(null),
});

export const sendMessage = callable(
  z.object({
    conversationId: zId,
    text: z.string().trim().max(2000).default(''),
    attachments: z.array(attachmentSchema).max(4).default([]),
    templateId: zId.nullable().default(null),
  }),
  async (data, request) => {
    if (!data.text && data.attachments.length === 0) throw fail.invalid('Écrivez un message ou joignez une image.');
    const ref = db.collection(COLLECTIONS.conversations).doc(data.conversationId);
    const snap = await ref.get();
    const conversation = snap.data() as Conversation | undefined;
    if (!conversation?.restaurantId) throw fail.notFound('Conversation');
    const actor = await requireRestaurantAccess(request, conversation.restaurantId, 'messages.use');
    if (conversation.closed) throw fail.precondition('Cette conversation est close : la commande est terminée depuis plusieurs jours.');
    for (const file of data.attachments) {
      if (!file.path.startsWith(`conversations/${data.conversationId}/`)) throw fail.invalid('Pièce jointe invalide.');
    }

    const uid = actor.caller.uid;
    if (!conversation.participantIds.includes(uid)) {
      const restaurant = (await db.collection(COLLECTIONS.restaurants).doc(conversation.restaurantId).get()).data() as Restaurant;
      await ref.update({
        participantIds: [...conversation.participantIds, uid],
        [`participants.${uid}`]: { name: restaurant.name, role: 'restaurant' },
      });
    }
    const now = Timestamp.now();
    const attachments: StoredFile[] = data.attachments.map((file) => ({ ...file, uploadedAt: now, uploadedBy: uid }));
    const message: ConversationMessage = {
      senderId: uid,
      senderRole: 'restaurant',
      senderName: actorDisplayName(actor),
      text: data.text,
      attachments,
      readBy: [uid],
      createdAt: now,
      auto: null,
      processedAt: null,
    };
    const messageRef = await ref.collection(SUBCOLLECTIONS.conversations.messages).add(message);
    await countTemplateUse(conversation.restaurantId, data.templateId);
    return { messageId: messageRef.id };
  },
);

function preview(message: ConversationMessage): string {
  if (message.text) return message.text.length > 140 ? `${message.text.slice(0, 137)}…` : message.text;
  return message.attachments.length > 1 ? `${message.attachments.length} photos` : 'Photo';
}

/**
 * Répercute chaque nouveau message sur son fil : aperçu, date, non-lus des autres
 * participants. Un message de l'équipe remet à zéro les non-lus de l'équipe et
 * notifie le client ou le livreur dans son application.
 */
export const onConversationMessageCreated = onDocumentCreated(
  `${COLLECTIONS.conversations}/{conversationId}/${SUBCOLLECTIONS.conversations.messages}/{messageId}`,
  async (event) => {
    const messageRef = event.data?.ref;
    if (!messageRef) return;
    const conversationRef = db.collection(COLLECTIONS.conversations).doc(event.params.conversationId);
    const outcome = await db.runTransaction(async (tx) => {
      const [messageSnap, conversationSnap] = await Promise.all([tx.get(messageRef), tx.get(conversationRef)]);
      const message = messageSnap.data() as ConversationMessage | undefined;
      const conversation = conversationSnap.data() as Conversation | undefined;
      if (!message || !conversation || message.processedAt) return null;
      const unread = { ...(conversation.unread ?? {}) };
      const fromTeam = message.senderRole === 'restaurant';
      for (const uid of conversation.participantIds) {
        if (uid === message.senderId) continue;
        const role = conversation.participants[uid]?.role;
        if (fromTeam && role === 'restaurant') unread[uid] = 0;
        else unread[uid] = (unread[uid] ?? 0) + 1;
      }
      unread[message.senderId] = 0;
      const lastAt = message.createdAt ?? Timestamp.now();
      const newer = !conversation.lastMessageAt || lastAt.toMillis() >= conversation.lastMessageAt.toMillis() || !conversation.lastMessage;
      tx.update(conversationRef, {
        unread,
        ...(newer ? { lastMessage: preview(message), lastMessageAt: lastAt, lastSenderRole: message.senderRole } : {}),
      });
      tx.update(messageRef, { processedAt: Timestamp.now() });
      return { message, conversation };
    });
    if (!outcome || outcome.message.senderRole !== 'restaurant') return;
    const { message, conversation } = outcome;
    const recipients = conversation.participantIds.filter((uid) => {
      const role = conversation.participants[uid]?.role;
      return uid !== message.senderId && (role === 'client' || role === 'driver');
    });
    const restaurantName = Object.values(conversation.participants).find((p) => p.role === 'restaurant')?.name ?? 'Le restaurant';
    await Promise.all(
      recipients.map((uid) =>
        notifyUser(uid, {
          title: `Message de ${restaurantName}`,
          body: preview(message),
          category: 'order',
          link: conversation.orderId ? { type: 'order', target: conversation.orderId } : null,
        }),
      ),
    );
  },
);
