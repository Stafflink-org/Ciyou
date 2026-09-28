import { useMemo, useState } from 'react';
import { collection, limit, orderBy, query } from 'firebase/firestore';
import { CheckCheck, EyeOff, Flag, Scale, ShieldX, Trash2 } from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  DataTable,
  EmptyState,
  PageContainer,
  PageHeader,
  SegmentedControl,
  Sheet,
  SheetBody,
  SheetContent,
  SheetFooter,
  SheetHeader,
  Skeleton,
  StatusBadge,
  createColumnHelper,
  formatDateTime,
  formatRelative,
} from '@golink/ui';
import { COLLECTIONS, type ContentReport, type DecideContentReportInput, type Review, type WithId } from '@golink/shared';
import { useDocumentTitle } from '@golink/web';
import { useAdminAccess } from '@/auth/AdminAccess';
import { db } from '@/lib/firebase';
import { callFunction, docAt, useCollection, useDoc, useMutation } from '@/lib/firestore';
import { millis } from '../_experience/format';
import { REPORTER_LABELS, REPORT_REASON_LABELS, REPORT_STATUS_META } from '../_experience/labels';
import { Kpi, LoadError, Stars } from '../_experience/ui';
import { AvisNav, ReviewComment, ReviewStatusBadge } from './components';
import { useScopedRestaurants } from './hooks';

const decide = callFunction<DecideContentReportInput, { ok: boolean }>('decideContentReport');
const col = createColumnHelper<WithId<ContentReport>>();
const TARGET_LABELS: Record<ContentReport['targetType'], string> = {
  review: 'Avis',
  review_reply: 'Réponse à un avis',
  product: 'Produit',
  restaurant: 'Restaurant',
  image: 'Image',
  message: 'Message',
};

export function ReportsPage() {
  useDocumentTitle('Signalements · Avis · Ciyou Eats Admin');
  const { can } = useAdminAccess();
  const allowed = can('reviews.moderate');
  const q = useMemo(() => (allowed ? query(collection(db, COLLECTIONS.contentReports), orderBy('createdAt', 'desc'), limit(300)) : null), [allowed]);
  const { data, loading, error } = useCollection<ContentReport>(q);
  const restaurants = useScopedRestaurants();
  const [tab, setTab] = useState<'open' | 'done'>('open');
  const [selected, setSelected] = useState<WithId<ContentReport> | null>(null);

  const open = data.filter((r) => r.status === 'open' || r.status === 'under_review');
  const rows = tab === 'open' ? open : data.filter((r) => r.status === 'actioned' || r.status === 'dismissed');
  const columns = useMemo(
    () => [
      col.accessor('targetType', { header: 'Contenu', cell: (i) => <span className="whitespace-nowrap font-medium">{TARGET_LABELS[i.getValue()]}</span> }),
      col.accessor((r) => (r.restaurantId ? (restaurants.byId.get(r.restaurantId)?.name ?? r.restaurantId) : '—'), { id: 'restaurant', header: 'Restaurant' }),
      col.accessor('reason', { header: 'Motif', cell: (i) => <Badge tone="danger" size="sm">{REPORT_REASON_LABELS[i.getValue()]}</Badge> }),
      col.accessor('reporterType', { header: 'Signalé par', cell: (i) => <span className="text-sm text-fg-muted">{REPORTER_LABELS[i.getValue()]}</span> }),
      col.accessor('status', { header: 'Statut', cell: (i) => <StatusBadge status={i.getValue()} map={REPORT_STATUS_META} /> }),
      col.accessor((r) => millis(r.createdAt), { id: 'at', header: 'Reçu', cell: (i) => <span className="whitespace-nowrap text-xs text-fg-muted">{formatRelative(i.getValue())}</span> }),
    ],
    [restaurants.byId],
  );

  return (
    <PageContainer wide>
      <PageHeader
        eyebrow="Opérations"
        title="Avis et notes"
        description="Contenus signalés par les restaurants, les clients ou le filtre automatique. Chaque décision est motivée et notifiée (règlement européen sur les services numériques)."
      />
      <AvisNav reports={open.length} />
      {!allowed ? (
        <Card><EmptyState icon={<ShieldX />} title="Accès réservé à la modération" description="Les signalements sont traités par les membres habilités à modérer les avis." /></Card>
      ) : (
        <>
          <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Kpi label="À examiner" value={loading ? '…' : open.length} icon={<Flag />} tone={open.length ? 'danger' : 'success'} />
            <Kpi label="Contenus retirés" value={loading ? '…' : data.filter((r) => r.status === 'actioned').length} icon={<EyeOff />} />
            <Kpi label="Sans suite" value={loading ? '…' : data.filter((r) => r.status === 'dismissed').length} icon={<Scale />} />
            <Kpi label="Plus ancien en attente" value={open.length ? formatRelative(Math.min(...open.map((r) => millis(r.createdAt)))) : '—'} icon={<Flag />} />
          </div>
          <div className="mb-4">
            <SegmentedControl value={tab} onValueChange={(v) => setTab(v as 'open' | 'done')} options={[{ value: 'open', label: 'À examiner', count: open.length }, { value: 'done', label: 'Traités' }]} aria-label="Signalements" />
          </div>
          {error ? <Card><LoadError error={error} /></Card> : (
            <DataTable
              data={rows}
              columns={columns}
              loading={loading}
              getRowId={(r) => r.id}
              onRowClick={setSelected}
              itemLabel="signalements"
              emptyState={<EmptyState compact icon={<CheckCheck />} title={tab === 'open' ? 'Aucun signalement en attente' : 'Aucun signalement traité'} />}
            />
          )}
        </>
      )}
      <Sheet open={selected !== null} onOpenChange={(o) => !o && setSelected(null)}>
        <SheetContent className="w-full sm:max-w-xl">
          {selected && <ReportDetail report={selected} restaurantName={selected.restaurantId ? restaurants.byId.get(selected.restaurantId)?.name : undefined} onDone={() => setSelected(null)} />}
        </SheetContent>
      </Sheet>
    </PageContainer>
  );
}

function ReportDetail({ report, restaurantName, onDone }: { report: WithId<ContentReport>; restaurantName?: string; onDone: () => void }) {
  const reviewId = report.targetPath.startsWith(`${COLLECTIONS.reviews}/`) ? report.targetPath.split('/')[1] : null;
  const review = useDoc<Review>(reviewId ? docAt(`${COLLECTIONS.reviews}/${reviewId}`) : null);
  const [decision, setDecision] = useState<DecideContentReportInput['decision'] | null>(null);
  const { mutate } = useMutation(decide, { success: 'Décision enregistrée' });
  const done = report.status === 'actioned' || report.status === 'dismissed';

  return (
    <>
      <SheetHeader title={`${TARGET_LABELS[report.targetType]} signalé`} description={`${REPORTER_LABELS[report.reporterType]} · ${formatDateTime(millis(report.createdAt))}`} />
      <SheetBody className="space-y-5">
        <div className="flex flex-wrap gap-2">
          <StatusBadge status={report.status} map={REPORT_STATUS_META} />
          <Badge tone="danger">{REPORT_REASON_LABELS[report.reason]}</Badge>
          {restaurantName && <Badge tone="neutral" variant="outline">{restaurantName}</Badge>}
        </div>
        {report.details && (
          <section>
            <h3 className="eyebrow mb-1.5">Explication du signalement</h3>
            <p className="rounded-xl border border-border bg-surface-2 p-4 text-sm text-fg">{report.details}</p>
          </section>
        )}
        {reviewId && (
          <section>
            <h3 className="eyebrow mb-1.5">Contenu visé</h3>
            {review.loading ? <Skeleton className="h-24" /> : review.data ? (
              <div className="rounded-xl border border-border p-4">
                <div className="mb-2 flex items-center gap-2">
                  <Stars value={review.data.restaurantRating} />
                  <span className="text-xs text-fg-muted">{review.data.customerDisplayName}</span>
                  <ReviewStatusBadge status={review.data.status} />
                </div>
                <ReviewComment review={review.data} />
                {report.targetType === 'review_reply' && review.data.reply && (
                  <p className="mt-3 border-l-2 border-border pl-3 text-sm text-fg-muted">Réponse : {review.data.reply.text}</p>
                )}
              </div>
            ) : <p className="text-sm text-fg-muted">Contenu introuvable (déjà supprimé ?).</p>}
          </section>
        )}
        {report.decision && (
          <section>
            <h3 className="eyebrow mb-1.5">Décision</h3>
            <p className="text-sm text-fg-muted">{report.decision.action === 'no_action' ? 'Sans suite' : report.decision.action === 'hidden' ? 'Masqué' : 'Supprimé'} le {formatDateTime(millis(report.decision.at))} : {report.decision.reason}</p>
          </section>
        )}
      </SheetBody>
      {!done && (
        <SheetFooter className="flex-wrap">
          <Button variant="ghost" onClick={() => setDecision('no_action')}>Sans suite</Button>
          <Button variant="danger-soft" leftIcon={<EyeOff />} onClick={() => setDecision('hidden')}>Masquer</Button>
          {report.targetType !== 'review_reply' && <Button variant="danger" leftIcon={<Trash2 />} onClick={() => setDecision('removed')}>Supprimer</Button>}
        </SheetFooter>
      )}
      <ConfirmDialog
        open={decision !== null}
        onOpenChange={(o) => !o && setDecision(null)}
        title={decision === 'no_action' ? 'Classer sans suite ?' : decision === 'hidden' ? 'Masquer le contenu signalé ?' : 'Supprimer le contenu signalé ?'}
        description="L’auteur du signalement et, le cas échéant, l’auteur du contenu sont informés de la décision et de son motif."
        confirmLabel="Confirmer la décision"
        destructive={decision !== 'no_action'}
        requireReason
        reasonLabel="Motif de la décision (communiqué et conservé)"
        onConfirm={async (reason) => {
          if (!decision) return;
          if (await mutate({ reportId: report.id, decision, reason: reason ?? '' })) onDone();
        }}
      />
    </>
  );
}
