// Plateforme et sécurité du super admin (cahier §22 à §31) : double authentification
// des administrateurs, sessions, politique de sécurité, sauvegardes, conservation,
// signaux de fraude automatiques. Complète models/admin.ts, platform.ts et compliance.ts
// sans en modifier les interfaces.
import type { AdminSession, SecurityAlert } from './admin';
import type { Backup } from './compliance';
import type { SecuritySettings, RetentionSettings } from './platform';
import type { Timestamp } from './common';

/**
 * adminSecrets/{uid} : secret TOTP chiffré (AES-256-GCM, clé en secret des Cloud
 * Functions) et empreintes des codes de secours. Jamais lisible depuis un client.
 */
export interface AdminMfaSecret {
  /** Secret actif, chiffré. */
  totpSecretEnc: string | null;
  /** Secret en cours d'enrôlement (validé par un premier code). */
  pendingSecretEnc: string | null;
  pendingCreatedAt: Timestamp | null;
  enrolledAt: Timestamp | null;
  /** Empreintes SHA-256 des codes de secours non utilisés. */
  recoveryCodeHashes: string[];
  /** Dernier pas de temps accepté (anti-rejeu). */
  lastUsedStep: number | null;
  failedAttempts: number;
  lockedUntil: Timestamp | null;
  updatedAt: Timestamp;
}

/**
 * adminSessions/{id} : session d'un administrateur (une par connexion Firebase).
 * Identifiant stable : empreinte de l'uid et de l'heure d'authentification.
 */
export interface AdminSessionRecord extends AdminSession {
  /** Heure d'authentification Firebase (secondes), identifie la connexion. */
  authTime: number;
  /** Double authentification validée pour cette session. */
  mfaVerifiedAt?: Timestamp | null;
  /** Méthode utilisée : application d'authentification ou code de secours. */
  mfaMethod?: 'totp' | 'recovery_code' | null;
  /** Fin de validité (durée maximale d'une session admin). */
  expiresAt?: Timestamp | null;
  revokeReason?: string | null;
  adminEmail?: string | null;
  adminName?: string | null;
}

/** Politique de sécurité enrichie (settings/security). */
export interface SecurityPolicy extends SecuritySettings {
  /** Date à partir de laquelle un administrateur sans double authentification est bloqué. */
  mfaEnforcedFrom?: Timestamp | null;
  /** Nombre d'essais de code avant verrouillage temporaire. */
  mfaMaxAttempts?: number;
  /** Durée du verrouillage après trop d'essais (minutes). */
  mfaLockMinutes?: number;
  /** Alerte à la connexion depuis un nouvel appareil. */
  alertOnNewDevice?: boolean;
  /** Plage horaire (heure de Paris) où une ouverture de session est jugée inhabituelle ; from = to : désactivée. */
  unusualLoginHours?: { fromHour: number; toHour: number };
}

/** Réponse de trackAdminSession : état de la session et politique applicable. */
export interface AdminSessionState {
  sessionId: string;
  mfaEnrolled: boolean;
  mfaVerified: boolean;
  /** La double authentification est exigée maintenant (enrôlement ou vérification). */
  mfaRequired: boolean;
  /** Échéance de l'obligation pour un administrateur non enrôlé (ms), null si déjà exigée ou désactivée. */
  enforcementDeadline: number | null;
  revoked: boolean;
  expired: boolean;
  expiresAt: number | null;
}

/** Sauvegarde Firestore enrichie (opération d'export gérée). */
export interface BackupRecord extends Backup {
  /** Nom de l'opération longue Firestore (suivi de progression). */
  operationName?: string | null;
  progress?: { documents: number | null; bytes: number | null } | null;
  reason?: string | null;
}

/** Durées de conservation enrichies (settings/retention). */
export interface RetentionPolicy extends RetentionSettings {
  /** Anonymisation automatique planifiée active. */
  autoAnonymize?: boolean;
  /** Dernière exécution de la tâche planifiée. */
  lastRunAt?: Timestamp | null;
  lastRunSummary?: RetentionRunSummary | null;
}

export interface RetentionRunSummary {
  dryRun: boolean;
  inactiveAccounts: number;
  ordersAnonymized: number;
  driverLocationsDeleted: number;
  trashPurged: number;
  at: number;
}

/** Alerte de sécurité avec cible (compatibilité : `type` étendu). */
export type SecurityAlertType = SecurityAlert['type'] | 'new_device' | 'mfa_failed' | 'session_revoked';
