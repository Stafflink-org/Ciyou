// Automatismes décidés par le client : validation automatique des commerces,
// envoi réel des messages automatiques, remplacement d'un produit indisponible,
// client absent et réclamations avec photo. Réglages dans `settings/*` ou dans
// `settings/orderRules` (surchargeables par pays et par ville).
import type { Cents } from '../pricing/money';
import type { Timestamp } from './common';

// ------------------------------------------------------------------ Validation automatique des commerces

/** `off` : validation manuelle seule ; `suggest` : dossier signalé « validable en un clic » ; `auto` : mise en ligne automatique. */
export const MERCHANT_VALIDATION_MODES = ['off', 'suggest', 'auto'] as const;
export type MerchantValidationMode = (typeof MERCHANT_VALIDATION_MODES)[number];

/** settings/merchantValidation : règle activable depuis le super admin (décision client n° 14). */
export interface MerchantValidationSettings {
  mode: MerchantValidationMode;
  /** Contrat partenaire accepté en ligne (obligatoire à la validation manuelle). */
  requireContract: boolean;
  /** Numéro d'immatriculation conforme au format du pays (clé de contrôle comprise quand elle existe). */
  checkRegistrationNumber: boolean;
  /** Une pièce à date d'expiration doit rester valable au moins ce nombre de jours. */
  minDocumentValidityDays: number;
  /** Extrait Kbis (ou équivalent) délivré depuis moins de N jours ; 0 = pas de contrôle. */
  registrationDocumentMaxAgeDays: number;
  /** Ville active avec au moins une zone de livraison active. */
  requireActiveCity: boolean;
  /** Mise en ligne immédiate à la validation (sinon dossier validé mais commerce à ouvrir par le super admin). */
  goLive: boolean;
  /** Pays concernés ; null = tous. */
  countryIds: string[] | null;
  /** Plafond de validations automatiques par jour (garde-fou) ; 0 = illimité. */
  maxPerDay: number;
  updatedAt?: Timestamp;
  updatedBy?: string;
}

export const DEFAULT_MERCHANT_VALIDATION: Omit<MerchantValidationSettings, 'updatedAt' | 'updatedBy'> = {
  mode: 'auto',
  requireContract: true,
  checkRegistrationNumber: true,
  minDocumentValidityDays: 30,
  registrationDocumentMaxAgeDays: 90,
  requireActiveCity: true,
  goLive: true,
  countryIds: null,
  maxPerDay: 25,
};

/** Résultat d'un contrôle de validation automatique (affiché sur le dossier). */
export interface MerchantValidationCheck {
  code:
    | 'documents_complete'
    | 'documents_valid'
    | 'documents_recent'
    | 'registration_number'
    | 'contract_accepted'
    | 'city_active'
    | 'country_allowed'
    | 'daily_limit'
    | 'not_blocked';
  ok: boolean;
  detail: string;
}

/** restaurants/{id}.autoValidation : dernier examen automatique du dossier. */
export interface MerchantAutoValidation {
  at: Timestamp;
  mode: MerchantValidationMode;
  eligible: boolean;
  decided: boolean;
  checks: MerchantValidationCheck[];
}

// ------------------------------------------------------------------ Messages automatiques

/** settings/notificationDelivery : envoi réel ou simulation (dry-run) des messages automatiques. */
export interface NotificationDeliverySettings {
  /** E-mails (Brevo) réellement transmis ; sinon journalisés « préparé, non transmis ». */
  emailLive: boolean;
  smsLive: boolean;
  /** Push FCM réellement transmis (le message reste toujours écrit dans le centre de notifications). */
  pushLive: boolean;
  updatedAt?: Timestamp;
  updatedBy?: string;
}

export const DEFAULT_NOTIFICATION_DELIVERY: Omit<NotificationDeliverySettings, 'updatedAt' | 'updatedBy'> = {
  emailLive: false,
  smsLive: false,
  pushLive: false,
};

/** Clés des messages automatiques émis par le serveur (collection `messageTemplates`). */
export const PLATFORM_MESSAGE_KEYS = [
  'order_confirmed',
  'order_ready_pickup',
  'order_picked_up',
  'order_delivered',
  'order_cancelled',
  'order_customer_absent',
  'refund_issued',
  'late_credit_issued',
  'item_replacement_proposed',
  'item_removed',
  'claim_received',
  'claim_decided',
  'restaurant_new_order',
  'restaurant_approved',
  'restaurant_auto_approved',
  'restaurant_documents_missing',
  'restaurant_inactivity_warning',
  'restaurant_removed_inactive',
  'restaurant_auto_paused',
  'restaurant_document_expiring',
  'restaurant_payout_paid',
  'invoice_available',
  'subscription_payment_due',
  'subscription_restricted',
  'subscription_suspended',
  'subscription_restored',
  'cash_limit_reached',
  'driver_approved',
  'driver_payout_paid',
  'referral_rewarded',
  'zone_emergency_closure',
] as const;
export type PlatformMessageKey = (typeof PLATFORM_MESSAGE_KEYS)[number];

/**
 * Messages dont l'émission relève d'un autre module (reversements et facturation) : le gabarit
 * existe mais il n'est pas encore émis par le serveur. L'écran des messages automatiques le signale.
 */
export const NOT_YET_EMITTED_MESSAGE_KEYS: readonly string[] = [];

// ------------------------------------------------------------------ Produit indisponible

/** Proposition de remplacement d'un article indisponible, posée sur la commande (`itemProposals[lineId]`). */
export interface ItemProposal {
  lineId: string;
  /** `pending` : en attente du client ; `accepted` / `declined` / `expired` : décidée. */
  status: 'pending' | 'accepted' | 'declined' | 'expired';
  productName: string;
  replacementProductId: string;
  replacementName: string;
  /** Prix unitaire du produit de remplacement (le client ne paie jamais plus que l'article d'origine). */
  replacementUnitPriceCents: Cents;
  proposedAt: Timestamp;
  proposedBy: string;
  expiresAt: Timestamp;
  decidedAt?: Timestamp | null;
}

// ------------------------------------------------------------------ Client absent

/** Suivi de l'attente d'un client absent, posé sur la commande à l'arrivée du livreur. */
export interface CustomerAbsence {
  arrivedAt: Timestamp;
  /** Fin du temps d'attente (arrivée + `customerAbsent.driverWaitMinutes`). */
  waitUntil: Timestamp;
  /** Temps d'attente réglé à l'arrivée du livreur (minutes). */
  waitMinutes?: number;
  /** Appels passés via l'application (traçabilité). */
  calls: number;
  lastCallAt?: Timestamp | null;
  closedAt?: Timestamp | null;
  closedBy?: 'driver' | 'system' | null;
  /** Règles en vigueur à l'arrivée du livreur : qui est payé (décision client : livreur et commerce). */
  payDriver?: boolean;
  payRestaurant?: boolean;
}

// ------------------------------------------------------------------ Réclamations avec photo

export const CLAIM_TYPES = ['missing_item', 'damaged_item', 'wrong_item', 'quality', 'not_received', 'other'] as const;
export type ClaimType = (typeof CLAIM_TYPES)[number];

export const CLAIM_STATUSES = ['pending_review', 'accepted', 'rejected'] as const;
export type ClaimStatus = (typeof CLAIM_STATUSES)[number];

export type ClaimCheckCode =
  | 'window'
  | 'photo_present'
  | 'photo_readable'
  | 'photo_size'
  | 'photo_duplicate_own'
  | 'photo_duplicate_other'
  | 'photo_date'
  | 'lines_valid'
  | 'already_claimed'
  | 'repeat_claims';

export interface ClaimPhoto {
  path: string;
  contentType: string;
  size: number;
  /** Empreinte SHA-256 du fichier (détection de doublons). */
  sha256: string;
  width?: number | null;
  height?: number | null;
  /** Date de prise de vue lue dans les métadonnées de la photo (EXIF), si présente. */
  takenAt?: Timestamp | null;
}

export interface ClaimCheck {
  code: ClaimCheckCode;
  ok: boolean;
  /** `blocking` : rejet automatique ; `warning` : renvoi vers un agent. */
  severity: 'blocking' | 'warning' | 'info';
  detail: string;
}

/** orderClaims/{id} : réclamation d'un client (article manquant, abîmé…), photo obligatoire. */
export interface OrderClaim {
  orderId: string;
  orderNumber: string;
  customerId: string;
  customerName: string;
  restaurantId: string;
  driverId?: string | null;
  countryId: string;
  cityId: string;
  type: ClaimType;
  lineIds: string[];
  description: string;
  photos: ClaimPhoto[];
  checks: ClaimCheck[];
  /** `clean` : aucun signal ; `suspect` : au moins un avertissement ; `rejected` : contrôle bloquant. */
  verdict: 'clean' | 'suspect' | 'rejected';
  status: ClaimStatus;
  /** Montant réclamé (somme des lignes concernées) et accordé. */
  claimedCents: Cents;
  grantedCents: Cents;
  refundId?: string | null;
  ticketId?: string | null;
  decidedBy?: string | null;
  decidedAt?: Timestamp | null;
  decisionNote?: string | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  test?: boolean;
}

export const CLAIM_TYPE_LABELS: Record<ClaimType, string> = {
  missing_item: 'Article manquant',
  damaged_item: 'Article abîmé',
  wrong_item: 'Mauvais article',
  quality: 'Qualité du produit',
  not_received: 'Commande non reçue',
  other: 'Autre problème',
};

export const CLAIM_STATUS_LABELS: Record<ClaimStatus, string> = {
  pending_review: 'À examiner',
  accepted: 'Acceptée',
  rejected: 'Refusée',
};

export const CLAIM_CHECK_LABELS: Record<ClaimCheckCode, string> = {
  window: 'Délai de réclamation',
  photo_present: 'Photo jointe',
  photo_readable: 'Photo lisible',
  photo_size: 'Taille de la photo',
  photo_duplicate_own: 'Doublon dans la réclamation',
  photo_duplicate_other: 'Photo déjà utilisée',
  photo_date: 'Date de la photo',
  lines_valid: 'Articles de la commande',
  already_claimed: 'Articles déjà réclamés',
  repeat_claims: 'Réclamations répétées',
};
