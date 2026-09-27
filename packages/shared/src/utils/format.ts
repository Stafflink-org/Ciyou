// Formats d'affichage français : prix en euros, pourcentages, dates, durées.
import type { Bps, Cents } from '../pricing/money';

const LOCALE = 'fr-FR';
const DEFAULT_TIMEZONE = 'Europe/Paris';

const priceFormatter = new Intl.NumberFormat(LOCALE, { style: 'currency', currency: 'EUR' });
const compactFormatter = new Intl.NumberFormat(LOCALE, {
  style: 'currency',
  currency: 'EUR',
  notation: 'compact',
  maximumFractionDigits: 1,
});

/** 1250 → « 12,50 € » (espace insécable avant l'euro). */
export function formatPrice(cents: Cents): string {
  return priceFormatter.format(cents / 100);
}

/** Montant signé pour les relevés : « +12,50 € » / « −3,00 € ». */
export function formatSignedPrice(cents: Cents): string {
  const abs = formatPrice(Math.abs(cents));
  if (cents > 0) return `+${abs}`;
  if (cents < 0) return `−${abs}`;
  return abs;
}

/** Supplément d'option : « Gratuit » ou « +3,50 € ». */
export function formatOptionPrice(cents: Cents): string {
  return cents === 0 ? 'Gratuit' : `+${formatPrice(cents)}`;
}

/** Notation compacte pour les axes de graphiques : « 18,5 k€ ». */
export function formatCompactPrice(cents: Cents): string {
  return compactFormatter.format(cents / 100);
}

/** 1250 bps → « 12,5 % ». */
export function formatBps(bps: Bps): string {
  return `${new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 2 }).format(bps / 100)} %`;
}

/** Nombre entier ou décimal au format français. */
export function formatNumber(value: number, fractionDigits = 0): string {
  return new Intl.NumberFormat(LOCALE, {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(value);
}

/** Saisie utilisateur « 12,5 » ou « 12.50 » → 1250 centimes ; null si invalide. */
export function parsePriceInput(input: string): Cents | null {
  const normalized = input.replace(/\s| |€/g, '').replace(',', '.');
  if (!/^\d+(\.\d{0,2})?$/.test(normalized)) return null;
  return Math.round(Number(normalized) * 100);
}

type DateInput = Date | number | { toDate(): Date };

function toDate(value: DateInput): Date {
  if (value instanceof Date) return value;
  if (typeof value === 'number') return new Date(value);
  return value.toDate();
}

/** « 18/03/2026 ». */
export function formatDate(value: DateInput, timeZone = DEFAULT_TIMEZONE): string {
  return toDate(value).toLocaleDateString(LOCALE, { timeZone });
}

/** « 18 mars 2026 ». */
export function formatLongDate(value: DateInput, timeZone = DEFAULT_TIMEZONE): string {
  return toDate(value).toLocaleDateString(LOCALE, { day: 'numeric', month: 'long', year: 'numeric', timeZone });
}

/** « mercredi 18 mars 2026 ». */
export function formatFullDate(value: DateInput, timeZone = DEFAULT_TIMEZONE): string {
  return toDate(value).toLocaleDateString(LOCALE, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone,
  });
}

/** « 18 mars, 12:14 ». */
export function formatDateTime(value: DateInput, timeZone = DEFAULT_TIMEZONE): string {
  return toDate(value).toLocaleString(LOCALE, {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone,
  });
}

/** « 12:14 ». */
export function formatTime(value: DateInput, timeZone = DEFAULT_TIMEZONE): string {
  return toDate(value).toLocaleTimeString(LOCALE, { hour: '2-digit', minute: '2-digit', timeZone });
}

/** « il y a 5 minutes », « dans 2 heures », « hier ». */
export function formatRelative(value: DateInput, now: Date = new Date()): string {
  const diffSeconds = Math.round((toDate(value).getTime() - now.getTime()) / 1000);
  const rtf = new Intl.RelativeTimeFormat(LOCALE, { numeric: 'auto' });
  const abs = Math.abs(diffSeconds);
  if (abs < 45) return 'à l’instant';
  if (abs < 3600) return rtf.format(Math.round(diffSeconds / 60), 'minute');
  if (abs < 86_400) return rtf.format(Math.round(diffSeconds / 3600), 'hour');
  if (abs < 30 * 86_400) return rtf.format(Math.round(diffSeconds / 86_400), 'day');
  if (abs < 365 * 86_400) return rtf.format(Math.round(diffSeconds / (30 * 86_400)), 'month');
  return rtf.format(Math.round(diffSeconds / (365 * 86_400)), 'year');
}

/** Secondes → « MM:SS » (minuteur de préparation). */
export function formatCountdown(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

/** Minutes → « 1 h 05 » ou « 25 min ». */
export function formatMinutes(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}`;
}

/** Mètres → « 850 m » ou « 2,4 km ». */
export function formatDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${formatNumber(meters / 1000, 1)} km`;
}

/** Date calendaire locale → « AAAA-MM-JJ ». */
export function toIsoDay(value: DateInput, timeZone = DEFAULT_TIMEZONE): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(toDate(value))
    .reduce<Record<string, string>>((acc, p) => ({ ...acc, [p.type]: p.value }), {});
  return `${parts.year}-${parts.month}-${parts.day}`;
}

/** Clé de document journalier « AAAAMMJJ ». */
export function toDayKey(value: DateInput, timeZone = DEFAULT_TIMEZONE): string {
  return toIsoDay(value, timeZone).replaceAll('-', '');
}

/** Valide une date « AAAA-MM-JJ » (rejette les dates impossibles). */
export function isValidIsoDay(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}
