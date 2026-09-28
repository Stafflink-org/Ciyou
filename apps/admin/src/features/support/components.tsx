// Composants du support : navigation, délais cibles, badges, création de ticket.
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { collection, getDocs, limit, query, where } from 'firebase/firestore';
import { BarChart3, BookOpenText, Clock, Inbox, MessagesSquare, Plus, Settings2, TimerOff } from 'lucide-react';
import {
  Badge,
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  FormField,
  Input,
  Select,
  StatusBadge,
  Textarea,
  Tooltip,
  cn,
} from '@golink/ui';
import {
  COLLECTIONS,
  TICKET_PRIORITIES,
  TICKET_PRIORITY_LABELS,
  parseOrderNumber,
  type CreateTicketAsAgentInput,
  type Order,
  type SupportTicket,
  type TicketRequesterType,
  type WithId,
} from '@golink/shared';
import { useCan } from '@/auth/AdminAccess';
import { db } from '@/lib/firebase';
import { callFunction, useMutation } from '@/lib/firestore';
import { formatDuration, millis } from '../_experience/format';
import { REQUESTER_LABELS, REQUESTER_TONES, TICKET_PRIORITY_META, TICKET_STATUS_META } from '../_experience/labels';
import { SubNav } from '../_experience/ui';
import { useTicketReasons } from './hooks';

export function SupportNav({ openCount }: { openCount?: number }) {
  const can = useCan();
  return (
    <SubNav
      items={[
        { to: '/support', label: 'Tickets', icon: <Inbox />, count: openCount, end: true },
        { to: '/support/chat', label: 'Chat en direct', icon: <MessagesSquare /> },
        { to: '/support/statistiques', label: 'Statistiques', icon: <BarChart3 /> },
        { to: '/support/aide', label: 'Centre d’aide', icon: <BookOpenText /> },
        { to: '/support/configuration', label: 'Motifs et délais', icon: <Settings2 />, hidden: !can('support.view') },
      ]}
    />
  );
}

export const OPEN_STATUSES = ['open', 'in_progress', 'waiting_customer'] as const;
export const isOpenTicket = (t: Pick<SupportTicket, 'status'>) => (OPEN_STATUSES as readonly string[]).includes(t.status);

export function TicketStatusBadge({ status }: { status: SupportTicket['status'] }) {
  return <StatusBadge status={status} map={TICKET_STATUS_META} />;
}

export function PriorityBadge({ priority }: { priority: SupportTicket['priority'] }) {
  return <StatusBadge status={priority} map={TICKET_PRIORITY_META} />;
}

export function RequesterBadge({ type }: { type: TicketRequesterType }) {
  return <Badge tone={REQUESTER_TONES[type]} size="sm">{REQUESTER_LABELS[type]}</Badge>;
}

/** Échéance de la prochaine étape (première réponse, puis résolution). */
export function slaState(ticket: SupportTicket, now = Date.now()) {
  if (!isOpenTicket(ticket)) return null;
  const first = !ticket.firstResponseAt;
  const due = millis(first ? ticket.firstResponseDueAt : ticket.resolutionDueAt);
  const created = millis(ticket.createdAt);
  const remaining = due - now;
  const span = Math.max(1, due - created);
  const tone: 'danger' | 'amber' | 'neutral' = remaining < 0 ? 'danger' : remaining < span * 0.25 ? 'amber' : 'neutral';
  return { first, due, remaining, tone, label: first ? '1re réponse' : 'Résolution' };
}

export function SlaChip({ ticket, now }: { ticket: SupportTicket; now: number }) {
  const sla = slaState(ticket, now);
  if (!sla) return <span className="text-xs text-fg-subtle">—</span>;
  const text = sla.remaining < 0 ? `+ ${formatDuration(sla.remaining)}` : formatDuration(sla.remaining);
  return (
    <Tooltip content={`${sla.label} ${sla.remaining < 0 ? 'en retard de' : 'attendue dans'} ${formatDuration(sla.remaining)}`}>
      <span
        className={cn(
          `tone-${sla.tone}`,
          'inline-flex items-center gap-1 whitespace-nowrap rounded-full border border-(--tone-border) bg-(--tone-bg) px-2 py-0.5 font-mono text-2xs text-(--tone-fg) num',
        )}
      >
        {sla.remaining < 0 ? <TimerOff className="size-3" /> : <Clock className="size-3" />}
        {text}
      </span>
    </Tooltip>
  );
}

// ------------------------------------------------------------------ Nouveau ticket

const createTicket = callFunction<CreateTicketAsAgentInput, { ticketId: string; number: string }>('createTicketAsAgent');

/**
 * Ouverture d'un ticket pour le compte d'un demandeur (appel, e-mail) :
 * recherche par numéro de commande, ou identifiant du client / restaurant / livreur.
 */
export function NewTicketDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const navigate = useNavigate();
  const reasons = useTicketReasons();
  const [requesterType, setRequesterType] = useState<TicketRequesterType>('client');
  const [orderInput, setOrderInput] = useState('');
  const [order, setOrder] = useState<WithId<Order> | null>(null);
  const [orderError, setOrderError] = useState<string | null>(null);
  const [requesterId, setRequesterId] = useState('');
  const [reasonId, setReasonId] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [channel, setChannel] = useState<CreateTicketAsAgentInput['channel']>('phone');
  const [priority, setPriority] = useState('');
  const { mutate, loading } = useMutation(createTicket, { success: (r) => `Ticket ${r.number} ouvert` });

  const reasonOptions = useMemo(
    () => reasons.data.filter((r) => r.active && r.audience.includes(requesterType)).map((r) => ({ value: r.id, label: r.label.fr })),
    [reasons.data, requesterType],
  );
  const reason = reasons.data.find((r) => r.id === reasonId);
  const effectiveRequester = order
    ? requesterType === 'client' ? order.customerId : requesterType === 'restaurant' ? order.restaurantId : (order.driverId ?? '')
    : requesterId.trim();

  async function lookupOrder() {
    setOrderError(null);
    setOrder(null);
    const number = parseOrderNumber(orderInput);
    if (!number) {
      setOrderError('Saisissez un numéro de commande, par exemple GL-10482.');
      return;
    }
    const snap = await getDocs(query(collection(db, COLLECTIONS.orders), where('number', '==', number), limit(1)));
    const doc = snap.docs[0];
    if (!doc) setOrderError(`Aucune commande ${number} dans votre périmètre.`);
    else setOrder({ ...(doc.data() as Order), id: doc.id });
  }

  function reset() {
    setOrderInput('');
    setOrder(null);
    setOrderError(null);
    setRequesterId('');
    setReasonId('');
    setSubject('');
    setBody('');
    setPriority('');
  }

  const canSubmit = effectiveRequester && reasonId && subject.trim().length >= 5 && body.trim().length >= 10 && (!reason?.requiresOrder || order);

  async function submit() {
    const result = await mutate({
      requesterType,
      requesterId: effectiveRequester,
      orderId: order?.id ?? null,
      reasonId,
      subject: subject.trim(),
      body: body.trim(),
      channel,
      priority: (priority || null) as CreateTicketAsAgentInput['priority'],
    });
    if (result) {
      reset();
      onOpenChange(false);
      navigate(`/support/${result.ticketId}`);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) reset(); onOpenChange(o); }}>
      <DialogContent size="lg">
        <DialogHeader icon={<Plus />} title="Nouveau ticket" description="Pour une demande reçue par téléphone, e-mail ou chat : le ticket vous est attribué et la réponse ci-dessous est envoyée au demandeur." />
        <DialogBody className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Demandeur">
              <Select
                value={requesterType}
                onValueChange={(v) => { setRequesterType(v as TicketRequesterType); setReasonId(''); }}
                options={(['client', 'restaurant', 'driver'] as const).map((t) => ({ value: t, label: REQUESTER_LABELS[t] }))}
              />
            </FormField>
            <FormField label="Canal">
              <Select
                value={channel}
                onValueChange={(v) => setChannel(v as CreateTicketAsAgentInput['channel'])}
                options={[{ value: 'phone', label: 'Téléphone' }, { value: 'email', label: 'E-mail' }, { value: 'chat', label: 'Chat' }, { value: 'backoffice', label: 'Back-office' }]}
              />
            </FormField>
          </div>
          <FormField label="Commande concernée" hint={order ? `${order.restaurantName} · ${order.customerName}` : 'Facultatif, sauf pour les motifs liés à une commande.'} error={orderError ?? undefined}>
            <div className="flex gap-2">
              <Input value={orderInput} onChange={(e) => setOrderInput(e.target.value)} placeholder="GL-10482" onKeyDown={(e) => e.key === 'Enter' && void lookupOrder()} />
              <Button type="button" onClick={() => void lookupOrder()}>Rechercher</Button>
            </div>
          </FormField>
          {!order && (
            <FormField label={`Identifiant du ${REQUESTER_LABELS[requesterType].toLowerCase()}`} hint="Visible sur sa fiche (rubrique Acteurs).">
              <Input value={requesterId} onChange={(e) => setRequesterId(e.target.value)} placeholder="ex. seed-client-091" />
            </FormField>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Motif" required>
              <Select value={reasonId} onValueChange={setReasonId} options={reasonOptions} placeholder="Choisir un motif" />
            </FormField>
            <FormField label="Priorité" hint="Par défaut : celle du motif.">
              <Select value={priority} onValueChange={setPriority} placeholder={reason ? TICKET_PRIORITY_LABELS[reason.defaultPriority] : 'Priorité du motif'} options={TICKET_PRIORITIES.map((p) => ({ value: p, label: TICKET_PRIORITY_LABELS[p] }))} />
            </FormField>
          </div>
          <FormField label="Objet" required>
            <Input value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={120} placeholder="Commande arrivée incomplète" />
          </FormField>
          <FormField label="Premier message au demandeur" required hint="Résumé de la demande et de la suite donnée.">
            <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={4} maxLength={5000} />
          </FormField>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Annuler</Button>
          <Button variant="primary" loading={loading} disabled={!canSubmit} onClick={() => void submit()}>Ouvrir le ticket</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
