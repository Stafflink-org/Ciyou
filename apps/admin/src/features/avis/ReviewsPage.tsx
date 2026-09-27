import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { average, collection, count, getAggregateFromServer, limit, orderBy, query, where, Timestamp, type QueryConstraint } from 'firebase/firestore';
import { AlertTriangle, Bike, Flag, MessageSquareReply, MessageSquareText, Search, ShieldAlert, Star, Store, ThumbsDown } from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Input,
  PageContainer,
  PageHeader,
  SegmentedControl,
  Select,
  Sheet,
  SheetContent,
  Skeleton,
  cn,
  formatNumber,
  formatPercent,
  formatRelative,
} from '@golink/ui';
import { COLLECTIONS, type ContentReport, type Review, type WithId } from '@golink/shared';
import { useDocumentTitle } from '@golink/web';
import { useAdminAccess } from '@/auth/AdminAccess';
import { db } from '@/lib/firebase';
import { docAt, useCollection, useDoc, useInfiniteCollection } from '@/lib/firestore';
import { millis } from '../_experience/format';
import { useScopeFilter } from '../_experience/scope';
import { Kpi, LoadError, Stars, ratingTone } from '../_experience/ui';
import { AvisNav, ReviewComment, ReviewDetail, ReviewStatusBadge } from './components';
import { useScopedDrivers, useScopedRestaurants } from './hooks';

type Target = 'restaurant' | 'driver';
const DAY = 86_400_000;

export function ReviewsPage() {
  useDocumentTitle('Avis et notes · GoLink Admin');
  const { orderId } = useParams();
  const navigate = useNavigate();
  const { can } = useAdminAccess();
  const scope = useScopeFilter();
  const [target, setTarget] = useState<Target>('restaurant');
  const [status, setStatus] = useState('all');
  const [rating, setRating] = useState('all');
  const [search, setSearch] = useState('');
  const [withComment, setWithComment] = useState(false);
  const restaurants = useScopedRestaurants();
  const drivers = useScopedDrivers();

  const constraints = useMemo(() => {
    const list: QueryConstraint[] = [...scope.constraints];
    if (target === 'restaurant') {
      if (status !== 'all') list.push(where('status', '==', status));
      if (rating !== 'all') list.push(where('restaurantRating', '==', Number(rating)));
    } else {
      list.push(rating !== 'all' ? where('driverRating', '==', Number(rating)) : where('driverRating', 'in', [1, 2, 3, 4, 5]));
    }
    return list;
  }, [scope.key, target, status, rating]);
  const reviewsQuery = useMemo(() => query(collection(db, COLLECTIONS.reviews), ...constraints, orderBy('createdAt', 'desc')), [constraints]);
  const reviews = useInfiniteCollection<Review>(reviewsQuery, { pageSize: 30 });

  const pendingQuery = useMemo(() => query(collection(db, COLLECTIONS.reviews), ...scope.constraints, where('status', '==', 'pending_moderation'), orderBy('createdAt', 'desc'), limit(99)), [scope.key]);
  const pending = useCollection<Review>(pendingQuery);
  const reportsQuery = useMemo(() => (can('reviews.moderate') ? query(collection(db, COLLECTIONS.contentReports), where('status', 'in', ['open', 'under_review']), limit(99)) : null), [can]);
  const reports = useCollection<ContentReport>(reportsQuery);

  // Indicateurs 30 jours : agrégations côté serveur.
  const [kpis, setKpis] = useState<{ avg: number | null; count: number; low: number } | 'error' | null>(null);
  useEffect(() => {
    let alive = true;
    setKpis(null);
    const since = Timestamp.fromMillis(Date.now() - 30 * DAY);
    const base = [...scope.constraints, where('status', '==', 'published'), where('createdAt', '>=', since)];
    Promise.all([
      getAggregateFromServer(query(collection(db, COLLECTIONS.reviews), ...base), { avg: average('restaurantRating'), count: count() }),
      getAggregateFromServer(query(collection(db, COLLECTIONS.reviews), ...base, where('restaurantRating', 'in', [1, 2])), { count: count() }),
    ])
      .then(([all, low]) => alive && setKpis({ avg: all.data().avg, count: all.data().count, low: low.data().count }))
      // Une erreur d'agrégation n'est jamais présentée comme « 0 avis » : les indicateurs sont marqués indisponibles.
      .catch(() => alive && setKpis('error'));
    return () => {
      alive = false;
    };
  }, [scope.key]);

  const rows = reviews.data.filter((r) => {
    if (target === 'driver' && status !== 'all' && r.status !== status) return false;
    if (withComment && !r.comment) return false;
    if (!search) return true;
    const hay = `${r.comment ?? ''} ${r.customerDisplayName} ${restaurants.byId.get(r.restaurantId)?.name ?? ''} ${r.orderId}`.toLowerCase();
    return hay.includes(search.toLowerCase());
  });

  const openReview = useDoc<Review>(orderId ? docAt(`${COLLECTIONS.reviews}/${orderId}`) : null);
  const selected = orderId && openReview.data ? ({ ...openReview.data, id: orderId } as WithId<Review>) : null;

  return (
    <PageContainer wide>
      <PageHeader
        eyebrow="Opérations"
        title="Avis et notes"
        description={`Avis publics sur les restaurants et les livreurs, filtrés automatiquement puis modérés avec motif · ${scope.label}.`}
      />
      <AvisNav pending={pending.data.length} reports={reports.data.length} />

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Note moyenne (30 j)" value={kpis === null ? '…' : kpis === 'error' ? '—' : kpis.avg ? kpis.avg.toFixed(2).replace('.', ',') : '—'} icon={<Star />} tone={kpis === 'error' ? 'neutral' : ratingTone(kpis?.avg)} hint={kpis === 'error' ? 'Indicateur indisponible pour le moment' : kpis ? `${formatNumber(kpis.count)} avis publiés` : undefined} />
        <Kpi label="Avis négatifs (30 j)" value={kpis === null ? '…' : kpis === 'error' ? '—' : kpis.count ? formatPercent(kpis.low / kpis.count) : '—'} icon={<ThumbsDown />} tone={kpis && kpis !== 'error' && kpis.count && kpis.low / kpis.count > 0.15 ? 'danger' : 'neutral'} hint={kpis === 'error' ? 'Indicateur indisponible pour le moment' : '1 ou 2 étoiles'} />
        <Kpi label="En modération" value={pending.loading ? '…' : pending.data.length} icon={<ShieldAlert />} tone={pending.data.length ? 'amber' : 'success'} hint="Retenus par le filtre" />
        <Kpi label="Signalements ouverts" value={!can('reviews.moderate') ? '—' : reports.loading ? '…' : reports.data.length} icon={<Flag />} tone={reports.data.length ? 'danger' : 'neutral'} hint={can('reviews.moderate') ? 'Avis et réponses signalés' : 'Réservé à la modération'} />
      </div>

      {pending.data.length > 0 && status !== 'pending_moderation' && (
        <Card className="tone-amber mb-6 flex flex-wrap items-center justify-between gap-3 border-(--tone-border) bg-(--tone-bg) px-5 py-3">
          <div className="flex items-center gap-2 text-sm text-(--tone-fg)"><AlertTriangle className="size-4" />{pending.data.length} avis retenus par le filtre automatique attendent une décision.</div>
          <Button size="sm" onClick={() => { setTarget('restaurant'); setStatus('pending_moderation'); setRating('all'); }}>Examiner</Button>
        </Card>
      )}

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <SegmentedControl
          value={target}
          onValueChange={(v) => setTarget(v as Target)}
          options={[{ value: 'restaurant', label: 'Restaurants', icon: <Store /> }, { value: 'driver', label: 'Livreurs', icon: <Bike /> }]}
          aria-label="Avis sur"
        />
        <Select
          className="w-44"
          value={status}
          onValueChange={setStatus}
          aria-label="Statut"
          options={[{ value: 'all', label: 'Tous les statuts' }, { value: 'published', label: 'Publiés' }, { value: 'pending_moderation', label: 'En modération' }, { value: 'hidden', label: 'Masqués' }, { value: 'removed', label: 'Supprimés' }]}
        />
        <div className="flex flex-wrap items-center gap-1 rounded-lg border border-border bg-surface p-0.5" role="group" aria-label="Note">
          {['all', '5', '4', '3', '2', '1'].map((n) => (
            <button
              key={n}
              type="button"
              aria-pressed={rating === n}
              onClick={() => setRating(n)}
              className={cn('inline-flex h-8 items-center gap-1 rounded-md px-2.5 text-sm transition-colors', rating === n ? 'bg-surface-3 font-medium text-fg' : 'text-fg-muted hover:text-fg')}
            >
              {n === 'all' ? 'Toutes' : <>{n}<Star className="size-3.5" /></>}
            </button>
          ))}
        </div>
        <button type="button" aria-pressed={withComment} onClick={() => setWithComment((v) => !v)} className={cn('inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-sm', withComment ? 'border-primary/50 bg-primary-soft text-fg' : 'border-border bg-surface text-fg-muted')}>
          <MessageSquareText className="size-4" /> Avec commentaire
        </button>
        <Input className="w-full md:ml-auto md:w-64" leading={<Search />} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Client, restaurant, texte…" />
      </div>

      {reviews.error ? <Card><LoadError error={reviews.error} /></Card> : (
        <Card className="overflow-hidden">
          {reviews.loading ? (
            <div className="space-y-3 p-5">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-16" />)}</div>
          ) : rows.length === 0 ? (
            <EmptyState icon={<Star />} title="Aucun avis" description="Aucun avis ne correspond à ces filtres dans le périmètre choisi." />
          ) : (
            <ul className="divide-y divide-border">
              {rows.map((r) => {
                const restaurant = restaurants.byId.get(r.restaurantId);
                const driver = r.driverId ? drivers.byId.get(r.driverId) : null;
                const value = target === 'driver' ? (r.driverRating ?? 0) : r.restaurantRating;
                return (
                  <li key={r.id}>
                    <button type="button" onClick={() => navigate(`/avis/${r.id}`)} className="flex w-full flex-col gap-2 px-5 py-4 text-left transition-colors hover:bg-surface-2 sm:flex-row sm:items-start sm:gap-5">
                      <div className="flex shrink-0 items-center gap-3 sm:w-40 sm:flex-col sm:items-start sm:gap-1">
                        <Stars value={value} />
                        <span className="text-xs text-fg-muted">{formatRelative(millis(r.createdAt))}</span>
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                          <span className="font-medium text-fg">{target === 'driver' ? (driver?.displayName ?? 'Livreur') : (restaurant?.name ?? r.restaurantId)}</span>
                          <span className="text-fg-subtle">·</span>
                          <span className="text-fg-muted">{r.customerDisplayName}</span>
                          {target === 'driver' && <span className="text-xs text-fg-subtle">({restaurant?.name ?? r.restaurantId})</span>}
                        </div>
                        <ReviewComment review={r} clamp className="mt-1 text-fg-muted" />
                        <div className="mt-2 flex flex-wrap items-center gap-1.5">
                          {r.status !== 'published' && <ReviewStatusBadge status={r.status} />}
                          {r.autoModeration?.flagged && <Badge size="sm" tone="amber" icon={<AlertTriangle />}>{r.autoModeration.reasons[0] ?? 'Filtre'}</Badge>}
                          {r.reportsCount > 0 && <Badge size="sm" tone="danger" icon={<Flag />}>Signalé</Badge>}
                          {r.reply && <Badge size="sm" tone={r.reply.status === 'hidden' ? 'neutral' : 'info'} icon={<MessageSquareReply />}>{r.reply.status === 'hidden' ? 'Réponse masquée' : 'Réponse'}</Badge>}
                        </div>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          {reviews.hasMore && !reviews.loading && (
            <div className="border-t border-border p-3 text-center">
              <Button variant="ghost" loading={reviews.loadingMore} onClick={reviews.loadMore}>Afficher plus d’avis</Button>
            </div>
          )}
        </Card>
      )}

      <Sheet open={Boolean(orderId)} onOpenChange={(o) => !o && navigate('/avis')}>
        <SheetContent className="w-full sm:max-w-xl">
          {openReview.loading ? <div className="p-6"><Skeleton className="h-64" /></div> : selected ? (
            <ReviewDetail review={selected} restaurantName={restaurants.byId.get(selected.restaurantId)?.name} driverName={selected.driverId ? drivers.byId.get(selected.driverId)?.displayName : undefined} />
          ) : (
            <EmptyState icon={<Star />} title="Avis introuvable" description="Cet avis n’existe pas ou n’est pas dans votre périmètre." />
          )}
        </SheetContent>
      </Sheet>
    </PageContainer>
  );
}
