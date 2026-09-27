// Formats d'affichage communs (durées, montants, dates relatives).
import { formatEUR } from '@golink/ui';
import { toMillis } from '@/lib/firestore';

export const euros = (cents: number) => formatEUR(cents, { cents: true });

/** Durée lisible : « 12 min », « 3 h 05 », « 2 j 4 h ». */
export function formatDuration(ms: number): string {
  const minutes = Math.max(0, Math.round(Math.abs(ms) / 60_000));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ${String(minutes % 60).padStart(2, '0')}`;
  const days = Math.floor(hours / 24);
  return hours % 24 ? `${days} j ${hours % 24} h` : `${days} j`;
}

export function millis(value: unknown): number {
  return toMillis(value as Parameters<typeof toMillis>[0]) ?? 0;
}

const dayFmt = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short' });
const dayTimeFmt = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const longFmt = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });

export function shortDay(ms: number): string {
  return dayFmt.format(ms);
}

export function shortDateTime(ms: number): string {
  return dayTimeFmt.format(ms);
}

export function longDate(ms: number): string {
  return longFmt.format(ms);
}

/** Jour AAAA-MM-JJ (fuseau de Paris). */
export function isoDay(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

export function plural(n: number, one: string, many: string): string {
  return `${n.toLocaleString('fr-FR')} ${n > 1 ? many : one}`;
}

/** Saisie d'un montant en euros (virgule ou point) → centimes ; null si invalide. */
export function parseEuros(input: string): number | null {
  const cleaned = input.replace(/\s/g, '').replace('€', '').replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  return Math.round(Number(cleaned) * 100);
}
