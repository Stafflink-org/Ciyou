// Zones d'une ville : carte (polygones modifiables, tracé au clic), liste et éditeur
// (distance maximale, minimum, tarifs par distance, horaires propres), fermeture d'urgence.
import { useEffect, useMemo, useState } from 'react';
import { CloudLightning, Pencil, PencilOff, Plus, Radio, Save, Trash2, Undo2, Users, X, Zap } from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  ConfirmDialog,
  EmptyState,
  FormField,
  IconButton,
  Input,
  MapFitBounds,
  Switch,
  cn,
  formatEUR,
} from '@golink/ui';
import { EMERGENCY_REASON_LABELS, isPointInPolygon, type City, type DeliveryFeeTier, type LatLng, type SaveZoneInput, type WeeklyHours, type WithId, type Zone } from '@golink/shared';
import { useMutation } from '@/lib/firestore';
import { fn } from '../_operations/functions';
import { hoursIssues, WeeklyHoursEditor } from '../_operations/hours';
import { EuroInput, KmInput } from '../_operations/inputs';
import { MapClickCapture, OpsMap, VertexMarker, ZonePolygon, themeColor } from '../_operations/map';
import { formatMeters } from '../_operations/ui';
import { ClosureDialog } from './dialogs';

export const ZONE_COLORS = ['#e8784b', '#4a7fbb', '#4a846c', '#9467a5', '#e09b24', '#31968b', '#d6533f', '#648f92'];

type Draft = Omit<SaveZoneInput, 'cityId'>;

function toDraft(z: WithId<Zone>): Draft {
  return {
    zoneId: z.id,
    name: z.name,
    color: z.color,
    active: z.active,
    polygon: z.polygon,
    maxDeliveryDistanceMeters: z.maxDeliveryDistanceMeters,
    deliveryTiers: z.deliveryTiers ?? null,
    minOrderCents: z.minOrderCents ?? null,
    serviceHours: z.serviceHours ?? null,
  };
}

/** Aire approximative d'un polygone (km²), pour l'affichage. */
function areaKm2(polygon: LatLng[]): number {
  if (polygon.length < 3) return 0;
  const lat0 = (polygon.reduce((s, p) => s + p.lat, 0) / polygon.length) * (Math.PI / 180);
  const pts = polygon.map((p) => ({ x: p.lng * 111.32 * Math.cos(lat0), y: p.lat * 110.57 }));
  let sum = 0;
  for (let i = 0; i < pts.length; i += 1) {
    const a = pts[i]!;
    const b = pts[(i + 1) % pts.length]!;
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) / 2;
}

export function ZonesTab({ city, zones, initialZoneId }: { city: WithId<City>; zones: WithId<Zone>[]; initialZoneId: string | null }) {
  const [selectedId, setSelectedId] = useState<string | null>(initialZoneId);
  const [mode, setMode] = useState<'view' | 'edit' | 'draw'>('view');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [closing, setClosing] = useState(false);
  const [reopening, setReopening] = useState(false);
  const [confirmSave, setConfirmSave] = useState(false);
  const selected = zones.find((z) => z.id === selectedId) ?? null;

  useEffect(() => {
    if (initialZoneId) setSelectedId(initialZoneId);
  }, [initialZoneId]);
  useEffect(() => {
    if (mode === 'draw') return;
    setDraft(selected ? toDraft(selected) : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.id, selected?.updatedAt?.toMillis?.()]);

  const save = useMutation(fn.saveZone, { success: 'Zone enregistrée' });
  const reopen = useMutation(fn.closeZone, { success: 'Zone rouverte' });
  const fitPoints = useMemo(() => (zones.length ? zones.flatMap((z) => z.polygon) : [city.center]), [zones.map((z) => z.id).join(','), city.id]); // eslint-disable-line react-hooks/exhaustive-deps

  function startDraw() {
    setSelectedId(null);
    setMode('draw');
    setDraft({ zoneId: null, name: '', color: ZONE_COLORS[zones.length % ZONE_COLORS.length]!, active: false, polygon: [], maxDeliveryDistanceMeters: 6000, deliveryTiers: [{ upToMeters: 2000, feeCents: 199 }, { upToMeters: 4000, feeCents: 299 }, { upToMeters: 6000, feeCents: 399 }], minOrderCents: null, serviceHours: null });
  }
  function cancel() {
    setMode('view');
    setDraft(selected ? toDraft(selected) : null);
  }
  const dirty = Boolean(draft && (mode === 'draw' || (selected && JSON.stringify(draft) !== JSON.stringify(toDraft(selected)))));
  const hoursErrors = draft?.serviceHours ? hoursIssues(draft.serviceHours) : [];
  const tiersInvalid = Boolean(draft?.deliveryTiers?.some((t, i, arr) => i > 0 && t.upToMeters <= arr[i - 1]!.upToMeters));
  const valid = Boolean(draft && draft.name.trim().length >= 2 && draft.polygon.length >= 3 && hoursErrors.length === 0 && !tiersInvalid);

  async function persist(reason: string | null) {
    if (!draft) return;
    const result = await save.mutate({ ...draft, cityId: city.id, name: draft.name.trim(), reason });
    if (result) {
      setMode('view');
      setSelectedId(result.zoneId);
    }
  }

  return (
    <div className="grid gap-6 xl:grid-cols-3">
      <Card className="min-w-0 overflow-hidden xl:col-span-2">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2.5">
          <p className="text-sm text-fg-muted">
            {mode === 'draw'
              ? draft && draft.polygon.length < 3
                ? `Cliquez sur la carte pour placer les sommets (${draft.polygon.length}/3 minimum).`
                : 'Tracé en cours : ajustez les sommets, puis enregistrez.'
              : mode === 'edit'
                ? 'Déplacez les sommets ; cliquez sur un sommet pour le supprimer.'
                : `${zones.length} zone${zones.length > 1 ? 's' : ''} · cliquez sur une zone pour l’ouvrir.`}
          </p>
          {mode === 'draw' && draft && draft.polygon.length > 0 && (
            <Button size="xs" variant="ghost" leftIcon={<Undo2 />} onClick={() => setDraft({ ...draft, polygon: draft.polygon.slice(0, -1) })}>
              Retirer le dernier point
            </Button>
          )}
        </div>
        <OpsMap center={city.center} zoom={12} height={560} className="rounded-none border-0">
          <MapFitBounds points={fitPoints} padding={40} />
          {zones.map((z) => {
            const isSelected = z.id === selectedId;
            const path = isSelected && draft && mode === 'edit' ? draft.polygon : z.polygon;
            return (
              <ZonePolygon
                key={z.id}
                path={path}
                style={{ color: z.emergencyClosure?.active ? themeColor('danger') : isSelected && draft ? draft.color : z.color, fillOpacity: isSelected ? 0.28 : z.active ? 0.14 : 0.05, strokeWeight: isSelected ? 3 : 2, dashed: !z.active, zIndex: isSelected ? 5 : 1 }}
                editable={isSelected && mode === 'edit'}
                onPathChange={(p) => draft && setDraft({ ...draft, polygon: p })}
                onClick={() => mode === 'view' && setSelectedId(z.id)}
              />
            );
          })}
          {mode === 'draw' && draft && (
            <>
              <MapClickCapture enabled onClick={(p) => setDraft((d) => (d ? { ...d, polygon: [...d.polygon, p] } : d))} />
              {draft.polygon.length >= 3 && <ZonePolygon path={draft.polygon} style={{ color: draft.color, fillOpacity: 0.25, strokeWeight: 3, zIndex: 6 }} editable onPathChange={(p) => setDraft({ ...draft, polygon: p })} />}
              {draft.polygon.length < 3 && draft.polygon.map((p, i) => <VertexMarker key={i} position={p} index={i} />)}
            </>
          )}
        </OpsMap>
      </Card>

      <div className="min-w-0 space-y-4">
        {!draft ? (
          <>
            <Button variant="primary" block leftIcon={<Plus />} onClick={startDraw}>
              Dessiner une nouvelle zone
            </Button>
            {zones.length === 0 ? (
              <Card>
                <EmptyState icon={<Radio />} title="Aucune zone" description="Dessinez la première zone de livraison de cette ville." />
              </Card>
            ) : (
              <ul className="space-y-2">
                {zones.map((z) => (
                  <li key={z.id}>
                    <ZoneCard zone={z} onOpen={() => setSelectedId(z.id)} center={city.center} />
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : (
          <Card>
            <CardHeader
              title={mode === 'draw' ? 'Nouvelle zone' : draft.name || 'Zone'}
              description={draft.polygon.length >= 3 ? `${draft.polygon.length} sommets · ${areaKm2(draft.polygon).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} km²` : 'Tracé à compléter'}
              actions={
                <IconButton label="Fermer" variant="ghost" onClick={() => (mode === 'view' ? setSelectedId(null) : mode === 'draw' ? (setMode('view'), setDraft(null)) : cancel())}>
                  <X />
                </IconButton>
              }
              divided
            />
            <CardContent className="space-y-4">
              {selected?.emergencyClosure?.active && (
                <div className="tone-danger rounded-lg bg-(--tone-bg) px-3 py-2.5 text-sm text-(--tone-fg)">
                  <p className="font-medium">Fermée · {EMERGENCY_REASON_LABELS[selected.emergencyClosure.reason]}</p>
                  <p className="text-xs opacity-90">« {selected.emergencyClosure.message.fr} »</p>
                  <Button size="xs" variant="secondary" className="mt-2" onClick={() => setReopening(true)}>
                    Rouvrir la zone
                  </Button>
                </div>
              )}
              {selected?.currentSurge && selected.currentSurge.until.toMillis() > Date.now() && (
                <Badge tone="amber" icon={<Zap />}>Majoration ×{(selected.currentSurge.multiplierBps / 10_000).toLocaleString('fr-FR')} en cours</Badge>
              )}
              <FormField label="Nom">
                <Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} maxLength={60} placeholder="Ex. Metz Centre" />
              </FormField>
              <FormField label="Couleur">
                <div className="flex flex-wrap gap-2">
                  {ZONE_COLORS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      aria-label={`Couleur ${c}`}
                      aria-pressed={draft.color === c}
                      onClick={() => setDraft({ ...draft, color: c })}
                      className={cn('size-7 rounded-full border-2 transition-transform hover:scale-110', draft.color === c ? 'border-fg' : 'border-transparent')}
                      style={{ backgroundColor: c }}
                    />
                  ))}
                </div>
              </FormField>
              <Switch checked={draft.active} onCheckedChange={(v) => setDraft({ ...draft, active: v })} label="Zone active" description="Les clients de la zone peuvent commander en livraison." />
              <div className="grid grid-cols-2 gap-3">
                <FormField label="Distance maximale">
                  <KmInput value={draft.maxDeliveryDistanceMeters} onChange={(v) => v !== null && setDraft({ ...draft, maxDeliveryDistanceMeters: v })} />
                </FormField>
                <FormField label="Minimum de commande" hint="Vide : celui du commerce.">
                  <EuroInput value={draft.minOrderCents ?? null} onChange={(v) => setDraft({ ...draft, minOrderCents: v })} />
                </FormField>
              </div>
              <TiersEditor tiers={draft.deliveryTiers ?? []} onChange={(t) => setDraft({ ...draft, deliveryTiers: t.length ? t : null })} invalid={tiersInvalid} />
              <div className="space-y-2">
                <Switch
                  checked={Boolean(draft.serviceHours)}
                  onCheckedChange={(v) => setDraft({ ...draft, serviceHours: v ? (JSON.parse(JSON.stringify(city.serviceHours)) as WeeklyHours) : null })}
                  label="Horaires propres à la zone"
                  description="Sinon, horaires de service de la ville."
                />
                {draft.serviceHours && <WeeklyHoursEditor value={draft.serviceHours} onChange={(h) => setDraft({ ...draft, serviceHours: h })} />}
              </div>
              <div className="flex flex-col gap-2 border-t border-border pt-4">
                {mode !== 'draw' && (
                  <Button variant="secondary" leftIcon={mode === 'edit' ? <PencilOff /> : <Pencil />} onClick={() => setMode(mode === 'edit' ? 'view' : 'edit')}>
                    {mode === 'edit' ? 'Terminer le tracé' : 'Modifier le tracé'}
                  </Button>
                )}
                {selected && !selected.emergencyClosure?.active && (
                  <Button variant="danger-soft" leftIcon={<CloudLightning />} onClick={() => setClosing(true)}>
                    Fermeture d’urgence
                  </Button>
                )}
                <div className="flex gap-2">
                  {dirty && (
                    <Button variant="ghost" leftIcon={<Trash2 />} onClick={mode === 'draw' ? () => (setMode('view'), setDraft(null)) : cancel} className="flex-1">
                      {mode === 'draw' ? 'Abandonner' : 'Annuler'}
                    </Button>
                  )}
                  <Button variant="primary" leftIcon={<Save />} disabled={!dirty || !valid} loading={save.loading} className="flex-1" onClick={() => (mode === 'draw' ? void persist('Création de la zone') : setConfirmSave(true))}>
                    Enregistrer
                  </Button>
                </div>
                {hoursErrors[0] && <p className="text-xs text-danger">{hoursErrors[0]}</p>}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
      {selected && <ClosureDialog open={closing} onOpenChange={setClosing} scope="zone" id={selected.id} name={selected.name} />}
      <ConfirmDialog
        open={reopening}
        onOpenChange={setReopening}
        title="Rouvrir la zone"
        description="Les clients de la zone peuvent de nouveau commander en livraison."
        requireReason
        confirmLabel="Rouvrir"
        onConfirm={async (reason) => {
          if (selected) await reopen.mutate({ scope: 'zone', id: selected.id, close: false, note: reason ?? '' });
        }}
      />
      <ConfirmDialog
        open={confirmSave}
        onOpenChange={setConfirmSave}
        title="Enregistrer la zone"
        description="Les changements de tracé et de tarifs s’appliquent aux prochaines commandes."
        requireReason
        confirmLabel="Enregistrer"
        onConfirm={async (reason) => {
          await persist(reason ?? null);
        }}
      />
    </div>
  );
}

function ZoneCard({ zone, onOpen, center }: { zone: WithId<Zone>; onOpen: () => void; center: LatLng }) {
  const live = zone.live;
  const fresh = live && Date.now() - live.updatedAt.toMillis() < 30 * 60_000;
  const ratio = live && live.ordersWaiting > 0 ? live.driversAvailable / live.ordersWaiting : null;
  const containsCenter = zone.polygon.length >= 3 && isPointInPolygon(center, zone.polygon);
  return (
    <Card interactive className="p-3.5" onClick={onOpen} role="button" tabIndex={0} onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onOpen()}>
      <div className="flex items-start gap-3">
        <span className="mt-1 size-3 shrink-0 rounded-full" style={{ backgroundColor: zone.color }} aria-hidden />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <p className="truncate font-medium text-fg">{zone.name}</p>
            {!zone.active && <Badge size="sm" tone="neutral" variant="outline">Inactive</Badge>}
            {zone.emergencyClosure?.active && <Badge size="sm" tone="danger">Fermée</Badge>}
            {zone.currentSurge && zone.currentSurge.until.toMillis() > Date.now() && <Badge size="sm" tone="amber" icon={<Zap />}>Pointe</Badge>}
            {containsCenter && <Badge size="sm" tone="neutral">Centre-ville</Badge>}
          </div>
          <p className="mt-0.5 text-xs text-fg-subtle">
            Jusqu’à {formatMeters(zone.maxDeliveryDistanceMeters)}
            {zone.minOrderCents ? ` · minimum ${formatEUR(zone.minOrderCents, { cents: true })}` : ''}
            {zone.deliveryTiers?.length ? ` · ${zone.deliveryTiers.length} palier${zone.deliveryTiers.length > 1 ? 's' : ''}` : ''}
          </p>
          {fresh && live && (
            <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
              <span className="inline-flex items-center gap-1 text-fg-muted"><Users className="size-3" />{live.driversOnline} en ligne</span>
              <span className="text-success">{live.driversAvailable} dispo.</span>
              <span className={cn(ratio !== null && ratio < 0.6 ? 'text-danger' : 'text-fg-muted')}>{live.ordersWaiting} en attente</span>
            </p>
          )}
        </div>
      </div>
    </Card>
  );
}

function TiersEditor({ tiers, onChange, invalid }: { tiers: DeliveryFeeTier[]; onChange: (tiers: DeliveryFeeTier[]) => void; invalid: boolean }) {
  return (
    <fieldset className="space-y-1.5">
      <legend className="text-sm font-medium text-fg">Frais de livraison par distance</legend>
      <div className="space-y-2">
        {tiers.map((t, i) => (
          <div key={i} className="grid grid-cols-[1fr_1fr_auto] items-center gap-2">
            <KmInput value={t.upToMeters} onChange={(v) => v !== null && onChange(tiers.map((x, j) => (j === i ? { ...x, upToMeters: v } : x)))} aria-label="Jusqu’à" />
            <EuroInput value={t.feeCents} onChange={(v) => v !== null && onChange(tiers.map((x, j) => (j === i ? { ...x, feeCents: v } : x)))} aria-label="Frais" />
            <IconButton label="Supprimer le palier" variant="ghost" size="sm" onClick={() => onChange(tiers.filter((_, j) => j !== i))}>
              <X />
            </IconButton>
          </div>
        ))}
        {tiers.length < 8 && (
          <Button size="xs" variant="ghost" leftIcon={<Plus />} onClick={() => onChange([...tiers, { upToMeters: (tiers.at(-1)?.upToMeters ?? 0) + 2000, feeCents: (tiers.at(-1)?.feeCents ?? 199) + 100 }])}>
            Ajouter un palier
          </Button>
        )}
      </div>
      <p className={cn('text-xs', invalid ? 'text-danger' : 'text-fg-subtle')}>
        {invalid ? 'Les distances doivent être croissantes.' : 'Tarif par défaut pour les commerces sans zone propre ; chaque commerce fixe ses frais sur ses zones.'}
      </p>
    </fieldset>
  );
}
