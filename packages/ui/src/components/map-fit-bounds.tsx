import { useEffect } from 'react';
import { useMap } from '@vis.gl/react-google-maps';
import type { LatLng } from './map';

/**
 * Cadre la carte (à placer dans un MapContainer) sur un ensemble de points.
 * Le recadrage n'a lieu que si l'ensemble change sensiblement (≈ 100 m).
 */
export function MapFitBounds({ points, padding = 64, maxZoom = 16 }: { points: LatLng[]; padding?: number; maxZoom?: number }) {
  const map = useMap();
  const key = points.map((p) => `${p.lat.toFixed(3)},${p.lng.toFixed(3)}`).join('|');
  useEffect(() => {
    if (!map || points.length === 0 || typeof google === 'undefined') return;
    if (points.length === 1) {
      map.setCenter(points[0] as LatLng);
      map.setZoom(maxZoom - 1);
      return;
    }
    const bounds = new google.maps.LatLngBounds();
    for (const p of points) bounds.extend(p);
    map.fitBounds(bounds, padding);
    const zoom = map.getZoom();
    if (zoom !== undefined && zoom > maxZoom) map.setZoom(maxZoom);
    // `points` est résumé par `key` : pas de recadrage à chaque nouvelle position.
  }, [map, key, padding, maxZoom]);
  return null;
}
