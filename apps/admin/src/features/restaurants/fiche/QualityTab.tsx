// Fiche restaurant, onglet « Qualité » : score global et détail des pénalités,
// indicateurs 30 jours, allergènes, anomalies de carte à corriger.
import { useMemo, useState } from 'react';
import { limit, orderBy, query, where } from 'firebase/firestore';
import { CheckCircle2, RefreshCw, ShieldAlert, ShieldCheck, Sparkles } from 'lucide-react';
import { Button, EmptyState, ProgressBar, SegmentedControl, Skeleton, formatRelative } from '@golink/ui';
import { COLLECTIONS, QUALITY_PENALTY_CAPS, QUALITY_THRESHOLDS, type MenuIssue, type Restaurant, type WithId } from '@golink/shared';
import { collectionAt, errorMessage, toDate, useCollection, useMutation } from '@/lib/firestore';
import { Facts, Panel, ScoreRing, bpsLabel } from '../../acteurs-commun/ui';
import { MenuIssueList } from '../components/MenuIssues';
import { refreshRestaurantScores } from '../lib';

const CRITERIA = [
  { key: 'cancellations', label: 'Annulations' },
  { key: 'rejections', label: 'Refus de commandes' },
  { key: 'lateness', label: 'Retards' },
  { key: 'rating', label: 'Avis clients' },
  { key: 'menu', label: 'Anomalies de carte' },
] as const;

export function QualityTab({ restaurant }: { restaurant: WithId<Restaurant> }) {
  const [show, setShow] = useState<'open' | 'all'>('open');
  const refresh = useMutation(refreshRestaurantScores, { success: (r) => `Score recalculé : ${r.score ?? '—'}/100` });
  const issues = useCollection<MenuIssue>(
    useMemo(() => query(collectionAt(COLLECTIONS.menuIssues), where('restaurantId', '==', restaurant.id), orderBy('detectedAt', 'desc'), limit(200)), [restaurant.id]),
  );
  const visible = show === 'open' ? issues.data.filter((i) => i.status === 'open') : issues.data;
  const score = restaurant.qualityScore ?? 0;
  const m = restaurant.metrics30d;
  const computed = toDate(m?.computedAt);
  const verdict = score >= QUALITY_THRESHOLDS.watch ? 'Bon niveau' : score >= QUALITY_THRESHOLDS.coach ? 'À surveiller' : 'À accompagner';

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
        <Panel
          title="Score de qualité"
          icon={<Sparkles />}
          description={computed ? `Calculé ${formatRelative(computed)} sur les 30 derniers jours` : 'Recalculé chaque nuit'}
          actions={
            <Button size="sm" variant="ghost" leftIcon={<RefreshCw />} loading={refresh.loading} onClick={() => void refresh.mutate({ restaurantId: restaurant.id })}>
              Recalculer
            </Button>
          }
        >
          <div className="flex items-center gap-5">
            <ScoreRing value={score} size={88} />
            <div>
              <p className="font-display text-xl font-semibold text-fg">{verdict}</p>
              <p className="mt-1 text-sm text-fg-muted">
                Seuils : moins de {QUALITY_THRESHOLDS.watch} à surveiller, moins de {QUALITY_THRESHOLDS.coach} à accompagner ou suspendre.
              </p>
            </div>
          </div>
          <div className="mt-5 space-y-3">
            {CRITERIA.map((c) => {
              const penalty = restaurant.qualityBreakdown?.[c.key] ?? 0;
              const cap = QUALITY_PENALTY_CAPS[c.key];
              return (
                <ProgressBar
                  key={c.key}
                  label={c.label}
                  value={cap - penalty}
                  max={cap}
                  tone={penalty === 0 ? 'success' : penalty >= cap / 2 ? 'danger' : 'amber'}
                  valueLabel={penalty ? `−${penalty} pts` : 'Parfait'}
                  size="sm"
                />
              );
            })}
          </div>
        </Panel>

        <Panel title="Indicateurs sur 30 jours" icon={<ShieldCheck />}>
          {m ? (
            <Facts
              items={[
                { label: 'Commandes reçues', value: m.ordersCount.toLocaleString('fr-FR'), hint: `${m.deliveredCount.toLocaleString('fr-FR')} livrées` },
                { label: 'Taux d’annulation', value: bpsLabel(m.cancelRateBps), hint: `${m.cancelledCount} commandes annulées` },
                { label: 'Taux de refus', value: bpsLabel(m.rejectRateBps), hint: `${m.rejectedCount} commandes refusées` },
                { label: 'Taux de retard', value: bpsLabel(m.lateRateBps), hint: `${m.lateCount} livraisons en retard` },
                { label: 'Note moyenne', value: restaurant.rating?.count ? `${restaurant.rating.average.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} / 5` : 'Aucun avis', hint: `${restaurant.rating?.count ?? 0} avis` },
                {
                  label: 'Allergènes',
                  value: restaurant.allergensComplete ? (
                    <span className="inline-flex items-center gap-1.5 text-success">
                      <CheckCircle2 className="size-4" /> Complets
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 text-danger">
                      <ShieldAlert className="size-4" /> Incomplets
                    </span>
                  ),
                  hint: 'Obligation légale d’information du client',
                },
              ]}
            />
          ) : (
            <EmptyState compact icon={<ShieldCheck />} title="Pas encore calculé" description="Lancez un recalcul pour obtenir les indicateurs du commerce." />
          )}
        </Panel>
      </div>

      <Panel
        title="Contrôle qualité de la carte"
        icon={<ShieldAlert />}
        description="Anomalies détectées automatiquement à chaque modification de produit et chaque nuit."
        actions={
          <SegmentedControl
            size="sm"
            aria-label="Anomalies affichées"
            value={show}
            onValueChange={(v) => setShow(v as 'open' | 'all')}
            options={[
              { value: 'open', label: 'À traiter', count: issues.data.filter((i) => i.status === 'open').length },
              { value: 'all', label: 'Toutes', count: issues.data.length },
            ]}
          />
        }
      >
        {issues.error ? (
          <p className="text-sm text-danger">{errorMessage(issues.error)}</p>
        ) : issues.loading ? (
          <Skeleton className="h-40 w-full" />
        ) : visible.length === 0 ? (
          <EmptyState compact icon={<CheckCircle2 />} title="Carte sans anomalie" description="Photos, prix, descriptions et allergènes sont en ordre." />
        ) : (
          <MenuIssueList issues={visible} />
        )}
      </Panel>
    </div>
  );
}
