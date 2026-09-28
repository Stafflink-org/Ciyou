// Pilotage du super admin : tableau de bord global, recherche universelle,
// analytics, exports et rapports programmés (cahier §1 à §4). Types échangés
// entre l'application d'administration et les Cloud Functions du domaine admin.
import type { Cents } from '../pricing/money';
import type { PlanCode } from '../pricing/plans';
import type { EntityRef, Timestamp } from './common';
import type { PlatformAlert } from './admin';

// ------------------------------------------------------------------ Filtres

/** Périmètre et période communs aux écrans de pilotage (dates calendaires AAAA-MM-JJ, bornes incluses). */
export interface PilotageFilters {
  from: string;
  to: string;
  countryId?: string | null;
  /** Villes du périmètre (au plus 30) ; null = toutes les villes autorisées. */
  cityIds?: string[] | null;
  /** Formule d'abonnement des commerces ; null = toutes. */
  planCode?: PlanCode | null;
}

// ------------------------------------------------------------------ Tableau de bord

/** Indicateurs agrégés d'une période (issus de statsDaily ou des agrégats restaurants). */
export interface PilotageKpis {
  ordersPlaced: number;
  ordersDelivered: number;
  ordersCancelled: number;
  ordersRejected: number;
  ordersLate: number;
  gmvCents: Cents;
  restaurantSalesCents: Cents;
  commissionHtCents: Cents;
  feesHtCents: Cents;
  subscriptionsHtCents: Cents;
  refundsCents: Cents;
  marginCents: Cents;
  averageBasketCents: Cents;
  /** Annulées / passées (0 à 1). */
  cancellationRate: number;
  customersNew: number;
}

/** Compteurs d'acteurs du périmètre (instantané). */
export interface PilotageCounters {
  restaurants: { active: number; paused: number; suspended: number; onboarding: number; closed: number; total: number };
  customers: { registered: number; active30d: number };
  drivers: { registered: number; active: number; online: number; onDelivery: number; onboarding: number };
  subscriptions: { active: number; trialing: number; pastDue: number; cancelled: number; mrrCents: Cents };
}

/** Événement d'activité récente (inscriptions, suspensions, changements de formule, résiliations). */
export interface PilotageActivity {
  id: string;
  kind: 'restaurant_signup' | 'driver_signup' | 'restaurant_status' | 'driver_status' | 'plan_change' | 'subscription_cancelled' | 'audit';
  title: string;
  detail?: string | null;
  target: EntityRef;
  cityId?: string | null;
  tone: 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'brand';
  at: string;
}

export interface PilotageOverviewInput extends PilotageFilters {
  /** Période de comparaison (même durée, juste avant). */
  compareFrom: string;
  compareTo: string;
}

export interface PilotageOverview {
  counters: PilotageCounters;
  activity: PilotageActivity[];
  /** Renseignés uniquement quand une formule est choisie (statsDaily n'est pas ventilé par formule). */
  planKpis?: { current: PilotageKpis; previous: PilotageKpis; daily: Array<{ day: string; gmvCents: Cents; orders: number; commissionHtCents: Cents }> } | null;
  generatedAt: string;
}

// ------------------------------------------------------------------ Analytics

export type AnalyticsSection = 'growth' | 'restaurants' | 'drivers' | 'cities' | 'subscriptions' | 'funnel';

export interface RestaurantRankingRow {
  restaurantId: string;
  name: string;
  cityId: string;
  planCode: PlanCode;
  status: string;
  orders: number;
  delivered: number;
  salesCents: Cents;
  commissionCents: Cents;
  averageBasketCents: Cents;
  cancellationRate: number;
  rejectionRate: number;
  averagePrepMinutes: number;
  rating: number;
  ratingCount: number;
  /** Variation des ventes vs période précédente (-1 à +∞) ; null si pas d'historique. */
  salesTrend: number | null;
  previousSalesCents: Cents;
}

export interface DriverPerformanceRow {
  driverId: string;
  name: string;
  cityId: string;
  zoneIds: string[];
  vehicle: string;
  status: string;
  availability: string;
  deliveries: number;
  deliveriesInPeriod: number;
  acceptanceRate: number;
  cancellationRate: number;
  onTimeRate: number;
  lateInPeriod: number;
  averageDeliveryMinutes: number;
  rating: number;
}

export interface CityAnalyticsRow {
  cityId: string;
  name: string;
  countryId: string;
  orders: number;
  delivered: number;
  gmvCents: Cents;
  commissionHtCents: Cents;
  averageBasketCents: Cents;
  averageDeliveryMinutes: number;
  onTimeRate: number;
  cancellationRate: number;
  byHour: number[];
  driversOnlineByHour: number[];
  driversRegistered: number;
  driversOnlineNow: number;
  /** Commandes par livreur en ligne (pic) : > 3 = tension. */
  demandPerDriver: number | null;
  zones: Array<{ zoneId: string; name: string; active: boolean; driversAvailable: number; pendingOrders: number }>;
}

export interface SubscriptionAnalytics {
  byPlan: Array<{ planCode: PlanCode; name: string; active: number; trialing: number; pastDue: number; mrrCents: Cents }>;
  mrrCents: Cents;
  arrCents: Cents;
  churnRate: number;
  cancellations: number;
  upgrades: number;
  downgrades: number;
  newSubscriptions: number;
  monthly: Array<{ month: string; mrrCents: Cents; newCount: number; cancelledCount: number; upgrades: number; downgrades: number }>;
  recentChanges: Array<{ subscriptionId: string; subscriberName: string; event: string; planCode: PlanCode; at: string; reason?: string | null }>;
}

export interface GrowthAnalytics {
  daily: Array<{ day: string; customersNew: number; restaurantsNew: number; driversNew: number; ordersPlaced: number; gmvCents: Cents }>;
  totals: { customersNew: number; restaurantsNew: number; driversNew: number; previousCustomersNew: number; previousRestaurantsNew: number; previousDriversNew: number };
  /** Rétention clients par cohorte mensuelle : part des clients ayant recommandé les mois suivants. */
  cohorts: Array<{ cohort: string; size: number; retention: number[] }>;
  /** Part des clients de la période ayant passé au moins 2 commandes. */
  repeatRate: number;
  /** Restaurants actifs au début de la période toujours actifs à la fin. */
  restaurantRetention: number;
}

export interface FunnelAnalytics {
  steps: Array<{ key: 'appOpens' | 'restaurantViews' | 'addToCart' | 'checkoutStarted' | 'paid'; label: string; value: number }>;
  daily: Array<{ day: string; appOpens: number; addToCart: number; paid: number }>;
  conversionRate: number;
  /** Source des données (Firebase Analytics agrégé). */
  source: 'analytics' | 'estimated' | 'none';
}

export interface PilotageAnalyticsInput extends PilotageFilters {
  section: AnalyticsSection;
}

export interface PilotageAnalytics {
  section: AnalyticsSection;
  growth?: GrowthAnalytics;
  restaurants?: { rows: RestaurantRankingRow[]; atRisk: RestaurantRankingRow[] };
  drivers?: { rows: DriverPerformanceRow[]; byZone: Array<{ zoneId: string; name: string; deliveries: number; lateRate: number; averageMinutes: number }> };
  cities?: { rows: CityAnalyticsRow[] };
  subscriptions?: SubscriptionAnalytics;
  funnel?: FunnelAnalytics;
  generatedAt: string;
}

// ------------------------------------------------------------------ Recherche globale

export type SearchHitType = 'order' | 'restaurant' | 'client' | 'driver' | 'invoice' | 'ticket';

export interface GlobalSearchHit {
  type: SearchHitType;
  id: string;
  title: string;
  subtitle?: string | null;
  /** Statut stocké (libellé côté application). */
  status?: string | null;
  /** Élément mis en correspondance (e-mail, téléphone, SIRET…), déjà masqué si nécessaire. */
  matched?: string | null;
  cityId?: string | null;
  at?: string | null;
}

export interface GlobalSearchInput {
  query: string;
  limit?: number;
}

export interface GlobalSearchResult {
  query: string;
  groups: Array<{ type: SearchHitType; hits: GlobalSearchHit[] }>;
  tookMs: number;
}

// ------------------------------------------------------------------ Exports

export type ExportEntity =
  | 'restaurants'
  | 'clients'
  | 'drivers'
  | 'orders'
  | 'payouts'
  | 'invoices'
  | 'subscriptions'
  | 'stats'
  | 'tickets'
  | 'reviews';

export type ExportFormat = 'csv' | 'xlsx' | 'pdf';

export interface ExportFilters {
  from?: string | null;
  to?: string | null;
  countryId?: string | null;
  cityIds?: string[] | null;
  status?: string | null;
  planCode?: PlanCode | null;
}

export interface ExportDataInput {
  entity: ExportEntity;
  format: ExportFormat;
  filters: ExportFilters;
  reason?: string | null;
}

export interface ExportDataResult {
  jobId: string;
  fileName: string;
  mimeType: string;
  /** Contenu du fichier encodé en base64. */
  contentBase64: string;
  rowCount: number;
  /** Nombre maximal de lignes atteint : affiner les filtres. */
  truncated: boolean;
}

// ------------------------------------------------------------------ Rapports programmés

export type ReportKind = 'daily_summary' | 'finance' | 'orders' | 'restaurants' | 'drivers' | 'support';
export type ReportFrequency = 'daily' | 'weekly' | 'monthly';

export interface SaveScheduledReportInput {
  id?: string | null;
  name: string;
  report: ReportKind;
  frequency: ReportFrequency;
  recipients: string[];
  format: ExportFormat;
  /** Heure d'envoi (Europe/Paris). */
  hour: number;
  countryId?: string | null;
  cityIds?: string[] | null;
  active: boolean;
}

export interface RunReportNowInput {
  id: string;
  /** Aperçu sans envoi (aucun e-mail ne part). */
  dryRun: boolean;
}

export interface RunReportNowResult {
  sent: number;
  failed: number;
  subject: string;
  html: string;
  period: { from: string; to: string };
  attachmentName: string;
}

// ------------------------------------------------------------------ Surveillance

/** settings/monitoring : seuils des alertes par exception (tous modifiables par le super admin). */
export interface MonitoringSettings {
  /** Taux d'annulation d'un restaurant sur 7 jours (0 à 1). */
  restaurantCancellationRate: number;
  /** Taux de refus d'un restaurant sur 7 jours (0 à 1). */
  restaurantRejectionRate: number;
  /** Nombre minimal de commandes sur 7 jours pour évaluer un restaurant. */
  restaurantMinOrders: number;
  /** Chute des commandes d'une ville vs moyenne des 4 mêmes jours précédents (0 à 1). */
  cityOrderDrop: number;
  /** Commandes minimales attendues pour évaluer une chute. */
  cityMinOrders: number;
  /** Hausse des remboursements sur 7 jours vs 28 jours précédents (1 = +100 %). */
  refundSpike: number;
  /** Livreurs disponibles par commande en attente, en dessous = pénurie. */
  zoneDriverRatio: number;
  /** Délai de réponse avant alerte sur une demande RGPD (jours restants). */
  gdprDueWarningDays: number;
  /** Commandes par livreur en ligne (pic) à partir duquel une ville est jugée en tension forte (affichage pilotage). */
  driverTensionRatio: number;
  /** Une alerte écartée par un humain n'est rouverte que si la situation persiste ce nombre de jours. */
  alertReopenAfterDays: number;
  updatedAt?: Timestamp;
  updatedBy?: string;
}

export const DEFAULT_MONITORING_SETTINGS: Omit<MonitoringSettings, 'updatedAt' | 'updatedBy'> = {
  restaurantCancellationRate: 0.06,
  restaurantRejectionRate: 0.08,
  restaurantMinOrders: 15,
  cityOrderDrop: 0.35,
  cityMinOrders: 10,
  refundSpike: 1,
  zoneDriverRatio: 0.6,
  gdprDueWarningDays: 7,
  driverTensionRatio: 3,
  alertReopenAfterDays: 7,
};

export interface HandlePlatformAlertInput {
  alertId: string;
  status: 'acknowledged' | 'resolved' | 'dismissed' | 'open';
  note?: string | null;
}

/** Alerte telle qu'affichée (identifiant, sévérité, cible). */
export type PlatformAlertView = PlatformAlert & { id: string };
