// Outils communs de l'exploitation (livreurs, attribution, règles, zones) : options
// d'exécution, chargement avec contrôle du périmètre, historique des réglages,
// notifications aux livreurs et e-mails (simulés pour les données de démonstration).
import { COLLECTIONS, type AdminUser, type Driver, type EntityRef, type PlatformMessageKey, type SettingsHistoryEntry, type UserNotification } from '@golink/shared';
import { sendPlatformMessage } from '../../notifications/messages';
import type { CallableOptions, CallableRequest } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';
import type { z } from 'zod';
import { db, FieldValue } from '../../lib/admin';
import { actorFromCaller, writeAudit } from '../../lib/audit';
import { sendEmail } from '../../lib/brevo';
import { callable } from '../../lib/callable';
import type { EmailMessage } from '../../lib/emails';
import { fail } from '../../lib/errors';
import { assertAdminCovers, type Caller } from '../../lib/permissions';

/** Instances bornées : le quota de processeurs de la région est partagé par toutes les fonctions. */
export const OPS_RUNTIME = { maxInstances: 1, cpu: 'gcf_gen1', memory: '256MiB' } as const;
export const OPS_HEAVY_RUNTIME = { maxInstances: 1, memory: '512MiB', timeoutSeconds: 120 } as const;
export const OPS_SCHEDULE_RUNTIME = { maxInstances: 1, timeoutSeconds: 120, retryCount: 0, cpu: 'gcf_gen1', memory: '256MiB' } as const;
export const TIMEZONE = 'Europe/Paris';

export function opsCallable<Schema extends z.ZodType, Result>(
  schema: Schema,
  handler: (data: z.output<Schema>, request: CallableRequest<unknown>) => Promise<Result>,
  options: CallableOptions = {},
) {
  return callable(schema, handler, { ...OPS_RUNTIME, ...options });
}

export interface DriverWithRef {
  id: string;
  data: Driver;
  ref: FirebaseFirestore.DocumentReference;
}

export function driverRef(id: string): FirebaseFirestore.DocumentReference {
  return db.collection(COLLECTIONS.drivers).doc(id);
}

/** Charge un livreur et vérifie qu'il est dans le périmètre de l'administrateur. */
export async function loadDriverFor(admin: AdminUser, driverId: string): Promise<DriverWithRef> {
  const ref = driverRef(driverId);
  const snap = await ref.get();
  if (!snap.exists) throw fail.notFound('Livreur');
  const data = snap.data() as Driver;
  if (data.deletedAt) throw fail.precondition('Ce livreur a été supprimé.');
  assertAdminCovers(admin, data.cityId);
  return { id: snap.id, data, ref };
}

export function driverTarget(id: string, driver: Pick<Driver, 'displayName' | 'firstName' | 'lastName'>): EntityRef {
  return { type: 'driver', id, label: driver.displayName || `${driver.firstName} ${driver.lastName}` };
}

/** Entrée d'audit d'une action d'administrateur sur un livreur. */
export function auditDriver(
  caller: Caller,
  driver: DriverWithRef,
  action: string,
  input: { reason?: string | null; before?: Record<string, unknown> | null; after?: Record<string, unknown> | null; sensitive?: boolean; request?: CallableRequest<unknown> },
): Promise<string> {
  return writeAudit({
    actor: actorFromCaller(caller, 'admin'),
    action,
    target: driverTarget(driver.id, driver.data),
    reason: input.reason ?? null,
    before: input.before ?? null,
    after: input.after ?? null,
    countryId: driver.data.countryId,
    cityId: driver.data.cityId,
    sensitive: input.sensitive ?? false,
    request: input.request,
  });
}

/** Données de démonstration ou de test : aucun e-mail réel n'est envoyé. */
export function isDemoData(doc: Record<string, unknown> | undefined | null): boolean {
  return Boolean(doc && (doc.seed === true || doc.test === true));
}

/** Adresse sans destinataire réel possible (domaines réservés aux tests). */
export function isReservedAddress(email: string | null | undefined): boolean {
  if (!email) return true;
  const domain = email.split('@')[1]?.toLowerCase() ?? '';
  return domain.endsWith('.test') || domain.endsWith('.example') || domain.endsWith('.invalid') || domain.endsWith('.localhost');
}

/**
 * Prévient un livreur : notification dans son application et, si fourni, e-mail
 * (simulé pour les données de démonstration et les adresses réservées aux tests).
 */
export async function notifyDriver(
  driver: { id: string; data: Driver },
  input: {
    title: string;
    body: string;
    category: UserNotification['category'];
    email?: EmailMessage | null;
    templateKey: string;
    /** Message automatique du super admin (gabarit modifiable, envoi réel ou simulé) : remplace titre, texte et e-mail. */
    message?: { key: PlatformMessageKey; values: Record<string, string | number | null | undefined>; dedupeKey: string };
  },
): Promise<{ notified: boolean; emailSent: boolean }> {
  const result = { notified: false, emailSent: false };
  if (input.message) {
    const sent = await sendPlatformMessage(
      input.message.key,
      { uid: driver.id, type: 'driver', email: driver.data.email, name: driver.data.displayName, demo: isDemoData(driver.data as unknown as Record<string, unknown>) },
      input.message.values,
      { dedupeKey: input.message.dedupeKey },
    );
    return { notified: sent.channels.in_app === 'delivered', emailSent: sent.channels.email === 'delivered' };
  }
  try {
    await db.collection(COLLECTIONS.users).doc(driver.id).collection('notifications').add({
      title: input.title,
      body: input.body,
      category: input.category,
      link: null,
      read: false,
      readAt: null,
      createdAt: FieldValue.serverTimestamp(),
    });
    result.notified = true;
  } catch (error) {
    logger.warn('Notification livreur non écrite', { driverId: driver.id, error: String(error) });
  }
  if (!input.email) return result;
  if (isDemoData(driver.data as unknown as Record<string, unknown>) || isReservedAddress(driver.data.email)) {
    logger.info('E-mail simulé (données de démonstration)', { driverId: driver.id, templateKey: input.templateKey });
    return result;
  }
  const sent = await sendEmail({
    to: { email: driver.data.email, name: driver.data.displayName },
    message: input.email,
    recipientType: 'driver',
    recipientId: driver.id,
    templateKey: input.templateKey,
  });
  result.emailSent = sent.ok;
  return result;
}

/** Champs de premier niveau modifiés entre deux états. */
export function changedFields(before: Record<string, unknown> | null | undefined, after: Record<string, unknown> | null | undefined): string[] {
  const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);
  return [...keys].filter((key) => JSON.stringify((before ?? {})[key] ?? null) !== JSON.stringify((after ?? {})[key] ?? null)).sort();
}

/** Supprime les horodatages Firestore et les métadonnées pour un historique lisible. */
export function plain(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object') return {};
  const { updatedAt: _u, updatedBy: _b, createdAt: _c, createdBy: _cb, seed: _s, ...rest } = value as Record<string, unknown>;
  return JSON.parse(JSON.stringify(rest)) as Record<string, unknown>;
}

/** Historise une modification de réglage (settingsHistory, non modifiable). */
export async function writeSettingsHistory(input: {
  docPath: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  reason: string | null;
  caller: Caller;
  /** Ville concernée (réglage scopé à une ville) : borne la lecture aux admins de cette ville (règles Firestore). */
  cityId?: string | null;
}): Promise<string[]> {
  const fields = changedFields(input.before, input.after);
  if (fields.length === 0) return fields;
  const pick = (source: Record<string, unknown> | null) => Object.fromEntries(fields.map((f) => [f, (source ?? {})[f] ?? null]));
  const entry: Omit<SettingsHistoryEntry, 'changedAt'> & { changedAt: FieldValue; changedByName: string } = {
    docPath: input.docPath,
    changedFields: fields,
    before: pick(input.before),
    after: pick(input.after),
    reason: input.reason,
    changedBy: input.caller.uid,
    changedByName: input.caller.name,
    changedAt: FieldValue.serverTimestamp(),
    cityId: input.cityId ?? null,
  };
  await db.collection(COLLECTIONS.settingsHistory).add(entry);
  return fields;
}

/** Date calendaire du jour à Paris (AAAA-MM-JJ). */
export function parisDay(date: Date = new Date()): string {
  return new Intl.DateTimeFormat('fr-CA', { timeZone: TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

/** Ajoute des jours à une date calendaire. */
export function addDays(day: string, days: number): string {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d + days));
  return date.toISOString().slice(0, 10);
}
