// Composants des avis : navigation, fiche d'un avis et actions de modération.
import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { AlertTriangle, ArrowUpRight, Bike, EyeOff, Filter, Flag, MessageSquareReply, RotateCcw, ShieldCheck, Star, Store, Trash2, TrendingDown } from 'lucide-react';
import {
  Badge,
  Button,
  ConfirmDialog,
  SheetBody,
  SheetHeader,
  Skeleton,
  StatusBadge,
  cn,
  formatDateTime,
} from '@golink/ui';
import {
  COLLECTIONS,
  REVIEW_TAG_LABELS,
  maskModeratedTerms,
  scanReviewText,
  type ContentReport,
  type ModerateReviewInput,
  type Review,
  type WithId,
} from '@golink/shared';
import { useAdminAccess } from '@/auth/AdminAccess';
import { callFunction, docAt, useDoc, useMutation } from '@/lib/firestore';
import { millis } from '../_experience/format';
import { REVIEW_STATUS_META } from '../_experience/labels';
import { InfoRow, Stars, SubNav } from '../_experience/ui';

export function AvisNav({ pending, reports }: { pending?: number | null; reports?: number | null }) {
  const { can } = useAdminAccess();
  return (
    <SubNav
      items={[
        { to: '/avis', label: 'Avis', icon: <Star />, count: pending, end: true },
        { to: '/avis/qualite', label: 'Suivi qualité', icon: <TrendingDown /> },
        { to: '/avis/signalements', label: 'Signalements', icon: <Flag />, count: reports, hidden: !can('reviews.moderate') },
        { to: '/avis/filtre', label: 'Filtre automatique', icon: <Filter /> },
      ]}
    />
  );
}

export function ReviewStatusBadge({ status }: { status: Review['status'] }) {
  return <StatusBadge status={status} map={REVIEW_STATUS_META} />;
}

/** Commentaire avec les termes détectés masqués (affichage) et signalés. */
export function ReviewComment({ review, className, clamp }: { review: Review; className?: string; clamp?: boolean }) {
  const verdict = useMemo(() => scanReviewText(review.comment), [review.comment]);
  if (!review.comment) return <p className={cn('text-sm italic text-fg-subtle', className)}>Note sans commentaire.</p>;
  const text = verdict.flagged ? maskModeratedTerms(review.comment, verdict.matches) : review.comment;
  return <p className={cn('text-sm text-fg [overflow-wrap:anywhere]', clamp && 'line-clamp-3', className)} title={clamp ? text : undefined}>« {text} »</p>;
}

const moderate = callFunction<ModerateReviewInput, { ok: boolean }>('moderateReview');

type Pending = { target: 'review' | 'reply'; action: ModerateReviewInput['action'] } | null;

const ACTION_COPY: Record<string, { title: string; confirm: string; description: string; destructive?: boolean }> = {
  'review:hide': { title: 'Masquer cet avis ?', confirm: 'Masquer', description: 'L’avis n’est plus visible dans l’app ; la note moyenne est recalculée. Le client est informé du motif.', destructive: true },
  'review:remove': { title: 'Supprimer cet avis ?', confirm: 'Supprimer', description: 'Pour un contenu illicite (insulte, haine, données personnelles). L’avis est retiré définitivement de l’affichage.', destructive: true },
  'review:restore': { title: 'Rétablir cet avis ?', confirm: 'Rétablir', description: 'L’avis redevient public et compte à nouveau dans la note moyenne.' },
  'review:publish': { title: 'Publier cet avis ?', confirm: 'Publier', description: 'Retenu par le filtre automatique : après vérification, il devient public.' },
  'reply:hide': { title: 'Masquer la réponse du restaurant ?', confirm: 'Masquer la réponse', description: 'Le restaurant est informé du motif et ne peut plus la modifier sans passer par le support.', destructive: true },
  'reply:restore': { title: 'Rétablir la réponse du restaurant ?', confirm: 'Rétablir', description: 'La réponse redevient visible sous l’avis.' },
};

/** Contenu de la fiche latérale d'un avis. */
export function ReviewDetail({ review, restaurantName, driverName, reportId }: { review: WithId<Review>; restaurantName?: string; driverName?: string; reportId?: string | null }) {
  const { can } = useAdminAccess();
  const canModerate = can('reviews.moderate');
  const [pending, setPending] = useState<Pending>(null);
  const { mutate } = useMutation(moderate, { success: 'Décision enregistrée' });
  const verdict = useMemo(() => scanReviewText(review.comment), [review.comment]);
  const copy = pending ? ACTION_COPY[`${pending.target}:${pending.action}`] : null;
  const report = useDoc<ContentReport>(review.restaurantReport?.reportId && canModerate ? docAt(`${COLLECTIONS.contentReports}/${review.restaurantReport.reportId}`) : null);

  return (
    <>
      <SheetHeader
        title={<span className="flex items-center gap-2"><Stars value={review.restaurantRating} size="md" /><span className="num">{review.restaurantRating}/5</span></span>}
        description={`${review.customerDisplayName} · ${formatDateTime(millis(review.createdAt))}`}
      />
      <SheetBody className="space-y-5">
        <div className="flex flex-wrap items-center gap-2">
          <ReviewStatusBadge status={review.status} />
          {review.autoModeration?.flagged && <Badge tone="amber" icon={<AlertTriangle />}>Filtre : {review.autoModeration.reasons.join(', ') || 'signalé'}</Badge>}
          {review.reportsCount > 0 && <Badge tone="danger" icon={<Flag />}>{review.reportsCount} signalement{review.reportsCount > 1 ? 's' : ''}</Badge>}
        </div>

        <div className="rounded-xl border border-border bg-surface-2 p-4">
          <ReviewComment review={review} />
          {verdict.flagged && (
            <p className="mt-2 text-xs text-fg-muted">Termes détectés : {verdict.matches.map((m) => m.term).join(', ')}</p>
          )}
          {review.tags.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {review.tags.map((t) => <Badge key={t} size="sm" tone="neutral" variant="outline">{REVIEW_TAG_LABELS[t] ?? t}</Badge>)}
            </div>
          )}
        </div>

        <dl className="divide-y divide-border rounded-xl border border-border px-4">
          <InfoRow label="Restaurant">
            <Link to={`/restaurants/${review.restaurantId}`} className="inline-flex items-center gap-1 hover:underline"><Store className="size-3.5" />{restaurantName ?? review.restaurantId}</Link>
          </InfoRow>
          <InfoRow label="Livreur">
            {review.driverId ? (
              <span className="inline-flex items-center gap-2">
                <Link to={`/livreurs/${review.driverId}`} className="inline-flex items-center gap-1 hover:underline"><Bike className="size-3.5" />{driverName ?? 'Livreur'}</Link>
                {review.driverRating ? <Stars value={review.driverRating} /> : <span className="text-fg-subtle">non noté</span>}
              </span>
            ) : <span className="text-fg-subtle">Retrait ou livraison par le restaurant</span>}
          </InfoRow>
          <InfoRow label="Commande">
            <Link to={`/commandes/${review.orderId}`} className="inline-flex items-center gap-1 font-mono hover:underline">{review.orderId}<ArrowUpRight className="size-3" /></Link>
          </InfoRow>
        </dl>

        {review.restaurantReport && (
          <div className="tone-danger rounded-xl border border-(--tone-border) bg-(--tone-bg) p-4 text-sm">
            <div className="flex items-center gap-2 font-medium text-(--tone-fg)"><Flag className="size-4" />Signalé par le restaurant</div>
            <p className="mt-1 text-fg">{report.loading ? <Skeleton className="h-4 w-40" /> : (report.data?.details ?? review.restaurantReport.reason)}</p>
          </div>
        )}

        <section>
          <h3 className="eyebrow mb-2">Réponse du restaurant</h3>
          {review.reply ? (
            <div className={cn('rounded-xl border border-border p-4', review.reply.status === 'hidden' && 'opacity-70')}>
              <div className="mb-1 flex items-center gap-2 text-xs text-fg-muted">
                <MessageSquareReply className="size-3.5" />
                {review.reply.by === 'system' ? 'Réponse automatique' : 'Réponse de l’équipe'} · {formatDateTime(millis(review.reply.at))}
                {review.reply.status === 'hidden' && <Badge size="sm" tone="neutral">Masquée</Badge>}
              </div>
              <p className="text-sm text-fg [overflow-wrap:anywhere]">{review.reply.text}</p>
              {review.reply.moderation && <p className="mt-2 text-xs text-fg-subtle">Modération : {review.reply.moderation.reason}</p>}
              {canModerate && (
                <div className="mt-3">
                  {review.reply.status === 'hidden'
                    ? <Button size="xs" leftIcon={<RotateCcw />} onClick={() => setPending({ target: 'reply', action: 'restore' })}>Rétablir la réponse</Button>
                    : <Button size="xs" variant="danger-soft" leftIcon={<EyeOff />} onClick={() => setPending({ target: 'reply', action: 'hide' })}>Masquer la réponse</Button>}
                </div>
              )}
            </div>
          ) : <p className="text-sm text-fg-muted">Le restaurant n’a pas répondu.</p>}
        </section>

        {review.moderation && (
          <section>
            <h3 className="eyebrow mb-2">Dernière décision</h3>
            <p className="text-sm text-fg-muted">
              {review.moderation.action === 'restored' ? 'Rétabli' : review.moderation.action === 'hidden' ? 'Masqué' : 'Supprimé'} le {formatDateTime(millis(review.moderation.at))} : {review.moderation.reason}
            </p>
          </section>
        )}

        {canModerate ? (
          <section className="flex flex-wrap gap-2 border-t border-border pt-4">
            {review.status === 'pending_moderation' && <Button variant="primary" leftIcon={<ShieldCheck />} onClick={() => setPending({ target: 'review', action: 'publish' })}>Publier</Button>}
            {review.status === 'published' && <Button variant="danger-soft" leftIcon={<EyeOff />} onClick={() => setPending({ target: 'review', action: 'hide' })}>Masquer</Button>}
            {(review.status === 'hidden' || review.status === 'removed') && <Button leftIcon={<RotateCcw />} onClick={() => setPending({ target: 'review', action: 'restore' })}>Rétablir</Button>}
            {review.status !== 'removed' && <Button variant="ghost" leftIcon={<Trash2 />} onClick={() => setPending({ target: 'review', action: 'remove' })}>Supprimer</Button>}
          </section>
        ) : (
          <p className="border-t border-border pt-4 text-xs text-fg-muted">Consultation seule : la modération est réservée aux membres habilités.</p>
        )}
      </SheetBody>
      {copy && pending && (
        <ConfirmDialog
          open
          onOpenChange={(o) => !o && setPending(null)}
          title={copy.title}
          description={copy.description}
          confirmLabel={copy.confirm}
          destructive={copy.destructive}
          requireReason
          reasonLabel="Motif (communiqué à l’auteur et conservé dans le journal d’audit)"
          onConfirm={async (reason) => {
            await mutate({ orderId: review.id, target: pending.target, action: pending.action, reason: reason ?? '', reportId: reportId ?? review.restaurantReport?.reportId ?? null });
          }}
        />
      )}
    </>
  );
}
