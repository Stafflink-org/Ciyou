// Super admin, rubriques « Livreurs » (cahier §6), « Commandes » (§8), « Règles
// automatiques » (§9) et « Zones et villes » (§10) : entrées et sorties des Cloud
// Functions d'exploitation, libellés et calculs purs partagés par le back-office
// et les fonctions (documents obligatoires, règles d'attribution applicables).
import type {
  CancelReason,
  DriverAvailability,
  FulfillmentMode,
  OnboardingStatus,
  OrderStatus,
  PartnerDocumentType,
  PaymentMethod,
  PaymentStatus,
  SanctionType,
  VehicleType,
} from '../constants/enums';
import type { Bps, Cents } from '../pricing/money';
import type { CourierPayModel, CourierPerKmMode, DeliveryFeeTier } from '../pricing/types';
import type { LatLng, Timestamp, WeeklyHours } from './common';
import type { Driver } from './drivers';
import type { DispatchRules, EmergencyClosure, OrderRules } from './platform';

// ------------------------------------------------------------------ Livreurs : documents

/** Véhicules motorisés : permis et carte grise exigés. */
export const MOTORIZED_VEHICLES: readonly VehicleType[] = ['scooter', 'motorbike', 'car'];

/** Pièces exigibles d'un livreur (cahier §6), selon son type et son véhicule. */
export interface DriverDocumentRequirement {
  type: PartnerDocumentType;
  /** Obligatoire pour valider le compte (sinon : « si concerné »). */
  required: boolean;
  /** Le document porte une date d'expiration surveillée. */
  expires: boolean;
  hint: string;
}

export function driverDocumentRequirements(driver: Pick<Driver, 'type' | 'vehicle'>): DriverDocumentRequirement[] {
  const motorized = MOTORIZED_VEHICLES.includes(driver.vehicle.type);
  const list: DriverDocumentRequirement[] = [
    { type: 'identity', required: true, expires: true, hint: 'Carte d’identité ou passeport en cours de validité.' },
    { type: 'residence_permit', required: false, expires: true, hint: 'Ressortissants hors Union européenne.' },
    { type: 'work_permit', required: false, expires: true, hint: 'Si le titre de séjour ne vaut pas autorisation de travail.' },
  ];
  // Les livreurs salariés d'un commerce n'ont pas de statut d'indépendant.
  if (driver.type === 'platform') {
    list.push(
      { type: 'siret_registration', required: true, expires: false, hint: 'Avis de situation SIRET (auto-entrepreneur).' },
      { type: 'urssaf_certificate', required: true, expires: true, hint: 'Attestation de vigilance de moins de 6 mois.' },
      { type: 'insurance', required: true, expires: true, hint: 'Responsabilité civile professionnelle.' },
    );
  }
  if (motorized) {
    list.push(
      { type: 'driving_license', required: true, expires: false, hint: 'Permis correspondant au véhicule déclaré.' },
      { type: 'vehicle_registration', required: true, expires: false, hint: 'Certificat d’immatriculation du véhicule.' },
    );
  }
  return list;
}

/** Blocage automatique d'un livreur (documents expirés, contrôle d'identité échoué). */
export interface DriverBlock {
  reason: 'documents_expired' | 'identity_check_failed' | 'sanction';
  since: Timestamp;
  details?: string | null;
  documentIds?: string[];
}

export const DRIVER_BLOCK_LABELS: Record<DriverBlock['reason'], string> = {
  documents_expired: 'Documents expirés',
  identity_check_failed: 'Contrôle d’identité échoué',
  sanction: 'Sanction en cours',
};

// ------------------------------------------------------------------ Livreurs : actions

export type DriverApplicationDecision = 'approve' | 'request_documents' | 'reject';

export interface ReviewDriverApplicationInput {
  driverId: string;
  decision: DriverApplicationDecision;
  /** Motif (obligatoire pour un refus ou une demande de documents). */
  reason?: string | null;
  missingDocuments?: PartnerDocumentType[];
}

export interface ReviewDriverApplicationResult {
  onboardingStatus: OnboardingStatus;
  status: Driver['status'];
}

export interface ReviewDriverDocumentInput {
  documentId: string;
  decision: 'approve' | 'reject';
  reason?: string | null;
  /** Date d'expiration relevée sur la pièce (AAAA-MM-JJ). */
  expiresAt?: string | null;
}

export interface ReviewDriverDocumentResult {
  status: 'approved' | 'rejected';
  /** Le livreur a été débloqué (tous ses documents obligatoires sont valides). */
  driverUnblocked: boolean;
}

export interface ReviewIdentityCheckInput {
  checkId: string;
  decision: 'pass' | 'fail';
  reason?: string | null;
}

export interface RequestIdentityChecksInput {
  driverIds: string[];
  reason: string;
}

export interface SanctionDriverInput {
  driverIds: string[];
  type: SanctionType;
  reason: string;
  details?: string | null;
  /** Suspension temporaire : durée en jours. */
  durationDays?: number | null;
}

export interface DecideSanctionContestInput {
  sanctionId: string;
  decision: 'upheld' | 'overturned';
  note: string;
}

export type BulkDriverAction = 'activate' | 'deactivate' | 'message' | 'set_cash' | 'set_zones';

export interface BulkUpdateDriversInput {
  driverIds: string[];
  action: BulkDriverAction;
  reason: string;
  message?: { title: string; body: string } | null;
  acceptsCash?: boolean | null;
  zoneIds?: string[] | null;
}

export interface BulkResult {
  succeeded: number;
  failed: number;
  errors: Array<{ id: string; message: string }>;
}

export const BULK_DRIVER_ACTION_LABELS: Record<BulkDriverAction, string> = {
  activate: 'Réactivation',
  deactivate: 'Désactivation',
  message: 'Message',
  set_cash: 'Paiement en espèces',
  set_zones: 'Zones de livraison',
};

// ------------------------------------------------------------------ Attribution des courses

export type DispatchScope = 'platform' | 'city' | 'zone';

export const DISPATCH_MODE_LABELS: Record<NonNullable<DispatchRules['mode']>, string> = {
  auto_assign: 'Attribution directe',
  offers: 'Propositions successives',
};

export const DISPATCH_STRATEGY_LABELS: Record<DispatchRules['strategy'], string> = {
  nearest: 'Livreur le plus proche',
  nearest_with_rating: 'Le plus proche, pondéré par la note',
  batched: 'Regroupement de commandes',
};

/** Règles d'attribution par défaut (repli si settings/dispatch est absent). */
export const DEFAULT_DISPATCH_RULES: DispatchRules = {
  strategy: 'nearest',
  mode: 'auto_assign',
  engine: 'advanced',
  offerTimeoutSeconds: 45,
  initialRadiusMeters: 2000,
  radiusStepMeters: 1000,
  maxRadiusMeters: 6000,
  maxRounds: 5,
  dispatchLeadMinutes: 8,
  maxConcurrentOrdersPerDriver: 2,
  shortageRatioAlert: 0.6,
  minDriverRating: null,
};

/** Règles applicables : plateforme, puis ville, puis zone (la plus précise l'emporte). */
export function resolveDispatchRules(
  platform: Partial<DispatchRules> | null | undefined,
  city?: Partial<DispatchRules> | null,
  zone?: Partial<DispatchRules> | null,
): DispatchRules {
  const clean = (value: Partial<DispatchRules> | null | undefined) =>
    Object.fromEntries(Object.entries(value ?? {}).filter(([, v]) => v !== undefined)) as Partial<DispatchRules>;
  return { ...DEFAULT_DISPATCH_RULES, ...clean(platform), ...clean(city), ...clean(zone) };
}

/** Rayon de recherche d'un tour d'attribution (1 = premier tour). */
export function dispatchRadiusForRound(rules: Pick<DispatchRules, 'initialRadiusMeters' | 'radiusStepMeters' | 'maxRadiusMeters'>, round: number): number {
  return Math.min(rules.maxRadiusMeters, rules.initialRadiusMeters + Math.max(0, round - 1) * rules.radiusStepMeters);
}

export interface UpdateDispatchRulesInput {
  scope: DispatchScope;
  /** Ville ou zone (absent pour la plateforme). */
  scopeId?: string | null;
  /** Valeurs à appliquer ; `null` supprime la surcharge de la ville ou de la zone. */
  rules: Partial<DispatchRules> | null;
  reason: string;
}

export interface AdminDispatchOrderInput {
  orderId: string;
  /** Livreur imposé ; absent = relance de l'attribution automatique. */
  driverId?: string | null;
  /** Retirer le livreur actuel avant de relancer (réattribution). */
  unassign?: boolean;
  reason: string;
}

export interface AdminDispatchOrderResult {
  assigned: boolean;
  driverName: string | null;
  distanceMeters: number | null;
  /** Proposition envoyée (mode « propositions successives »). */
  offered: boolean;
  round: number;
}

export interface RespondToOfferInput {
  offerId: string;
  accept: boolean;
  reason?: string | null;
}

/** Candidat évalué par le moteur d'attribution (renvoyé pour l'aperçu du super admin). */
export interface DispatchCandidate {
  driverId: string;
  displayName: string;
  vehicle: VehicleType;
  availability: DriverAvailability;
  distanceMeters: number;
  rating: number;
  activeOrders: number;
  eligible: boolean;
  /** Motif d'exclusion lisible. */
  excludedBecause?: string | null;
}

// ------------------------------------------------------------------ Règles automatiques (§9)

export type OrderRulesScope = 'platform' | 'country' | 'city';

export interface UpdateOrderRulesInput {
  scope: OrderRulesScope;
  scopeId?: string | null;
  /** Valeurs à appliquer ; `null` supprime la surcharge du pays ou de la ville. */
  rules: Partial<OrderRules> | null;
  reason: string;
}

// ------------------------------------------------------------------ Rémunération des livreurs

/** Barème de rémunération modifiable depuis le super admin (surcharge pays ou ville). */
export interface CourierPayRulesInput {
  model: CourierPayModel;
  flatDistanceThresholdMeters: number;
  flatAmountCents: Cents;
  perKmCents: Cents;
  perKmMode: CourierPerKmMode;
  peakBonusCents: Cents;
  /** Heures locales (0 à 23) considérées « heure de pointe » (déjeuner, dîner...). */
  peakHours: number[];
  freeWaitMinutes: number;
  waitingPerMinuteCents: Cents;
  minimumPerOrderCents: Cents;
  hourlyGuaranteeEnabled: boolean;
  hourlyGuaranteeCents: Cents;
}

export interface UpdateCourierPayInput {
  scope: 'country' | 'city';
  scopeId: string;
  /** `null` supprime la surcharge de la ville (retour au barème du pays). */
  courier: CourierPayRulesInput | null;
  reason: string;
}

// ------------------------------------------------------------------ Zones et villes (§10)

export const EMERGENCY_REASON_LABELS: Record<EmergencyClosure['reason'], string> = {
  weather: 'Intempéries',
  event: 'Événement',
  driver_shortage: 'Manque de livreurs',
  incident: 'Incident',
  other: 'Autre motif',
};

export interface SaveCityInput {
  cityId?: string | null;
  countryId: string;
  name: string;
  timezone: string;
  center: LatLng;
  serviceHours: WeeklyHours;
  reason?: string | null;
}

export interface SetCityActiveInput {
  cityId: string;
  active: boolean;
  reason: string;
}

export interface SaveZoneInput {
  zoneId?: string | null;
  cityId: string;
  name: string;
  color: string;
  active: boolean;
  polygon: LatLng[];
  maxDeliveryDistanceMeters: number;
  deliveryTiers?: DeliveryFeeTier[] | null;
  minOrderCents?: Cents | null;
  serviceHours?: WeeklyHours | null;
  reason?: string | null;
}

export interface CloseZoneInput {
  scope: 'city' | 'zone';
  id: string;
  /** true : fermeture d'urgence ; false : réouverture. */
  close: boolean;
  reason?: EmergencyClosure['reason'] | null;
  /** Message affiché aux clients (français), puis en anglais et en arabe. */
  message?: string | null;
  messageEn?: string | null;
  messageAr?: string | null;
  /** Fin prévue (millisecondes) ; absent = jusqu'à réouverture manuelle. */
  endsAt?: number | null;
  note: string;
}

export interface SaveSurgeRuleInput {
  ruleId?: string | null;
  cityId: string;
  zoneIds: string[];
  name: string;
  active: boolean;
  trigger: 'manual' | 'schedule' | 'demand';
  schedule?: WeeklyHours | null;
  demandRatio?: number | null;
  multiplierBps: Bps;
  flatFeeCents: Cents;
  courierBonusCents: Cents;
  reason?: string | null;
}

export interface ApplySurgeInput {
  ruleId: string;
  /** true : déclenche la majoration maintenant ; false : l'arrête. */
  on: boolean;
  /** Durée de la majoration manuelle (minutes). */
  durationMinutes?: number | null;
  reason: string;
}

export const SURGE_TRIGGER_LABELS: Record<SaveSurgeRuleInput['trigger'], string> = {
  manual: 'Manuelle',
  schedule: 'Planifiée',
  demand: 'Automatique (demande)',
};

// ------------------------------------------------------------------ Commandes (§8)

export interface ListOrdersAdminInput {
  countryId?: string | null;
  cityIds?: string[] | null;
  statuses?: OrderStatus[] | null;
  fulfillment?: FulfillmentMode | null;
  paymentMethod?: PaymentMethod | null;
  zoneId?: string | null;
  restaurantId?: string | null;
  driverId?: string | null;
  customerId?: string | null;
  /** Numéro de commande, nom du restaurant, du client ou du livreur. */
  search?: string | null;
  /** Bornes de création (millisecondes). */
  from?: number | null;
  to?: number | null;
  flags?: Array<'late' | 'refunded' | 'disputed' | 'cancelled'> | null;
  /** Curseur renvoyé par la page précédente. */
  cursor?: string | null;
  pageSize?: number;
}

export interface AdminOrderRow {
  id: string;
  number: string;
  cityId: string;
  countryId: string;
  restaurantId: string;
  restaurantName: string;
  customerId: string;
  customerName: string;
  driverId: string | null;
  driverName: string | null;
  status: OrderStatus;
  fulfillment: FulfillmentMode;
  paymentMethod: PaymentMethod;
  paymentStatus: PaymentStatus;
  totalCents: Cents;
  refundedCents: Cents;
  currency: string;
  itemsCount: number;
  zoneId: string | null;
  late: boolean;
  lateMinutes: number;
  disputed: boolean;
  cancelReason: CancelReason | null;
  dispatchStatus: 'searching' | 'assigned' | 'unavailable' | null;
  createdAt: number;
  deliveredAt: number | null;
  test: boolean;
}

export interface ListOrdersAdminResult {
  rows: AdminOrderRow[];
  nextCursor: string | null;
  /** Nombre de commandes examinées pour cette page (filtres combinés appliqués en mémoire). */
  scanned: number;
  /** Total estimé du filtre principal (sans les filtres secondaires). */
  total: number | null;
}

export interface OrderAnomaliesInput {
  countryId?: string | null;
  cityIds?: string[] | null;
  days: number;
}

export interface AnomalyRow {
  key: string;
  label: string;
  cityId?: string | null;
  orders: number;
  cancelRate: number;
  lateRate: number;
  rejectRate: number;
  /** Écart au taux de référence le plus marqué (en points). */
  worstGap: number;
  worstMetric: 'cancel' | 'late' | 'reject';
  flagged: boolean;
}

export interface OrderAnomaliesResult {
  from: number;
  to: number;
  baseline: { orders: number; cancelRate: number; lateRate: number; rejectRate: number };
  /** Seuil d'écart au-delà duquel une ligne est signalée (en points). */
  threshold: number;
  minOrders: number;
  restaurants: AnomalyRow[];
  zones: AnomalyRow[];
  hours: AnomalyRow[];
}

/** Tonalité d'un statut de commande dans le super admin (clés = statuts stockés). */
export const ADMIN_ORDER_STATUS_TONES: Record<OrderStatus, 'neutral' | 'brand' | 'amber' | 'success' | 'danger' | 'info' | 'plum' | 'teal'> = {
  scheduled: 'neutral',
  new: 'brand',
  accepted: 'neutral',
  preparing: 'amber',
  ready: 'info',
  assigned: 'info',
  picked_up: 'success',
  delivered: 'success',
  cancelled: 'danger',
};
