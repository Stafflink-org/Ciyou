// Tickets d'un établissement vers le support GoLink : ouverture (numérotation
// continue, délais cibles), réponses, pièces jointes, clôture et réouverture.
import {
  COLLECTIONS,
  SETTINGS_DOCS,
  SUBCOLLECTIONS,
  formatTicketNumber,
  type Order,
  type StoredFile,
  type SupportSettings,
  type SupportTicket,
  type TicketMessage,
  type TicketPriority,
  type TicketReason,
} from '@golink/shared';
import { db, FieldValue, Timestamp } from '../../lib/admin';
import { actorFromCaller, writeAudit } from '../../lib/audit';
import { callable } from '../../lib/callable';
import { fail } from '../../lib/errors';
import { requireRestaurantAccess } from '../../lib/permissions';
import { z, zId } from '../../lib/validation';
import { actorDisplayName, loadRestaurant } from '../../marketing/restaurant/helpers';

const MINUTE = 60_000;
const DAY = 86_400_000;

const DEFAULT_SLA: Pick<SupportSettings, 'firstResponseTargetMinutes' | 'resolutionTargetHours'> = {
  firstResponseTargetMinutes: { low: 240, normal: 60, high: 20, urgent: 5 },
  resolutionTargetHours: { low: 72, normal: 24, high: 8, urgent: 2 },
};

const attachmentSchema = z.object({
  path: z.string().min(1).max(300),
  contentType: z.string().regex(/^(image\/(jpeg|png|webp|heic)|application\/pdf)$/, 'Formats acceptés : images et PDF.'),
  size: z.number().int().min(1).max(10 * 1024 * 1024, 'Un fichier ne doit pas dépasser 10 Mo.'),
  name: z.string().max(200).nullable().default(null),
});

function preview(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > 140 ? `${flat.slice(0, 137)}…` : flat;
}

function toStored(files: Array<z.output<typeof attachmentSchema>>, ticketId: string, uid: string): StoredFile[] {
  const now = Timestamp.now();
  return files.map((file) => {
    if (!file.path.startsWith(`support/${ticketId}/`)) throw fail.invalid('Pièce jointe invalide.');
    return { ...file, url: null, uploadedAt: now, uploadedBy: uid };
  });
}

// ------------------------------------------------------------------ Ouverture

export const createSupportTicket = callable(
  z.object({
    restaurantId: zId,
    reasonId: zId,
    subject: z.string().trim().min(5, 'Précisez l’objet de votre demande.').max(120),
    body: z.string().trim().min(10, 'Décrivez votre demande en quelques phrases.').max(5000),
    orderId: zId.nullable().default(null),
    urgent: z.boolean().default(false),
  }),
  async (data, request) => {
    const actor = await requireRestaurantAccess(request, data.restaurantId, 'support.use');
    const restaurant = await loadRestaurant(data.restaurantId);
    const reasonSnap = await db.collection(COLLECTIONS.ticketReasons).doc(data.reasonId).get();
    const reason = reasonSnap.data() as TicketReason | undefined;
    if (!reason?.active || !reason.audience.includes('restaurant')) throw fail.invalid('Ce motif n’est pas disponible.');
    if (reason.requiresOrder && !data.orderId) throw fail.invalid('Ce motif nécessite de sélectionner la commande concernée.');
    if (data.orderId) {
      const order = (await db.collection(COLLECTIONS.orders).doc(data.orderId).get()).data() as Order | undefined;
      if (!order || order.restaurantId !== restaurant.id) throw fail.invalid('Cette commande n’appartient pas à votre établissement.');
    }

    const settings = (await db.collection(COLLECTIONS.settings).doc(SETTINGS_DOCS.support).get()).data() as SupportSettings | undefined;
    const priority: TicketPriority = data.urgent && ['low', 'normal'].includes(reason.defaultPriority) ? 'high' : reason.defaultPriority;
    const firstMinutes = settings?.firstResponseTargetMinutes?.[priority] ?? DEFAULT_SLA.firstResponseTargetMinutes[priority];
    const resolutionHours = settings?.resolutionTargetHours?.[priority] ?? DEFAULT_SLA.resolutionTargetHours[priority];
    const authorName = actorDisplayName(actor);
    const counterRef = db.collection(COLLECTIONS.counters).doc('tickets');
    const ticketRef = db.collection(COLLECTIONS.supportTickets).doc();

    const number = await db.runTransaction(async (tx) => {
      const counter = await tx.get(counterRef);
      const next = ((counter.get('value') as number | undefined) ?? 0) + 1;
      const ticketNumber = formatTicketNumber(next);
      const now = Timestamp.now();
      const ticket: SupportTicket = {
        number: ticketNumber,
        requesterType: 'restaurant',
        requesterId: actor.caller.uid,
        requesterName: `${restaurant.name} · ${authorName}`,
        restaurantId: restaurant.id,
        driverId: null,
        orderId: data.orderId,
        countryId: restaurant.countryId,
        cityId: restaurant.cityId,
        reasonId: data.reasonId,
        subject: data.subject,
        status: 'open',
        priority,
        channel: 'backoffice',
        assigneeId: null,
        escalated: false,
        escalatedTo: null,
        escalatedAt: null,
        firstResponseAt: null,
        firstResponseDueAt: Timestamp.fromMillis(now.toMillis() + firstMinutes * MINUTE),
        resolutionDueAt: Timestamp.fromMillis(now.toMillis() + resolutionHours * 60 * MINUTE),
        resolvedAt: null,
        closedAt: null,
        refundIds: [],
        compensationCents: 0,
        satisfaction: null,
        tags: [],
        lastMessageAt: now,
        lastMessagePreview: preview(data.body),
        unreadByRequester: 0,
        unreadBySupport: 1,
        createdAt: now,
        createdBy: actor.caller.uid,
        updatedAt: now,
        updatedBy: actor.caller.uid,
      };
      const message: TicketMessage = {
        authorType: 'requester',
        authorId: actor.caller.uid,
        authorName,
        body: data.body,
        internal: false,
        attachments: [],
        action: null,
        createdAt: now,
      };
      tx.set(counterRef, { value: next, prefix: 'T-', updatedAt: now }, { merge: true });
      tx.create(ticketRef, ticket);
      tx.create(ticketRef.collection(SUBCOLLECTIONS.supportTickets.messages).doc('m1'), message);
      return ticketNumber;
    });

    await writeAudit({
      actor: actorFromCaller(actor.caller, 'restaurant'),
      action: 'ticket.opened',
      target: { type: 'ticket', id: ticketRef.id, label: number },
      after: { reasonId: data.reasonId, priority, orderId: data.orderId },
      countryId: restaurant.countryId,
      cityId: restaurant.cityId,
      request,
    });
    return { ticketId: ticketRef.id, number, messageId: 'm1' };
  },
);

// ------------------------------------------------------------------ Réponse et pièces jointes

async function restaurantTicket(request: Parameters<typeof requireRestaurantAccess>[0], ticketId: string) {
  const ref = db.collection(COLLECTIONS.supportTickets).doc(ticketId);
  const ticket = (await ref.get()).data() as SupportTicket | undefined;
  if (!ticket || ticket.requesterType !== 'restaurant' || !ticket.restaurantId) throw fail.notFound('Ticket');
  const actor = await requireRestaurantAccess(request, ticket.restaurantId, 'support.use');
  return { ref, ticket, actor };
}

export const replyToSupportTicket = callable(
  z.object({
    ticketId: zId,
    body: z.string().trim().max(5000).default(''),
    attachments: z.array(attachmentSchema).max(5).default([]),
    /** Ajoute les pièces jointes à un message déjà envoyé (juste après l'ouverture du ticket). */
    appendToMessageId: zId.nullable().default(null),
  }),
  async (data, request) => {
    const { ref, ticket, actor } = await restaurantTicket(request, data.ticketId);
    const uid = actor.caller.uid;
    const attachments = toStored(data.attachments, data.ticketId, uid);

    if (data.appendToMessageId) {
      const messageRef = ref.collection(SUBCOLLECTIONS.supportTickets.messages).doc(data.appendToMessageId);
      const message = (await messageRef.get()).data() as TicketMessage | undefined;
      if (!message || message.authorId !== uid || Date.now() - message.createdAt.toMillis() > 15 * MINUTE) {
        throw fail.precondition('Ce message ne peut plus être complété : envoyez une nouvelle réponse.');
      }
      await messageRef.update({ attachments: FieldValue.arrayUnion(...attachments) });
      return { messageId: data.appendToMessageId };
    }

    if (!data.body && attachments.length === 0) throw fail.invalid('Écrivez un message ou joignez un fichier.');
    if (ticket.status === 'closed') throw fail.precondition('Ce ticket est fermé : rouvrez-le ou ouvrez une nouvelle demande.');
    const now = Timestamp.now();
    const message: TicketMessage = {
      authorType: 'requester',
      authorId: uid,
      authorName: actorDisplayName(actor),
      body: data.body || 'Pièce jointe',
      internal: false,
      attachments,
      action: null,
      createdAt: now,
    };
    const messageRef = ref.collection(SUBCOLLECTIONS.supportTickets.messages).doc();
    const nextStatus = ticket.status === 'waiting_customer' ? 'in_progress' : ticket.status === 'resolved' ? 'open' : ticket.status;
    await db.runTransaction(async (tx) => {
      tx.create(messageRef, message);
      tx.update(ref, {
        status: nextStatus,
        lastMessageAt: now,
        lastMessagePreview: preview(data.body || `${attachments.length} pièce(s) jointe(s)`),
        unreadBySupport: FieldValue.increment(1),
        unreadByRequester: 0,
        ...(nextStatus !== ticket.status ? { resolvedAt: null } : {}),
        updatedAt: now,
        updatedBy: uid,
      });
    });
    return { messageId: messageRef.id, status: nextStatus };
  },
);

export const updateSupportTicket = callable(
  z.object({ ticketId: zId, action: z.enum(['close', 'reopen']) }),
  async (data, request) => {
    const { ref, ticket, actor } = await restaurantTicket(request, data.ticketId);
    const now = Timestamp.now();
    const name = actorDisplayName(actor);
    let status: SupportTicket['status'];
    let body: string;
    if (data.action === 'close') {
      if (ticket.status === 'closed') throw fail.precondition('Ce ticket est déjà fermé.');
      status = 'closed';
      body = `${name} a fermé la demande depuis le back-office.`;
    } else {
      if (ticket.status !== 'closed' && ticket.status !== 'resolved') throw fail.precondition('Ce ticket est toujours en cours.');
      const closedAt = (ticket.closedAt ?? ticket.resolvedAt)?.toMillis() ?? 0;
      if (Date.now() - closedAt > 14 * DAY) throw fail.precondition('Ce ticket est fermé depuis plus de 14 jours : ouvrez une nouvelle demande.');
      status = 'open';
      body = `${name} a rouvert la demande.`;
    }
    const system: TicketMessage = {
      authorType: 'system',
      authorId: actor.caller.uid,
      authorName: 'GoLink',
      body,
      internal: false,
      attachments: [],
      action: { type: 'status_change', detail: status },
      createdAt: now,
    };
    await db.runTransaction(async (tx) => {
      tx.create(ref.collection(SUBCOLLECTIONS.supportTickets.messages).doc(), system);
      tx.update(ref, {
        status,
        ...(status === 'closed' ? { closedAt: now } : { closedAt: null, resolvedAt: null, unreadBySupport: FieldValue.increment(1) }),
        lastMessageAt: now,
        lastMessagePreview: body,
        updatedAt: now,
        updatedBy: actor.caller.uid,
      });
    });
    await writeAudit({
      actor: actorFromCaller(actor.caller, 'restaurant'),
      action: data.action === 'close' ? 'ticket.closed' : 'ticket.reopened',
      target: { type: 'ticket', id: ref.id, label: ticket.number },
      before: { status: ticket.status },
      after: { status },
      countryId: ticket.countryId,
      cityId: ticket.cityId ?? null,
      request,
    });
    return { status };
  },
);
