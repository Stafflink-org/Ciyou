import { useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, Gauge, Info, Minus, Scale, Sparkles } from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  FormField,
  Input,
  PageContainer,
  PageHeader,
  Skeleton,
  Slider,
  cn,
  formatPercent,
} from '@golink/ui';
import {
  SETTINGS_DOCS,
  baseRankingScore,
  finalRankingScore,
  haversineMeters,
  paths,
  type DisplaySettings,
  type Restaurant,
  type UpdateExperienceSettingsInput,
  type WithId,
} from '@golink/shared';
import { useDocumentTitle } from '@golink/web';
import { callFunction, docAt, useDoc, useMutation } from '@/lib/firestore';
import { callFunctionWithReason } from '@/lib/reason';
import { millis } from '../_experience/format';
import { LoadError, Panel } from '../_experience/ui';
import { AffichageNav, useCityRestaurants, useWorkingCity } from './shared';

type Weights = DisplaySettings['ranking'];
type WeightKey = Exclude<keyof Weights, 'newRestaurantBoostDays'>;

const CRITERIA: Array<{ key: WeightKey; label: string; description: string }> = [
  { key: 'distanceWeight', label: 'Distance', description: 'Proximité entre le client et le commerce.' },
  { key: 'ratingWeight', label: 'Note', description: 'Moyenne des avis publiés.' },
  { key: 'popularityWeight', label: 'Popularité', description: 'Volume de commandes.' },
  { key: 'planWeight', label: 'Formule d’abonnement', description: 'Basic, Pro, Premium.' },
  { key: 'sponsoredWeight', label: 'Mise en avant payante', description: 'Emplacement acheté en cours.' },
];

const updateSettings = callFunctionWithReason<UpdateExperienceSettingsInput, { changed: string[] }>('updateExperienceSettings', { title: 'Enregistrer les réglages de classement' });
const refreshRanking = callFunction<Record<string, never>, { restaurants: number; updated: number; sponsored: number }>('refreshRankingScores');

/** Aperçu : même calcul que le serveur (score de base) puis proximité du client, via le socle partagé. */
function score(list: WithId<Restaurant>[], weights: Weights, center: { lat: number; lng: number } | null) {
  const maxOrders = Math.max(1, ...list.map((r) => r.ordersCount ?? 0));
  const dist = (r: Restaurant) => (center && r.address?.geo ? haversineMeters(center, { lat: r.address.geo.latitude, lng: r.address.geo.longitude }) : 3000);
  const maxDist = Math.max(1000, ...list.map(dist));
  const now = Date.now();
  const boostUntil = now - weights.newRestaurantBoostDays * 86_400_000;
  return list
    .map((r) => {
      const launchedMs = millis(r.launchedAt ?? r.createdAt);
      const base = baseRankingScore(
        { ratingAverage: r.rating?.average ?? 0, ratingCount: r.rating?.count ?? 0, ordersCount: r.ordersCount ?? 0, planCode: r.planCode, sponsored: r.sponsored === true, launchedAtMs: launchedMs },
        { maxOrders, nowMs: now },
        weights,
      );
      const total = finalRankingScore(base, 1 - dist(r) / maxDist, weights);
      return { restaurant: r, total, isNew: launchedMs > boostUntil };
    })
    .sort((a, b) => b.total - a.total);
}

export function RankingPage() {
  useDocumentTitle('Classement · Affichage · Ciyou Eats Admin');
  const settings = useDoc<DisplaySettings>(docAt(paths.settings(SETTINGS_DOCS.display)));
  const { cityId, city, selector } = useWorkingCity();
  const restaurants = useCityRestaurants(cityId);
  const [weights, setWeights] = useState<Weights | null>(null);
  const [label, setLabel] = useState('Sponsorisé');
  const [confirm, setConfirm] = useState(false);
  const recompute = useMutation(refreshRanking, { success: (r) => `Classement recalculé : ${r.updated} commerce(s) mis à jour sur ${r.restaurants}` });
  const { mutate, loading } = useMutation(updateSettings, { success: (r) => (r.changed.length ? 'Règles de classement enregistrées' : 'Aucun changement') });

  useEffect(() => {
    if (!settings.data) return;
    setWeights({ ...settings.data.ranking });
    setLabel(settings.data.sponsoredLabel);
  }, [settings.data]);

  const sum = weights ? CRITERIA.reduce((s, c) => s + weights[c.key], 0) : 0;
  const balanced = Math.abs(sum - 1) < 0.001;
  const dirty = Boolean(settings.data && weights && (JSON.stringify(settings.data.ranking) !== JSON.stringify(weights) || settings.data.sponsoredLabel !== label));
  const center = city?.center ?? null;
  const current = useMemo(() => (settings.data ? score(restaurants.data, settings.data.ranking, center) : []), [restaurants.data, settings.data, center]);
  const next = useMemo(() => (weights ? score(restaurants.data, weights, center) : []), [restaurants.data, weights, center]);
  const previousRank = new Map(current.map((row, i) => [row.restaurant.id, i]));

  function normalize() {
    if (!weights || sum === 0) return;
    const out = { ...weights };
    CRITERIA.forEach((c) => (out[c.key] = Math.round((weights[c.key] / sum) * 100) / 100));
    const diff = Math.round((1 - CRITERIA.reduce((s, c) => s + out[c.key], 0)) * 100) / 100;
    out.ratingWeight = Math.round((out.ratingWeight + diff) * 100) / 100;
    setWeights(out);
  }

  return (
    <PageContainer wide>
      <PageHeader
        eyebrow="Opérations"
        title="Affichage app client"
        description="Critères qui décident de l’ordre des commerces dans l’app client. Toute mise en avant payante est signalée au client."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {selector}
            <Button
              variant="secondary"
              loading={recompute.loading}
              onClick={() => void recompute.mutate({})}
            >
              Recalculer maintenant
            </Button>
          </div>
        }
      />
      <AffichageNav />
      {settings.error ? <Card><LoadError error={settings.error} /></Card> : !weights ? <Skeleton className="h-96" /> : (
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
          <div className="min-w-0 space-y-6">
            <Panel
              title="Pondération des critères"
              description="La somme doit faire 100 %."
              actions={
                <div className="flex items-center gap-2">
                  <span className={cn('rounded-full px-2 py-0.5 font-mono text-xs num', balanced ? 'tone-success bg-(--tone-bg) text-(--tone-fg)' : 'tone-danger bg-(--tone-bg) text-(--tone-fg)')}>{formatPercent(sum)}</span>
                  {!balanced && <Button size="sm" leftIcon={<Scale />} onClick={normalize}>Répartir à 100 %</Button>}
                </div>
              }
            >
              <div className="space-y-5">
                {CRITERIA.map((c) => (
                  <div key={c.key} className="grid items-center gap-2 sm:grid-cols-[200px_minmax(0,1fr)_64px] sm:gap-4">
                    <div>
                      <div className="text-sm font-medium text-fg">{c.label}</div>
                      <div className="text-xs text-fg-muted">{c.description}</div>
                    </div>
                    <Slider value={[Math.round(weights[c.key] * 100)]} min={0} max={100} step={5} onValueChange={([v]) => setWeights({ ...weights, [c.key]: (v ?? 0) / 100 })} formatValue={(v) => `${v} %`} aria-label={c.label} />
                    <span className="text-right font-mono text-sm num">{Math.round(weights[c.key] * 100)} %</span>
                  </div>
                ))}
              </div>
            </Panel>

            <Panel title="Nouveaux commerces et mention légale">
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField label="Coup de pouce des nouveaux commerces" hint="Bonus de visibilité pendant leurs premiers jours.">
                  <Input inputMode="numeric" value={String(weights.newRestaurantBoostDays)} onChange={(e) => setWeights({ ...weights, newRestaurantBoostDays: Math.min(365, Number(e.target.value.replace(/\D/g, '')) || 0) })} trailing="jours" />
                </FormField>
                <FormField label="Mention des résultats sponsorisés" hint="Affichée sur chaque commerce ou bannière payée." error={label.trim().length < 3 ? 'Mention obligatoire.' : undefined}>
                  <Input value={label} onChange={(e) => setLabel(e.target.value)} maxLength={30} />
                </FormField>
              </div>
              <p className="tone-info mt-4 flex items-start gap-2 rounded-lg bg-(--tone-bg) px-3 py-2 text-xs text-(--tone-fg)">
                <Info className="mt-px size-3.5 shrink-0" />
                Obligation légale (Code de la consommation, règlement européen P2B) : informer le client de toute contrepartie financière influençant le classement. La mention ne peut pas être désactivée.
              </p>
            </Panel>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" disabled={!dirty} onClick={() => { setWeights({ ...settings.data!.ranking }); setLabel(settings.data!.sponsoredLabel); }}>Annuler les modifications</Button>
              <Button variant="primary" disabled={!dirty || !balanced || label.trim().length < 3} loading={loading} onClick={() => setConfirm(true)}>Enregistrer</Button>
            </div>
          </div>

          <Panel title="Aperçu du classement" description={`${city?.name ?? ''} · client au centre-ville`} bodyClassName="p-0">
            {restaurants.loading ? <div className="p-5"><Skeleton className="h-72" /></div> : next.length === 0 ? (
              <EmptyState compact icon={<Gauge />} title="Aucun commerce en ligne" description="Choisissez une autre ville." />
            ) : (
              <ol className="divide-y divide-border">
                {next.map((row, i) => {
                  const before = previousRank.get(row.restaurant.id) ?? i;
                  const moved = before - i;
                  return (
                    <li key={row.restaurant.id} className="flex items-center gap-3 px-5 py-2.5">
                      <span className="w-5 text-right font-mono text-xs text-fg-subtle num">{i + 1}</span>
                      <span className={cn('flex w-8 items-center text-2xs font-mono num', moved > 0 ? 'tone-success text-(--tone-fg)' : moved < 0 ? 'tone-danger text-(--tone-fg)' : 'text-fg-subtle')}>
                        {dirty ? (moved > 0 ? <><ArrowUp className="size-3" />{moved}</> : moved < 0 ? <><ArrowDown className="size-3" />{-moved}</> : <Minus className="size-3" />) : null}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-sm font-medium text-fg">{row.restaurant.name}</span>
                          {row.restaurant.sponsored && <Badge size="sm" tone="brand">{label || 'Sponsorisé'}</Badge>}
                          {row.isNew && <Badge size="sm" tone="info" icon={<Sparkles />}>Nouveau</Badge>}
                        </div>
                        <div className="mt-1 h-1 overflow-hidden rounded-full bg-surface-3">
                          <div className="h-full rounded-full bg-primary" style={{ width: `${Math.min(100, (row.total / (next[0]?.total || 1)) * 100)}%` }} />
                        </div>
                      </div>
                      <span className="font-mono text-xs text-fg-muted num">{row.total.toFixed(2).replace('.', ',')}</span>
                    </li>
                  );
                })}
              </ol>
            )}
          </Panel>
        </div>
      )}
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title="Appliquer les nouvelles règles de classement ?"
        description="L’ordre des commerces change immédiatement dans l’app client, dans toutes les villes."
        confirmLabel="Appliquer"
        requireReason
        onConfirm={async (reason) => {
          if (weights) await mutate({ doc: 'display', values: { ranking: weights, sponsoredLabel: label.trim(), ...(settings.data?.qualityWatch ? { qualityWatch: settings.data.qualityWatch } : {}) }, reason: reason ?? null });
        }}
      />
    </PageContainer>
  );
}
