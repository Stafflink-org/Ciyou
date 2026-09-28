// Super admin §5 : file de validation des commerces (En attente → Documents
// manquants → Validé → Refusé), pièces à contrôler et documents qui expirent.
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { limit, orderBy, query, where } from 'firebase/firestore';
import { CalendarClock, ClipboardCheck, ExternalLink, FileSearch, FileWarning, Hourglass, RefreshCw, ShieldCheck } from 'lucide-react';
import {
  Button,
  Card,
  EmptyState,
  PageContainer,
  PageHeader,
  SegmentedControl,
  Skeleton,
  StatCard,
  StatusBadge,
  formatNumber,
  formatRelative,
  toast,
} from '@golink/ui';
import { COLLECTIONS, PARTNER_DOCUMENT_LABELS, type PartnerDocument, type WithId } from '@golink/shared';
import { useDocumentTitle } from '@golink/web';
import { useCan } from '@/auth/AdminAccess';
import { useGeoScope } from '@/layout/GeoScope';
import { collectionAt, toDate, useCollection, useMutation } from '@/lib/firestore';
import { ErrorPanel, Panel, plural } from '../acteurs-commun/ui';
import { AutoValidationSettingsCard } from './components/AutoValidationPanel';
import { RestaurantIdentity } from './components/RestaurantIdentity';
import { RestaurantsNav } from './components/RestaurantsNav';
import { DocumentReviewDialog, ExpiryLabel, openFile } from './fiche/DossierTab';
import { ONBOARDING_META, isInValidationQueue, runDocumentExpiryNow, useScopedRestaurants } from './lib';

type Doc = WithId<PartnerDocument>;

function isoIn(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function ValidationPage() {
  useDocumentTitle('Validation des commerces · Ciyou Eats Admin');
  const navigate = useNavigate();
  const can = useCan();
  const scope = useGeoScope();
  const restaurants = useScopedRestaurants();
  const [queueFilter, setQueueFilter] = useState<'all' | 'pending' | 'documents_missing'>('all');
  const [review, setReview] = useState<{ doc: Doc; decision: 'approve' | 'reject' } | null>(null);
  const check = useMutation(runDocumentExpiryNow);
  const allowed = can('restaurants.validate');

  const pendingDocs = useCollection<PartnerDocument>(
    useMemo(
      () =>
        allowed
          ? query(collectionAt(COLLECTIONS.partnerDocuments), where('ownerType', '==', 'restaurant'), where('status', '==', 'pending'), orderBy('createdAt', 'desc'), limit(200))
          : null,
      [allowed],
    ),
  );
  const expiringDocs = useCollection<PartnerDocument>(
    useMemo(
      () =>
        allowed
          ? query(
              collectionAt(COLLECTIONS.partnerDocuments),
              where('ownerType', '==', 'restaurant'),
              where('status', '==', 'approved'),
              where('expiresAt', '<=', isoIn(30)),
              orderBy('expiresAt', 'asc'),
              limit(200),
            )
          : null,
      [allowed],
    ),
  );
  const expiredDocs = useCollection<PartnerDocument>(
    useMemo(
      () =>
        allowed
          ? query(collectionAt(COLLECTIONS.partnerDocuments), where('ownerType', '==', 'restaurant'), where('status', '==', 'expired'), orderBy('createdAt', 'desc'), limit(100))
          : null,
      [allowed],
    ),
  );

  const byId = useMemo(() => new Map(restaurants.data.map((r) => [r.id, r])), [restaurants.data]);
  const cityName = useMemo(() => new Map(scope.cities.map((c) => [c.id, c.name])), [scope.cities]);
  const inScope = (doc: PartnerDocument) => byId.has(doc.ownerId);
  const queue = useMemo(
    () =>
      restaurants.data
        .filter(isInValidationQueue)
        .filter((r) => queueFilter === 'all' || r.onboardingStatus === queueFilter)
        .sort((a, b) => (toDate(a.createdAt)?.getTime() ?? 0) - (toDate(b.createdAt)?.getTime() ?? 0)),
    [restaurants.data, queueFilter],
  );
  const toCheck = pendingDocs.data.filter(inScope);
  const expiring = [...expiredDocs.data.filter(inScope), ...expiringDocs.data.filter(inScope)];
  const counts = {
    pending: restaurants.data.filter((r) => r.onboardingStatus === 'pending').length,
    missing: restaurants.data.filter((r) => r.onboardingStatus === 'documents_missing').length,
  };
  const docsByRestaurant = useMemo(() => {
    const map = new Map<string, number>();
    toCheck.forEach((d) => map.set(d.ownerId, (map.get(d.ownerId) ?? 0) + 1));
    return map;
  }, [toCheck]);

  if (!allowed) {
    return (
      <PageContainer wide>
        <PageHeader eyebrow="Acteurs" title="Validation des commerces">
          <RestaurantsNav />
        </PageHeader>
        <Card>
          <EmptyState icon={<ShieldCheck />} title="Accès réservé" description="La validation des dossiers demande le droit « Valider les commerces »." />
        </Card>
      </PageContainer>
    );
  }

  return (
    <PageContainer wide>
      <PageHeader
        eyebrow="Acteurs"
        title="Validation des commerces"
        description="Dossiers d’inscription, pièces justificatives et documents arrivant à expiration. Relances à J-30 et J-7, blocage automatique à l’expiration."
        actions={
          <Button
            variant="secondary"
            leftIcon={<RefreshCw />}
            loading={check.loading}
            onClick={() =>
              void check.mutate({}).then((r) => {
                if (r) toast.success('Contrôle des expirations terminé', { description: `${r.reminded} relance(s), ${r.expired} expiré(s), ${r.blocked} commerce(s) bloqué(s).` });
              })
            }
          >
            Contrôler les expirations
          </Button>
        }
      >
        <RestaurantsNav validationCount={counts.pending + counts.missing} />
      </PageHeader>

      {restaurants.error ? (
        <ErrorPanel error={restaurants.error} />
      ) : (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
            <StatCard label="En attente" value={formatNumber(counts.pending)} icon={<Hourglass />} tone="info" loading={restaurants.loading} footer="Dossiers complets à examiner" onClick={() => setQueueFilter('pending')} />
            <StatCard label="Documents manquants" value={formatNumber(counts.missing)} icon={<FileWarning />} tone="amber" loading={restaurants.loading} footer="En attente du restaurant" onClick={() => setQueueFilter('documents_missing')} />
            <StatCard label="Pièces à vérifier" value={formatNumber(toCheck.length)} icon={<FileSearch />} tone="brand" loading={pendingDocs.loading} footer="Déposées, non contrôlées" />
            <StatCard
              label="Expirations sous 30 j"
              value={formatNumber(expiring.length)}
              icon={<CalendarClock />}
              tone={expiredDocs.data.filter(inScope).length ? 'danger' : 'amber'}
              loading={expiringDocs.loading}
              footer={`${plural(expiredDocs.data.filter(inScope).length, 'document expiré', 'documents expirés')}`}
            />
          </div>

          <AutoValidationSettingsCard />

          <Panel
            title="Dossiers à traiter"
            icon={<ClipboardCheck />}
            description="Du plus ancien au plus récent."
            actions={
              <SegmentedControl
                size="sm"
                aria-label="Statut du dossier"
                value={queueFilter}
                onValueChange={(v) => setQueueFilter(v as typeof queueFilter)}
                options={[
                  { value: 'all', label: 'Tous', count: counts.pending + counts.missing },
                  { value: 'pending', label: 'En attente', count: counts.pending },
                  { value: 'documents_missing', label: 'Documents manquants', count: counts.missing },
                ]}
              />
            }
          >
            {restaurants.loading ? (
              <Skeleton className="h-32 w-full" />
            ) : queue.length === 0 ? (
              <EmptyState compact icon={<ClipboardCheck />} title="Aucun dossier en attente" description="Les nouvelles inscriptions arrivent ici automatiquement." />
            ) : (
              <ul className="divide-y divide-border rounded-xl border border-border">
                {queue.map((r) => {
                  const created = toDate(r.createdAt);
                  const docs = docsByRestaurant.get(r.id) ?? 0;
                  return (
                    <li key={r.id}>
                      <button
                        type="button"
                        onClick={() => navigate(`/restaurants/${r.id}?onglet=dossier`)}
                        className="flex w-full flex-col gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-2 sm:flex-row sm:items-center"
                      >
                        <div className="min-w-0 flex-1">
                          <RestaurantIdentity restaurant={r} cityName={cityName.get(r.cityId)} />
                        </div>
                        <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                          <StatusBadge status={r.onboardingStatus} map={ONBOARDING_META} />
                          {docs > 0 && <span className="text-xs text-fg-muted">{plural(docs, 'pièce à vérifier', 'pièces à vérifier')}</span>}
                          <span className="text-xs text-fg-subtle">Inscrit {created ? formatRelative(created) : ''}</span>
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </Panel>

          <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
            <Panel title="Pièces à vérifier" icon={<FileSearch />} description="Contrôle unitaire : ouvrir, valider avec la date d’expiration, ou refuser avec un motif.">
              {pendingDocs.loading ? (
                <Skeleton className="h-32 w-full" />
              ) : toCheck.length === 0 ? (
                <EmptyState compact icon={<FileSearch />} title="Rien à vérifier" description="Toutes les pièces déposées ont été contrôlées." />
              ) : (
                <ul className="divide-y divide-border rounded-xl border border-border">
                  {toCheck.map((doc) => {
                    const r = byId.get(doc.ownerId);
                    const at = toDate(doc.createdAt);
                    return (
                      <li key={doc.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-fg">{PARTNER_DOCUMENT_LABELS[doc.type]}</p>
                          <p className="truncate text-xs text-fg-subtle">
                            <Link to={`/restaurants/${doc.ownerId}?onglet=dossier`} className="hover:text-fg hover:underline">
                              {r?.name ?? doc.ownerId}
                            </Link>
                            {at ? ` · déposé ${formatRelative(at)}` : ''}
                          </p>
                        </div>
                        <div className="flex shrink-0 gap-1.5">
                          <Button size="xs" variant="ghost" leftIcon={<ExternalLink />} onClick={() => void openFile(doc.file.path)}>
                            Ouvrir
                          </Button>
                          <Button size="xs" variant="ghost" onClick={() => setReview({ doc, decision: 'reject' })}>
                            Refuser
                          </Button>
                          <Button size="xs" variant="secondary" onClick={() => setReview({ doc, decision: 'approve' })}>
                            Valider
                          </Button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Panel>

            <Panel title="Expirations" icon={<CalendarClock />} description="Documents expirés ou expirant dans les 30 jours.">
              {expiringDocs.loading ? (
                <Skeleton className="h-32 w-full" />
              ) : expiring.length === 0 ? (
                <EmptyState compact icon={<CalendarClock />} title="Aucune expiration proche" description="Tous les documents validés sont à jour." />
              ) : (
                <ul className="divide-y divide-border rounded-xl border border-border">
                  {expiring.map((doc) => (
                    <li key={doc.id} className="flex items-center justify-between gap-3 px-4 py-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-fg">
                          <Link to={`/restaurants/${doc.ownerId}?onglet=dossier`} className="hover:underline">
                            {byId.get(doc.ownerId)?.name ?? doc.ownerId}
                          </Link>
                        </p>
                        <p className="truncate text-xs text-fg-subtle">{PARTNER_DOCUMENT_LABELS[doc.type]}</p>
                      </div>
                      <div className="shrink-0 text-right">
                        {doc.status === 'expired' ? <span className="text-xs font-medium text-danger">Expiré</span> : <ExpiryLabel day={doc.expiresAt} />}
                        <p className="text-2xs text-fg-subtle">{doc.remindersSent ? `${doc.remindersSent} relance${doc.remindersSent > 1 ? 's' : ''}` : 'Pas encore relancé'}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </div>
        </div>
      )}
      {review && <DocumentReviewDialog key={`${review.doc.id}-${review.decision}`} doc={review.doc} decision={review.decision} onClose={() => setReview(null)} />}
    </PageContainer>
  );
}
