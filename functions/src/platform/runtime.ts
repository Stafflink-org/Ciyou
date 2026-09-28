// Outils communs du domaine « Plateforme & sécurité » : options d'exécution, contrôle
// d'accès renforcé (double authentification de la session), historique des réglages,
// alertes de sécurité et empreintes.
import { createHash } from 'node:crypto';
import {
  COLLECTIONS,
  type AdminPermission,
  type AdminUser,
  type SecurityAlert,
  type SecurityAlertType,
  type SettingsHistoryEntry,
} from '@golink/shared';
import { defineSecret } from 'firebase-functions/params';
import type { CallableOptions, CallableRequest } from 'firebase-functions/v2/https';
import type { z } from 'zod';
import { db, FieldValue } from '../lib/admin';
import { callable } from '../lib/callable';
import { requireAdmin, type Caller } from '../lib/permissions';

/** Clé de chiffrement des secrets TOTP (32 octets en base64). */
export const TOTP_ENCRYPTION_KEY = defineSecret('TOTP_ENCRYPTION_KEY');

/** Instances bornées : le quota de processeurs de la région est partagé par toutes les fonctions. */
export const PLATFORM_RUNTIME = { maxInstances: 2, cpu: 'gcf_gen1', memory: '256MiB' } as const;
export const PLATFORM_HEAVY_RUNTIME = { maxInstances: 1, memory: '512MiB', timeoutSeconds: 300 } as const;
export const PLATFORM_SCHEDULE_RUNTIME = { maxInstances: 1, timeoutSeconds: 300, retryCount: 0, memory: '512MiB' } as const;
export const TIMEZONE = 'Europe/Paris';

export function platformCallable<Schema extends z.ZodType, Result>(
  schema: Schema,
  handler: (data: z.output<Schema>, request: CallableRequest<unknown>) => Promise<Result>,
  options: CallableOptions = {},
) {
  return callable(schema, handler, { ...PLATFORM_RUNTIME, ...options });
}

// ------------------------------------------------------------------ Sessions et double authentification

export { authTimeOf, loadSecurityPolicy, mfaRequiredNow, sessionIdFor } from '../lib/mfa';

/**
 * Administrateur actif, avec la permission demandée, dont la session a validé la
 * double authentification quand elle est exigée. Utilisé par les actions sensibles
 * de la plateforme (rôles, sessions, maintenance, sauvegardes, RGPD…).
 */
export async function requireSecureAdmin(
  request: CallableRequest<unknown>,
  permission?: AdminPermission,
): Promise<{ caller: Caller; admin: AdminUser; sessionId: string }> {
  const { caller, admin, sessionId } = await requireAdmin(request, permission);
  return { caller, admin, sessionId: sessionId ?? '' };
}

// ------------------------------------------------------------------ Historique et alertes

function changedKeys(before: Record<string, unknown> | null, after: Record<string, unknown> | null): string[] {
  const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);
  return [...keys]
    .filter((key) => !['updatedAt', 'updatedBy', 'createdAt', 'createdBy', 'seed'].includes(key))
    .filter((key) => JSON.stringify((before ?? {})[key] ?? null) !== JSON.stringify((after ?? {})[key] ?? null))
    .sort();
}

/** Valeur JSON pure (horodatages Firestore convertis en millisecondes). */
export function plainValue(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === 'object' && value !== null && 'toMillis' in value && typeof (value as { toMillis: unknown }).toMillis === 'function') {
    return (value as { toMillis: () => number }).toMillis();
  }
  if (Array.isArray(value)) return value.map(plainValue);
  if (typeof value === 'object') return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, plainValue(v)]));
  return value;
}

/**
 * Historise une modification (settingsHistory, non modifiable) avec l'ancienne et
 * la nouvelle valeur de chaque champ modifié. Renvoie les champs modifiés.
 */
export async function recordSettingsChange(input: {
  docPath: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  reason: string | null;
  caller: Caller;
}): Promise<{ fields: string[]; before: Record<string, unknown>; after: Record<string, unknown> }> {
  const fields = changedKeys(input.before, input.after);
  const pick = (source: Record<string, unknown> | null) => Object.fromEntries(fields.map((f) => [f, plainValue((source ?? {})[f])]));
  const before = pick(input.before);
  const after = pick(input.after);
  if (fields.length === 0) return { fields, before, after };
  const entry: Omit<SettingsHistoryEntry, 'changedAt'> & { changedAt: FieldValue; changedByName: string } = {
    docPath: input.docPath,
    changedFields: fields,
    before,
    after,
    reason: input.reason,
    changedBy: input.caller.uid,
    changedByName: input.caller.name,
    changedAt: FieldValue.serverTimestamp(),
  };
  await db.collection(COLLECTIONS.settingsHistory).add(entry);
  return { fields, before, after };
}

/** Lève une alerte de sécurité (securityAlerts). */
export async function raiseSecurityAlert(input: {
  type: SecurityAlertType;
  adminId?: string | null;
  severity: SecurityAlert['severity'];
  details: string;
}): Promise<void> {
  await db.collection(COLLECTIONS.securityAlerts).add({
    type: input.type,
    adminId: input.adminId ?? null,
    severity: input.severity,
    details: input.details,
    status: 'open',
    detectedAt: FieldValue.serverTimestamp(),
    handledBy: null,
    handledAt: null,
  });
}

/** Empreinte SHA-256 d'une valeur normalisée (liste de blocage, codes de secours). */
export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/** Adresse IP hachée (jamais stockée en clair). */
export function ipHashOf(request: CallableRequest<unknown>): string | null {
  const ip = request.rawRequest?.ip;
  return ip ? sha256(ip).slice(0, 32) : null;
}

/**
 * Localisation approximative de la session (§27 « localisation approximative »), déduite des
 * en-têtes posés par l'infrastructure Google (front-end commun aux fonctions et à l'hébergement),
 * jamais d'un appel externe ni d'une adresse IP en clair. Absente si l'en-tête n'est pas transmis
 * (environnement de test, émulateur) : dans ce cas la session garde une localisation inconnue
 * plutôt qu'une valeur inventée.
 */
export function approximateLocationOf(request: CallableRequest<unknown>): string | null {
  const country = request.rawRequest?.get('x-appengine-country');
  const region = request.rawRequest?.get('x-appengine-region');
  const city = request.rawRequest?.get('x-appengine-city');
  if (!country || country === 'ZZ') return null;
  const parts = [city ? city.replace(/\b\w/g, (c) => c.toUpperCase()) : null, region ? region.toUpperCase() : null, country.toUpperCase()].filter(Boolean);
  return parts.length ? parts.join(', ') : null;
}

/** Appareil lisible déduit du navigateur (« Windows · Chrome »). */
export function describeDevice(userAgent: string): string {
  const ua = userAgent.toLowerCase();
  const os = ua.includes('iphone') ? 'iPhone' : ua.includes('ipad') ? 'iPad' : ua.includes('android') ? 'Android' : ua.includes('mac os') ? 'Mac' : ua.includes('windows') ? 'Windows' : ua.includes('linux') ? 'Linux' : 'Appareil inconnu';
  const browser = ua.includes('edg/') ? 'Edge' : ua.includes('firefox') ? 'Firefox' : ua.includes('chrome') ? 'Chrome' : ua.includes('safari') ? 'Safari' : 'Navigateur';
  return `${os} · ${browser}`;
}
