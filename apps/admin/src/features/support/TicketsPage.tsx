import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { collection, limit, orderBy, query, where } from 'firebase/firestore';
import { AlertOctagon, ArrowUpRight, CheckCheck, Flame, Inbox, Plus, Smile, TimerOff, UserPlus, UserRound, Users } from 'lucide-react';
import {
  Avatar,
  Button,
  Card,
  DataTable,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  EmptyState,
  PageContainer,
  PageHeader,
  SegmentedControl,
  createColumnHelper,
  formatRelative,
  toast,
} from '@golink/ui';
import { COLLECTIONS, type AssignTicketsInput, type Refund, type SupportTicket, type UpdateTicketInput, type WithId } from '@golink/shared';
import { useDocumentTitle } from '@golink/web';
import { useAdminAccess } from '@/auth/AdminAccess';
import { db } from '@/lib/firebase';
import { callFunction, errorMessage, useCollection } from '@/lib/firestore';
import { euros, millis, plural } from '../_experience/format';
import { Kpi, LoadError } from '../_experience/ui';
import { NewTicketDialog, PriorityBadge, RequesterBadge, SlaChip, SupportNav, TicketStatusBadge, isOpenTicket, slaState } from './components';
import { useSupportAgents, useTicketReasons, useTickets } from './hooks';

type Queue = 'mine' | 'unassigned' | 'escalated' | 'open' | 'done' | 'all';

const assignTickets = callFunction<AssignTicketsInput, { changed: number }>('assignTickets');
const updateTicket = callFunction<UpdateTicketInput, { changed: boolean }>('updateTicket');
const col = createColumnHelper<WithId<SupportTicket>>();

export function TicketsPage() {
  useDocumentTitle('Support · Ciyou Eats Admin');
  const navigate = useNavigate();
  const { admin, can } = useAdminAccess();
  const uid = admin.uid;
  const tickets = useTickets();
  const reasons = useTicketReasons();
  const agents = useSupportAgents();
  const [queue, setQueue] = useState<Queue>(can('support.handle') ? 'mine' : 'open');
  const [creating, setCreating] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  const pendingRefundsQuery = useMemo(
    () => (can('refunds.approve') ? query(collection(db, COLLECTIONS.refunds), where('status', '==', 'pending_approval'), orderBy('requestedAt', 'desc'), limit(20)) : null),
    [can],
  );
  const pendingRefunds = useCollection<Refund>(pendingRefundsQuery).data.filter((r) => r.ticketId);

  const open = tickets.data.filter(isOpenTicket);
  const counts = {
    mine: open.filter((t) => t.assigneeId === uid).length,
    unassigned: open.filter((t) => !t.assigneeId).length,
    escalated: open.filter((t) => t.escalated).length,
    open: open.length,
  };
  const overdue = open.filter((t) => (slaState(t, now)?.remaining ?? 1) < 0).length;
  const rated = tickets.data.filter((t) => t.satisfaction);
  const satisfaction = rated.length ? rated.reduce((s, t) => s + (t.satisfaction?.score ?? 0), 0) / rated.length : null;

  const rows = useMemo(() => {
    const list = tickets.data.filter((t) => {
      switch (queue) {
        case 'mine': return isOpenTicket(t) && t.assigneeId === uid;
        case 'unassigned': return isOpenTicket(t) && !t.assigneeId;
        case 'escalated': return isOpenTicket(t) && t.escalated;
        case 'open': return isOpenTicket(t);
        case 'done': return !isOpenTicket(t);
        default: return true;
      }
    });
    // File de travail : urgences et échéances d'abord.
    if (queue !== 'done' && queue !== 'all') {
      const rank = { urgent: 0, high: 1, normal: 2, low: 3 } as const;
      list.sort((a, b) => rank[a.priority] - rank[b.priority] || (slaState(a, now)?.due ?? 0) - (slaState(b, now)?.due ?? 0));
    }
    return list;
  }, [tickets.data, queue, uid, now]);

  async function assign(ids: string[], assigneeId: string | null, clear?: () => void) {
    try {
      const r = await assignTickets({ ticketIds: ids, assigneeId });
      toast.success(r.changed ? `${plural(r.changed, 'ticket attribué', 'tickets attribués')}` : 'Aucun changement');
      clear?.();
      agents.reload();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  async function resolve(ids: string[], clear: () => void) {
    let done = 0;
    for (const ticketId of ids) {
      try {
        const r = await updateTicket({ ticketId, status: 'resolved' });
        if (r.changed) done += 1;
      } catch (e) {
        toast.error(errorMessage(e));
      }
    }
    if (done) toast.success(`${plural(done, 'ticket résolu', 'tickets résolus')}`);
    clear();
  }

  const columns = useMemo(
    () => [
      col.accessor('number', {
        header: 'Ticket',
        cell: ({ row }) => {
          const t = row.original;
          return (
            <div className="min-w-0 max-w-md sm:min-w-56">
              <div className="flex items-center gap-2">
                <span className="font-mono text-2xs text-fg-subtle num">{t.number}</span>
                {t.escalated && <span className="tone-danger inline-flex items-center gap-1 rounded-full bg-(--tone-bg) px-1.5 py-px text-2xs font-medium text-(--tone-fg)"><Flame className="size-3" />Escaladé</span>}
                {t.unreadBySupport > 0 && <span className="size-2 rounded-full bg-primary" aria-label="Non lu" />}
              </div>
              <div className="mt-0.5 truncate font-medium text-fg">{t.subject}</div>
              <div className="truncate text-xs text-fg-muted">{t.lastMessagePreview}</div>
            </div>
          );
        },
      }),
      col.accessor('requesterName', {
        header: 'Demandeur',
        cell: ({ row }) => (
          <div className="min-w-36">
            <RequesterBadge type={row.original.requesterType} />
            <div className="mt-1 truncate text-sm text-fg">{row.original.requesterName}</div>
          </div>
        ),
      }),
      col.accessor((t) => reasons.labels.get(t.reasonId) ?? t.reasonId, { id: 'reason', header: 'Motif', cell: (i) => <span className="whitespace-nowrap text-sm text-fg-muted">{i.getValue()}</span> }),
      col.accessor('status', {
        header: 'Statut',
        cell: ({ row }) => (
          <div className="flex flex-col items-start gap-1">
            <TicketStatusBadge status={row.original.status} />
            <PriorityBadge priority={row.original.priority} />
          </div>
        ),
      }),
      col.accessor((t) => slaState(t, now)?.remaining ?? Number.MAX_SAFE_INTEGER, { id: 'sla', header: 'Échéance', cell: ({ row }) => <SlaChip ticket={row.original} now={now} /> }),
      col.accessor((t) => (t.assigneeId ? (agents.names.get(t.assigneeId) ?? 'Agent') : ''), {
        id: 'assignee',
        header: 'Agent',
        cell: (i) => i.getValue()
          ? <span className="flex items-center gap-2 whitespace-nowrap text-sm"><Avatar name={i.getValue()} size="xs" />{i.getValue()}</span>
          : <span className="text-xs text-fg-subtle">Non attribué</span>,
      }),
      col.accessor((t) => millis(t.lastMessageAt), { id: 'last', header: 'Activité', cell: (i) => <span className="whitespace-nowrap text-xs text-fg-muted">{formatRelative(i.getValue())}</span> }),
    ],
    [reasons.labels, agents.names, now],
  );

  const queueOptions = [
    ...(can('support.handle') ? [{ value: 'mine', label: 'Mes tickets', count: counts.mine }] : []),
    { value: 'unassigned', label: 'Non attribués', count: counts.unassigned },
    { value: 'escalated', label: 'Escaladés', count: counts.escalated },
    { value: 'open', label: 'Tous ouverts', count: counts.open },
    { value: 'done', label: 'Traités' },
    { value: 'all', label: 'Tous' },
  ];

  return (
    <PageContainer wide>
      <PageHeader
        eyebrow="Opérations"
        title="Support et litiges"
        description="Demandes des clients, restaurants et livreurs, liées aux commandes. Support assuré 24 h/24, 7 j/7."
        actions={can('support.handle') ? <Button variant="primary" leftIcon={<Plus />} onClick={() => setCreating(true)}>Nouveau ticket</Button> : undefined}
      />
      <SupportNav openCount={counts.open} />

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Kpi label="Tickets ouverts" value={tickets.loading ? '…' : counts.open} icon={<Inbox />} tone="brand" hint={`${counts.unassigned} sans agent`} />
        <Kpi label="Hors délai" value={tickets.loading ? '…' : overdue} icon={<TimerOff />} tone={overdue ? 'danger' : 'success'} hint="Échéance dépassée" />
        <Kpi label="Escaladés" value={tickets.loading ? '…' : counts.escalated} icon={<AlertOctagon />} tone={counts.escalated ? 'amber' : 'neutral'} hint="Attendent un responsable" />
        <Kpi label="Satisfaction" value={satisfaction ? `${satisfaction.toFixed(1).replace('.', ',')} / 5` : '—'} icon={<Smile />} tone="success" hint={plural(rated.length, 'évaluation', 'évaluations')} />
        <Kpi label="Mes tickets" value={tickets.loading ? '…' : counts.mine} icon={<UserRound />} tone="info" hint={can('support.handle') ? 'Qui me sont attribués' : 'Consultation seule'} />
      </div>

      {pendingRefunds.length > 0 && (
        <Card className="tone-amber mb-6 border-(--tone-border) bg-(--tone-bg) px-5 py-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="font-medium text-(--tone-fg)">{plural(pendingRefunds.length, 'remboursement attend', 'remboursements attendent')} votre validation</div>
              <div className="text-sm text-(--tone-fg)/80">Au-delà du plafond de l’agent : {pendingRefunds.slice(0, 3).map((r) => `${r.orderNumber} (${euros(r.amountCents)})`).join(' · ')}</div>
            </div>
            <Button size="sm" asChild rightIcon={<ArrowUpRight />}>
              <Link to={`/support/${pendingRefunds[0]!.ticketId}`}>Examiner</Link>
            </Button>
          </div>
        </Card>
      )}

      <div className="mb-4 overflow-x-auto [scrollbar-width:none]">
        <SegmentedControl value={queue} onValueChange={(v) => setQueue(v as Queue)} options={queueOptions} aria-label="File de tickets" />
      </div>

      {tickets.error ? (
        <Card><LoadError error={tickets.error} /></Card>
      ) : (
        <DataTable
          data={rows}
          columns={columns}
          loading={tickets.loading}
          getRowId={(t) => t.id}
          onRowClick={(t) => navigate(`/support/${t.id}`)}
          itemLabel="tickets"
          searchPlaceholder="Rechercher un ticket, un demandeur, une commande…"
          pageSize={25}
          filters={[
            { id: 'type', label: 'Demandeur', options: [{ value: 'client', label: 'Clients' }, { value: 'restaurant', label: 'Restaurants' }, { value: 'driver', label: 'Livreurs' }], getValue: (t) => t.requesterType },
            { id: 'priority', label: 'Priorité', options: [{ value: 'urgent', label: 'Urgente' }, { value: 'high', label: 'Haute' }, { value: 'normal', label: 'Normale' }, { value: 'low', label: 'Basse' }], getValue: (t) => t.priority },
            { id: 'reason', label: 'Motif', options: reasons.data.map((r) => ({ value: r.id, label: r.label.fr })), getValue: (t) => t.reasonId },
          ]}
          bulkActions={can('support.handle') ? [
            { label: 'M’attribuer', icon: <UserPlus />, onClick: (sel, clear) => void assign(sel.map((t) => t.id), uid, clear) },
            { label: 'Retirer l’agent', icon: <Users />, onClick: (sel, clear) => void assign(sel.map((t) => t.id), null, clear) },
            { label: 'Marquer résolus', icon: <CheckCheck />, onClick: (sel, clear) => void resolve(sel.filter(isOpenTicket).map((t) => t.id), clear) },
          ] : undefined}
          toolbar={can('support.handle') && agents.agents.length > 0 ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" leftIcon={<Users />}>Charge de l’équipe</Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-72">
                <DropdownMenuLabel>Tickets ouverts par agent</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {agents.agents.filter((a) => a.canHandle).map((a) => (
                  <DropdownMenuItem key={a.uid} onSelect={(e) => e.preventDefault()}>
                    <Avatar name={a.displayName} size="xs" />
                    <span className="min-w-0 flex-1 truncate">{a.displayName}</span>
                    <span className="font-mono text-2xs text-fg-muted num">{a.openTickets}{a.overdueTickets ? ` · ${a.overdueTickets} en retard` : ''}</span>
                  </DropdownMenuItem>
                ))}
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={(e) => e.preventDefault()}>
                  <span className="flex-1 text-fg-muted">Sans agent</span>
                  <span className="font-mono text-2xs num">{agents.unassigned}</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : undefined}
          emptyState={
            <EmptyState
              compact
              icon={<Inbox />}
              title={queue === 'mine' ? 'Aucun ticket ne vous est attribué' : queue === 'escalated' ? 'Aucune escalade en cours' : 'Aucun ticket'}
              description={queue === 'mine' ? 'Prenez un ticket dans la file « Non attribués ».' : 'Les nouvelles demandes apparaîtront ici en temps réel.'}
              action={queue === 'mine' && counts.unassigned > 0 ? <Button size="sm" onClick={() => setQueue('unassigned')}>Voir les {counts.unassigned} tickets non attribués</Button> : undefined}
            />
          }
        />
      )}
      <NewTicketDialog open={creating} onOpenChange={setCreating} />
    </PageContainer>
  );
}
