// Carte du suivi en direct : Google Maps quand le service est disponible, sinon
// plan schématique (positions réelles projetées autour de l'établissement,
// cercles de distance, trajets) pour que le suivi ne s'interrompe jamais.
import { Component, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Bike, Home, Map as MapIcon, Store } from 'lucide-react';
import { MapContainer, MapFitBounds, MapPin, SegmentedControl, cn, toneClass, type Tone } from '@golink/ui';
import type { LatLng } from '@golink/shared';

export interface LiveMarker {
  id: string;
  kind: 'restaurant' | 'driver' | 'customer';
  position: LatLng;
  label: string;
  tone: Tone;
  /** Trajet affiché depuis ce point (livreur → client ou → restaurant). */
  towards?: LatLng | null;
  active?: boolean;
  onClick?: () => void;
}

interface LiveMapProps {
  apiKey?: string;
  dark: boolean;
  center: LatLng;
  markers: LiveMarker[];
  height: string;
}

// ------------------------------------------------------------------ Détection des échecs Google

let googleAuthFailed = false;
const failureListeners = new Set<() => void>();

declare global {
  interface Window {
    gm_authFailure?: () => void;
  }
}

/** Google Maps appelle `gm_authFailure` quand la clé est refusée (domaine non autorisé…). */
function watchGoogleAuth(listener: () => void): () => void {
  failureListeners.add(listener);
  if (typeof window !== 'undefined' && !window.gm_authFailure) {
    window.gm_authFailure = () => {
      googleAuthFailed = true;
      failureListeners.forEach((fn) => fn());
    };
  }
  return () => failureListeners.delete(listener);
}

class GoogleBoundary extends Component<{ children: ReactNode; fallback: ReactNode; onFail: () => void }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch() {
    this.props.onFail();
  }
  render() {
    // Une fois l'échec attrapé, on reste sur le plan de secours : la carte Google est
    // instable après un refus d'authentification, la retenter provoquerait le même crash.
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

const ICONS: Record<LiveMarker['kind'], ReactNode> = {
  restaurant: <Store />,
  driver: <Bike />,
  customer: <Home />,
};

export function LiveMap({ apiKey, dark, center, markers, height }: LiveMapProps) {
  const [googleFailed, setGoogleFailed] = useState(googleAuthFailed || !apiKey);
  const [view, setView] = useState<'map' | 'plan'>('map');
  useEffect(() => watchGoogleAuth(() => setGoogleFailed(true)), []);
  const plan = googleFailed || view === 'plan';

  return (
    <div className="relative" style={{ height }}>
      {/* La limite d'erreur reste montée pendant la bascule carte ↔ plan : si elle se
          démonte en même temps que la carte Google, elle ne peut plus rattraper l'erreur
          que Google déclenche en nettoyant ses repères après un refus d'authentification. */}
      <GoogleBoundary onFail={() => setGoogleFailed(true)} fallback={<SchematicMap center={center} markers={markers} />}>
        {plan ? (
          <SchematicMap center={center} markers={markers} />
        ) : (
          <MapContainer apiKey={apiKey} center={center} zoom={14} dark={dark} height="100%" className="size-full">
            {markers.map((m) => (
              <MapPin key={m.id} position={m.position} tone={m.tone} icon={ICONS[m.kind]} label={m.label} onClick={m.onClick} />
            ))}
            <MapFitBounds points={markers.map((m) => m.position)} />
          </MapContainer>
        )}
      </GoogleBoundary>
      {!googleFailed && (
        <div className="absolute bottom-3 left-3">
          <SegmentedControl
            aria-label="Type de carte"
            value={view}
            onValueChange={(v) => setView(v as 'map' | 'plan')}
            className="bg-elevated shadow-md"
            options={[
              { value: 'map', label: 'Carte', icon: <MapIcon /> },
              { value: 'plan', label: 'Plan' },
            ]}
          />
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ Plan schématique

const KM_PER_DEG_LAT = 111.32;
const RINGS_KM = [1, 2, 3, 5];

function useSize<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setSize({ width: el.clientWidth, height: el.clientHeight });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return { ref, size };
}

function SchematicMap({ center, markers }: { center: LatLng; markers: LiveMarker[] }) {
  const { ref, size } = useSize<HTMLDivElement>();
  const padding = 56;

  // Projection équirectangulaire centrée sur l'établissement (échelle identique en x et y).
  const projection = useMemo(() => {
    const cos = Math.cos((center.lat * Math.PI) / 180);
    const toKm = (p: LatLng) => ({ x: (p.lng - center.lng) * KM_PER_DEG_LAT * cos, y: (p.lat - center.lat) * KM_PER_DEG_LAT });
    const points = [center, ...markers.map((m) => m.position), ...markers.flatMap((m) => (m.towards ? [m.towards] : []))].map(toKm);
    // Étendue symétrique autour du restaurant, au moins 1,5 km pour garder un plan lisible.
    const reachX = Math.max(0.8, ...points.map((p) => Math.abs(p.x)));
    const reachY = Math.max(0.8, ...points.map((p) => Math.abs(p.y)));
    const width = Math.max(1, size.width - padding * 2);
    const height = Math.max(1, size.height - padding * 2);
    const scale = Math.min(width / (reachX * 2), height / (reachY * 2));
    const project = (p: LatLng) => {
      const k = toKm(p);
      return { x: size.width / 2 + k.x * scale, y: size.height / 2 - k.y * scale };
    };
    return { project, scale };
  }, [center, markers, size.width, size.height]);

  const origin = { x: size.width / 2, y: size.height / 2 };

  // Étiquettes sans chevauchement : restaurant et point sélectionné d'abord, les autres
  // seulement s'il reste de la place (le nom reste accessible au survol et au lecteur d'écran).
  const labelled = useMemo(() => {
    const boxes: Array<{ x1: number; y1: number; x2: number; y2: number }> = [];
    const shown = new Set<string>();
    const priority = (m: LiveMarker) => (m.active ? 0 : m.kind === 'restaurant' ? 1 : m.kind === 'driver' ? 2 : 3);
    for (const m of [...markers].sort((a, b) => priority(a) - priority(b))) {
      const p = projection.project(m.position);
      const w = Math.min(160, m.label.length * 6.2 + 14);
      const box = { x1: p.x - w / 2, y1: p.y - 40, x2: p.x + w / 2, y2: p.y - 18 };
      const pinBox = { x1: p.x - 16, y1: p.y - 16, x2: p.x + 16, y2: p.y + 16 };
      const hits = (b: typeof box) => boxes.some((o) => b.x1 < o.x2 && b.x2 > o.x1 && b.y1 < o.y2 && b.y2 > o.y1);
      if (!hits(box) || m.active) {
        shown.add(m.id);
        boxes.push(box);
      }
      boxes.push(pinBox);
    }
    return shown;
  }, [markers, projection]);
  const visibleRings = RINGS_KM.filter((km) => km * projection.scale < Math.max(size.width, size.height) * 0.75);

  return (
    <div
      ref={ref}
      className="relative size-full overflow-hidden rounded-xl border border-border bg-surface-2"
      role="img"
      aria-label={`Plan du suivi : ${markers.filter((m) => m.kind === 'driver').length} livreur(s) autour de l’établissement`}
    >
      {size.width > 0 && (
        <>
          <svg width={size.width} height={size.height} className="absolute inset-0" aria-hidden>
            <defs>
              <pattern id="live-grid" width="32" height="32" patternUnits="userSpaceOnUse">
                <path d="M 32 0 L 0 0 0 32" fill="none" stroke="var(--color-border)" strokeWidth="1" opacity="0.55" />
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill="url(#live-grid)" />
            {visibleRings.map((km) => (
              <g key={km}>
                <circle cx={origin.x} cy={origin.y} r={km * projection.scale} fill="none" stroke="var(--color-border-strong)" strokeDasharray="4 6" />
                <text x={origin.x + km * projection.scale * 0.707 + 4} y={origin.y - km * projection.scale * 0.707 - 4} fontSize="10" fill="var(--color-fg-subtle)" fontFamily="var(--font-mono)">
                  {km} km
                </text>
              </g>
            ))}
            {markers
              .filter((m) => m.towards)
              .map((m) => {
                const a = projection.project(m.position);
                const b = projection.project(m.towards as LatLng);
                return (
                  <g key={`t-${m.id}`} className={toneClass[m.tone]}>
                    <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="var(--tone-solid)" strokeWidth={m.active ? 2.5 : 1.5} strokeDasharray="6 5" opacity={m.active ? 0.95 : 0.55} className="transition-all duration-[1800ms] ease-linear" />
                  </g>
                );
              })}
          </svg>
          {markers.map((m) => {
            const p = projection.project(m.position);
            return (
              <button
                key={m.id}
                type="button"
                onClick={m.onClick}
                disabled={!m.onClick}
                className={cn(
                  toneClass[m.tone],
                  'absolute flex -translate-x-1/2 -translate-y-full flex-col items-center transition-[left,top] duration-[1800ms] ease-linear focus-visible:outline-none disabled:cursor-default',
                  m.active ? 'z-20' : m.kind === 'restaurant' ? 'z-10' : 'z-0',
                )}
                style={{ left: p.x, top: p.y + 16 }}
                aria-label={m.label}
                title={m.label}
              >
                <span
                  className={cn(
                    'mb-1 max-w-40 truncate whitespace-nowrap rounded-md bg-elevated px-1.5 py-0.5 text-2xs font-semibold text-fg shadow-md transition-opacity',
                    m.active && 'ring-2 ring-(--tone-solid)',
                    !labelled.has(m.id) && 'opacity-0',
                  )}
                >
                  {m.label}
                </span>
                <span className="relative grid size-8 place-items-center rounded-full border-2 border-white bg-(--tone-solid) text-white shadow-lg [&_svg]:size-4">
                  {m.kind === 'driver' && <span className="absolute inset-0 animate-ping rounded-full bg-(--tone-solid) opacity-30" aria-hidden />}
                  {ICONS[m.kind]}
                </span>
              </button>
            );
          })}
          <p className="pointer-events-none absolute bottom-3 right-3 rounded-md bg-elevated/90 px-2 py-1 text-2xs text-fg-subtle shadow-sm">Plan schématique · positions en temps réel</p>
        </>
      )}
    </div>
  );
}
