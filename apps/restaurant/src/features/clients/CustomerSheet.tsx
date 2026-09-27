import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { limit, orderBy, query, serverTimestamp, updateDoc, where } from 'firebase/firestore';
import { Ban, MessageSquareText, Plus, ShieldCheck, ShoppingBag, Star, StickyNote, Tag, Trash2, X } from 'lucide-react';
import {
  Avatar,
  Badge,
  Button,
  ConfirmDialog,
  EmptyState,
  IconButton,
  Input,
  SheetBody,
  SheetHeader,
  Skeleton,
  StatusPill,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
  formatDate,
  formatDateTime,
  formatRelative,
} from '@golink/ui';
import { useAuth, useTranslation } from '@golink/web';
import {
  COLLECTIONS,
  FULFILLMENT_LABELS,
  REVIEW_TAG_LABELS,
  paths,
  type CustomerNote,
  type Order,
  type RestaurantCustomer,
  type Review,
  type WithId,
} from '@golink/shared';
import { useRestaurantAccess } from '@/auth/RestaurantAccess';
import { callFunction, collectionAt, docAt, toDate, useCollection, useMutation } from '@/lib/firestore';
import { ErrorPanel } from '../finances/components/States';
import { eur, plural } from '../finances/lib/format';
import { SUGGESTED_TAGS, customerSegments } from './segments';

export const setCustomerBlocked = callFunction<{ restaurantId: string; customerIds: string[]; blocked: boolean; reason?: string }, { updated: number }>(
  'setCustomerBlocked',
);
const addCustomerNote = callFunction<{ restaurantId: string; customerId: string; body: string }, { noteId: string }>('addCustomerNote');
const deleteCustomerNote = callFunction<{ restaurantId: string; customerId: string; noteId: string }, { deleted: boolean }>('deleteCustomerNote');

const SEGMENT_BADGES: Record<string, { label: string; tone: 'info' | 'success' | 'amber' }> = {
  new: { label: 'Nouveau', tone: 'info' },
  loyal: { label: 'Fidèle', tone: 'success' },
  inactive: { label: 'Inactif', tone: 'amber' },
};

function Stars({ value }: { value: number }) {
  return (
    <span className="inline-flex items-center gap-0.5" aria-label={`${value} sur 5`}>
      {Array.from({ length: 5 }, (_, i) => (
        <Star key={i} className={i < value ? 'size-3.5 fill-current tone-amber text-(--tone-solid)' : 'size-3.5 text-border-strong'} />
      ))}
    </span>
  );
}

/** Fiche client : indicateurs, commandes, notes internes, avis, blocage. */
export function CustomerSheet({ customer }: { customer: WithId<RestaurantCustomer> }) {
  const { label: tLabel } = useTranslation();
  const { restaurantId, can, member } = useRestaurantAccess();
  const { user } = useAuth();
  const canManage = can('customers.manage');
  const canOrders = can('orders.view');
  const canReviewsAll = can('reviews.reply');
  const [blockOpen, setBlockOpen] = useState(false);
  const [note, setNote] = useState('');
  const [tagDraft, setTagDraft] = useState('');

  const orders = useCollection<Order>(
    canOrders
      ? query(
          collectionAt(COLLECTIONS.orders),
          where('restaurantId', '==', restaurantId),
          where('customerId', '==', customer.id),
          orderBy('createdAt', 'desc'),
          limit(50),
        )
      : null,
  );
  const notes = useCollection<CustomerNote>(query(collectionAt(paths.customerNotes(restaurantId, customer.id)), orderBy('createdAt', 'desc'), limit(50)));
  const reviews = useCollection<Review>(
    query(
      collectionAt(COLLECTIONS.reviews),
      where('restaurantId', '==', restaurantId),
      where('customerId', '==', customer.id),
      ...(canReviewsAll ? [] : [where('status', '==', 'published')]),
      limit(50),
    ),
  );
  const sortedReviews = useMemo(() => [...reviews.data].sort((a, b) => (toDate(b.createdAt)?.getTime() ?? 0) - (toDate(a.createdAt)?.getTime() ?? 0)), [reviews.data]);
  const averageRating = sortedReviews.length ? sortedReviews.reduce((s, r) => s + r.restaurantRating, 0) / sortedReviews.length : null;

  const block = useMutation((reason?: string) => setCustomerBlocked({ restaurantId, customerIds: [customer.id], blocked: !customer.blocked, ...(reason ? { reason } : {}) }), {
    success: customer.blocked ? 'Client débloqué.' : 'Client bloqué : il ne peut plus commander chez vous.',
  });
  const addNote = useMutation((body: string) => addCustomerNote({ restaurantId, customerId: customer.id, body }), { success: 'Note enregistrée.' });
  const removeNote = useMutation((noteId: string) => deleteCustomerNote({ restaurantId, customerId: customer.id, noteId }), { success: 'Note supprimée.' });
  const saveTags = useMutation(
    (tags: string[]) => updateDoc(docAt(`${paths.restaurantSub(restaurantId, 'customers')}/${customer.id}`), { tags, updatedAt: serverTimestamp() }),
    { success: 'Étiquettes mises à jour.' },
  );

  const segments = customerSegments(customer).filter((s) => s in SEGMENT_BADGES);
  const first = toDate(customer.firstOrderAt);
  const last = toDate(customer.lastOrderAt);
  const blockedAt = toDate(customer.blockedAt);
  const tags = customer.tags ?? [];

  function addTag(value: string) {
    const tag = value.trim().slice(0, 30);
    if (!tag || tags.includes(tag) || tags.length >= 10) return;
    void saveTags.mutate([...tags, tag]).then(() => setTagDraft(''));
  }

  return (
    <>
      <SheetHeader title={customer.displayName} description={customer.phoneMasked ?? 'Coordonnées masquées par GoLink'} icon={<Avatar name={customer.displayName} size="sm" />} />
      <SheetBody className="space-y-5">
        <div className="flex flex-wrap items-center gap-1.5">
          <StatusPill tone={customer.blocked ? 'danger' : 'success'}>{customer.blocked ? 'Bloqué' : 'Actif'}</StatusPill>
          {segments.map((s) => (
            <Badge key={s} tone={SEGMENT_BADGES[s]?.tone}>
              {SEGMENT_BADGES[s]?.label}
            </Badge>
          ))}
        </div>

        <div className="grid grid-cols-3 overflow-hidden rounded-xl border border-border bg-surface-2">
          {[
            { label: 'Commandes', value: String(customer.ordersCount) },
            { label: 'Dépenses', value: eur(customer.totalSpentCents) },
            { label: 'Panier moyen', value: eur(customer.averageBasketCents) },
          ].map((item, i) => (
            <div key={item.label} className={i ? 'border-l border-border p-3' : 'p-3'}>
              <p className="text-xs text-fg-subtle">{item.label}</p>
              <p className="mt-1 truncate font-display text-lg font-semibold tracking-tight text-fg num">{item.value}</p>
            </div>
          ))}
        </div>
        <p className="text-sm text-fg-muted">
          Client depuis le {first ? formatDate(first) : '—'} · dernière commande {last ? formatRelative(last) : '—'}
          {averageRating !== null && ` · note moyenne ${averageRating.toLocaleString('fr-FR', { maximumFractionDigits: 1 })}/5`}
        </p>

        {customer.blocked && (
          <div className="rounded-xl border border-danger/30 bg-danger-soft p-3 text-sm">
            <p className="font-medium text-danger-soft-fg">Commandes bloquées{blockedAt ? ` depuis le ${formatDate(blockedAt)}` : ''}</p>
            {customer.blockedReason && <p className="mt-0.5 text-fg-muted">Motif : {customer.blockedReason}</p>}
          </div>
        )}

        <section>
          <p className="eyebrow mb-2 flex items-center gap-1.5">
            <Tag className="size-3" /> Étiquettes
          </p>
          <div className="flex flex-wrap items-center gap-1.5">
            {tags.length === 0 && <span className="text-sm text-fg-subtle">Aucune étiquette.</span>}
            {tags.map((tag) => (
              <span key={tag} className="inline-flex h-7 items-center gap-1 rounded-md border border-border bg-surface px-2 text-xs text-fg">
                {tag}
                {canManage && (
                  <button type="button" aria-label={`Retirer ${tag}`} className="rounded text-fg-subtle hover:text-fg" onClick={() => void saveTags.mutate(tags.filter((t) => t !== tag))}>
                    <X className="size-3" />
                  </button>
                )}
              </span>
            ))}
          </div>
          {canManage && (
            <div className="mt-2 space-y-2">
              <form
                className="flex gap-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  addTag(tagDraft);
                }}
              >
                <Input size="sm" value={tagDraft} onChange={(e) => setTagDraft(e.target.value)} placeholder="Nouvelle étiquette" maxLength={30} aria-label="Nouvelle étiquette" />
                <Button type="submit" size="sm" variant="secondary" leftIcon={<Plus />} disabled={!tagDraft.trim()} loading={saveTags.loading}>
                  Ajouter
                </Button>
              </form>
              <div className="flex flex-wrap gap-1.5">
                {SUGGESTED_TAGS.filter((t) => !tags.includes(t)).map((t) => (
                  <button key={t} type="button" className="rounded-md border border-dashed border-border-strong px-2 py-0.5 text-xs text-fg-muted hover:border-primary hover:text-fg" onClick={() => addTag(t)}>
                    + {t}
                  </button>
                ))}
              </div>
            </div>
          )}
        </section>

        <Tabs defaultValue="orders">
          <TabsList>
            <TabsTrigger value="orders" icon={<ShoppingBag />} count={orders.data.length || undefined}>
              Commandes
            </TabsTrigger>
            <TabsTrigger value="notes" icon={<StickyNote />} count={notes.data.length || undefined}>
              Notes
            </TabsTrigger>
            <TabsTrigger value="reviews" icon={<MessageSquareText />} count={sortedReviews.length || undefined}>
              Avis
            </TabsTrigger>
          </TabsList>

          <TabsContent value="orders" className="pt-3">
            {!canOrders ? (
              <EmptyState compact title="Accès aux commandes requis" description="Votre rôle ne permet pas de consulter l’historique des commandes." />
            ) : orders.loading ? (
              <Skeleton className="h-32 w-full" />
            ) : orders.error ? (
              <ErrorPanel compact error={orders.error} />
            ) : orders.data.length === 0 ? (
              <EmptyState compact title="Aucune commande" />
            ) : (
              <ul className="divide-y divide-border rounded-xl border border-border">
                {orders.data.map((order) => {
                  const at = toDate(order.timeline?.placedAt ?? order.createdAt);
                  return (
                    <li key={order.id}>
                      <Link to={`/commandes/${order.id}`} className="flex items-center justify-between gap-3 px-3 py-2.5 text-sm transition-colors hover:bg-surface-2">
                        <div className="min-w-0">
                          <p className="font-mono font-medium text-fg">{order.number}</p>
                          <p className="truncate text-xs text-fg-subtle">
                            {at ? formatDateTime(at) : '—'} · {FULFILLMENT_LABELS[order.fulfillment]} · {plural(order.itemsCount, 'article')}
                          </p>
                        </div>
                        <div className="shrink-0 text-right">
                          <p className="font-mono text-fg num">{eur(order.amounts?.subtotalCents ?? 0)}</p>
                          <p className={order.status === 'cancelled' ? 'text-xs text-danger-soft-fg' : 'text-xs text-fg-subtle'}>{tLabel('ORDER_STATUS_LABELS', order.status)}</p>
                        </div>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </TabsContent>

          <TabsContent value="notes" className="space-y-3 pt-3">
            {canManage && (
              <form
                className="space-y-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (note.trim().length < 2) return;
                  void addNote.mutate(note.trim()).then((r) => r && setNote(''));
                }}
              >
                <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} maxLength={1000} placeholder="Allergie signalée, préférence de livraison, geste commercial accordé…" aria-label="Nouvelle note interne" />
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs text-fg-subtle">Visible uniquement par votre équipe, jamais par le client.</p>
                  <Button type="submit" size="sm" loading={addNote.loading} disabled={note.trim().length < 2}>
                    Enregistrer la note
                  </Button>
                </div>
              </form>
            )}
            {notes.loading ? (
              <Skeleton className="h-20 w-full" />
            ) : notes.error ? (
              <ErrorPanel compact error={notes.error} />
            ) : notes.data.length === 0 ? (
              <EmptyState compact icon={<StickyNote />} title="Aucune note interne" description="Consignez ici ce que l’équipe doit savoir sur ce client." />
            ) : (
              <ul className="space-y-2">
                {notes.data.map((n) => {
                  const at = toDate(n.createdAt);
                  const mine = n.authorId === user?.uid || member.role === 'owner';
                  return (
                    <li key={n.id} className="group rounded-xl border border-border bg-surface-2 p-3">
                      <div className="flex items-start justify-between gap-2">
                        <p className="whitespace-pre-line text-sm text-fg">{n.body}</p>
                        {canManage && mine && (
                          <IconButton label="Supprimer la note" size="xs" variant="danger" disabled={removeNote.loading} onClick={() => void removeNote.mutate(n.id)}>
                            <Trash2 />
                          </IconButton>
                        )}
                      </div>
                      <p className="mt-1.5 text-xs text-fg-subtle">
                        {n.authorName} · {at ? formatDateTime(at) : ''}
                      </p>
                    </li>
                  );
                })}
              </ul>
            )}
          </TabsContent>

          <TabsContent value="reviews" className="pt-3">
            {reviews.loading ? (
              <Skeleton className="h-20 w-full" />
            ) : reviews.error ? (
              <ErrorPanel compact error={reviews.error} />
            ) : sortedReviews.length === 0 ? (
              <EmptyState compact icon={<Star />} title="Aucun avis" description="Ce client n’a pas encore laissé d’avis sur votre établissement." />
            ) : (
              <ul className="space-y-2">
                {sortedReviews.map((review) => {
                  const at = toDate(review.createdAt);
                  return (
                    <li key={review.id} className="rounded-xl border border-border p-3">
                      <div className="flex items-center justify-between gap-2">
                        <Stars value={review.restaurantRating} />
                        <span className="text-xs text-fg-subtle">{at ? formatDate(at) : ''}</span>
                      </div>
                      {review.comment && <p className="mt-1.5 text-sm text-fg">« {review.comment} »</p>}
                      {review.tags?.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1">
                          {review.tags.map((t) => (
                            <Badge key={t} size="sm">
                              {REVIEW_TAG_LABELS[t] ?? t}
                            </Badge>
                          ))}
                        </div>
                      )}
                      {review.reply?.text && <p className="mt-2 border-l-2 border-primary pl-2.5 text-sm text-fg-muted">Votre réponse : {review.reply.text}</p>}
                      {review.status !== 'published' && <p className="mt-1.5 text-xs text-fg-subtle">Avis non publié</p>}
                    </li>
                  );
                })}
              </ul>
            )}
          </TabsContent>
        </Tabs>

        {canManage && (
          <div className="border-t border-border pt-4">
            {customer.blocked ? (
              <Button variant="secondary" leftIcon={<ShieldCheck />} loading={block.loading} onClick={() => void block.mutate()}>
                Débloquer ce client
              </Button>
            ) : (
              <Button variant="danger-soft" leftIcon={<Ban />} onClick={() => setBlockOpen(true)}>
                Bloquer ce client
              </Button>
            )}
          </div>
        )}
      </SheetBody>

      <ConfirmDialog
        open={blockOpen}
        onOpenChange={setBlockOpen}
        destructive
        requireReason
        reasonLabel="Motif du blocage (conservé dans le journal d’audit)"
        title={`Bloquer ${customer.displayName} ?`}
        description="Ce client ne pourra plus passer commande dans votre établissement. Il ne sera pas prévenu du motif. Vous pourrez le débloquer à tout moment."
        confirmLabel="Bloquer le client"
        onConfirm={async (reason) => {
          await block.mutate(reason);
        }}
      />
    </>
  );
}
