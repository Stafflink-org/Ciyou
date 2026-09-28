import type { ReactNode } from 'react';
import { AdvancedMarker, APIProvider, ColorScheme, Map as GoogleMap } from '@vis.gl/react-google-maps';
import { MapPinOff } from 'lucide-react';
import { cn } from '../lib/cn';
import { toneClass, type Tone } from '../lib/tones';

export interface LatLng {
  lat: number;
  lng: number;
}

export interface MapContainerProps {
  /** Clé navigateur Google Maps (VITE_GOOGLE_MAPS_API_KEY). */
  apiKey?: string;
  center: LatLng;
  zoom?: number;
  /** Identifiant de style cartographique (requis pour les marqueurs avancés). */
  mapId?: string;
  dark?: boolean;
  height?: number | string;
  className?: string;
  /** Marqueurs, polygones de zones, trajets… */
  children?: ReactNode;
}

/**
 * Carte Google Maps encadrée aux couleurs du kit. Sans clé, affiche un
 * emplacement neutre plutôt qu'une carte en erreur.
 */
export function MapContainer({
  apiKey,
  center,
  zoom = 12,
  mapId = 'DEMO_MAP_ID',
  dark,
  height = 360,
  className,
  children,
}: MapContainerProps) {
  const frame = cn('relative overflow-hidden rounded-xl border border-border bg-surface-2', className);
  if (!apiKey) {
    return (
      <div className={cn(frame, 'grid place-items-center')} style={{ height }}>
        <div className="flex flex-col items-center gap-2 px-6 text-center">
          <span className="grid size-10 place-items-center rounded-xl border border-border bg-surface text-fg-subtle">
            <MapPinOff className="size-5" />
          </span>
          <p className="text-sm font-medium text-fg">Carte indisponible</p>
          <p className="max-w-xs text-xs text-fg-subtle">La clé Google Maps n’est pas configurée pour cet environnement.</p>
        </div>
      </div>
    );
  }
  return (
    <div className={frame} style={{ height }}>
      <APIProvider apiKey={apiKey} language="fr" region="FR">
        <GoogleMap
          defaultCenter={center}
          defaultZoom={zoom}
          mapId={mapId}
          colorScheme={dark ? ColorScheme.DARK : ColorScheme.LIGHT}
          gestureHandling="cooperative"
          disableDefaultUI
          zoomControl
          clickableIcons={false}
          className="size-full"
        >
          {children}
        </GoogleMap>
      </APIProvider>
    </div>
  );
}

export interface MapPinProps {
  position: LatLng;
  icon?: ReactNode;
  tone?: Tone;
  /** Libellé affiché dans une étiquette au-dessus du point. */
  label?: string;
  onClick?: () => void;
}

/** Marqueur rond aux couleurs d'un ton (restaurant, livreur, client). */
export function MapPin({ position, icon, tone = 'brand', label, onClick }: MapPinProps) {
  return (
    <AdvancedMarker position={position} onClick={onClick} title={label}>
      <div className={cn(toneClass[tone], 'flex flex-col items-center')}>
        {label && (
          <span className="mb-1 whitespace-nowrap rounded-md bg-elevated px-1.5 py-0.5 text-2xs font-semibold text-fg shadow-md">
            {label}
          </span>
        )}
        <span className="grid size-8 place-items-center rounded-full border-2 border-white bg-(--tone-solid) text-white shadow-lg [&_svg]:size-4">
          {icon}
        </span>
      </div>
    </AdvancedMarker>
  );
}
