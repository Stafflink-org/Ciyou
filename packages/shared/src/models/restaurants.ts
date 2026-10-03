// Restaurants, groupes (chaînes), conditions commerciales, réglages de
// l'établissement, documents partenaires, CRM client et livreurs du restaurant.
import type {
  DocumentStatus,
  FulfillmentMode,
  OnboardingStatus,
  PartnerDocumentType,
  MerchantType,
  PaymentMethod,
  RestaurantCourierStatus,
  RestaurantStatus,
  SubscriptionStatus,
  VehicleType,
} from '../constants/enums';
import type { PlanCode } from '../pricing/plans';
import type { BillingMode } from '../pricing/types';
import type { Bps, Cents } from '../pricing/money';
import type { CurrencyCode } from '../pricing/currency';
import type {
  ImageRef,
  LatLng,
  Localized,
  PostalAddress,
  SoftDeletable,
  StoredFile,
  Timestamp,
  Tracked,
  WeeklyHours,
} from './common';

/** restaurantGroups/{groupId} : propriétaire de plusieurs établissements. */
export interface RestaurantGroup extends Tracked, SoftDeletable {
  name: string;
  ownerId: string;
  countryId: string;
  legalName?: string | null;
  siren?: string | null;
  vatNumber?: string | null;
  restaurantIds: string[];
  /** Dénormalisé depuis les établissements membres (saveRestaurantGroup) : périmètre ville des règles Firestore. */
  cityIds: string[];
  /** Conditions communes appliquées à tous les établissements du groupe. */
  commercial?: { commissionBps?: Bps | null; planCode?: PlanCode | null; subscriptionId?: string | null } | null;
  /** Facturation consolidée au niveau du groupe. */
  consolidatedBilling: boolean;
}

/** restaurants/{rid} : fiche publique de l'établissement (lisible par tous quand il est actif). */
export interface Restaurant extends Tracked, SoftDeletable, Localized {
  name: string;
  slug: string;
  groupId?: string | null;
  ownerId: string;
  cityId: string;
  zoneIds: string[];
  address: PostalAddress;
  phone?: string | null;
  email?: string | null;
  description?: string | null;
  cuisineIds: string[];
  tags: string[];
  priceLevel: 1 | 2 | 3 | 4;
  logo?: ImageRef | null;
  cover?: ImageRef | null;
  photos: ImageRef[];
  /** Couleur de marque et monogramme (repli quand il n'y a pas de logo). */
  accent: string;
  mark: string;
  /** Statut public (piloté par le super admin et les Cloud Functions). */
  status: RestaurantStatus;
  onboardingStatus: OnboardingStatus;
  /** Ouverture manuelle (bouton « ouvrir / fermer » du restaurant). */
  isOpen: boolean;
  /** Calculé : ouvert, dans ses horaires, zone non coupée, abonnement en règle. */
  acceptingOrders: boolean;
  /** Interrupteur du commerce (distinct de `isOpen`) : masqué du catalogue et des commandes tant que
   * désactivé, sans changer le statut ni les horaires. Par défaut visible. */
  visibleInApp: boolean;
  /** Mode rush : minutes ajoutées au temps de préparation. */
  busyExtraMinutes: number;
  fulfillmentModes: FulfillmentMode[];
  /** Qui livre : flotte Ciyou Eats, livreurs propres ou les deux. */
  deliveredBy: 'platform' | 'restaurant' | 'both';
  minOrderCents: Cents;
  /** Frais de livraison fixes (livreurs du restaurant). */
  ownDeliveryFeeCents?: Cents | null;
  ownDeliveryRadiusMeters?: number | null;
  prepMinutes: number;
  etaMinutes: { min: number; max: number };
  rating: { average: number; count: number };
  hoursSummary: WeeklyHours;
  planCode: PlanCode;
  sponsored: boolean;
  /** Score de classement dans l'app client, recalculé chaque nuit. */
  rankingScore: number;
  /** Mention légale affichée avec le commerce quand sa mise en avant est payante (texte réglé par le super admin). */
  sponsoredLabel?: string | null;
  rankingComputedAt?: Timestamp | null;
  /** Score qualité 0-100 (annulations, refus, retards, avis). */
  qualityScore: number;
  allergensComplete: boolean;
  /** Nombre de produits actifs (hors corbeille), tenu à jour par `onProductWritten` : base de la limite `maxProducts` de la formule. */
  productsCount?: number;
  /** Toujours false : vente d'alcool interdite (décision client). Champ conservé pour la compatibilité. */
  sellsAlcohol: boolean;
  acceptedPaymentMethods: PaymentMethod[];
  ordersCount: number;
  searchKeywords: string[];
  /** Horodatage de mise en ligne (badge « Nouveau »). */
  launchedAt?: Timestamp | null;
  suspension?: {
    reason: string;
    until?: Timestamp | null;
    at: Timestamp;
    by: string;
    /** Temporaire (réactivation automatique à `until`), définitive, ou blocage documentaire. */
    kind?: 'temporary' | 'permanent' | 'documents' | null;
    /** Statut à rétablir à la réactivation. */
    previousStatus?: RestaurantStatus | null;
  } | null;
  /** Mention allergènes affichée sur la fiche (traces, cuisine partagée…). */
  allergenNotice?: string | null;
  /** Mentions de l'établissement (fait maison, halal, bio…), voir RESTAURANT_LABELS. */
  labels?: string[];
  /** Pause temporaire : réouverture automatique à cette heure (isOpen repasse à true). */
  pausedUntil?: Timestamp | null;
  pauseReason?: string | null;
  /** Type de commerce (absent = restaurant). */
  merchantType?: MerchantType;
  /** Commandes manquées d'affilée (délai d'acceptation dépassé), remis à 0 à la première acceptée. */
  missedOrdersInARow?: number;
  /** Horodatage de la dernière pause automatique (égal à updatedAt tant que personne n'a rouvert). */
  autoPausedAt?: Timestamp | null;
  /** Dernière commande reçue et alerte d'inactivité envoyée (décision client : 15 j puis retrait 30 j après). */
  lastOrderAt?: Timestamp | null;
  inactivityAlertAt?: Timestamp | null;
  /** Agrégats glissants sur 30 jours et détail du score de qualité (Cloud Function nocturne du super admin). */
  metrics30d?: import('./admin-actors').RestaurantMetrics30d | null;
  qualityBreakdown?: import('./admin-actors').RestaurantQualityBreakdown | null;
  /** Suspension automatique pour document obligatoire expiré (levée à la validation d'une nouvelle pièce). */
  documentsBlockedAt?: Timestamp | null;
  documentsBlockedTypes?: PartnerDocumentType[];
  /** Dossier d'inscription : pièces demandées et motif du refus (envoyés au restaurant). */
  missingDocuments?: PartnerDocumentType[];
  rejectionReason?: string | null;
  /** Relance automatique d'un dossier resté bloqué sans qu'aucune pièce obligatoire n'ait jamais été déposée (compteur de seuils franchis, plafonné). */
  onboardingRemindersSent?: number;
  onboardingLastReminderAt?: Timestamp | null;
  /** Dernier examen automatique du dossier et jour de la validation automatique (plafond quotidien). */
  autoValidation?: import('./automations').MerchantAutoValidation | null;
  autoValidatedDay?: string | null;
  /** Retrait pour inactivité : date prévue tant qu'aucune commande n'arrive, puis retrait effectif. */
  inactivityRemovalDueAt?: Timestamp | null;
  removedForInactivityAt?: Timestamp | null;
  /**
   * Devise du compte de ce commerce (ISO 4217 : EUR, DZD, MAD, TND). Fixée à l'inscription
   * d'après le pays, modifiable ensuite par le super admin (validation du dossier ou fiche
   * restaurant, avec motif et audit). Absente sur les documents antérieurs à cette rubrique :
   * utiliser `resolveRestaurantCurrency` (repli sur la devise du pays, puis EUR) plutôt que de
   * lire ce champ directement. N'affecte que le formatage des montants déjà affichés pour ce
   * commerce ; la devise réelle des paiements/commandes reste celle du pays (voir CONTRAT_MODULES.md).
   */
  currency?: CurrencyCode;
  /**
   * Le propriétaire a-t-il déjà défini lui-même un mot de passe (inscription en ligne avec mot
   * de passe saisi, ou lien de définition déjà envoyé) ? `false`/absent : la validation du
   * dossier (`reviewRestaurantApplication`) envoie un lien de définition de mot de passe au lieu
   * du simple e-mail « Dossier validé ». Jamais modifiable par le client.
   */
  ownerCredentialsDelivered?: boolean;
}

/** restaurants/{rid}/private/commercial : conditions commerciales (écriture super admin). */
export interface RestaurantCommercial {
  planCode: PlanCode;
  /** Surcharge du mode de facturation de la formule (commission, abonnement ou les deux). */
  billingMode?: BillingMode | null;
  /** Crédit publicitaire disponible (parrainage commerce, mise en avant payante). */
  adCreditCents?: Cents | null;
  subscriptionId?: string | null;
  subscriptionStatus: SubscriptionStatus;
  /** Commissions négociées ; null = taux de la formule, de la ville ou du pays. */
  negotiatedCommission?: {
    platformDeliveryBps?: Bps | null;
    restaurantDeliveryBps?: Bps | null;
    pickupBps?: Bps | null;
    reason: string;
    validUntil?: Timestamp | null;
  } | null;
  /** Offre spéciale temporaire (réduction ou gratuité). */
  specialOffer?: {
    commissionReductionBps: Bps;
    subscriptionFreeUntil?: Timestamp | null;
    reason: string;
    endsAt: Timestamp;
  } | null;
  allowedPaymentMethods: PaymentMethod[];
  deliveryFeeOverrideCents?: Cents | null;
  minOrderOverrideCents?: Cents | null;
  payoutFrequency?: 'weekly' | 'biweekly' | 'monthly' | null;
  payoutsBlocked: boolean;
  payoutsBlockedReason?: string | null;
  stripeAccountId?: string | null;
  stripeAccountStatus?: 'pending' | 'restricted' | 'enabled' | null;
  /** Compte de paiement local (pays sans Stripe) : virement manuel de l'équipe finance. */
  payoutAccount?: import('./finance').PayoutAccount | null;
  /** Commerce qui a parrainé ce commerce (parrainage commerce → commerce). */
  referredByRestaurantId?: string | null;
  updatedAt: Timestamp;
  updatedBy: string;
}

/** restaurants/{rid}/private/legal : identité légale et bancaire (masquée). */
export interface RestaurantLegal {
  legalName: string;
  legalForm?: string | null;
  siret: string;
  vatNumber?: string | null;
  registeredAddress: PostalAddress;
  managerName: string;
  managerEmail: string;
  managerPhone: string;
  managerBirthDate?: string | null;
  /** IBAN masqué (FR76 **** **** 1234) ; l'IBAN complet reste chez Stripe. */
  ibanMasked?: string | null;
  alcoholLicenseNumber?: string | null;
  /** Données DAC7 : identifiant fiscal et état de complétude. */
  taxIdentificationNumber?: string | null;
  dac7Complete: boolean;
  partnerTermsVersion?: string | null;
  partnerTermsAcceptedAt?: Timestamp | null;
  /** Contrat partenaire : document accepté, signataire et nom saisi (signature simple). */
  partnerTermsDocumentId?: string | null;
  partnerTermsAcceptedBy?: string | null;
  partnerTermsSignatureName?: string | null;
  /** Ville d'immatriculation (RCS) et capital social, pour les mentions légales. */
  rcsCity?: string | null;
  shareCapitalCents?: Cents | null;
  updatedAt: Timestamp;
}

/** restaurants/{rid}/settings/orders : réglages de prise de commande. */
export interface RestaurantOrderSettings {
  prepMinutes: number;
  maxConcurrentOrders: number;
  minOrderCents: Cents;
  delivery: boolean;
  pickup: boolean;
  dineIn: boolean;
  autoAccept: boolean;
  scheduledOrders: boolean;
  /** Impression automatique du ticket en cuisine. */
  autoPrint: boolean;
  pickupInstructions?: string | null;
  /** Commandes programmées : délai minimal avant le créneau et horizon maximal. */
  scheduledLeadMinutes?: number | null;
  scheduledMaxDays?: number | null;
  /** Sur place : consignes affichées au client (numéro de table, comptoir…). */
  dineInInstructions?: string | null;
  updatedAt: Timestamp;
  updatedBy: string;
}

/** restaurants/{rid}/settings/hours. */
export interface RestaurantHours extends WeeklyHours {
  updatedAt: Timestamp;
  updatedBy: string;
}

/** restaurants/{rid}/settings/payments : moyens acceptés (dans la limite autorisée par Ciyou Eats). */
export interface RestaurantPaymentSettings {
  online: boolean;
  onDelivery: boolean;
  onPickup: boolean;
  methods: Partial<Record<PaymentMethod, boolean>>;
  updatedAt: Timestamp;
  updatedBy: string;
}

/** restaurants/{rid}/settings/loyalty : programme propre au restaurant. */
export interface RestaurantLoyaltySettings {
  enabled: boolean;
  earnPoints: number;
  everyCents: Cents;
  welcomePoints: number;
  thresholdPoints: number;
  rewardCents: Cents;
  /** Paliers de récompense (le premier reprend thresholdPoints / rewardCents). */
  rewards?: Array<{ points: number; rewardCents: Cents; label?: string | null }> | null;
  /** Validité des points en jours (null = sans expiration). */
  pointsValidityDays?: number | null;
  updatedAt: Timestamp;
  updatedBy: string;
}

/** restaurants/{rid}/settings/notifications. */
export interface RestaurantNotificationSettings {
  newOrderSound: boolean;
  emailDailySummary: boolean;
  emailRecipients: string[];
  smsOnNewOrder: boolean;
  smsNumbers: string[];
  /** Son de nouvelle commande, volume (0-100) et répétition tant qu'elle n'est pas acceptée. */
  sound?: RestaurantNotificationSound;
  volume?: number;
  repeatUntilAccepted?: boolean;
  /** Alertes dans le back-office (et e-mail si `email` est activé pour l'événement). */
  alerts?: Partial<Record<RestaurantAlertKey, { inApp: boolean; email: boolean }>>;
  emailWeeklyReport?: boolean;
  emailInvoices?: boolean;
}

export type RestaurantNotificationSound = 'chime' | 'bell' | 'marimba' | 'pulse';
export type RestaurantAlertKey =
  | 'order_cancelled'
  | 'order_late'
  | 'low_stock'
  | 'new_review'
  | 'new_message'
  | 'document_expiry'
  | 'payout_paid';

/** restaurants/{rid}/deliveryZones/{id} : zones propres (livreurs du restaurant). */
export interface RestaurantDeliveryZone extends Tracked {
  name: string;
  type: 'radius' | 'polygon';
  radiusMeters?: number | null;
  polygon?: LatLng[] | null;
  feeCents: Cents;
  minOrderCents?: Cents | null;
  enabled: boolean;
  order: number;
  color: string;
  /** Délai de livraison annoncé pour cette zone (minutes, en plus de la préparation). */
  deliveryMinutes?: number | null;
  /** Livraison offerte à partir de ce sous-total (null = jamais). */
  freeAboveCents?: Cents | null;
}

/** partnerDocuments/{id} : pièces justificatives des restaurants et livreurs. */
export interface PartnerDocument extends Tracked {
  ownerType: 'restaurant' | 'driver';
  ownerId: string;
  countryId: string;
  cityId?: string | null;
  type: PartnerDocumentType;
  file: StoredFile;
  status: DocumentStatus;
  number?: string | null;
  issuedAt?: string | null;
  /** AAAA-MM-JJ ; un document expiré bloque le compte. */
  expiresAt?: string | null;
  reviewedBy?: string | null;
  reviewedAt?: Timestamp | null;
  rejectionReason?: string | null;
  remindersSent: number;
  lastReminderAt?: Timestamp | null;
}

/** restaurants/{rid}/customers/{uid} : fiche CRM du client vue par le restaurant. */
export interface RestaurantCustomer {
  userId: string;
  displayName: string;
  /** Coordonnées masquées : le restaurant ne voit jamais l'e-mail ni le téléphone complets. */
  phoneMasked?: string | null;
  blocked: boolean;
  blockedReason?: string | null;
  internalNote?: string | null;
  tags: string[];
  ordersCount: number;
  totalSpentCents: Cents;
  averageBasketCents: Cents;
  firstOrderAt?: Timestamp | null;
  lastOrderAt?: Timestamp | null;
  /** Blocage (Cloud Function `setCustomerBlocked`, motif conservé dans l'audit). */
  blockedAt?: Timestamp | null;
  blockedBy?: string | null;
  /** Nombre de notes internes (sous-collection `notes`, tenu par Cloud Function). */
  notesCount?: number;
  updatedAt: Timestamp;
}

/** restaurants/{rid}/customers/{uid}/notes/{noteId} : note interne de l'équipe (Cloud Function). */
export interface CustomerNote {
  body: string;
  authorId: string;
  authorName: string;
  createdAt: Timestamp;
}

/** restaurants/{rid}/couriers/{driverId} : statut d'un livreur pour ce restaurant. */
export interface RestaurantCourier {
  driverId: string;
  displayName: string;
  /** Livreur propre du restaurant ou livreur Ciyou Eats ayant déjà livré. */
  relation: 'own' | 'platform';
  status: RestaurantCourierStatus;
  note?: string | null;
  deliveriesCount: number;
  lastDeliveryAt?: Timestamp | null;
  /** Livreur propre : coordonnées masquées, véhicule et zones de livraison du restaurant. */
  emailMasked?: string | null;
  phoneMasked?: string | null;
  vehicle?: VehicleType | null;
  zoneIds?: string[];
  /** Livreur propre invité (Cloud Function `inviteOwnCourier`), en attente de première connexion. */
  invitation?: { status: 'pending' | 'accepted'; sentAt: Timestamp; sentBy: string; emailSent: boolean } | null;
  /** Motif du dernier blocage. */
  blockedReason?: string | null;
  /** Livreur salarié : espèces détenues (reflet de driverPrivate.cashBalanceCents, tenu par Cloud Function) et plafond. */
  cashHeldCents?: Cents;
  cashLimitCents?: Cents;
  /** Tickets Restaurant et montants carte encaissés en personne, non remis (reflet de
   * driverPrivate, voir Backoffice resto #6). */
  mealVoucherHeldCents?: Cents;
  cardTerminalHeldCents?: Cents;
  updatedAt: Timestamp;
  updatedBy: string;
}

/** restaurants/{rid}/dailyStats/{AAAAMMJJ} : agrégats du jour (écrits par Cloud Function). */
export interface RestaurantDailyStats {
  day: string;
  ordersCount: number;
  deliveredCount: number;
  cancelledCount: number;
  rejectedCount: number;
  lateCount: number;
  salesCents: Cents;
  netPayoutCents: Cents;
  commissionCents: Cents;
  /** TVA réelle sur la commission (somme de `order.restaurantSettlement.commissionVatCents` des commandes livrées), au(x) taux réellement appliqué(s) à chaque commande — pas un taux par défaut recalculé après coup. */
  commissionVatCents: Cents;
  discountFundedCents: Cents;
  averageBasketCents: Cents;
  averagePrepMinutes: number;
  byMode: Partial<Record<FulfillmentMode, number>>;
  byPayment: Partial<Record<PaymentMethod, Cents>>;
  byHour: number[];
  newCustomers: number;
  updatedAt: Timestamp;
}

/** restaurants/{rid}/announcementReads/{announcementId}. */
export interface AnnouncementRead {
  readBy: string;
  readAt: Timestamp;
}

/** menuIssues/{id} : anomalies de menu détectées automatiquement. */
export interface MenuIssue {
  restaurantId: string;
  cityId: string;
  productId?: string | null;
  type: 'missing_photo' | 'price_outlier' | 'allergens_missing' | 'missing_description' | 'empty_section' | 'alcohol_suspected';
  details?: string | null;
  status: 'open' | 'fixed' | 'ignored';
  detectedAt: Timestamp;
  resolvedAt?: Timestamp | null;
  resolvedBy?: string | null;
}

/** posConnections/{id} : connexion d'un restaurant à un logiciel de caisse. */
export interface PosConnection extends Tracked {
  restaurantId: string;
  provider: string;
  status: 'pending' | 'connected' | 'error' | 'disconnected';
  externalLocationId?: string | null;
  syncMenu: boolean;
  pushOrders: boolean;
  lastSyncAt?: Timestamp | null;
  lastError?: string | null;
  errorCount24h: number;
}
