// Expérience client côté super admin : mise en avant payante, filtre des avis,
// suivi qualité des notes, et contrats des Cloud Functions support / modération.
import type { AdminRole, TicketPriority, TicketStatus } from '../constants/enums';
import type { RefundCause } from '../pricing/policies';
import type { Cents } from '../pricing/money';
import type { Timestamp, Tracked } from './common';
import type { RatingWatchThresholds, SponsoredPlacement } from './platform';

// ============================================================ Mise en avant payante

export type SponsoredSlot = SponsoredPlacement['slot'];

/** sponsoredOffers/{id} : offre de visibilité vendue aux commerces. */
export interface SponsoredOffer extends Tracked {
  slot: SponsoredSlot;
  label: string;
  description?: string | null;
  /** Villes où l'offre est proposée ; null = toutes. */
  cityIds: string[] | null;
  durationDays: number;
  priceHtCents: Cents;
  /** Nombre maximal de commerces mis en avant en même temps sur cet emplacement, par ville. */
  maxConcurrent: number;
  active: boolean;
  order: number;
}

// ============================================================ Filtre des avis

export type ModerationCategory = 'insult' | 'hate' | 'threat' | 'sexual' | 'personal_data' | 'spam' | 'other';

/** moderationTerms/{id} : terme surveillé par le filtre automatique des avis. */
export interface ModerationTerm extends Tracked {
  term: string;
  category: ModerationCategory;
  /** block : l'avis n'est pas publié et part en modération ; flag : publié mais signalé. */
  action: 'block' | 'flag';
  active: boolean;
  hits: number;
}

// ============================================================ Suivi qualité

/** ratingWatch/{entityType_entityId} : note en baisse d'un restaurant ou d'un livreur. */
export interface RatingWatch {
  entityType: 'restaurant' | 'driver';
  entityId: string;
  name: string;
  countryId: string | null;
  cityId: string | null;
  /** Moyenne des 30 derniers jours et des 30 jours précédents. */
  currentAverage: number | null;
  previousAverage: number | null;
  currentCount: number;
  previousCount: number;
  /** Écart (current - previous), en points de note. */
  delta: number | null;
  /** Avis à 1 ou 2 étoiles sur la période courante. */
  lowRatings: number;
  overallAverage: number | null;
  level: 'ok' | 'watch' | 'alert';
  /** Évolution hebdomadaire des 8 dernières semaines (moyenne ou null). */
  weekly: Array<number | null>;
  acknowledgedAt?: Timestamp | null;
  acknowledgedBy?: string | null;
  note?: string | null;
  computedAt: Timestamp;
}

/** Seuils par défaut du suivi qualité (surchargés par settings/display.qualityWatch). */
export const DEFAULT_RATING_WATCH: RatingWatchThresholds = { minReviews: 5, watchDrop: 0.25, alertDrop: 0.5, alertBelow: 3.5 };

// ============================================================ Contrats des fonctions

export interface SupportAgent {
  uid: string;
  displayName: string;
  email: string;
  role: AdminRole;
  /** Peut traiter les tickets (attribution possible). */
  canHandle: boolean;
  canEscalate: boolean;
  refundLimitCents: Cents;
  openTickets: number;
  overdueTickets: number;
}

export interface AssignTicketsInput {
  ticketIds: string[];
  /** null : retirer l'attribution. */
  assigneeId: string | null;
}

export interface EscalateTicketInput {
  ticketId: string;
  /** Responsable destinataire ; null = file des responsables. */
  escalateTo: string | null;
  reason: string;
  /** Désescalade (retour au niveau 1). */
  release?: boolean;
}

export interface RespondToTicketInput {
  ticketId: string;
  body: string;
  internal: boolean;
  /** Statut appliqué après l'envoi (ex. en attente de réponse). */
  status?: TicketStatus | null;
  cannedResponseId?: string | null;
}

export interface UpdateTicketInput {
  ticketId: string;
  status?: TicketStatus;
  priority?: TicketPriority;
  reasonId?: string;
  tags?: string[];
  note?: string | null;
}

export interface RefundFromTicketInput {
  ticketId: string;
  amountCents: Cents;
  cause: RefundCause;
  reason: string;
}

export interface RefundFromTicketResult {
  refundId: string;
  status: 'processed' | 'pending_approval' | 'failed';
}

export interface ReviewTicketRefundInput {
  refundId: string;
  decision: 'approve' | 'reject';
  reason: string;
}

export interface CreditFromTicketInput {
  ticketId: string;
  amountCents: Cents;
  reason: string;
  /** Imputation : commerce (défaut, décision client) ou geste commercial GoLink. */
  chargedTo: 'restaurant' | 'platform';
  validityDays?: number | null;
}

export interface ContactTicketPartyInput {
  ticketId: string;
  party: 'requester' | 'restaurant' | 'driver';
  message: string;
}

export interface CreateTicketAsAgentInput {
  requesterType: 'client' | 'restaurant' | 'driver';
  requesterId: string;
  orderId?: string | null;
  reasonId: string;
  subject: string;
  body: string;
  channel: 'phone' | 'email' | 'chat' | 'backoffice';
  priority?: TicketPriority | null;
}

export interface ModerateReviewInput {
  orderId: string;
  target: 'review' | 'reply';
  action: 'hide' | 'remove' | 'restore' | 'publish';
  reason: string;
  /** Signalement (contentReports) clôturé par cette décision. */
  reportId?: string | null;
}

export interface DecideContentReportInput {
  reportId: string;
  decision: 'no_action' | 'hidden' | 'removed';
  reason: string;
}

export interface PublishPageInput {
  kind: 'page' | 'legal';
  /** Slug de la page ou identifiant du document légal (brouillon). */
  id: string;
  changeSummary?: string | null;
  /** Document légal : exiger une nouvelle acceptation. */
  requiresReacceptance?: boolean;
}

export interface BookSponsoredPlacementInput {
  restaurantId: string;
  offerId: string;
  /** Jour de début AAAA-MM-JJ (fuseau de Paris). */
  startDay: string;
  /** Nombre de périodes de l'offre (durée totale = durationDays × periods). */
  periods: number;
  billing: 'invoice' | 'ad_credit' | 'offered';
  categoryId?: string | null;
  note?: string | null;
}

export interface UpdateExperienceSettingsInput {
  doc: 'display' | 'support';
  values: Record<string, unknown>;
  reason?: string | null;
}

export interface SupportChatInput {
  conversationId: string;
  text: string;
}
