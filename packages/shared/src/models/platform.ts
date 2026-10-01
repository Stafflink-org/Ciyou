// Plateforme : paramètres globaux, marchés (pays, villes, zones), fonctionnalités,
// affichage de l'app client, santé des services.
import type {
  AlertSeverity,
  AppKey,
  FeatureKey,
  FeatureScope,
  Locale,
  PaymentMethod,
  PayoutFrequency,
  ServiceHealth,
  ServiceKey,
} from '../constants/enums';
import type { Bps, Cents } from '../pricing/money';
import type { CurrencyCode } from '../pricing/currency';
import type { PricingOverride } from '../pricing/defaults';
import type {
  CustomerCancellationPolicy,
  LateCreditTier,
  RefundLiabilityRules,
} from '../pricing/policies';
import type { DeliveryFeeTier, MarketPricingConfig } from '../pricing/types';
import type { ImageRef, LatLng, LocalizedText, Timestamp, TimeRange, Tracked, WeeklyHours } from './common';

// ============================================================ settings/{doc}

/** settings/general : identité et réglages régionaux par défaut. */
export interface GeneralSettings {
  platformName: string;
  legalEntityName: string;
  supportEmail: string;
  supportPhone?: string | null;
  defaultCountryId: string;
  defaultLocale: Locale;
  defaultTimezone: string;
  /** Devise par défaut de la plateforme (chaque pays porte sa propre devise). */
  currency: CurrencyCode;
  /** Langues proposées (fr, en, ar ; l'arabe s'affiche de droite à gauche). */
  supportedLocales?: Locale[];
  updatedAt: Timestamp;
  updatedBy: string;
}

/** settings/branding : logo et couleurs. */
export interface BrandingSettings {
  logo?: ImageRef | null;
  logoDark?: ImageRef | null;
  favicon?: ImageRef | null;
  colors: { primary: string; secondary: string; accent: string; background: string };
  updatedAt: Timestamp;
  updatedBy: string;
}

/**
 * Règles automatiques des commandes (cahier §9). Valeurs plateforme, surchargées
 * par pays (`countries.orderRules`) puis par ville (`cities.orderRules`).
 */
export interface OrderRules {
  /** Délai d'acceptation par le restaurant avant annulation et remboursement automatiques. */
  acceptanceTimeoutSeconds: number;
  /** Action au dépassement du délai d'acceptation (décision client : annulation + remboursement). */
  acceptanceTimeoutAction?: 'cancel_and_refund';
  /** Pause automatique du commerce après N commandes manquées d'affilée. */
  autoPause?: { enabled: boolean; missedOrdersInARow: number } | null;
  /** Inactivité du commerce : alerte après N jours sans commande, retrait N jours après l'alerte. */
  merchantInactivity?: { enabled: boolean; alertAfterDays: number; removeAfterAlertDays: number } | null;
  defaultPrepMinutes: number;
  /**
   * Valeurs initiales des réglages de commande d'un nouveau commerce (préparation, capacité,
   * minimum, préavis des commandes programmées). Copiées à la création du commerce et
   * reprises par le bouton « Réinitialiser » du back-office restaurant.
   */
  merchantDefaults?: MerchantDefaults;
  /** Allongement maximal que le restaurant peut ajouter en période de rush. */
  maxPrepExtensionMinutes: number;
  customerCancellation: CustomerCancellationPolicy;
  refundLiability: RefundLiabilityRules;
  customerAbsent: {
    driverWaitMinutes: number;
    /** Le livreur est payé comme une course livrée. */
    payDriver: boolean;
    refundCustomer: boolean;
    /** Le commerce est payé normalement (décision client). */
    payRestaurant?: boolean;
    /** Le livreur appelle le client depuis l'app avant de clôturer. */
    callViaApp?: boolean;
    /** Clôture automatique par la plateforme N minutes après la fin de l'attente si le livreur n'a pas clôturé (0 = désactivée). */
    autoCloseGraceMinutes?: number;
  };
  itemUnavailable: {
    allowReplacement: boolean;
    /** Délai laissé au client pour accepter un remplacement. */
    replacementTimeoutSeconds: number;
  };
  lateCredit: {
    enabled: boolean;
    tiers: LateCreditTier[];
    /** L'avoir est crédité sur le porte-monnaie client. */
    creditValidityDays: number;
  };
  /** Vente d'alcool : interdite par décision client (`enabled: false`, `locked: true`). */
  alcohol: {
    enabled: boolean;
    /** Réglage verrouillé : non modifiable depuis le super admin. */
    locked?: boolean;
    minimumAge: number;
    requireAgeConfirmation: boolean;
    requireIdCheckAtDelivery: boolean;
    salesHours?: TimeRange[] | null;
  };
  scheduledOrders: {
    enabled: boolean;
    minLeadMinutes: number;
    maxDaysAhead: number;
  };
  /** Délai après livraison pendant lequel une réclamation est recevable. */
  claimWindowHours: number;
  /** Retard toléré (minutes après l'heure promise) avant qu'une commande soit comptée en retard dans les indicateurs. */
  lateToleranceMinutes?: number;
  /** Réclamations : photo obligatoire et contrôles automatiques de la photo. */
  claims?: {
    photoRequired: boolean;
    minPhotos: number;
    maxPhotos: number;
    /** Photo prise avant la livraison = incohérente (date EXIF antérieure à la commande). */
    checkPhotoDate: boolean;
    /** Refuse la photo déjà utilisée dans une autre réclamation. */
    checkDuplicates: boolean;
    /** Réclamations répétées sur 30 jours au-delà desquelles le dossier passe à un agent. */
    repeatThreshold30d: number;
    /** Acceptation automatique et avoir immédiat si les contrôles sont propres et le montant sous ce plafond (0 = jamais). */
    autoAcceptMaxCents: number;
  };
}

/** Valeurs initiales des réglages de commande d'un commerce (plateforme → pays → ville). */
export interface MerchantDefaults {
  /** Temps de préparation annoncé (minutes). */
  prepMinutes: number;
  /** Commandes en cours simultanées au-delà desquelles le commerce refuse les nouvelles commandes. */
  maxConcurrentOrders: number;
  /** Minimum de commande (unités mineures de la devise du pays). */
  minOrderCents: Cents;
  /** Commandes programmées : délai minimal avant le créneau (minutes). */
  scheduledLeadMinutes: number;
  /** Commandes programmées : horizon maximal (jours). */
  scheduledMaxDays: number;
}

export interface OrderRulesSettings extends OrderRules {
  updatedAt: Timestamp;
  updatedBy: string;
}

/** settings/dispatch : attribution des courses (cahier §6). */
export interface DispatchRules {
  strategy: 'nearest' | 'nearest_with_rating' | 'batched';
  /** Temps laissé au livreur pour accepter une proposition. */
  offerTimeoutSeconds: number;
  initialRadiusMeters: number;
  /** Élargissement du rayon à chaque tour sans acceptation. */
  radiusStepMeters: number;
  maxRadiusMeters: number;
  maxRounds: number;
  /** Proposer la course au livreur N minutes avant la fin de préparation estimée. */
  dispatchLeadMinutes: number;
  maxConcurrentOrdersPerDriver: number;
  /** En deçà de ce ratio livreurs disponibles / commandes en attente, une alerte remonte. */
  shortageRatioAlert: number;
  /**
   * Attribution directe au livreur retenu, ou propositions successives (le livreur
   * accepte dans `offerTimeoutSeconds`, sinon la course passe au suivant). Défaut : directe.
   */
  mode?: 'auto_assign' | 'offers';
  /** Moteur : avancé (tours à rayon croissant, préférences du livreur) ou simple. Défaut : avancé. */
  engine?: 'advanced' | 'simple';
  /** Note minimale des livreurs sollicités (null = aucune). */
  minDriverRating?: number | null;
}

export interface DispatchSettings extends DispatchRules {
  updatedAt: Timestamp;
  updatedBy: string;
}

/** settings/payments : moyens de paiement, pourboires, espèces. */
export interface PaymentSettings {
  methods: Record<PaymentMethod, boolean>;
  tips: { enabled: boolean; presetsCents: Cents[]; maxCents: Cents };
  cash: {
    enabled: boolean;
    /** Plafond d'espèces détenues par un livreur avant blocage des courses en espèces. */
    driverCashLimitCents: Cents;
    /** Espèces seulement avec un livreur salarié du commerce (décision client : true). Voir isCashAllowed. */
    merchantDriversOnly?: boolean;
  };
  failedPaymentRetry: { maxAttempts: number };
  updatedAt: Timestamp;
  updatedBy: string;
}

/** settings/refunds : plafonds et validation. */
export interface RefundSettings {
  /** Au-delà de ce montant, la validation d'un responsable est requise (sauf plafond propre à l'agent). */
  approvalThresholdCents: Cents;
  defaultMethod: 'original_payment' | 'wallet_credit';
  walletCreditValidityDays: number;
  /** Montant maximal d'un avoir manuel (par défaut 500 €). */
  maxCreditCents?: Cents;
  updatedAt: Timestamp;
  updatedBy: string;
}

/** settings/payouts : calendrier des reversements. */
export interface PayoutSettings {
  restaurants: { frequency: PayoutFrequency; dayOfWeek: number; minimumCents: Cents; delayDays: number };
  drivers: { frequency: PayoutFrequency; dayOfWeek: number; minimumCents: Cents; delayDays: number };
  updatedAt: Timestamp;
  updatedBy: string;
}

/** settings/loyalty : programme de fidélité plateforme. */
export interface LoyaltySettings {
  enabled: boolean;
  pointsPerEuro: number;
  welcomePoints: number;
  /** Paliers d'échange : N points = remise en centimes. */
  rewards: Array<{ points: number; valueCents: Cents }>;
  pointsValidityDays: number | null;
  /** Les restaurants peuvent-ils créer leur propre programme ? */
  allowRestaurantPrograms: boolean;
  /** Panier minimum (hors livraison) pour gagner des points. */
  minOrderCents?: Cents;
  /** Part maximale d'une commande payable en points (points de base). */
  maxRedeemBps?: Bps;
  /** Taux de retour maximal (remise / dépense) d'un palier des programmes créés par les commerces (points de base). */
  maxRestaurantReturnBps?: Bps;
  updatedAt: Timestamp;
  updatedBy: string;
}

/** settings/campaignRules : garde-fous des campagnes marketing des restaurants (cahier §20). */
export interface CampaignSettings {
  /** Nombre maximal d'envois par établissement sur 7 jours glissants. */
  maxSendsPer7Days: number;
  /** Plage d'envoi autorisée (heure de Paris) : pas de sollicitation en dehors. */
  sendWindow: { fromHour: number; toHour: number };
  updatedAt: Timestamp;
  updatedBy: string;
}

/** settings/referral : parrainage. */
export interface ReferralSettings {
  client: { enabled: boolean; referrerRewardCents: Cents; refereeRewardCents: Cents; minFirstOrderCents: Cents };
  /** Parrainage commerce → commerce : crédit publicitaire (mise en avant payante), 100 € par défaut. */
  restaurant: { enabled: boolean; rewardCents: Cents; qualifyingOrders: number; rewardType?: 'ad_credit' | 'cash' };
  driver: { enabled: boolean; rewardCents: Cents; qualifyingDeliveries: number };
  updatedAt: Timestamp;
  updatedBy: string;
}

/** settings/promotions : encadrement des promotions créées par les restaurants. */
export interface PromotionSettings {
  /** Plafonds appliqués ? (décision client : promotions des commerces sans limite, false). */
  capsEnabled?: boolean;
  restaurantMaxPercentBps: Bps;
  restaurantMaxFixedCents: Cents;
  /** Les promotions restaurant passent en validation avant publication. */
  restaurantRequiresReview: boolean;
  maxActivePerRestaurant: number;
  /** Commandes livrées à partir desquelles un client est « fidèle » (ciblage des offres). */
  loyalOrdersThreshold?: number;
  /** Jours sans commande par défaut d'une offre « clients inactifs ». */
  inactiveDaysDefault?: number;
  updatedAt: Timestamp;
  updatedBy: string;
}

/** settings/display : règles de classement des restaurants dans l'app client. */
export interface DisplaySettings {
  ranking: {
    distanceWeight: number;
    ratingWeight: number;
    popularityWeight: number;
    planWeight: number;
    sponsoredWeight: number;
    newRestaurantBoostDays: number;
  };
  /** Mention obligatoire affichée sur les résultats sponsorisés. */
  sponsoredLabel: string;
  /** Seuils du suivi qualité des notes (tâche detectRatingDrops). */
  qualityWatch?: RatingWatchThresholds;
  updatedAt: Timestamp;
  updatedBy: string;
}

/** Seuils du suivi qualité : note en baisse sur 30 jours glissants. */
export interface RatingWatchThresholds {
  /** Nombre minimal d'avis sur la période pour évaluer une tendance. */
  minReviews: number;
  /** Baisse (points) déclenchant la surveillance. */
  watchDrop: number;
  /** Baisse (points) déclenchant l'alerte. */
  alertDrop: number;
  /** Moyenne sous laquelle l'alerte est levée quelle que soit la tendance. */
  alertBelow: number;
}

/** settings/support : délais cibles et escalade. */
export interface SupportSettings {
  firstResponseTargetMinutes: Record<'low' | 'normal' | 'high' | 'urgent', number>;
  resolutionTargetHours: Record<'low' | 'normal' | 'high' | 'urgent', number>;
  autoEscalateAfterMinutes: number;
  liveChatEnabled: boolean;
  /** Fermeture automatique des tickets résolus sans nouvelle réponse (jours). */
  autoCloseResolvedAfterDays?: number;
  /** Horaires du support (décision client : 24/7). */
  alwaysOn?: boolean;
  /** Message affiché aux commerces en tête de « Support Ciyou Eats » (ex. « assistance 24 h/24, 7 j/7 »). */
  merchantNotice?: SupportMerchantNotice | null;
  updatedAt: Timestamp;
  updatedBy: string;
}

/** Message du support affiché dans le back-office des commerces (fr obligatoire, en / ar facultatifs). */
export interface SupportMerchantNotice {
  enabled: boolean;
  title: LocalizedText;
  body: LocalizedText;
}

/** settings/limits : limites techniques et seuils réglables (écran « Limites et seuils »). */
export interface LimitsSettings {
  exports: {
    /** Lignes au plus par export CSV / Excel / PDF des rapports. */
    csvMaxRows: number;
    xlsxMaxRows: number;
    pdfMaxRows: number;
    /** Lignes au plus par export du journal d'audit. */
    auditMaxRows: number;
    /** Lignes au plus par import de commerces. */
    importMaxRows: number;
  };
  /** Espèces des livreurs de commerce : alerte quand des espèces ne sont pas remises depuis N jours. */
  merchantCashAlertDays: number;
  updatedAt?: Timestamp;
  updatedBy?: string;
}

/** settings/security : politique d'accès des administrateurs. */
export interface SecuritySettings {
  requireMfaForAdmins: boolean;
  adminSessionMaxHours: number;
  /** Seuils des alertes de sécurité. */
  alerts: {
    massExportRows: number;
    refundsPerAgentPerHour: number;
    failedLoginsPerHour: number;
  };
  updatedAt: Timestamp;
  updatedBy: string;
}

/** settings/retention : durées de conservation (RGPD). */
export interface RetentionSettings {
  inactiveAccountMonths: number;
  anonymizeOrdersAfterMonths: number;
  keepInvoicesYears: number;
  keepAuditLogsYears: number;
  deleteDriverLocationsAfterDays: number;
  trashRetentionDays: number;
  updatedAt: Timestamp;
  updatedBy: string;
}

/**
 * settings/translator : réglages publics de la traduction automatique (Azure Translator,
 * cahier « translation-azure »). La clé d'abonnement ne vit JAMAIS ici (voir
 * translatorSecrets/config, Cloud Functions uniquement) : seuls `configured` et
 * `keyLast4` (4 derniers caractères) indiquent son état au navigateur.
 */
export interface TranslatorSettings {
  enabled: boolean;
  /** true dès qu'une clé a été enregistrée (le navigateur ne la relit jamais). */
  configured: boolean;
  /** 4 derniers caractères de la clé enregistrée, pour vérification visuelle seulement. */
  keyLast4?: string | null;
  region: string;
  endpoint: string;
  /** Langues actives de la traduction automatique (extensible au-delà de fr/en/ar). */
  activeLocales: Locale[];
  /** Plafond mensuel de caractères traduits (0 = illimité), pour maîtriser les coûts Azure. */
  monthlyCharacterCap: number;
  /** Caractères traduits sur le mois en cours (remis à zéro chaque mois, clé AAAA-MM). */
  charactersThisMonth: number;
  currentMonthKey: string;
  status: 'configured' | 'not_configured' | 'error';
  lastError?: string | null;
  lastTestAt?: Timestamp | null;
  lastTestOk?: boolean | null;
  updatedAt: Timestamp;
  updatedBy: string;
}

/** translatorSecrets/config : clé Azure Translator chiffrée. Cloud Functions uniquement. */
export interface TranslatorSecret {
  /** Clé chiffrée (même mécanisme que le secret TOTP : AES-256-GCM, clé dans Secret Manager). */
  keyEnc: string;
  updatedAt: Timestamp;
  updatedBy: string;
}

/** translations/{hash(text+from+to)} : cache — ne retraduit jamais deux fois le même texte. */
export interface TranslationCacheEntry {
  sourceText: string;
  from: string;
  to: string;
  translated: string;
  createdAt: Timestamp;
}

/**
 * settings/maps : réglages publics de la cartographie (Google Maps), pilotables depuis
 * le super admin (tâche « maps-settings »). Deux clés distinctes, comme recommandé par
 * Google :
 * - clé « web » : chargée par les apps web (admin, restaurant, bientôt client web).
 *   Publique par nature (visible dans le code source du navigateur), protégée par une
 *   restriction de référents HTTP côté Google Cloud, PAS par le secret — c'est pourquoi
 *   `getPublicRuntimeConfig` la renvoie au navigateur (voir docs/CONTRATS_APPS_MOBILES.md) ;
 * - clé « mobile » : réservée aux futures apps Android/iOS, restreinte par empreinte de
 *   signature (Android) / identifiant de bundle (iOS). Jamais renvoyée à un client web.
 * Comme pour `TranslatorSettings`, ce document ne porte jamais les clés elles-mêmes,
 * seulement l'état « configurée » et les 4 derniers caractères masqués — sauf que la clé
 * web est malgré tout distribuée par un canal dédié (getPublicRuntimeConfig), jamais par
 * ce document ni par le bundle JS.
 */
export interface MapsSettings {
  /** true dès qu'une clé web a été enregistrée. */
  configuredWeb: boolean;
  /** 4 derniers caractères de la clé web enregistrée, vérification visuelle seulement. */
  webKeyLast4?: string | null;
  /** true dès qu'une clé mobile a été enregistrée. */
  configuredMobile: boolean;
  /** 4 derniers caractères de la clé mobile enregistrée. */
  mobileKeyLast4?: string | null;
  /** Domaines/référents à autoriser côté Google Cloud pour la clé web (informatif, rappel à l'équipe). */
  allowedWebReferrers: string[];
  /** Empreintes/identifiants à autoriser côté Google Cloud pour la clé mobile (informatif : empreinte SHA-1 Android, bundle ID iOS). */
  allowedMobileIdentifiers: string[];
  status: 'configured' | 'not_configured' | 'error';
  lastError?: string | null;
  lastTestAt?: Timestamp | null;
  lastTestOk?: boolean | null;
  /**
   * L'API « Maps Embed » (distincte de « Maps JavaScript », déjà testée par
   * `lastTestOk` via Geocoding) doit être activée séparément dans Google Cloud
   * Console pour que les apps mobiles (RouteMap) affichent un itinéraire — sinon
   * Google répond 403 « This API project is not authorized to use this API »
   * (voir docs/CONTRAT_MODULES.md §11 bis/ter). Vérifié paresseusement (mis en
   * cache) par `getPublicRuntimeConfig`, jamais par un appel du super admin.
   */
  embedActivated?: boolean | null;
  embedCheckedAt?: Timestamp | null;
  updatedAt: Timestamp;
  updatedBy: string;
}

/** mapsSecrets/config : clés Google Maps chiffrées (web + mobile). Cloud Functions uniquement. */
export interface MapsSecret {
  /** Chiffrée (même mécanisme que le secret TOTP : AES-256-GCM, clé dans Secret Manager). */
  webKeyEnc?: string | null;
  mobileKeyEnc?: string | null;
  updatedAt: Timestamp;
  updatedBy: string;
}

/**
 * Réponse de `getPublicRuntimeConfig` : identifiants publics nécessaires au démarrage
 * d'un client (web aujourd'hui, apps mobiles demain — voir docs/CONTRATS_APPS_MOBILES.md).
 * Jamais de secret ici : uniquement des valeurs déjà publiques par nature (visibles dans
 * un bundle JS ou protégées côté Google/Stripe par restriction de référent/domaine, pas
 * par le secret).
 */
export interface PublicRuntimeConfig {
  /** Clé Google Maps « web », ou `null` si non configurée (l'appelant doit alors afficher un repli, jamais un écran cassé). */
  googleMapsWebKey: string | null;
  mapsConfigured: boolean;
  /** true/false si vérifié (mis en cache), `null` si jamais vérifié ou clé absente — l'appelant affiche l'erreur brute Google dans ce cas, jamais bloquant. */
  mapsEmbedActivated: boolean | null;
}

/** settings/maintenance : mode maintenance par application. */
export interface MaintenanceSettings {
  apps: Record<AppKey, { enabled: boolean; message: LocalizedText | null; until: Timestamp | null }>;
  updatedAt: Timestamp;
  updatedBy: string;
}

/** settingsHistory/{id} : chaque modification d'un réglage (non modifiable). */
export interface SettingsHistoryEntry {
  /** Chemin du document modifié (ex. settings/orderRules, cities/metz). */
  docPath: string;
  changedFields: string[];
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  reason?: string | null;
  changedBy: string;
  changedAt: Timestamp;
  /** Ville concernée, quand le réglage modifié est scopé à une ville (règles Firestore : cloisonne la lecture). */
  cityId?: string | null;
}

// ============================================================ Marchés

/** countries/{countryId} (id = code ISO : FR, BE, LU, DZ, MA, TN). */
export interface Country extends Tracked {
  code: string;
  name: string;
  active: boolean;
  /** Devise du marché ; montants en unités mineures (centimes, millimes pour TND). */
  currency: CurrencyCode;
  /** Taux de TVA validés par un expert-comptable. */
  vatValidated?: boolean;
  vatNote?: string | null;
  /** Stripe disponible ; sinon, moyens de paiement locaux. */
  stripeAvailable?: boolean;
  locales: Locale[];
  defaultLocale: Locale;
  timezone: string;
  phonePrefix: string;
  pricing: MarketPricingConfig;
  orderRules?: Partial<OrderRules> | null;
  paymentMethods: Record<PaymentMethod, boolean>;
  /** Prestataires de paiement proposés dans ce pays (paymentProviders/{id}). */
  paymentProviderIds?: string[];
  /** Identifiant fiscal de l'entité Ciyou Eats facturant dans ce pays. */
  billingEntity: {
    legalName: string;
    vatNumber: string;
    registrationNumber: string;
    address: string;
    invoicePrefix: string;
  };
  legal: {
    dac7Authority: string;
    requiresDriverUrssaf: boolean;
    alcoholMinimumAge: number;
  };
}

/** cities/{cityId}. */
export interface City extends Tracked {
  countryId: string;
  name: string;
  slug: string;
  active: boolean;
  /** Ouverture au public (les restaurants peuvent s'inscrire avant). */
  launchedAt?: Timestamp | null;
  timezone: string;
  center: LatLng;
  /** Horaires de fonctionnement de la livraison. */
  serviceHours: WeeklyHours;
  pricing?: PricingOverride | null;
  orderRules?: Partial<OrderRules> | null;
  dispatch?: Partial<DispatchRules> | null;
  /** Coupure d'urgence de toute la ville. */
  emergencyClosure?: EmergencyClosure | null;
  commissionOverrideBps?: Bps | null;
  managerIds: string[];
  stats?: { restaurantsActive: number; driversActive: number; customers: number; updatedAt: Timestamp } | null;
}

export interface EmergencyClosure {
  active: boolean;
  reason: 'weather' | 'event' | 'driver_shortage' | 'incident' | 'other';
  message: LocalizedText;
  startedAt: Timestamp;
  endsAt?: Timestamp | null;
  startedBy: string;
}

/** zones/{zoneId} : zone de livraison dessinée sur la carte. */
export interface Zone extends Tracked {
  countryId: string;
  cityId: string;
  name: string;
  active: boolean;
  color: string;
  /** Polygone fermé (premier point ≠ dernier point, la fermeture est implicite). */
  polygon: LatLng[];
  /** Boîte englobante pour un pré-filtrage rapide. */
  bounds: { north: number; south: number; east: number; west: number };
  maxDeliveryDistanceMeters: number;
  deliveryTiers?: DeliveryFeeTier[] | null;
  minOrderCents?: Cents | null;
  serviceHours?: WeeklyHours | null;
  emergencyClosure?: EmergencyClosure | null;
  /** Majoration en cours (calculée ou manuelle). */
  currentSurge?: { multiplierBps: Bps; courierBonusCents: Cents; ruleId?: string | null; until: Timestamp } | null;
  /** Indicateurs temps réel alimentés par Cloud Function. */
  live?: { driversOnline: number; driversAvailable: number; ordersWaiting: number; updatedAt: Timestamp; driversOnDelivery?: number; ordersInProgress?: number } | null;
  /** Surcharge des règles d'attribution des courses pour cette zone. */
  dispatch?: Partial<DispatchRules> | null;
}

/** surgeRules/{id} : majoration heures de pointe (manuelle, planifiée ou automatique). */
export interface SurgeRule extends Tracked {
  countryId: string;
  cityId: string;
  zoneIds: string[];
  name: string;
  active: boolean;
  trigger: 'manual' | 'schedule' | 'demand';
  schedule?: WeeklyHours | null;
  /** Déclenchement automatique : commandes en attente par livreur disponible. */
  demandRatio?: number | null;
  multiplierBps: Bps;
  flatFeeCents: Cents;
  courierBonusCents: Cents;
  startsAt?: Timestamp | null;
  endsAt?: Timestamp | null;
}

// ============================================================ Fonctionnalités

/** featureFlags/{key} : interrupteur avec surcharges par portée. */
export interface FeatureFlag {
  key: FeatureKey;
  description: string;
  /** Valeur par défaut plateforme. */
  enabled: boolean;
  /** Fonctionnalité verrouillée par décision client (ex. vente d'alcool) : ni activable ni surchargeable. */
  locked?: boolean;
  /** Surcharges : la plus spécifique l'emporte (restaurant > plan > ville > pays > plateforme). */
  overrides: Array<{ scope: Exclude<FeatureScope, 'platform'>; scopeId: string; enabled: boolean }>;
  updatedAt: Timestamp;
  updatedBy: string;
}

/** integrations/{key} : services externes de la plateforme (Stripe, Brevo, Google Maps…). */
export interface PlatformIntegration {
  key: 'stripe' | 'brevo' | 'google_maps' | 'fcm' | 'sms' | 'accounting' | string;
  name: string;
  category: 'payment' | 'email' | 'sms' | 'maps' | 'push' | 'accounting' | 'pos' | 'other';
  enabled: boolean;
  mode: 'test' | 'live';
  status: ServiceHealth;
  lastCheckAt?: Timestamp | null;
  lastError?: string | null;
  /** Aucune clé secrète ici : les secrets vivent dans les variables des Cloud Functions. */
  publicConfig: Record<string, string | number | boolean>;
  updatedAt: Timestamp;
  updatedBy: string;
}

/** appVersions/{app} : politique de mise à jour des applications. */
export interface AppVersionPolicy {
  app: AppKey;
  latestVersion: string;
  minimumVersion: string;
  forceUpdate: boolean;
  message?: LocalizedText | null;
  storeUrls?: { ios?: string | null; android?: string | null } | null;
  updatedAt: Timestamp;
  updatedBy: string;
}

/** serviceStatus/{serviceKey} : état courant d'un service surveillé. */
export interface ServiceStatus {
  key: ServiceKey;
  status: ServiceHealth;
  message?: string | null;
  latencyMs?: number | null;
  errorRate?: number | null;
  checkedAt: Timestamp;
  openIncidentId?: string | null;
}

/** incidents/{id} : historique des incidents et de leur résolution. */
export interface Incident extends Tracked {
  title: string;
  services: ServiceKey[];
  severity: AlertSeverity;
  status: 'investigating' | 'identified' | 'monitoring' | 'resolved';
  startedAt: Timestamp;
  resolvedAt?: Timestamp | null;
  updates: Array<{ at: Timestamp; status: Incident['status']; message: string; by: string }>;
  postMortem?: string | null;
  publicMessage?: LocalizedText | null;
}

/** counters/{name} : compteurs séquentiels (numéros de commande, de facture), écrits en transaction. */
export interface Counter {
  value: number;
  prefix: string;
  updatedAt: Timestamp;
}

// ============================================================ Affichage app client

/** cuisineCategories/{id}. */
export interface CuisineCategory extends Tracked {
  name: LocalizedText;
  slug: string;
  icon?: string | null;
  image?: ImageRef | null;
  order: number;
  active: boolean;
}

export type HomeSectionType =
  | 'welcome_message'
  | 'banner_carousel'
  | 'featured_restaurants'
  | 'promotions'
  | 'popular'
  | 'new_restaurants'
  | 'categories'
  | 'reorder';

/** homeSections/{id} : composition de la page d'accueil, par ville. */
export interface HomeSection extends Tracked {
  type: HomeSectionType;
  title?: LocalizedText | null;
  subtitle?: LocalizedText | null;
  countryId?: string | null;
  /** null = toutes les villes. */
  cityIds: string[] | null;
  order: number;
  active: boolean;
  restaurantIds?: string[] | null;
  startsAt?: Timestamp | null;
  endsAt?: Timestamp | null;
  /** Section retirée de la composition (conservée pour l'historique). */
  archivedAt?: Timestamp | null;
}

/** banners/{id}. */
export interface Banner extends Tracked {
  title: LocalizedText;
  body?: LocalizedText | null;
  image: ImageRef;
  link?: { type: 'restaurant' | 'promotion' | 'page' | 'url'; target: string } | null;
  cityIds: string[] | null;
  order: number;
  active: boolean;
  startsAt?: Timestamp | null;
  endsAt?: Timestamp | null;
  sponsored: boolean;
  /** Restaurant annonceur quand la bannière est sponsorisée. */
  restaurantId?: string | null;
  /** Bannière retirée (conservée pour l'historique). */
  archivedAt?: Timestamp | null;
}

/** sponsoredPlacements/{id} : mise en avant payante vendue à un restaurant. */
export interface SponsoredPlacement extends Tracked {
  restaurantId: string;
  cityId: string;
  slot: 'home_top' | 'home_featured' | 'search_top' | 'category_top' | 'banner';
  categoryId?: string | null;
  priceHtCents: Cents;
  startsAt: Timestamp;
  endsAt: Timestamp;
  status: 'pending_payment' | 'scheduled' | 'active' | 'ended' | 'cancelled';
  invoiceId?: string | null;
  impressions: number;
  clicks: number;
  orders: number;
  /** Offre du catalogue (sponsoredOffers) dont le prix est issu. */
  offerId?: string | null;
  restaurantName?: string | null;
  countryId?: string | null;
  /** Paiement : facture Ciyou Eats ou crédit publicitaire (parrainage). */
  billing?: 'invoice' | 'ad_credit' | 'offered' | null;
  /** Prix catalogue HT ; `priceHtCents` = montant facturé (0 si offert ou payé en crédit publicitaire). */
  listPriceHtCents?: Cents | null;
  /** Part réglée en crédit publicitaire. */
  adCreditUsedCents?: Cents | null;
  cancellation?: { reason: string; by: string; at: Timestamp } | null;
}

/** pages/{slug} : pages d'information éditables (FAQ, à propos…). Les CGU passent par legalDocuments. */
export interface ContentPage extends Tracked {
  slug: string;
  title: LocalizedText;
  body: LocalizedText;
  audience: Array<'client' | 'restaurant' | 'driver' | 'public'>;
  published: boolean;
  order: number;
  /** Page libre ou FAQ structurée (questions / réponses). Défaut : page. */
  kind?: ContentPageKind;
  /** Questions de la FAQ publiée (kind = faq). */
  faqItems?: FaqItem[] | null;
  /** Brouillon en cours d'édition, publié par la Cloud Function `publishPage`. */
  draft?: ContentPageDraft | null;
  /** Numéro de la version publiée (historique dans pages/{slug}/versions). */
  version?: number;
  publishedAt?: Timestamp | null;
  publishedBy?: string | null;
  /** Page retirée de la liste (conservée pour l'historique). */
  archivedAt?: Timestamp | null;
}

export type ContentPageKind = 'page' | 'faq';

export interface FaqItem {
  id: string;
  question: string;
  /** Réponse en texte enrichi (Markdown restreint, voir `parseRichText`). */
  answer: string;
  category?: string | null;
}

export interface ContentPageDraft {
  title: LocalizedText;
  body: LocalizedText;
  faqItems?: FaqItem[] | null;
  audience: ContentPage['audience'];
  updatedAt: Timestamp;
  updatedBy: string;
}

/** pages/{slug}/versions/{version} : instantané figé de chaque publication. */
export interface ContentPageVersion {
  version: number;
  title: LocalizedText;
  body: LocalizedText;
  faqItems?: FaqItem[] | null;
  audience: ContentPage['audience'];
  changeSummary?: string | null;
  publishedAt: Timestamp;
  publishedBy: string;
  publishedByName: string;
}

/** helpArticles/{id} : centre d'aide. */
export interface HelpArticle extends Tracked {
  title: LocalizedText;
  body: LocalizedText;
  category: string;
  audience: Array<'client' | 'restaurant' | 'driver'>;
  tags: string[];
  published: boolean;
  order: number;
  /** Article retiré du centre d'aide (conservé pour l'historique). */
  archivedAt?: Timestamp | null;
  views: number;
  helpfulYes: number;
  helpfulNo: number;
}
