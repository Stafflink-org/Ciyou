import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { collection, orderBy, query, where } from 'firebase/firestore';
import { Bike, Eye, EyeOff, Info, MapPinned, Pencil, Plus, Trash2 } from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  IconButton,
  PageContainer,
  PageHeader,
  Skeleton,
  Switch,
  formatEUR,
  toast,
} from '@golink/ui';
import { COLLECTIONS, formatDistance, paths, type LatLng, type RestaurantDeliveryZone, type Zone } from '@golink/shared';
import { useRestaurantAccess } from '@/auth/RestaurantAccess';
import { db } from '@/lib/firebase';
import { errorMessage, useCollection, useMutation } from '@/lib/firestore';
import { deleteDeliveryZone, saveDeliveryZone } from '../parametres/kit/api';
import { useConfigLimits } from '../parametres/kit/hooks';
import { CircleShape, ConfigMap, MapClickCapture, MapFitBounds, PolygonShape, RestaurantPin, useMapsAvailable, themeColor, useMapsAuthFailed } from '../parametres/kit/map';
import { LoadError, Notice } from '../parametres/kit/ui';
import { ZoneEditor, type ZoneDraft, ZONE_COLORS, circlePolygon } from './ZoneEditor';

type StoredZone = RestaurantDeliveryZone & { id: string };

function zoneToDraft(zone: StoredZone): ZoneDraft {
  return {
    id: zone.id,
    name: zone.name,
    type: zone.type,
    radiusMeters: zone.radiusMeters ?? 2000,
    polygon: zone.polygon ?? [],
    feeCents: zone.feeCents,
    minOrderCents: zone.minOrderCents ?? null,
    freeAboveCents: zone.freeAboveCents ?? null,
    deliveryMinutes: zone.deliveryMinutes ?? null,
    enabled: zone.enabled,
    color: zone.color,
    order: zone.order,
  };
}

/**
 * Zones de livraison du commerce : rayon ou tracé libre sur la carte, frais, minimum
 * et délai par zone. Elles s'appliquent à toutes les livraisons (livreurs GoLink ou
 * livreurs du commerce) ; hors zone active, l'adresse n'est pas livrée.
 */
export function ZonesPage() {
  const { restaurant, restaurantId } = useRestaurantAccess();
  const limits = useConfigLimits();
  const zones = useCollection<RestaurantDeliveryZone>(query(collection(db, `${paths.restaurant(restaurantId)}/deliveryZones`), orderBy('order')));
  const cityZones = useCollection<Zone>(query(collection(db, COLLECTIONS.zones), where('cityId', '==', restaurant.cityId)));
  const [editing, setEditing] = useState<ZoneDraft | null>(null);
  const [showPlatform, setShowPlatform] = useState(true);
  const mapFailed = useMapsAuthFailed();
  const mapsAvailable = useMapsAvailable();
  const [removing, setRemoving] = useState<StoredZone | null>(null);
  const save = useMutation(saveDeliveryZone);
  const toggle = useMutation(saveDeliveryZone);

  const center: LatLng | null = restaurant.address.geo ? { lat: restaurant.address.geo.latitude, lng: restaurant.address.geo.longitude } : null;
  const list = zones.data as StoredZone[];
  const ownDrivers = restaurant.deliveredBy !== 'platform';
  const activeCount = list.filter((z) => z.enabled).length;
  const maxRadius = limits.maxRadiusMeters;

  const fitPoints = useMemo(() => {
    if (!center) return [];
    const points: LatLng[] = [center];
    const source = editing ? [editing] : list.filter((z) => z.enabled).map(zoneToDraft);
    for (const z of source) {
      if (z.type === 'radius') points.push(...circlePolygon(center, z.radiusMeters, 8));
      else points.push(...z.polygon);
    }
    if (points.length === 1) points.push(...circlePolygon(center, Math.min(3000, maxRadius), 8));
    return points;
  }, [center, editing, list, maxRadius]);

  const startCreate = () => {
    const used = new Set(list.map((z) => z.color));
    setEditing({
      name: list.length === 0 ? 'Centre et proximité' : `Zone ${list.length + 1}`,
      type: 'radius',
      radiusMeters: Math.min(2500, maxRadius),
      polygon: [],
      feeCents: 250,
      minOrderCents: null,
      freeAboveCents: null,
      deliveryMinutes: 15,
      enabled: true,
      color: ZONE_COLORS.find((c) => !used.has(c)) ?? ZONE_COLORS[0]!,
      order: list.length,
    });
  };

  const submit = async (draft: ZoneDraft) => {
    const result = await save.mutate({
      restaurantId,
      ...(draft.id ? { zoneId: draft.id } : {}),
      name: draft.name.trim(),
      type: draft.type,
      radiusMeters: draft.type === 'radius' ? draft.radiusMeters : null,
      polygon: draft.type === 'polygon' ? draft.polygon : null,
      feeCents: draft.feeCents,
      minOrderCents: draft.minOrderCents,
      freeAboveCents: draft.freeAboveCents,
      deliveryMinutes: draft.deliveryMinutes,
      enabled: draft.enabled,
      color: draft.color,
      order: draft.order,
    });
    if (result) {
      toast.success(draft.id ? 'Zone mise à jour.' : 'Zone de livraison créée.');
      setEditing(null);
    }
  };

  const setEnabled = async (zone: StoredZone, enabled: boolean) => {
    const d = zoneToDraft(zone);
    const result = await toggle.mutate({
      restaurantId,
      zoneId: zone.id,
      name: d.name,
      type: d.type,
      radiusMeters: d.type === 'radius' ? d.radiusMeters : null,
      polygon: d.type === 'polygon' ? d.polygon : null,
      feeCents: d.feeCents,
      minOrderCents: d.minOrderCents,
      freeAboveCents: d.freeAboveCents,
      deliveryMinutes: d.deliveryMinutes,
      enabled,
      color: d.color,
    });
    if (result) toast.success(enabled ? `« ${zone.name} » activée.` : `« ${zone.name} » mise en pause.`);
  };

  const confirmDelete = async () => {
    if (!removing) return;
    try {
      await deleteDeliveryZone({ restaurantId, zoneId: removing.id });
      toast.success('Zone supprimée. Elle reste récupérable 30 jours auprès du support.');
    } catch (error) {
      toast.error(errorMessage(error));
      throw error;
    }
  };

  const addVertex = (point: LatLng) => setEditing((e) => (e && e.type === 'polygon' ? { ...e, polygon: [...e.polygon, point] } : e));

  return (
    <PageContainer wide>
      <PageHeader
        eyebrow="Configuration"
        title="Zones de livraison"
        description="Dessinez les secteurs que vous livrez et fixez, pour chacun, vos frais de livraison, votre minimum de commande et votre délai."
        actions={
          !editing && (
            <Button variant="primary" leftIcon={<Plus />} onClick={startCreate} disabled={!center}>
              Nouvelle zone
            </Button>
          )
        }
      />

      <div className="mb-6 space-y-3">
        {!center && (
          <Notice tone="danger" title="Adresse non localisée" action={<Button asChild size="sm" variant="secondary"><Link to="/etablissement?onglet=adresse">Localiser</Link></Button>}>
            Placez d’abord votre établissement sur la carte : les zones sont calculées autour de lui.
          </Notice>
        )}
        <Notice
          tone="info"
          icon={<Bike />}
          title={ownDrivers ? 'Vos zones s’appliquent à toutes vos livraisons' : 'Vos zones s’appliquent aussi aux livraisons GoLink'}
          action={
            <Button asChild size="sm" variant="secondary">
              <Link to="/reglages-commandes">Qui livre ?</Link>
            </Button>
          }
        >
          {activeCount > 0
            ? 'Frais et minimum de la zone sont appliqués au client, que la course soit assurée par un livreur GoLink ou par vos livreurs. Une adresse hors de vos zones actives ne peut pas être livrée.'
            : 'Sans zone active, la grille de frais par défaut de GoLink s’applique. Créez vos zones pour fixer vous-même frais et minimum.'}
        </Notice>
        <p className="flex items-center gap-1.5 text-xs text-fg-subtle">
          <Info className="size-3.5" />
          Rayon maximal autorisé pour votre établissement (formule {limits.plan.name}) : {formatDistance(maxRadius)}.
          {limits.zoneBounds.maxFeeCents != null && ` Frais de livraison plafonnés à ${formatEUR(limits.zoneBounds.maxFeeCents, { cents: true })}.`}
        </p>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.35fr)_minmax(360px,1fr)]">
        <div className="min-w-0 space-y-3 xl:sticky xl:top-20 xl:self-start">
          {center ? (
            <div className="relative">
              <ConfigMap center={center} zoom={13} height={!mapsAvailable || mapFailed ? '240px' : 'min(62vh, 560px)'}>
                <MapFitBounds points={fitPoints} />
                {showPlatform &&
                  cityZones.data
                    .filter((z) => z.active)
                    .map((z) => (
                      <PolygonShape key={`p-${z.id}`} path={z.polygon} style={{ color: themeColor('fg-subtle'), fillOpacity: 0.03, strokeWeight: 1, dashed: true, zIndex: 0 }} />
                    ))}
                <CircleShape center={center} radius={maxRadius} style={{ color: themeColor('primary'), fillOpacity: 0, strokeWeight: 1, dashed: true, zIndex: 0 }} />
                {list
                  .filter((z) => !editing || z.id !== editing.id)
                  .filter((z) => z.enabled || editing === null)
                  .map((z) =>
                    z.type === 'radius' ? (
                      <CircleShape
                        key={z.id}
                        center={center}
                        radius={z.radiusMeters ?? 0}
                        style={{ color: z.color, fillOpacity: z.enabled ? 0.12 : 0.03, zIndex: 2, dashed: !z.enabled }}
                        onClick={() => !editing && setEditing(zoneToDraft(z))}
                      />
                    ) : (
                      <PolygonShape
                        key={z.id}
                        path={z.polygon ?? []}
                        style={{ color: z.color, fillOpacity: z.enabled ? 0.12 : 0.03, zIndex: 2, dashed: !z.enabled }}
                        onClick={() => !editing && setEditing(zoneToDraft(z))}
                      />
                    ),
                  )}
                {editing &&
                  (editing.type === 'radius' ? (
                    <CircleShape
                      key="editing-circle"
                      center={center}
                      radius={editing.radiusMeters}
                      editable
                      style={{ color: editing.color, fillOpacity: 0.2, strokeWeight: 3, zIndex: 5 }}
                      onRadiusChange={(meters) => setEditing((e) => (e ? { ...e, radiusMeters: Math.max(300, Math.min(maxRadius, meters)) } : e))}
                    />
                  ) : (
                    editing.polygon.length > 0 && (
                      <PolygonShape
                        key="editing-polygon"
                        path={editing.polygon}
                        editable
                        style={{ color: editing.color, fillOpacity: 0.2, strokeWeight: 3, zIndex: 5 }}
                        onPathChange={(polygon) => setEditing((e) => (e ? { ...e, polygon } : e))}
                      />
                    )
                  ))}
                <MapClickCapture enabled={Boolean(editing && editing.type === 'polygon')} onClick={addVertex} />
                <RestaurantPin position={center} label={restaurant.name} />
              </ConfigMap>
              {!mapFailed && mapsAvailable && (
              <button
                type="button"
                onClick={() => setShowPlatform((v) => !v)}
                className="absolute left-3 top-3 inline-flex items-center gap-1.5 rounded-lg border border-border bg-elevated px-2.5 py-1.5 text-xs font-medium text-fg shadow-md hover:bg-surface-2"
              >
                {showPlatform ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                {showPlatform ? 'Masquer les zones GoLink' : 'Afficher les zones GoLink'}
              </button>
              )}
            </div>
          ) : (
            <Card className="grid h-80 place-items-center">
              <EmptyState compact icon={<MapPinned />} title="Carte indisponible" description="Localisez votre établissement pour dessiner vos zones." />
            </Card>
          )}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-fg-subtle">
            {mapsAvailable && !mapFailed && (
              <span className="inline-flex items-center gap-1.5">
                <span className="h-0 w-5 border-t-2 border-dashed border-primary" /> Rayon maximal de votre formule
              </span>
            )}
            {showPlatform && mapsAvailable && !mapFailed && (
              <span className="inline-flex items-center gap-1.5">
                <span className="h-0 w-5 border-t border-dashed border-fg-subtle" /> Zones desservies par GoLink
              </span>
            )}
            {(!mapsAvailable || mapFailed) && <span>Carte indisponible : le tracé libre est désactivé, les zones en rayon restent modifiables.</span>}
          </div>
        </div>

        <div className="min-w-0">
          {editing && center ? (
            <ZoneEditor
              draft={editing}
              maxRadius={maxRadius}
              bounds={limits.zoneBounds}
              center={center}
              saving={save.loading}
              onChange={(patch) => setEditing((e) => (e ? { ...e, ...patch } : e))}
              onCancel={() => setEditing(null)}
              onSubmit={() => void submit(editing)}
            />
          ) : zones.error ? (
            <LoadError message={errorMessage(zones.error)} />
          ) : zones.loading ? (
            <div className="space-y-3">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-28 rounded-xl" />
              ))}
            </div>
          ) : list.length === 0 ? (
            <Card>
              <EmptyState
                icon={<MapPinned />}
                title="Aucune zone de livraison"
                description="Créez une première zone autour de votre établissement : un rayon suffit pour commencer."
                action={
                  <Button variant="primary" leftIcon={<Plus />} onClick={startCreate} disabled={!center}>
                    Créer une zone
                  </Button>
                }
              />
            </Card>
          ) : (
            <ul className="space-y-3">
              {list.map((zone) => (
                <li key={zone.id}>
                  <Card className="p-4">
                    <div className="flex items-start gap-3">
                      <span className="mt-1 size-3 shrink-0 rounded-full ring-4 ring-surface-3" style={{ backgroundColor: zone.color }} />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="truncate font-medium text-fg">{zone.name}</p>
                          <Badge size="sm">{zone.type === 'radius' ? `Rayon ${formatDistance(zone.radiusMeters ?? 0)}` : `Tracé libre · ${zone.polygon?.length ?? 0} points`}</Badge>
                          {!zone.enabled && (
                            <Badge size="sm" tone="amber">
                              En pause
                            </Badge>
                          )}
                        </div>
                        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-xs sm:grid-cols-4">
                          <div>
                            <dt className="text-fg-subtle">Frais</dt>
                            <dd className="font-mono text-sm text-fg num">{zone.feeCents === 0 ? 'Offerts' : formatEUR(zone.feeCents, { cents: true })}</dd>
                          </div>
                          <div>
                            <dt className="text-fg-subtle">Minimum</dt>
                            <dd className="font-mono text-sm text-fg num">{zone.minOrderCents ? formatEUR(zone.minOrderCents, { cents: true }) : '—'}</dd>
                          </div>
                          <div>
                            <dt className="text-fg-subtle">Délai</dt>
                            <dd className="font-mono text-sm text-fg num">{zone.deliveryMinutes ? `+${zone.deliveryMinutes} min` : '—'}</dd>
                          </div>
                          <div>
                            <dt className="text-fg-subtle">Offerts dès</dt>
                            <dd className="font-mono text-sm text-fg num">{zone.freeAboveCents ? formatEUR(zone.freeAboveCents, { cents: true }) : '—'}</dd>
                          </div>
                        </dl>
                      </div>
                      <Switch
                        checked={zone.enabled}
                        disabled={toggle.loading}
                        aria-label={zone.enabled ? `Mettre en pause ${zone.name}` : `Activer ${zone.name}`}
                        onCheckedChange={(v) => void setEnabled(zone, v)}
                      />
                    </div>
                    <div className="mt-3 flex justify-end gap-1 border-t border-border pt-3">
                      <Button variant="ghost" size="xs" leftIcon={<Pencil />} onClick={() => setEditing(zoneToDraft(zone))}>
                        Modifier
                      </Button>
                      <IconButton label={`Supprimer ${zone.name}`} variant="danger" size="sm" onClick={() => setRemoving(zone)}>
                        <Trash2 />
                      </IconButton>
                    </div>
                  </Card>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => !open && setRemoving(null)}
        title={`Supprimer « ${removing?.name ?? ''} » ?`}
        description="Les adresses de ce secteur ne seront plus livrées, sauf si une autre zone active les couvre."
        confirmLabel="Supprimer la zone"
        destructive
        onConfirm={confirmDelete}
      />
    </PageContainer>
  );
}
