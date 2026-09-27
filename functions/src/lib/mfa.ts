// Double authentification des administrateurs : politique de sécurité, session courante
// et contrôle serveur appliqué à TOUTES les fonctions d'administration (requireAdmin).
// Le contrôle ne désactive jamais la double authentification d'un compte enrôlé.
import { createHash } from 'node:crypto';
import {
  COLLECTIONS,
  SETTINGS_DOCS,
  DEFAULT_SECURITY_POLICY,
  type AdminSessionRecord,
  type AdminUser,
  type SecurityPolicy,
} from '@golink/shared';
import type { CallableRequest } from 'firebase-functions/v2/https';
import { db } from './admin';
import { fail } from './errors';

/** Identifiant stable d'une session : empreinte de l'uid et de l'heure d'authentification Firebase. */
export function sessionIdFor(uid: string, authTime: number): string {
  return createHash('sha256').update(`${uid}:${authTime}`).digest('hex').slice(0, 32);
}

export function authTimeOf(request: CallableRequest<unknown>): number {
  const value = request.auth?.token.auth_time;
  return typeof value === 'number' ? value : 0;
}

let cachedPolicy: { at: number; value: SecurityPolicy } | null = null;
const POLICY_CACHE_MS = 15_000;

export async function loadSecurityPolicy(fresh = false): Promise<SecurityPolicy> {
  if (!fresh && cachedPolicy && Date.now() - cachedPolicy.at < POLICY_CACHE_MS) return cachedPolicy.value;
  const snap = await db.collection(COLLECTIONS.settings).doc(SETTINGS_DOCS.security).get();
  const value = { ...DEFAULT_SECURITY_POLICY, ...(snap.data() ?? {}) } as SecurityPolicy;
  cachedPolicy = { at: Date.now(), value };
  return value;
}

/** La double authentification est-elle exigée pour cet administrateur, maintenant ? */
export function mfaRequiredNow(policy: SecurityPolicy, admin: Pick<AdminUser, 'mfaEnrolled'>, now = Date.now()): boolean {
  if (admin.mfaEnrolled) return true;
  if (!policy.requireMfaForAdmins) return false;
  const from = policy.mfaEnforcedFrom?.toMillis?.() ?? null;
  return from === null || from <= now;
}

/**
 * Contrôle serveur : quand la double authentification est exigée, l'administrateur doit
 * être enrôlé et la session du jeton doit avoir validé un code (non révoquée, non expirée).
 * Renvoie l'identifiant de session.
 */
export async function assertAdminMfa(request: CallableRequest<unknown>, uid: string, admin: AdminUser): Promise<string> {
  const sessionId = sessionIdFor(uid, authTimeOf(request));
  const policy = await loadSecurityPolicy();
  if (!mfaRequiredNow(policy, admin)) return sessionId;
  if (!admin.mfaEnrolled) {
    throw fail.precondition('Activez la double authentification pour effectuer cette action.');
  }
  const snap = await db.collection(COLLECTIONS.adminSessions).doc(sessionId).get();
  const session = snap.data() as AdminSessionRecord | undefined;
  if (!session || session.revokedAt) throw fail.unauthenticated();
  if (session.expiresAt && session.expiresAt.toMillis() < Date.now()) throw fail.unauthenticated();
  if (!session.mfaVerifiedAt) throw fail.precondition('Confirmez votre code de double authentification pour continuer.');
  return sessionId;
}
