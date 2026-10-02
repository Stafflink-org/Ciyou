// Comptes utilisateurs (tous rôles), adresses, favoris, notifications, appareils,
// moyens de paiement masqués, consentements, porte-monnaie, fidélité, parrainage.
import type {
  AccountStatus,
  ConsentKey,
  Locale,
  ReferralStatus,
  UserRole,
} from '../constants/enums';
import type { Cents } from '../pricing/money';
import type { GeoPoint, ImageRef, Localized, PostalAddress, SoftDeletable, Timestamp, Tracked } from './common';

/** users/{uid} : profil commun à tous les rôles. Le rôle fait foi dans les custom claims. */
export interface UserProfile extends Tracked, SoftDeletable, Partial<Localized> {
  role: UserRole;
  firstName: string;
  lastName: string;
  displayName: string;
  email: string;
  emailVerified: boolean;
  phone?: string | null;
  phoneVerified: boolean;
  avatar?: ImageRef | null;
  locale: Locale;
  status: AccountStatus;
  blockedReason?: string | null;
  blockedAt?: Timestamp | null;
  blockedBy?: string | null;
  defaultAddressId?: string | null;
  /** Consentements courants (le journal est dans users/{uid}/consents). */
  consents: Partial<Record<ConsentKey, boolean>>;
  notificationPrefs: {
    orderUpdates: boolean;
    promotions: boolean;
    newsletter: boolean;
  };
  /** Solde d'avoirs disponible (écrit par Cloud Function uniquement). */
  walletBalanceCents: Cents;
  /** Code de parrainage personnel. */
  referralCode: string;
  referredBy?: string | null;
  /** Agrégats client (écrits par Cloud Function). */
  stats: {
    ordersCount: number;
    totalSpentCents: Cents;
    lastOrderAt?: Timestamp | null;
    firstOrderAt?: Timestamp | null;
    cancelledCount: number;
    refundsCount: number;
  };
  /** Dernière version acceptée par type de document légal. */
  acceptedLegal: Record<string, string>;
  lastLoginAt?: Timestamp | null;
  lastSeenAt?: Timestamp | null;
  /** Recherche : minuscules sans accents (nom, e-mail, téléphone). */
  searchKeywords: string[];
}

/** userPrivate/{uid} : données internes, jamais lisibles par l'utilisateur. */
export interface UserPrivate {
  stripeCustomerId?: string | null;
  riskScore: number;
  riskFlags: string[];
  /** Empreintes (hachées) des appareils et cartes utilisés, pour la détection de comptes liés. */
  deviceHashes: string[];
  cardFingerprints: string[];
  phoneHash?: string | null;
  fraudCaseIds: string[];
  updatedAt: Timestamp;
}

/** users/{uid}/addresses/{id}. */
export interface UserAddress extends Tracked, PostalAddress {
  label: string;
  details?: string | null;
  instructions?: string | null;
  floor?: string | null;
  doorCode?: string | null;
  geo: GeoPoint;
  isDefault: boolean;
}

/** users/{uid}/favorites/{id} (id = `r_{restaurantId}` ou `p_{restaurantId}_{productId}`). */
export interface Favorite {
  type: 'restaurant' | 'product';
  restaurantId: string;
  productId?: string | null;
  createdAt: Timestamp;
}

/** users/{uid}/notifications/{id} : boîte de réception dans l'app. */
export interface UserNotification {
  title: string;
  body: string;
  category: 'order' | 'promotion' | 'account' | 'announcement' | 'support' | 'payout' | 'document';
  link?: { type: 'order' | 'ticket' | 'promotion' | 'page' | 'url' | 'document'; target: string } | null;
  read: boolean;
  readAt?: Timestamp | null;
  createdAt: Timestamp;
}

/** users/{uid}/devices/{deviceId} : jetons de notification et empreinte d'appareil. */
export interface UserDevice {
  platform: 'ios' | 'android' | 'web';
  app: 'client' | 'driver' | 'restaurant' | 'admin';
  appVersion: string;
  fcmToken?: string | null;
  model?: string | null;
  osVersion?: string | null;
  lastSeenAt: Timestamp;
  createdAt: Timestamp;
}

/** users/{uid}/paymentMethods/{id} : carte enregistrée, toujours masquée (écrite par Cloud Function). */
export interface SavedPaymentMethod {
  provider: 'stripe';
  providerMethodId: string;
  brand: string;
  last4: string;
  expMonth: number;
  expYear: number;
  wallet?: 'apple_pay' | 'google_pay' | null;
  isDefault: boolean;
  createdAt: Timestamp;
}

/** users/{uid}/consents/{id} : journal des consentements (non modifiable). */
export interface ConsentLog {
  key: ConsentKey;
  granted: boolean;
  source: 'signup' | 'settings' | 'cookie_banner' | 'admin' | 'campaign_unsubscribe';
  policyVersion?: string | null;
  ipHash?: string | null;
  userAgent?: string | null;
  at: Timestamp;
}

/** walletTransactions/{id} : avoirs clients (crédits et débits). */
export interface WalletTransaction {
  userId: string;
  type: 'credit' | 'debit' | 'expiry' | 'reversal';
  amountCents: Cents;
  balanceAfterCents: Cents;
  reason:
    | 'refund'
    | 'late_delivery'
    | 'commercial_gesture'
    | 'referral'
    | 'loyalty_reward'
    | 'order_payment'
    | 'expiry'
    | 'adjustment';
  orderId?: string | null;
  ticketId?: string | null;
  refundId?: string | null;
  expiresAt?: Timestamp | null;
  note?: string | null;
  createdAt: Timestamp;
  createdBy: string;
}

/** loyaltyAccounts/{id} (id = `{uid}` pour la plateforme, `{uid}_{restaurantId}` pour un restaurant). */
export interface LoyaltyAccount {
  userId: string;
  scope: 'platform' | 'restaurant';
  restaurantId?: string | null;
  points: number;
  lifetimePoints: number;
  tier?: string | null;
  updatedAt: Timestamp;
}

/** loyaltyTransactions/{id}. */
export interface LoyaltyTransaction {
  accountId: string;
  userId: string;
  restaurantId?: string | null;
  type: 'earn' | 'redeem' | 'welcome' | 'expire' | 'adjust';
  points: number;
  orderId?: string | null;
  valueCents?: Cents | null;
  /** Points encore utilisables d'un lot de gain (consommés du plus ancien au plus récent). */
  remaining?: number | null;
  /** Fin de validité du lot de points. */
  expiresAt?: Timestamp | null;
  createdAt: Timestamp;
  createdBy: string;
}

/** referrals/{id}. */
export interface Referral {
  program: 'client' | 'restaurant' | 'driver';
  referrerId: string;
  referrerType: 'client' | 'restaurant' | 'driver';
  refereeId: string;
  refereeType: 'client' | 'restaurant' | 'driver';
  /** Noms affichés (parrainages entre commerces). */
  referrerName?: string | null;
  refereeName?: string | null;
  code: string;
  status: ReferralStatus;
  qualifyingOrderId?: string | null;
  referrerRewardCents: Cents;
  refereeRewardCents: Cents;
  /** Ville/pays du filleul (pour le cloisonnement par périmètre de `decideReferral`). */
  cityId?: string | null;
  countryId?: string | null;
  createdAt: Timestamp;
  qualifiedAt?: Timestamp | null;
  rewardedAt?: Timestamp | null;
  rejectedAt?: Timestamp | null;
  /** Motif du refus (auto-parrainage détecté, refus manuel). */
  rejectedReason?: string | null;
  /** Parrainage refusé automatiquement : signaux relevés (même gérant, même SIRET, même téléphone). */
  fraudSignals?: string[] | null;
}
