// Zones et villes (cahier §10) : villes activables (lancement ville par ville),
// zones dessinées sur la carte, tarifs par distance, horaires de service, fermeture
// d'urgence avec message aux clients, heures de pointe (majoration, bonus livreurs).
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { collection, doc, getDoc, query, where } from 'firebase/firestore';
import { Building2, CloudLightning, MapPinned, Pause, Pencil, Play, Plus, Power, Save, Store, Undo2, Users, Zap } from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  ConfirmDialog,
  EmptyState,
  PageContainer,
  PageHeader,
  Select,
  StatusPill,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  formatDate,
  formatEUR,
  formatNumber,
  formatRelative,
} from '@golink/ui';
import {
  COLLECTIONS,
  EMERGENCY_REASON_LABELS,
  SURGE_TRIGGER_LABELS,
  type City,
  type SurgeRule,
  type WeeklyHours,
  type WithId,
  type Zone,
} from '@golink/shared';
import { useDocumentTitle } from '@golink/web';
import { useAdminAccess } from '@/auth/AdminAccess';
import { useGeoScope } from '@/layout/GeoScope';
import { db } from '@/lib/firebase';
import { toDate, useCollection, useMutation } from '@/lib/firestore';
import { fn } from '../_operations/functions';
import { useSettingsHistory } from '../_operations/hooks';
import { hoursIssues, WeeklyHoursEditor } from '../_operations/hours';
import { ListSkeleton, LoadError, SettingsHistoryCard } from '../_operations/ui';
import { CityDialog, ClosureDialog, SurgeRuleDialog } from './dialogs';
import { ZonesTab } from './ZonesTab';

export function ZonesPage() {
  useDocumentTitle('Zones et villes · GoLink Admin');
  const params = useParams();
  const navigate = useNavigate();
  const geo = useGeoScope();
  const { can } = useAdminAccess();
  const cities = useMemo(() => geo.cities.filter((c) => (!geo.countryId || c.countryId === geo.countryId) && (!geo.cityId || c.id === geo.cityId)), [geo]);
  const [zoneCity, setZoneCity] = useState<string | null>(null);
  // Accès direct à une zone : on retrouve sa ville.
  useEffect(() => {
    if (!params.zoneId) return;
    let alive = true;
    getDoc(doc(db, COLLECTIONS.zones, params.zoneId))
      .then((snap) => alive && setZoneCity((snap.get('cityId') as string | undefined) ?? null))
      .catch(() => alive && setZoneCity(null));
    return () => {
      alive = false;
    };
  }, [params.zoneId]);
  const [cityId, setCityId] = useState<string>('');
  useEffect(() => {
    const wanted = params.cityId ?? zoneCity ?? cityId;
    const next = cities.find((c) => c.id === wanted)?.id ?? cities.find((c) => c.active)?.id ?? cities[0]?.id ?? '';
    if (next !== cityId) setCityId(next);
  }, [params.cityId, zoneCity, cities, cityId]);
  const city = cities.find((c) => c.id === cityId) ?? null;
  const zonesQuery = useMemo(() => (cityId ? query(collection(db, COLLECTIONS.zones), where('cityId', '==', cityId)) : null), [cityId]);
  const zones = useCollection<Zone>(zonesQuery);
  const sortedZones = useMemo(() => [...zones.data].sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name, 'fr')), [zones.data]);
  const [creating, setCreating] = useState(false);

  return (
    <PageContainer wide>
      <PageHeader
        eyebrow={`Opérations · ${geo.label}`}
        title="Zones et villes"
        description="Découpage géographique de l’activité : villes, zones de livraison, horaires, fermetures d’urgence et heures de pointe."
        actions={
          <>
            <Select
              aria-label="Ville"
              value={cityId}
              onValueChange={(v) => navigate(`/villes/${v}`)}
              options={cities.map((c) => ({ value: c.id, label: `${c.name}${c.active ? '' : ' · inactive'}` }))}
              className="w-full min-w-52 sm:w-auto"
            />
            {can('markets.edit') && (
              <Button variant="secondary" leftIcon={<Plus />} onClick={() => setCreating(true)}>
                Nouvelle ville
              </Button>
            )}
          </>
        }
      />
      {!city ? (
        <Card>
          <EmptyState icon={<Building2 />} title="Aucune ville dans votre périmètre" description="Créez une ville ou élargissez le filtre géographique." />
        </Card>
      ) : (
        <>
          <CityHeader city={city} zones={sortedZones} />
          <Tabs defaultValue="zones" className="mt-6">
            <div data-scroll-ok className="-mx-4 mb-5 overflow-x-auto px-4 [scrollbar-width:none] sm:mx-0 sm:px-0">
              <TabsList>
                <TabsTrigger value="zones" count={sortedZones.length}>Zones de livraison</TabsTrigger>
                <TabsTrigger value="hours">Horaires de service</TabsTrigger>
                <TabsTrigger value="surge">Heures de pointe</TabsTrigger>
                <TabsTrigger value="history">Historique</TabsTrigger>
              </TabsList>
            </div>
            <TabsContent value="zones">
              {zones.loading ? <ListSkeleton rows={3} /> : zones.error ? <LoadError error={zones.error} /> : <ZonesTab city={city} zones={sortedZones} initialZoneId={params.zoneId ?? null} />}
            </TabsContent>
            <TabsContent value="hours">
              <HoursTab city={city} />
            </TabsContent>
            <TabsContent value="surge">
              <SurgeTab city={city} zones={sortedZones} />
            </TabsContent>
            <TabsContent value="history">
              <HistoryTab city={city} zones={sortedZones} />
            </TabsContent>
          </Tabs>
        </>
      )}
      <CityDialog open={creating} onOpenChange={setCreating} countries={geo.countries} onCreated={(id) => navigate(`/villes/${id}`)} />
    </PageContainer>
  );
}

function CityHeader({ city, zones }: { city: WithId<City>; zones: WithId<Zone>[] }) {
  const { can } = useAdminAccess();
  const [confirm, setConfirm] = useState<'activate' | 'deactivate' | 'reopen' | null>(null);
  const [closing, setClosing] = useState(false);
  const toggle = useMutation(fn.setCityActive, { success: (r) => (r.active ? 'Ville activée : elle est visible dans l’application' : 'Ville désactivée') });
  const reopen = useMutation(fn.closeZone, { success: 'Livraison rouverte dans la ville' });
  const live = zones.reduce(
    (acc, z) => {
      const l = z.live && Date.now() - z.live.updatedAt.toMillis() < 30 * 60_000 ? z.live : null;
      return { online: acc.online + (l?.driversOnline ?? 0), available: acc.available + (l?.driversAvailable ?? 0), waiting: acc.waiting + (l?.ordersWaiting ?? 0) };
    },
    { online: 0, available: 0, waiting: 0 },
  );
  const closure = city.emergencyClosure?.active ? city.emergencyClosure : null;
  const launched = toDate(city.launchedAt ?? null);
  return (
    <Card className="p-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 items-center gap-4">
          <span className="grid size-12 shrink-0 place-items-center rounded-xl border border-border bg-surface-2 text-fg-muted">
            <Building2 className="size-5" />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-display text-xl font-semibold tracking-tight text-fg">{city.name}</h2>
              {city.active ? <StatusPill tone="success" pulse>Active</StatusPill> : <StatusPill tone="neutral">Inactive</StatusPill>}
              {closure && <Badge tone="danger" icon={<CloudLightning />}>Fermée · {EMERGENCY_REASON_LABELS[closure.reason]}</Badge>}
            </div>
            <p className="mt-0.5 text-sm text-fg-muted">
              {city.countryId} · {city.timezone}
              {launched ? ` · lancée le ${formatDate(launched)}` : ' · pas encore lancée'}
            </p>
          </div>
        </div>
        <dl className="grid grid-cols-3 gap-4 text-center sm:gap-8">
          <div>
            <dt className="text-2xs text-fg-subtle">Commerces actifs</dt>
            <dd className="font-display text-lg font-semibold text-fg num">{formatNumber(city.stats?.restaurantsActive ?? 0)}</dd>
          </div>
          <div>
            <dt className="text-2xs text-fg-subtle">Livreurs en ligne</dt>
            <dd className="font-display text-lg font-semibold text-fg num">
              {live.online}
              <span className="ml-1 text-xs font-normal text-success">{live.available} dispo.</span>
            </dd>
          </div>
          <div>
            <dt className="text-2xs text-fg-subtle">En attente de livreur</dt>
            <dd className="font-display text-lg font-semibold text-fg num">{live.waiting}</dd>
          </div>
        </dl>
        <div className="flex flex-wrap gap-2">
          {closure ? (
            <Button variant="secondary" leftIcon={<Play />} onClick={() => setConfirm('reopen')}>
              Rouvrir la livraison
            </Button>
          ) : (
            city.active && (
              <Button variant="danger-soft" leftIcon={<CloudLightning />} onClick={() => setClosing(true)}>
                Fermeture d’urgence
              </Button>
            )
          )}
          {can('markets.edit') && (
            <Button variant={city.active ? 'secondary' : 'primary'} leftIcon={city.active ? <Pause /> : <Power />} onClick={() => setConfirm(city.active ? 'deactivate' : 'activate')}>
              {city.active ? 'Désactiver' : 'Activer la ville'}
            </Button>
          )}
        </div>
      </div>
      {closure && (
        <p className="tone-danger mt-4 rounded-lg bg-(--tone-bg) px-3.5 py-2.5 text-sm text-(--tone-fg)">
          Message aux clients : « {closure.message.fr} »
          {toDate(closure.endsAt ?? null) ? ` · réouverture automatique ${formatRelative(toDate(closure.endsAt ?? null)!)}` : ' · réouverture manuelle'}
        </p>
      )}
      <ClosureDialog open={closing} onOpenChange={setClosing} scope="city" id={city.id} name={city.name} />
      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={confirm === 'activate' ? `Activer ${city.name}` : confirm === 'deactivate' ? `Désactiver ${city.name}` : 'Rouvrir la livraison'}
        description={
          confirm === 'activate'
            ? 'La ville devient visible et opérable dans l’application client (au moins une zone active requise).'
            : confirm === 'deactivate'
              ? 'La ville n’est plus proposée aux clients ; les commandes en cours se terminent normalement.'
              : 'Les clients de la ville peuvent de nouveau commander en livraison.'
        }
        destructive={confirm === 'deactivate'}
        requireReason
        confirmLabel={confirm === 'activate' ? 'Activer' : confirm === 'deactivate' ? 'Désactiver' : 'Rouvrir'}
        onConfirm={async (reason) => {
          if (confirm === 'reopen') await reopen.mutate({ scope: 'city', id: city.id, close: false, note: reason ?? '' });
          else await toggle.mutate({ cityId: city.id, active: confirm === 'activate', reason: reason ?? '' });
        }}
      />
    </Card>
  );
}

function HoursTab({ city }: { city: WithId<City> }) {
  const [hours, setHours] = useState<WeeklyHours>(city.serviceHours);
  useEffect(() => setHours(city.serviceHours), [city.id, city.serviceHours]);
  const dirty = JSON.stringify(hours) !== JSON.stringify(city.serviceHours);
  const issues = hoursIssues(hours);
  const [confirm, setConfirm] = useState(false);
  const save = useMutation(fn.saveCity, { success: 'Horaires de service enregistrés' });
  return (
    <div className="grid gap-6 xl:grid-cols-3">
      <Card className="min-w-0 xl:col-span-2">
        <CardHeader title="Heures de fonctionnement de la livraison" description={`Hors de ces créneaux, seules les commandes programmées sont acceptées à ${city.name}.`} divided />
        <CardContent>
          <WeeklyHoursEditor value={hours} onChange={setHours} />
        </CardContent>
        <div className="flex flex-col-reverse gap-2 border-t border-border px-5 py-3 sm:flex-row sm:justify-end">
          <Button variant="secondary" leftIcon={<Undo2 />} disabled={!dirty} onClick={() => setHours(city.serviceHours)}>
            Annuler
          </Button>
          <Button variant="primary" leftIcon={<Save />} disabled={!dirty || issues.length > 0} onClick={() => setConfirm(true)}>
            Enregistrer
          </Button>
        </div>
      </Card>
      <Card className="h-fit">
        <CardHeader title="Bon à savoir" divided />
        <CardContent className="space-y-2 text-sm text-fg-muted">
          <p>Chaque zone peut avoir ses propres horaires (onglet Zones de livraison).</p>
          <p>Les horaires des commerces s’ajoutent : une commande n’est possible que si le commerce et le service de livraison sont ouverts.</p>
          <p>Fuseau horaire : {city.timezone}.</p>
        </CardContent>
      </Card>
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title="Enregistrer les horaires"
        description="Les nouveaux horaires s’appliquent immédiatement aux commandes en livraison."
        requireReason
        confirmLabel="Enregistrer"
        onConfirm={async (reason) => {
          await save.mutate({ cityId: city.id, countryId: city.countryId, name: city.name, timezone: city.timezone, center: city.center, serviceHours: hours, reason: reason ?? null });
        }}
      />
    </div>
  );
}

function SurgeTab({ city, zones }: { city: WithId<City>; zones: WithId<Zone>[] }) {
  const q = useMemo(() => query(collection(db, COLLECTIONS.surgeRules), where('cityId', '==', city.id)), [city.id]);
  const rules = useCollection<SurgeRule>(q);
  const [editing, setEditing] = useState<WithId<SurgeRule> | null | 'new'>(null);
  const [starting, setStarting] = useState<WithId<SurgeRule> | null>(null);
  const [stopping, setStopping] = useState<WithId<SurgeRule> | null>(null);
  const [duration, setDuration] = useState('60');
  const apply = useMutation(fn.applySurge, { success: (r) => (r.on ? 'Majoration lancée' : 'Majoration arrêtée') });
  const zoneName = (id: string) => zones.find((z) => z.id === id)?.name ?? id;
  const running = (rule: WithId<SurgeRule>) => zones.some((z) => z.currentSurge?.ruleId === rule.id && z.currentSurge.until.toMillis() > Date.now());
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-fg-muted">Majoration temporaire des frais de livraison et bonus livreurs en cas de forte demande.</p>
        <Button variant="primary" leftIcon={<Plus />} onClick={() => setEditing('new')} disabled={zones.length === 0}>
          Nouvelle règle
        </Button>
      </div>
      {rules.loading ? (
        <ListSkeleton rows={2} />
      ) : rules.error ? (
        <LoadError error={rules.error} />
      ) : rules.data.length === 0 ? (
        <Card>
          <EmptyState icon={<Zap />} title="Aucune règle de pointe" description="Créez une majoration planifiée (pointe du soir), automatique (demande) ou manuelle (événement)." />
        </Card>
      ) : (
        <ul className="grid gap-3 lg:grid-cols-2">
          {rules.data.map((r) => {
            const on = running(r);
            return (
              <li key={r.id}>
                <Card className="h-full p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-medium text-fg">{r.name}</p>
                        {on ? <StatusPill tone="amber" pulse>En cours</StatusPill> : r.active ? <Badge size="sm" tone="success" variant="outline">Active</Badge> : <Badge size="sm" tone="neutral" variant="outline">Inactive</Badge>}
                      </div>
                      <p className="mt-0.5 text-xs text-fg-subtle">{SURGE_TRIGGER_LABELS[r.trigger]}{r.trigger === 'demand' && r.demandRatio ? ` · dès ${r.demandRatio.toLocaleString('fr-FR')} commandes par livreur` : ''}</p>
                    </div>
                    <Button size="xs" variant="ghost" leftIcon={<Pencil />} onClick={() => setEditing(r)}>
                      Modifier
                    </Button>
                  </div>
                  <dl className="mt-3 grid grid-cols-3 gap-2 rounded-lg bg-surface-2 p-3 text-center">
                    <div>
                      <dt className="text-2xs text-fg-subtle">Frais</dt>
                      <dd className="font-mono text-sm text-fg num">×{(r.multiplierBps / 10_000).toLocaleString('fr-FR')}</dd>
                    </div>
                    <div>
                      <dt className="text-2xs text-fg-subtle">Supplément</dt>
                      <dd className="font-mono text-sm text-fg num">{formatEUR(r.flatFeeCents, { cents: true })}</dd>
                    </div>
                    <div>
                      <dt className="text-2xs text-fg-subtle">Bonus livreur</dt>
                      <dd className="font-mono text-sm text-fg num">{formatEUR(r.courierBonusCents, { cents: true })}</dd>
                    </div>
                  </dl>
                  <p className="mt-3 flex items-center gap-1.5 truncate text-xs text-fg-muted">
                    <MapPinned className="size-3.5 shrink-0" /> {r.zoneIds.map(zoneName).join(', ')}
                  </p>
                  {r.active && (
                    <div className="mt-3 flex justify-end">
                      {on ? (
                        <Button size="sm" variant="secondary" leftIcon={<Pause />} onClick={() => setStopping(r)}>
                          Arrêter
                        </Button>
                      ) : (
                        <Button size="sm" variant="secondary" leftIcon={<Play />} onClick={() => setStarting(r)}>
                          Lancer maintenant
                        </Button>
                      )}
                    </div>
                  )}
                </Card>
              </li>
            );
          })}
        </ul>
      )}
      <SurgeRuleDialog open={editing !== null} onOpenChange={(o) => !o && setEditing(null)} city={city} zones={zones} rule={editing === 'new' ? null : editing} />
      <ConfirmDialog
        open={Boolean(starting)}
        onOpenChange={(o) => !o && setStarting(null)}
        title={`Lancer « ${starting?.name ?? ''} »`}
        description="La majoration s’applique immédiatement aux nouvelles commandes des zones concernées."
        requireReason
        confirmLabel="Lancer"
        onConfirm={async (reason) => {
          if (starting) await apply.mutate({ ruleId: starting.id, on: true, durationMinutes: Number(duration), reason: reason ?? '' });
        }}
      >
        <Select
          aria-label="Durée"
          value={duration}
          onValueChange={setDuration}
          options={[
            { value: '30', label: 'Pendant 30 minutes' },
            { value: '60', label: 'Pendant 1 heure' },
            { value: '120', label: 'Pendant 2 heures' },
            { value: '240', label: 'Pendant 4 heures' },
          ]}
        />
      </ConfirmDialog>
      <ConfirmDialog
        open={Boolean(stopping)}
        onOpenChange={(o) => !o && setStopping(null)}
        title={`Arrêter « ${stopping?.name ?? ''} »`}
        description="Les frais et bonus reviennent immédiatement à la normale."
        requireReason
        confirmLabel="Arrêter"
        onConfirm={async (reason) => {
          if (stopping) await apply.mutate({ ruleId: stopping.id, on: false, reason: reason ?? '' });
        }}
      />
    </div>
  );
}

const HISTORY_LABELS: Record<string, string> = {
  name: 'Nom',
  active: 'Active',
  polygon: 'Tracé',
  color: 'Couleur',
  maxDeliveryDistanceMeters: 'Distance maximale (m)',
  deliveryTiers: 'Paliers de frais',
  minOrderCents: 'Minimum (centimes)',
  serviceHours: 'Horaires',
  emergencyClosure: 'Fermeture d’urgence',
  center: 'Centre',
  timezone: 'Fuseau',
  multiplierBps: 'Majoration',
  flatFeeCents: 'Supplément',
  courierBonusCents: 'Bonus livreur',
  zoneIds: 'Zones',
  trigger: 'Déclenchement',
  schedule: 'Créneaux',
  demandRatio: 'Seuil de demande',
};

function HistoryTab({ city, zones }: { city: WithId<City>; zones: WithId<Zone>[] }) {
  const paths = useMemo(
    () => [`${COLLECTIONS.cities}/${city.id}`, `${COLLECTIONS.cities}/${city.id}#emergencyClosure`, ...zones.slice(0, 14).flatMap((z) => [`${COLLECTIONS.zones}/${z.id}`, `${COLLECTIONS.zones}/${z.id}#emergencyClosure`])].slice(0, 30),
    [city.id, zones.map((z) => z.id).join(',')], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const history = useSettingsHistory(paths, 40);
  return (
    <div className="grid gap-6 xl:grid-cols-3">
      <SettingsHistoryCard className="xl:col-span-2" entries={history.data} loading={history.loading} error={history.error} labels={HISTORY_LABELS} title={`Historique · ${city.name}`} />
      <Card className="h-fit">
        <CardHeader title="Traçabilité" icon={<Users />} divided />
        <CardContent className="space-y-2 text-sm text-fg-muted">
          <p>Chaque modification de ville, de zone, de fermeture ou de majoration est conservée avec son auteur et son motif.</p>
          <p className="inline-flex items-center gap-1.5"><Store className="size-3.5" /> Les commerces fixent leurs propres frais sur leurs zones de livraison.</p>
        </CardContent>
      </Card>
    </div>
  );
}
