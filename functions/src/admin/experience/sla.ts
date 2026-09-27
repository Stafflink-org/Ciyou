// Délais cibles du support : marquage des dépassements, escalade automatique
// quand la première réponse tarde, fermeture des tickets résolus inactifs.
// Idempotent : chaque étape est marquée sur le ticket et n'est jouée qu'une fois.
import { COLLECTIONS, type SupportTicket, type TicketMessage, type TicketPriority } from '@golink/shared';
import { logger } from 'firebase-functions/v2';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { db, Timestamp } from '../../lib/admin';
import { SYSTEM_ACTOR, writeAudit } from '../../lib/audit';
import { requireAdmin } from '../../lib/permissions';
import { z } from '../../lib/validation';
import { EXPERIENCE_RUNTIME, MINUTE, OPEN_TICKET_STATUSES, experienceCallable, loadSupportSettings, newMessageRef, ticketRef } from './common';

const PRIORITY_UP: Record<TicketPriority, TicketPriority> = { low: 'normal', normal: 'high', high: 'urgent', urgent: 'urgent' };

function system(body: string, internal: boolean, action: TicketMessage['action']): TicketMessage {
  return { authorType: 'system', authorId: 'system', authorName: 'GoLink', body, internal, attachments: [], action, createdAt: Timestamp.now() };
}

export async function enforceSla(): Promise<{ firstResponseBreaches: number; resolutionBreaches: number; escalated: number; closed: number }> {
  const settings = await loadSupportSettings();
  const now = Date.now();
  const result = { firstResponseBreaches: 0, resolutionBreaches: 0, escalated: 0, closed: 0 };
  const open = await db.collection(COLLECTIONS.supportTickets).where('status', 'in', [...OPEN_TICKET_STATUSES]).get();

  for (const doc of open.docs) {
    const t = doc.data() as SupportTicket;
    const updates: Record<string, unknown> = {};
    const messages: TicketMessage[] = [];
    const firstDue = t.firstResponseDueAt.toMillis();
    if (!t.firstResponseAt && firstDue < now && !t.slaFirstResponseBreached) {
      updates.slaFirstResponseBreached = true;
      messages.push(system('Délai de première réponse dépassé.', true, null));
      result.firstResponseBreaches += 1;
    }
    if (!t.firstResponseAt && !t.escalated && now - firstDue >= settings.autoEscalateAfterMinutes * MINUTE) {
      updates.escalated = true;
      updates.escalatedTo = null;
      updates.escalatedAt = Timestamp.now();
      updates.escalationReason = `Sans première réponse ${settings.autoEscalateAfterMinutes} min après l’échéance`;
      updates.priority = PRIORITY_UP[t.priority];
      messages.push(system(`Escalade automatique aux responsables : aucune réponse ${settings.autoEscalateAfterMinutes} min après le délai cible.`, true, { type: 'escalation', detail: 'automatique' }));
      result.escalated += 1;
    }
    if (t.resolutionDueAt.toMillis() < now && !t.slaResolutionBreached) {
      updates.slaResolutionBreached = true;
      messages.push(system('Délai de résolution dépassé.', true, null));
      result.resolutionBreaches += 1;
    }
    if (Object.keys(updates).length === 0) continue;
    await db.runTransaction(async (tx) => {
      const fresh = (await tx.get(doc.ref)).data() as SupportTicket | undefined;
      if (!fresh || !(OPEN_TICKET_STATUSES as readonly string[]).includes(fresh.status)) return;
      tx.update(doc.ref, { ...updates, updatedAt: Timestamp.now(), updatedBy: 'system' });
      for (const m of messages) tx.create(newMessageRef(doc.id), m);
    });
    if (updates.escalated) {
      await writeAudit({
        actor: SYSTEM_ACTOR,
        action: 'ticket.escalated',
        target: { type: 'ticket', id: doc.id, label: t.number },
        reason: String(updates.escalationReason),
        after: { priority: updates.priority },
        countryId: t.countryId,
        cityId: t.cityId ?? null,
      });
    }
  }

  // Tickets résolus sans nouvelle réponse : fermeture automatique.
  const closeAfterDays = settings.autoCloseResolvedAfterDays ?? 7;
  const resolved = await db.collection(COLLECTIONS.supportTickets).where('status', '==', 'resolved').get();
  for (const doc of resolved.docs) {
    const t = doc.data() as SupportTicket;
    const since = (t.resolvedAt ?? t.updatedAt).toMillis();
    if (now - since < closeAfterDays * 86_400_000) continue;
    await db.runTransaction(async (tx) => {
      const fresh = (await tx.get(doc.ref)).data() as SupportTicket | undefined;
      if (fresh?.status !== 'resolved') return;
      const at = Timestamp.now();
      tx.update(ticketRef(doc.id), { status: 'closed', closedAt: at, updatedAt: at, updatedBy: 'system' });
      tx.create(newMessageRef(doc.id), system(`Demande fermée automatiquement ${closeAfterDays} jours après sa résolution.`, false, { type: 'status_change', detail: 'closed' }));
    });
    result.closed += 1;
  }
  return result;
}

export const enforceTicketSla = onSchedule(
  { schedule: 'every 15 minutes', timeZone: 'Europe/Paris', retryCount: 0, ...EXPERIENCE_RUNTIME, timeoutSeconds: 120 },
  async () => {
    const result = await enforceSla();
    if (result.escalated || result.firstResponseBreaches || result.resolutionBreaches || result.closed) logger.info('Délais du support', result);
  },
);

export const runTicketSlaNow = experienceCallable(z.object({}), async (_data, request) => {
  await requireAdmin(request, 'support.escalate');
  return enforceSla();
});
