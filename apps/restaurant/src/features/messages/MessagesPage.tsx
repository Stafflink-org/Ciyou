import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { arrayUnion, doc, limit, orderBy, query, updateDoc, where, writeBatch } from 'firebase/firestore';
import { getDownloadURL, ref as storageRef, uploadBytes } from 'firebase/storage';
import { isToday, isYesterday } from 'date-fns';
import { ArrowLeft, Bike, Bot, CheckCheck, ImagePlus, Lock, MessageCircle, MessageSquarePlus, Search, Send, ShoppingBag, UserRound, X } from 'lucide-react';
import {
  Avatar,
  Badge,
  Button,
  Card,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  EmptyState,
  IconButton,
  Input,
  PageContainer,
  PageHeader,
  SegmentedControl,
  Skeleton,
  StatusBadge,
  Textarea,
  cn,
  formatDate,
  formatRelative,
  formatTime,
  toast,
} from '@golink/ui';
import { COLLECTIONS, paths, type ConversationMessage, type Order, type WithId } from '@golink/shared';
import { useAuth } from '@golink/web';
import { useCan, useRestaurantAccess } from '@/auth/RestaurantAccess';
import { db, storage } from '@/lib/firebase';
import { collectionAt, docAt, errorMessage, toDate, toMillis, useCollection, useMutation } from '@/lib/firestore';
import { TemplatePicker } from '../modeles/lib';
import { counterpart, openOrderConversation, sendMessage, useConversations, type AttachmentInput, type ConversationRow, type ThreadKind } from './lib';

type MessageRow = WithId<ConversationMessage>;
const MAX_IMAGE = 5 * 1024 * 1024;
const ORDER_STATUS_META: Record<string, { label: string; tone: 'neutral' | 'amber' | 'teal' | 'success' | 'danger' | 'info' | 'brand' | 'plum' }> = {
  scheduled: { label: 'Programmée', tone: 'neutral' },
  new: { label: 'Nouvelle', tone: 'brand' },
  accepted: { label: 'Acceptée', tone: 'neutral' },
  preparing: { label: 'En préparation', tone: 'amber' },
  ready: { label: 'Prête', tone: 'teal' },
  assigned: { label: 'Livreur assigné', tone: 'info' },
  picked_up: { label: 'Récupérée', tone: 'plum' },
  delivered: { label: 'Livrée', tone: 'success' },
  cancelled: { label: 'Annulée', tone: 'danger' },
};

function dayLabel(date: Date): string {
  if (isToday(date)) return 'Aujourd’hui';
  if (isYesterday(date)) return 'Hier';
  return formatDate(date);
}

function shortTime(date: Date | null): string {
  if (!date) return '';
  return isToday(date) ? formatTime(date) : isYesterday(date) ? 'Hier' : formatDate(date).replace(/ \d{4}$/, '');
}

export function MessagesPage() {
  const { conversationId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const uid = user?.uid ?? '';
  const conversations = useConversations(100);
  const [kind, setKind] = useState<ThreadKind>('restaurant_client');
  const [search, setSearch] = useState('');
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [creating, setCreating] = useState(false);

  const active = conversations.data.find((c) => c.id === conversationId) ?? null;
  useEffect(() => {
    if (active && active.type !== kind) setKind(active.type as ThreadKind);
  }, [active, kind]);

  const counts = useMemo(() => {
    const unread = (type: ThreadKind) => conversations.data.filter((c) => c.type === type && (c.unread?.[uid] ?? 0) > 0).length;
    return { client: unread('restaurant_client'), driver: unread('restaurant_driver') };
  }, [conversations.data, uid]);

  const list = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return conversations.data.filter((c) => {
      if (c.type !== kind) return false;
      if (unreadOnly && !(c.unread?.[uid] ?? 0)) return false;
      if (!needle) return true;
      return `${counterpart(c)?.name ?? ''} ${c.orderNumber ?? ''} ${c.orderId ?? ''} ${c.lastMessage}`.toLowerCase().includes(needle);
    });
  }, [conversations.data, kind, search, unreadOnly, uid]);

  return (
    <PageContainer wide>
      <PageHeader
        eyebrow="Messagerie"
        title="Messages"
        description="Un fil direct avec vos clients et vos livreurs pour chaque commande, en temps réel."
        actions={
          <Button variant="primary" leftIcon={<MessageSquarePlus />} onClick={() => setCreating(true)}>
            Nouvelle conversation
          </Button>
        }
        className={cn(conversationId && 'max-md:hidden')}
      />
      <Card className="grid h-[calc(100dvh-12.5rem)] min-h-[540px] overflow-hidden md:grid-cols-[320px_minmax(0,1fr)] xl:grid-cols-[360px_minmax(0,1fr)]">
        <aside className={cn('flex min-h-0 flex-col border-border md:border-r', conversationId && 'max-md:hidden')}>
          <div className="space-y-3 border-b border-border p-3">
            <SegmentedControl
              className="w-full [&>*]:flex-1"
              aria-label="Type de conversation"
              value={kind}
              onValueChange={(v) => setKind(v as ThreadKind)}
              options={[
                { value: 'restaurant_client', label: 'Clients', icon: <UserRound />, count: counts.client || undefined },
                { value: 'restaurant_driver', label: 'Livreurs', icon: <Bike />, count: counts.driver || undefined },
              ]}
            />
            <div className="flex items-center gap-2">
              <Input className="flex-1" size="sm" leading={<Search />} placeholder="Nom, commande…" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Rechercher une conversation" />
              <Button size="sm" variant={unreadOnly ? 'soft' : 'ghost'} aria-pressed={unreadOnly} onClick={() => setUnreadOnly((v) => !v)}>
                Non lus
              </Button>
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {conversations.error ? (
              <EmptyState compact icon={<MessageCircle />} title="Messagerie indisponible" description={errorMessage(conversations.error)} />
            ) : conversations.loading ? (
              <div className="space-y-1 p-3">
                {[0, 1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-16 rounded-lg" />
                ))}
              </div>
            ) : list.length === 0 ? (
              <EmptyState
                compact
                icon={<MessageCircle />}
                title={search || unreadOnly ? 'Aucune conversation trouvée' : 'Aucune conversation'}
                description={search || unreadOnly ? 'Modifiez la recherche ou le filtre.' : 'Les échanges liés aux commandes apparaîtront ici.'}
              />
            ) : (
              <ul>
                {list.map((c) => {
                  const other = counterpart(c);
                  const unread = c.unread?.[uid] ?? 0;
                  const selected = c.id === conversationId;
                  return (
                    <li key={c.id}>
                      <button
                        type="button"
                        onClick={() => navigate(`/messages/${c.id}`)}
                        aria-current={selected ? 'true' : undefined}
                        className={cn(
                          'flex w-full items-start gap-3 border-b border-border px-3.5 py-3 text-left transition-colors',
                          selected ? 'bg-primary-soft/50' : 'hover:bg-surface-2',
                        )}
                      >
                        <Avatar name={other?.name ?? 'Client'} size="md" />
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-2">
                            <span className={cn('truncate text-sm', unread ? 'font-semibold text-fg' : 'font-medium text-fg')}>{other?.name ?? 'Conversation'}</span>
                            <span className="ml-auto shrink-0 font-mono text-2xs text-fg-subtle">{shortTime(toDate(c.lastMessageAt))}</span>
                          </span>
                          <span className="mt-0.5 flex items-center gap-1.5 text-2xs text-fg-subtle">
                            <ShoppingBag className="size-3" />
                            {c.orderNumber ?? c.orderId ?? 'Sans commande'}
                            {c.closed && (
                              <>
                                <span aria-hidden="true">·</span>
                                <Lock className="size-3" /> Clôturée
                              </>
                            )}
                          </span>
                          <span className="mt-1 flex items-center gap-2">
                            <span className={cn('line-clamp-1 flex-1 text-xs', unread ? 'text-fg' : 'text-fg-muted')}>
                              {c.lastSenderRole === 'restaurant' && 'Vous : '}
                              {c.lastMessage || 'Nouvelle conversation'}
                            </span>
                            {unread > 0 && (
                              <span className="grid h-5 min-w-5 place-items-center rounded-full bg-primary px-1.5 font-mono text-2xs font-semibold text-primary-fg num">{unread}</span>
                            )}
                          </span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </aside>
        <section className={cn('flex min-h-0 min-w-0 flex-col', !conversationId && 'max-md:hidden')}>
          {conversationId && active ? (
            <Thread key={active.id} conversation={active} uid={uid} />
          ) : conversationId && conversations.loading ? (
            <div className="flex-1 space-y-3 p-6">
              <Skeleton className="h-10 w-60" />
              <Skeleton className="h-24" />
            </div>
          ) : (
            <div className="grid flex-1 place-items-center p-6">
              <EmptyState
                icon={<MessageCircle />}
                title={conversationId ? 'Conversation introuvable' : 'Sélectionnez une conversation'}
                description={conversationId ? 'Elle n’existe plus ou concerne un autre établissement.' : 'Ou démarrez-en une à partir d’une commande récente.'}
                action={
                  <Button variant="secondary" leftIcon={<MessageSquarePlus />} onClick={() => setCreating(true)}>
                    Nouvelle conversation
                  </Button>
                }
              />
            </div>
          )}
        </section>
      </Card>
      <NewConversationDialog open={creating} onOpenChange={setCreating} onOpened={(id) => navigate(`/messages/${id}`)} />
    </PageContainer>
  );
}

// ------------------------------------------------------------------ Fil de discussion

function Thread({ conversation: c, uid }: { conversation: ConversationRow; uid: string }) {
  const { restaurant } = useRestaurantAccess();
  const other = counterpart(c);
  const messages = useCollection<ConversationMessage>(query(collectionAt(paths.conversationMessages(c.id)), orderBy('createdAt', 'asc'), limit(300)));
  const bottomRef = useRef<HTMLDivElement>(null);
  const [lightbox, setLightbox] = useState<string | null>(null);

  // Défilement en bas à chaque nouveau message.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [messages.data.length]);

  // Lecture : remise à zéro du compteur personnel et accusés de lecture.
  const unread = c.unread?.[uid] ?? 0;
  useEffect(() => {
    if (!uid) return;
    if (unread > 0) void updateDoc(docAt(`${COLLECTIONS.conversations}/${c.id}`), { [`unread.${uid}`]: 0 }).catch(() => undefined);
    const pending = messages.data.filter((m) => m.senderId !== uid && !m.readBy?.includes(uid)).slice(-40);
    if (pending.length === 0) return;
    const batch = writeBatch(db);
    for (const m of pending) batch.update(doc(db, paths.conversationMessages(c.id), m.id), { readBy: arrayUnion(uid) });
    void batch.commit().catch(() => undefined);
  }, [c.id, uid, unread, messages.data]);

  const groups = useMemo(() => {
    const out: Array<{ day: string; items: MessageRow[] }> = [];
    for (const m of messages.data) {
      const d = toDate(m.createdAt) ?? new Date();
      const day = dayLabel(d);
      const last = out[out.length - 1];
      if (last && last.day === day) last.items.push(m);
      else out.push({ day, items: [m] });
    }
    return out;
  }, [messages.data]);

  const counterpartRead = (m: MessageRow) => Boolean(other && m.readBy?.includes(other.uid));

  return (
    <>
      <header className="flex items-center gap-3 border-b border-border px-4 py-3">
        <Link to="/messages" className="grid size-8 place-items-center rounded-lg text-fg-muted hover:bg-surface-3 md:hidden" aria-label="Retour aux conversations">
          <ArrowLeft className="size-4" />
        </Link>
        <Avatar name={other?.name ?? 'Client'} />
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium text-fg">{other?.name ?? 'Conversation'}</p>
          <p className="flex items-center gap-1.5 text-xs text-fg-muted">
            {other?.role === 'driver' ? <Bike className="size-3.5" /> : <UserRound className="size-3.5" />}
            {other?.role === 'driver' ? 'Livreur' : 'Client'}
            {c.orderId && (
              <>
                <span aria-hidden="true">·</span>
                <Link to={`/commandes/${c.orderId}`} className="font-mono hover:text-fg hover:underline">
                  {c.orderNumber ?? c.orderId}
                </Link>
              </>
            )}
          </p>
        </div>
        {c.closed ? (
          <Badge icon={<Lock />}>Clôturée</Badge>
        ) : (
          <Badge tone="success" className="max-sm:hidden">
            Active
          </Badge>
        )}
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto bg-canvas/60 px-4 py-5 sm:px-6">
        {messages.loading ? (
          <div className="space-y-3">
            <Skeleton className="h-12 w-2/3" />
            <Skeleton className="ml-auto h-12 w-1/2" />
          </div>
        ) : messages.error ? (
          <EmptyState compact title="Messages indisponibles" description={errorMessage(messages.error)} />
        ) : messages.data.length === 0 ? (
          <EmptyState compact icon={<MessageCircle />} title="Aucun message" description={`Écrivez le premier message à ${other?.name ?? 'votre interlocuteur'}.`} />
        ) : (
          groups.map((g) => (
            <div key={g.day} className="space-y-2.5">
              <div className="my-4 flex items-center gap-3 text-2xs font-medium uppercase tracking-eyebrow text-fg-subtle">
                <span className="h-px flex-1 bg-border" />
                {g.day}
                <span className="h-px flex-1 bg-border" />
              </div>
              {g.items.map((m) => {
                const mine = m.senderRole === 'restaurant';
                const time = toDate(m.createdAt);
                if (m.senderRole === 'system') {
                  return (
                    <p key={m.id} className="text-center text-xs text-fg-subtle">
                      {m.text}
                    </p>
                  );
                }
                return (
                  <div key={m.id} className={cn('flex', mine ? 'justify-end' : 'justify-start')}>
                    <div className={cn('max-w-[85%] sm:max-w-[70%]', mine && 'items-end')}>
                      {mine && (m.senderName || m.auto) && (
                        <p className="mb-1 flex items-center justify-end gap-1 text-2xs text-fg-subtle">
                          {m.auto && <Bot className="size-3" />}
                          {m.auto ? 'Message automatique' : m.senderName}
                        </p>
                      )}
                      <div
                        className={cn(
                          'rounded-2xl px-3.5 py-2.5 text-sm leading-5 shadow-xs',
                          mine ? 'rounded-br-md bg-contrast text-contrast-fg' : 'rounded-bl-md border border-border bg-surface text-fg',
                        )}
                      >
                        {m.attachments?.length > 0 && (
                          <div className={cn('mb-1.5 grid gap-1.5', m.attachments.length > 1 && 'grid-cols-2')}>
                            {m.attachments.map((a) =>
                              a.url ? (
                                <button key={a.path} type="button" onClick={() => setLightbox(a.url ?? null)} className="overflow-hidden rounded-lg">
                                  <img src={a.url} alt={a.name ?? 'Photo jointe'} className="max-h-56 w-full object-cover" loading="lazy" />
                                </button>
                              ) : null,
                            )}
                          </div>
                        )}
                        {m.text && <p className="whitespace-pre-line break-words">{m.text}</p>}
                      </div>
                      <p className={cn('mt-1 flex items-center gap-1 font-mono text-2xs text-fg-subtle', mine && 'justify-end')}>
                        {time ? formatTime(time) : ''}
                        {mine && counterpartRead(m) && (
                          <span className="inline-flex items-center gap-0.5 text-primary-soft-fg">
                            <CheckCheck className="size-3" /> Lu
                          </span>
                        )}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>

      {c.closed ? (
        <p className="flex items-center gap-2 border-t border-border bg-surface-2 px-4 py-3.5 text-sm text-fg-muted">
          <Lock className="size-4" /> Cette conversation est close. Pour une nouvelle question, ouvrez un fil depuis une commande récente.
        </p>
      ) : (
        <Composer conversation={c} restaurantName={restaurant.name} counterpartName={other?.name ?? ''} />
      )}

      <Dialog open={lightbox !== null} onOpenChange={(open) => !open && setLightbox(null)}>
        <DialogContent size="xl" className="bg-surface p-2">
          <DialogHeader title="Photo" className="sr-only" />
          {lightbox && <img src={lightbox} alt="Photo jointe" className="max-h-[80dvh] w-full rounded-xl object-contain" />}
        </DialogContent>
      </Dialog>
    </>
  );
}

function Composer({ conversation: c, restaurantName, counterpartName }: { conversation: ConversationRow; restaurantName: string; counterpartName: string }) {
  const [text, setText] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [templateId, setTemplateId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const previews = useMemo(() => files.map((f) => ({ file: f, url: URL.createObjectURL(f) })), [files]);
  useEffect(() => () => previews.forEach((p) => URL.revokeObjectURL(p.url)), [previews]);
  const first = counterpartName.split(/\s+/)[0] ?? '';

  const send = useMutation(async () => {
    const attachments: AttachmentInput[] = [];
    for (const file of files) {
      const safe = file.name.normalize('NFD').replace(/[^\w.-]+/g, '-').slice(-60);
      const path = `conversations/${c.id}/${Date.now()}-${safe}`;
      const snapshot = await uploadBytes(storageRef(storage, path), file, { contentType: file.type });
      attachments.push({ path, url: await getDownloadURL(snapshot.ref), contentType: file.type, size: file.size, name: file.name });
    }
    return sendMessage({ conversationId: c.id, text: text.trim(), attachments, templateId });
  });

  async function submit() {
    if (!text.trim() && files.length === 0) return;
    const done = await send.mutate();
    if (done) {
      setText('');
      setFiles([]);
      setTemplateId(null);
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void submit();
    }
  }

  function addFiles(list: FileList | null) {
    if (!list) return;
    const accepted: File[] = [];
    for (const file of Array.from(list)) {
      if (!/^image\/(jpeg|png|webp|avif)$/.test(file.type)) toast.error(`${file.name} : seules les photos (JPEG, PNG, WebP) sont acceptées.`);
      else if (file.size > MAX_IMAGE) toast.error(`${file.name} dépasse 5 Mo.`);
      else accepted.push(file);
    }
    setFiles((current) => [...current, ...accepted].slice(0, 4));
  }

  return (
    <div className="border-t border-border bg-surface p-3">
      {previews.length > 0 && (
        <div className="mb-2 flex gap-2">
          {previews.map((p, i) => (
            <div key={p.url} className="relative">
              <img src={p.url} alt={p.file.name} className="size-16 rounded-lg object-cover" />
              <button
                type="button"
                aria-label={`Retirer ${p.file.name}`}
                onClick={() => setFiles(files.filter((_, j) => j !== i))}
                className="absolute -right-1.5 -top-1.5 grid size-5 place-items-center rounded-full bg-contrast text-contrast-fg shadow"
              >
                <X className="size-3" />
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="flex items-end gap-2">
        <Textarea
          rows={1}
          className="max-h-40 min-h-10 flex-1 resize-none"
          placeholder="Écrivez votre message…"
          aria-label="Votre message"
          value={text}
          maxLength={2000}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
        />
        <Button variant="primary" className="h-10" leftIcon={<Send />} loading={send.loading} disabled={!text.trim() && files.length === 0} onClick={() => void submit()}>
          <span className="max-sm:sr-only">Envoyer</span>
        </Button>
      </div>
      <div className="mt-1.5 flex items-center gap-1">
        <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp,image/avif" multiple className="hidden" onChange={(e) => (addFiles(e.target.files), (e.target.value = ''))} />
        <IconButton size="sm" label="Joindre une photo" onClick={() => inputRef.current?.click()} disabled={files.length >= 4}>
          <ImagePlus />
        </IconButton>
        <TemplatePicker
          kind={c.type === 'restaurant_driver' ? 'driver_message' : 'customer_message'}
          variables={{ prenom: first, livreur: first, restaurant: restaurantName, commande: c.orderNumber ?? '' }}
          onPick={(value, id) => {
            setText(value);
            setTemplateId(id);
          }}
        />
        <span className="ml-auto hidden text-2xs text-fg-subtle sm:block">Entrée pour envoyer · Maj + Entrée pour un saut de ligne</span>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ Nouvelle conversation

function NewConversationDialog({ open, onOpenChange, onOpened }: { open: boolean; onOpenChange: (open: boolean) => void; onOpened: (id: string) => void }) {
  const { restaurantId } = useRestaurantAccess();
  const can = useCan();
  const [search, setSearch] = useState('');
  const orders = useCollection<Order>(
    open && can('orders.view') ? query(collectionAt(COLLECTIONS.orders), where('restaurantId', '==', restaurantId), orderBy('createdAt', 'desc'), limit(60)) : null,
  );
  const recent = useMemo(() => {
    const since = Date.now() - 7 * 86_400_000;
    const needle = search.trim().toLowerCase();
    return orders.data
      .filter((o) => (toMillis(o.createdAt) ?? 0) >= since)
      .filter((o) => !needle || `${o.number} ${o.customerName}`.toLowerCase().includes(needle));
  }, [orders.data, search]);
  const openThread = useMutation(openOrderConversation);

  async function start(orderId: string, withWho: 'client' | 'driver') {
    const result = await openThread.mutate({ orderId, with: withWho });
    if (result) {
      onOpenChange(false);
      onOpened(result.id);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <DialogHeader icon={<MessageSquarePlus />} title="Nouvelle conversation" description="Choisissez une commande des 7 derniers jours, puis le client ou le livreur à contacter." />
        <DialogBody className="space-y-3">
          <Input leading={<Search />} placeholder="Numéro de commande ou client…" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Rechercher une commande" />
          {!can('orders.view') ? (
            <EmptyState compact title="Accès aux commandes requis" description="Votre rôle ne permet pas de consulter les commandes." />
          ) : orders.loading ? (
            <div className="space-y-2">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-14" />
              ))}
            </div>
          ) : orders.error ? (
            <EmptyState compact title="Commandes indisponibles" description={errorMessage(orders.error)} />
          ) : recent.length === 0 ? (
            <EmptyState compact icon={<ShoppingBag />} title="Aucune commande récente" description="La messagerie est ouverte pendant 7 jours après une commande." />
          ) : (
            <ul className="max-h-96 divide-y divide-border overflow-y-auto rounded-xl border border-border">
              {recent.map((o) => {
                const meta = ORDER_STATUS_META[o.status] ?? { label: o.status, tone: 'neutral' as const };
                const driver = o.driverId ?? o.delivery?.driverId;
                return (
                  <li key={o.id} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center">
                    <div className="min-w-0 flex-1">
                      <p className="flex items-center gap-2 text-sm">
                        <span className="font-mono font-medium text-fg">{o.number}</span>
                        <StatusBadge status={o.status} map={{ [o.status]: meta }} />
                      </p>
                      <p className="truncate text-xs text-fg-muted">
                        {o.customerName} · {formatRelative(toDate(o.createdAt) ?? new Date())}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <Button size="sm" variant="secondary" leftIcon={<UserRound />} disabled={openThread.loading} onClick={() => void start(o.id, 'client')}>
                        Client
                      </Button>
                      <Button size="sm" variant="secondary" leftIcon={<Bike />} disabled={!driver || openThread.loading} onClick={() => void start(o.id, 'driver')}>
                        Livreur
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Fermer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
