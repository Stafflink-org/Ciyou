// Livreurs : profil, données privées (KYC, fiscalité, espèces), position en direct,
// sessions en ligne, sanctions, vérification d'identité, propositions de course, gains.
import type {
  DispatchOfferStatus,
  DriverAvailability,
  DriverStatus,
  DriverType,
  OnboardingStatus,
  SanctionStatus,
  SanctionType,
  VehicleType,
} from '../constants/enums';
import type { PartnerDocumentType } from '../constants/enums';
import type { Cents } from '../pricing/money';
import type { CourierPay } from '../pricing/types';
import type { DriverBlock } from './operations';
import type { GeoPoint, ImageRef, Localized, PostalAddress, SoftDeletable, StoredFile, Timestamp, Tracked } from './common';

/** drivers/{uid} : profil opérationnel du livreur. */
export interface Driver extends Tracked, SoftDeletable, Localized {
  cityId: string;
  firstName: string;
  lastName: string;
  displayName: string;
  phone: string;
  email: string;
  avatar?: ImageRef | null;
  type: DriverType;
  /** Restaurants employeurs pour les livreurs propres. */
  restaurantIds: string[];
  /** Livreur salarié du commerce : fiche employé du module RH. */
  employeeId?: string | null;
  /** Distance maximale de course choisie par le livreur (mètres). */
  maxDistanceMeters?: number | null;
  vehicle: {
    type: VehicleType;
    plate?: string | null;
    model?: string | null;
    color?: string | null;
  };
  zoneIds: string[];
  status: DriverStatus;
  onboardingStatus: OnboardingStatus;
  rejectionReason?: string | null;
  availability: DriverAvailability;
  activeOrderIds: string[];
  /** Accepte les courses payées en espèces. */
  acceptsCash: boolean;
  rating: { average: number; count: number };
  stats: {
    deliveries: number;
    acceptanceRate: number;
    cancellationRate: number;
    onTimeRate: number;
    averageDeliveryMinutes: number;
  };
  documentsValidUntil?: string | null;
  lastIdentityCheckAt?: Timestamp | null;
  lastSeenAt?: Timestamp | null;
  searchKeywords: string[];
  /** Blocage automatique en cours (documents expirés, contrôle d'identité, sanction). */
  blocked?: DriverBlock | null;
  /** Sanction active ayant suspendu le compte (levée automatique à son terme). */
  activeSanctionId?: string | null;
  /** Dernière décision de validation (super admin). */
  reviewedBy?: string | null;
  reviewedAt?: Timestamp | null;
  missingDocuments?: PartnerDocumentType[] | null;
}

/** driverPrivate/{uid} : identité légale, statut d'indépendant, fiscalité, espèces. */
export interface DriverPrivate {
  birthDate: string;
  nationality: string;
  address: PostalAddress;
  siret?: string | null;
  vatNumber?: string | null;
  vatExempt: boolean;
  urssafValidUntil?: string | null;
  workPermitValidUntil?: string | null;
  ibanMasked?: string | null;
  stripeAccountId?: string | null;
  stripeAccountStatus?: 'pending' | 'restricted' | 'enabled' | null;
  /** Compte de paiement local (pays sans Stripe) : virement manuel de l'équipe finance. */
  payoutAccount?: import('./finance').PayoutAccount | null;
  /** Espèces encaissées non encore reversées à la plateforme. */
  cashBalanceCents: Cents;
  cashLimitCents: Cents;
  /** Date depuis laquelle la caisse accumule des espèces (remise à `null` à chaque remise complète) — sert à calculer l'ancienneté et l'alerte d'écart (H2). */
  cashSinceAt?: Timestamp | null;
  /** Date de la dernière remise de caisse (H2). */
  lastCashRemittanceAt?: Timestamp | null;
  payoutsBlocked: boolean;
  payoutsBlockedReason?: string | null;
  taxIdentificationNumber?: string | null;
  dac7Complete: boolean;
  partnerTermsVersion?: string | null;
  partnerTermsAcceptedAt?: Timestamp | null;
  internalRating?: number | null;
  updatedAt: Timestamp;
}

/**
 * driverLocations/{uid} : position en direct, écrite par l'app livreur toutes les
 * quelques secondes en course. Lisible par le client et le restaurant de la commande
 * en cours uniquement (liste `visibleTo` tenue par Cloud Function).
 */
export interface DriverLocation {
  position: GeoPoint;
  geohash: string;
  heading?: number | null;
  speedKmh?: number | null;
  accuracyMeters?: number | null;
  availability: DriverAvailability;
  cityId: string;
  zoneId?: string | null;
  activeOrderIds: string[];
  visibleTo: string[];
  updatedAt: Timestamp;
}

/** driverSessions/{id} : période en ligne (base de la garantie horaire). */
export interface DriverSession {
  driverId: string;
  cityId: string;
  zoneId?: string | null;
  startedAt: Timestamp;
  endedAt?: Timestamp | null;
  onlineMinutes: number;
  /** Minutes d'activité au sens de la garantie (en course ou en attente de course acceptée). */
  activeMinutes: number;
  deliveries: number;
  earningsCents: Cents;
}

/** driverSanctions/{id}. */
export interface DriverSanction extends Tracked {
  driverId: string;
  /** Dénormalisés depuis le livreur à la création (sanctionDriver) : périmètre ville des règles Firestore. */
  cityId?: string | null;
  countryId?: string | null;
  type: SanctionType;
  reason: string;
  details?: string | null;
  status: SanctionStatus;
  startsAt: Timestamp;
  endsAt?: Timestamp | null;
  contest?: {
    message: string;
    submittedAt: Timestamp;
    decision?: 'upheld' | 'overturned' | null;
    decidedBy?: string | null;
    decidedAt?: Timestamp | null;
    decisionNote?: string | null;
  } | null;
}

/** identityChecks/{id} : contrôle ponctuel par selfie. */
export interface IdentityCheck {
  driverId: string;
  requestedAt: Timestamp;
  trigger: 'random' | 'login' | 'fraud_signal' | 'manual';
  selfie?: StoredFile | null;
  status: 'requested' | 'submitted' | 'passed' | 'failed' | 'expired';
  matchScore?: number | null;
  reviewedBy?: string | null;
  reviewedAt?: Timestamp | null;
  /** Ville du livreur (filtre du super admin). */
  cityId?: string | null;
  /** Photo de référence (pièce d'identité validée) comparée au selfie. */
  referencePhoto?: StoredFile | null;
  submittedAt?: Timestamp | null;
  reviewNote?: string | null;
}

/** dispatchOffers/{id} : proposition d'une course à un livreur. */
export interface DispatchOffer {
  orderId: string;
  driverId: string;
  restaurantId: string;
  cityId: string;
  zoneId?: string | null;
  round: number;
  status: DispatchOfferStatus;
  distanceToRestaurantMeters: number;
  deliveryDistanceMeters: number;
  estimatedPayCents: Cents;
  estimatedMinutes: number;
  offeredAt: Timestamp;
  expiresAt: Timestamp;
  respondedAt?: Timestamp | null;
  declineReason?: string | null;
}

/** driverEarnings/{id} : gain d'une course (ou prime, complément de garantie). */
export interface DriverEarning {
  driverId: string;
  cityId: string;
  kind: 'delivery' | 'bonus' | 'hourly_guarantee' | 'referral' | 'adjustment';
  orderId?: string | null;
  breakdown?: CourierPay | null;
  amountCents: Cents;
  tipCents: Cents;
  distanceMeters?: number | null;
  durationMinutes?: number | null;
  payoutId?: string | null;
  earnedAt: Timestamp;
  note?: string | null;
}
