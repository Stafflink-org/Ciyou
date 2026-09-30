// Administration interne : administrateurs, rôles, sessions, journal d'audit,
// alertes, notes internes, filtres enregistrés, « voir comme », traitements en masse.
import type { AdminRole, AlertSeverity, AlertStatus } from '../constants/enums';
import type { AdminPermission } from '../permissions/admin';
import type { Cents } from '../pricing/money';
import type { EntityRef, StoredFile, Timestamp, Tracked } from './common';

/**
 * admins/{uid} : membre de l'équipe interne. `permissions` est résolu depuis le rôle
 * (adminRoles) par Cloud Function et lu par les règles de sécurité.
 */
export interface AdminUser extends Tracked {
  uid: string;
  email: string;
  displayName: string;
  role: AdminRole;
  permissions: AdminPermission[];
  active: boolean;
  /** Périmètre géographique : vide = tous (sauf responsable de ville). */
  countryIds: string[];
  cityIds: string[];
  /** Plafond de remboursement sans validation ; null = plafond du rôle. */
  refundLimitCents?: Cents | null;
  mfaEnrolled: boolean;
  lastLoginAt?: Timestamp | null;
  lastLoginIp?: string | null;
}

/** adminRoles/{role} : permissions d'un rôle interne (modifiable, sauf super_admin). */
export interface AdminRoleDefinition {
  role: AdminRole;
  label: string;
  description: string;
  permissions: AdminPermission[];
  defaultRefundLimitCents: Cents;
  /** Coordonnées complètes et données bancaires masquées pour ce rôle. */
  maskPersonalData: boolean;
  updatedAt: Timestamp;
  updatedBy: string;
}

/** adminSessions/{id} : appareils connectés, déconnexion à distance. */
export interface AdminSession {
  adminId: string;
  device: string;
  userAgent: string;
  ipHash: string;
  approximateLocation?: string | null;
  createdAt: Timestamp;
  lastSeenAt: Timestamp;
  revokedAt?: Timestamp | null;
  revokedBy?: string | null;
}

/**
 * auditLogs/{id} : qui a fait quoi, quand, pourquoi. Écrit uniquement par Cloud
 * Function, jamais modifié ni supprimé.
 */
export interface AuditLog {
  actor: {
    uid: string;
    type: 'admin' | 'restaurant' | 'driver' | 'client' | 'system';
    role?: string | null;
    name: string;
  };
  action: string;
  target: EntityRef;
  countryId?: string | null;
  cityId?: string | null;
  reason?: string | null;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  /** Action réalisée en « voir comme le restaurant ». */
  impersonationSessionId?: string | null;
  ipHash?: string | null;
  userAgent?: string | null;
  sensitive: boolean;
  at: Timestamp;
}

/** securityAlerts/{id} : connexion inhabituelle, export massif, remboursements en série. */
export interface SecurityAlert {
  type: 'unusual_login' | 'mass_export' | 'refund_spike' | 'failed_logins' | 'permission_change' | 'mfa_disabled';
  adminId?: string | null;
  severity: AlertSeverity;
  details: string;
  status: AlertStatus;
  detectedAt: Timestamp;
  handledBy?: string | null;
  handledAt?: Timestamp | null;
}

/**
 * platformAlerts/{id} : alertes par exception et file « à traiter » du tableau de bord.
 * Créées par les Cloud Functions de surveillance ; l'ouverture mène à l'élément concerné.
 */
export interface PlatformAlert {
  kind:
    | 'restaurant_cancellation_rate'
    | 'restaurant_rejection_rate'
    | 'restaurant_late_rate'
    | 'zone_driver_shortage'
    | 'refund_spike'
    | 'city_order_drop'
    | 'service_down'
    | 'subscription_unpaid'
    | 'restaurant_to_validate'
    | 'driver_to_validate'
    | 'document_expired'
    | 'ticket_escalated'
    | 'review_reported'
    | 'gdpr_request'
    | 'payout_failed'
    | 'fraud_signal'
    | 'menu_quality'
    | 'dispatch_failed';
  queue: 'alert' | 'todo';
  severity: AlertSeverity;
  title: string;
  message: string;
  target: EntityRef;
  countryId?: string | null;
  cityId?: string | null;
  metric?: { value: number; threshold: number; unit: string } | null;
  status: AlertStatus;
  /** Clé de dédoublonnage : une seule alerte ouverte par clé. */
  dedupKey: string;
  detectedAt: Timestamp;
  acknowledgedBy?: string | null;
  acknowledgedAt?: Timestamp | null;
  resolvedAt?: Timestamp | null;
}

/** internalNotes/{id} : notes visibles uniquement par l'équipe interne. */
export interface InternalNote {
  target: EntityRef;
  body: string;
  pinned: boolean;
  authorId: string;
  authorName: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

/** savedFilters/{id} : filtres enregistrés (ex. « restaurants Pro à Metz »). */
export interface SavedFilter {
  ownerId: string;
  entity: 'restaurants' | 'drivers' | 'clients' | 'orders' | 'tickets' | 'invoices' | 'payouts' | 'reviews';
  name: string;
  filters: Record<string, string | number | boolean | string[] | null>;
  shared: boolean;
  createdAt: Timestamp;
}

/** impersonationSessions/{id} : « voir comme le restaurant » (lecture seule par défaut). */
export interface ImpersonationSession {
  adminId: string;
  restaurantId: string;
  mode: 'read_only' | 'write';
  reason: string;
  startedAt: Timestamp;
  expiresAt: Timestamp;
  endedAt?: Timestamp | null;
  actionsCount: number;
  /** Dénormalisé pour l'affichage (bandeau, journal). */
  adminName?: string | null;
  restaurantName?: string | null;
  cityId?: string | null;
  endedBy?: string | null;
}

/** bulkJobs/{id} : imports, actions groupées et exports, exécutés par Cloud Function. */
export interface BulkJob extends Tracked {
  type:
    | 'import_restaurants'
    | 'import_menu'
    | 'import_prospects'
    | 'bulk_update_restaurants'
    | 'bulk_update_drivers'
    | 'bulk_message'
    | 'export';
  entity?: string | null;
  params: Record<string, unknown>;
  input?: StoredFile | null;
  format?: 'csv' | 'xlsx' | 'pdf' | null;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  total: number;
  processed: number;
  succeeded: number;
  failed: number;
  errors: Array<{ row?: number | null; id?: string | null; message: string }>;
  output?: StoredFile | null;
  reason?: string | null;
  startedAt?: Timestamp | null;
  finishedAt?: Timestamp | null;
}

/** scheduledReports/{id} : récapitulatif envoyé par e-mail chaque jour, semaine ou mois. */
export interface ScheduledReport extends Tracked {
  name: string;
  report: 'daily_summary' | 'finance' | 'orders' | 'restaurants' | 'drivers' | 'support';
  frequency: 'daily' | 'weekly' | 'monthly';
  recipients: string[];
  filters: Record<string, string | string[] | null>;
  format: 'pdf' | 'csv' | 'xlsx';
  active: boolean;
  lastRunAt?: Timestamp | null;
  nextRunAt: Timestamp;
  /** Heure d'envoi (Europe/Paris, 0 à 23 ; 7 par défaut). */
  hour?: number;
  /** Résultat du dernier envoi. `skipped` : aucun destinataire réel (tous en domaine de test). */
  lastRunStatus?: 'sent' | 'partial' | 'failed' | 'skipped' | null;
  lastRunError?: string | null;
  runsCount?: number;
  /** Nombre réel d'e-mails envoyés au dernier passage (honnêteté du statut). */
  lastRunSentCount?: number;
}
