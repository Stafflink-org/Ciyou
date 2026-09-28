// Fraude, conformité (CGU, RGPD), corbeille, sauvegardes et statistiques agrégées.
import type {
  BlocklistType,
  FraudSubjectType,
  FulfillmentMode,
  GdprRequestStatus,
  GdprRequestType,
  LegalDocumentType,
} from '../constants/enums';
import type { Cents } from '../pricing/money';
import type { EntityRef, LocalizedText, StoredFile, Timestamp, Tracked } from './common';

/** fraudCases/{id} : dossier ouvert à partir de signaux automatiques. */
export interface FraudCase extends Tracked {
  subjectType: FraudSubjectType;
  subjectId: string;
  subjectName: string;
  countryId: string;
  cityId?: string | null;
  signals: Array<{
    code:
      | 'repeated_claims'
      | 'frequent_not_received'
      | 'linked_accounts'
      | 'promo_abuse'
      | 'off_address_delivery'
      | 'abnormal_cancellations'
      | 'shared_account'
      | 'fake_orders'
      | 'refund_rate'
      | 'chargeback';
    detail: string;
    score: number;
    at: Timestamp;
  }>;
  riskScore: number;
  status: 'open' | 'investigating' | 'confirmed' | 'dismissed';
  assigneeId?: string | null;
  decision?: { action: 'none' | 'warning' | 'blocked' | 'suspended' | 'payout_hold'; note: string; by: string; at: Timestamp } | null;
  linkedEntities: EntityRef[];
}

/** settings/fraud : seuils réglables de la détection automatique (§28), rien n'est figé dans le code. */
export interface FraudSettings {
  /** Fenêtre d'observation glissante (jours). */
  lookbackDays: number;
  /** Commandes minimales sur la fenêtre pour évaluer un client. */
  clientMinOrders: number;
  /** Nombre de réclamations « commande non reçue » déclenchant le signal. */
  clientNotReceivedThreshold: number;
  /** Nombre de réclamations (tous types) déclenchant « réclamations répétées ». */
  clientRepeatedClaimsThreshold: number;
  /** Taux d'annulation client déclenchant le signal (0 à 1). */
  clientCancellationRate: number;
  /** Nombre de codes promotionnels différents utilisés par un même client. */
  promoAbuseCodesThreshold: number;
  /** Commandes minimales d'un commerce sur la fenêtre pour évaluer son taux de remboursement. */
  restaurantMinOrders: number;
  /** Taux de remboursement (remboursements / commandes) déclenchant le signal (0 à 1). */
  restaurantRefundRate: number;
  /** Commandes annulées par le client en moins de ce délai après passage, indice de commande fictive (secondes). */
  fakeOrderCancelWithinSeconds: number;
  /** Nombre de telles annulations rapides déclenchant le signal. */
  fakeOrderThreshold: number;
  /** Distance entre la position de remise et l'adresse du client à partir de laquelle une livraison est « hors adresse » (mètres). */
  driverOffAddressMeters: number;
  /** Nombre de livraisons hors adresse déclenchant le signal. */
  driverOffAddressThreshold: number;
  /** Annulations imputables au livreur (adresse injoignable...) déclenchant le signal. */
  driverCancellationsThreshold: number;
  /** Points attribués à chaque signal (plafond du dossier : 100). */
  scores: {
    frequentNotReceived: number;
    repeatedClaims: number;
    abnormalCancellations: number;
    promoAbuse: number;
    refundRate: number;
    fakeOrders: number;
    offAddressDelivery: number;
    driverCancellations: number;
    sharedAccount: number;
    linkedAccounts: number;
  };
  updatedAt?: Timestamp;
  updatedBy?: string;
}

export const DEFAULT_FRAUD_SETTINGS: Omit<FraudSettings, 'updatedAt' | 'updatedBy'> = {
  lookbackDays: 14,
  clientMinOrders: 4,
  clientNotReceivedThreshold: 3,
  clientRepeatedClaimsThreshold: 3,
  clientCancellationRate: 0.5,
  promoAbuseCodesThreshold: 6,
  restaurantMinOrders: 10,
  restaurantRefundRate: 0.3,
  fakeOrderCancelWithinSeconds: 120,
  fakeOrderThreshold: 5,
  driverOffAddressMeters: 500,
  driverOffAddressThreshold: 2,
  driverCancellationsThreshold: 3,
  scores: {
    frequentNotReceived: 25,
    repeatedClaims: 20,
    abnormalCancellations: 15,
    promoAbuse: 20,
    refundRate: 20,
    fakeOrders: 25,
    offAddressDelivery: 25,
    driverCancellations: 15,
    sharedAccount: 30,
    linkedAccounts: 30,
  },
};

/** blocklist/{id} : valeur bloquée (stockée hachée). */
export interface BlocklistEntry extends Tracked {
  type: BlocklistType;
  valueHash: string;
  /** Aperçu masqué pour l'affichage (ex. +33 6 ** ** ** 12). */
  valuePreview: string;
  reason: string;
  fraudCaseId?: string | null;
  expiresAt?: Timestamp | null;
  active: boolean;
}

/** legalDocuments/{id} : version d'un document contractuel. */
export interface LegalDocument extends Tracked {
  type: LegalDocumentType;
  countryId: string;
  version: string;
  title: LocalizedText;
  content: LocalizedText;
  pdf?: StoredFile | null;
  status: 'draft' | 'published' | 'archived';
  publishedAt?: Timestamp | null;
  effectiveAt?: Timestamp | null;
  /** Une nouvelle acceptation est exigée à la prochaine connexion. */
  requiresReacceptance: boolean;
  changeSummary?: string | null;
}

/** legalAcceptances/{id} : preuve d'acceptation (non modifiable). */
export interface LegalAcceptance {
  userId: string;
  userType: 'client' | 'restaurant' | 'driver';
  restaurantId?: string | null;
  documentId: string;
  documentType: LegalDocumentType;
  version: string;
  acceptedAt: Timestamp;
  ipHash?: string | null;
  userAgent?: string | null;
  /** Signature électronique simple : nom saisi par le signataire (contrats partenaires). */
  signatureName?: string | null;
}

/** gdprRequests/{id} : demandes d'exercice de droits, délai légal d'un mois. */
export interface GdprRequest extends Tracked {
  type: GdprRequestType;
  subjectType: 'client' | 'restaurant' | 'driver';
  subjectId?: string | null;
  email: string;
  status: GdprRequestStatus;
  receivedAt: Timestamp;
  dueAt: Timestamp;
  completedAt?: Timestamp | null;
  assigneeId?: string | null;
  export?: StoredFile | null;
  /** Données conservées malgré l'effacement (obligations légales). */
  retainedData: string[];
  notes?: string | null;
}

/** trash/{id} : élément supprimé, restaurable jusqu'à `purgeAt`. */
export interface TrashItem {
  entity: EntityRef;
  /** Chemin d'origine du document (ex. restaurants/abc/products/xyz). */
  path: string;
  snapshot: Record<string, unknown>;
  /** Sous-documents supprimés avec lui. */
  children: Array<{ path: string; snapshot: Record<string, unknown> }>;
  restaurantId?: string | null;
  deletedBy: string;
  deletedAt: Timestamp;
  reason?: string | null;
  purgeAt: Timestamp;
  restoredAt?: Timestamp | null;
  restoredBy?: string | null;
  /** Nature de l'élément de carte supprimé (section, produit, option, liste d'options). */
  menuKind?: 'section' | 'product' | 'option' | 'optionGroup' | null;
  /**
   * Liens retirés d'autres documents lors de la suppression (ex. option retirée de ses
   * listes), rétablis à la restauration : `field` de chaque document `paths`.
   */
  detached?: { field: string; paths: string[] } | null;
}

/** backups/{id} : export géré Firestore (sauvegarde planifiée ou manuelle). */
export interface Backup {
  kind: 'scheduled' | 'manual' | 'downloadable';
  status: 'running' | 'completed' | 'failed';
  bucketPath: string;
  collections: string[] | null;
  sizeBytes?: number | null;
  startedAt: Timestamp;
  finishedAt?: Timestamp | null;
  error?: string | null;
  requestedBy: string;
  /** Renseigné pour un export « téléchargeable » (kind: 'downloadable') : chemin dans le bucket applicatif (Storage), lisible par un administrateur habilité. */
  downloadPath?: string | null;
}

/** backupRestores/{id} : restauration outillée d'une sauvegarde (§31), double confirmation exigée. */
export interface BackupRestore {
  backupId: string;
  collections: string[];
  status: 'running' | 'completed' | 'failed';
  operationName?: string | null;
  startedAt: Timestamp;
  finishedAt?: Timestamp | null;
  error?: string | null;
  requestedBy: string;
  reason: string;
}

/** statsDaily/{scope_scopeId_AAAAMMJJ} : agrégats du tableau de bord et des analytics. */
export interface DailyStats {
  scope: 'platform' | 'country' | 'city' | 'zone';
  scopeId: string;
  /** Ville de rattachement (portées city et zone), pour le périmètre des responsables de ville. */
  cityId?: string | null;
  day: string;
  orders: { placed: number; delivered: number; cancelled: number; rejected: number; late: number; byMode: Partial<Record<FulfillmentMode, number>>; byHour: number[] };
  revenue: {
    /** Volume d'affaires TTC payé par les clients. */
    gmvCents: Cents;
    restaurantSalesCents: Cents;
    commissionHtCents: Cents;
    feesHtCents: Cents;
    subscriptionsHtCents: Cents;
    promoCostCents: Cents;
    refundsCents: Cents;
    courierCostCents: Cents;
    paymentFeesCents: Cents;
    marginCents: Cents;
    averageBasketCents: Cents;
  };
  delivery: { averageMinutes: number; averagePrepMinutes: number; onTimeRate: number; averageDistanceMeters: number };
  actors: {
    restaurantsActive: number;
    restaurantsNew: number;
    customersNew: number;
    customersActive: number;
    driversNew: number;
    driversOnlinePeak: number;
  };
  funnel: { appOpens: number; restaurantViews: number; addToCart: number; checkoutStarted: number; paid: number };
  support: { ticketsOpened: number; ticketsResolved: number; averageResolutionMinutes: number };
  /** Pays de rattachement (portées country, city et zone). */
  countryId?: string | null;
  /** Livreurs en ligne, maximum relevé par heure locale (offre / demande). */
  driversOnlineByHour?: number[];
  updatedAt: Timestamp;
}
