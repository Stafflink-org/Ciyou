// Cartographie de l'exploitation (Google Maps) : carte du thème admin avec repli
// propre si la clé est refusée, polygones de zones modifiables, tracé au clic,
// marqueurs de livreurs, de commerces et de clients.
import { useEffect, useRef, useSyncExternalStore, type ReactNode } from 'react';
import { MapPinOff } from 'lucide-react';
import { AdvancedMarker, useMap } from '@vis.gl/react-google-maps';
import type { LatLng } from '@golink/shared';
import { MapContainer, cn, toneClass, type Tone } from '@golink/ui';
import { useRuntimeConfig } from '@golink/web';
import { functions } from '@/lib/firebase';

// Échec d'authentification Google Maps (clé refusée pour ce domaine).
let authFailed = false;
const listeners = new Set<() => void>();
if (typeof window !== 'undefined') {
  const w = window as unknown as { gm_authFailure?: () => void };
  const previous = w.gm_authFailure;
  w.gm_authFailure = () => {
    previous?.();
    authFailed = true;
    listeners.forEach((l) => l());
  };
}

export function useMapsAuthFailed(): boolean {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => authFailed,
  );
}

/** Cartographie configurée côté super admin (clé distribuée par getPublicRuntimeConfig). */
export function useMapsAvailable(): boolean {
  const config = useRuntimeConfig(functions);
  return Boolean(config?.googleMapsWebKey);
}

/** Carte du super admin (sombre) ; message clair si la cartographie est indisponible. */
export function OpsMap({ center, zoom = 12, height = 440, className, children }: { center: LatLng; zoom?: number; height?: number | string; className?: string; children?: ReactNode }) {
  const failed = useMapsAuthFailed();
  const config = useRuntimeConfig(functions);
  const apiKey = config?.googleMapsWebKey ?? undefined;
  if (failed || !apiKey) {
    return (
      <div className={cn('grid place-items-center rounded-xl border border-border bg-surface-2', className)} style={{ height }}>
        <div className="flex max-w-xs flex-col items-center gap-2 px-6 text-center">
          <span className="grid size-10 place-items-center rounded-xl border border-border bg-surface text-fg-subtle">
            <MapPinOff className="size-5" />
          </span>
          <p className="text-sm font-medium text-fg">{config && !config.mapsConfigured ? 'Cartographie non configurée, contactez votre administrateur.' : 'Carte momentanément indisponible'}</p>
          <p className="text-xs text-fg-subtle">Le service de cartographie ne répond pas sur cette adresse. Les données restent consultables ci-dessous.</p>
        </div>
      </div>
    );
  }
  return (
    <MapContainer apiKey={apiKey} center={center} zoom={zoom} height={height} dark className={className}>
      {children}
    </MapContainer>
  );
}

interface ShapeStyle {
  color: string;
  fillOpacity?: number;
  strokeWeight?: number;
  dashed?: boolean;
  zIndex?: number;
}

/** Polygone de zone ; sommets déplaçables si `editable` (clic sur un sommet : suppression). */
export function ZonePolygon({ path, style, editable, onPathChange, onClick }: { path: LatLng[]; style: ShapeStyle; editable?: boolean; onPathChange?: (path: LatLng[]) => void; onClick?: () => void }) {
  const map = useMap();
  const polygon = useRef<google.maps.Polygon | null>(null);
  const callbacks = useRef({ onPathChange, onClick });
  callbacks.current = { onPathChange, onClick };
  const internal = useRef(false);
  const rebind = useRef<() => void>(() => undefined);

  useEffect(() => {
    if (!map) return;
    const shape = new google.maps.Polygon({ map, paths: path, clickable: true });
    polygon.current = shape;
    let pathListeners: google.maps.MapsEventListener[] = [];
    const emit = () => {
      internal.current = true;
      callbacks.current.onPathChange?.(shape.getPath().getArray().map((p) => ({ lat: Number(p.lat().toFixed(6)), lng: Number(p.lng().toFixed(6)) })));
    };
    rebind.current = () => {
      pathListeners.forEach((l) => l.remove());
      const mvc = shape.getPath();
      pathListeners = [mvc.addListener('set_at', emit), mvc.addListener('insert_at', emit), mvc.addListener('remove_at', emit)];
    };
    rebind.current();
    const click = shape.addListener('click', (event: google.maps.PolyMouseEvent) => {
      if (event.vertex !== undefined && shape.getEditable() && shape.getPath().getLength() > 3) {
        shape.getPath().removeAt(event.vertex);
        return;
      }
      callbacks.current.onClick?.();
    });
    return () => {
      pathListeners.forEach((l) => l.remove());
      click.remove();
      shape.setMap(null);
      polygon.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map]);

  const key = path.map((p) => `${p.lat},${p.lng}`).join('|');
  useEffect(() => {
    const shape = polygon.current;
    if (!shape) return;
    shape.setOptions({
      strokeColor: style.color,
      strokeOpacity: style.dashed ? 0.55 : 0.95,
      strokeWeight: style.strokeWeight ?? 2,
      fillColor: style.color,
      fillOpacity: style.fillOpacity ?? 0.14,
      editable: Boolean(editable),
      zIndex: style.zIndex ?? 1,
    });
    if (internal.current) {
      internal.current = false;
      return;
    }
    shape.setPath(path);
    rebind.current();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, style.color, style.fillOpacity, style.strokeWeight, style.dashed, style.zIndex, editable]);

  return null;
}

/** Capture les clics sur la carte (ajout de sommets pendant le tracé). */
export function MapClickCapture({ enabled, onClick }: { enabled: boolean; onClick: (point: LatLng) => void }) {
  const map = useMap();
  const handler = useRef(onClick);
  handler.current = onClick;
  useEffect(() => {
    if (!map || !enabled) return;
    map.setOptions({ draggableCursor: 'crosshair' });
    const listener = map.addListener('click', (event: google.maps.MapMouseEvent) => {
      if (event.latLng) handler.current({ lat: Number(event.latLng.lat().toFixed(6)), lng: Number(event.latLng.lng().toFixed(6)) });
    });
    return () => {
      listener.remove();
      map.setOptions({ draggableCursor: null });
    };
  }, [map, enabled]);
  return null;
}

/** Recentre la carte quand la ville change. */
export function MapRecenter({ center, zoom }: { center: LatLng | null; zoom?: number }) {
  const map = useMap();
  const key = center ? `${center.lat.toFixed(5)},${center.lng.toFixed(5)}` : '';
  useEffect(() => {
    if (!map || !center) return;
    map.panTo(center);
    if (zoom) map.setZoom(zoom);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, key, zoom]);
  return null;
}

/** Point compact d'un livreur (couleur selon la disponibilité). */
export function DriverDot({ position, tone, label, onClick, active }: { position: LatLng; tone: Tone; label: string; onClick?: () => void; active?: boolean }) {
  return (
    <AdvancedMarker position={position} onClick={onClick} title={label} zIndex={active ? 20 : 10}>
      <span className={cn(toneClass[tone], 'relative grid place-items-center')}>
        {active && <span className="absolute size-7 animate-ping rounded-full bg-(--tone-solid) opacity-30" />}
        <span className={cn('grid place-items-center rounded-full border-2 border-white bg-(--tone-solid) shadow-md', active ? 'size-5' : 'size-4')} />
      </span>
    </AdvancedMarker>
  );
}

/** Marqueur avec icône (commerce, client). */
export function IconMarker({ position, tone, label, children }: { position: LatLng; tone: Tone; label?: string; children: ReactNode }) {
  return (
    <AdvancedMarker position={position} title={label} zIndex={15}>
      <div className={cn(toneClass[tone], 'flex flex-col items-center')}>
        {label && <span className="mb-1 whitespace-nowrap rounded-md bg-elevated px-1.5 py-0.5 text-2xs font-semibold text-fg shadow-md">{label}</span>}
        <span className="grid size-8 place-items-center rounded-full border-2 border-white bg-(--tone-solid) text-white shadow-lg [&_svg]:size-4">{children}</span>
      </div>
    </AdvancedMarker>
  );
}

/** Sommet numéroté pendant le tracé d'une nouvelle zone. */
export function VertexMarker({ position, index }: { position: LatLng; index: number }) {
  return (
    <AdvancedMarker position={position} zIndex={30}>
      <span className="grid size-5 place-items-center rounded-full border-2 border-white bg-primary font-mono text-[9px] font-semibold text-primary-fg shadow-md">{index + 1}</span>
    </AdvancedMarker>
  );
}

/** Couleur d'un jeton du thème pour les tracés Google Maps. */
export function themeColor(token: 'primary' | 'danger' | 'fg-subtle' | 'chart-1' | 'chart-2' | 'chart-3' | 'chart-4'): string {
  if (typeof window === 'undefined') return 'gray';
  return getComputedStyle(document.documentElement).getPropertyValue(`--gl-${token}`).trim() || 'gray';
}
