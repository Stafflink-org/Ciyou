// Tickets d'un livreur vers le support Ciyou Eats : ouverture, réponses, clôture
// et réouverture. Miroir de `messaging/client/support.ts`, adapté au livreur
// (motif « course » au lieu de « commande », pas d'accès restaurant à vérifier :
// le livreur n'agit que sur ses propres courses et son propre fil de discussion).
import { COLLECTIONS, SETTINGS_DOCS, SUBCOLLECTIONS, formatTicketNumber, type Driver, type Order, type SupportSettings, type SupportTicket, type TicketMessage, type TicketPriority } from '@golink/shared';
import { db, FieldValue, Timestamp } from '../../lib/admin';
import { actorFromCaller, writeAudit } from '../../lib/audit';
import { callable } from '../../lib/callable';
import { fail } from '../../lib/errors';
import { requireAuth } from '../../lib/permissions';
import { z, zId } from '../../lib/validation';

const MINUTE = 60_000;
const DAY = 86_400_000;

/** Motif fixe des tickets ouverts par un livreur (même principe que
 * `CLIENT_TICKET_REASON_ID` côté client et `reportOrderIssue` côté restaurant). */
export const DRIVER_TICKET_REASON_ID = 'driver-support';

const DRIVER_TICKET_CATEGORIES = ['delivery', 'account', 'payment', 'vehicle', 'other'] as const;
const CATEGORY_LABELS: Record<(typeof DRIVER_TICKET_CATEGORIES)[number], string> = {
  delivery: 'Une course',
  account: 'Mon compte',
  payment: 'Mes gains',
  vehicle: 'Mon véhicule ou mes documents',
  other: 'Autre',
};

const DEFAULT_SLA: Pick<SupportSettings, 'firstResponseTargetMinutes' | 'resolutionTargetHours'> = {
  firstResponseTargetMinutes: { low: 240, normal: 60, high: 20, urgent: 5 },
  resolutionTargetHours: { low: 72, normal: 24, high: 8, urgent: 2 },
};

function preview(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > 140 ? `${flat.slice(0, 137)}…` : flat;
}

// ------------------------------------------------------------------ Ouverture

export const createDriverTicket = callable(
  z.object({
    category: z.enum(DRIVER_TICKET_CATEGORIES),
    subject: z.string().trim().min(5, 'Précisez l’objet de votre demande.').max(120),
    body: z.string().trim().min(10, 'Décrivez votre demande en quelques phrases.').max(5000),
    orderId: zId.nullable().default(null),
  }),
  async (data, request) => {
    const caller = requireAuth(request);
    const meSnap = await db.collection(COLLECTIONS.drivers).doc(caller.uid).get();
    const me = meSnap.data() as Driver | undefined;
    if (!me) throw fail.notFound('Compte');

    let order: (Order & { id: string }) | null = null;
    if (data.orderId) {
      const orderSnap = await db.collection(COLLECTIONS.orders).doc(data.orderId).get();
      const found = orderSnap.data() as Order | undefined;
      if (!found || found.driverId !== caller.uid) throw fail.invalid('Cette course ne correspond pas à votre compte.');
      order = { ...found, id: orderSnap.id };
    }

    const settings = (await db.collection(COLLECTIONS.settings).doc(SETTINGS_DOCS.support).get()).data() as SupportSettings | undefined;
    const priority: TicketPriority = data.category === 'delivery' && order && !['delivered', 'cancelled'].includes(order.status) ? 'high' : 'normal';
    const firstMinutes = settings?.firstResponseTargetMinutes?.[priority] ?? DEFAULT_SLA.firstResponseTargetMinutes[priority];
    const resolutionHours = settings?.resolutionTargetHours?.[priority] ?? DEFAULT_SLA.resolutionTargetHours[priority];
    const authorName = me.displayName || caller.name;
    const counterRef = db.collection(COLLECTIONS.counters).doc('tickets');
    const ticketRef = db.collection(COLLECTIONS.supportTickets).doc();

    const result = await db.runTransaction(async (tx) => {
      const counter = await tx.get(counterRef);
      const next = ((counter.get('value') as number | undefined) ?? 0) + 1;
      const number = formatTicketNumber(next);
      const now = Timestamp.now();
      const ticket: SupportTicket = {
        number,
        requesterType: 'driver',
        requesterId: caller.uid,
        requesterName: authorName,
        orderId: order?.id ?? null,
        countryId: order?.countryId ?? me.countryId ?? 'FR',
        cityId: order?.cityId ?? me.cityId ?? null,
        reasonId: DRIVER_TICKET_REASON_ID,
        subject: `${CATEGORY_LABELS[data.category]} · ${data.subject}`,
        status: 'open',
        priority,
        channel: 'app',
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
        tags: ['driver', data.category],
        lastMessageAt: now,
        lastMessagePreview: preview(data.body),
        unreadByRequester: 0,
        unreadBySupport: 1,
        createdAt: now,
        createdBy: caller.uid,
        updatedAt: now,
        updatedBy: caller.uid,
      };
      const message: TicketMessage = {
        authorType: 'requester',
        authorId: caller.uid,
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
      return { number };
    });

    await writeAudit({
      actor: actorFromCaller(caller, 'driver'),
      action: 'ticket.opened',
      target: { type: 'ticket', id: ticketRef.id, label: result.number },
      after: { reasonId: DRIVER_TICKET_REASON_ID, priority, orderId: order?.id ?? null, category: data.category },
      countryId: order?.countryId ?? me.countryId ?? 'FR',
      cityId: order?.cityId ?? me.cityId ?? null,
      request,
    });
    return { ticketId: ticketRef.id, number: result.number };
  },
);

// ------------------------------------------------------------------ Réponse

async function driverTicket(uid: string, ticketId: string) {
  const ref = db.collection(COLLECTIONS.supportTickets).doc(ticketId);
  const ticket = (await ref.get()).data() as SupportTicket | undefined;
  if (!ticket || ticket.requesterType !== 'driver' || ticket.requesterId !== uid) throw fail.notFound('Ticket');
  return { ref, ticket };
}

export const replyToDriverTicket = callable(
  z.object({ ticketId: zId, body: z.string().trim().min(1).max(5000) }),
  async (data, request) => {
    const caller = requireAuth(request);
    const { ref, ticket } = await driverTicket(caller.uid, data.ticketId);
    if (ticket.status === 'closed') throw fail.precondition('Ce ticket est fermé : rouvrez-le ou ouvrez une nouvelle demande.');
    const now = Timestamp.now();
    const message: TicketMessage = {
      authorType: 'requester',
      authorId: caller.uid,
      authorName: ticket.requesterName,
      body: data.body,
      internal: false,
      attachments: [],
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
        lastMessagePreview: preview(data.body),
        unreadBySupport: FieldValue.increment(1),
        unreadByRequester: 0,
        ...(nextStatus !== ticket.status ? { resolvedAt: null } : {}),
        updatedAt: now,
        updatedBy: caller.uid,
      });
    });
    return { messageId: messageRef.id, status: nextStatus };
  },
);

export const updateDriverTicket = callable(
  z.object({ ticketId: zId, action: z.enum(['close', 'reopen']) }),
  async (data, request) => {
    const caller = requireAuth(request);
    const { ref, ticket } = await driverTicket(caller.uid, data.ticketId);
    const now = Timestamp.now();
    let status: SupportTicket['status'];
    let body: string;
    if (data.action === 'close') {
      if (ticket.status === 'closed') throw fail.precondition('Ce ticket est déjà fermé.');
      status = 'closed';
      body = `${ticket.requesterName} a fermé la demande.`;
    } else {
      if (ticket.status !== 'closed' && ticket.status !== 'resolved') throw fail.precondition('Ce ticket est toujours en cours.');
      const closedAt = (ticket.closedAt ?? ticket.resolvedAt)?.toMillis() ?? 0;
      if (Date.now() - closedAt > 14 * DAY) throw fail.precondition('Ce ticket est fermé depuis plus de 14 jours : ouvrez une nouvelle demande.');
      status = 'open';
      body = `${ticket.requesterName} a rouvert la demande.`;
    }
    const system: TicketMessage = { authorType: 'system', authorId: caller.uid, authorName: 'Ciyou Eats', body, internal: false, attachments: [], action: { type: 'status_change', detail: status }, createdAt: now };
    await db.runTransaction(async (tx) => {
      tx.create(ref.collection(SUBCOLLECTIONS.supportTickets.messages).doc(), system);
      tx.update(ref, {
        status,
        ...(status === 'closed' ? { closedAt: now } : { closedAt: null, resolvedAt: null, unreadBySupport: FieldValue.increment(1) }),
        lastMessageAt: now,
        lastMessagePreview: body,
        updatedAt: now,
        updatedBy: caller.uid,
      });
    });
    await writeAudit({
      actor: actorFromCaller(caller, 'driver'),
      action: data.action === 'close' ? 'ticket.closed' : 'ticket.reopened',
      target: { type: 'ticket', id: data.ticketId, label: ticket.number },
      before: { status: ticket.status },
      after: { status },
      countryId: ticket.countryId,
      cityId: ticket.cityId ?? null,
      request,
    });
    return { status };
  },
);
