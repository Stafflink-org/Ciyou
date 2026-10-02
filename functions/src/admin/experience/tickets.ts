// Traitement des tickets par l'équipe support : agents, attribution, escalade,
// réponses (publiques ou notes internes), statuts, ouverture pour le compte d'un
// demandeur, prise de contact avec les parties d'une commande.
import {
  COLLECTIONS,
  TICKET_PRIORITIES,
  TICKET_PRIORITY_LABELS,
  TICKET_STATUSES,
  TICKET_STATUS_LABELS,
  adminHasPermission,
  formatTicketNumber,
  type AdminUser,
  type CannedResponse,
  type Driver,
  type Order,
  type Restaurant,
  type SupportAgent,
  type SupportTicket,
  type TicketMessage,
  type TicketPriority,
  type TicketReason,
  type TicketStatus,
  type UserProfile as User,
} from '@golink/shared';
import { db, FieldValue, Timestamp } from '../../lib/admin';
import { actorFromCaller, writeAudit } from '../../lib/audit';
import { fail } from '../../lib/errors';
import { assertAdminCovers, assertAdminCoversCountry, requireAdmin } from '../../lib/permissions';
import { z, zId, zReason } from '../../lib/validation';
import {
  OPEN_TICKET_STATUSES,
  addTicketMessage,
  agentPublicName,
  experienceCallable,
  loadSupportSettings,
  loadTicketFor,
  notify,
  preview,
  refundLimitOf,
  restaurantRecipients,
  slaDeadlines,
  systemMessage,
  ticketRef,
} from './common';

const PRIORITY_RANK: Record<TicketPriority, number> = { low: 0, normal: 1, high: 2, urgent: 3 };

async function loadActiveAdmin(uid: string): Promise<AdminUser> {
  const snap = await db.collection(COLLECTIONS.admins).doc(uid).get();
  const admin = snap.data() as AdminUser | undefined;
  if (!admin?.active) throw fail.invalid('Ce membre de l’équipe n’est plus actif.');
  return admin;
}

// ------------------------------------------------------------------ Agents

/** Agents du support (droit de traiter les tickets) et leur charge en cours. */
export const getSupportAgents = experienceCallable(z.object({}), async (_data, request) => {
  await requireAdmin(request, 'support.view');
  const [admins, open] = await Promise.all([
    db.collection(COLLECTIONS.admins).where('active', '==', true).get(),
    db.collection(COLLECTIONS.supportTickets).where('status', 'in', [...OPEN_TICKET_STATUSES]).get(),
  ]);
  const now = Date.now();
  const load = new Map<string, { open: number; overdue: number }>();
  for (const doc of open.docs) {
    const t = doc.data() as SupportTicket;
    const key = t.assigneeId ?? '';
    const entry = load.get(key) ?? { open: 0, overdue: 0 };
    entry.open += 1;
    if (t.resolutionDueAt.toMillis() < now) entry.overdue += 1;
    load.set(key, entry);
  }
  const agents: SupportAgent[] = [];
  for (const doc of admins.docs) {
    const admin = doc.data() as AdminUser;
    if (!(['support.view', 'support.escalate', 'refunds.approve'] as const).some((perm) => adminHasPermission(admin, perm))) continue;
    agents.push({
      uid: doc.id,
      displayName: admin.displayName,
      email: admin.email,
      role: admin.role,
      canHandle: adminHasPermission(admin, 'support.handle'),
      canEscalate: adminHasPermission(admin, 'support.escalate'),
      refundLimitCents: Math.min(await refundLimitOf(admin), 100_000_000),
      openTickets: load.get(doc.id)?.open ?? 0,
      overdueTickets: load.get(doc.id)?.overdue ?? 0,
    });
  }
  agents.sort((a, b) => a.displayName.localeCompare(b.displayName, 'fr'));
  return { agents, unassigned: load.get('')?.open ?? 0 };
});

// ------------------------------------------------------------------ Attribution

export const assignTickets = experienceCallable(
  z.object({ ticketIds: z.array(zId).min(1).max(50), assigneeId: zId.nullable() }),
  async (data, request) => {
    const { caller, admin } = await requireAdmin(request, 'support.handle');
    const assignee = data.assigneeId ? await loadActiveAdmin(data.assigneeId) : null;
    if (assignee && !adminHasPermission(assignee, 'support.handle') && !adminHasPermission(assignee, 'support.escalate')) {
      throw fail.invalid(`${assignee.displayName} n’a pas accès au traitement des tickets.`);
    }
    let changed = 0;
    for (const ticketId of data.ticketIds) {
      const ticket = await loadTicketFor(admin, ticketId);
      if (ticket.status === 'closed' || (ticket.assigneeId ?? null) === data.assigneeId) continue;
      const at = Timestamp.now();
      const label = assignee ? `Ticket attribué à ${assignee.displayName}.` : 'Attribution retirée : le ticket retourne dans la file commune.';
      await db.runTransaction(async (tx) => {
        tx.update(ticketRef(ticketId), {
          assigneeId: data.assigneeId,
          ...(assignee && ticket.status === 'open' && ticket.firstResponseAt ? { status: 'in_progress' } : {}),
          updatedAt: at,
          updatedBy: caller.uid,
        });
        addTicketMessage(tx, ticketId, systemMessage(admin, caller.uid, label, { type: 'assignment', detail: assignee?.displayName ?? 'file commune' }), at);
      });
      await writeAudit({
        actor: actorFromCaller(caller, 'admin'),
        action: 'ticket.assigned',
        target: { type: 'ticket', id: ticketId, label: ticket.number },
        before: { assigneeId: ticket.assigneeId ?? null },
        after: { assigneeId: data.assigneeId },
        countryId: ticket.countryId,
        cityId: ticket.cityId ?? null,
        request,
      });
      if (assignee && data.assigneeId !== caller.uid) {
        await notify(data.assigneeId, {
          title: `Ticket ${ticket.number} attribué`,
          body: `${admin.displayName} vous a attribué « ${ticket.subject} ».`,
          category: 'support',
          link: { type: 'ticket', target: ticketId },
        });
      }
      changed += 1;
    }
    return { changed };
  },
);

// ------------------------------------------------------------------ Escalade

export const escalateTicket = experienceCallable(
  z.object({ ticketId: zId, escalateTo: zId.nullable().default(null), reason: zReason, release: z.boolean().default(false) }),
  async (data, request) => {
    const { caller, admin } = await requireAdmin(request, 'support.escalate');
    const ticket = await loadTicketFor(admin, data.ticketId);
    if (ticket.status === 'closed') throw fail.precondition('Ce ticket est fermé.');
    const at = Timestamp.now();

    if (data.release) {
      if (!ticket.escalated) throw fail.precondition('Ce ticket n’est pas escaladé.');
      await db.runTransaction(async (tx) => {
        tx.update(ticketRef(data.ticketId), { escalated: false, escalatedTo: null, escalatedAt: null, escalationReason: null, updatedAt: at, updatedBy: caller.uid });
        addTicketMessage(tx, data.ticketId, systemMessage(admin, caller.uid, `Escalade levée : ${data.reason}`, { type: 'escalation', detail: 'levée' }), at);
      });
      await writeAudit({
        actor: actorFromCaller(caller, 'admin'),
        action: 'ticket.deescalated',
        target: { type: 'ticket', id: data.ticketId, label: ticket.number },
        reason: data.reason,
        countryId: ticket.countryId,
        cityId: ticket.cityId ?? null,
        request,
      });
      return { escalated: false };
    }

    const target = data.escalateTo ? await loadActiveAdmin(data.escalateTo) : null;
    if (target && !adminHasPermission(target, 'support.escalate')) {
      throw fail.invalid(`${target.displayName} ne fait pas partie des responsables du support.`);
    }
    const priority: TicketPriority = PRIORITY_RANK[ticket.priority] < PRIORITY_RANK.high ? 'high' : ticket.priority;
    const settings = await loadSupportSettings();
    const due = slaDeadlines(settings, priority, at.toMillis());
    await db.runTransaction(async (tx) => {
      tx.update(ticketRef(data.ticketId), {
        escalated: true,
        escalatedTo: data.escalateTo,
        escalatedAt: at,
        escalationReason: data.reason,
        priority,
        ...(data.escalateTo ? { assigneeId: data.escalateTo } : {}),
        ...(priority !== ticket.priority ? { resolutionDueAt: due.resolutionDueAt } : {}),
        status: ticket.status === 'resolved' ? 'in_progress' : ticket.status,
        updatedAt: at,
        updatedBy: caller.uid,
      });
      addTicketMessage(
        tx,
        data.ticketId,
        systemMessage(admin, caller.uid, `Escaladé ${target ? `à ${target.displayName}` : 'aux responsables'} : ${data.reason}`, { type: 'escalation', detail: target?.displayName ?? 'responsables' }),
        at,
      );
    });
    await writeAudit({
      actor: actorFromCaller(caller, 'admin'),
      action: 'ticket.escalated',
      target: { type: 'ticket', id: data.ticketId, label: ticket.number },
      reason: data.reason,
      before: { escalated: ticket.escalated, priority: ticket.priority },
      after: { escalated: true, escalatedTo: data.escalateTo, priority },
      countryId: ticket.countryId,
      cityId: ticket.cityId ?? null,
      request,
    });
    if (target && data.escalateTo !== caller.uid) {
      await notify(data.escalateTo, {
        title: `Escalade : ticket ${ticket.number}`,
        body: `${admin.displayName} a besoin de vous : ${data.reason}`,
        category: 'support',
        link: { type: 'ticket', target: data.ticketId },
      });
    }
    return { escalated: true, priority };
  },
);

// ------------------------------------------------------------------ Réponse

async function requesterRecipients(ticket: SupportTicket): Promise<string[]> {
  if (ticket.requesterType === 'restaurant' && ticket.restaurantId) {
    const members = await restaurantRecipients(ticket.restaurantId);
    return [...new Set([ticket.requesterId, ...members])];
  }
  return [ticket.requesterId];
}

export const respondToTicket = experienceCallable(
  z.object({
    ticketId: zId,
    body: z.string().trim().min(2, 'Votre message est trop court.').max(5000),
    internal: z.boolean(),
    status: z.enum(TICKET_STATUSES).nullable().default(null),
    cannedResponseId: zId.nullable().default(null),
  }),
  async (data, request) => {
    const { caller, admin } = await requireAdmin(request, 'support.handle');
    const ticket = await loadTicketFor(admin, data.ticketId);
    if (ticket.status === 'closed' && !data.internal) throw fail.precondition('Ce ticket est fermé : rouvrez-le avant de répondre.');
    const at = Timestamp.now();
    const nextStatus: TicketStatus = data.status
      ?? (data.internal ? ticket.status : ticket.status === 'open' || ticket.status === 'in_progress' ? 'waiting_customer' : ticket.status);
    const message: Omit<TicketMessage, 'createdAt'> = {
      authorType: 'agent',
      authorId: caller.uid,
      authorName: data.internal ? admin.displayName : agentPublicName(admin),
      body: data.body,
      internal: data.internal,
      attachments: [],
      action: nextStatus !== ticket.status ? { type: 'status_change', detail: nextStatus } : null,
    };
    let messageId = '';
    await db.runTransaction(async (tx) => {
      messageId = addTicketMessage(tx, data.ticketId, message, at).id;
      tx.update(ticketRef(data.ticketId), {
        ...(data.internal
          ? {}
          : {
              lastMessageAt: at,
              lastMessagePreview: preview(data.body),
              unreadByRequester: FieldValue.increment(1),
              ...(ticket.firstResponseAt ? {} : { firstResponseAt: at }),
            }),
        status: nextStatus,
        unreadBySupport: 0,
        ...(ticket.assigneeId ? {} : { assigneeId: caller.uid }),
        ...(nextStatus === 'resolved' && ticket.status !== 'resolved' ? { resolvedAt: at } : {}),
        ...(nextStatus === 'closed' && ticket.status !== 'closed' ? { closedAt: at } : {}),
        updatedAt: at,
        updatedBy: caller.uid,
      });
    });
    if (data.cannedResponseId) {
      const ref = db.collection(COLLECTIONS.cannedResponses).doc(data.cannedResponseId);
      const canned = (await ref.get()).data() as CannedResponse | undefined;
      if (canned) await ref.update({ usageCount: FieldValue.increment(1), lastUsedAt: at });
    }
    if (!data.internal) {
      for (const uid of await requesterRecipients(ticket)) {
        await notify(uid, {
          title: `Réponse du support · ${ticket.number}`,
          body: preview(data.body),
          category: 'support',
          link: { type: 'ticket', target: data.ticketId },
        });
      }
    }
    await writeAudit({
      actor: actorFromCaller(caller, 'admin'),
      action: data.internal ? 'ticket.internal_note' : 'ticket.replied',
      target: { type: 'ticket', id: data.ticketId, label: ticket.number },
      before: { status: ticket.status },
      after: { status: nextStatus, internal: data.internal, cannedResponseId: data.cannedResponseId },
      countryId: ticket.countryId ?? null,
      cityId: ticket.cityId ?? null,
      request,
    });
    return { messageId, status: nextStatus };
  },
);

// ------------------------------------------------------------------ Statut, priorité, motif

export const updateTicket = experienceCallable(
  z.object({
    ticketId: zId,
    status: z.enum(TICKET_STATUSES).optional(),
    priority: z.enum(TICKET_PRIORITIES).optional(),
    reasonId: zId.optional(),
    tags: z.array(z.string().trim().min(1).max(30)).max(10).optional(),
    note: z.string().trim().max(500).nullable().default(null),
  }),
  async (data, request) => {
    const { caller, admin } = await requireAdmin(request, 'support.handle');
    const ticket = await loadTicketFor(admin, data.ticketId);
    const at = Timestamp.now();
    const changes: Record<string, unknown> = {};
    const lines: string[] = [];
    let publicLine: string | null = null;

    if (data.status && data.status !== ticket.status) {
      changes.status = data.status;
      if (data.status === 'resolved') changes.resolvedAt = at;
      if (data.status === 'closed') changes.closedAt = at;
      if (data.status === 'open' || data.status === 'in_progress') {
        changes.resolvedAt = null;
        changes.closedAt = null;
      }
      lines.push(`Statut : ${TICKET_STATUS_LABELS[ticket.status]} → ${TICKET_STATUS_LABELS[data.status]}`);
      if (data.status === 'resolved') publicLine = 'Votre demande a été marquée comme résolue. Si le problème persiste, répondez simplement à ce message.';
      if (data.status === 'closed') publicLine = 'Votre demande est fermée. Merci d’avoir contacté le support Ciyou Eats.';
    }
    if (data.priority && data.priority !== ticket.priority) {
      changes.priority = data.priority;
      const settings = await loadSupportSettings();
      const due = slaDeadlines(settings, data.priority, ticket.createdAt.toMillis());
      changes.resolutionDueAt = due.resolutionDueAt;
      if (!ticket.firstResponseAt) changes.firstResponseDueAt = due.firstResponseDueAt;
      lines.push(`Priorité : ${TICKET_PRIORITY_LABELS[ticket.priority]} → ${TICKET_PRIORITY_LABELS[data.priority]}`);
    }
    if (data.reasonId && data.reasonId !== ticket.reasonId) {
      const reason = (await db.collection(COLLECTIONS.ticketReasons).doc(data.reasonId).get()).data() as TicketReason | undefined;
      if (!reason) throw fail.invalid('Motif inconnu.');
      changes.reasonId = data.reasonId;
      lines.push(`Motif : ${reason.label.fr}`);
    }
    if (data.tags) {
      changes.tags = [...new Set(data.tags.map((t) => t.toLowerCase()))];
      lines.push(`Étiquettes : ${(changes.tags as string[]).join(', ') || 'aucune'}`);
    }
    if (lines.length === 0) return { changed: false };

    await db.runTransaction(async (tx) => {
      tx.update(ticketRef(data.ticketId), { ...changes, updatedAt: at, updatedBy: caller.uid });
      addTicketMessage(tx, data.ticketId, systemMessage(admin, caller.uid, [lines.join(' · '), data.note].filter(Boolean).join('\n'), changes.status ? { type: 'status_change', detail: String(changes.status) } : null), at);
      if (publicLine) {
        addTicketMessage(tx, data.ticketId, { ...systemMessage(admin, caller.uid, publicLine, { type: 'status_change', detail: String(changes.status) }, false), authorName: 'Ciyou Eats' }, at);
        tx.update(ticketRef(data.ticketId), { lastMessageAt: at, lastMessagePreview: preview(publicLine), unreadByRequester: FieldValue.increment(1) });
      }
    });
    await writeAudit({
      actor: actorFromCaller(caller, 'admin'),
      action: changes.status ? `ticket.${changes.status as string}` : 'ticket.updated',
      target: { type: 'ticket', id: data.ticketId, label: ticket.number },
      reason: data.note,
      before: { status: ticket.status, priority: ticket.priority, reasonId: ticket.reasonId, tags: ticket.tags },
      after: changes,
      countryId: ticket.countryId,
      cityId: ticket.cityId ?? null,
      request,
    });
    if (publicLine) {
      for (const uid of await requesterRecipients(ticket)) {
        await notify(uid, { title: `Ticket ${ticket.number}`, body: publicLine, category: 'support', link: { type: 'ticket', target: data.ticketId } });
      }
    }
    return { changed: true };
  },
);

// ------------------------------------------------------------------ Ouverture par un agent

export const createTicketAsAgent = experienceCallable(
  z.object({
    requesterType: z.enum(['client', 'restaurant', 'driver']),
    requesterId: zId,
    orderId: zId.nullable().default(null),
    reasonId: zId,
    subject: z.string().trim().min(5, 'Précisez l’objet de la demande.').max(120),
    body: z.string().trim().min(10, 'Décrivez la demande en quelques phrases.').max(5000),
    channel: z.enum(['phone', 'email', 'chat', 'backoffice']),
    priority: z.enum(TICKET_PRIORITIES).nullable().default(null),
  }),
  async (data, request) => {
    const { caller, admin } = await requireAdmin(request, 'support.handle');
    const reason = (await db.collection(COLLECTIONS.ticketReasons).doc(data.reasonId).get()).data() as TicketReason | undefined;
    if (!reason?.active) throw fail.invalid('Ce motif n’est pas disponible.');
    if (reason.requiresOrder && !data.orderId) throw fail.invalid('Ce motif nécessite la commande concernée.');

    const order = data.orderId ? ((await db.collection(COLLECTIONS.orders).doc(data.orderId).get()).data() as Order | undefined) : undefined;
    if (data.orderId && !order) throw fail.notFound('Commande');

    // Demandeur : nom, ville et rattachements.
    let requesterName = '';
    let countryId = order?.countryId ?? 'FR';
    let cityId: string | null = order?.cityId ?? null;
    let restaurantId: string | null = order?.restaurantId ?? null;
    let driverId: string | null = order?.driverId ?? null;
    let requesterUid = data.requesterId;
    if (data.requesterType === 'client') {
      const user = (await db.collection(COLLECTIONS.users).doc(data.requesterId).get()).data() as User | undefined;
      if (!user) throw fail.notFound('Client');
      requesterName = `${user.firstName} ${user.lastName}`.trim();
      if (order && order.customerId !== data.requesterId) throw fail.invalid('Cette commande n’appartient pas à ce client.');
    } else if (data.requesterType === 'restaurant') {
      const restaurant = (await db.collection(COLLECTIONS.restaurants).doc(data.requesterId).get()).data() as Restaurant | undefined;
      if (!restaurant) throw fail.notFound('Restaurant');
      requesterName = restaurant.name;
      requesterUid = restaurant.ownerId;
      restaurantId = data.requesterId;
      countryId = restaurant.countryId;
      cityId = restaurant.cityId;
      if (order && order.restaurantId !== data.requesterId) throw fail.invalid('Cette commande n’appartient pas à ce restaurant.');
    } else {
      const driver = (await db.collection(COLLECTIONS.drivers).doc(data.requesterId).get()).data() as Driver | undefined;
      if (!driver) throw fail.notFound('Livreur');
      requesterName = `${driver.firstName} ${driver.lastName}`.trim();
      driverId = data.requesterId;
      countryId = driver.countryId;
      cityId = driver.cityId;
    }
    if (cityId) assertAdminCovers(admin, cityId);
    assertAdminCoversCountry(admin, countryId);

    const settings = await loadSupportSettings();
    const priority = data.priority ?? reason.defaultPriority;
    const counterRef = db.collection(COLLECTIONS.counters).doc('tickets');
    const ref = db.collection(COLLECTIONS.supportTickets).doc();
    const number = await db.runTransaction(async (tx) => {
      const counter = await tx.get(counterRef);
      const next = ((counter.get('value') as number | undefined) ?? 0) + 1;
      const ticketNumber = formatTicketNumber(next);
      const at = Timestamp.now();
      const due = slaDeadlines(settings, priority, at.toMillis());
      const ticket: SupportTicket = {
        number: ticketNumber,
        requesterType: data.requesterType,
        requesterId: requesterUid,
        requesterName,
        restaurantId,
        driverId,
        orderId: data.orderId,
        countryId,
        cityId,
        reasonId: data.reasonId,
        subject: data.subject,
        status: 'in_progress',
        priority,
        channel: data.channel,
        assigneeId: caller.uid,
        escalated: false,
        escalatedTo: null,
        escalatedAt: null,
        firstResponseAt: at,
        ...due,
        resolvedAt: null,
        closedAt: null,
        refundIds: [],
        compensationCents: 0,
        satisfaction: null,
        tags: [],
        lastMessageAt: at,
        lastMessagePreview: preview(data.body),
        unreadByRequester: 0,
        unreadBySupport: 0,
        createdAt: at,
        createdBy: caller.uid,
        updatedAt: at,
        updatedBy: caller.uid,
      };
      tx.set(counterRef, { value: next, prefix: 'T-', updatedAt: at }, { merge: true });
      tx.create(ref, ticket);
      addTicketMessage(tx, ref.id, {
        authorType: 'agent',
        authorId: caller.uid,
        authorName: agentPublicName(admin),
        body: data.body,
        internal: false,
        attachments: [],
        action: null,
      }, at);
      if (order) tx.update(db.collection(COLLECTIONS.orders).doc(data.orderId!), { ticketIds: FieldValue.arrayUnion(ref.id), 'flags.disputed': true });
      return ticketNumber;
    });
    await writeAudit({
      actor: actorFromCaller(caller, 'admin'),
      action: 'ticket.opened',
      target: { type: 'ticket', id: ref.id, label: number },
      after: { requesterType: data.requesterType, requesterId: data.requesterId, channel: data.channel, orderId: data.orderId },
      countryId,
      cityId,
      request,
    });
    return { ticketId: ref.id, number };
  },
);

// ------------------------------------------------------------------ Contact des parties

export const contactTicketParty = experienceCallable(
  z.object({
    ticketId: zId,
    party: z.enum(['requester', 'restaurant', 'driver']),
    message: z.string().trim().min(5, 'Votre message est trop court.').max(2000),
  }),
  async (data, request) => {
    const { caller, admin } = await requireAdmin(request, 'support.handle');
    const ticket = await loadTicketFor(admin, data.ticketId);
    let recipients: string[] = [];
    let label = '';
    if (data.party === 'requester') {
      recipients = await requesterRecipients(ticket);
      label = ticket.requesterName;
    } else if (data.party === 'restaurant') {
      if (!ticket.restaurantId) throw fail.precondition('Aucun restaurant n’est lié à ce ticket.');
      const restaurant = (await db.collection(COLLECTIONS.restaurants).doc(ticket.restaurantId).get()).data() as Restaurant | undefined;
      recipients = await restaurantRecipients(ticket.restaurantId);
      label = restaurant?.name ?? 'le restaurant';
    } else {
      if (!ticket.driverId) throw fail.precondition('Aucun livreur n’est lié à ce ticket.');
      const driver = (await db.collection(COLLECTIONS.drivers).doc(ticket.driverId).get()).data() as Driver | undefined;
      recipients = [ticket.driverId];
      label = driver ? `${driver.firstName} ${driver.lastName}` : 'le livreur';
    }
    if (recipients.length === 0) throw fail.precondition('Aucun destinataire joignable pour cette partie.');
    for (const uid of recipients) {
      await notify(uid, {
        title: `Support Ciyou Eats · ${ticket.number}`,
        body: preview(data.message),
        category: 'support',
        link: { type: 'ticket', target: data.ticketId },
      });
    }
    const at = Timestamp.now();
    await db.runTransaction(async (tx) => {
      addTicketMessage(tx, data.ticketId, systemMessage(admin, caller.uid, `Message envoyé à ${label} : « ${data.message} »`, { type: 'contact', detail: data.party }), at);
      tx.update(ticketRef(data.ticketId), { updatedAt: at, updatedBy: caller.uid });
    });
    await writeAudit({
      actor: actorFromCaller(caller, 'admin'),
      action: 'ticket.party_contacted',
      target: { type: 'ticket', id: data.ticketId, label: ticket.number },
      after: { party: data.party, recipients: recipients.length },
      countryId: ticket.countryId,
      cityId: ticket.cityId ?? null,
      request,
    });
    return { recipients: recipients.length };
  },
);
