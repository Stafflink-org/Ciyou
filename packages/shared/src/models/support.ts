// Support et litiges, messagerie, avis et signalements de contenus.
import type {
  ReportStatus,
  ReviewStatus,
  TicketPriority,
  TicketRequesterType,
  TicketStatus,
} from '../constants/enums';
import type { Cents } from '../pricing/money';
import type { LocalizedText, StoredFile, Timestamp, Tracked } from './common';

/** supportTickets/{id}. */
export interface SupportTicket extends Tracked {
  /** Numéro lisible, ex. T-004512. */
  number: string;
  requesterType: TicketRequesterType;
  requesterId: string;
  requesterName: string;
  restaurantId?: string | null;
  driverId?: string | null;
  orderId?: string | null;
  countryId: string;
  cityId?: string | null;
  reasonId: string;
  subject: string;
  status: TicketStatus;
  priority: TicketPriority;
  channel: 'app' | 'email' | 'chat' | 'phone' | 'backoffice';
  assigneeId?: string | null;
  escalated: boolean;
  escalatedTo?: string | null;
  escalatedAt?: Timestamp | null;
  firstResponseAt?: Timestamp | null;
  firstResponseDueAt: Timestamp;
  resolutionDueAt: Timestamp;
  resolvedAt?: Timestamp | null;
  closedAt?: Timestamp | null;
  refundIds: string[];
  compensationCents: Cents;
  satisfaction?: { score: 1 | 2 | 3 | 4 | 5; comment?: string | null; at: Timestamp } | null;
  tags: string[];
  lastMessageAt: Timestamp;
  lastMessagePreview: string;
  unreadByRequester: number;
  unreadBySupport: number;
  /** Motif de l'escalade vers un responsable. */
  escalationReason?: string | null;
  /** Dépassements des délais cibles, posés par la tâche planifiée `enforceTicketSla`. */
  slaFirstResponseBreached?: boolean;
  slaResolutionBreached?: boolean;
  /** Remboursement en attente de validation d'un responsable (au-delà du plafond de l'agent). */
  pendingRefundId?: string | null;
  /** Avoirs accordés depuis le ticket (centimes). */
  creditedCents?: number;
  /** Réclamation avec photo à l'origine du ticket (collection `orderClaims`). */
  claimId?: string | null;
}

/** supportTickets/{id}/messages/{mid}. */
export interface TicketMessage {
  authorType: 'requester' | 'agent' | 'system';
  authorId: string;
  authorName: string;
  body: string;
  /** Note interne visible des seuls agents. */
  internal: boolean;
  attachments: StoredFile[];
  action?: { type: 'refund' | 'credit' | 'status_change' | 'assignment' | 'escalation' | 'contact'; detail: string } | null;
  createdAt: Timestamp;
}

/** ticketReasons/{id} : motifs de contact (liste modifiable). */
export interface TicketReason {
  label: LocalizedText;
  audience: TicketRequesterType[];
  defaultPriority: TicketPriority;
  requiresOrder: boolean;
  order: number;
  active: boolean;
}

/** cannedResponses/{id} : réponses types. */
export interface CannedResponse extends Tracked {
  title: string;
  body: LocalizedText;
  reasonIds: string[];
  shortcut?: string | null;
  active: boolean;
  /** Utilisations depuis un ticket (écrit par Cloud Function). */
  usageCount?: number;
  lastUsedAt?: Timestamp | null;
}

/**
 * conversations/{id} : messagerie restaurant ↔ client, restaurant ↔ livreur,
 * client ↔ livreur pendant une commande, et chat en direct avec le support.
 */
export interface Conversation {
  type: 'restaurant_client' | 'restaurant_driver' | 'client_driver' | 'support_chat';
  restaurantId?: string | null;
  orderId?: string | null;
  ticketId?: string | null;
  participantIds: string[];
  participants: Record<string, { name: string; role: 'client' | 'driver' | 'restaurant' | 'admin' }>;
  lastMessage: string;
  lastMessageAt: Timestamp;
  unread: Record<string, number>;
  closed: boolean;
  createdAt: Timestamp;
}

/** conversations/{id}/messages/{mid}. */
export interface ConversationMessage {
  senderId: string;
  senderRole: 'client' | 'driver' | 'restaurant' | 'admin' | 'system';
  text: string;
  attachments: StoredFile[];
  readBy: string[];
  createdAt: Timestamp;
  /** Nom affiché de l'auteur (membre de l'équipe, client, livreur). */
  senderName?: string | null;
  /** Message automatique : clé du modèle qui l'a produit. */
  auto?: string | null;
  /** Posé par la Cloud Function qui a répercuté le message sur la conversation (idempotence). */
  processedAt?: Timestamp | null;
}

/** reviews/{id} (id = orderId : un avis par commande livrée). */
export interface Review {
  orderId: string;
  restaurantId: string;
  driverId?: string | null;
  customerId: string;
  customerDisplayName: string;
  countryId: string;
  cityId: string;
  restaurantRating: 1 | 2 | 3 | 4 | 5;
  driverRating?: 1 | 2 | 3 | 4 | 5 | null;
  comment?: string | null;
  tags: string[];
  status: ReviewStatus;
  /** Filtre automatique (insultes, données personnelles). */
  autoModeration?: { flagged: boolean; reasons: string[] } | null;
  moderation?: { action: 'hidden' | 'removed' | 'restored'; reason: string; by: string; at: Timestamp } | null;
  reply?: {
    text: string;
    by: string;
    at: Timestamp;
    status: 'published' | 'hidden';
    /** Décision de la modération Ciyou Eats sur la réponse. */
    moderation?: { action: 'hidden' | 'restored'; reason: string; by: string; at: Timestamp } | null;
  } | null;
  reportsCount: number;
  /** Signalement déposé par le restaurant concerné (Cloud Function `reportReview`). */
  restaurantReport?: { reason: string; at: Timestamp; by: string; reportId: string } | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

/** contentReports/{id} : signalement de contenu illicite (avis, photo, texte, restaurant). */
export interface ContentReport {
  targetType: 'review' | 'review_reply' | 'product' | 'restaurant' | 'image' | 'message';
  targetPath: string;
  restaurantId?: string | null;
  reporterId?: string | null;
  reporterType: 'client' | 'restaurant' | 'driver' | 'anonymous' | 'system';
  reason: 'illegal' | 'hate' | 'harassment' | 'personal_data' | 'fake' | 'spam' | 'other';
  details?: string | null;
  status: ReportStatus;
  decision?: { action: 'removed' | 'hidden' | 'no_action'; reason: string; by: string; at: Timestamp; notifiedReporter: boolean } | null;
  createdAt: Timestamp;
}
