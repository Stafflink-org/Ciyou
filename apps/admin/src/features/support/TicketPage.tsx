import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router';
import { collection, doc, limit, orderBy, query, updateDoc, where } from 'firebase/firestore';
import { getDownloadURL, ref as storageRef } from 'firebase/storage';
import {
  ArrowUpRight,
  Bike,
  CheckCircle2,
  ChevronDown,
  Clock,
  CornerDownLeft,
  FileText,
  Flame,
  Lock,
  MessageSquareShare,
  MessagesSquare,
  Paperclip,
  Receipt,
  Search,
  Send,
  Smile,
  Store,
  Undo2,
  UserPlus,
  UserRound,
  Wallet,
  Zap,
} from 'lucide-react';
import {
  Avatar,
  Badge,
  Button,
  Card,
  ConfirmDialog,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  EmptyState,
  Input,
  PageContainer,
  PageHeader,
  Popover,
  PopoverContent,
  PopoverTrigger,
  SegmentedControl,
  Select,
  Skeleton,
  StatusBadge,
  Textarea,
  Tooltip,
  cn,
  formatDateTime,
  formatRelative,
  formatTime,
} from '@golink/ui';
import {
  COLLECTIONS,
  SETTINGS_DOCS,
  TICKET_PRIORITIES,
  TICKET_PRIORITY_LABELS,
  TICKET_STATUSES,
  TICKET_STATUS_LABELS,
  paths,
  richTextToPlain,
  type CannedResponse,
  type Order,
  type Refund,
  type RefundSettings,
  type RespondToTicketInput,
  type ReviewTicketRefundInput,
  type StoredFile,
  type SupportTicket,
  type TicketMessage,
  type TicketStatus,
  type UpdateTicketInput,
  type WithId,
} from '@golink/shared';
import { useDocumentTitle, useTranslation } from '@golink/web';
import { useAdminAccess } from '@/auth/AdminAccess';
import { db, storage } from '@/lib/firebase';
import { callFunction, docAt, updatedFields, useCollection, useDoc, useMutation } from '@/lib/firestore';
import { euros, formatDuration, millis, plural } from '../_experience/format';
import { CHANNEL_LABELS, REQUESTER_LABELS } from '../_experience/labels';
import { InfoRow, LoadError, Panel } from '../_experience/ui';
import { ClaimPanel } from './ClaimPanel';
import { PriorityBadge, RequesterBadge, TicketStatusBadge, isOpenTicket, slaState } from './components';
import { useSupportAgents, useTicketReasons } from './hooks';
import { ContactDialog, CreditDialog, EscalateDialog, LiveChatDialog, RefundDialog } from './ticket-actions';

const respondToTicket = callFunction<RespondToTicketInput, { messageId: string; status: TicketStatus }>('respondToTicket');
const updateTicket = callFunction<UpdateTicketInput, { changed: boolean }>('updateTicket');
const assignTickets = callFunction<{ ticketIds: string[]; assigneeId: string | null }, { changed: number }>('assignTickets');
const reviewTicketRefund = callFunction<ReviewTicketRefundInput, { status: string }>('reviewTicketRefund');

type Dialogs = 'refund' | 'credit' | 'contact' | 'escalate' | 'chat' | null;

export function TicketPage() {
  const { label: tLabel } = useTranslation();
  const { ticketId = '' } = useParams();
  const { admin, can } = useAdminAccess();
  const ticketState = useDoc<SupportTicket>(docAt(`${COLLECTIONS.supportTickets}/${ticketId}`));
  const ticket = ticketState.data ? ({ ...ticketState.data, id: ticketId } as WithId<SupportTicket>) : null;
  useDocumentTitle(`${ticket?.number ?? 'Ticket'} · Support · GoLink Admin`);

  const messagesQuery = useMemo(() => query(collection(db, paths.ticketMessages(ticketId)), orderBy('createdAt', 'asc'), limit(500)), [ticketId]);
  const messages = useCollection<TicketMessage>(messagesQuery);
  const orderState = useDoc<Order>(ticket?.orderId ? docAt(paths.order(ticket.orderId)) : null);
  const order = orderState.data && ticket?.orderId ? ({ ...orderState.data, id: ticket.orderId } as WithId<Order>) : null;
  const canSeeRefunds = can('refunds.create') || can('finance.view');
  const refundsQuery = useMemo(() => (canSeeRefunds ? query(collection(db, COLLECTIONS.refunds), where('ticketId', '==', ticketId), limit(20)) : null), [canSeeRefunds, ticketId]);
  const refunds = useCollection<Refund>(refundsQuery);
  const refundSettings = useDoc<RefundSettings>(can('settings.view') ? docAt(paths.settings(SETTINGS_DOCS.refunds)) : null);
  const agents = useSupportAgents();
  const reasons = useTicketReasons();
  const [dialog, setDialog] = useState<Dialogs>(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  // Lecture par le support : remise à zéro du compteur de non-lus.
  const canHandle = can('support.handle');
  useEffect(() => {
    if (!canHandle || !ticketState.data || ticketState.data.unreadBySupport === 0) return;
    void updateDoc(doc(db, COLLECTIONS.supportTickets, ticketId), { unreadBySupport: 0, ...updatedFields(admin.uid) }).catch(() => undefined);
  }, [canHandle, ticketState.data?.unreadBySupport, ticketId, admin.uid]);

  if (ticketState.loading) {
    return (
      <PageContainer wide>
        <Skeleton className="mb-3 h-5 w-40" />
        <Skeleton className="mb-8 h-9 w-2/3" />
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]"><Skeleton className="h-[520px]" /><Skeleton className="h-[520px]" /></div>
      </PageContainer>
    );
  }
  if (ticketState.error || ticketState.missing || !ticket) {
    return (
      <PageContainer>
        <Card>
          {ticketState.error ? <LoadError error={ticketState.error} /> : (
            <EmptyState icon={<FileText />} title="Ticket introuvable" description="Il a peut-être été supprimé ou n’est pas dans votre périmètre." action={<Button asChild><Link to="/support">Retour aux tickets</Link></Button>} />
          )}
        </Card>
      </PageContainer>
    );
  }

  const myAgent = agents.agents.find((a) => a.uid === admin.uid);
  const limitCents = myAgent?.refundLimitCents ?? null;
  const reserved = refunds.data.filter((r) => r.status === 'pending_approval' || r.status === 'approved').reduce((s, r) => s + r.amountCents, 0);
  const refundableCents = order ? Math.max(0, order.amounts.chargedCents - order.amounts.refundedCents - reserved) : 0;
  const pendingRefund = refunds.data.find((r) => r.status === 'pending_approval') ?? null;
  const sla = slaState(ticket, now);
  const assigneeName = ticket.assigneeId ? (agents.names.get(ticket.assigneeId) ?? 'Agent') : null;
  const open = isOpenTicket(ticket);

  return (
    <PageContainer wide>
      <PageHeader
        breadcrumbs={[{ label: 'Support', href: '/support' }, { label: ticket.number }]}
        eyebrow={
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-mono num">{ticket.number}</span>
            <span>·</span>
            <span>{CHANNEL_LABELS[ticket.channel] ?? ticket.channel}</span>
            <span>·</span>
            <span>ouvert {formatRelative(millis(ticket.createdAt))}</span>
          </span>
        }
        title={ticket.subject}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {canHandle && <AssignMenu ticket={ticket} agents={agents.agents} assigneeName={assigneeName} myUid={admin.uid} onDone={agents.reload} />}
            {can('support.escalate') && open && (
              <Button leftIcon={<Flame />} variant={ticket.escalated ? 'secondary' : 'danger-soft'} onClick={() => setDialog('escalate')}>
                {ticket.escalated ? 'Lever l’escalade' : 'Escalader'}
              </Button>
            )}
            {canHandle && <StatusMenu ticket={ticket} />}
          </div>
        }
      >
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <TicketStatusBadge status={ticket.status} />
          <PriorityBadge priority={ticket.priority} />
          <RequesterBadge type={ticket.requesterType} />
          {ticket.escalated && (
            <Badge tone="danger" icon={<Flame />} className="min-w-0 max-w-full shrink">
              <span className="truncate">Escaladé{ticket.escalationReason ? ` · ${ticket.escalationReason}` : ''}</span>
            </Badge>
          )}
          {ticket.tags.map((t) => <Badge key={t} tone="neutral" variant="outline">#{t}</Badge>)}
        </div>
      </PageHeader>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 space-y-4">
          <Thread messages={messages.data} loading={messages.loading} error={messages.error} ticket={ticket} />
          {canHandle ? (
            <Composer ticket={ticket} order={order} />
          ) : (
            <Card className="px-5 py-4 text-sm text-fg-muted">Consultation seule : le traitement des tickets est réservé à l’équipe support.</Card>
          )}
        </div>

        <aside className="min-w-0 space-y-4">
          {pendingRefund && (
            <PendingRefundCard refund={pendingRefund} canApprove={can('refunds.approve')} requestedByMe={pendingRefund.requestedBy === admin.uid && admin.role !== 'super_admin'} requesterName={agents.names.get(pendingRefund.requestedBy) ?? 'un agent'} />
          )}

          <Panel title="Délais cibles" bodyClassName="py-3">
            <dl className="divide-y divide-border">
              <InfoRow label="Première réponse">
                {ticket.firstResponseAt ? (
                  <span className={cn('num', millis(ticket.firstResponseAt) > millis(ticket.firstResponseDueAt) ? 'text-danger-soft-fg' : 'text-fg')}>
                    en {formatDuration(millis(ticket.firstResponseAt) - millis(ticket.createdAt))}
                  </span>
                ) : (
                  <SlaValue due={millis(ticket.firstResponseDueAt)} now={now} />
                )}
              </InfoRow>
              <InfoRow label="Résolution">
                {ticket.resolvedAt ? (
                  <span className="num">en {formatDuration(millis(ticket.resolvedAt) - millis(ticket.createdAt))}</span>
                ) : open ? <SlaValue due={millis(ticket.resolutionDueAt)} now={now} /> : '—'}
              </InfoRow>
              {sla && <InfoRow label="Prochaine étape">{sla.label}</InfoRow>}
              <InfoRow label="Agent">{assigneeName ?? <span className="text-fg-subtle">Non attribué</span>}</InfoRow>
            </dl>
          </Panel>

          <Panel title="Demandeur" bodyClassName="py-3">
            <div className="flex items-center gap-3 pb-3">
              <Avatar name={ticket.requesterName} />
              <div className="min-w-0">
                <div className="truncate font-medium text-fg">{ticket.requesterName}</div>
                <div className="text-xs text-fg-muted">{REQUESTER_LABELS[ticket.requesterType]}</div>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {ticket.requesterType === 'client' && <LinkChip to={`/clients/${ticket.requesterId}`} icon={<UserRound />}>Fiche client</LinkChip>}
              {ticket.restaurantId && <LinkChip to={`/restaurants/${ticket.restaurantId}`} icon={<Store />}>Restaurant</LinkChip>}
              {ticket.driverId && <LinkChip to={`/livreurs/${ticket.driverId}`} icon={<Bike />}>Livreur</LinkChip>}
            </div>
            {ticket.satisfaction && (
              <div className="mt-3 flex items-center gap-2 rounded-lg bg-surface-2 px-3 py-2 text-sm">
                <Smile className="size-4 text-fg-muted" />
                Satisfaction : <strong className="num">{ticket.satisfaction.score}/5</strong>
                {ticket.satisfaction.comment && <span className="truncate text-fg-muted">« {ticket.satisfaction.comment} »</span>}
              </div>
            )}
          </Panel>

          <Panel
            title="Commande liée"
            actions={order ? <Button size="xs" variant="ghost" asChild rightIcon={<ArrowUpRight />}><Link to={`/commandes/${order.id}`}>Ouvrir</Link></Button> : undefined}
            bodyClassName="py-3"
          >
            {!ticket.orderId ? (
              <p className="text-sm text-fg-muted">Aucune commande liée à ce ticket.</p>
            ) : orderState.loading ? (
              <Skeleton className="h-24" />
            ) : !order ? (
              <p className="text-sm text-fg-muted">Commande introuvable ou hors de votre périmètre.</p>
            ) : (
              <dl className="divide-y divide-border">
                <InfoRow label="Numéro"><span className="font-mono num">{order.number}</span></InfoRow>
                <InfoRow label="Restaurant">{order.restaurantName}</InfoRow>
                <InfoRow label="Statut">{tLabel('ORDER_STATUS_LABELS', order.status)}</InfoRow>
                <InfoRow label="Payé">{euros(order.amounts.chargedCents)} · {order.payment.method === 'cash' ? 'espèces' : 'en ligne'}</InfoRow>
                <InfoRow label="Déjà remboursé"><span className="num">{euros(order.amounts.refundedCents)}</span></InfoRow>
                <InfoRow label="Passée">{formatDateTime(millis(order.createdAt))}</InfoRow>
              </dl>
            )}
          </Panel>

          {ticket.claimId && <ClaimPanel claimId={ticket.claimId} />}

          {canHandle && open && (
            <Panel title="Actions" description="Dans la limite de vos droits ; chaque geste est tracé.">
              <div className="grid grid-cols-2 gap-2">
                <ActionButton icon={<Undo2 />} label="Rembourser" disabled={!can('refunds.create') || !order || order.payment.method === 'cash' || refundableCents <= 0 || Boolean(pendingRefund)} hint={!order ? 'Aucune commande liée' : order.payment.method === 'cash' ? 'Commande réglée en espèces' : pendingRefund ? 'Un remboursement attend une validation' : refundableCents <= 0 ? 'Rien à rembourser' : !can('refunds.create') ? 'Droit manquant' : undefined} onClick={() => setDialog('refund')} />
                <ActionButton icon={<Wallet />} label="Avoir" disabled={!can('customers.credit') || ticket.requesterType !== 'client'} hint={ticket.requesterType !== 'client' ? 'Réservé aux clients' : !can('customers.credit') ? 'Droit manquant' : undefined} onClick={() => setDialog('credit')} />
                <ActionButton icon={<MessageSquareShare />} label="Contacter" onClick={() => setDialog('contact')} />
                <ActionButton icon={<MessagesSquare />} label="Chat direct" disabled={!ticket.orderId} hint={!ticket.orderId ? 'Aucune commande liée' : undefined} onClick={() => setDialog('chat')} />
              </div>
              {limitCents !== null && limitCents < 1e9 && <p className="mt-3 text-xs text-fg-subtle">Votre plafond sans validation : {euros(limitCents)}.</p>}
            </Panel>
          )}

          <Panel title="Gestes accordés" bodyClassName="py-3">
            {refunds.data.length === 0 && !ticket.creditedCents ? (
              <p className="text-sm text-fg-muted">Aucun remboursement ni avoir sur ce ticket.</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {refunds.data.map((r) => (
                  <li key={r.id} className="flex items-center justify-between gap-3">
                    <span className="flex min-w-0 items-center gap-2"><Receipt className="size-4 shrink-0 text-fg-subtle" /><span className="truncate">Remboursement</span></span>
                    <span className="flex shrink-0 items-center gap-2">
                      <span className="font-mono num">{euros(r.amountCents)}</span>
                      <StatusBadge status={r.status} map={REFUND_STATUS_META} />
                    </span>
                  </li>
                ))}
                {ticket.creditedCents ? (
                  <li className="flex items-center justify-between gap-3">
                    <span className="flex items-center gap-2"><Wallet className="size-4 text-fg-subtle" />Avoirs</span>
                    <span className="font-mono num">{euros(ticket.creditedCents)}</span>
                  </li>
                ) : null}
              </ul>
            )}
            <div className="mt-3 flex items-center justify-between border-t border-border pt-3 text-sm">
              <span className="text-fg-muted">Coût total du litige</span>
              <span className="font-mono font-medium num">{euros(ticket.compensationCents)}</span>
            </div>
          </Panel>

          {canHandle && <DetailsPanel ticket={ticket} reasons={reasons.data.map((r) => ({ value: r.id, label: r.label.fr }))} />}
        </aside>
      </div>

      <RefundDialog open={dialog === 'refund'} onOpenChange={(o) => setDialog(o ? 'refund' : null)} ticket={ticket} order={order} refundableCents={refundableCents} limitCents={limitCents} />
      <CreditDialog open={dialog === 'credit'} onOpenChange={(o) => setDialog(o ? 'credit' : null)} ticket={ticket} limitCents={limitCents} defaultValidityDays={refundSettings.data?.walletCreditValidityDays ?? 180} />
      <ContactDialog open={dialog === 'contact'} onOpenChange={(o) => setDialog(o ? 'contact' : null)} ticket={ticket} />
      <EscalateDialog open={dialog === 'escalate'} onOpenChange={(o) => setDialog(o ? 'escalate' : null)} ticket={ticket} agents={agents.agents} />
      <LiveChatDialog open={dialog === 'chat'} onOpenChange={(o) => setDialog(o ? 'chat' : null)} ticket={ticket} />
    </PageContainer>
  );
}

const REFUND_STATUS_META = {
  requested: { label: 'Demandé', tone: 'info' as const },
  pending_approval: { label: 'À valider', tone: 'amber' as const },
  approved: { label: 'Validé', tone: 'info' as const },
  processed: { label: 'Effectué', tone: 'success' as const },
  rejected: { label: 'Refusé', tone: 'danger' as const },
  failed: { label: 'Échec', tone: 'danger' as const },
};

function SlaValue({ due, now }: { due: number; now: number }) {
  const late = due < now;
  return (
    <span className={cn('inline-flex items-center gap-1 num', late ? 'text-danger-soft-fg' : 'text-fg')}>
      <Clock className="size-3.5" />
      {late ? `en retard de ${formatDuration(now - due)}` : `dans ${formatDuration(due - now)}`}
    </span>
  );
}

function LinkChip({ to, icon, children }: { to: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <Link to={to} className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface-2 px-2.5 py-1 text-xs font-medium text-fg-muted transition-colors hover:text-fg [&_svg]:size-3.5">
      {icon}
      {children}
    </Link>
  );
}

function ActionButton({ icon, label, onClick, disabled, hint }: { icon: React.ReactNode; label: string; onClick: () => void; disabled?: boolean; hint?: string }) {
  const button = (
    <Button block variant="secondary" leftIcon={icon} disabled={disabled} onClick={onClick} className="justify-start">
      {label}
    </Button>
  );
  return hint ? <Tooltip content={hint}><span className="block">{button}</span></Tooltip> : button;
}

// ------------------------------------------------------------------ Fil

function Thread({ messages, loading, error, ticket }: { messages: WithId<TicketMessage>[]; loading: boolean; error: unknown; ticket: SupportTicket }) {
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'nearest' });
  }, [messages.length]);

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between border-b border-border px-5 py-3">
        <h2 className="font-display text-md font-semibold tracking-tight">Échanges</h2>
        <span className="text-xs text-fg-muted">{plural(messages.filter((m) => m.authorType !== 'system').length, 'message', 'messages')}</span>
      </div>
      <div className="max-h-[68vh] min-h-72 space-y-4 overflow-y-auto bg-surface-2/40 px-4 py-5 sm:px-6">
        {loading && <><Skeleton className="h-20 w-3/4" /><Skeleton className="ml-auto h-16 w-2/3" /></>}
        {Boolean(error) && <LoadError error={error} compact />}
        {!loading && messages.map((m) => <MessageItem key={m.id} message={m} ticket={ticket} />)}
        <div ref={endRef} />
      </div>
    </Card>
  );
}

function MessageItem({ message, ticket }: { message: WithId<TicketMessage>; ticket: SupportTicket }) {
  const at = millis(message.createdAt);
  if (message.authorType === 'system') {
    return (
      <div className="flex items-center gap-3 text-xs text-fg-subtle">
        <span className="h-px flex-1 bg-border" />
        <span className="flex max-w-[80%] items-center gap-1.5 text-center">
          {message.internal ? <Lock className="size-3 shrink-0" /> : <Zap className="size-3 shrink-0" />}
          <span className="whitespace-pre-line">{message.body}</span>
          <span className="min-w-0 font-mono num [overflow-wrap:anywhere]">· {formatTime(at)}</span>
        </span>
        <span className="h-px flex-1 bg-border" />
      </div>
    );
  }
  if (message.internal) {
    return (
      <div className="tone-amber rounded-xl border border-dashed border-(--tone-border) bg-(--tone-bg) px-4 py-3">
        <div className="mb-1 flex items-center gap-2 text-2xs font-medium uppercase tracking-eyebrow text-(--tone-fg)">
          <Lock className="size-3" /> Note interne · {message.authorName}
          <span className="ml-auto font-mono normal-case tracking-normal num">{formatDateTime(at)}</span>
        </div>
        <p className="whitespace-pre-line text-sm text-fg">{message.body}</p>
      </div>
    );
  }
  const mine = message.authorType === 'agent';
  return (
    <div className={cn('flex gap-3', mine && 'flex-row-reverse')}>
      <Avatar name={mine ? message.authorName : ticket.requesterName} size="sm" />
      <div className={cn('min-w-0 max-w-[85%]', mine && 'items-end text-right')}>
        <div className={cn('mb-1 flex items-center gap-2 text-xs text-fg-muted', mine && 'justify-end')}>
          <span className="font-medium text-fg">{message.authorName}</span>
          <span className="font-mono num">{formatDateTime(at)}</span>
        </div>
        <div className={cn('inline-block rounded-2xl px-4 py-2.5 text-left text-sm', mine ? 'rounded-tr-md bg-primary-soft text-fg' : 'rounded-tl-md border border-border bg-surface text-fg')}>
          <p className="whitespace-pre-line [overflow-wrap:anywhere]">{message.body}</p>
          {message.attachments.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {message.attachments.map((file) => <Attachment key={file.path} file={file} />)}
            </div>
          )}
        </div>
        {message.action && message.action.type !== 'status_change' && (
          <div className={cn('mt-1 text-2xs text-fg-subtle', mine && 'text-right')}>Action : {message.action.detail}</div>
        )}
      </div>
    </div>
  );
}

function Attachment({ file }: { file: StoredFile }) {
  const [busy, setBusy] = useState(false);
  async function open() {
    setBusy(true);
    try {
      const url = file.url ?? (await getDownloadURL(storageRef(storage, file.path)));
      window.open(url, '_blank', 'noopener');
    } finally {
      setBusy(false);
    }
  }
  return (
    <button type="button" onClick={() => void open()} disabled={busy} className="inline-flex max-w-full items-center gap-1.5 rounded-lg border border-border bg-surface-2 px-2 py-1 text-xs text-fg-muted hover:text-fg">
      <Paperclip className="size-3 shrink-0" />
      <span className="truncate">{file.name ?? file.path.split('/').pop()}</span>
    </button>
  );
}

// ------------------------------------------------------------------ Réponse

function Composer({ ticket, order }: { ticket: WithId<SupportTicket>; order: WithId<Order> | null }) {
  const [mode, setMode] = useState<'reply' | 'note'>('reply');
  const [body, setBody] = useState('');
  const [after, setAfter] = useState<string>('auto');
  const [cannedId, setCannedId] = useState<string | null>(null);
  const { mutate, loading } = useMutation(respondToTicket, { success: mode === 'note' ? 'Note ajoutée' : 'Réponse envoyée' });
  const closed = ticket.status === 'closed';

  async function send() {
    const text = body.trim();
    if (text.length < 2) return;
    const status = after === 'auto' ? null : (after as TicketStatus);
    const r = await mutate({ ticketId: ticket.id, body: text, internal: mode === 'note', status, cannedResponseId: cannedId });
    if (r) {
      setBody('');
      setCannedId(null);
      setAfter('auto');
    }
  }

  const firstName = ticket.requesterName.split(/[\s·]/)[0] ?? '';
  function insertCanned(response: WithId<CannedResponse>) {
    const text = richTextToPlain(response.body.fr)
      .replaceAll('{prenom}', firstName)
      .replaceAll('{commande}', order?.number ?? '')
      .replaceAll('{restaurant}', order?.restaurantName ?? '');
    setBody((current) => (current.trim() ? `${current.trim()}\n\n${text}` : text));
    setCannedId(response.id);
    setMode('reply');
  }

  return (
    <Card className={cn('overflow-hidden', mode === 'note' && 'tone-amber border-(--tone-border)')}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2">
        <SegmentedControl
          size="sm"
          value={mode}
          onValueChange={(v) => setMode(v as 'reply' | 'note')}
          options={[{ value: 'reply', label: 'Répondre', icon: <CornerDownLeft /> }, { value: 'note', label: 'Note interne', icon: <Lock /> }]}
          aria-label="Type de message"
        />
        <CannedPicker onPick={insertCanned} reasonId={ticket.reasonId} />
      </div>
      {closed && mode === 'reply' ? (
        <p className="px-5 py-6 text-sm text-fg-muted">Ce ticket est fermé. Rouvrez-le (menu Statut) pour écrire au demandeur, ou ajoutez une note interne.</p>
      ) : (
        <Textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
              e.preventDefault();
              void send();
            }
          }}
          rows={5}
          maxLength={5000}
          placeholder={mode === 'note' ? 'Note visible uniquement par l’équipe GoLink…' : `Répondre à ${ticket.requesterName}…`}
          className={cn('rounded-none border-0 bg-transparent shadow-none focus-visible:ring-0', mode === 'note' && 'bg-(--tone-bg)')}
          aria-label="Message"
        />
      )}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border bg-surface-2 px-4 py-2.5">
        <div className="flex items-center gap-2 text-xs text-fg-muted">
          <span className="hidden sm:inline">Statut après envoi</span>
          <Select
            size="sm"
            value={after}
            onValueChange={setAfter}
            className="w-52"
            aria-label="Statut après envoi"
            options={[
              { value: 'auto', label: mode === 'note' ? 'Inchangé' : 'En attente de réponse' },
              ...TICKET_STATUSES.filter((s) => s !== ticket.status).map((s) => ({ value: s, label: TICKET_STATUS_LABELS[s] })),
            ]}
          />
        </div>
        <Button variant="primary" leftIcon={mode === 'note' ? <Lock /> : <Send />} loading={loading} disabled={body.trim().length < 2 || (closed && mode === 'reply')} onClick={() => void send()}>
          {mode === 'note' ? 'Ajouter la note' : 'Envoyer'}
        </Button>
      </div>
    </Card>
  );
}

function CannedPicker({ onPick, reasonId }: { onPick: (r: WithId<CannedResponse>) => void; reasonId: string }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const q = useMemo(() => query(collection(db, COLLECTIONS.cannedResponses), orderBy('title'), limit(200)), []);
  const { data, loading } = useCollection<CannedResponse>(q);
  const list = data
    .filter((r) => r.active)
    .filter((r) => !search || `${r.title} ${r.body.fr} ${r.shortcut ?? ''}`.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => Number(b.reasonIds.includes(reasonId)) - Number(a.reasonIds.includes(reasonId)));
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button size="sm" variant="ghost" rightIcon={<ChevronDown />}>Réponses types</Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(92vw,380px)] p-0">
        <div className="border-b border-border p-2">
          <Input size="sm" leading={<Search />} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Rechercher une réponse…" autoFocus />
        </div>
        <ul className="max-h-80 overflow-y-auto p-1">
          {loading && <li className="p-3"><Skeleton className="h-10" /></li>}
          {!loading && list.length === 0 && <li className="px-3 py-6 text-center text-sm text-fg-muted">Aucune réponse type.</li>}
          {list.map((r) => (
            <li key={r.id}>
              <button type="button" onClick={() => { onPick(r); setOpen(false); }} className="w-full rounded-lg px-3 py-2 text-left hover:bg-surface-3">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium text-fg">{r.title}</span>
                  {r.reasonIds.includes(reasonId) && <Badge tone="brand" size="sm">Suggérée</Badge>}
                  {r.shortcut && <span className="ml-auto font-mono text-2xs text-fg-subtle">{r.shortcut}</span>}
                </div>
                <p className="mt-0.5 line-clamp-2 text-xs text-fg-muted" title={String(richTextToPlain(r.body.fr) ?? '')}>{richTextToPlain(r.body.fr)}</p>
              </button>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}

// ------------------------------------------------------------------ Attribution, statut, détails

function AssignMenu({ ticket, agents, assigneeName, myUid, onDone }: { ticket: WithId<SupportTicket>; agents: { uid: string; displayName: string; openTickets: number; canHandle: boolean }[]; assigneeName: string | null; myUid: string; onDone: () => void }) {
  const { mutate, loading } = useMutation(assignTickets, { success: 'Attribution mise à jour' });
  async function assign(uid: string | null) {
    if (await mutate({ ticketIds: [ticket.id], assigneeId: uid })) onDone();
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button leftIcon={assigneeName ? <Avatar name={assigneeName} size="xs" /> : <UserPlus />} rightIcon={<ChevronDown />} loading={loading}>
          <span className="max-w-40 truncate">{assigneeName ?? 'Attribuer'}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        {ticket.assigneeId !== myUid && <DropdownMenuItem icon={<UserPlus />} onSelect={() => void assign(myUid)}>M’attribuer ce ticket</DropdownMenuItem>}
        <DropdownMenuLabel>Agents</DropdownMenuLabel>
        {agents.filter((a) => a.canHandle && a.uid !== ticket.assigneeId).map((a) => (
          <DropdownMenuItem key={a.uid} onSelect={() => void assign(a.uid)}>
            <Avatar name={a.displayName} size="xs" />
            <span className="min-w-0 flex-1 truncate">{a.displayName}</span>
            <span className="font-mono text-2xs text-fg-subtle num">{a.openTickets}</span>
          </DropdownMenuItem>
        ))}
        {ticket.assigneeId && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem destructive onSelect={() => void assign(null)}>Retirer l’attribution</DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function StatusMenu({ ticket }: { ticket: WithId<SupportTicket> }) {
  const { mutate, loading } = useMutation(updateTicket, { success: 'Statut mis à jour' });
  const [confirm, setConfirm] = useState<TicketStatus | null>(null);
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="primary" leftIcon={<CheckCircle2 />} rightIcon={<ChevronDown />} loading={loading}>Statut</Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          {TICKET_STATUSES.filter((s) => s !== ticket.status).map((s) => (
            <DropdownMenuItem key={s} onSelect={() => (s === 'closed' ? setConfirm(s) : void mutate({ ticketId: ticket.id, status: s }))}>
              {TICKET_STATUS_LABELS[s]}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(o) => !o && setConfirm(null)}
        title="Fermer ce ticket ?"
        description="Le demandeur est informé. Il pourra encore rouvrir sa demande pendant 14 jours."
        confirmLabel="Fermer le ticket"
        onConfirm={async () => { await mutate({ ticketId: ticket.id, status: 'closed' }); }}
      />
    </>
  );
}

function DetailsPanel({ ticket, reasons }: { ticket: WithId<SupportTicket>; reasons: { value: string; label: string }[] }) {
  const { mutate } = useMutation(updateTicket, { success: 'Ticket mis à jour' });
  const [tag, setTag] = useState('');
  return (
    <Panel title="Qualification" bodyClassName="space-y-3">
      <label className="block text-xs text-fg-muted">
        Motif
        <Select className="mt-1" value={ticket.reasonId} onValueChange={(v) => void mutate({ ticketId: ticket.id, reasonId: v })} options={reasons} />
      </label>
      <label className="block text-xs text-fg-muted">
        Priorité
        <Select className="mt-1" value={ticket.priority} onValueChange={(v) => void mutate({ ticketId: ticket.id, priority: v as SupportTicket['priority'] })} options={TICKET_PRIORITIES.map((p) => ({ value: p, label: TICKET_PRIORITY_LABELS[p] }))} />
      </label>
      <div>
        <div className="text-xs text-fg-muted">Étiquettes</div>
        <div className="mt-1 flex flex-wrap gap-1.5">
          {ticket.tags.map((t) => (
            <button key={t} type="button" onClick={() => void mutate({ ticketId: ticket.id, tags: ticket.tags.filter((x) => x !== t) })} className="rounded-full border border-border bg-surface-2 px-2 py-0.5 text-xs text-fg-muted hover:border-danger/40 hover:text-fg" aria-label={`Retirer l’étiquette ${t}`}>
              #{t} ×
            </button>
          ))}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const value = tag.trim().toLowerCase();
              if (value && !ticket.tags.includes(value)) void mutate({ ticketId: ticket.id, tags: [...ticket.tags, value] });
              setTag('');
            }}
          >
            <Input size="sm" value={tag} onChange={(e) => setTag(e.target.value)} placeholder="+ étiquette" className="h-7 w-28" maxLength={30} />
          </form>
        </div>
      </div>
    </Panel>
  );
}

function PendingRefundCard({ refund, canApprove, requestedByMe, requesterName }: { refund: WithId<Refund>; canApprove: boolean; requestedByMe: boolean; requesterName: string }) {
  const [decision, setDecision] = useState<'approve' | 'reject' | null>(null);
  const { mutate } = useMutation(reviewTicketRefund, { success: (r) => (r.status === 'approved' ? 'Remboursement validé' : 'Remboursement refusé') });
  return (
    <Card className="tone-amber border-(--tone-border) bg-(--tone-bg) p-4">
      <div className="text-2xs font-medium uppercase tracking-eyebrow text-(--tone-fg)">Validation requise</div>
      <div className="mt-1 font-display text-xl font-semibold num text-fg">{euros(refund.amountCents)}</div>
      <p className="mt-1 text-sm text-fg-muted">Demandé par {requesterName} {formatRelative(millis(refund.requestedAt))} : {refund.reason}</p>
      {canApprove ? (
        requestedByMe ? (
          <p className="mt-3 text-xs text-fg-muted">Vous avez fait cette demande : un autre responsable doit la valider.</p>
        ) : (
          <div className="mt-3 flex gap-2">
            <Button size="sm" variant="primary" onClick={() => setDecision('approve')}>Valider</Button>
            <Button size="sm" variant="ghost" onClick={() => setDecision('reject')}>Refuser</Button>
          </div>
        )
      ) : (
        <p className="mt-3 text-xs text-fg-muted">En attente d’un responsable habilité à valider les remboursements.</p>
      )}
      <ConfirmDialog
        open={decision !== null}
        onOpenChange={(o) => !o && setDecision(null)}
        title={decision === 'approve' ? `Valider le remboursement de ${euros(refund.amountCents)} ?` : 'Refuser ce remboursement ?'}
        description={decision === 'approve' ? 'Le client est remboursé immédiatement sur son moyen de paiement ; le montant est imputé selon la règle en vigueur.' : 'L’agent est notifié du refus et du motif.'}
        confirmLabel={decision === 'approve' ? 'Valider et rembourser' : 'Refuser'}
        destructive={decision === 'reject'}
        requireReason
        onConfirm={async (reason) => {
          if (decision) await mutate({ refundId: refund.id, decision, reason: reason ?? '' });
        }}
      />
    </Card>
  );
}

