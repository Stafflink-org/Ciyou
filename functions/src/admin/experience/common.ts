// Outils communs du module « Expérience client et support » du super admin :
// options d'exécution, chargement des tickets, plafonds de remboursement,
// messages système et notifications.
import {
  COLLECTIONS,
  DEFAULT_REFUND_LIMITS,
  SETTINGS_DOCS,
  SUBCOLLECTIONS,
  type AdminRoleDefinition,
  type AdminUser,
  type SupportSettings,
  type SupportTicket,
  type TicketMessage,
  type TicketPriority,
  type UserNotification,
} from '@golink/shared';
import type { CallableOptions, CallableRequest } from 'firebase-functions/v2/https';
import type { DocumentReference, Transaction } from 'firebase-admin/firestore';
import type { z } from 'zod';
import { db, FieldValue, Timestamp } from '../../lib/admin';
import { callable } from '../../lib/callable';
import { fail } from '../../lib/errors';
import { assertAdminCovers } from '../../lib/permissions';

/** Instances bornées (quota de processeurs de la région). */
export const EXPERIENCE_RUNTIME = { maxInstances: 3, cpu: 'gcf_gen1' } as const;

export function experienceCallable<Schema extends z.ZodType, Result>(
  schema: Schema,
  handler: (data: z.output<Schema>, request: CallableRequest<unknown>) => Promise<Result>,
  options: CallableOptions = {},
) {
  return callable(schema, handler, { ...EXPERIENCE_RUNTIME, ...options });
}

export const MINUTE = 60_000;
export const OPEN_TICKET_STATUSES = ['open', 'in_progress', 'waiting_customer'] as const;

/** Délais cibles par défaut, si `settings/support` est absent. */
export const DEFAULT_SUPPORT_SLA: Pick<SupportSettings, 'firstResponseTargetMinutes' | 'resolutionTargetHours' | 'autoEscalateAfterMinutes'> = {
  firstResponseTargetMinutes: { low: 240, normal: 60, high: 20, urgent: 5 },
  resolutionTargetHours: { low: 72, normal: 24, high: 8, urgent: 2 },
  autoEscalateAfterMinutes: 45,
};

export async function loadSupportSettings(): Promise<typeof DEFAULT_SUPPORT_SLA & Partial<SupportSettings>> {
  const snap = await db.collection(COLLECTIONS.settings).doc(SETTINGS_DOCS.support).get();
  const data = (snap.data() ?? {}) as Partial<SupportSettings>;
  return {
    ...DEFAULT_SUPPORT_SLA,
    ...data,
    firstResponseTargetMinutes: { ...DEFAULT_SUPPORT_SLA.firstResponseTargetMinutes, ...(data.firstResponseTargetMinutes ?? {}) },
    resolutionTargetHours: { ...DEFAULT_SUPPORT_SLA.resolutionTargetHours, ...(data.resolutionTargetHours ?? {}) },
  };
}

/** Échéances d'un ticket selon sa priorité, à partir d'un instant donné. */
export function slaDeadlines(settings: typeof DEFAULT_SUPPORT_SLA, priority: TicketPriority, fromMillis: number) {
  return {
    firstResponseDueAt: Timestamp.fromMillis(fromMillis + settings.firstResponseTargetMinutes[priority] * MINUTE),
    resolutionDueAt: Timestamp.fromMillis(fromMillis + settings.resolutionTargetHours[priority] * 60 * MINUTE),
  };
}

export function ticketRef(ticketId: string): DocumentReference {
  return db.collection(COLLECTIONS.supportTickets).doc(ticketId);
}

export function newMessageRef(ticketId: string): DocumentReference {
  return ticketRef(ticketId).collection(SUBCOLLECTIONS.supportTickets.messages).doc();
}

/** Ticket existant, dans le périmètre géographique de l'administrateur. */
export async function loadTicketFor(admin: AdminUser, ticketId: string): Promise<SupportTicket> {
  const snap = await ticketRef(ticketId).get();
  if (!snap.exists) throw fail.notFound('Ticket');
  const ticket = snap.data() as SupportTicket;
  if (ticket.cityId) assertAdminCovers(admin, ticket.cityId);
  return ticket;
}

export function preview(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > 140 ? `${flat.slice(0, 137)}…` : flat;
}

/** Nom affiché d'un agent côté demandeur : prénom + « support GoLink ». */
export function agentPublicName(admin: AdminUser): string {
  const first = admin.displayName.split(' ')[0] || admin.displayName;
  return `${first} (support GoLink)`;
}

export function addTicketMessage(tx: Transaction, ticketId: string, message: Omit<TicketMessage, 'createdAt'>, at: Timestamp): DocumentReference {
  const ref = newMessageRef(ticketId);
  tx.create(ref, { ...message, createdAt: at });
  return ref;
}

/** Message système (journal des actions) visible ou non du demandeur. */
export function systemMessage(
  admin: AdminUser,
  uid: string,
  body: string,
  action: TicketMessage['action'],
  internal = true,
): Omit<TicketMessage, 'createdAt'> {
  return { authorType: 'system', authorId: uid, authorName: admin.displayName, body, internal, attachments: [], action };
}

/** Montant maximal d'un avoir manuel (settings/refunds.maxCreditCents, 500 € par défaut). */
export const DEFAULT_MAX_CREDIT_CENTS = 50_000;

/**
 * Règle UNIQUE de plafond, utilisée par les remboursements de ticket, leur validation,
 * les avoirs de ticket et les avoirs client. Un montant au-delà du plafond n'est jamais
 * exécuté par la même personne : remboursement = demande de validation d'un responsable,
 * avoir = refus avec renvoi vers un responsable dont le plafond est suffisant.
 *
 * Plafond = plafond propre à l'agent (s'il est posé), sinon plafond de son rôle
 * (adminRoles, paramétrable), sinon valeur par défaut ; le seuil de validation de la
 * plateforme (settings/refunds.approvalThresholdCents) borne le plafond du rôle.
 * Le super administrateur n'a pas de plafond.
 */
export async function refundLimitOf(admin: AdminUser): Promise<number> {
  if (admin.role === 'super_admin') return Number.MAX_SAFE_INTEGER;
  if (typeof admin.refundLimitCents === 'number') return admin.refundLimitCents;
  const role = (await db.collection(COLLECTIONS.adminRoles).doc(admin.role).get()).data() as AdminRoleDefinition | undefined;
  const roleLimit = role?.defaultRefundLimitCents ?? DEFAULT_REFUND_LIMITS[admin.role];
  const threshold = ((await db.collection(COLLECTIONS.settings).doc(SETTINGS_DOCS.refunds).get()).get('approvalThresholdCents') as number | undefined) ?? 0;
  return threshold > 0 ? Math.min(roleLimit, threshold) : roleLimit;
}

/** Plafond d'un avoir manuel. */
export async function maxCreditOf(): Promise<number> {
  const value = (await db.collection(COLLECTIONS.settings).doc(SETTINGS_DOCS.refunds).get()).get('maxCreditCents') as number | undefined;
  return typeof value === 'number' && value > 0 ? value : DEFAULT_MAX_CREDIT_CENTS;
}

/** Notification in-app (centre de notifications de l'utilisateur). */
export async function notify(uid: string | null | undefined, notification: Pick<UserNotification, 'title' | 'body' | 'category' | 'link'>): Promise<void> {
  if (!uid || uid === 'system') return;
  await db
    .collection(COLLECTIONS.users)
    .doc(uid)
    .collection(SUBCOLLECTIONS.users.notifications)
    .add({ ...notification, read: false, readAt: null, createdAt: FieldValue.serverTimestamp() });
}

/** Destinataires côté commerce : propriétaire et membres actifs ayant accès au support. */
export async function restaurantRecipients(restaurantId: string): Promise<string[]> {
  const snap = await db.collection(COLLECTIONS.restaurants).doc(restaurantId).collection(SUBCOLLECTIONS.restaurants.members).where('active', '==', true).get();
  return snap.docs
    .filter((d) => d.get('role') === 'owner' || ((d.get('permissions') as string[] | undefined) ?? []).includes('support.use'))
    .map((d) => d.id);
}

export function euros(cents: number): string {
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(cents / 100);
}

/** Jour calendaire de Paris (AAAA-MM-JJ). */
export function parisDay(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}
