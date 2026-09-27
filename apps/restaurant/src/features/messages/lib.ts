import { useMemo } from 'react';
import { limit, orderBy, query, where } from 'firebase/firestore';
import { COLLECTIONS, type Conversation, type WithId } from '@golink/shared';
import { useAuth } from '@golink/web';
import { useCan, useRestaurantAccess } from '@/auth/RestaurantAccess';
import { callFunction, collectionAt, useCollection } from '@/lib/firestore';
import { useOrderNumbers } from './order-numbers';

export type ConversationRow = WithId<Conversation & { orderNumber?: string; lastSenderRole?: string }>;
export type ThreadKind = 'restaurant_client' | 'restaurant_driver';

export function useConversations(max = 100) {
  const { restaurantId } = useRestaurantAccess();
  const can = useCan();
  const q = can('messages.use')
    ? query(
        collectionAt(COLLECTIONS.conversations),
        where('restaurantId', '==', restaurantId),
        where('type', 'in', ['restaurant_client', 'restaurant_driver']),
        orderBy('lastMessageAt', 'desc'),
        limit(max),
      )
    : null;
  const state = useCollection<Conversation>(q) as { data: ConversationRow[]; loading: boolean; error: ReturnType<typeof useCollection>['error'] };
  // Anciens fils sans numéro de commande : complétés depuis la commande.
  const numbers = useOrderNumbers(state.data.filter((c) => !c.orderNumber).map((c) => c.orderId));
  const data = useMemo(
    () => state.data.map((c) => (c.orderNumber || !c.orderId || !numbers[c.orderId] ? c : { ...c, orderNumber: numbers[c.orderId] })),
    [state.data, numbers],
  );
  return { ...state, data };
}

/** Pastille de menu : messages non lus par le membre connecté. */
export function useUnreadMessagesCount(): number | null {
  const { user } = useAuth();
  const { data } = useConversations(60);
  const uid = user?.uid ?? '';
  const total = data.reduce((sum, c) => sum + (c.unread?.[uid] ?? 0), 0);
  return total > 0 ? total : null;
}

/** Interlocuteur (client ou livreur) d'une conversation. */
export function counterpart(c: Conversation): { uid: string; name: string; role: 'client' | 'driver' } | null {
  for (const uid of c.participantIds) {
    const p = c.participants[uid];
    if (p && (p.role === 'client' || p.role === 'driver')) return { uid, name: p.name, role: p.role };
  }
  return null;
}

export interface AttachmentInput {
  path: string;
  url: string | null;
  contentType: string;
  size: number;
  name: string | null;
}

export const sendMessage = callFunction<{ conversationId: string; text: string; attachments: AttachmentInput[]; templateId: string | null }, { messageId: string }>('sendMessage');
export const openOrderConversation = callFunction<{ orderId: string; with: 'client' | 'driver' }, { id: string; created: boolean }>('openOrderConversation');
