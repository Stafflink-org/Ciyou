// Outils du seed : aléatoire déterministe, dates en heure de Paris, écriture
// groupée avec marquage `seed: true` et comptage par collection.
import { GeoPoint, Timestamp, type DocumentReference, type Firestore } from '@google-cloud/firestore';
import { encodeGeohash, type LatLng } from '@golink/shared';

export { GeoPoint, Timestamp };

// ------------------------------------------------------------------ Aléatoire

/** Générateur pseudo-aléatoire déterministe (mulberry32) : un même seed produit les mêmes données. */
export class Rng {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  float(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  chance(probability: number): boolean {
    return this.next() < probability;
  }

  pick<T>(items: readonly T[]): T {
    const item = items[Math.floor(this.next() * items.length)];
    if (item === undefined) throw new Error('Liste vide');
    return item;
  }

  weighted<T>(entries: ReadonlyArray<readonly [T, number]>): T {
    const total = entries.reduce((s, [, w]) => s + w, 0);
    let r = this.next() * total;
    for (const [value, weight] of entries) {
      r -= weight;
      if (r <= 0) return value;
    }
    const last = entries[entries.length - 1];
    if (!last) throw new Error('Liste vide');
    return last[0];
  }

  shuffle<T>(items: readonly T[]): T[] {
    const copy = [...items];
    for (let i = copy.length - 1; i > 0; i -= 1) {
      const j = Math.floor(this.next() * (i + 1));
      [copy[i], copy[j]] = [copy[j] as T, copy[i] as T];
    }
    return copy;
  }

  /** Loi normale (Box-Muller). */
  normal(mean: number, sd: number): number {
    const u = Math.max(this.next(), 1e-9);
    const v = this.next();
    return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  digits(n: number): string {
    return Array.from({ length: n }, () => this.int(0, 9)).join('');
  }
}

// ------------------------------------------------------------------ Dates (Europe/Paris)

export const TIMEZONE = 'Europe/Paris';
const DAY_MS = 86_400_000;

/** Décalage UTC (minutes) de Paris à un instant donné. */
function parisOffsetMinutes(at: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TIMEZONE,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(at);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'));
  return Math.round((asUtc - at.getTime()) / 60_000);
}

/** Jour local (AAAA-MM-JJ) à Paris. */
export function parisDay(at: Date): string {
  return new Intl.DateTimeFormat('fr-CA', { timeZone: TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);
}

/** Instant correspondant à une heure locale de Paris (jour « AAAA-MM-JJ », minutes depuis minuit). */
export function parisTime(day: string, minutesOfDay: number): Date {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  const guess = new Date(Date.UTC(y, m - 1, d, 0, 0) + minutesOfDay * 60_000);
  return new Date(guess.getTime() - parisOffsetMinutes(guess) * 60_000);
}

export function addDays(day: string, delta: number): string {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d) + delta * DAY_MS).toISOString().slice(0, 10);
}

/** 0 = lundi … 6 = dimanche. */
export function weekday(day: string): number {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
}

/** Lundi de la semaine du jour donné. */
export function mondayOf(day: string): string {
  return addDays(day, -weekday(day));
}

export function dayKey(day: string): string {
  return day.replace(/-/g, '');
}

export function ts(date: Date): Timestamp {
  return Timestamp.fromDate(date);
}

export function minutesAfter(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60_000);
}

// ------------------------------------------------------------------ Géographie

/** Point à `distanceMeters` et `bearingDeg` d'un centre. */
export function offsetPoint(center: LatLng, distanceMeters: number, bearingDeg: number): LatLng {
  const rad = (bearingDeg * Math.PI) / 180;
  const dLat = (distanceMeters * Math.cos(rad)) / 111_320;
  const dLng = (distanceMeters * Math.sin(rad)) / (111_320 * Math.cos((center.lat * Math.PI) / 180));
  return { lat: round6(center.lat + dLat), lng: round6(center.lng + dLng) };
}

export function round6(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

export function geo(point: LatLng): { geo: GeoPoint; geohash: string } {
  return { geo: new GeoPoint(point.lat, point.lng), geohash: encodeGeohash(point) };
}

// ------------------------------------------------------------------ Écriture

/** Écriture en masse : chaque document reçoit `seed: true`, les volumes sont comptés par collection. */
export class SeedWriter {
  private readonly writer;
  readonly counts = new Map<string, number>();
  private failures = 0;

  constructor(private readonly db: Firestore) {
    this.writer = db.bulkWriter();
    this.writer.onWriteError((error) => {
      if (error.failedAttempts < 5) return true;
      this.failures += 1;
      console.error(`Échec d'écriture ${error.documentRef.path} : ${error.message}`);
      return false;
    });
  }

  set(ref: DocumentReference, data: object): void {
    const key = collectionKey(ref.path);
    this.counts.set(key, (this.counts.get(key) ?? 0) + 1);
    void this.writer.set(ref, { ...data, seed: true });
  }

  /** Fusion de champs dans un document déjà écrit (agrégats calculés après coup). */
  merge(ref: DocumentReference, data: object): void {
    void this.writer.set(ref, data, { merge: true });
  }

  doc(path: string): DocumentReference {
    return this.db.doc(path);
  }

  async flush(): Promise<void> {
    await this.writer.flush();
  }

  async close(): Promise<void> {
    await this.writer.close();
    if (this.failures > 0) throw new Error(`${this.failures} écriture(s) en échec`);
  }
}

/** « restaurants/abc/products/xyz » → « restaurants/*\/products ». */
function collectionKey(path: string): string {
  const segments = path.split('/');
  const names = segments.filter((_, i) => i % 2 === 0);
  return names.join('/*/');
}
