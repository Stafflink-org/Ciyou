import { CircleDot, Eraser, Hexagon, MousePointerClick, Undo2 } from 'lucide-react';
import { Button, Card, FormField, Input, SegmentedControl, Slider, Switch, cn, formatEUR } from '@golink/ui';
import { formatDistance, haversineMeters, type LatLng, type MerchantDeliveryBounds } from '@golink/shared';
import { IntegerInput, MoneyInput } from '../parametres/kit/inputs';
import { Notice } from '../parametres/kit/ui';
import { useMapsAvailable, useMapsAuthFailed } from '../parametres/kit/map';

/** Couleurs proposées pour les zones (valeurs enregistrées avec la zone, reprises sur la carte). */
export const ZONE_COLORS = ['#4a846c', '#e09b24', '#e8784b', '#4a7fbb', '#9467a5', '#31968b'] as const;
const COLOR_NAMES: Record<string, string> = {
  '#4a846c': 'Sauge',
  '#e09b24': 'Ambre',
  '#e8784b': 'Orange',
  '#4a7fbb': 'Azur',
  '#9467a5': 'Prune',
  '#31968b': 'Sarcelle',
};

export interface ZoneDraft {
  id?: string;
  name: string;
  type: 'radius' | 'polygon';
  radiusMeters: number;
  polygon: LatLng[];
  feeCents: number;
  minOrderCents: number | null;
  freeAboveCents: number | null;
  deliveryMinutes: number | null;
  enabled: boolean;
  color: string;
  order: number;
}

/** Approximation d'un cercle en polygone (point de départ d'un tracé libre, cadrage de la carte). */
export function circlePolygon(center: LatLng, radiusMeters: number, points = 12): LatLng[] {
  const R = 6_371_000;
  const lat = (center.lat * Math.PI) / 180;
  return Array.from({ length: points }, (_, i) => {
    const angle = (2 * Math.PI * i) / points;
    const dLat = (radiusMeters * Math.cos(angle)) / R;
    const dLng = (radiusMeters * Math.sin(angle)) / (R * Math.cos(lat));
    return { lat: Number((center.lat + (dLat * 180) / Math.PI).toFixed(6)), lng: Number((center.lng + (dLng * 180) / Math.PI).toFixed(6)) };
  });
}

/** Édition d'une zone : forme, tarification, délai, couleur. La carte réagit en direct. */
export function ZoneEditor({
  draft,
  maxRadius,
  bounds,
  center,
  saving,
  onChange,
  onCancel,
  onSubmit,
}: {
  draft: ZoneDraft;
  maxRadius: number;
  /** Bornes de la plateforme sur les frais et le minimum. */
  bounds: MerchantDeliveryBounds;
  center: LatLng;
  saving: boolean;
  onChange: (patch: Partial<ZoneDraft>) => void;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  const mapFailed = useMapsAuthFailed();
  const mapsAvailable = useMapsAvailable();
  const mapReady = mapsAvailable && !mapFailed;
  const farthest = draft.polygon.reduce((max, p) => Math.max(max, haversineMeters(center, p)), 0);
  const tooFar = draft.type === 'polygon' && farthest > maxRadius;
  const errors = {
    name: draft.name.trim().length === 0 ? 'Nommez la zone.' : null,
    shape:
      draft.type === 'polygon'
        ? draft.polygon.length < 3
          ? 'Placez au moins trois points sur la carte.'
          : tooFar
            ? `Le tracé dépasse le rayon autorisé (${formatDistance(maxRadius)}).`
            : null
        : null,
    free: draft.freeAboveCents !== null && draft.minOrderCents !== null && draft.freeAboveCents < draft.minOrderCents ? 'Doit être supérieur au minimum de commande.' : null,
    fee:
      bounds.maxFeeCents != null && draft.feeCents > bounds.maxFeeCents
        ? `${formatEUR(bounds.maxFeeCents, { cents: true })} au plus.`
        : bounds.minFeeCents != null && draft.feeCents < bounds.minFeeCents
          ? `${formatEUR(bounds.minFeeCents, { cents: true })} au moins.`
          : null,
    min:
      draft.minOrderCents === null
        ? null
        : bounds.minOrderCeilingCents != null && draft.minOrderCents > bounds.minOrderCeilingCents
          ? `${formatEUR(bounds.minOrderCeilingCents, { cents: true })} au plus.`
          : bounds.minOrderFloorCents != null && draft.minOrderCents < bounds.minOrderFloorCents
            ? `${formatEUR(bounds.minOrderFloorCents, { cents: true })} au moins.`
            : null,
  };
  const feeHint =
    bounds.maxFeeCents != null
      ? `Entre ${formatEUR(bounds.minFeeCents ?? 0, { cents: true })} et ${formatEUR(bounds.maxFeeCents, { cents: true })}, fixé par Ciyou Eats.`
      : '0 € : livraison offerte.';
  const invalid = Object.values(errors).some(Boolean);

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-4">
        <div className="flex min-w-0 items-center gap-3">
          <span className="size-3 shrink-0 rounded-full ring-4 ring-surface-3" style={{ backgroundColor: draft.color }} />
          <h2 className="truncate font-display text-md font-semibold tracking-tight text-fg">{draft.id ? 'Modifier la zone' : 'Nouvelle zone'}</h2>
        </div>
        <Switch checked={draft.enabled} aria-label="Zone active" onCheckedChange={(enabled) => onChange({ enabled })} />
      </div>
      <div className="space-y-5 px-5 py-5">
        <FormField label="Nom de la zone" required error={errors.name}>
          <Input value={draft.name} maxLength={40} placeholder="Ex. Centre-ville" onChange={(e) => onChange({ name: e.target.value })} />
        </FormField>

        <div>
          <p className="mb-2 text-sm font-medium text-fg">Forme</p>
          <SegmentedControl
            aria-label="Forme de la zone"
            value={draft.type}
            onValueChange={(v) => {
              if (v === 'polygon' && draft.polygon.length < 3) onChange({ type: 'polygon', polygon: circlePolygon(center, Math.min(draft.radiusMeters, maxRadius), 10) });
              else onChange({ type: v as ZoneDraft['type'] });
            }}
            options={[
              { value: 'radius', label: 'Rayon', icon: <CircleDot /> },
              { value: 'polygon', label: 'Tracé libre', icon: <Hexagon /> },
            ]}
          />
        </div>

        {draft.type === 'radius' ? (
          <FormField label="Rayon autour de l’établissement" hint="Vous pouvez aussi étirer le cercle directement sur la carte.">
            <div className="flex items-center gap-3 pt-1">
              <Slider
                className="min-w-0 flex-1"
                min={300}
                max={maxRadius}
                step={100}
                value={[Math.min(draft.radiusMeters, maxRadius)]}
                aria-label="Rayon"
                formatValue={(v) => formatDistance(v)}
                onValueChange={([v]) => v !== undefined && onChange({ radiusMeters: v })}
              />
              <span className="w-16 shrink-0 text-right font-mono text-sm text-fg num">{formatDistance(draft.radiusMeters)}</span>
            </div>
          </FormField>
        ) : (
          <div className="space-y-3">
            {mapReady ? (
              <Notice tone="info" icon={<MousePointerClick />}>
                Cliquez sur la carte pour ajouter un point, faites glisser les sommets pour ajuster, cliquez sur un sommet pour le retirer.
              </Notice>
            ) : (
              <Notice tone="amber">La carte n’est pas disponible : utilisez une zone en rayon.</Notice>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <span className={cn('font-mono text-xs num', errors.shape ? 'text-danger-soft-fg' : 'text-fg-subtle')}>{draft.polygon.length} points</span>
              <Button variant="ghost" size="xs" leftIcon={<Undo2 />} disabled={draft.polygon.length === 0} onClick={() => onChange({ polygon: draft.polygon.slice(0, -1) })}>
                Annuler le dernier point
              </Button>
              <Button variant="ghost" size="xs" leftIcon={<Eraser />} disabled={draft.polygon.length === 0} onClick={() => onChange({ polygon: [] })}>
                Effacer
              </Button>
              <Button variant="ghost" size="xs" leftIcon={<CircleDot />} onClick={() => onChange({ polygon: circlePolygon(center, Math.min(2500, maxRadius), 10) })}>
                Partir d’un cercle
              </Button>
            </div>
            {errors.shape && <p className="text-xs text-danger-soft-fg">{errors.shape}</p>}
          </div>
        )}

        <div className="grid gap-5 border-t border-border pt-5 sm:grid-cols-2">
          <FormField label="Frais de livraison" required error={errors.fee} hint={feeHint}>
            <MoneyInput value={draft.feeCents} onChange={(v) => v !== null && onChange({ feeCents: v })} />
          </FormField>
          <FormField label="Délai de livraison" hint="Ajouté au temps de préparation.">
            <IntegerInput nullable value={draft.deliveryMinutes} min={5} max={90} unit="min" placeholder="—" onChange={(v) => onChange({ deliveryMinutes: v })} />
          </FormField>
          <FormField label="Minimum de commande" error={errors.min} hint="Vide : minimum général de l’établissement.">
            <MoneyInput nullable value={draft.minOrderCents} onChange={(v) => onChange({ minOrderCents: v })} />
          </FormField>
          <FormField label="Livraison offerte dès" error={errors.free} hint="Vide : jamais offerte.">
            <MoneyInput nullable value={draft.freeAboveCents} onChange={(v) => onChange({ freeAboveCents: v })} />
          </FormField>
        </div>

        <div>
          <p className="mb-2 text-sm font-medium text-fg">Couleur sur la carte</p>
          <div role="radiogroup" aria-label="Couleur" className="flex flex-wrap gap-2">
            {ZONE_COLORS.map((color) => (
              <button
                key={color}
                type="button"
                role="radio"
                aria-checked={draft.color === color}
                aria-label={COLOR_NAMES[color]}
                onClick={() => onChange({ color })}
                className={cn(
                  'size-7 rounded-full border-2 transition-transform focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
                  draft.color === color ? 'scale-110 border-fg' : 'border-transparent hover:scale-105',
                )}
                style={{ backgroundColor: color }}
              />
            ))}
          </div>
        </div>
      </div>
      <div className="flex flex-col-reverse gap-2 border-t border-border bg-surface-2 px-5 py-3.5 sm:flex-row sm:justify-end">
        <Button variant="ghost" onClick={onCancel} disabled={saving}>
          Annuler
        </Button>
        <Button variant="primary" loading={saving} disabled={invalid} onClick={onSubmit}>
          {draft.id ? 'Enregistrer la zone' : 'Créer la zone'}
        </Button>
      </div>
    </Card>
  );
}
