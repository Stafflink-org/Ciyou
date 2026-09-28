// Attribution des courses (cahier §6) : règles plateforme surchargées par ville et par
// zone (livreur le plus proche, délai pour accepter, élargissement si personne
// n'accepte), schéma des tours de recherche, indicateurs des propositions, historique.
import { useEffect, useMemo, useState } from 'react';
import { collection, limit, orderBy, query, where } from 'firebase/firestore';
import { CircleDot, Radar, RotateCcw, Save, Send, Timer, TriangleAlert, Undo2 } from 'lucide-react';
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  ConfirmDialog,
  EmptyState,
  FormField,
  RadioGroup,
  Select,
  StatCard,
  Switch,
  formatNumber,
} from '@golink/ui';
import {
  COLLECTIONS,
  DISPATCH_STRATEGY_LABELS,
  SETTINGS_DOCS,
  dispatchRadiusForRound,
  resolveDispatchRules,
  type DispatchOffer,
  type DispatchRules,
  type DispatchSettings,
} from '@golink/shared';
import { useAdminAccess } from '@/auth/AdminAccess';
import { useGeoScope } from '@/layout/GeoScope';
import { db } from '@/lib/firebase';
import { docAt, useCollection, useDoc, useMutation } from '@/lib/firestore';
import { fn } from '../_operations/functions';
import { useScopedZones, useSettingsHistory } from '../_operations/hooks';
import { KmInput, UnitInput } from '../_operations/inputs';
import { formatMeters, LoadError, OverrideBadge, pct, SettingsHistoryCard } from '../_operations/ui';
import { DriversShell } from './shell';

type Editable = Omit<DispatchRules, never>;

const LABELS: Record<string, string> = {
  engine: 'Moteur',
  mode: 'Mode',
  strategy: 'Stratégie',
  offerTimeoutSeconds: 'Délai pour accepter (s)',
  initialRadiusMeters: 'Rayon initial (m)',
  radiusStepMeters: 'Élargissement (m)',
  maxRadiusMeters: 'Rayon maximal (m)',
  maxRounds: 'Nombre de tours',
  dispatchLeadMinutes: 'Anticipation (min)',
  maxConcurrentOrdersPerDriver: 'Courses simultanées',
  shortageRatioAlert: 'Seuil d’alerte',
  minDriverRating: 'Note minimale',
  dispatch: 'Surcharge',
};

export function DispatchRulesPage() {
  const { can } = useAdminAccess();
  const geo = useGeoScope();
  const zones = useScopedZones();
  const platformDoc = useDoc<DispatchSettings>(docAt(`${COLLECTIONS.settings}/${SETTINGS_DOCS.dispatch}`));
  const scopes = useMemo(() => {
    const out: Array<{ value: string; label: string }> = [];
    if (geo.global && !geo.cityId && !geo.countryId) out.push({ value: 'platform', label: 'Plateforme (toutes les villes)' });
    for (const c of geo.cities.filter((c) => (!geo.countryId || c.countryId === geo.countryId) && (!geo.cityId || c.id === geo.cityId)).sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name, 'fr'))) {
      out.push({ value: `city:${c.id}`, label: `Ville · ${c.name}` });
      for (const z of zones.data.filter((z) => z.cityId === c.id).sort((a, b) => a.name.localeCompare(b.name, 'fr'))) out.push({ value: `zone:${z.id}`, label: `   Zone · ${z.name}` });
    }
    return out;
  }, [geo, zones.data]);
  const [scope, setScope] = useState('');
  useEffect(() => {
    if (!scopes.some((s) => s.value === scope)) setScope(scopes[0]?.value ?? '');
  }, [scopes, scope]);
  const [kind, id] = scope === 'platform' ? (['platform', null] as const) : (scope.split(':') as ['city' | 'zone', string]);
  const zone = kind === 'zone' ? zones.data.find((z) => z.id === id) : undefined;
  const city = kind === 'city' ? geo.cities.find((c) => c.id === id) : zone ? geo.cities.find((c) => c.id === zone.cityId) : undefined;

  const platform = platformDoc.data ?? null;
  const parent = useMemo(() => (kind === 'zone' ? resolveDispatchRules(platform, city?.dispatch) : resolveDispatchRules(platform)), [kind, platform, city?.dispatch]);
  const override = kind === 'platform' ? null : kind === 'city' ? (city?.dispatch ?? null) : (zone?.dispatch ?? null);
  const effective = useMemo(() => (kind === 'platform' ? resolveDispatchRules(platform) : resolveDispatchRules(parent, override)), [kind, platform, parent, override]);

  const [draft, setDraft] = useState<Editable>(effective);
  useEffect(() => setDraft(effective), [effective]);
  const dirty = JSON.stringify(draft) !== JSON.stringify(effective);
  const editable = kind === 'platform' ? can('order_rules.edit') : can('zones.edit');
  const [confirm, setConfirm] = useState<'save' | 'reset' | null>(null);
  const save = useMutation(fn.updateDispatchRules, { success: 'Règles d’attribution enregistrées' });
  const set = <K extends keyof Editable>(key: K, value: Editable[K] | null) => value !== null && setDraft((d) => ({ ...d, [key]: value }));
  const isOverridden = (key: keyof DispatchRules) => Boolean(override && key in override);
  const inheritedFrom = kind === 'zone' ? 'ville' : 'plateforme';

  const historyPaths = useMemo(() => {
    const list = [`${COLLECTIONS.settings}/${SETTINGS_DOCS.dispatch}#dispatch`];
    if (city) list.push(`${COLLECTIONS.cities}/${city.id}#dispatch`);
    if (zone) list.push(`${COLLECTIONS.zones}/${zone.id}#dispatch`);
    return list;
  }, [city, zone]);
  const history = useSettingsHistory(historyPaths, 20);

  function submit(reason: string) {
    if (confirm === 'reset') return save.mutate({ scope: kind, scopeId: id, rules: null, reason });
    // Surcharge : seules les valeurs différentes du niveau supérieur sont enregistrées.
    const base = kind === 'platform' ? resolveDispatchRules(null) : parent;
    const diff = Object.fromEntries(Object.entries(draft).filter(([k, v]) => kind === 'platform' || JSON.stringify(v) !== JSON.stringify(base[k as keyof DispatchRules]))) as Partial<DispatchRules>;
    return save.mutate({ scope: kind, scopeId: id, rules: diff, reason });
  }

  const field = (key: keyof DispatchRules) => (kind === 'platform' ? null : <OverrideBadge overridden={isOverridden(key)} inheritedFrom={inheritedFrom} />);

  return (
    <DriversShell
      documentTitle="Attribution des courses"
      title="Attribution des courses"
      description="Comment une course trouve son livreur : le plus proche d’abord, un délai pour accepter, puis un rayon qui s’élargit."
      actions={<Select aria-label="Niveau des règles" value={scope} onValueChange={setScope} options={scopes} className="w-full min-w-64 sm:w-auto" />}
    >
      {platformDoc.error ? (
        <LoadError error={platformDoc.error} />
      ) : !scope ? (
        <Card>
          <EmptyState icon={<Radar />} title="Aucune ville dans votre périmètre" description="Choisissez une ville en haut de page." />
        </Card>
      ) : (
        <div className="grid gap-6 xl:grid-cols-3">
          <div className="min-w-0 space-y-6 xl:col-span-2">
            <Card>
              <CardHeader
                title={kind === 'platform' ? 'Règles de la plateforme' : kind === 'city' ? `Règles de ${city?.name ?? ''}` : `Règles de la zone ${zone?.name ?? ''}`}
                description={kind === 'platform' ? 'Valeurs par défaut, surchargeables ville par ville puis zone par zone.' : `Les valeurs non surchargées suivent la ${inheritedFrom}.`}
                icon={<Radar />}
                divided
              />
              <CardContent className="space-y-6">
                <div className="grid gap-4 lg:grid-cols-2">
                  <FormField label="Mode d’attribution" aside={field('mode')}>
                    <RadioGroup
                      value={draft.mode ?? 'auto_assign'}
                      onValueChange={(v) => set('mode', v as DispatchRules['mode'])}
                      disabled={!editable}
                      options={[
                        { value: 'auto_assign', label: 'Attribution directe', description: 'Le meilleur livreur disponible reçoit la course.' },
                        { value: 'offers', label: 'Propositions successives', description: 'Un livreur à la fois, avec un délai pour accepter.' },
                      ]}
                    />
                  </FormField>
                  <FormField label="Choix du livreur" aside={field('strategy')}>
                    <RadioGroup
                      value={draft.strategy}
                      onValueChange={(v) => set('strategy', v as DispatchRules['strategy'])}
                      disabled={!editable}
                      options={(Object.keys(DISPATCH_STRATEGY_LABELS) as DispatchRules['strategy'][]).map((s) => ({
                        value: s,
                        label: DISPATCH_STRATEGY_LABELS[s],
                        description: s === 'nearest' ? 'Distance au commerce uniquement.' : s === 'nearest_with_rating' ? 'Les mieux notés passent devant à distance proche.' : 'Un livreur déjà en course peut prendre une seconde commande.',
                      }))}
                    />
                  </FormField>
                </div>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  <FormField label="Délai pour accepter" aside={field('offerTimeoutSeconds')} hint="Mode propositions successives.">
                    <UnitInput value={draft.offerTimeoutSeconds} onChange={(v) => set('offerTimeoutSeconds', v)} unit="s" min={10} max={300} disabled={!editable} />
                  </FormField>
                  <FormField label="Rayon initial" aside={field('initialRadiusMeters')}>
                    <KmInput value={draft.initialRadiusMeters} onChange={(v) => set('initialRadiusMeters', v)} disabled={!editable} />
                  </FormField>
                  <FormField label="Élargissement par tour" aside={field('radiusStepMeters')}>
                    <KmInput value={draft.radiusStepMeters} onChange={(v) => set('radiusStepMeters', v)} disabled={!editable} />
                  </FormField>
                  <FormField label="Rayon maximal" aside={field('maxRadiusMeters')}>
                    <KmInput value={draft.maxRadiusMeters} onChange={(v) => set('maxRadiusMeters', v)} disabled={!editable} />
                  </FormField>
                  <FormField label="Nombre de tours" aside={field('maxRounds')}>
                    <UnitInput value={draft.maxRounds} onChange={(v) => set('maxRounds', v)} unit="tours" min={1} max={10} disabled={!editable} />
                  </FormField>
                  <FormField label="Anticipation" aside={field('dispatchLeadMinutes')} hint="Avant la fin de préparation estimée.">
                    <UnitInput value={draft.dispatchLeadMinutes} onChange={(v) => set('dispatchLeadMinutes', v)} unit="min" min={0} max={60} disabled={!editable} />
                  </FormField>
                  <FormField label="Courses simultanées par livreur" aside={field('maxConcurrentOrdersPerDriver')}>
                    <UnitInput value={draft.maxConcurrentOrdersPerDriver} onChange={(v) => set('maxConcurrentOrdersPerDriver', v)} unit="max" min={1} max={5} disabled={!editable} />
                  </FormField>
                  <FormField label="Note minimale" aside={field('minDriverRating')} hint="Vide : aucun minimum.">
                    <UnitInput value={draft.minDriverRating ?? null} onChange={(v) => setDraft((d) => ({ ...d, minDriverRating: v }))} unit="/ 5" min={1} max={5} decimals={1} disabled={!editable} />
                  </FormField>
                  <FormField label="Alerte manque de livreurs" aside={field('shortageRatioAlert')} hint="Livreurs disponibles par commande en attente.">
                    <UnitInput value={draft.shortageRatioAlert} onChange={(v) => set('shortageRatioAlert', v)} unit="ratio" min={0} max={10} decimals={2} disabled={!editable} />
                  </FormField>
                </div>
                {kind === 'platform' && (
                  <div className="rounded-xl border border-border bg-surface-2 p-4">
                    <Switch
                      checked={(draft.engine ?? 'advanced') === 'advanced'}
                      onCheckedChange={(v) => set('engine', v ? 'advanced' : 'simple')}
                      disabled={!editable}
                      label="Moteur avancé"
                      description="Tours à rayon croissant, préférences des livreurs (distance maximale, zones), note minimale. Désactivé : attribution simple au plus proche."
                    />
                  </div>
                )}
              </CardContent>
              {editable && (
                <div className="flex flex-col-reverse gap-2 border-t border-border px-5 py-3 sm:flex-row sm:items-center sm:justify-end">
                  {kind !== 'platform' && override && (
                    <Button variant="ghost" leftIcon={<RotateCcw />} onClick={() => setConfirm('reset')} className="sm:mr-auto">
                      Supprimer la surcharge
                    </Button>
                  )}
                  <Button variant="secondary" leftIcon={<Undo2 />} disabled={!dirty} onClick={() => setDraft(effective)}>
                    Annuler
                  </Button>
                  <Button variant="primary" leftIcon={<Save />} disabled={!dirty || draft.initialRadiusMeters > draft.maxRadiusMeters} onClick={() => setConfirm('save')}>
                    Enregistrer
                  </Button>
                </div>
              )}
            </Card>
            <OfferStats cityIds={city ? [city.id] : null} zoneId={zone?.id ?? null} />
          </div>
          <div className="min-w-0 space-y-6">
            <RoundsDiagram rules={draft} />
            <SettingsHistoryCard entries={history.data} loading={history.loading} error={history.error} labels={LABELS} title="Historique des règles" />
          </div>
        </div>
      )}
      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={confirm === 'reset' ? 'Supprimer la surcharge' : 'Enregistrer les règles'}
        description={confirm === 'reset' ? `Les règles de la ${inheritedFrom} s’appliqueront de nouveau.` : 'Les nouvelles règles s’appliquent aux prochaines recherches de livreur.'}
        requireReason
        confirmLabel={confirm === 'reset' ? 'Supprimer la surcharge' : 'Enregistrer'}
        onConfirm={async (reason) => {
          await submit(reason ?? '');
        }}
      />
    </DriversShell>
  );
}

/** Schéma des tours de recherche : cercles concentriques autour du commerce. */
function RoundsDiagram({ rules }: { rules: DispatchRules }) {
  const rounds = Array.from({ length: Math.max(1, Math.min(10, rules.maxRounds)) }, (_, i) => dispatchRadiusForRound(rules, i + 1));
  const unique = rounds.filter((r, i) => i === 0 || r !== rounds[i - 1]);
  const max = Math.max(...unique, 1);
  const size = 220;
  return (
    <Card>
      <CardHeader title="Tours de recherche" description="Le rayon s’élargit à chaque tour sans livreur." icon={<CircleDot />} divided />
      <CardContent>
        <svg viewBox={`0 0 ${size} ${size}`} className="mx-auto block w-full max-w-[240px]" role="img" aria-label="Rayons de recherche successifs">
          {[...unique].reverse().map((r, i) => {
            const radius = (r / max) * (size / 2 - 6);
            const index = unique.length - i;
            return (
              <circle
                key={r}
                cx={size / 2}
                cy={size / 2}
                r={radius}
                fill="var(--gl-primary)"
                fillOpacity={0.05 + (0.18 * (unique.length - index + 1)) / unique.length}
                stroke="var(--gl-primary)"
                strokeOpacity={0.55}
                strokeDasharray={index === unique.length ? undefined : '3 3'}
              />
            );
          })}
          <circle cx={size / 2} cy={size / 2} r={5} fill="var(--gl-fg)" />
        </svg>
        <ol className="mt-4 space-y-1.5 text-sm">
          {rounds.map((r, i) => (
            <li key={i} className="flex items-center justify-between">
              <span className="text-fg-muted">Tour {i + 1}</span>
              <span className="font-mono text-fg num">jusqu’à {formatMeters(r)}</span>
            </li>
          ))}
        </ol>
        <p className="mt-3 border-t border-border pt-3 text-xs text-fg-subtle">
          {rules.mode === 'offers'
            ? `Chaque livreur a ${rules.offerTimeoutSeconds} s pour accepter ; sans réponse, la course passe au suivant.`
            : 'Le livreur retenu reçoit directement la course.'}{' '}
          Au-delà du dernier tour, une alerte « course sans livreur » remonte au tableau de bord.
        </p>
      </CardContent>
    </Card>
  );
}

/** Propositions des 7 derniers jours : acceptation, refus, expiration, délai de réponse. */
function OfferStats({ cityIds, zoneId }: { cityIds: string[] | null; zoneId: string | null }) {
  const since = useMemo(() => new Date(Date.now() - 7 * 86_400_000), []);
  const q = useMemo(() => query(collection(db, COLLECTIONS.dispatchOffers), where('offeredAt', '>=', since), orderBy('offeredAt', 'desc'), limit(2000)), [since]);
  const offers = useCollection<DispatchOffer>(q);
  const cityKey = cityIds?.join(',') ?? '';
  const alertsQuery = useMemo(() => {
    const base = [where('kind', '==', 'dispatch_failed'), where('status', '==', 'open')];
    if (cityIds?.length) base.push(cityIds.length === 1 ? where('cityId', '==', cityIds[0]) : where('cityId', 'in', cityIds));
    return query(collection(db, COLLECTIONS.platformAlerts), ...base, limit(50));
  }, [cityKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const alerts = useCollection<{ cityId?: string }>(alertsQuery);
  const scoped = offers.data.filter((o) => (!cityIds || cityIds.includes(o.cityId)) && (!zoneId || o.zoneId === zoneId));
  const answered = scoped.filter((o) => o.respondedAt && o.status !== 'expired' && o.status !== 'cancelled');
  const accepted = scoped.filter((o) => o.status === 'accepted').length;
  const declined = scoped.filter((o) => o.status === 'declined').length;
  const expired = scoped.filter((o) => o.status === 'expired').length;
  const responseSeconds = answered.length ? answered.reduce((s, o) => s + ((o.respondedAt?.toMillis() ?? 0) - o.offeredAt.toMillis()) / 1000, 0) / answered.length : null;
  const openAlerts = alerts.data.filter((a) => !cityIds || (a.cityId && cityIds.includes(a.cityId))).length;
  return (
    <div>
      <h2 className="mb-3 font-display text-lg font-semibold tracking-tight text-fg">7 derniers jours</h2>
      {offers.error ? (
        <LoadError error={offers.error} compact />
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
          <StatCard label="Propositions" value={formatNumber(scoped.length)} icon={<Send />} tone="info" loading={offers.loading} footer={<span>{pct(scoped.length ? accepted / scoped.length : null)} acceptées</span>} />
          <StatCard label="Refusées ou expirées" value={formatNumber(declined + expired)} icon={<Undo2 />} tone="amber" loading={offers.loading} footer={<span>{declined} refus · {expired} sans réponse</span>} />
          <StatCard label="Délai de réponse" value={responseSeconds === null ? '—' : `${Math.round(responseSeconds)} s`} icon={<Timer />} tone="teal" loading={offers.loading} footer={<span>Moyenne des réponses</span>} />
          <StatCard label="Courses sans livreur" value={formatNumber(openAlerts)} icon={<TriangleAlert />} tone={openAlerts ? 'danger' : 'success'} loading={alerts.loading} footer={<span>Alertes ouvertes</span>} />
        </div>
      )}
      {!offers.loading && scoped.length === 0 && <p className="mt-3 text-xs text-fg-subtle">Aucune proposition sur la période dans ce périmètre.</p>}
    </div>
  );
}
