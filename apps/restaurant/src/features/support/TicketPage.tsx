import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router';
import { orderBy, query, serverTimestamp, updateDoc, where } from 'firebase/firestore';
import { ArrowLeft, CheckCircle2, Headphones, LifeBuoy, Lock, Paperclip, RotateCcw, Send, ShoppingBag, Star, X } from 'lucide-react';
import {
  Avatar,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  ConfirmDialog,
  EmptyState,
  PageContainer,
  PageHeader,
  Skeleton,
  StatusBadge,
  Textarea,
  cn,
  formatDateTime,
  formatRelative,
  toast,
} from '@golink/ui';
import { COLLECTIONS, paths, type SupportTicket, type TicketMessage, type WithId } from '@golink/shared';
import { useAuth } from '@golink/web';
import { useCan } from '@/auth/RestaurantAccess';
import { collectionAt, docAt, errorMessage, toDate, toMillis, useCollection, useDoc, useMutation } from '@/lib/firestore';
import { Attachment, PRIORITY_TONE, TICKET_PRIORITY_LABELS, TICKET_STATUS, replyToSupportTicket, updateSupportTicket, uploadTicketFiles, useTicketReasons } from './lib';

type MessageRow = WithId<TicketMessage>;
const MAX_FILE = 10 * 1024 * 1024;

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-border py-2.5 text-sm last:border-0">
      <dt className="text-fg-muted">{label}</dt>
      <dd className="text-right font-medium text-fg">{children}</dd>
    </div>
  );
}

export function TicketPage() {
  const { ticketId = '' } = useParams();
  const can = useCan();
  const { user } = useAuth();
  const allowed = can('support.use');
  const ticketState = useDoc<SupportTicket>(allowed ? docAt(`${COLLECTIONS.supportTickets}/${ticketId}`) : null);
  const ticket = ticketState.data;
  const messages = useCollection<TicketMessage>(
    ticket ? query(collectionAt(paths.ticketMessages(ticketId)), where('internal', '==', false), orderBy('createdAt', 'asc')) : null,
  );
  const reasons = useTicketReasons();
  const [confirm, setConfirm] = useState<'close' | 'reopen' | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const change = useMutation(updateSupportTicket, { success: (r) => (r.status === 'closed' ? 'Demande fermée.' : 'Demande rouverte.') });

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [messages.data.length]);

  // Lecture des réponses du support.
  useEffect(() => {
    if (ticket && ticket.unreadByRequester > 0) void updateDoc(docAt(`${COLLECTIONS.supportTickets}/${ticketId}`), { unreadByRequester: 0 }).catch(() => undefined);
  }, [ticket, ticketId]);

  if (ticketState.loading) {
    return (
      <PageContainer>
        <Skeleton className="h-8 w-72" />
        <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
          <Skeleton className="h-[480px] rounded-xl" />
          <Skeleton className="h-72 rounded-xl" />
        </div>
      </PageContainer>
    );
  }

  if (!ticket || ticket.requesterType !== 'restaurant') {
    return (
      <PageContainer>
        <Card>
          <EmptyState
            icon={<LifeBuoy />}
            title="Demande introuvable"
            description={ticketState.error ? errorMessage(ticketState.error) : 'Cette demande n’existe pas ou appartient à un autre établissement.'}
            action={
              <Button asChild variant="secondary" leftIcon={<ArrowLeft />}>
                <Link to="/support">Retour au support</Link>
              </Button>
            }
          />
        </Card>
      </PageContainer>
    );
  }

  const done = ticket.status === 'resolved' || ticket.status === 'closed';
  const reason = reasons.data.find((r) => r.id === ticket.reasonId)?.label.fr ?? '—';
  const firstDue = toDate(ticket.firstResponseDueAt);
  const resolutionDue = toDate(ticket.resolutionDueAt);

  return (
    <PageContainer>
      <PageHeader
        breadcrumbs={[{ label: 'Support Ciyou Eats', href: '/support' }, { label: ticket.number }]}
        eyebrow={`Demande ${ticket.number}`}
        title={ticket.subject}
        actions={
          done ? (
            <Button variant="secondary" leftIcon={<RotateCcw />} onClick={() => setConfirm('reopen')} disabled={change.loading}>
              Rouvrir
            </Button>
          ) : (
            <Button variant="secondary" leftIcon={<CheckCircle2 />} onClick={() => setConfirm('close')} disabled={change.loading}>
              Marquer comme réglée
            </Button>
          )
        }
      >
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={ticket.status} map={TICKET_STATUS} />
          <Badge tone={PRIORITY_TONE[ticket.priority]}>Priorité {TICKET_PRIORITY_LABELS[ticket.priority].toLowerCase()}</Badge>
          {ticket.escalated && <Badge tone="plum">Transmise à un responsable</Badge>}
        </div>
      </PageHeader>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Card className="flex min-w-0 flex-col">
          <div className="max-h-[calc(100dvh-22rem)] min-h-80 space-y-5 overflow-y-auto p-5">
            {messages.loading ? (
              <>
                <Skeleton className="h-20" />
                <Skeleton className="ml-auto h-20 w-2/3" />
              </>
            ) : messages.error ? (
              <EmptyState compact title="Messages indisponibles" description={errorMessage(messages.error)} />
            ) : (
              messages.data.map((m) => <TicketBubble key={m.id} message={m} mine={m.authorId === user?.uid} />)
            )}
            <div ref={bottomRef} />
          </div>
          {ticket.status === 'closed' ? (
            <div className="flex flex-col gap-3 border-t border-border bg-surface-2 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
              <p className="flex items-center gap-2 text-sm text-fg-muted">
                <Lock className="size-4" /> Demande fermée {ticket.closedAt ? formatRelative(toDate(ticket.closedAt) ?? new Date()) : ''}.
              </p>
              <Button size="sm" variant="secondary" leftIcon={<RotateCcw />} onClick={() => setConfirm('reopen')}>
                Rouvrir la demande
              </Button>
            </div>
          ) : (
            <TicketComposer ticketId={ticketId} status={ticket.status} />
          )}
        </Card>

        <div className="min-w-0 space-y-6">
          {done && <Satisfaction ticket={{ ...ticket, id: ticketId }} />}
          <Card>
            <CardHeader title="Détails" />
            <CardContent>
              <dl>
                <Row label="Motif">{reason}</Row>
                <Row label="Ouverte">{formatDateTime(toDate(ticket.createdAt) ?? new Date())}</Row>
                <Row label="Par">{ticket.requesterName}</Row>
                {ticket.orderId && (
                  <Row label="Commande">
                    <Link to={`/commandes/${ticket.orderId}`} className="inline-flex items-center gap-1 font-mono text-primary-soft-fg hover:underline">
                      <ShoppingBag className="size-3.5" />
                      {ticket.orderId}
                    </Link>
                  </Row>
                )}
                {!done && firstDue && !ticket.firstResponseAt && <Row label="Réponse attendue">{toMillis(firstDue)! < Date.now() ? 'Imminente' : formatRelative(firstDue)}</Row>}
                {ticket.firstResponseAt && <Row label="Première réponse">{formatRelative(toDate(ticket.firstResponseAt) ?? new Date())}</Row>}
                {!done && resolutionDue && <Row label="Résolution visée">{formatDateTime(resolutionDue)}</Row>}
              </dl>
            </CardContent>
          </Card>
        </div>
      </div>

      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(open) => !open && setConfirm(null)}
        title={confirm === 'close' ? 'Votre demande est réglée ?' : 'Rouvrir la demande ?'}
        description={confirm === 'close' ? 'La demande sera fermée. Vous pourrez la rouvrir pendant 14 jours si besoin.' : 'Le support Ciyou Eats sera prévenu et reprendra le fil.'}
        confirmLabel={confirm === 'close' ? 'Fermer la demande' : 'Rouvrir'}
        onConfirm={async () => {
          if (confirm) await change.mutate({ ticketId, action: confirm });
        }}
      />
    </PageContainer>
  );
}

function TicketBubble({ message: m, mine }: { message: MessageRow; mine: boolean }) {
  const time = toDate(m.createdAt);
  if (m.authorType === 'system') {
    return (
      <p className="flex items-center justify-center gap-2 text-center text-xs text-fg-subtle">
        <span className="h-px w-8 bg-border" /> {m.body} · {time ? formatRelative(time) : ''} <span className="h-px w-8 bg-border" />
      </p>
    );
  }
  const agent = m.authorType === 'agent';
  return (
    <div className={cn('flex gap-3', mine && 'flex-row-reverse')}>
      {agent ? (
        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-contrast text-contrast-fg">
          <Headphones className="size-4" />
        </span>
      ) : (
        <Avatar name={m.authorName} />
      )}
      <div className={cn('min-w-0 max-w-[85%]', mine && 'text-right')}>
        <p className="mb-1 text-xs text-fg-muted">
          <span className="font-medium text-fg">{agent ? `${m.authorName.split(' (')[0]} · Support Ciyou Eats` : m.authorName}</span> · {time ? formatDateTime(time) : ''}
        </p>
        <div className={cn('inline-block rounded-2xl px-4 py-3 text-left text-sm leading-6', mine ? 'rounded-tr-md bg-primary-soft text-fg' : 'rounded-tl-md border border-border bg-surface-2 text-fg')}>
          <p className="whitespace-pre-line break-words">{m.body}</p>
          {m.action && (
            <p className="mt-2">
              <Badge size="sm" tone="success">
                {m.action.detail}
              </Badge>
            </p>
          )}
        </div>
        {m.attachments?.length > 0 && (
          <div className={cn('mt-2 flex flex-wrap gap-2', mine && 'justify-end')}>
            {m.attachments.map((a) => (
              <Attachment key={a.path} file={a} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function TicketComposer({ ticketId, status }: { ticketId: string; status: SupportTicket['status'] }) {
  const [body, setBody] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const send = useMutation(
    async () => {
      const attachments = files.length ? await uploadTicketFiles(ticketId, files) : [];
      return replyToSupportTicket({ ticketId, body: body.trim(), attachments, appendToMessageId: null });
    },
    { success: 'Message envoyé au support.' },
  );
  const names = useMemo(() => files.map((f) => f.name), [files]);

  return (
    <div className="border-t border-border p-4">
      {status === 'waiting_customer' && <p className="mb-2 text-xs font-medium text-(--tone-fg) tone-amber">Le support attend votre réponse pour avancer.</p>}
      {status === 'resolved' && <p className="mb-2 text-xs text-fg-muted">Cette demande est marquée résolue : répondre la rouvrira.</p>}
      <Textarea rows={3} maxLength={5000} placeholder="Votre réponse au support…" value={body} onChange={(e) => setBody(e.target.value)} aria-label="Votre réponse" />
      {names.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {names.map((n, i) => (
            <Badge key={`${n}-${i}`} icon={<Paperclip />}>
              {n}
              <button type="button" aria-label={`Retirer ${n}`} onClick={() => setFiles(files.filter((_, j) => j !== i))} className="ml-1">
                <X className="size-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}
      <div className="mt-2 flex items-center justify-between gap-2">
        <input
          ref={inputRef}
          type="file"
          multiple
          accept="image/jpeg,image/png,image/webp,application/pdf"
          className="hidden"
          onChange={(e) => {
            const accepted = Array.from(e.target.files ?? []).filter((f) => {
              if (f.size > MAX_FILE) toast.error(`${f.name} dépasse 10 Mo.`);
              return f.size <= MAX_FILE;
            });
            setFiles((current) => [...current, ...accepted].slice(0, 5));
            e.target.value = '';
          }}
        />
        <Button size="sm" variant="ghost" leftIcon={<Paperclip />} onClick={() => inputRef.current?.click()} disabled={files.length >= 5}>
          Joindre
        </Button>
        <Button
          variant="primary"
          leftIcon={<Send />}
          loading={send.loading}
          disabled={!body.trim() && files.length === 0}
          onClick={async () => {
            const done = await send.mutate();
            if (done) {
              setBody('');
              setFiles([]);
            }
          }}
        >
          Envoyer
        </Button>
      </div>
    </div>
  );
}

function Satisfaction({ ticket }: { ticket: WithId<SupportTicket> }) {
  const [hover, setHover] = useState(0);
  const [comment, setComment] = useState('');
  const [score, setScore] = useState(0);
  const save = useMutation(
    async () => {
      await updateDoc(docAt(`${COLLECTIONS.supportTickets}/${ticket.id}`), {
        satisfaction: { score, comment: comment.trim() || null, at: serverTimestamp() },
        updatedAt: serverTimestamp(),
      });
      return true;
    },
    { success: 'Merci pour votre avis !' },
  );
  if (ticket.satisfaction) {
    return (
      <Card padding="md">
        <p className="text-sm font-medium text-fg">Votre évaluation</p>
        <p className="mt-1 flex gap-0.5">
          {[1, 2, 3, 4, 5].map((i) => (
            <Star key={i} className={cn('size-4', i <= ticket.satisfaction!.score ? 'fill-amber-400 text-amber-400' : 'text-border-strong')} />
          ))}
        </p>
        {ticket.satisfaction.comment && <p className="mt-2 text-sm text-fg-muted">{ticket.satisfaction.comment}</p>}
      </Card>
    );
  }
  return (
    <Card padding="md" className="space-y-3">
      <p className="text-sm font-medium text-fg">Comment s’est passé l’échange avec le support ?</p>
      <div className="flex gap-1" onMouseLeave={() => setHover(0)}>
        {[1, 2, 3, 4, 5].map((i) => (
          <button key={i} type="button" aria-label={`${i} sur 5`} onMouseEnter={() => setHover(i)} onClick={() => setScore(i)} className="rounded p-0.5">
            <Star className={cn('size-6 transition-colors', i <= (hover || score) ? 'fill-amber-400 text-amber-400' : 'text-border-strong')} />
          </button>
        ))}
      </div>
      {score > 0 && (
        <>
          <Textarea rows={2} maxLength={500} placeholder="Un commentaire (facultatif)" value={comment} onChange={(e) => setComment(e.target.value)} />
          <Button size="sm" variant="primary" loading={save.loading} onClick={() => void save.mutate()}>
            Envoyer mon évaluation
          </Button>
        </>
      )}
    </Card>
  );
}
