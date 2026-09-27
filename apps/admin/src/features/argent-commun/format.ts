// Formats d'affichage des rubriques « Argent » (montants en centimes, taux en bps,
// dates calendaires AAAA-MM-JJ).
import { CURRENCY_MINOR_DIGITS, type CurrencyCode } from '@golink/shared';
import { formatEUR, formatNumber } from '@golink/ui';

/** Montant en centimes → « 1 234,56 € ». */
export function eur(cents: number): string {
  return formatEUR(cents, { cents: true });
}

/** Montant compact : « 12,4 k€ ». */
export function eurCompact(cents: number): string {
  return formatEUR(cents, { cents: true, compact: true });
}

/** Montant signé : « + 12,00 € » / « − 3,50 € ». */
export function eurSigned(cents: number): string {
  if (cents === 0) return eur(0);
  return `${cents > 0 ? '+' : '−'} ${eur(Math.abs(cents))}`;
}

/** Taux en points de base → « 10 % », « 5,5 % ». */
export function bps(value: number): string {
  return `${formatNumber(value / 100, { decimals: true })} %`;
}

/** Ratio → « 12,5 % ». */
export function ratio(value: number): string {
  return `${formatNumber(Math.round(value * 1000) / 10, { decimals: true })} %`;
}

/** Variation relative (null si la base est nulle). */
export function change(current: number, previous: number): number | undefined {
  if (!previous) return undefined;
  return (current - previous) / Math.abs(previous);
}

export function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return `${formatNumber(count)} ${count > 1 ? pluralForm : singular}`;
}

const dayFormat = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const shortDayFormat = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const monthFormat = new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric', timeZone: 'UTC' });

/** « 2026-09-14 » → « 14 sept. 2026 ». */
export function day(value: string | null | undefined): string {
  if (!value) return '—';
  return dayFormat.format(new Date(`${value}T12:00:00Z`));
}

export function shortDay(value: string): string {
  return shortDayFormat.format(new Date(`${value}T12:00:00Z`));
}

/** Période « du 7 au 13 sept. 2026 ». */
export function periodLabel(from: string, to: string): string {
  if (from === to) return day(from);
  return `${shortDay(from)} → ${day(to)}`;
}

/** « 2026-09 » → « septembre 2026 ». */
export function monthLabel(month: string): string {
  const label = monthFormat.format(new Date(`${month}-15T12:00:00Z`));
  return label.charAt(0).toUpperCase() + label.slice(1);
}

/** Jour local AAAA-MM-JJ. */
export function isoDay(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function addDays(value: string, delta: number): string {
  const [y, m, d] = value.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d) + delta * 86_400_000).toISOString().slice(0, 10);
}

/** Mois précédent (AAAA-MM). */
export function previousMonth(date = new Date()): string {
  const prev = new Date(date.getFullYear(), date.getMonth() - 1, 15);
  return `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, '0')}`;
}

/** Montant pour les fichiers exportés (tableur français) : 1234.5 → « 1234,50 ». */
export function csvAmount(cents: number): string {
  return (cents / 100).toFixed(2).replace('.', ',');
}

/** Saisie d'un montant en euros (« 12,5 ») → centimes ; null si invalide. */
export function parseEuros(input: string): number | null {
  const normalized = input.replace(/\s/g, '').replace(',', '.').replace('€', '');
  if (!/^-?\d+(\.\d{1,2})?$/.test(normalized)) return null;
  return Math.round(Number(normalized) * 100);
}

/** Saisie d'un pourcentage (« 12,5 ») → points de base ; null si invalide. */
export function parsePercent(input: string): number | null {
  const normalized = input.replace(/\s/g, '').replace(',', '.').replace('%', '');
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) return null;
  const value = Math.round(Number(normalized) * 100);
  return value <= 10_000 ? value : null;
}

/** Centimes → saisie « 12,50 ». */
export function toEurosInput(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return '';
  return (cents / 100).toFixed(2).replace('.', ',');
}

export function toPercentInput(value: number | null | undefined): string {
  if (value === null || value === undefined) return '';
  return String(value / 100).replace('.', ',');
}

/** Saisie d'un montant dans la devise d'un marché (unités mineures : centimes, millimes pour TND). */
export function parseMinor(input: string, currency: CurrencyCode): number | null {
  const normalized = input.replace(/\s/g, '').replace(',', '.').replace(/[€A-Z]/g, '');
  const digits = CURRENCY_MINOR_DIGITS[currency];
  if (!new RegExp(`^\d+(\.\d{1,${digits}})?$`).test(normalized)) return null;
  return Math.round(Number(normalized) * 10 ** digits);
}

export function toMinorInput(minor: number, currency: CurrencyCode): string {
  const digits = CURRENCY_MINOR_DIGITS[currency];
  return (minor / 10 ** digits).toFixed(digits).replace('.', ',');
}
