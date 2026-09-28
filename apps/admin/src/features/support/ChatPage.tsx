import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { collection, getDocs, limit, orderBy, query, where } from 'firebase/firestore';
import { ArrowLeft, ArrowUpRight, Bike, Headset, Lock, MessagesSquare, Plus, Send, Store, UserRound } from 'lucide-react';
import {
  Avatar,
  Badge,
  Button,
  Card,
  Checkbox,
  ConfirmDialog,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  EmptyState,
  FormField,
  Input,
  PageContainer,
  PageHeader,
  SegmentedControl,
  Skeleton,
  Textarea,
  cn,
  formatRelative,
  formatTime,
} from '@golink/ui';
import { COLLECTIONS, parseOrderNumber, paths, type Conversation, type ConversationMessage, type Order, type WithId } from '@golink/shared';
import { useDocumentTitle } from '@golink/web';
import { useAdminAccess } from '@/auth/AdminAccess';
import { db } from '@/lib/firebase';
import { callFunction, useCollection, useMutation } from '@/lib/firestore';
import { millis } from '../_experience/format';
import { LoadError } from '../_experience/ui';
import { SupportNav } from './components';

type ConversationDoc = Conversation & { orderNumber?: string; cityId?: string | null };

const postMessage = callFunction<{ conversationId: string; text: string }, { joined: boolean }>('postSupportChatMessage');
const closeChat = callFunction<{ conversationId: string }, { closed: boolean }>('closeSupportChat');
const openChat = callFunction<{ orderId: string; ticketId: string | null; withDriver: boolean; withRestaurant: boolean; message: string }, { conversationId: string }>('openSupportChat');

const TYPE_LABELS: Record<Conversation['type'], string> = {
  support_chat: 'Support',
  restaurant_client: 'Restaurant ↔ client',
  restaurant_driver: 'Restaurant ↔ livreur',
  client_driver: 'Client ↔ livreur',
};

const ROLE_ICONS = { client: <UserRound />, driver: <Bike />, restaurant: <Store />, admin: <Headset /> } as const;

export function ChatPage() {
  useDocumentTitle('Chat en direct · Support · Ciyou Eats Admin');
  const { can } = useAdminAccess();
  const [params, setParams] = useSearchParams();
  const selectedId = params.get('c');
  const [tab, setTab] = useState<'support' | 'orders'>('support');
  const [creating, setCreating] = useState(false);

  const supportQuery = useMemo(() => query(collection(db, COLLECTIONS.conversations), where('type', '==', 'support_chat'), orderBy('lastMessageAt', 'desc'), limit(60)), []);
  const ordersQuery = useMemo(
    () => query(collection(db, COLLECTIONS.conversations), where('type', 'in', ['restaurant_client', 'client_driver', 'restaurant_driver']), orderBy('lastMessageAt', 'desc'), limit(40)),
    [],
  );
  const support = useCollection<ConversationDoc>(supportQuery);
  const orders = useCollection<ConversationDoc>(ordersQuery);
  const list = tab === 'support' ? support : orders;
  const selected = [...support.data, ...orders.data].find((c) => c.id === selectedId) ?? null;
  const select = (id: string | null) => setParams(id ? { c: id } : {}, { replace: false });

  return (
    <PageContainer wide>
      <PageHeader
        eyebrow="Opérations"
        title="Support et litiges"
        description="Discussion en direct avec les clients, livreurs et restaurants pendant une commande."
        actions={can('support.handle') ? <Button variant="primary" leftIcon={<Plus />} onClick={() => setCreating(true)}>Nouveau chat</Button> : undefined}
      />
      <SupportNav />

      <Card className="grid min-h-[560px] overflow-hidden lg:grid-cols-[340px_minmax(0,1fr)]">
        <div className={cn('flex min-w-0 flex-col border-border lg:border-r', selected && 'hidden lg:flex')}>
          <div className="border-b border-border p-3">
            <SegmentedControl
              size="sm"
              value={tab}
              onValueChange={(v) => setTab(v as 'support' | 'orders')}
              options={[
                { value: 'support', label: 'Chats du support', count: support.data.filter((c) => !c.closed).length },
                { value: 'orders', label: 'Fils des commandes' },
              ]}
              aria-label="Conversations"
            />
          </div>
          <ul className="max-h-[70vh] flex-1 overflow-y-auto">
            {list.loading && Array.from({ length: 5 }, (_, i) => <li key={i} className="p-3"><Skeleton className="h-12" /></li>)}
            {Boolean(list.error) && <li><LoadError error={list.error} compact /></li>}
            {!list.loading && !list.error && list.data.length === 0 && (
              <li><EmptyState compact icon={<MessagesSquare />} title="Aucune conversation" description={tab === 'support' ? 'Ouvrez un chat depuis un ticket ou avec « Nouveau chat ».' : 'Les échanges des commandes apparaîtront ici.'} /></li>
            )}
            {list.data.map((c) => {
              const names = Object.values(c.participants).filter((p) => p.role !== 'admin').map((p) => p.name);
              return (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => select(c.id)}
                    className={cn('flex w-full gap-3 border-b border-border px-4 py-3 text-left transition-colors hover:bg-surface-2', c.id === selectedId && 'bg-surface-3')}
                  >
                    <Avatar name={names[0] ?? 'Ciyou Eats'} size="sm" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium text-fg">{names.join(', ') || 'Conversation'}</span>
                        <span className="ml-auto shrink-0 text-2xs text-fg-subtle">{formatRelative(millis(c.lastMessageAt))}</span>
                      </div>
                      <div className="mt-0.5 flex items-center gap-2">
                        <span className="truncate text-xs text-fg-muted">{c.lastMessage}</span>
                      </div>
                      <div className="mt-1 flex items-center gap-1.5">
                        <Badge size="sm" tone={c.type === 'support_chat' ? 'brand' : 'neutral'}>{TYPE_LABELS[c.type]}</Badge>
                        {c.orderNumber && <span className="font-mono text-2xs text-fg-subtle">{c.orderNumber}</span>}
                        {c.closed && <Badge size="sm" tone="neutral" variant="outline">Close</Badge>}
                      </div>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>

        <div className={cn('min-w-0', !selected && 'hidden lg:block')}>
          {selected ? (
            <ChatThread conversation={selected} onBack={() => select(null)} canWrite={can('support.handle')} />
          ) : (
            <EmptyState icon={<MessagesSquare />} title="Sélectionnez une conversation" description="Suivez un échange en temps réel et intervenez au nom du support Ciyou Eats." className="h-full" />
          )}
        </div>
      </Card>
      <NewChatDialog open={creating} onOpenChange={setCreating} onOpened={(id) => { setTab('support'); select(id); }} />
    </PageContainer>
  );
}

function ChatThread({ conversation, onBack, canWrite }: { conversation: WithId<ConversationDoc>; onBack: () => void; canWrite: boolean }) {
  const { admin } = useAdminAccess();
  const q = useMemo(() => query(collection(db, paths.conversationMessages(conversation.id)), orderBy('createdAt', 'asc'), limit(300)), [conversation.id]);
  const messages = useCollection<ConversationMessage>(q);
  const [text, setText] = useState('');
  const [closing, setClosing] = useState(false);
  const { mutate, loading } = useMutation(postMessage);
  const close = useMutation(closeChat, { success: 'Conversation close' });
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => endRef.current?.scrollIntoView({ block: 'nearest' }), [messages.data.length]);

  async function send() {
    const value = text.trim();
    if (!value) return;
    const r = await mutate({ conversationId: conversation.id, text: value });
    if (r) setText('');
  }

  return (
    <div className="flex h-full min-h-[560px] flex-col">
      <div className="flex items-center gap-3 border-b border-border px-4 py-3">
        <Button size="sm" variant="ghost" className="lg:hidden" leftIcon={<ArrowLeft />} onClick={onBack}>Retour</Button>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            {Object.entries(conversation.participants).map(([uid, p]) => (
              <span key={uid} className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-2 py-0.5 text-xs text-fg-muted [&_svg]:size-3">
                {ROLE_ICONS[p.role]}
                {p.name}
              </span>
            ))}
          </div>
          <div className="mt-1 text-2xs text-fg-subtle">{TYPE_LABELS[conversation.type]}{conversation.orderNumber ? ` · ${conversation.orderNumber}` : ''}</div>
        </div>
        {conversation.orderId && (
          <Button size="sm" variant="ghost" asChild rightIcon={<ArrowUpRight />}><Link to={`/commandes/${conversation.orderId}`}>Commande</Link></Button>
        )}
        {canWrite && conversation.type === 'support_chat' && !conversation.closed && (
          <Button size="sm" variant="secondary" leftIcon={<Lock />} onClick={() => setClosing(true)}>Clore</Button>
        )}
      </div>
      <div className="flex-1 space-y-3 overflow-y-auto bg-surface-2/40 px-4 py-4">
        {messages.loading && <Skeleton className="h-16 w-2/3" />}
        {Boolean(messages.error) && <LoadError error={messages.error} compact />}
        {messages.data.map((m) => {
          const role = m.senderRole;
          if (role === 'system') {
            return <p key={m.id} className="text-center text-xs text-fg-subtle">{m.text} · {formatTime(millis(m.createdAt))}</p>;
          }
          const mine = role === 'admin';
          const name = m.senderName ?? conversation.participants[m.senderId]?.name ?? 'Participant';
          return (
            <div key={m.id} className={cn('flex gap-2', mine && 'flex-row-reverse')}>
              <Avatar name={name} size="sm" />
              <div className={cn('max-w-[80%]', mine && 'text-right')}>
                <div className="mb-0.5 text-2xs text-fg-subtle">{name} · {formatTime(millis(m.createdAt))}{m.senderId === admin.uid ? ' · vous' : ''}</div>
                <div className={cn('inline-block rounded-2xl px-3.5 py-2 text-left text-sm [overflow-wrap:anywhere]', mine ? 'rounded-tr-md bg-primary-soft text-fg' : 'rounded-tl-md border border-border bg-surface text-fg')}>{m.text}</div>
              </div>
            </div>
          );
        })}
        <div ref={endRef} />
      </div>
      {canWrite && !conversation.closed ? (
        <div className="flex items-end gap-2 border-t border-border p-3">
          <Textarea
            rows={2}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            placeholder={conversation.participantIds.includes(admin.uid) ? 'Votre message…' : 'Intervenir dans la conversation au nom du support…'}
            maxLength={2000}
            aria-label="Message"
          />
          <Button variant="primary" leftIcon={<Send />} loading={loading} disabled={!text.trim()} onClick={() => void send()}>Envoyer</Button>
        </div>
      ) : (
        <p className="border-t border-border px-4 py-3 text-center text-xs text-fg-muted">{conversation.closed ? 'Conversation close.' : 'Consultation seule.'}</p>
      )}
      <ConfirmDialog
        open={closing}
        onOpenChange={setClosing}
        title="Clore la conversation ?"
        description="Les participants sont informés ; plus aucun message ne pourra être envoyé."
        confirmLabel="Clore"
        onConfirm={async () => { await close.mutate({ conversationId: conversation.id }); }}
      />
    </div>
  );
}

function NewChatDialog({ open, onOpenChange, onOpened }: { open: boolean; onOpenChange: (open: boolean) => void; onOpened: (id: string) => void }) {
  const [number, setNumber] = useState('');
  const [order, setOrder] = useState<WithId<Order> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [withDriver, setWithDriver] = useState(false);
  const [withRestaurant, setWithRestaurant] = useState(false);
  const [message, setMessage] = useState('Bonjour, ici le support Ciyou Eats. Comment pouvons-nous vous aider pour votre commande ?');
  const { mutate, loading } = useMutation(openChat, { success: 'Chat ouvert' });

  async function lookup() {
    setError(null);
    setOrder(null);
    const parsed = parseOrderNumber(number);
    if (!parsed) return setError('Numéro de commande invalide (ex. GL-10482).');
    const snap = await getDocs(query(collection(db, COLLECTIONS.orders), where('number', '==', parsed), limit(1)));
    const d = snap.docs[0];
    if (!d) setError(`Commande ${parsed} introuvable.`);
    else setOrder({ ...(d.data() as Order), id: d.id });
  }

  async function submit() {
    if (!order) return;
    const r = await mutate({ orderId: order.id, ticketId: null, withDriver, withRestaurant, message: message.trim() });
    if (r) {
      onOpenChange(false);
      setOrder(null);
      setNumber('');
      onOpened(r.conversationId);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader icon={<MessagesSquare />} title="Nouveau chat en direct" description="Rattaché à une commande : le client reçoit une notification." />
        <DialogBody className="space-y-4">
          <FormField label="Commande" error={error ?? undefined} hint={order ? `${order.customerName} · ${order.restaurantName}` : undefined}>
            <div className="flex gap-2">
              <Input value={number} onChange={(e) => setNumber(e.target.value)} placeholder="GL-10482" onKeyDown={(e) => e.key === 'Enter' && void lookup()} />
              <Button onClick={() => void lookup()}>Rechercher</Button>
            </div>
          </FormField>
          {order && (
            <div className="space-y-2">
              <Checkbox checked={withDriver} onCheckedChange={(v) => setWithDriver(v === true)} disabled={!order.driverId} label="Inviter le livreur" />
              <Checkbox checked={withRestaurant} onCheckedChange={(v) => setWithRestaurant(v === true)} label="Inviter le restaurant" />
            </div>
          )}
          <FormField label="Premier message">
            <Textarea rows={3} value={message} onChange={(e) => setMessage(e.target.value)} maxLength={2000} />
          </FormField>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Annuler</Button>
          <Button variant="primary" loading={loading} disabled={!order || message.trim().length < 2} onClick={() => void submit()}>Ouvrir le chat</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
