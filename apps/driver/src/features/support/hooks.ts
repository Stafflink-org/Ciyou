// Support et tickets côté livreur (§13 cahier super admin) : ouverture réelle
// de ticket, chat, clôture/réouverture. Miroir de
// `apps/client/src/features/support/hooks.ts` — mêmes collections
// (`supportTickets`, `.../messages`), mêmes règles Firestore génériques
// (`isTicketRequester` = `isSelf(requesterId)`), nouvelles Cloud Functions
// dédiées côté serveur (`functions/src/messaging/driver/support.ts`).
import { orderBy, query, updateDoc, where } from 'firebase/firestore';
import type { SupportTicket, TicketMessage } from '@golink/shared';
import { collectionAt, callFunction, docAt, useCollection, useDoc } from '../../lib/firestore';
import { useAuth } from '../../auth/AuthContext';

export type TicketCategory = 'delivery' | 'account' | 'payment' | 'vehicle' | 'other';

/** Tous les tickets ouverts par le livreur connecté, plus récents d'abord. */
export function useMyTickets() {
  const { user } = useAuth();
  const q = user ? query(collectionAt('supportTickets'), where('requesterId', '==', user.uid), orderBy('lastMessageAt', 'desc')) : null;
  return useCollection<SupportTicket>(q);
}

export function useTicket(ticketId: string) {
  return useDoc<SupportTicket>(docAt(`supportTickets/${ticketId}`));
}

export function useTicketMessages(ticketId: string) {
  // `where('internal', '==', false)` est indispensable : la règle Firestore
  // conditionne la lecture à `resource.data.internal == false`, et Firestore
  // refuse une requête « list » qui ne filtre pas explicitement sur ce même
  // champ (même contrainte déjà respectée par les autres apps).
  const q = query(collectionAt(`supportTickets/${ticketId}/messages`), where('internal', '==', false), orderBy('createdAt', 'asc'));
  return useCollection<TicketMessage>(q);
}

/** Marque les réponses du support comme lues (écriture directe autorisée par la règle). */
export async function markTicketRead(ticketId: string): Promise<void> {
  await updateDoc(docAt(`supportTickets/${ticketId}`), { unreadByRequester: 0 }).catch(() => undefined);
}

export const createDriverTicket = callFunction<{ category: TicketCategory; subject: string; body: string; orderId: string | null }, { ticketId: string; number: string }>(
  'createDriverTicket',
);

export const replyToDriverTicket = callFunction<{ ticketId: string; body: string }, { messageId: string; status: SupportTicket['status'] }>('replyToDriverTicket');

export const updateDriverTicket = callFunction<{ ticketId: string; action: 'close' | 'reopen' }, { status: SupportTicket['status'] }>('updateDriverTicket');
