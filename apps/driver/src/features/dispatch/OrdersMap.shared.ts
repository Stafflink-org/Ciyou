// Carte multi-commandes (document client « Points à corriger », App livreur #3) : un pin par
// commande active, prévisualisation au clic. Types et calculs communs aux variantes native
// (react-native-maps) et web (@react-google-maps/api) — même split que RouteMap.
export interface OrderPin {
  id: string;
  lat: number;
  lng: number;
  label: string;
}

export interface MapRegion {
  lat: number;
  lng: number;
  /** Delta de latitude couvrant tous les pins (react-native-maps). */
  latDelta: number;
  lngDelta: number;
}

/** Région centrée sur l'ensemble des pins, avec une marge minimale si un seul pin ou des points très proches. */
export function regionFor(pins: OrderPin[]): MapRegion {
  if (pins.length === 0) return { lat: 0, lng: 0, latDelta: 0.05, lngDelta: 0.05 };
  const lats = pins.map((p) => p.lat);
  const lngs = pins.map((p) => p.lng);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  const MARGIN = 1.6;
  const MIN_DELTA = 0.02;
  return {
    lat: (minLat + maxLat) / 2,
    lng: (minLng + maxLng) / 2,
    latDelta: Math.max((maxLat - minLat) * MARGIN, MIN_DELTA),
    lngDelta: Math.max((maxLng - minLng) * MARGIN, MIN_DELTA),
  };
}
