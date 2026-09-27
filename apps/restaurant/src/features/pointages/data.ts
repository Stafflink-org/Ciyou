// Lectures et calculs des pointages (heure locale du navigateur).
import { orderBy, query, where } from 'firebase/firestore';
import { paths, type TimeEntry, type WeekValidation, type WithId } from '@golink/shared';
import { useAuth } from '@golink/web';
import { useRestaurantAccess } from '@/auth/RestaurantAccess';
import { collectionAt, toDate, useCollection } from '@/lib/firestore';
import { addDays } from '../_rh/dates';

export function useTeamWeekEntries(monday: string, enabled: boolean) {
  const { restaurantId } = useRestaurantAccess();
  return useCollection<TimeEntry>(
    enabled
      ? query(collectionAt(paths.restaurantSub(restaurantId, 'timeEntries')), where('date', '>=', monday), where('date', '<=', addDays(monday, 6)), orderBy('date'))
      : null,
  );
}

export function useWeekValidations(monday: string, enabled: boolean) {
  const { restaurantId } = useRestaurantAccess();
  return useCollection<WeekValidation>(enabled ? query(collectionAt(paths.restaurantSub(restaurantId, 'weekValidations')), where('weekStart', '==', monday)) : null);
}

/** Pointages du compte connecté de la veille du lundi au dimanche (service de nuit compris). */
export function useMyEntries(monday: string, enabled: boolean) {
  const { restaurantId } = useRestaurantAccess();
  const { user } = useAuth();
  return useCollection<TimeEntry>(
    enabled && user
      ? query(
          collectionAt(paths.restaurantSub(restaurantId, 'timeEntries')),
          where('employeeUid', '==', user.uid),
          where('date', '>=', addDays(monday, -1)),
          where('date', '<=', addDays(monday, 6)),
          orderBy('date', 'desc'),
        )
      : null,
  );
}

export function useMyWeekValidations(enabled: boolean) {
  const { restaurantId } = useRestaurantAccess();
  const { user } = useAuth();
  return useCollection<WeekValidation>(
    enabled && user
      ? query(collectionAt(paths.restaurantSub(restaurantId, 'weekValidations')), where('employeeUid', '==', user.uid), orderBy('weekStart', 'desc'))
      : null,
  );
}

export type ClockState = 'off' | 'working' | 'on_break' | 'done';

export function clockState(entry: TimeEntry | null | undefined): ClockState {
  if (!entry?.clockIn) return 'off';
  if (entry.clockOut) return 'done';
  return entry.breaks.some((b) => !b.end) ? 'on_break' : 'working';
}

/** Minutes travaillées, calculées en direct pour un service en cours. */
export function liveWorkedMinutes(entry: TimeEntry, now: number): number {
  if (entry.clockOut) return entry.workedMinutes;
  const start = toDate(entry.clockIn?.at)?.getTime();
  if (!start) return 0;
  const pauses = entry.breaks.reduce((total, pause) => {
    const s = toDate(pause.start)?.getTime() ?? now;
    const e = toDate(pause.end)?.getTime() ?? now;
    return total + Math.max(0, e - s);
  }, 0);
  return Math.max(0, Math.floor((now - start - pauses) / 60_000));
}

export function breakMinutes(entry: TimeEntry, now = Date.now()): number {
  return Math.round(
    entry.breaks.reduce((total, pause) => {
      const s = toDate(pause.start)?.getTime() ?? now;
      const e = toDate(pause.end)?.getTime() ?? now;
      return total + Math.max(0, e - s);
    }, 0) / 60_000,
  );
}

export function entriesByEmployee(entries: WithId<TimeEntry>[]): Map<string, WithId<TimeEntry>[]> {
  const map = new Map<string, WithId<TimeEntry>[]>();
  for (const entry of entries) {
    const list = map.get(entry.employeeId) ?? [];
    list.push(entry);
    map.set(entry.employeeId, list);
  }
  return map;
}
