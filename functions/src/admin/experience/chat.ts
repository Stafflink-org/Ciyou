// Chat en direct du support pendant une commande : ouverture d'un fil avec le
// client (et, au besoin, le livreur et le restaurant), intervention d'un agent
// dans une conversation existante, clôture. Compteurs et aperçu : trigger
// `onConversationMessageCreated`.
import {
  COLLECTIONS,
  SUBCOLLECTIONS,
  type Conversation,
  type ConversationMessage,
  type Order,
  type Restaurant,
} from '@golink/shared';
import { db, FieldValue, Timestamp } from '../../lib/admin';
import { actorFromCaller, writeAudit } from '../../lib/audit';
import { fail } from '../../lib/errors';
import { assertFeatureOn } from '../../lib/features';
import { assertAdminCovers, requireAdmin } from '../../lib/permissions';
import { z, zId } from '../../lib/validation';
import { agentPublicName, experienceCallable, loadSupportSettings, notify, preview } from './common';

export const openSupportChat = experienceCallable(
  z.object({
    orderId: zId,
    ticketId: zId.nullable().default(null),
    withDriver: z.boolean().default(false),
    withRestaurant: z.boolean().default(false),
    message: z.string().trim().min(2).max(2000),
  }),
  async (data, request) => {
    const { caller, admin } = await requireAdmin(request, 'support.handle');
    const order = (await db.collection(COLLECTIONS.orders).doc(data.orderId).get()).data() as Order | undefined;
    if (!order) throw fail.notFound('Commande');
    assertAdminCovers(admin, order.cityId);
    await assertFeatureOn('live_chat', { restaurantId: order.restaurantId, cityId: order.cityId, countryId: order.countryId }, 'Le chat en direct est désactivé.');
    // Réglage « Chat en direct » de `settings/support` (`SettingsPage.tsx`, écrit par `updateExperienceSettings`
    // mais jusqu'ici jamais lu par aucune fonction) : distinct de l'interrupteur §24 ci-dessus, propre au module
    // support. Absent en base = actif (comportement par défaut du reste des réglages support).
    const supportSettings = await loadSupportSettings();
    if (supportSettings.liveChatEnabled === false) throw fail.precondition('Le chat en direct est désactivé par l’équipe support.');
    const participants: Conversation['participants'] = {
      [caller.uid]: { name: agentPublicName(admin), role: 'admin' },
      [order.customerId]: { name: order.customerName, role: 'client' },
    };
    if (data.withDriver) {
      const driverId = order.driverId ?? order.delivery?.driverId ?? null;
      if (!driverId) throw fail.precondition('Aucun livreur n’est assigné à cette commande.');
      participants[driverId] = { name: order.delivery?.driverName ?? 'Livreur', role: 'driver' };
    }
    if (data.withRestaurant) {
      const restaurant = (await db.collection(COLLECTIONS.restaurants).doc(order.restaurantId).get()).data() as Restaurant | undefined;
      if (restaurant?.ownerId) participants[restaurant.ownerId] = { name: restaurant.name, role: 'restaurant' };
    }
    const ref = db.collection(COLLECTIONS.conversations).doc(`sup-${data.orderId}`);
    const at = Timestamp.now();
    await db.runTransaction(async (tx) => {
      const existing = (await tx.get(ref)).data() as Conversation | undefined;
      const merged = { ...(existing?.participants ?? {}), ...participants };
      if (existing) {
        tx.update(ref, { participants: merged, participantIds: Object.keys(merged), closed: false, ...(data.ticketId ? { ticketId: data.ticketId } : {}) });
      } else {
        const conversation: Conversation = {
          type: 'support_chat',
          restaurantId: order.restaurantId,
          orderId: data.orderId,
          ticketId: data.ticketId,
          participantIds: Object.keys(merged),
          participants: merged,
          lastMessage: preview(data.message),
          lastMessageAt: at,
          unread: {},
          closed: false,
          createdAt: at,
        };
        tx.create(ref, { ...conversation, countryId: order.countryId, cityId: order.cityId, orderNumber: order.number });
      }
      const message: ConversationMessage = { senderId: caller.uid, senderRole: 'admin', senderName: agentPublicName(admin), text: data.message, attachments: [], readBy: [caller.uid], createdAt: at };
      tx.create(ref.collection(SUBCOLLECTIONS.conversations.messages).doc(), message);
    });
    for (const uid of Object.keys(participants)) {
      if (uid === caller.uid) continue;
      await notify(uid, { title: `Support Ciyou Eats · ${order.number}`, body: preview(data.message), category: 'support', link: { type: 'order', target: data.orderId } });
    }
    await writeAudit({
      actor: actorFromCaller(caller, 'admin'),
      action: 'chat.opened',
      target: { type: 'order', id: data.orderId, label: order.number },
      after: { conversationId: ref.id, participants: Object.values(participants).map((p) => p.role) },
      countryId: order.countryId,
      cityId: order.cityId,
      request,
    });
    return { conversationId: ref.id };
  },
);

export const postSupportChatMessage = experienceCallable(
  z.object({ conversationId: zId, text: z.string().trim().min(1, 'Écrivez un message.').max(2000) }),
  async (data, request) => {
    const { caller, admin } = await requireAdmin(request, 'support.handle');
    const ref = db.collection(COLLECTIONS.conversations).doc(data.conversationId);
    const snap = await ref.get();
    const conversation = snap.data() as (Conversation & { cityId?: string | null }) | undefined;
    if (!conversation) throw fail.notFound('Conversation');
    if (conversation.cityId) assertAdminCovers(admin, conversation.cityId);
    if (conversation.closed) throw fail.precondition('Cette conversation est close.');
    const at = Timestamp.now();
    const joined = conversation.participantIds.includes(caller.uid);
    await db.runTransaction(async (tx) => {
      if (!joined) {
        tx.update(ref, {
          participantIds: FieldValue.arrayUnion(caller.uid),
          [`participants.${caller.uid}`]: { name: agentPublicName(admin), role: 'admin' },
        });
      }
      const message: ConversationMessage = { senderId: caller.uid, senderRole: 'admin', senderName: agentPublicName(admin), text: data.text, attachments: [], readBy: [caller.uid], createdAt: at };
      tx.create(ref.collection(SUBCOLLECTIONS.conversations.messages).doc(), message);
    });
    for (const uid of conversation.participantIds) {
      if (uid === caller.uid) continue;
      const role = conversation.participants[uid]?.role;
      if (role !== 'client' && role !== 'driver') continue;
      await notify(uid, {
        title: 'Message du support Ciyou Eats',
        body: preview(data.text),
        category: 'support',
        link: conversation.orderId ? { type: 'order', target: conversation.orderId } : null,
      });
    }
    if (!joined) {
      await writeAudit({
        actor: actorFromCaller(caller, 'admin'),
        action: 'chat.joined',
        target: { type: 'order', id: conversation.orderId ?? data.conversationId, label: data.conversationId },
        request,
      });
    }
    return { joined: !joined };
  },
);

export const closeSupportChat = experienceCallable(
  z.object({ conversationId: zId }),
  async (data, request) => {
    const { caller, admin } = await requireAdmin(request, 'support.handle');
    const ref = db.collection(COLLECTIONS.conversations).doc(data.conversationId);
    const conversation = (await ref.get()).data() as (Conversation & { cityId?: string | null }) | undefined;
    if (!conversation) throw fail.notFound('Conversation');
    if (conversation.type !== 'support_chat') throw fail.precondition('Seul un chat du support peut être clos ici.');
    if (conversation.cityId) assertAdminCovers(admin, conversation.cityId);
    if (conversation.closed) return { closed: true };
    const at = Timestamp.now();
    await db.runTransaction(async (tx) => {
      tx.update(ref, { closed: true });
      const message: ConversationMessage = { senderId: caller.uid, senderRole: 'system', senderName: 'Ciyou Eats', text: 'Conversation clôturée par le support. Merci de nous avoir contactés.', attachments: [], readBy: [caller.uid], createdAt: at, auto: 'support_closed' };
      tx.create(ref.collection(SUBCOLLECTIONS.conversations.messages).doc(), message);
    });
    await writeAudit({
      actor: actorFromCaller(caller, 'admin'),
      action: 'chat.closed',
      target: { type: 'order', id: conversation.orderId ?? data.conversationId, label: data.conversationId },
      before: { closed: false },
      after: { closed: true },
      cityId: conversation.cityId ?? null,
      request,
    });
    return { closed: true };
  },
);
