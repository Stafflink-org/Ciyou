// Calculs d'horaires côté écran : état d'ouverture à un instant donné (fuseau du
// restaurant), prochain changement, résumé lisible.
import { WEEKDAY_LABELS, minutesOfDay, type WeeklyHours } from '@golink/shared';

/** Jour (0 = lundi), minute du jour et date AAAA-MM-JJ dans le fuseau donné. */
export function zonedNow(timezone: string, date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  const weekdays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  return {
    day: Math.max(0, weekdays.indexOf(get('weekday'))),
    minute: Number(get('hour')) * 60 + Number(get('minute')),
    iso: `${get('year')}-${get('month')}-${get('day')}`,
  };
}

function slotsFor(hours: Pick<WeeklyHours, 'days' | 'exceptions'>, day: number, iso: string) {
  const exception = hours.exceptions.find((e) => e.date === iso);
  if (exception) return { slots: exception.closed ? [] : (exception.slots ?? []), exception };
  const entry = hours.days.find((d) => d.day === day);
  return { slots: entry?.open ? entry.slots : [], exception: null };
}

export function formatMinute(minute: number): string {
  const m = minute % (24 * 60);
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/** Ouvert maintenant d'après les horaires, et prochaine ouverture ou fermeture. */
export function scheduleState(hours: Pick<WeeklyHours, 'days' | 'exceptions' | 'timezone'>, date = new Date()) {
  const now = zonedNow(hours.timezone || 'Europe/Paris', date);
  const today = slotsFor(hours, now.day, now.iso);
  for (const slot of today.slots) {
    const from = minutesOfDay(slot.from) ?? 0;
    const to = minutesOfDay(slot.to, true) ?? 0;
    if (now.minute >= from && now.minute < to) {
      return { open: true, label: `Ouvert jusqu’à ${slot.to === '24:00' ? 'minuit' : slot.to}`, exception: today.exception };
    }
  }
  // Prochaine ouverture sur 7 jours.
  for (let offset = 0; offset < 8; offset += 1) {
    const d = new Date(date.getTime() + offset * 86_400_000);
    const z = zonedNow(hours.timezone || 'Europe/Paris', d);
    const { slots } = slotsFor(hours, z.day, z.iso);
    const next = [...slots]
      .map((s) => minutesOfDay(s.from) ?? 0)
      .sort((a, b) => a - b)
      .find((from) => offset > 0 || from > now.minute);
    if (next !== undefined) {
      const when = offset === 0 ? 'aujourd’hui' : offset === 1 ? 'demain' : WEEKDAY_LABELS[z.day]!.toLowerCase();
      return { open: false, label: `Ouvre ${when} à ${formatMinute(next)}`, exception: today.exception };
    }
  }
  return { open: false, label: 'Aucun créneau d’ouverture programmé', exception: today.exception };
}

/** « 11:30–14:30 · 18:30–22:30 » */
export function slotsLabel(slots: Array<{ from: string; to: string }>): string {
  if (slots.length === 0) return 'Fermé';
  return slots.map((s) => `${s.from}–${s.to === '24:00' ? '00:00' : s.to}`).join(' · ');
}
