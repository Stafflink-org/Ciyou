// Rémunération des livreurs (cahier §6, décision client) : forfait sous un seuil de
// distance puis au kilomètre, bonus d'heure de pointe, attente ; réglable par pays et
// surchargeable par ville. Simulateur, gains récents (pourboires reversés à 100 %), historique.
import { useEffect, useMemo, useState } from 'react';
import { collection, limit, orderBy, query, where } from 'firebase/firestore';
import { Calculator, Coins, HandCoins, RotateCcw, Save, Timer, TrendingUp, Zap } from 'lucide-react';
import {
  AreaChart,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  ConfirmDialog,
  EmptyState,
  FormField,
  Input,
  RadioGroup,
  Select,
  Slider,
  StatCard,
  Switch,
  formatEUR,
  formatNumber,
} from '@golink/ui';
import {
  COLLECTIONS,
  DEFAULT_PRICING_BY_COUNTRY,
  computeCourierPay,
  mergePricing,
  type City,
  type Country,
  type CourierPayRulesInput,
  type DriverEarning,
  type MarketPricingConfig,
  type WithId,
} from '@golink/shared';
import { useAdminAccess } from '@/auth/AdminAccess';
import { useGeoScope } from '@/layout/GeoScope';
import { db } from '@/lib/firebase';
import { useCollection, useMutation } from '@/lib/firestore';
import { fn } from '../_operations/functions';
import { useSettingsHistory } from '../_operations/hooks';
import { EuroInput, KmInput, UnitInput } from '../_operations/inputs';
import { LoadError, SettingsHistoryCard } from '../_operations/ui';
import { DriversShell } from './shell';

const euros = (cents: number) => formatEUR(cents, { cents: true });

const FIELD_LABELS: Record<string, string> = {
  model: 'Modèle',
  flatDistanceThresholdMeters: 'Seuil du forfait (m)',
  flatAmountCents: 'Forfait (centimes)',
  perKmCents: 'Prix au km (centimes)',
  perKmMode: 'Calcul au-delà du seuil',
  peakBonusCents: 'Bonus de pointe (centimes)',
  peakHours: 'Heures de pointe (0 à 23, séparées par des virgules)',
  freeWaitMinutes: 'Attente gratuite (min)',
  waitingPerMinuteCents: 'Attente par minute (centimes)',
  minimumPerOrderCents: 'Minimum par course (centimes)',
  hourlyGuaranteeEnabled: 'Garantie horaire',
  hourlyGuaranteeCents: 'Garantie horaire (centimes)',
};

function toInput(courier: MarketPricingConfig['courier']): CourierPayRulesInput {
  return {
    model: courier.model ?? 'pickup_dropoff_per_km',
    flatDistanceThresholdMeters: courier.flatDistanceThresholdMeters ?? 2000,
    flatAmountCents: courier.flatAmountCents ?? courier.minimumPerOrderCents,
    perKmCents: courier.perKmCents,
    perKmMode: courier.perKmMode ?? 'beyond_threshold',
    peakBonusCents: courier.peakBonusCents ?? 0,
    peakHours: courier.peakHours ?? [12, 13, 19, 20],
    freeWaitMinutes: courier.freeWaitMinutes,
    waitingPerMinuteCents: courier.waitingPerMinuteCents,
    minimumPerOrderCents: courier.minimumPerOrderCents,
    hourlyGuaranteeEnabled: courier.hourlyGuaranteeEnabled ?? courier.hourlyGuaranteeCents > 0,
    hourlyGuaranteeCents: courier.hourlyGuaranteeCents,
  };
}

export function PayRulesPage() {
  const { can } = useAdminAccess();
  const geo = useGeoScope();
  const editable = can('drivers.pay_rules');
  const scopes = useMemo(() => {
    const cities = geo.cities
      .filter((c) => (!geo.countryId || c.countryId === geo.countryId) && (!geo.cityId || c.id === geo.cityId))
      .sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name, 'fr'));
    const countries = geo.global || !geo.cityIds ? geo.countries.filter((c) => !geo.countryId || c.id === geo.countryId) : [];
    return [
      ...cities.map((c) => ({ value: `city:${c.id}`, label: `Ville · ${c.name}` })),
      ...countries.map((c) => ({ value: `country:${c.id}`, label: `Pays · ${c.name} (barème par défaut)` })),
    ];
  }, [geo]);
  const [scope, setScope] = useState<string>('');
  useEffect(() => {
    if (!scopes.some((s) => s.value === scope)) setScope(scopes[0]?.value ?? '');
  }, [scopes, scope]);
  const [kind, id] = scope.split(':') as ['city' | 'country', string];
  const city: WithId<City> | undefined = kind === 'city' ? geo.cities.find((c) => c.id === id) : undefined;
  const country: WithId<Country> | undefined = geo.countries.find((c) => c.id === (kind === 'city' ? city?.countryId : id));
  const countryPricing = country?.pricing ?? (country ? DEFAULT_PRICING_BY_COUNTRY[country.id] : undefined);
  const effective = useMemo(() => (countryPricing ? mergePricing(countryPricing, city?.pricing ?? null) : null), [countryPricing, city?.pricing]);
  const overridden = Boolean(city?.pricing?.courier);

  const [draft, setDraft] = useState<CourierPayRulesInput | null>(null);
  useEffect(() => {
    setDraft(effective ? toInput(effective.courier) : null);
  }, [effective]);
  const dirty = Boolean(draft && effective && JSON.stringify(draft) !== JSON.stringify(toInput(effective.courier)));
  const [confirm, setConfirm] = useState<'save' | 'reset' | null>(null);
  const save = useMutation(fn.updateCourierPay, { success: 'Barème enregistré : il s’applique aux prochaines courses' });

  const historyPaths = useMemo(() => [country ? `${COLLECTIONS.countries}/${country.id}#courier` : '', city ? `${COLLECTIONS.cities}/${city.id}#courier` : ''].filter(Boolean), [country, city]);
  const history = useSettingsHistory(historyPaths, 20);

  const set = <K extends keyof CourierPayRulesInput>(key: K, value: CourierPayRulesInput[K] | null) => draft && value !== null && setDraft({ ...draft, [key]: value });

  return (
    <DriversShell
      documentTitle="Rémunération des livreurs"
      title="Rémunération"
      description="Forfait pour les courses courtes, puis prix au kilomètre, bonus en heure de pointe. Les pourboires sont reversés intégralement."
      actions={
        <Select aria-label="Barème affiché" value={scope} onValueChange={setScope} options={scopes} className="w-full min-w-64 sm:w-auto" />
      }
    >
      {!effective || !draft ? (
        <Card>
          <EmptyState icon={<Coins />} title="Aucun marché dans votre périmètre" description="Choisissez une ville ou un pays en haut de page." />
        </Card>
      ) : (
        <div className="grid gap-6 xl:grid-cols-3">
          <div className="min-w-0 space-y-6 xl:col-span-2">
            <Card>
              <CardHeader
                title={kind === 'city' ? `Barème de ${city?.name}` : `Barème par défaut · ${country?.name}`}
                description={kind === 'city' ? (overridden ? 'Barème propre à cette ville.' : `Hérité du barème de ${country?.name} : toute modification crée un barème propre à la ville.`) : 'S’applique à toutes les villes du pays sans barème propre.'}
                actions={kind === 'city' ? <Badge tone={overridden ? 'brand' : 'neutral'} variant={overridden ? 'soft' : 'outline'}>{overridden ? 'Propre à la ville' : 'Hérité du pays'}</Badge> : undefined}
                divided
              />
              <CardContent className="space-y-6">
                <RadioGroup
                  variant="cards"
                  value={draft.model}
                  onValueChange={(v) => set('model', v as CourierPayRulesInput['model'])}
                  disabled={!editable}
                  options={[
                    { value: 'flat_then_per_km', label: 'Forfait puis au kilomètre', description: 'Montant fixe sous le seuil, puis prix au km (modèle retenu).' },
                    { value: 'pickup_dropoff_per_km', label: 'Prise en charge + kilomètre', description: 'Ancien barème : retrait, remise, distance, minimum garanti.' },
                  ]}
                />
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {draft.model === 'flat_then_per_km' && (
                    <>
                      <FormField label="Seuil du forfait" hint="En dessous : montant fixe.">
                        <KmInput value={draft.flatDistanceThresholdMeters} onChange={(v) => set('flatDistanceThresholdMeters', v)} disabled={!editable} />
                      </FormField>
                      <FormField label="Forfait course courte">
                        <EuroInput value={draft.flatAmountCents} onChange={(v) => set('flatAmountCents', v)} disabled={!editable} />
                      </FormField>
                    </>
                  )}
                  <FormField label="Prix au kilomètre">
                    <EuroInput value={draft.perKmCents} onChange={(v) => set('perKmCents', v)} disabled={!editable} />
                  </FormField>
                  <FormField label="Bonus heure de pointe" hint="Par course, en plus des règles de pointe des zones.">
                    <EuroInput value={draft.peakBonusCents} onChange={(v) => set('peakBonusCents', v)} disabled={!editable} />
                  </FormField>
                  <FormField label="Heures de pointe" hint="Heures locales (0 à 23) séparées par des virgules : le bonus s’applique à la commande passée à ces heures.">
                    <Input
                      value={draft.peakHours.join(', ')}
                      disabled={!editable}
                      onChange={(e) =>
                        set(
                          'peakHours',
                          e.target.value
                            .split(',')
                            .map((v) => Number(v.trim()))
                            .filter((n) => Number.isInteger(n) && n >= 0 && n <= 23),
                        )
                      }
                    />
                  </FormField>
                  <FormField label="Attente gratuite chez le client">
                    <UnitInput value={draft.freeWaitMinutes} onChange={(v) => set('freeWaitMinutes', v)} unit="min" min={0} max={60} disabled={!editable} />
                  </FormField>
                  <FormField label="Attente rémunérée">
                    <EuroInput value={draft.waitingPerMinuteCents} onChange={(v) => set('waitingPerMinuteCents', v)} disabled={!editable} aria-label="Montant par minute d’attente" />
                  </FormField>
                  {draft.model === 'pickup_dropoff_per_km' && (
                    <FormField label="Minimum par course">
                      <EuroInput value={draft.minimumPerOrderCents} onChange={(v) => set('minimumPerOrderCents', v)} disabled={!editable} />
                    </FormField>
                  )}
                </div>
                {draft.model === 'flat_then_per_km' && (
                  <FormField label="Au-delà du seuil">
                    <RadioGroup
                      value={draft.perKmMode}
                      onValueChange={(v) => set('perKmMode', v as CourierPayRulesInput['perKmMode'])}
                      disabled={!editable}
                      options={[
                        { value: 'beyond_threshold', label: 'Forfait + kilomètres au-delà du seuil', description: 'Ex. 3,5 km : forfait + 1,5 km.' },
                        { value: 'full_distance', label: 'Distance totale au kilomètre', description: 'Le forfait sert de plancher.' },
                      ]}
                    />
                  </FormField>
                )}
                <div className="flex flex-col gap-3 rounded-xl border border-border bg-surface-2 p-4 sm:flex-row sm:items-center sm:justify-between">
                  <Switch
                    checked={draft.hourlyGuaranteeEnabled}
                    onCheckedChange={(v) => set('hourlyGuaranteeEnabled', v)}
                    disabled={!editable}
                    label="Revenu horaire minimum garanti"
                    description="Complément hebdomadaire si les gains d’une heure active sont inférieurs au seuil."
                  />
                  {draft.hourlyGuaranteeEnabled && (
                    <div className="w-full sm:w-40">
                      <EuroInput value={draft.hourlyGuaranteeCents} onChange={(v) => set('hourlyGuaranteeCents', v)} disabled={!editable} aria-label="Montant horaire garanti" />
                    </div>
                  )}
                </div>
              </CardContent>
              {editable && (
                <div className="flex flex-col-reverse gap-2 border-t border-border px-5 py-3 sm:flex-row sm:items-center sm:justify-end">
                  {kind === 'city' && overridden && (
                    <Button variant="ghost" leftIcon={<RotateCcw />} onClick={() => setConfirm('reset')} className="sm:mr-auto">
                      Revenir au barème du pays
                    </Button>
                  )}
                  <Button variant="secondary" disabled={!dirty} onClick={() => setDraft(toInput(effective.courier))}>
                    Annuler les changements
                  </Button>
                  <Button variant="primary" leftIcon={<Save />} disabled={!dirty} onClick={() => setConfirm('save')}>
                    Enregistrer
                  </Button>
                </div>
              )}
            </Card>
            <EarningsStats cityId={kind === 'city' ? id : null} countryId={country?.id ?? null} />
          </div>
          <div className="min-w-0 space-y-6">
            <Simulator config={effective} draft={draft} />
            <SettingsHistoryCard entries={history.data} loading={history.loading} error={history.error} labels={FIELD_LABELS} title="Historique du barème" />
          </div>
        </div>
      )}
      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={confirm === 'reset' ? 'Revenir au barème du pays' : 'Enregistrer le barème'}
        description={confirm === 'reset' ? `${city?.name} appliquera de nouveau le barème de ${country?.name}.` : 'Le nouveau barème s’applique aux courses attribuées à partir de maintenant.'}
        requireReason
        confirmLabel={confirm === 'reset' ? 'Revenir au barème du pays' : 'Enregistrer'}
        onConfirm={async (reason) => {
          if (!draft) return;
          await save.mutate({ scope: kind, scopeId: id, courier: confirm === 'reset' ? null : draft, reason: reason ?? '' });
        }}
      />
    </DriversShell>
  );
}

/** Simulateur : rémunération d'une course selon la distance, l'attente et la pointe. */
function Simulator({ config, draft }: { config: MarketPricingConfig; draft: CourierPayRulesInput }) {
  const [distance, setDistance] = useState(3200);
  const [wait, setWait] = useState(0);
  const [peak, setPeak] = useState(false);
  const cfg = useMemo(() => ({ ...config, courier: { ...config.courier, ...draft } }), [config, draft]);
  const pay = computeCourierPay({ distanceMeters: distance, durationMinutes: Math.round(distance / 250), waitingMinutes: wait, isPeak: peak }, cfg);
  const curve = useMemo(
    () =>
      Array.from({ length: 21 }, (_, i) => {
        const m = i * 500;
        return {
          km: `${(m / 1000).toLocaleString('fr-FR')} km`,
          normal: computeCourierPay({ distanceMeters: m, durationMinutes: Math.round(m / 250) }, cfg).earningsCents / 100,
          pointe: computeCourierPay({ distanceMeters: m, durationMinutes: Math.round(m / 250), isPeak: true }, cfg).earningsCents / 100,
        };
      }),
    [cfg],
  );
  const lines = [
    { label: pay.model === 'flat_then_per_km' ? 'Forfait' : 'Prise en charge et remise', value: (pay.flatCents ?? 0) + pay.pickupCents + pay.dropoffCents },
    { label: 'Distance', value: pay.distanceCents + pay.timeCents },
    { label: 'Complément minimum', value: pay.minimumTopUpCents },
    { label: 'Attente', value: pay.waitingCents },
    { label: 'Bonus de pointe', value: pay.surgeBonusCents },
  ].filter((l) => l.value > 0);
  return (
    <Card>
      <CardHeader title="Simulateur" description="Gain du livreur pour une course, hors pourboire." icon={<Calculator />} divided />
      <CardContent className="space-y-5">
        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-fg-muted">Distance commerce → client</span>
            <span className="font-mono text-fg num">{(distance / 1000).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} km</span>
          </div>
          <Slider value={[distance]} min={0} max={10_000} step={100} onValueChange={([v]) => setDistance(v ?? 0)} aria-label="Distance" />
        </div>
        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="inline-flex items-center gap-1.5 text-fg-muted"><Timer className="size-3.5" /> Attente chez le client</span>
            <span className="font-mono text-fg num">{wait} min</span>
          </div>
          <Slider value={[wait]} min={0} max={20} step={1} onValueChange={([v]) => setWait(v ?? 0)} aria-label="Attente" />
        </div>
        <Switch checked={peak} onCheckedChange={setPeak} label={<span className="inline-flex items-center gap-1.5"><Zap className="size-3.5 text-warning" /> Heure de pointe</span>} />
        <div className="rounded-xl border border-border bg-surface-2 p-4">
          <dl className="space-y-1.5 text-sm">
            {lines.map((l) => (
              <div key={l.label} className="flex justify-between">
                <dt className="text-fg-muted">{l.label}</dt>
                <dd className="font-mono num">{euros(l.value)}</dd>
              </div>
            ))}
          </dl>
          <div className="mt-3 flex items-baseline justify-between border-t border-border pt-3">
            <span className="text-sm font-medium text-fg">Gain de la course</span>
            <span className="font-display text-2xl font-semibold tracking-display text-fg num">{euros(pay.earningsCents)}</span>
          </div>
        </div>
        <AreaChart
          data={curve}
          xKey="km"
          height={180}
          series={[
            { key: 'normal', label: 'Heures creuses' },
            { key: 'pointe', label: 'Heure de pointe' },
          ]}
          valueFormatter={(v) => formatEUR(v)}
          axisFormatter={(v) => `${v} €`}
        />
      </CardContent>
    </Card>
  );
}

/** Gains des livreurs sur 30 jours (grand livre des courses). */
function EarningsStats({ cityId, countryId }: { cityId: string | null; countryId: string | null }) {
  const geo = useGeoScope();
  const since = useMemo(() => new Date(Date.now() - 30 * 86_400_000), []);
  const cityIds = cityId ? [cityId] : geo.cities.filter((c) => c.countryId === countryId).map((c) => c.id).slice(0, 30);
  const q = useMemo(
    () => (cityIds.length ? query(collection(db, COLLECTIONS.driverEarnings), cityIds.length === 1 ? where('cityId', '==', cityIds[0]) : where('cityId', 'in', cityIds), where('earnedAt', '>=', since), orderBy('earnedAt', 'desc'), limit(3000)) : null),
    [cityIds.join(','), since], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const earnings = useCollection<DriverEarning>(q);
  const s = useMemo(() => {
    const deliveries = earnings.data.filter((e) => e.kind === 'delivery');
    const total = earnings.data.reduce((a, e) => a + e.amountCents, 0);
    const tips = earnings.data.reduce((a, e) => a + (e.tipCents ?? 0), 0);
    const peak = deliveries.reduce((a, e) => a + (e.breakdown?.surgeBonusCents ?? 0), 0);
    const drivers = new Set(earnings.data.map((e) => e.driverId)).size;
    return { total, tips, peak, count: deliveries.length, average: deliveries.length ? Math.round(deliveries.reduce((a, e) => a + e.amountCents, 0) / deliveries.length) : 0, drivers };
  }, [earnings.data]);
  if (earnings.error) return <LoadError error={earnings.error} compact />;
  return (
    <div>
      <h2 className="mb-3 font-display text-lg font-semibold tracking-tight text-fg">Gains des 30 derniers jours</h2>
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <StatCard label="Gains versés" value={euros(s.total)} icon={<Coins />} tone="success" loading={earnings.loading} footer={<span>{formatNumber(s.drivers)} livreurs rémunérés</span>} />
        <StatCard label="Pourboires" value={euros(s.tips)} icon={<HandCoins />} tone="plum" loading={earnings.loading} footer={<span>Reversés à 100 %</span>} />
        <StatCard label="Gain moyen par course" value={euros(s.average)} icon={<TrendingUp />} tone="info" loading={earnings.loading} footer={<span>{formatNumber(s.count)} courses</span>} />
        <StatCard label="Bonus de pointe" value={euros(s.peak)} icon={<Zap />} tone="amber" loading={earnings.loading} footer={<span>{s.total ? Math.round((s.peak / s.total) * 100) : 0} % des gains</span>} />
      </div>
    </div>
  );
}
