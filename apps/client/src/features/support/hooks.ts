// Support et tickets côté client (§13 cahier super admin, cause dominante du
// verdict mobile) : ouverture réelle de ticket, chat, clôture/réouverture.
// Miroir client de `apps/restaurant/src/features/support` — mêmes collections
// (`supportTickets`, `.../messages`), mêmes règles Firestore génériques
// (`isTicketRequester` = `isSelf(requesterId)`), nouvelles Cloud Functions
// dédiées côté serveur (`functions/src/messaging/client/support.ts`).
import { orderBy, query, updateDoc, where } from 'firebase/firestore';
import type { SupportTicket, TicketMessage } from '@golink/shared';
import { collectionAt, callFunction, docAt, useCollection, useDoc } from '../../lib/firestore';
import { useAuth } from '../../auth/AuthContext';

export type TicketCategory = 'order' | 'account' | 'payment' | 'other';

export const CATEGORY_LABELS: Record<TicketCategory, string> = {
  order: 'Une commande',
  account: 'Mon compte',
  payment: 'Un paiement',
  other: 'Autre',
};

/** Tous les tickets ouverts par le client connecté, plus récents d'abord. */
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
  // champ (même contrainte déjà respectée par apps/restaurant/.../TicketPage.tsx).
  const q = query(collectionAt(`supportTickets/${ticketId}/messages`), where('internal', '==', false), orderBy('createdAt', 'asc'));
  return useCollection<TicketMessage>(q);
}

/** Marque les réponses du support comme lues (écriture directe autorisée par la règle). */
export async function markTicketRead(ticketId: string): Promise<void> {
  await updateDoc(docAt(`supportTickets/${ticketId}`), { unreadByRequester: 0 }).catch(() => undefined);
}

export const createClientTicket = callFunction<{ category: TicketCategory; subject: string; body: string; orderId: string | null }, { ticketId: string; number: string }>(
  'createClientTicket',
);

export const replyToClientTicket = callFunction<{ ticketId: string; body: string }, { messageId: string; status: SupportTicket['status'] }>('replyToClientTicket');

export const updateClientTicket = callFunction<{ ticketId: string; action: 'close' | 'reopen' }, { status: SupportTicket['status'] }>('updateClientTicket');
