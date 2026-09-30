// Signalement d'un problème sur une commande par le restaurant : ouverture d'un
// ticket au support Ciyou Eats rattaché à la commande, trace dans la chronologie.
import {
  COLLECTIONS,
  ORDER_ISSUE_CATEGORIES,
  ORDER_ISSUE_CATEGORY_LABELS,
  ORDER_ISSUE_TICKET_REASON_ID,
  SUBCOLLECTIONS,
  formatTicketNumber,
  type Counter,
  type ReportOrderIssueResult,
  type SupportTicket,
  type TicketMessage,
} from '@golink/shared';
import { db, FieldValue, Timestamp } from '../lib/admin';
import { ordersCallable as callable } from './runtime';
import { z, zId } from '../lib/validation';
import { addEvent, eventActorOf, loadOrder, orderRef, requireOrderStaff } from './context';
import { loadSupportSettings } from '../admin/experience/common';

export const reportOrderIssue = callable(
  z.object({ orderId: zId, category: z.enum(ORDER_ISSUE_CATEGORIES), message: z.string().trim().min(10, 'Décrivez le problème en quelques mots (10 caractères au moins).').max(1500) }),
  async (data, request): Promise<ReportOrderIssueResult> => {
    const order = await loadOrder(data.orderId);
    const actor = await requireOrderStaff(request, order, 'orders.manage');
    const eventActor = eventActorOf(actor);
    const active = !['delivered', 'cancelled'].includes(order.status);
    const priority = active && data.category !== 'other' ? 'high' : 'normal';
    const label = ORDER_ISSUE_CATEGORY_LABELS[data.category];
    // Correctif : ce ticket lisait ses propres délais codés en dur (15/60 min, 2 h/24 h) au lieu du
    // réglage `settings/support` partagé (`firstResponseTargetMinutes`/`resolutionTargetHours`,
    // modifiable dans `SettingsPage.tsx`) — les tickets ouverts depuis une commande ne suivaient donc
    // jamais un changement de SLA fait par l'équipe support (`docs/AUDIT_COUVERTURE_CDC.md` §13).
    const supportSettings = await loadSupportSettings();
    const firstResponseMinutes = supportSettings.firstResponseTargetMinutes[priority];
    const resolutionMinutes = supportSettings.resolutionTargetHours[priority] * 60;

    return db.runTransaction(async (tx) => {
      const counterRef = db.collection(COLLECTIONS.counters).doc('tickets');
      const counter = (await tx.get(counterRef)).data() as Counter | undefined;
      const sequence = (counter?.value ?? 4600) + 1;
      const number = formatTicketNumber(sequence);
      const ticketRef = db.collection(COLLECTIONS.supportTickets).doc();
      const at = Timestamp.now();
      const ticket: SupportTicket = {
        number,
        requesterType: 'restaurant',
        requesterId: actor.caller.uid,
        requesterName: `${order.restaurantName} · ${eventActor.name ?? ''}`.trim(),
        restaurantId: order.restaurantId,
        driverId: order.driverId ?? null,
        orderId: data.orderId,
        countryId: order.countryId,
        cityId: order.cityId ?? null,
        reasonId: ORDER_ISSUE_TICKET_REASON_ID,
        subject: `${order.number} · ${label}`,
        status: 'open',
        priority,
        channel: 'backoffice',
        assigneeId: null,
        escalated: false,
        escalatedTo: null,
        escalatedAt: null,
        firstResponseAt: null,
        firstResponseDueAt: Timestamp.fromMillis(at.toMillis() + firstResponseMinutes * 60_000),
        resolutionDueAt: Timestamp.fromMillis(at.toMillis() + resolutionMinutes * 60_000),
        resolvedAt: null,
        closedAt: null,
        refundIds: [],
        compensationCents: 0,
        satisfaction: null,
        tags: ['commande', data.category],
        lastMessageAt: at,
        lastMessagePreview: data.message.slice(0, 140),
        unreadByRequester: 0,
        unreadBySupport: 1,
        createdAt: at,
        createdBy: actor.caller.uid,
        updatedAt: at,
        updatedBy: actor.caller.uid,
      };
      const message: TicketMessage = {
        authorType: 'requester',
        authorId: actor.caller.uid,
        authorName: eventActor.name ?? order.restaurantName,
        body: data.message,
        internal: false,
        attachments: [],
        action: null,
        createdAt: at,
      };
      tx.set(ticketRef, { ...ticket, ...(order.test ? { test: true } : {}) });
      tx.set(ticketRef.collection(SUBCOLLECTIONS.supportTickets.messages).doc(), message);
      tx.set(counterRef, { value: sequence, prefix: 'T-', updatedAt: at }, { merge: true });
      tx.update(orderRef(data.orderId), { ticketIds: FieldValue.arrayUnion(ticketRef.id), updatedAt: at });
      addEvent(tx, data.orderId, eventActor, {
        type: 'note_added',
        from: null,
        to: null,
        visibleToCustomer: false,
        message: `Problème signalé au support (${number}) : ${label}.`,
        data: { ticketId: ticketRef.id, category: data.category },
      }, at);
      return { ticketId: ticketRef.id, ticketNumber: number };
    });
  },
);
