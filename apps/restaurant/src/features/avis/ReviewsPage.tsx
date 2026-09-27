import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { Flag, MessageCircleReply, MessagesSquare, Pencil, Search, ShieldAlert, Star, ThumbsUp, Trash2, X } from 'lucide-react';
import {
  Avatar,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
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
  Select,
  Skeleton,
  StatCard,
  Textarea,
  cn,
  formatDate,
  formatNumber,
  formatPercent,
  formatRelative,
} from '@golink/ui';
import { REVIEW_REPORT_REASON_LABELS, REVIEW_REPORT_REASONS, REVIEW_TAG_LABELS, type ReviewReportReason } from '@golink/shared';
import { useRestaurantAccess } from '@/auth/RestaurantAccess';
import { errorMessage, toDate, toMillis, useMutation } from '@/lib/firestore';
import { TemplatePicker } from '../modeles/lib';
import { useOrderNumbers } from '../messages/order-numbers';
import { replyToReview, reportReview, useRestaurantReviews, type ReviewRow } from './lib';

const DAY = 86_400_000;
const PAGE = 15;
type Filter = 'all' | 'unanswered' | 'negative' | 'reported';

export function Stars({ value, size = 'sm' }: { value: number; size?: 'sm' | 'md' }) {
  return (
    <span className="inline-flex items-center gap-0.5" role="img" aria-label={`${value} sur 5`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Star
          key={i}
          aria-hidden="true"
          className={cn(size === 'sm' ? 'size-3.5' : 'size-5', i <= Math.round(value) ? 'fill-amber-400 text-amber-400' : 'fill-surface-3 text-border-strong')}
        />
      ))}
    </span>
  );
}

const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? '';

export function ReviewsPage() {
  const { restaurant } = useRestaurantAccess();
  const { data, loading, error } = useRestaurantReviews();
  const [filter, setFilter] = useState<Filter>('all');
  const [rating, setRating] = useState<number | null>(null);
  const [search, setSearch] = useState('');
  const [shown, setShown] = useState(PAGE);
  const [reporting, setReporting] = useState<ReviewRow | null>(null);

  const visible = useMemo(() => data.filter((r) => r.status !== 'removed'), [data]);
  const stats = useMemo(() => {
    const now = Date.now();
    const last30 = visible.filter((r) => (toMillis(r.createdAt) ?? 0) >= now - 30 * DAY);
    const prev30 = visible.filter((r) => {
      const t = toMillis(r.createdAt) ?? 0;
      return t < now - 30 * DAY && t >= now - 60 * DAY;
    });
    const published = visible.filter((r) => r.status === 'published');
    const answered = published.filter((r) => r.reply).length;
    const avg = (list: ReviewRow[]) => (list.length ? list.reduce((s, r) => s + r.restaurantRating, 0) / list.length : null);
    const distribution = [5, 4, 3, 2, 1].map((n) => ({ n, count: visible.filter((r) => r.restaurantRating === n).length }));
    const tags = new Map<string, number>();
    for (const r of last30.length >= 10 ? last30 : visible) for (const t of r.tags) tags.set(t, (tags.get(t) ?? 0) + 1);
    return {
      last30: last30.length,
      delta: prev30.length ? (last30.length - prev30.length) / prev30.length : undefined,
      avg30: avg(last30),
      responseRate: published.length ? answered / published.length : null,
      unanswered: published.filter((r) => !r.reply && r.restaurantRating <= 3).length,
      distribution,
      tags: [...tags.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8),
    };
  }, [visible]);

  const counts = useMemo(
    () => ({
      all: visible.length,
      unanswered: visible.filter((r) => r.status === 'published' && !r.reply).length,
      negative: visible.filter((r) => r.restaurantRating <= 3).length,
      reported: visible.filter((r) => r.restaurantReport || r.status === 'hidden').length,
    }),
    [visible],
  );

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return visible.filter((r) => {
      if (filter === 'unanswered' && (r.status !== 'published' || r.reply)) return false;
      if (filter === 'negative' && r.restaurantRating > 3) return false;
      if (filter === 'reported' && !r.restaurantReport && r.status !== 'hidden') return false;
      if (rating !== null && r.restaurantRating !== rating) return false;
      if (needle && !`${r.comment ?? ''} ${r.customerDisplayName} ${r.reply?.text ?? ''}`.toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [visible, filter, rating, search]);
  const orderNumbers = useOrderNumbers(filtered.slice(0, shown).map((r) => r.orderId));

  const average = restaurant.rating.count > 0 ? restaurant.rating.average : (stats.avg30 ?? 0);
  const totalCount = Math.max(restaurant.rating.count, visible.length);

  return (
    <PageContainer>
      <PageHeader
        eyebrow="Réputation"
        title="Avis clients"
        description="Répondez publiquement à vos clients, repérez ce qu’ils aiment et signalez les avis abusifs à la modération Ciyou Eats."
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,340px)_minmax(0,1fr)]">
        <Card padding="md" className="flex flex-col gap-5">
          {loading ? (
            <Skeleton className="h-44" />
          ) : (
            <>
              <div className="flex items-end gap-4">
                <p className="font-display text-5xl font-semibold tracking-display text-fg num">
                  {average ? average.toLocaleString('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) : '—'}
                </p>
                <div className="pb-1.5">
                  <Stars value={average} size="md" />
                  <p className="mt-1 text-xs text-fg-muted">{formatNumber(totalCount)} avis au total</p>
                </div>
              </div>
              <div className="space-y-1.5">
                {stats.distribution.map(({ n, count }) => {
                  const ratio = visible.length ? count / visible.length : 0;
                  const active = rating === n;
                  return (
                    <button
                      key={n}
                      type="button"
                      aria-pressed={active}
                      onClick={() => {
                        setRating(active ? null : n);
                        setShown(PAGE);
                      }}
                      className={cn('flex w-full items-center gap-3 rounded-md px-1.5 py-1 text-xs transition-colors hover:bg-surface-3', active && 'bg-surface-3')}
                    >
                      <span className="flex w-7 items-center gap-0.5 font-mono text-fg-muted num">
                        {n}
                        <Star className="size-3 fill-amber-400 text-amber-400" />
                      </span>
                      <span className="relative h-2 flex-1 overflow-hidden rounded-full bg-surface-3">
                        <span className={cn('absolute inset-y-0 left-0 rounded-full', n >= 4 ? 'bg-success' : n === 3 ? 'bg-amber-400' : 'bg-danger')} style={{ width: `${ratio * 100}%` }} />
                      </span>
                      <span className="w-8 text-right font-mono text-fg-muted num">{count}</span>
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </Card>
        <div className="grid min-w-0 gap-4 sm:grid-cols-2">
          <StatCard label="Avis sur 30 jours" value={formatNumber(stats.last30)} delta={stats.delta} deltaLabel="vs 30 jours précédents" icon={<MessagesSquare />} loading={loading} />
          <StatCard
            label="Note sur 30 jours"
            value={stats.avg30 === null ? '—' : stats.avg30.toLocaleString('fr-FR', { maximumFractionDigits: 2, minimumFractionDigits: 1 })}
            icon={<Star />}
            tone="amber"
            loading={loading}
            footer="Moyenne des avis récents."
          />
          <StatCard
            label="Taux de réponse"
            value={stats.responseRate === null ? '—' : formatPercent(stats.responseRate)}
            icon={<MessageCircleReply />}
            tone="success"
            loading={loading}
            footer="Répondre rassure les futurs clients."
          />
          <StatCard
            label="Avis négatifs sans réponse"
            value={formatNumber(stats.unanswered)}
            icon={<ShieldAlert />}
            tone={stats.unanswered > 0 ? 'danger' : 'teal'}
            loading={loading}
            onClick={stats.unanswered > 0 ? () => (setFilter('unanswered'), setRating(null)) : undefined}
            footer={stats.unanswered > 0 ? 'Cliquez pour les traiter.' : 'Tout est à jour.'}
          />
        </div>
      </div>

      {stats.tags.length > 0 && (
        <Card className="mt-4">
          <CardHeader title="Ce que disent vos clients" icon={<ThumbsUp />} description="Étiquettes les plus citées dans les avis récents." />
          <CardContent className="flex flex-wrap gap-2">
            {stats.tags.map(([tag, count]) => {
              const negative = ['froid', 'temperature', 'en_retard', 'article_manquant', 'portions_petites'].includes(tag);
              return (
                <Badge key={tag} tone={negative ? 'danger' : 'success'}>
                  {REVIEW_TAG_LABELS[tag] ?? tag.replace(/_/g, ' ')} <span className="font-mono opacity-70 num">{count}</span>
                </Badge>
              );
            })}
          </CardContent>
        </Card>
      )}

      <div className="mt-6 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <SegmentedControl
          aria-label="Filtrer les avis"
          value={filter}
          onValueChange={(v) => {
            setFilter(v as Filter);
            setShown(PAGE);
          }}
          options={[
            { value: 'all', label: 'Tous', count: counts.all },
            { value: 'unanswered', label: 'Sans réponse', count: counts.unanswered },
            { value: 'negative', label: 'Négatifs', count: counts.negative },
            { value: 'reported', label: 'Signalés', count: counts.reported },
          ]}
        />
        <div className="flex items-center gap-2">
          {rating !== null && (
            <Button size="sm" variant="soft" rightIcon={<X />} onClick={() => setRating(null)}>
              {rating} étoile{rating > 1 ? 's' : ''}
            </Button>
          )}
          <Input className="w-full lg:w-64" leading={<Search />} placeholder="Rechercher dans les avis…" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Rechercher dans les avis" />
        </div>
      </div>

      <div className="mt-4 space-y-3">
        {error ? (
          <Card>
            <EmptyState icon={<Star />} title="Impossible de charger les avis" description={errorMessage(error)} />
          </Card>
        ) : loading ? (
          [0, 1, 2].map((i) => <Skeleton key={i} className="h-40 rounded-xl" />)
        ) : filtered.length === 0 ? (
          <Card>
            {visible.length === 0 ? (
              <EmptyState icon={<Star />} title="Pas encore d’avis" description="Vos clients peuvent noter chaque commande livrée : leurs avis apparaîtront ici en temps réel." />
            ) : (
              <EmptyState compact icon={<Search />} title="Aucun avis ne correspond" description="Modifiez le filtre ou la recherche." />
            )}
          </Card>
        ) : (
          <>
            {filtered.slice(0, shown).map((review) => (
              <ReviewCard
                key={review.id}
                review={review}
                orderNumber={orderNumbers[review.orderId] ?? null}
                restaurantName={restaurant.name}
                onReport={() => setReporting(review)}
              />
            ))}
            {filtered.length > shown && (
              <div className="flex justify-center pt-2">
                <Button variant="secondary" onClick={() => setShown((n) => n + PAGE)}>
                  Afficher plus ({formatNumber(filtered.length - shown)} restants)
                </Button>
              </div>
            )}
          </>
        )}
      </div>

      <ReportDialog review={reporting} onClose={() => setReporting(null)} />
    </PageContainer>
  );
}

function ReviewCard({
  review: r,
  orderNumber,
  restaurantName,
  onReport,
}: {
  review: ReviewRow;
  orderNumber: string | null;
  restaurantName: string;
  onReport: () => void;
}) {
  const [composing, setComposing] = useState(false);
  const [text, setText] = useState('');
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const reply = useMutation(replyToReview, { success: (res) => (res.replied ? 'Réponse publiée.' : 'Réponse retirée.') });
  const created = toDate(r.createdAt);
  const replyHidden = r.reply?.status === 'hidden';

  async function publish() {
    const done = await reply.mutate({ orderId: r.orderId, text: text.trim(), templateId });
    if (done) {
      setComposing(false);
      setText('');
      setTemplateId(null);
    }
  }

  return (
    <Card className="p-5">
      <div className="flex items-start gap-3.5">
        <Avatar name={r.customerDisplayName} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <p className="font-medium text-fg">{r.customerDisplayName}</p>
            <Stars value={r.restaurantRating} />
            <span className="text-xs text-fg-subtle" title={created ? formatDate(created) : undefined}>
              {created ? formatRelative(created) : ''}
            </span>
            <Link to={`/commandes/${r.orderId}`} className="font-mono text-2xs text-fg-subtle hover:text-fg hover:underline">
              {orderNumber ?? r.orderId}
            </Link>
          </div>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {r.status === 'pending_moderation' && <Badge tone="info" size="sm">En modération</Badge>}
            {r.status === 'hidden' && <Badge tone="neutral" size="sm">Masqué par Ciyou Eats</Badge>}
            {r.restaurantReport && (
              <Badge tone="amber" size="sm" icon={<Flag />}>
                Signalé le {formatDate(toDate(r.restaurantReport.at) ?? new Date())}
              </Badge>
            )}
            {r.driverRating ? <Badge size="sm">Livreur {r.driverRating}★</Badge> : null}
            {r.tags.map((t) => (
              <Badge key={t} size="sm" variant="outline">
                {REVIEW_TAG_LABELS[t] ?? t.replace(/_/g, ' ')}
              </Badge>
            ))}
          </div>
          {r.comment ? (
            <p className="mt-3 text-base leading-6 text-fg">{r.comment}</p>
          ) : (
            <p className="mt-3 text-sm italic text-fg-subtle">Note sans commentaire.</p>
          )}

          {r.reply && !composing && (
            <div className={cn('mt-4 rounded-xl border-l-2 bg-surface-2 p-3.5', replyHidden ? 'border-border-strong' : 'border-primary')}>
              <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs font-medium text-fg">
                  Réponse de {restaurantName}
                  <span className="ml-2 font-normal text-fg-subtle">
                    {r.reply.by === 'system' ? 'automatique · ' : ''}
                    {formatRelative(toDate(r.reply.at) ?? new Date())}
                  </span>
                </p>
                {replyHidden ? (
                  <Badge size="sm" tone="neutral">
                    Masquée par la modération
                  </Badge>
                ) : (
                  <div className="flex gap-1">
                    <Button
                      size="xs"
                      variant="ghost"
                      leftIcon={<Pencil />}
                      onClick={() => {
                        setText(r.reply?.text ?? '');
                        setComposing(true);
                      }}
                    >
                      Modifier
                    </Button>
                    <Button size="xs" variant="ghost" leftIcon={<Trash2 />} onClick={() => setConfirmDelete(true)}>
                      Retirer
                    </Button>
                  </div>
                )}
              </div>
              <p className="whitespace-pre-line text-sm text-fg-muted">{r.reply.text}</p>
            </div>
          )}

          {composing && (
            <div className="mt-4 space-y-2.5">
              <Textarea
                autoFocus
                rows={3}
                maxLength={1000}
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder={`Répondez à ${firstName(r.customerDisplayName) || 'votre client'}… Votre réponse sera publique.`}
                aria-label="Votre réponse publique"
              />
              <div className="flex flex-wrap items-center justify-between gap-2">
                <TemplatePicker
                  kind="review_reply"
                  rating={r.restaurantRating}
                  variables={{ prenom: firstName(r.customerDisplayName), restaurant: restaurantName }}
                  onPick={(value, id) => {
                    setText(value);
                    setTemplateId(id);
                  }}
                />
                <div className="flex items-center gap-2">
                  <span className="font-mono text-2xs text-fg-subtle num">{text.length}/1000</span>
                  <Button size="sm" variant="ghost" onClick={() => setComposing(false)} disabled={reply.loading}>
                    Annuler
                  </Button>
                  <Button size="sm" variant="primary" loading={reply.loading} disabled={text.trim().length < 2} onClick={() => void publish()}>
                    Publier
                  </Button>
                </div>
              </div>
              <p className="text-xs text-fg-subtle">Restez courtois : pas de coordonnées personnelles, la réponse est visible de tous les clients Ciyou Eats.</p>
            </div>
          )}

          {!composing && (
            <div className="mt-4 flex flex-wrap gap-2">
              {!r.reply && r.status !== 'hidden' && (
                <Button size="sm" variant="secondary" leftIcon={<MessageCircleReply />} onClick={() => setComposing(true)}>
                  Répondre
                </Button>
              )}
              {!r.restaurantReport && (
                <Button size="sm" variant="ghost" leftIcon={<Flag />} onClick={onReport}>
                  Signaler
                </Button>
              )}
            </div>
          )}
        </div>
      </div>
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        destructive
        title="Retirer votre réponse ?"
        description="Elle ne sera plus visible sous l’avis. Vous pourrez en publier une nouvelle."
        confirmLabel="Retirer"
        onConfirm={async () => {
          await reply.mutate({ orderId: r.orderId, text: null, templateId: null });
        }}
      />
    </Card>
  );
}

function ReportDialog({ review, onClose }: { review: ReviewRow | null; onClose: () => void }) {
  const [reason, setReason] = useState<ReviewReportReason>('fake');
  const [details, setDetails] = useState('');
  const report = useMutation(reportReview, { success: 'Signalement transmis à la modération Ciyou Eats.' });
  return (
    <Dialog open={review !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent size="md">
        <DialogHeader
          icon={<Flag />}
          title="Signaler cet avis"
          description="La modération Ciyou Eats examine chaque signalement et masque les avis contraires à la charte. Un avis négatif mais sincère reste publié."
        />
        <DialogBody className="space-y-4">
          {review && (
            <div className="rounded-xl border border-border bg-surface-2 p-3.5 text-sm">
              <div className="mb-1 flex items-center gap-2">
                <span className="font-medium text-fg">{review.customerDisplayName}</span>
                <Stars value={review.restaurantRating} />
              </div>
              <p className="text-fg-muted">{review.comment ?? 'Note sans commentaire.'}</p>
            </div>
          )}
          <FormField label="Motif">
            <Select value={reason} onValueChange={(v) => setReason(v as ReviewReportReason)} options={REVIEW_REPORT_REASONS.map((r) => ({ value: r, label: REVIEW_REPORT_REASON_LABELS[r] }))} />
          </FormField>
          <FormField label="Précisions" required hint="Éléments factuels : date, contexte, échanges avec le client." aside={`${details.length}/2000`}>
            <Textarea rows={4} maxLength={2000} value={details} onChange={(e) => setDetails(e.target.value)} />
          </FormField>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={report.loading}>
            Annuler
          </Button>
          <Button
            variant="primary"
            loading={report.loading}
            disabled={details.trim().length < 10}
            onClick={async () => {
              if (!review) return;
              const done = await report.mutate({ orderId: review.orderId, reason, details: details.trim() });
              if (done) {
                setDetails('');
                onClose();
              }
            }}
          >
            Envoyer le signalement
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
