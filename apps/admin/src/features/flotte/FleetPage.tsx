// Flotte en direct (cahier §6 « vue par zone » et §10 « carte live ») : livreurs en
// ligne, disponibles et en course sur la carte, indicateurs par zone avec alerte en
// cas de manque, commandes en attente de livreur.
import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { AlertTriangle, Bike, CircleDot, PackageSearch, Radar, Users } from 'lucide-react';
import {
  Badge,
  Card,
  CardHeader,
  EmptyState,
  MapFitBounds,
  PageContainer,
  PageHeader,
  SegmentedControl,
  StatCard,
  StatusPill,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  cn,
  formatNumber,
  formatRelative,
} from '@golink/ui';
import { COLLECTIONS, SETTINGS_DOCS, isPointInPolygon, resolveDispatchRules, type DispatchSettings, type DriverAvailability, type WithId, type Zone } from '@golink/shared';
import { useDocumentTitle } from '@golink/web';
import { useGeoScope } from '@/layout/GeoScope';
import { docAt, toDate, useDoc } from '@/lib/firestore';
import { useActiveOrders } from '../commandes/hooks';
import { useNow, useScopedCities, useScopedDrivers, useScopedLocations, useScopedZones } from '../_operations/hooks';
import { DriverDot, OpsMap, ZonePolygon, themeColor } from '../_operations/map';
import { AVAILABILITY_TONES, LoadError } from '../_operations/ui';

type Filter = 'all' | DriverAvailability;

interface ZoneLiveRow {
  zone: WithId<Zone>;
  online: number;
  available: number;
  onDelivery: number;
  paused: number;
  waiting: number;
  inProgress: number;
  ratio: number | null;
  shortage: boolean;
}

export function FleetPage() {
  useDocumentTitle('Flotte en direct · GoLink Admin');
  const geo = useGeoScope();
  const cities = useScopedCities();
  const zones = useScopedZones();
  const locations = useScopedLocations();
  const drivers = useScopedDrivers();
  const orders = useActiveOrders();
  const dispatch = useDoc<DispatchSettings>(docAt(`${COLLECTIONS.settings}/${SETTINGS_DOCS.dispatch}`));
  const now = useNow(30_000);
  const [filter, setFilter] = useState<Filter>('all');
  const [focus, setFocus] = useState<string | null>(null);
  const byId = useMemo(() => new Map(drivers.data.map((d) => [d.id, d])), [drivers.data]);

  const rows = useMemo<ZoneLiveRow[]>(() => {
    return zones.data
      .filter((z) => z.active)
      .map((zone) => {
        const inZone = locations.data.filter((l) => (l.zoneId ? l.zoneId === zone.id : zone.polygon.length >= 3 && isPointInPolygon({ lat: l.position.latitude, lng: l.position.longitude }, zone.polygon)));
        const waiting = orders.data.filter((o) => o.delivery?.zoneId === zone.id && o.delivery.deliveredBy === 'platform' && !o.driverId && ['accepted', 'preparing', 'ready'].includes(o.status)).length;
        const inProgress = orders.data.filter((o) => o.delivery?.zoneId === zone.id && o.status !== 'scheduled').length;
        const available = inZone.filter((l) => l.availability === 'online').length;
        const city = geo.cities.find((c) => c.id === zone.cityId);
        const threshold = resolveDispatchRules(dispatch.data, city?.dispatch, zone.dispatch).shortageRatioAlert;
        const ratio = waiting > 0 ? available / waiting : null;
        return {
          zone,
          online: inZone.length,
          available,
          onDelivery: inZone.filter((l) => l.availability === 'on_delivery').length,
          paused: inZone.filter((l) => l.availability === 'paused').length,
          waiting,
          inProgress,
          ratio,
          shortage: ratio !== null && ratio < threshold,
        };
      })
      .sort((a, b) => Number(b.shortage) - Number(a.shortage) || b.waiting - a.waiting || a.zone.name.localeCompare(b.zone.name, 'fr'));
  }, [zones.data, locations.data, orders.data, dispatch.data, geo.cities]);

  const totals = useMemo(() => {
    const l = locations.data;
    const waiting = orders.data.filter((o) => o.fulfillment === 'delivery' && o.delivery?.deliveredBy === 'platform' && !o.driverId && ['accepted', 'preparing', 'ready'].includes(o.status)).length;
    return {
      online: l.length,
      available: l.filter((x) => x.availability === 'online').length,
      onDelivery: l.filter((x) => x.availability === 'on_delivery').length,
      paused: l.filter((x) => x.availability === 'paused').length,
      waiting,
      shortages: rows.filter((r) => r.shortage).length,
    };
  }, [locations.data, orders.data, rows]);

  const visible = locations.data.filter((l) => filter === 'all' || l.availability === filter);
  const points = useMemo(() => {
    const zonePts = zones.data.filter((z) => z.active).flatMap((z) => z.polygon);
    return zonePts.length ? zonePts : cities.map((c) => c.center);
  }, [zones.data.map((z) => z.id).join(','), cities.map((c) => c.id).join(',')]); // eslint-disable-line react-hooks/exhaustive-deps
  const center = cities.find((c) => c.active)?.center ?? cities[0]?.center ?? { lat: 49.12, lng: 6.18 };
  const loading = locations.loading || zones.loading;

  return (
    <PageContainer wide>
      <PageHeader
        eyebrow={`Opérations · ${geo.label}`}
        title="Flotte en direct"
        description="Où sont les livreurs, qui est disponible, et quelles zones manquent de bras."
        actions={<StatusPill tone="success" pulse>En direct</StatusPill>}
      />
      <div className="mb-6 grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-5">
        <StatCard label="En ligne" value={formatNumber(totals.online)} icon={<Users />} tone="brand" loading={loading} footer={<span>{totals.paused} en pause</span>} />
        <StatCard label="Disponibles" value={formatNumber(totals.available)} icon={<CircleDot />} tone="success" loading={loading} />
        <StatCard label="En course" value={formatNumber(totals.onDelivery)} icon={<Bike />} tone="info" loading={loading} />
        <StatCard label="Commandes sans livreur" value={formatNumber(totals.waiting)} icon={<PackageSearch />} tone={totals.waiting ? 'amber' : 'neutral'} loading={orders.loading} />
        <StatCard label="Zones en manque" value={formatNumber(totals.shortages)} icon={<AlertTriangle />} tone={totals.shortages ? 'danger' : 'success'} loading={loading} footer={<span>Sous le seuil d’alerte</span>} />
      </div>

      {locations.error ? (
        <LoadError error={locations.error} />
      ) : (
        <div className="grid gap-6 xl:grid-cols-3">
          <Card className="min-w-0 overflow-hidden xl:col-span-2">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2.5">
              <SegmentedControl
                size="sm"
                aria-label="Livreurs affichés"
                value={filter}
                onValueChange={(v) => setFilter(v as Filter)}
                options={[
                  { value: 'all', label: 'Tous', count: totals.online },
                  { value: 'online', label: 'Disponibles', count: totals.available },
                  { value: 'on_delivery', label: 'En course', count: totals.onDelivery },
                  { value: 'paused', label: 'En pause', count: totals.paused },
                ]}
              />
              <div className="flex items-center gap-3 text-2xs text-fg-subtle">
                <Legend tone="success" label="Disponible" />
                <Legend tone="info" label="En course" />
                <Legend tone="amber" label="En pause" />
              </div>
            </div>
            <OpsMap center={center} zoom={11} height={560} className="rounded-none border-0">
              <MapFitBounds points={points} padding={40} maxZoom={14} />
              {zones.data
                .filter((z) => z.active)
                .map((z) => {
                  const row = rows.find((r) => r.zone.id === z.id);
                  return <ZonePolygon key={z.id} path={z.polygon} style={{ color: row?.shortage ? themeColor('danger') : z.color, fillOpacity: row?.shortage ? 0.22 : 0.08, strokeWeight: focus === z.id ? 3 : 1.5, zIndex: 1 }} onClick={() => setFocus(z.id)} />;
                })}
              {visible.map((l) => (
                <DriverDot
                  key={l.id}
                  position={{ lat: l.position.latitude, lng: l.position.longitude }}
                  tone={AVAILABILITY_TONES[l.availability]}
                  label={byId.get(l.id)?.displayName ?? 'Livreur'}
                  active={l.availability === 'on_delivery'}
                />
              ))}
            </OpsMap>
          </Card>
          <Card className="min-w-0">
            <CardHeader title="Livreurs connectés" description={`${visible.length} affiché${visible.length > 1 ? 's' : ''}`} icon={<Radar />} divided />
            {loading ? null : visible.length === 0 ? (
              <EmptyState compact icon={<Bike />} title="Aucun livreur connecté" description="Personne n’est en ligne dans ce périmètre." />
            ) : (
              <ul className="max-h-[520px] divide-y divide-border overflow-y-auto">
                {visible.map((l) => {
                  const d = byId.get(l.id);
                  const seen = toDate(l.updatedAt);
                  const stale = seen ? now - seen.getTime() > 10 * 60_000 : true;
                  return (
                    <li key={l.id}>
                      <Link to={`/livreurs/${l.id}`} className="flex items-center gap-3 px-5 py-2.5 hover:bg-surface-2">
                        <span className={cn(`tone-${AVAILABILITY_TONES[l.availability]}`, 'size-2.5 shrink-0 rounded-full bg-(--tone-solid)')} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm text-fg">{d ? `${d.firstName} ${d.lastName}` : 'Livreur'}</span>
                          <span className="block truncate text-2xs text-fg-subtle">{zones.data.find((z) => z.id === l.zoneId)?.name ?? 'Hors zone'}</span>
                        </span>
                        <span className={cn('max-w-[45%] shrink-0 truncate font-mono text-2xs', stale ? 'text-warning' : 'text-fg-subtle')}>{seen ? formatRelative(seen, now) : '—'}</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        </div>
      )}

      <Card className="mt-6">
        <CardHeader title="Vue par zone" description="Livreurs et commandes en attente par zone active ; alerte sous le seuil défini dans l’attribution des courses." divided />
        {rows.length === 0 ? (
          <EmptyState compact icon={<Radar />} title="Aucune zone active" />
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Zone</TableHead>
                <TableHead className="text-right">En ligne</TableHead>
                <TableHead className="text-right">Disponibles</TableHead>
                <TableHead className="text-right">En course</TableHead>
                <TableHead className="text-right">Commandes en cours</TableHead>
                <TableHead className="text-right">Sans livreur</TableHead>
                <TableHead className="text-right">Ratio</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.zone.id} className={cn(r.shortage && 'bg-danger-soft/40')} onMouseEnter={() => setFocus(r.zone.id)}>
                  <TableCell>
                    <Link to={`/zones/${r.zone.id}`} className="inline-flex items-center gap-2 font-medium text-fg hover:underline">
                      <span className="size-2.5 rounded-full" style={{ backgroundColor: r.zone.color }} aria-hidden />
                      {r.zone.name}
                    </Link>
                    <span className="ml-2 inline-flex gap-1">
                      {r.shortage && <Badge size="sm" tone="danger" icon={<AlertTriangle />}>Manque</Badge>}
                      {r.zone.emergencyClosure?.active && <Badge size="sm" tone="danger">Fermée</Badge>}
                    </span>
                  </TableCell>
                  <TableCell className="text-right font-mono num">{r.online}</TableCell>
                  <TableCell className="text-right font-mono text-success num">{r.available}</TableCell>
                  <TableCell className="text-right font-mono num">{r.onDelivery}</TableCell>
                  <TableCell className="text-right font-mono num">{r.inProgress}</TableCell>
                  <TableCell className={cn('text-right font-mono num', r.waiting && 'text-warning')}>{r.waiting}</TableCell>
                  <TableCell className={cn('text-right font-mono num', r.shortage && 'text-danger')}>{r.ratio === null ? '—' : r.ratio.toLocaleString('fr-FR', { maximumFractionDigits: 2 })}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
    </PageContainer>
  );
}

function Legend({ tone, label }: { tone: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`tone-${tone} size-2 rounded-full bg-(--tone-solid)`} />
      {label}
    </span>
  );
}
