import { useEffect, useState } from 'react';
import { limit, orderBy, query, where } from 'firebase/firestore';
import { getDownloadURL, ref as storageRef, uploadBytes } from 'firebase/storage';
import { FileText } from 'lucide-react';
import {
  COLLECTIONS,
  TICKET_PRIORITY_LABELS,
  TICKET_STATUS_LABELS,
  type HelpArticle,
  type StoredFile,
  type SupportTicket,
  type TicketReason,
  type WithId,
} from '@golink/shared';
import { Skeleton, type StatusMeta } from '@golink/ui';
import { useCan, useRestaurantAccess } from '@/auth/RestaurantAccess';
import { storage } from '@/lib/firebase';
import { callFunction, collectionAt, useCollection } from '@/lib/firestore';

export type TicketRow = WithId<SupportTicket>;

export const TICKET_STATUS: Record<SupportTicket['status'], StatusMeta> = {
  open: { label: TICKET_STATUS_LABELS.open, tone: 'brand', pulse: true },
  in_progress: { label: TICKET_STATUS_LABELS.in_progress, tone: 'info' },
  waiting_customer: { label: 'Votre réponse est attendue', tone: 'amber', pulse: true },
  resolved: { label: TICKET_STATUS_LABELS.resolved, tone: 'success' },
  closed: { label: TICKET_STATUS_LABELS.closed, tone: 'neutral' },
};

export const PRIORITY_TONE: Record<SupportTicket['priority'], 'neutral' | 'info' | 'amber' | 'danger'> = {
  low: 'neutral',
  normal: 'info',
  high: 'amber',
  urgent: 'danger',
};
export { TICKET_PRIORITY_LABELS };

export function useRestaurantTickets() {
  const { restaurantId } = useRestaurantAccess();
  const can = useCan();
  return useCollection<SupportTicket>(
    can('support.use')
      ? query(
          collectionAt(COLLECTIONS.supportTickets),
          where('restaurantId', '==', restaurantId),
          where('requesterType', '==', 'restaurant'),
          orderBy('lastMessageAt', 'desc'),
          limit(100),
        )
      : null,
  );
}

/** Pastille de menu : réponses du support non lues. */
export function useSupportUnreadCount(): number | null {
  const { data } = useRestaurantTickets();
  const n = data.filter((t) => t.unreadByRequester > 0 || t.status === 'waiting_customer').length;
  return n > 0 ? n : null;
}

export function useTicketReasons() {
  const state = useCollection<TicketReason>(query(collectionAt(COLLECTIONS.ticketReasons), where('audience', 'array-contains', 'restaurant')));
  return { ...state, data: state.data.filter((r) => r.active).sort((a, b) => a.order - b.order) };
}

export function useHelpArticles() {
  return useCollection<HelpArticle>(
    query(collectionAt(COLLECTIONS.helpArticles), where('audience', 'array-contains', 'restaurant'), where('published', '==', true), orderBy('order'), limit(100)),
  );
}

export interface TicketAttachmentInput {
  path: string;
  contentType: string;
  size: number;
  name: string | null;
}

export const createSupportTicket = callFunction<
  { restaurantId: string; reasonId: string; subject: string; body: string; orderId: string | null; urgent: boolean },
  { ticketId: string; number: string; messageId: string }
>('createSupportTicket');
export const replyToSupportTicket = callFunction<
  { ticketId: string; body: string; attachments: TicketAttachmentInput[]; appendToMessageId: string | null },
  { messageId: string; status?: SupportTicket['status'] }
>('replyToSupportTicket');
export const updateSupportTicket = callFunction<{ ticketId: string; action: 'close' | 'reopen' }, { status: SupportTicket['status'] }>('updateSupportTicket');
export const recordHelpArticleFeedback = callFunction<{ articleId: string; action: 'view' | 'helpful_yes' | 'helpful_no' }, { ok: true }>('recordHelpArticleFeedback');

export async function uploadTicketFiles(ticketId: string, files: File[]): Promise<TicketAttachmentInput[]> {
  const out: TicketAttachmentInput[] = [];
  for (const file of files) {
    const safe = file.name.normalize('NFD').replace(/[^\w.-]+/g, '-').slice(-60);
    const path = `support/${ticketId}/${Date.now()}-${safe}`;
    await uploadBytes(storageRef(storage, path), file, { contentType: file.type });
    out.push({ path, contentType: file.type, size: file.size, name: file.name });
  }
  return out;
}

/** Pièce jointe privée : lien de téléchargement obtenu à l'affichage (règles Storage). */
export function Attachment({ file }: { file: StoredFile }) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    getDownloadURL(storageRef(storage, file.path))
      .then((u) => active && setUrl(u))
      .catch(() => active && setFailed(true));
    return () => {
      active = false;
    };
  }, [file.path]);
  const image = file.contentType.startsWith('image/');
  if (failed) return <span className="text-xs text-fg-subtle">Pièce jointe indisponible</span>;
  if (!url) return <Skeleton className={image ? 'size-24 rounded-lg' : 'h-9 w-40 rounded-lg'} />;
  return image ? (
    <a href={url} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-lg border border-border">
      <img src={url} alt={file.name ?? 'Pièce jointe'} className="size-24 object-cover" />
    </a>
  ) : (
    <a href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-xs text-fg hover:bg-surface-2">
      <FileText className="size-4 text-fg-subtle" />
      <span className="max-w-48 truncate">{file.name ?? 'Document'}</span>
    </a>
  );
}
