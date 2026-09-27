// Calculs géographiques : distance, appartenance à une zone, geohash.
import type { LatLng } from '../models/common';

const EARTH_RADIUS_M = 6_371_000;

/** Distance à vol d'oiseau en mètres (formule de haversine). */
export function haversineMeters(a: LatLng, b: LatLng): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h)));
}

/** Point dans un polygone (lancer de rayon). Le polygone est fermé implicitement. */
export function isPointInPolygon(point: LatLng, polygon: readonly LatLng[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const a = polygon[i];
    const b = polygon[j];
    const crosses = a.lat > point.lat !== b.lat > point.lat;
    if (crosses && point.lng < ((b.lng - a.lng) * (point.lat - a.lat)) / (b.lat - a.lat) + a.lng) inside = !inside;
  }
  return inside;
}

/** Boîte englobante d'un polygone (pré-filtrage des zones). */
export function polygonBounds(polygon: readonly LatLng[]): { north: number; south: number; east: number; west: number } {
  const lats = polygon.map((p) => p.lat);
  const lngs = polygon.map((p) => p.lng);
  return { north: Math.max(...lats), south: Math.min(...lats), east: Math.max(...lngs), west: Math.min(...lngs) };
}

const GEOHASH_BASE32 = '0123456789bcdefghjkmnpqrstuvwxyz';

/** Geohash d'un point (précision 9 ≈ 5 m) pour les recherches de proximité. */
export function encodeGeohash(point: LatLng, precision = 9): string {
  let latRange: [number, number] = [-90, 90];
  let lngRange: [number, number] = [-180, 180];
  let hash = '';
  let bit = 0;
  let ch = 0;
  let evenBit = true;
  while (hash.length < precision) {
    const range = evenBit ? lngRange : latRange;
    const value = evenBit ? point.lng : point.lat;
    const mid = (range[0] + range[1]) / 2;
    if (value >= mid) {
      ch = (ch << 1) | 1;
      if (evenBit) lngRange = [mid, range[1]];
      else latRange = [mid, range[1]];
    } else {
      ch <<= 1;
      if (evenBit) lngRange = [range[0], mid];
      else latRange = [range[0], mid];
    }
    evenBit = !evenBit;
    bit += 1;
    if (bit === 5) {
      hash += GEOHASH_BASE32[ch];
      bit = 0;
      ch = 0;
    }
  }
  return hash;
}
