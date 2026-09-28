// Éléments cartographiques des rubriques de configuration (Google Maps) : formes
// modifiables (cercle, polygone), capture des clics pour le tracé, recentrage.
import { Component, useEffect, useRef, useSyncExternalStore, type ReactNode } from 'react';
import { MapPinOff } from 'lucide-react';
import { AdvancedMarker, useMap } from '@vis.gl/react-google-maps';
import type { LatLng } from '@golink/shared';
import { MapContainer, cn } from '@golink/ui';
import { useRuntimeConfig } from '@golink/web';
import { useAppColorMode } from '@/app/color-mode';
import { functions } from '@/lib/firebase';

// Échec d'authentification Google Maps (clé refusée pour ce domaine) : Google appelle
// window.gm_authFailure ; la carte est alors remplacée par un état propre.
let authFailed = false;
const listeners = new Set<() => void>();
if (typeof window !== 'undefined') {
  (window as unknown as { gm_authFailure?: () => void }).gm_authFailure = () => {
    authFailed = true;
    listeners.forEach((l) => l());
  };
}

/** Vrai si Google Maps a refusé la clé sur ce domaine. */
export function useMapsAuthFailed(): boolean {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => authFailed,
  );
}

/** État de secours affiché quand la carte ne peut pas s'afficher (clé refusée ou erreur du SDK). */
function MapUnavailable({ height, className }: { height?: number | string; className?: string }) {
  return (
    <div className={cn('grid place-items-center rounded-xl border border-border bg-surface-2', className)} style={{ height }}>
      <div className="flex max-w-xs flex-col items-center gap-2 px-6 text-center">
        <span className="grid size-10 place-items-center rounded-xl border border-border bg-surface text-fg-subtle">
          <MapPinOff className="size-5" />
        </span>
        <p className="text-sm font-medium text-fg">Carte momentanément indisponible</p>
        <p className="text-xs text-fg-subtle">Le service de cartographie n’est pas autorisé sur cette adresse. Vos réglages restent modifiables.</p>
      </div>
    </div>
  );
}

// Le SDK Google Maps (marqueurs avancés notamment) peut échouer brutalement pendant le
// démontage qui suit un refus de clé (gm_authFailure survient après un premier rendu de
// la carte) : cette frontière locale évite qu'un tel incident ne fasse planter toute la page.
class MapErrorBoundary extends Component<{ height?: number | string; className?: string; children: ReactNode }, { crashed: boolean }> {
  state = { crashed: false };
  static getDerivedStateFromError() {
    return { crashed: true };
  }
  render() {
    if (this.state.crashed) return <MapUnavailable height={this.props.height} className={this.props.className} />;
    return this.props.children;
  }
}

export function ConfigMap({ center, zoom = 13, height = 420, className, children }: { center: LatLng; zoom?: number; height?: number | string; className?: string; children?: ReactNode }) {
  // La frontière reste montée en permanence : c'est le contenu qu'elle protège (pas elle-même)
  // qui bascule vers l'état de secours, pour rester en mesure de rattraper un incident de démontage.
  return (
    <MapErrorBoundary height={height} className={className}>
      <ConfigMapContent center={center} zoom={zoom} height={height} className={className}>
        {children}
      </ConfigMapContent>
    </MapErrorBoundary>
  );
}

function ConfigMapContent({ center, zoom = 13, height = 420, className, children }: { center: LatLng; zoom?: number; height?: number | string; className?: string; children?: ReactNode }) {
  const { mode } = useAppColorMode();
  const failed = useMapsAuthFailed();
  const config = useRuntimeConfig(functions);
  const apiKey = config?.googleMapsWebKey ?? undefined;
  if (failed) return <MapUnavailable height={height} className={className} />;
  if (config && !apiKey) {
    return (
      <div className={cn('grid place-items-center rounded-xl border border-border bg-surface-2', className)} style={{ height }}>
        <p className="max-w-xs px-6 text-center text-xs text-fg-subtle">Cartographie non configurée, contactez votre administrateur.</p>
      </div>
    );
  }
  return (
    <MapContainer apiKey={apiKey} center={center} zoom={zoom} height={height} dark={mode === 'dark'} className={className}>
      {children}
    </MapContainer>
  );
}

/** Cartographie configurée côté super admin (clé distribuée par getPublicRuntimeConfig). */
export function useMapsAvailable(): boolean {
  const config = useRuntimeConfig(functions);
  return Boolean(config?.googleMapsWebKey);
}

/** Recentre la carte quand `center` change (ex. adresse géocodée). */
export function MapRecenter({ center, zoom }: { center: LatLng | null; zoom?: number }) {
  const map = useMap();
  const key = center ? `${center.lat.toFixed(6)},${center.lng.toFixed(6)}` : '';
  useEffect(() => {
    if (!map || !center) return;
    map.panTo(center);
    if (zoom) map.setZoom(zoom);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, key, zoom]);
  return null;
}

/** Ajuste le cadrage pour montrer tous les points. */
export function MapFitBounds({ points, padding = 48 }: { points: LatLng[]; padding?: number }) {
  const map = useMap();
  const key = points.map((p) => `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`).join('|');
  useEffect(() => {
    if (!map || points.length === 0) return;
    const bounds = new google.maps.LatLngBounds();
    points.forEach((p) => bounds.extend(p));
    map.fitBounds(bounds, padding);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, key, padding]);
  return null;
}

interface ShapeStyle {
  color: string;
  fillOpacity?: number;
  strokeWeight?: number;
  dashed?: boolean;
  zIndex?: number;
}

/** Cercle (zone en rayon), modifiable à la souris si `editable`. */
export function CircleShape({
  center,
  radius,
  style,
  editable,
  onRadiusChange,
  onClick,
}: {
  center: LatLng;
  radius: number;
  style: ShapeStyle;
  editable?: boolean;
  onRadiusChange?: (meters: number) => void;
  onClick?: () => void;
}) {
  const map = useMap();
  const circle = useRef<google.maps.Circle | null>(null);
  const callbacks = useRef({ onRadiusChange, onClick });
  callbacks.current = { onRadiusChange, onClick };

  useEffect(() => {
    if (!map) return;
    const shape = new google.maps.Circle({ map, center, radius, clickable: true });
    circle.current = shape;
    const listeners = [
      shape.addListener('radius_changed', () => callbacks.current.onRadiusChange?.(Math.round(shape.getRadius()))),
      shape.addListener('click', () => callbacks.current.onClick?.()),
    ];
    return () => {
      listeners.forEach((l) => l.remove());
      shape.setMap(null);
      circle.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map]);

  useEffect(() => {
    const shape = circle.current;
    if (!shape) return;
    shape.setOptions({
      center,
      strokeColor: style.color,
      strokeOpacity: style.dashed ? 0.6 : 0.95,
      strokeWeight: style.strokeWeight ?? 2,
      fillColor: style.color,
      fillOpacity: style.fillOpacity ?? 0.12,
      editable: Boolean(editable),
      draggable: false,
      zIndex: style.zIndex ?? 1,
    });
    if (Math.round(shape.getRadius()) !== Math.round(radius)) shape.setRadius(radius);
  }, [center, radius, style.color, style.fillOpacity, style.strokeWeight, style.dashed, style.zIndex, editable]);

  return null;
}

/** Polygone (zone tracée) : sommets déplaçables si `editable`, `onPathChange` à chaque modification. */
export function PolygonShape({
  path,
  style,
  editable,
  onPathChange,
  onClick,
}: {
  path: LatLng[];
  style: ShapeStyle;
  editable?: boolean;
  onPathChange?: (path: LatLng[]) => void;
  onClick?: () => void;
}) {
  const map = useMap();
  const polygon = useRef<google.maps.Polygon | null>(null);
  const callbacks = useRef({ onPathChange, onClick });
  callbacks.current = { onPathChange, onClick };
  const internal = useRef(false);

  useEffect(() => {
    if (!map) return;
    const shape = new google.maps.Polygon({ map, paths: path, clickable: true });
    polygon.current = shape;
    let pathListeners: google.maps.MapsEventListener[] = [];
    const emit = () => {
      internal.current = true;
      callbacks.current.onPathChange?.(
        shape
          .getPath()
          .getArray()
          .map((p) => ({ lat: Number(p.lat().toFixed(6)), lng: Number(p.lng().toFixed(6)) })),
      );
    };
    const bindPath = () => {
      pathListeners.forEach((l) => l.remove());
      const mvc = shape.getPath();
      pathListeners = [mvc.addListener('set_at', emit), mvc.addListener('insert_at', emit), mvc.addListener('remove_at', emit)];
    };
    bindPath();
    const click = shape.addListener('click', (event: google.maps.PolyMouseEvent) => {
      // Clic droit ou clic sur un sommet en édition : suppression du sommet.
      if (event.vertex !== undefined && shape.getEditable() && shape.getPath().getLength() > 3) {
        shape.getPath().removeAt(event.vertex);
        return;
      }
      callbacks.current.onClick?.();
    });
    (shape as unknown as { __bind: () => void }).__bind = bindPath;
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
      strokeOpacity: style.dashed ? 0.6 : 0.95,
      strokeWeight: style.strokeWeight ?? 2,
      fillColor: style.color,
      fillOpacity: style.fillOpacity ?? 0.12,
      editable: Boolean(editable),
      zIndex: style.zIndex ?? 1,
    });
    if (internal.current) {
      internal.current = false;
      return;
    }
    shape.setPath(path);
    (shape as unknown as { __bind: () => void }).__bind();
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

/** Marqueur de l'établissement (déplaçable pour ajuster la position). */
export function RestaurantPin({
  position,
  label,
  draggable,
  onDragEnd,
}: {
  position: LatLng;
  label?: string;
  draggable?: boolean;
  onDragEnd?: (point: LatLng) => void;
}) {
  return (
    <AdvancedMarker
      position={position}
      draggable={draggable}
      title={label}
      onDragEnd={(event) => {
        if (event.latLng) onDragEnd?.({ lat: Number(event.latLng.lat().toFixed(6)), lng: Number(event.latLng.lng().toFixed(6)) });
      }}
    >
      <div className="tone-brand flex flex-col items-center">
        {label && (
          <span className="mb-1 whitespace-nowrap rounded-md bg-elevated px-1.5 py-0.5 text-2xs font-semibold text-fg shadow-md">{label}</span>
        )}
        <span className={cn('grid size-9 place-items-center rounded-full border-[3px] border-white bg-(--tone-solid) text-white shadow-lg', draggable && 'cursor-grab')}>
          <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2" />
            <path d="M7 2v20" />
            <path d="M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7" />
          </svg>
        </span>
      </div>
    </AdvancedMarker>
  );
}

/** Couleur d'un jeton du thème (variable CSS --gl-*), pour les tracés Google Maps. */
export function themeColor(token: 'primary' | 'fg-subtle' | 'fg-muted' | 'chart-2'): string {
  if (typeof window === 'undefined') return 'gray';
  const value = getComputedStyle(document.documentElement).getPropertyValue(`--gl-${token}`).trim();
  return value || 'gray';
}
