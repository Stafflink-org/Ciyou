import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { collection, doc, limit, query, serverTimestamp, updateDoc } from 'firebase/firestore';
import { ArrowDownRight, ArrowUpRight, Bike, CheckCheck, RefreshCw, Settings2, Store, TrendingDown } from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  DataTable,
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
  Sparkline,
  createColumnHelper,
  formatRelative,
  toast,
} from '@golink/ui';
import {
  COLLECTIONS,
  DEFAULT_RATING_WATCH,
  SETTINGS_DOCS,
  paths,
  type DisplaySettings,
  type RatingWatch,
  type RatingWatchThresholds,
  type UpdateExperienceSettingsInput,
  type WithId,
} from '@golink/shared';
import { useDocumentTitle } from '@golink/web';
import { useAdminAccess } from '@/auth/AdminAccess';
import { db } from '@/lib/firebase';
import { callFunction, docAt, errorMessage, useCollection, useDoc, useMutation } from '@/lib/firestore';
import { callFunctionWithReason } from '@/lib/reason';
import { millis } from '../_experience/format';
import { useScopeFilter } from '../_experience/scope';
import { Kpi, LoadError } from '../_experience/ui';
import { AvisNav } from './components';

const runNow = callFunction<Record<string, never>, { watched: number; alerts: number }>('runRatingWatchNow');
const updateSettings = callFunctionWithReason<UpdateExperienceSettingsInput, { changed: string[] }>('updateExperienceSettings', { title: 'Enregistrer les seuils du suivi qualité' });
const col = createColumnHelper<WithId<RatingWatch>>();
const fmt = (n: number | null | undefined) => (n === null || n === undefined ? '—' : n.toFixed(2).replace('.', ','));

export function QualityPage() {
  useDocumentTitle('Suivi qualité · Avis · Ciyou Eats Admin');
  const { admin, can } = useAdminAccess();
  const scope = useScopeFilter();
  const [entity, setEntity] = useState<'restaurant' | 'driver'>('restaurant');
  const [level, setLevel] = useState<'problems' | 'all'>('problems');
  const [ack, setAck] = useState<WithId<RatingWatch> | null>(null);
  const [editing, setEditing] = useState(false);
  const q = useMemo(() => query(collection(db, COLLECTIONS.ratingWatch), limit(2000)), []);
  const { data, loading, error } = useCollection<RatingWatch>(q);
  const display = useDoc<DisplaySettings>(docAt(paths.settings(SETTINGS_DOCS.display)));
  const thresholds = { ...DEFAULT_RATING_WATCH, ...(display.data?.qualityWatch ?? {}) };
  const recompute = useMutation(runNow, { success: (r) => `Suivi recalculé : ${r.alerts} alerte${r.alerts > 1 ? 's' : ''}, ${r.watched} sous surveillance` });

  const scoped = data.filter((w) => scope.covers(w));
  const rows = scoped
    .filter((w) => w.entityType === entity && (level === 'all' || w.level !== 'ok'))
    .sort((a, b) => ({ alert: 0, watch: 1, ok: 2 })[a.level] - ({ alert: 0, watch: 1, ok: 2 })[b.level] || (a.delta ?? 0) - (b.delta ?? 0));
  const computedAt = Math.max(0, ...data.map((w) => millis(w.computedAt)));

  const columns = useMemo(
    () => [
      col.accessor('name', {
        header: entity === 'restaurant' ? 'Restaurant' : 'Livreur',
        cell: ({ row }) => (
          <Link to={`/${entity === 'restaurant' ? 'restaurants' : 'livreurs'}/${row.original.entityId}`} className="font-medium text-fg hover:underline" onClick={(e) => e.stopPropagation()}>
            {row.original.name}
          </Link>
        ),
      }),
      col.accessor((w) => (w.cityId ? (scope.cityNames.get(w.cityId) ?? w.cityId) : '—'), { id: 'city', header: 'Ville', cell: (i) => <span className="text-sm text-fg-muted">{i.getValue()}</span> }),
      col.accessor('currentAverage', { header: '30 derniers jours', meta: { align: 'right' }, cell: ({ row }) => <span className="font-mono num">{fmt(row.original.currentAverage)} <span className="text-fg-subtle">({row.original.currentCount})</span></span> }),
      col.accessor('previousAverage', { header: '30 jours précédents', meta: { align: 'right' }, cell: ({ row }) => <span className="font-mono text-fg-muted num">{fmt(row.original.previousAverage)} <span className="text-fg-subtle">({row.original.previousCount})</span></span> }),
      col.accessor('delta', {
        header: 'Évolution',
        meta: { align: 'right' },
        cell: (i) => {
          const d = i.getValue();
          if (d === null || d === undefined) return <span className="text-fg-subtle">—</span>;
          const Icon = d < 0 ? ArrowDownRight : ArrowUpRight;
          return <span className={`tone-${d < 0 ? 'danger' : 'success'} inline-flex items-center gap-0.5 font-mono text-(--tone-fg) num`}><Icon className="size-3.5" />{d > 0 ? '+' : ''}{fmt(d)}</span>;
        },
      }),
      col.accessor('weekly', {
        header: '8 semaines',
        enableSorting: false,
        cell: (i) => {
          const points = i.getValue().map((v) => v ?? 0);
          return points.some((p) => p > 0) ? <div className="h-8 w-28"><Sparkline data={points} variant="line" /></div> : <span className="text-fg-subtle">—</span>;
        },
      }),
      col.accessor('lowRatings', { header: '1-2 ★', meta: { align: 'right' }, cell: (i) => <span className="font-mono num">{i.getValue()}</span> }),
      col.accessor('level', {
        header: 'Niveau',
        cell: ({ row }) => {
          const w = row.original;
          return (
            <div className="flex flex-col items-start gap-1">
              <Badge tone={w.level === 'alert' ? 'danger' : w.level === 'watch' ? 'amber' : 'success'} size="sm">{w.level === 'alert' ? 'Alerte' : w.level === 'watch' ? 'Surveillance' : 'Normal'}</Badge>
              {w.acknowledgedAt && <span className="text-2xs text-fg-subtle">Pris en compte {formatRelative(millis(w.acknowledgedAt))}</span>}
            </div>
          );
        },
      }),
    ],
    [entity, scope.cityNames],
  );

  const alerts = scoped.filter((w) => w.level === 'alert');
  const watch = scoped.filter((w) => w.level === 'watch');

  return (
    <PageContainer wide>
      <PageHeader
        eyebrow="Opérations"
        title="Avis et notes"
        description="Restaurants et livreurs dont la note baisse : moyenne des 30 derniers jours comparée aux 30 jours précédents."
        actions={
          <div className="flex flex-wrap gap-2">
            {can('display.edit') && <Button leftIcon={<Settings2 />} onClick={() => setEditing(true)}>Seuils</Button>}
            {can('reviews.moderate') && <Button leftIcon={<RefreshCw />} loading={recompute.loading} onClick={() => void recompute.mutate({})}>Recalculer</Button>}
          </div>
        }
      />
      <AvisNav />
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="En alerte" value={loading ? '…' : alerts.length} icon={<TrendingDown />} tone={alerts.length ? 'danger' : 'success'} hint={`Baisse ≥ ${fmt(thresholds.alertDrop)} pt ou moyenne < ${fmt(thresholds.alertBelow)}`} />
        <Kpi label="Sous surveillance" value={loading ? '…' : watch.length} icon={<TrendingDown />} tone={watch.length ? 'amber' : 'neutral'} hint={`Baisse ≥ ${fmt(thresholds.watchDrop)} pt`} />
        <Kpi label="Restaurants concernés" value={loading ? '…' : scoped.filter((w) => w.level !== 'ok' && w.entityType === 'restaurant').length} icon={<Store />} />
        <Kpi label="Livreurs concernés" value={loading ? '…' : scoped.filter((w) => w.level !== 'ok' && w.entityType === 'driver').length} icon={<Bike />} hint={computedAt ? `Calcul ${formatRelative(computedAt)}` : 'Calcul quotidien à 6 h 15'} />
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <SegmentedControl value={entity} onValueChange={(v) => setEntity(v as 'restaurant' | 'driver')} options={[{ value: 'restaurant', label: 'Restaurants', icon: <Store /> }, { value: 'driver', label: 'Livreurs', icon: <Bike /> }]} aria-label="Type" />
        <SegmentedControl value={level} onValueChange={(v) => setLevel(v as 'problems' | 'all')} options={[{ value: 'problems', label: 'À surveiller' }, { value: 'all', label: 'Tous' }]} aria-label="Niveau" />
      </div>

      {error ? <Card><LoadError error={error} /></Card> : (
        <DataTable
          data={rows}
          columns={columns}
          loading={loading}
          getRowId={(w) => w.id}
          onRowClick={can('reviews.moderate') ? (w) => setAck(w) : undefined}
          itemLabel={entity === 'restaurant' ? 'restaurants' : 'livreurs'}
          searchPlaceholder="Rechercher…"
          emptyState={
            <EmptyState
              compact
              icon={<CheckCheck />}
              title={data.length === 0 ? 'Aucun calcul pour le moment' : 'Aucune note en baisse'}
              description={data.length === 0 ? 'Le suivi est calculé chaque matin ; lancez un calcul immédiat avec « Recalculer ».' : `Au moins ${thresholds.minReviews} avis sur 30 jours sont nécessaires pour évaluer une tendance.`}
            />
          }
        />
      )}

      <ConfirmDialog
        open={ack !== null}
        onOpenChange={(o) => !o && setAck(null)}
        title={ack?.acknowledgedAt ? `Retirer la prise en compte : ${ack.name}` : `Prendre en compte : ${ack?.name ?? ''}`}
        description={ack?.acknowledgedAt ? 'La baisse de note repassera dans la liste des points à traiter.' : 'Indiquez l’action engagée (appel au restaurant, rappel au livreur…). La prise en compte tombe si la situation s’aggrave.'}
        confirmLabel={ack?.acknowledgedAt ? 'Retirer' : 'Enregistrer'}
        requireReason={!ack?.acknowledgedAt}
        reasonLabel="Action engagée"
        onConfirm={async (reason) => {
          if (!ack) return;
          try {
            await updateDoc(doc(db, COLLECTIONS.ratingWatch, ack.id), ack.acknowledgedAt
              ? { acknowledgedAt: null, acknowledgedBy: null, note: null }
              : { acknowledgedAt: serverTimestamp(), acknowledgedBy: admin.uid, note: reason ?? null });
            toast.success('Suivi mis à jour');
          } catch (e) {
            toast.error(errorMessage(e));
          }
        }}
      >
        {ack?.note && <p className="text-sm text-fg-muted">Note actuelle : {ack.note}</p>}
      </ConfirmDialog>

      <ThresholdsDialog open={editing} onOpenChange={setEditing} current={thresholds} display={display.data} />
    </PageContainer>
  );
}

function ThresholdsDialog({ open, onOpenChange, current, display }: { open: boolean; onOpenChange: (o: boolean) => void; current: RatingWatchThresholds; display: DisplaySettings | null }) {
  const [draft, setDraft] = useState(() => ({ minReviews: String(current.minReviews), watchDrop: String(current.watchDrop), alertDrop: String(current.alertDrop), alertBelow: String(current.alertBelow) }));
  const { mutate, loading } = useMutation(updateSettings, { success: 'Seuils enregistrés' });
  const parse = (v: string) => Number(v.replace(',', '.'));
  async function save() {
    if (!display) return;
    const values = {
      ranking: display.ranking,
      sponsoredLabel: display.sponsoredLabel,
      qualityWatch: { minReviews: parse(draft.minReviews), watchDrop: parse(draft.watchDrop), alertDrop: parse(draft.alertDrop), alertBelow: parse(draft.alertBelow) },
    };
    if (await mutate({ doc: 'display', values })) onOpenChange(false);
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader icon={<Settings2 />} title="Seuils du suivi qualité" description="Appliqués au prochain calcul (quotidien, ou « Recalculer »)." />
        <DialogBody className="grid gap-4 sm:grid-cols-2">
          <FormField label="Avis minimum sur 30 jours"><Input inputMode="numeric" value={draft.minReviews} onChange={(e) => setDraft({ ...draft, minReviews: e.target.value })} /></FormField>
          <FormField label="Alerte sous la moyenne de"><Input inputMode="decimal" value={draft.alertBelow} onChange={(e) => setDraft({ ...draft, alertBelow: e.target.value })} trailing="/ 5" /></FormField>
          <FormField label="Surveillance dès une baisse de"><Input inputMode="decimal" value={draft.watchDrop} onChange={(e) => setDraft({ ...draft, watchDrop: e.target.value })} trailing="pt" /></FormField>
          <FormField label="Alerte dès une baisse de"><Input inputMode="decimal" value={draft.alertDrop} onChange={(e) => setDraft({ ...draft, alertDrop: e.target.value })} trailing="pt" /></FormField>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Annuler</Button>
          <Button variant="primary" loading={loading} disabled={!display} onClick={() => void save()}>Enregistrer</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
