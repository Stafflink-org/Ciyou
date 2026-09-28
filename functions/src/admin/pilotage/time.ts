// Dates calendaires du pilotage : jours « AAAA-MM-JJ » et heures au fuseau de
// Paris (fuseau de référence des agrégats de la plateforme). Sans dépendance.

export const TIMEZONE = 'Europe/Paris';

const partsFormat = new Intl.DateTimeFormat('en-GB', {
  timeZone: TIMEZONE,
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  weekday: 'short',
});
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export interface ParisClock {
  day: string;
  hour: number;
  minute: number;
  /** 0 = lundi … 6 = dimanche. */
  weekday: number;
}

export function parisClock(date: Date): ParisClock {
  const parts = partsFormat.formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return {
    day: `${get('year')}-${get('month')}-${get('day')}`,
    hour: Number(get('hour')),
    minute: Number(get('minute')),
    weekday: Math.max(0, WEEKDAYS.indexOf(get('weekday'))),
  };
}

export function parisDay(date: Date): string {
  return parisClock(date).day;
}

/** Instant UTC correspondant à `day` à `hour`:00 heure de Paris. */
export function parisTime(day: string, hour = 0): Date {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  const utc = new Date(Date.UTC(y, m - 1, d, hour, 0));
  const local = parisClock(utc);
  const localMinutes = local.hour * 60 + local.minute;
  let offset = localMinutes - hour * 60;
  if (local.day !== day) offset += local.day > day ? 24 * 60 : -24 * 60;
  return new Date(utc.getTime() - offset * 60_000);
}

/** Bornes [début, fin[ d'un jour de Paris. */
export function dayBounds(day: string): { start: Date; end: Date } {
  return { start: parisTime(day, 0), end: parisTime(addDays(day, 1), 0) };
}

/** Bornes [début du premier jour, fin du dernier jour[. */
export function rangeBounds(from: string, to: string): { start: Date; end: Date } {
  return { start: parisTime(from, 0), end: parisTime(addDays(to, 1), 0) };
}

export function addDays(day: string, delta: number): string {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d + delta));
  return date.toISOString().slice(0, 10);
}

/** Nombre de jours entre deux dates, bornes incluses. */
export function daysInRange(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000) + 1;
}

export function listDays(from: string, to: string): string[] {
  const days: string[] = [];
  for (let day = from; day <= to; day = addDays(day, 1)) days.push(day);
  return days;
}

/** Clé de document journalier « AAAAMMJJ ». */
export function dayKey(day: string): string {
  return day.replaceAll('-', '');
}

export function monthKey(day: string): string {
  return day.slice(0, 7);
}

export function isIsoDay(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number) as [number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

/** Période couverte par un rapport envoyé le jour `runDay` : veille, semaine ou mois précédents. */
export function reportPeriod(frequency: 'daily' | 'weekly' | 'monthly', runDay: string): { from: string; to: string } {
  if (frequency === 'daily') {
    const day = addDays(runDay, -1);
    return { from: day, to: day };
  }
  if (frequency === 'weekly') {
    const weekday = parisClock(parisTime(runDay, 12)).weekday;
    const lastMonday = addDays(runDay, -weekday - 7);
    return { from: lastMonday, to: addDays(lastMonday, 6) };
  }
  const [y, m] = runDay.split('-').map(Number) as [number, number];
  const first = new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 10);
  const last = new Date(Date.UTC(y, m - 1, 0)).toISOString().slice(0, 10);
  return { from: first, to: last };
}

/** Prochain envoi strictement après `after` (Paris) : chaque jour, chaque lundi ou le 1er du mois. */
export function nextReportRun(frequency: 'daily' | 'weekly' | 'monthly', hour: number, after: Date): Date {
  let day = parisDay(after);
  for (let i = 0; i < 70; i += 1) {
    const candidate = parisTime(day, hour);
    const clock = parisClock(parisTime(day, 12));
    const matches =
      frequency === 'daily' || (frequency === 'weekly' && clock.weekday === 0) || (frequency === 'monthly' && day.endsWith('-01'));
    if (matches && candidate.getTime() > after.getTime()) return candidate;
    day = addDays(day, 1);
  }
  return parisTime(addDays(parisDay(after), 1), hour);
}
