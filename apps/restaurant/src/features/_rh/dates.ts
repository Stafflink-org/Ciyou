// Dates calendaires « AAAA-MM-JJ », semaines (lundi → dimanche) et durées,
// communes aux rubriques Équipe & RH. Le back-office tourne à l'heure locale (Paris).

export function isoDay(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function parseDay(day: string): Date {
  const [y = 1970, m = 1, d = 1] = day.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function todayIso(): string {
  return isoDay(new Date());
}

export function addDays(day: string, days: number): string {
  const date = parseDay(day);
  date.setDate(date.getDate() + days);
  return isoDay(date);
}

/** 0 = lundi … 6 = dimanche. */
export function weekdayIndex(day: string): number {
  return (parseDay(day).getDay() + 6) % 7;
}

export function mondayOf(day: string): string {
  return addDays(day, -weekdayIndex(day));
}

export function weekDays(monday: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}

export function daysBetween(from: string, to: string): string[] {
  const days: string[] = [];
  for (let day = from; day <= to; day = addDays(day, 1)) days.push(day);
  return days;
}

export function currentPeriod(): string {
  return todayIso().slice(0, 7);
}

export function addMonths(period: string, months: number): string {
  const [y = 1970, m = 1] = period.split('-').map(Number);
  const date = new Date(y, m - 1 + months, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

export function monthBounds(period: string): { first: string; last: string } {
  const [y = 1970, m = 1] = period.split('-').map(Number);
  return { first: `${period}-01`, last: isoDay(new Date(y, m, 0)) };
}

const weekdayShort = new Intl.DateTimeFormat('fr-FR', { weekday: 'short' });
const weekdayLong = new Intl.DateTimeFormat('fr-FR', { weekday: 'long' });
const dayMonth = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short' });
const dayMonthLong = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long' });
const fullDate = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const shortDate = new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
const monthYear = new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric' });
const hourMinute = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' });

const capitalize = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);

/** « lun. » */
export function formatWeekdayShort(day: string): string {
  return weekdayShort.format(parseDay(day));
}

/** « Lundi » */
export function formatWeekday(day: string): string {
  return capitalize(weekdayLong.format(parseDay(day)));
}

/** « 3 oct. » */
export function formatDayMonth(day: string): string {
  return dayMonth.format(parseDay(day));
}

/** « 3 octobre » */
export function formatDayMonthLong(day: string): string {
  return dayMonthLong.format(parseDay(day));
}

/** « Lundi 3 octobre 2026 » */
export function formatFullDay(day: string): string {
  return capitalize(fullDate.format(parseDay(day)));
}

/** « 03/10/2026 » */
export function formatShortDay(day: string): string {
  return shortDate.format(parseDay(day));
}

/** « Octobre 2026 » */
export function formatMonth(period: string): string {
  return capitalize(monthYear.format(parseDay(`${period}-01`)));
}

/** « 29 sept. – 5 oct. 2026 » */
export function formatWeekRange(monday: string): string {
  const sunday = addDays(monday, 6);
  const sameMonth = monday.slice(0, 7) === sunday.slice(0, 7);
  const start = sameMonth ? String(parseDay(monday).getDate()) : formatDayMonth(monday);
  return `${start} – ${formatDayMonth(sunday)} ${sunday.slice(0, 4)}`;
}

export function formatClock(date: Date | null | undefined): string {
  return date ? hourMinute.format(date) : '—';
}

export function minutesOf(value: string): number {
  const [h = 0, m = 0] = value.split(':').map(Number);
  return h * 60 + m;
}

/** Durée d'un créneau, passage de minuit compris, pause déduite. */
export function shiftMinutes(startTime: string, endTime: string, breakMinutes = 0): number {
  let minutes = minutesOf(endTime) - minutesOf(startTime);
  if (minutes <= 0) minutes += 24 * 60;
  return Math.max(0, minutes - breakMinutes);
}

/** « 7 h 30 », « 45 min », « 0 h ». */
export function formatDuration(minutes: number, options: { compact?: boolean } = {}): string {
  const sign = minutes < 0 ? '−' : '';
  const abs = Math.abs(Math.round(minutes));
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  if (options.compact) return `${sign}${h}h${m ? String(m).padStart(2, '0') : ''}`;
  if (h === 0 && m > 0) return `${sign}${m} min`;
  return `${sign}${h} h${m ? ` ${String(m).padStart(2, '0')}` : ''}`;
}

/** Heures décimales « 7,5 h ». */
export function formatHours(hours: number): string {
  return `${hours.toLocaleString('fr-FR', { maximumFractionDigits: 2 })} h`;
}

export function formatDays(days: number): string {
  const value = days.toLocaleString('fr-FR', { maximumFractionDigits: 1 });
  return `${value} j`;
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

/** Jour férié légal en France métropolitaine. */
export function isHoliday(day: string): boolean {
  const year = Number(day.slice(0, 4));
  const easter = easterSunday(year);
  return [
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
  ].includes(day);
}

/**
 * Jours décomptés d'une absence (même règle que le serveur) : jours ouvrés si
 * 25 jours de congés par an, jours ouvrables sinon ; fériés exclus.
 */
export function countAbsenceDays(
  absence: { startDate: string; endDate: string; halfDayStart: boolean; halfDayEnd: boolean },
  workingDaysOnly = true,
): number {
  if (!absence.startDate || !absence.endDate || absence.endDate < absence.startDate) return 0;
  const days = daysBetween(absence.startDate, absence.endDate).filter((day) => {
    const weekday = weekdayIndex(day);
    return weekday !== 6 && !(workingDaysOnly && weekday === 5) && !isHoliday(day);
  });
  let total = days.length;
  if (absence.halfDayStart && days[0] === absence.startDate) total -= 0.5;
  if (absence.halfDayEnd && days[days.length - 1] === absence.endDate && absence.endDate !== absence.startDate) total -= 0.5;
  return Math.max(0, total);
}
