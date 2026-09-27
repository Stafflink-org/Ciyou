// Super admin, rubriques « Restaurants » (cahier §5) et « Clients » (cahier §7) :
// indicateurs calculés, score de qualité, entrées et sorties des Cloud Functions
// d'administration des acteurs (validation, suspension, conditions, masse, import,
// « voir comme », avoirs, blocage, suppression RGPD).
import type { FeatureKey, MerchantType, OnboardingStatus, PartnerDocumentType, PaymentMethod } from '../constants/enums';
import type { BillingMode } from '../pricing/types';
import type { PlanCode } from '../pricing/plans';
import type { Bps, Cents } from '../pricing/money';
import type { Timestamp } from './common';

// ------------------------------------------------------------------ Indicateurs

/** restaurants/{rid}.metrics30d : agrégats glissants sur 30 jours (Cloud Function nocturne). */
export interface RestaurantMetrics30d {
  /** Premier jour inclus (AAAA-MM-JJ). */
  from: string;
  ordersCount: number;
  deliveredCount: number;
  cancelledCount: number;
  rejectedCount: number;
  lateCount: number;
  salesCents: Cents;
  commissionCents: Cents;
  /** Taux en points de base (1 000 = 10 %) rapportés aux commandes reçues. */
  cancelRateBps: Bps;
  rejectRateBps: Bps;
  lateRateBps: Bps;
  openMenuIssues: number;
  computedAt: Timestamp;
}

/** Détail du score de qualité : points retirés par critère (0 = parfait). */
export interface RestaurantQualityBreakdown {
  cancellations: number;
  rejections: number;
  lateness: number;
  rating: number;
  menu: number;
}

export interface QualityScoreInput {
  ordersCount: number;
  cancelRateBps: number;
  rejectRateBps: number;
  lateRateBps: number;
  ratingAverage: number;
  ratingCount: number;
  openMenuIssues: number;
}

/** Plafonds de pénalité par critère (somme = 100). */
export const QUALITY_PENALTY_CAPS: Readonly<RestaurantQualityBreakdown> = {
  cancellations: 30,
  rejections: 20,
  lateness: 20,
  rating: 20,
  menu: 10,
};

/** Seuils d'interprétation du score (accompagner, surveiller). */
export const QUALITY_THRESHOLDS = { watch: 80, coach: 65 } as const;

/**
 * Score de qualité 0-100 d'un établissement : annulations, refus, retards, avis
 * et anomalies de carte. Sans activité suffisante (moins de 5 commandes), seules
 * la note et la carte comptent.
 */
export function computeQualityScore(input: QualityScoreInput): { score: number; breakdown: RestaurantQualityBreakdown } {
  const active = input.ordersCount >= 5;
  const pct = (bps: number) => bps / 100;
  const breakdown: RestaurantQualityBreakdown = {
    // 10 % d'annulations = 20 points retirés ; 10 % de refus = 15 points ; 20 % de retards = 10 points.
    cancellations: active ? Math.min(QUALITY_PENALTY_CAPS.cancellations, Math.round(pct(input.cancelRateBps) * 2)) : 0,
    rejections: active ? Math.min(QUALITY_PENALTY_CAPS.rejections, Math.round(pct(input.rejectRateBps) * 1.5)) : 0,
    lateness: active ? Math.min(QUALITY_PENALTY_CAPS.lateness, Math.round(pct(input.lateRateBps) / 2)) : 0,
    // Note moyenne sous 4,6 : 1 point par dixième manquant.
    rating:
      input.ratingCount >= 5
        ? Math.min(QUALITY_PENALTY_CAPS.rating, Math.max(0, Math.round((4.6 - input.ratingAverage) * 10)))
        : 0,
    menu: Math.min(QUALITY_PENALTY_CAPS.menu, Math.round(input.openMenuIssues / 2)),
  };
  const penalty = Object.values(breakdown).reduce((sum, value) => sum + value, 0);
  return { score: Math.max(0, Math.min(100, 100 - penalty)), breakdown };
}

/** Pièces indispensables à la validation d'un commerce (Kbis ou avis SIRET, identité, RIB). */
export const REQUIRED_RESTAURANT_DOCUMENTS: ReadonlyArray<{ key: string; types: readonly PartnerDocumentType[]; label: string }> = [
  { key: 'registration', types: ['kbis', 'siret_notice'], label: 'Extrait Kbis ou avis de situation SIRET' },
  { key: 'identity', types: ['manager_id'], label: 'Pièce d’identité du gérant' },
  { key: 'bank', types: ['bank_details'], label: 'RIB professionnel' },
];

/** Délais de relance des documents avant expiration (jours). */
export const DOCUMENT_REMINDER_DAYS = [30, 7] as const;

// ------------------------------------------------------------------ Indicateurs de risque client

export interface CustomerRiskInput {
  ordersCount: number;
  cancelledCount: number;
  refundsCount: number;
  riskScore?: number | null;
  riskFlags?: readonly string[] | null;
  notCollectedCount?: number;
  claimsCount?: number;
}

export type CustomerRiskLevel = 'low' | 'medium' | 'high';

/** Niveau de risque affiché sur la fiche client (réclamations, remboursements, commandes non récupérées). */
export function customerRiskLevel(input: CustomerRiskInput): { level: CustomerRiskLevel; reasons: string[] } {
  const reasons: string[] = [];
  const orders = Math.max(1, input.ordersCount);
  if (input.refundsCount >= 3 && input.refundsCount / orders >= 0.2) reasons.push('Remboursements répétés');
  if (input.cancelledCount >= 3 && input.cancelledCount / orders >= 0.25) reasons.push('Annulations fréquentes');
  if ((input.notCollectedCount ?? 0) >= 2) reasons.push('Commandes non récupérées');
  if ((input.claimsCount ?? 0) >= 3) reasons.push('Réclamations répétées');
  if ((input.riskFlags?.length ?? 0) > 0) reasons.push('Signaux de fraude');
  const score = input.riskScore ?? 0;
  const level: CustomerRiskLevel = score >= 70 || reasons.length >= 2 ? 'high' : score >= 40 || reasons.length === 1 ? 'medium' : 'low';
  return { level, reasons };
}

// ------------------------------------------------------------------ Entrées des fonctions

export type ApplicationDecision = 'approve' | 'documents_missing' | 'reject';

export interface ReviewApplicationInput {
  restaurantId: string;
  decision: ApplicationDecision;
  /** Motif envoyé au restaurant (obligatoire pour un refus ou des documents manquants). */
  reason?: string | null;
  missingDocuments?: PartnerDocumentType[];
  /** Mettre en ligne immédiatement après validation. */
  goLive?: boolean;
}

export interface ReviewDocumentInput {
  documentId: string;
  decision: 'approve' | 'reject';
  reason?: string | null;
  /** Date d'expiration relevée sur la pièce (AAAA-MM-JJ). */
  expiresAt?: string | null;
}

export type SuspensionKind = 'temporary' | 'permanent';

export interface SuspendRestaurantInput {
  restaurantId: string;
  kind: SuspensionKind;
  /** Fin de suspension (ISO) pour une suspension temporaire. */
  until?: string | null;
  reason: string;
  /** Message au restaurant (e-mail et notification). */
  message?: string | null;
}

export interface CommercialTermsInput {
  restaurantId: string;
  planCode: PlanCode;
  billingMode: BillingMode | null;
  /** Taux négociés ; null = taux de la formule, de la ville ou du pays. */
  negotiatedCommission: {
    platformDeliveryBps: Bps | null;
    restaurantDeliveryBps: Bps | null;
    pickupBps: Bps | null;
    validUntil: string | null;
  } | null;
  specialOffer: { commissionReductionBps: Bps; endsAt: string; reason: string } | null;
  allowedPaymentMethods: PaymentMethod[];
  deliveryFeeOverrideCents: Cents | null;
  minOrderOverrideCents: Cents | null;
  payoutFrequency: 'weekly' | 'biweekly' | 'monthly' | null;
  reason: string;
}

export type BulkRestaurantActionType =
  | 'set_commission'
  | 'set_plan'
  | 'set_feature'
  | 'send_message'
  | 'suspend'
  | 'reactivate'
  | 'export';

export interface BulkRestaurantActionInput {
  restaurantIds: string[];
  action: BulkRestaurantActionType;
  reason: string;
  params: {
    platformDeliveryBps?: Bps | null;
    restaurantDeliveryBps?: Bps | null;
    pickupBps?: Bps | null;
    planCode?: PlanCode;
    feature?: FeatureKey;
    enabled?: boolean;
    subject?: string;
    message?: string;
    until?: string | null;
    format?: 'csv' | 'xlsx';
  };
}

export interface BulkActionResult {
  jobId: string;
  succeeded: number;
  failed: number;
  errors: Array<{ id: string; message: string }>;
}

/** Ligne d'import de restaurants (fichier CSV ou Excel converti par le back-office). */
export interface RestaurantImportRow {
  name: string;
  merchantType?: MerchantType | null;
  cityId: string;
  line1: string;
  postalCode: string;
  city: string;
  phone: string;
  email: string;
  ownerFirstName: string;
  ownerLastName: string;
  ownerEmail: string;
  legalName?: string | null;
  siret?: string | null;
  planCode?: PlanCode | null;
  cuisineIds?: string[] | null;
  lat?: number | null;
  lng?: number | null;
  groupId?: string | null;
}

export interface RestaurantImportReport {
  dryRun: boolean;
  jobId: string | null;
  created: number;
  skipped: number;
  errors: Array<{ row: number; message: string }>;
  warnings: Array<{ row: number; message: string }>;
  restaurantIds: string[];
}

export interface StartImpersonationInput {
  restaurantId: string;
  reason: string;
  durationMinutes: number;
}

export type CustomerCreditReason = 'commercial_gesture' | 'late_delivery' | 'refund' | 'adjustment';

export interface CreditCustomerInput {
  userId: string;
  amountCents: Cents;
  reason: CustomerCreditReason;
  note: string;
  orderId?: string | null;
  /** Validité de l'avoir en jours (null = sans expiration). */
  validityDays?: number | null;
}

export const CUSTOMER_CREDIT_REASON_LABELS: Record<CustomerCreditReason, string> = {
  commercial_gesture: 'Geste commercial',
  late_delivery: 'Retard de livraison',
  refund: 'Remboursement en avoir',
  adjustment: 'Régularisation',
};

/** Données conservées après la suppression d'un compte client (obligations légales). */
export const CUSTOMER_RETAINED_DATA = [
  'Commandes et reçus, nom et adresse anonymisés (obligation comptable, 10 ans)',
  'Paiements et remboursements (obligation comptable)',
  'Avis déposés, auteur anonymisé',
  'Tickets de support, demandeur anonymisé',
  'Journal d’audit des actions de l’équipe',
] as const;

/** Onboarding : statuts de la file de validation, dans l'ordre du cahier. */
export const VALIDATION_QUEUE_STATUSES: readonly OnboardingStatus[] = ['pending', 'documents_missing'];
