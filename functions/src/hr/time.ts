// Dates et durées en heure de Paris pour la gestion d'équipe : jours calendaires,
// semaines, jours fériés, minutes travaillées, de nuit, le dimanche.
const TIME_ZONE = 'Europe/Paris';
const MINUTE = 60_000;
const DAY = 86_400_000;

const partsFormat = new Intl.DateTimeFormat('en-GB', {
  timeZone: TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

function parisParts(date: Date): { y: number; m: number; d: number; h: number; min: number; s: number } {
  const parts = Object.fromEntries(partsFormat.formatToParts(date).map((p) => [p.type, p.value]));
  return { y: Number(parts.year), m: Number(parts.month), d: Number(parts.day), h: Number(parts.hour), min: Number(parts.minute), s: Number(parts.second) };
}

/** Décalage (ms) entre l'heure de Paris et UTC à cet instant. */
function offsetMs(date: Date): number {
  const p = parisParts(date);
  return Date.UTC(p.y, p.m - 1, p.d, p.h, p.min, p.s) - Math.floor(date.getTime() / 1000) * 1000;
}

/** Jour calendaire « AAAA-MM-JJ » à Paris. */
export function parisDay(date: Date): string {
  const p = parisParts(date);
  return `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`;
}

/** Heure « HH:MM » à Paris. */
export function parisHourMinute(date: Date): string {
  const p = parisParts(date);
  return `${String(p.h).padStart(2, '0')}:${String(p.min).padStart(2, '0')}`;
}

/** Instant correspondant à `day` à `minutes` après minuit (heure de Paris). */
export function parisDateAt(day: string, minutes: number): Date {
  const [y = 1970, m = 1, d = 1] = day.split('-').map(Number);
  const guess = Date.UTC(y, m - 1, d, 0, 0) + minutes * MINUTE;
  const first = guess - offsetMs(new Date(guess));
  return new Date(guess - offsetMs(new Date(first)));
}

export function hourMinuteToMinutes(value: string): number {
  const [h = 0, m = 0] = value.split(':').map(Number);
  return h * 60 + m;
}

/** Ajoute des jours à une date « AAAA-MM-JJ ». */
export function addDays(day: string, days: number): string {
  const [y = 1970, m = 1, d = 1] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d) + days * DAY).toISOString().slice(0, 10);
}

/** 0 = lundi … 6 = dimanche. */
export function weekdayOf(day: string): number {
  const [y = 1970, m = 1, d = 1] = day.split('-').map(Number);
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
}

export function mondayOf(day: string): string {
  return addDays(day, -weekdayOf(day));
}

export function daysBetween(from: string, to: string): string[] {
  const days: string[] = [];
  for (let day = from; day <= to; day = addDays(day, 1)) days.push(day);
  return days;
}

/** Premier et dernier jour d'un mois « AAAA-MM ». */
export function monthBounds(period: string): { first: string; last: string } {
  const [y = 1970, m = 1] = period.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  return { first: `${period}-01`, last };
}

function easterSunday(year: number): string {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Jours fériés légaux en France métropolitaine. */
export function frenchHolidays(year: number): Set<string> {
  const easter = easterSunday(year);
  return new Set([
    `${year}-01-01`,
    addDays(easter, 1),
    `${year}-05-01`,
    `${year}-05-08`,
    addDays(easter, 39),
    addDays(easter, 50),
    `${year}-07-14`,
    `${year}-08-15`,
    `${year}-11-01`,
    `${year}-11-11`,
    `${year}-12-25`,
  ]);
}

export function isHoliday(day: string): boolean {
  return frenchHolidays(Number(day.slice(0, 4))).has(day);
}

export interface Interval {
  start: number;
  end: number;
}

function overlap(a: Interval, b: Interval): number {
  return Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start));
}

/** Plages travaillées : de l'entrée à la sortie, pauses retirées. */
export function workedIntervals(clockIn: Date, clockOut: Date, breaks: Array<{ start: Date; end: Date | null }>): Interval[] {
  let intervals: Interval[] = [{ start: clockIn.getTime(), end: clockOut.getTime() }];
  for (const pause of breaks) {
    const start = pause.start.getTime();
    const end = (pause.end ?? clockOut).getTime();
    if (end <= start) continue;
    intervals = intervals.flatMap((interval) => {
      if (end <= interval.start || start >= interval.end) return [interval];
      const parts: Interval[] = [];
      if (start > interval.start) parts.push({ start: interval.start, end: start });
      if (end < interval.end) parts.push({ start: end, end: interval.end });
      return parts;
    });
  }
  return intervals.filter((interval) => interval.end > interval.start);
}

export function totalMinutes(intervals: Interval[]): number {
  return Math.round(intervals.reduce((total, interval) => total + (interval.end - interval.start), 0) / MINUTE);
}

/** Minutes travaillées dans la plage de nuit (ex. 22:00 → 07:00). */
export function nightMinutes(intervals: Interval[], window: { from: string; to: string }): number {
  if (intervals.length === 0) return 0;
  const from = hourMinuteToMinutes(window.from);
  const to = hourMinuteToMinutes(window.to);
  const firstDay = parisDay(new Date(intervals[0]!.start));
  let total = 0;
  for (let offset = -1; offset <= 1; offset += 1) {
    const day = addDays(firstDay, offset);
    const start = parisDateAt(day, from).getTime();
    const end = (to <= from ? parisDateAt(addDays(day, 1), to) : parisDateAt(day, to)).getTime();
    for (const interval of intervals) total += overlap(interval, { start, end });
  }
  return Math.round(total / MINUTE);
}

/** Minutes travaillées un jour donné (dimanche, jour férié). */
export function minutesOnDay(intervals: Interval[], day: string): number {
  const window = { start: parisDateAt(day, 0).getTime(), end: parisDateAt(addDays(day, 1), 0).getTime() };
  return Math.round(intervals.reduce((total, interval) => total + overlap(interval, window), 0) / MINUTE);
}

/** Durée d'un créneau « HH:MM » → « HH:MM » (passage de minuit géré), pause déduite. */
export function shiftMinutes(startTime: string, endTime: string, breakMinutes: number): number {
  let minutes = hourMinuteToMinutes(endTime) - hourMinuteToMinutes(startTime);
  if (minutes <= 0) minutes += 24 * 60;
  return Math.max(0, minutes - breakMinutes);
}

const longDate = new Intl.DateTimeFormat('fr-FR', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long' });
const monthYear = new Intl.DateTimeFormat('fr-FR', { timeZone: 'UTC', month: 'long', year: 'numeric' });
const shortDate = new Intl.DateTimeFormat('fr-FR', { timeZone: 'UTC', day: '2-digit', month: '2-digit', year: 'numeric' });

function utcDate(day: string): Date {
  const [y = 1970, m = 1, d = 1] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export function formatLongDay(day: string): string {
  return longDate.format(utcDate(day));
}

export function formatShortDay(day: string): string {
  return shortDate.format(utcDate(day));
}

export function formatMonth(period: string): string {
  const label = monthYear.format(utcDate(`${period}-01`));
  return label.charAt(0).toUpperCase() + label.slice(1);
}

export function formatDuration(minutes: number): string {
  const sign = minutes < 0 ? '-' : '';
  const abs = Math.abs(Math.round(minutes));
  return `${sign}${Math.floor(abs / 60)} h ${String(abs % 60).padStart(2, '0')}`;
}
