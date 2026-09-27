// Croissance et communication : promotions, campagnes, messages automatiques,
// journal des envois, annonces, prospection commerciale.
import type {
  CampaignChannel,
  CampaignStatus,
  FulfillmentMode,
  PromotionFunding,
  PromotionKind,
  PromotionScope,
  PromotionStatus,
  PromotionTarget,
  ProspectStage,
} from '../constants/enums';
import type { Bps, Cents } from '../pricing/money';
import type { PlanCode } from '../pricing/plans';
import type { LocalizedText, PostalAddress, Timestamp, Tracked } from './common';

/**
 * promotions/{id} : offre plateforme, pays, ville ou restaurant. Un code promo est
 * unique par portée ; la validation au panier se fait par Cloud Function
 * (la liste des codes n'est jamais exposée au client).
 */
export interface Promotion extends Tracked {
  scope: PromotionScope;
  countryId?: string | null;
  cityIds: string[];
  restaurantId?: string | null;
  /** Restaurants participants pour une offre plateforme ciblée. */
  restaurantIds: string[];
  title: LocalizedText;
  description?: LocalizedText | null;
  /** Code à saisir ; null = offre appliquée automatiquement. */
  code?: string | null;
  kind: PromotionKind;
  /** Bps pour un pourcentage, centimes pour un montant fixe. */
  value: number;
  maxDiscountCents?: Cents | null;
  minSubtotalCents: Cents;
  funding: PromotionFunding;
  restaurantShareBps?: Bps | null;
  target: PromotionTarget;
  inactiveDays?: number | null;
  modes: FulfillmentMode[];
  totalUsageLimit?: number | null;
  perCustomerLimit: number;
  startsAt: Timestamp;
  endsAt?: Timestamp | null;
  status: PromotionStatus;
  reviewNote?: string | null;
  /** Visible dans la vitrine de l'app client. */
  showcase: boolean;
  accent?: string | null;
  stats: { redemptions: number; discountCents: Cents; ordersSubtotalCents: Cents; newCustomers: number };
  /** Cycle de validation (promotions restaurant, Cloud Functions uniquement). */
  submittedAt?: Timestamp | null;
  approvedAt?: Timestamp | null;
  pausedAt?: Timestamp | null;
  endedAt?: Timestamp | null;
}

/** promotionRedemptions/{id} : utilisation d'une promotion (limite par client, coût). */
export interface PromotionRedemption {
  promotionId: string;
  code?: string | null;
  userId: string;
  orderId: string;
  restaurantId: string;
  cityId: string;
  discountCents: Cents;
  platformFundedCents: Cents;
  restaurantFundedCents: Cents;
  status: 'applied' | 'reversed';
  createdAt: Timestamp;
}

export interface AudienceFilter {
  userType: 'client' | 'restaurant' | 'driver';
  countryIds?: string[] | null;
  cityIds?: string[] | null;
  planCodes?: PlanCode[] | null;
  restaurantIds?: string[] | null;
  segment?: 'all' | 'new' | 'inactive' | 'loyal' | 'custom' | null;
  inactiveDays?: number | null;
  /** Envoi marketing : uniquement aux utilisateurs ayant consenti. */
  marketing: boolean;
}

/** campaigns/{id} : envoi push, e-mail ou SMS (plateforme ou restaurant). */
export interface Campaign extends Tracked {
  scope: 'platform' | 'restaurant';
  restaurantId?: string | null;
  name: string;
  channel: CampaignChannel;
  title: string;
  body: string;
  /** Sujet et contenu HTML pour l'e-mail. */
  emailSubject?: string | null;
  emailHtml?: string | null;
  link?: { type: 'restaurant' | 'promotion' | 'page' | 'url'; target: string } | null;
  audience: AudienceFilter;
  status: CampaignStatus;
  scheduledAt?: Timestamp | null;
  sentAt?: Timestamp | null;
  stats: { targeted: number; sent: number; delivered: number; opened: number; clicked: number; failed: number };
  /** Promotion mise en avant par la campagne (campagnes restaurant). */
  promotionId?: string | null;
  /** Mode test : les e-mails ne sont pas transmis au prestataire d'envoi. */
  testMode?: boolean;
  cancelledAt?: Timestamp | null;
  failureReason?: string | null;
}

/**
 * messageTemplates/{key} : textes des messages automatiques, modifiables sans
 * développeur (confirmation, livreur en route, validation de compte, facture…).
 */
export interface MessageTemplate {
  key: string;
  event: string;
  audience: 'client' | 'restaurant' | 'driver' | 'admin';
  channels: Array<'push' | 'email' | 'sms' | 'in_app'>;
  subject?: LocalizedText | null;
  title?: LocalizedText | null;
  body: LocalizedText;
  emailHtml?: LocalizedText | null;
  /** Variables disponibles, ex. {{orderNumber}}. */
  variables: string[];
  active: boolean;
  /** Identifiant du modèle côté Brevo, si l'e-mail y est mis en page. */
  brevoTemplateId?: number | null;
  updatedAt: Timestamp;
  updatedBy: string;
}

/** notificationLogs/{id} : trace de chaque envoi (support, preuve de consentement). */
export interface NotificationLog {
  channel: 'push' | 'email' | 'sms';
  templateKey?: string | null;
  campaignId?: string | null;
  recipientType: 'client' | 'restaurant' | 'driver' | 'admin';
  recipientId: string;
  /** Adresse masquée (e-mail ou téléphone). */
  destinationMasked: string;
  status: 'queued' | 'sent' | 'delivered' | 'opened' | 'bounced' | 'failed';
  provider: 'brevo' | 'fcm' | 'sms';
  providerMessageId?: string | null;
  error?: string | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

/** announcements/{id} : message affiché dans le back-office restaurant ou l'app livreur. */
export interface Announcement extends Tracked {
  audience: 'restaurants' | 'drivers';
  countryIds: string[] | null;
  cityIds: string[] | null;
  planCodes: PlanCode[] | null;
  title: string;
  body: string;
  severity: 'info' | 'important' | 'maintenance';
  link?: string | null;
  publishedAt: Timestamp;
  expiresAt?: Timestamp | null;
  active: boolean;
  requiresAcknowledgement: boolean;
}

/** prospects/{id} : restaurants démarchés (mini CRM). */
export interface Prospect extends Tracked {
  name: string;
  countryId: string;
  cityId: string;
  address?: PostalAddress | null;
  cuisine?: string | null;
  contactName?: string | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
  source: 'field' | 'inbound' | 'referral' | 'event' | 'import' | 'other';
  stage: ProspectStage;
  ownerId: string;
  estimatedMonthlyOrders?: number | null;
  nextFollowUpAt?: Timestamp | null;
  lostReason?: string | null;
  restaurantId?: string | null;
  signedUpAt?: Timestamp | null;
  notes?: string | null;
  /** Nom du commercial (copie pour l'affichage). */
  ownerName?: string | null;
  /** Dernière activité enregistrée (appel, visite, démo…). */
  lastActivityAt?: Timestamp | null;
}

/** prospects/{id}/activities/{aid}. */
export interface ProspectActivity {
  type: 'call' | 'email' | 'visit' | 'demo' | 'note' | 'stage_change';
  summary: string;
  fromStage?: ProspectStage | null;
  toStage?: ProspectStage | null;
  by: string;
  at: Timestamp;
}

/** salesCommissions/{id} : commission d'un commercial sur un restaurant signé. */
export interface SalesCommission {
  salesRepId: string;
  restaurantId: string;
  prospectId?: string | null;
  basis: 'signup_bonus' | 'revenue_share';
  amountCents: Cents;
  period?: string | null;
  status: 'pending' | 'approved' | 'paid' | 'cancelled';
  createdAt: Timestamp;
  paidAt?: Timestamp | null;
}

/**
 * settings/crm : rémunération des commerciaux et relances de prospection
 * (tout est paramétrable dans le super admin).
 */
export interface CrmSettings {
  /** Prime versée au commercial à l'inscription d'un restaurant démarché. */
  signupBonusCents: Cents;
  /** Part du chiffre de commission Ciyou Eats reversée au commercial (points de base). */
  revenueShareBps: Bps;
  /** Durée de l'intéressement après l'inscription (mois). */
  revenueShareMonths: number;
  /** Délai de relance proposé par défaut après une action (jours). */
  defaultFollowUpDays: number;
  /** Rappel quotidien des relances échues au commercial. */
  followUpReminders: boolean;
  updatedAt: Timestamp;
  updatedBy: string;
}
