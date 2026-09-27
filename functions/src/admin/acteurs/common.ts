// Outils communs de l'administration des acteurs (restaurants et clients) :
// options d'exécution, chargement avec contrôle du périmètre, notifications au
// propriétaire et e-mails (jamais envoyés pour les données de démonstration).
import { COLLECTIONS, type AdminUser, type EntityRef, type PlatformMessageKey, type Restaurant, type UserNotification } from '@golink/shared';
import { sendPlatformMessage } from '../../notifications/messages';
import type { CallableOptions, CallableRequest } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';
import type { z } from 'zod';
import { db, FieldValue } from '../../lib/admin';
import { actorFromCaller, writeAudit, type AuditActor } from '../../lib/audit';
import { sendEmail } from '../../lib/brevo';
import { callable } from '../../lib/callable';
import type { EmailMessage } from '../../lib/emails';
import { fail } from '../../lib/errors';
import { assertAdminCovers, type Caller } from '../../lib/permissions';

/** Instances bornées (quota de processeurs de la région partagé par toutes les fonctions). */
export const ACTEURS_RUNTIME = { maxInstances: 3, cpu: 'gcf_gen1', invoker: 'public' } as const;
export const ACTEURS_HEAVY_RUNTIME = { maxInstances: 2, memory: '512MiB', timeoutSeconds: 300 } as const;
export const ACTEURS_SCHEDULE_RUNTIME = { maxInstances: 1, memory: '512MiB', timeoutSeconds: 540, retryCount: 0 } as const;
export const TIMEZONE = 'Europe/Paris';

export function acteursCallable<Schema extends z.ZodType, Result>(
  schema: Schema,
  handler: (data: z.output<Schema>, request: CallableRequest<unknown>) => Promise<Result>,
  options: CallableOptions = {},
) {
  return callable(schema, handler, { ...ACTEURS_RUNTIME, ...options });
}

export type RestaurantWithRef = { id: string; data: Restaurant; ref: FirebaseFirestore.DocumentReference };

export function restaurantDoc(id: string): FirebaseFirestore.DocumentReference {
  return db.collection(COLLECTIONS.restaurants).doc(id);
}

/** Charge un restaurant et vérifie qu'il est dans le périmètre de l'administrateur. */
export async function loadRestaurantFor(admin: AdminUser, restaurantId: string): Promise<RestaurantWithRef> {
  const ref = restaurantDoc(restaurantId);
  const snap = await ref.get();
  if (!snap.exists) throw fail.notFound('Restaurant');
  const data = snap.data() as Restaurant;
  if (data.deletedAt) throw fail.precondition('Ce restaurant a été supprimé.');
  assertAdminCovers(admin, data.cityId);
  return { id: snap.id, data, ref };
}

export function restaurantTarget(id: string, restaurant: Pick<Restaurant, 'name'>): EntityRef {
  return { type: 'restaurant', id, label: restaurant.name };
}

export function adminActor(caller: Caller): AuditActor {
  return actorFromCaller(caller, 'admin');
}

/** Données de démonstration ou de test : aucun e-mail réel n'est envoyé (mode simulation). */
export function isDemoData(doc: Record<string, unknown> | undefined | null): boolean {
  return Boolean(doc && (doc.seed === true || doc.test === true));
}

/** Adresse sans destinataire réel possible (domaines réservés aux tests). */
export function isReservedAddress(email: string | null | undefined): boolean {
  if (!email) return true;
  const domain = email.split('@')[1]?.toLowerCase() ?? '';
  return domain.endsWith('.test') || domain.endsWith('.example') || domain.endsWith('.invalid') || domain.endsWith('.localhost');
}

export interface DeliveryResult {
  notified: boolean;
  emailSent: boolean;
  emailSimulated: boolean;
}

/**
 * Prévient le propriétaire d'un restaurant : notification dans le back-office
 * (boîte de réception) et e-mail. En données de démonstration, l'e-mail est simulé.
 */
export async function notifyRestaurantOwner(
  restaurant: RestaurantWithRef,
  input: {
    title: string;
    body: string;
    category: UserNotification['category'];
    email?: EmailMessage | null;
    templateKey: string;
    /**
     * Message automatique du super admin (gabarit `messageTemplates`) : remplace le titre,
     * le texte et l'e-mail ci-dessus, lit le gabarit modifiable et respecte l'envoi réel ou simulé.
     */
    message?: { key: PlatformMessageKey; values: Record<string, string | number | null | undefined>; dedupeKey: string };
  },
): Promise<DeliveryResult> {
  const result: DeliveryResult = { notified: false, emailSent: false, emailSimulated: false };
  const ownerId = restaurant.data.ownerId;
  if (!ownerId) return result;
  if (input.message) {
    const owner = await db.collection(COLLECTIONS.users).doc(ownerId).get();
    const sent = await sendPlatformMessage(
      input.message.key,
      { uid: ownerId, type: 'restaurant', email: (owner.get('email') as string | undefined) ?? restaurant.data.email ?? null, demo: isDemoData(restaurant.data as unknown as Record<string, unknown>) },
      input.message.values,
      { dedupeKey: input.message.dedupeKey, link: { type: 'page', target: '/' } },
    );
    result.notified = sent.channels.in_app === 'delivered';
    result.emailSent = sent.channels.email === 'delivered';
    result.emailSimulated = sent.channels.email === 'simulated';
    return result;
  }
  try {
    await db
      .collection(COLLECTIONS.users)
      .doc(ownerId)
      .collection('notifications')
      .add({
        title: input.title,
        body: input.body,
        category: input.category,
        link: { type: 'page', target: '/' },
        read: false,
        readAt: null,
        createdAt: FieldValue.serverTimestamp(),
      });
    result.notified = true;
  } catch (error) {
    logger.warn('Notification propriétaire non écrite', { restaurantId: restaurant.id, error: String(error) });
  }
  if (!input.email) return result;
  const owner = await db.collection(COLLECTIONS.users).doc(ownerId).get();
  const email = (owner.get('email') as string | undefined) ?? restaurant.data.email ?? null;
  const demo = isDemoData(restaurant.data as unknown as Record<string, unknown>) || isDemoData(owner.data());
  if (!email || demo) {
    result.emailSimulated = true;
    logger.info('E-mail simulé (données de démonstration)', { restaurantId: restaurant.id, templateKey: input.templateKey });
    return result;
  }
  const sent = await sendEmail({
    to: { email, name: (owner.get('displayName') as string | undefined) ?? null },
    message: input.email,
    recipientType: 'restaurant',
    recipientId: restaurant.id,
    templateKey: input.templateKey,
  });
  result.emailSent = sent.ok;
  return result;
}

/** Entrée d'audit d'une action d'administrateur sur un restaurant. */
export async function auditRestaurant(
  caller: Caller,
  restaurant: RestaurantWithRef,
  action: string,
  input: { reason?: string | null; before?: Record<string, unknown> | null; after?: Record<string, unknown> | null; sensitive?: boolean; request?: CallableRequest<unknown> },
): Promise<string> {
  return writeAudit({
    actor: adminActor(caller),
    action,
    target: restaurantTarget(restaurant.id, restaurant.data),
    reason: input.reason ?? null,
    before: input.before ?? null,
    after: input.after ?? null,
    countryId: restaurant.data.countryId,
    cityId: restaurant.data.cityId,
    sensitive: input.sensitive ?? false,
    request: input.request,
  });
}

/** Date AAAA-MM-JJ du jour à Paris. */
export function parisDay(date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

export function addDaysIso(day: string, days: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Découpe une liste en paquets (écritures par lots, requêtes `in`). */
export function chunks<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
