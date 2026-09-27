// Libellés et tons d'affichage des statuts (tickets, avis, emplacements sponsorisés).
import type { StatusMeta } from '@golink/ui';
import {
  REVIEW_STATUS_LABELS,
  TICKET_PRIORITY_LABELS,
  TICKET_STATUS_LABELS,
  type ContentReport,
  type ReviewStatus,
  type SponsoredSlot,
  type TicketPriority,
  type TicketRequesterType,
  type TicketStatus,
} from '@golink/shared';

export const TICKET_STATUS_META: Record<TicketStatus, StatusMeta> = {
  open: { label: TICKET_STATUS_LABELS.open, tone: 'brand', pulse: true },
  in_progress: { label: TICKET_STATUS_LABELS.in_progress, tone: 'info' },
  waiting_customer: { label: TICKET_STATUS_LABELS.waiting_customer, tone: 'amber' },
  resolved: { label: TICKET_STATUS_LABELS.resolved, tone: 'success' },
  closed: { label: TICKET_STATUS_LABELS.closed, tone: 'neutral' },
};

export const TICKET_PRIORITY_META: Record<TicketPriority, StatusMeta> = {
  low: { label: TICKET_PRIORITY_LABELS.low, tone: 'neutral' },
  normal: { label: TICKET_PRIORITY_LABELS.normal, tone: 'info' },
  high: { label: TICKET_PRIORITY_LABELS.high, tone: 'amber' },
  urgent: { label: TICKET_PRIORITY_LABELS.urgent, tone: 'danger', pulse: true },
};

export const REQUESTER_LABELS: Record<TicketRequesterType, string> = {
  client: 'Client',
  restaurant: 'Restaurant',
  driver: 'Livreur',
};

export const REQUESTER_TONES: Record<TicketRequesterType, 'info' | 'brand' | 'plum'> = {
  client: 'info',
  restaurant: 'brand',
  driver: 'plum',
};

export const CHANNEL_LABELS: Record<string, string> = {
  app: 'Application',
  email: 'E-mail',
  chat: 'Chat',
  phone: 'Téléphone',
  backoffice: 'Back-office',
};

export const REVIEW_STATUS_META: Record<ReviewStatus, StatusMeta> = {
  published: { label: REVIEW_STATUS_LABELS.published, tone: 'success' },
  pending_moderation: { label: REVIEW_STATUS_LABELS.pending_moderation, tone: 'amber', pulse: true },
  hidden: { label: REVIEW_STATUS_LABELS.hidden, tone: 'neutral' },
  removed: { label: REVIEW_STATUS_LABELS.removed, tone: 'danger' },
};

export const REPORT_REASON_LABELS: Record<ContentReport['reason'], string> = {
  illegal: 'Contenu illicite',
  hate: 'Propos haineux',
  harassment: 'Harcèlement',
  personal_data: 'Données personnelles',
  fake: 'Avis mensonger',
  spam: 'Publicité, spam',
  other: 'Autre',
};

export const REPORT_STATUS_META: Record<ContentReport['status'], StatusMeta> = {
  open: { label: 'À examiner', tone: 'brand', pulse: true },
  under_review: { label: 'En cours d’examen', tone: 'info' },
  actioned: { label: 'Contenu retiré', tone: 'danger' },
  dismissed: { label: 'Sans suite', tone: 'neutral' },
};

export const REPORTER_LABELS: Record<ContentReport['reporterType'], string> = {
  client: 'Client',
  restaurant: 'Restaurant',
  driver: 'Livreur',
  anonymous: 'Anonyme',
  system: 'Filtre automatique',
};

export const SLOT_LABELS: Record<SponsoredSlot, string> = {
  home_top: 'En tête de l’accueil',
  home_featured: 'Sélection de l’accueil',
  search_top: 'En tête des recherches',
  category_top: 'En tête d’une catégorie',
  banner: 'Bannière de l’accueil',
};

export const PLACEMENT_STATUS_META: Record<string, StatusMeta> = {
  pending_payment: { label: 'En attente de paiement', tone: 'amber' },
  scheduled: { label: 'Programmé', tone: 'info' },
  active: { label: 'En cours', tone: 'success', pulse: true },
  ended: { label: 'Terminé', tone: 'neutral' },
  cancelled: { label: 'Annulé', tone: 'danger' },
};

export const BILLING_LABELS: Record<string, string> = {
  invoice: 'Facturé',
  ad_credit: 'Crédit publicitaire',
  offered: 'Offert',
};

export const AUDIENCE_LABELS: Record<string, string> = {
  public: 'Public',
  client: 'Clients',
  restaurant: 'Restaurants',
  driver: 'Livreurs',
};
