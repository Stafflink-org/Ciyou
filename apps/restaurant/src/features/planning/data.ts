// Lectures du planning d'une semaine : créneaux, absences acceptées, disponibilités,
// demandes de modification.
import { useMemo } from 'react';
import { orderBy, query, where } from 'firebase/firestore';
import {
  paths,
  type Absence,
  type EmployeeAvailability,
  type Shift,
  type ShiftChangeRequest,
  type ShiftTemplate,
  type WithId,
} from '@golink/shared';
import { useAuth } from '@golink/web';
import { useCan, useRestaurantAccess } from '@/auth/RestaurantAccess';
import { collectionAt, useCollection } from '@/lib/firestore';
import { addDays, shiftMinutes } from '../_rh/dates';

export const POSITIONS = ['Cuisine', 'Salle', 'Plonge', 'Livraison', 'Préparation', 'Caisse'];

export function useWeekShifts(monday: string) {
  const { restaurantId } = useRestaurantAccess();
  return useCollection<Shift>(
    query(collectionAt(paths.restaurantSub(restaurantId, 'shifts')), where('date', '>=', monday), where('date', '<=', addDays(monday, 6)), orderBy('date')),
  );
}

/** Absences acceptées qui chevauchent la semaine. */
export function useWeekAbsences(monday: string) {
  const { restaurantId } = useRestaurantAccess();
  const sunday = addDays(monday, 6);
  const state = useCollection<Absence>(
    query(collectionAt(paths.restaurantSub(restaurantId, 'absences')), where('status', '==', 'approved'), where('startDate', '<=', sunday), orderBy('startDate')),
  );
  const data = useMemo(() => state.data.filter((absence) => absence.endDate >= monday), [state.data, monday]);
  return { ...state, data };
}

export function useWeekAvailabilities(monday: string, enabled: boolean) {
  const { restaurantId } = useRestaurantAccess();
  return useCollection<EmployeeAvailability>(
    enabled
      ? query(collectionAt(paths.restaurantSub(restaurantId, 'availabilities')), where('date', '>=', monday), where('date', '<=', addDays(monday, 6)))
      : null,
  );
}

export function usePendingChangeRequests(enabled: boolean) {
  const { restaurantId } = useRestaurantAccess();
  return useCollection<ShiftChangeRequest>(
    enabled ? query(collectionAt(paths.restaurantSub(restaurantId, 'shiftChangeRequests')), where('status', '==', 'pending')) : null,
  );
}

export function useMyChangeRequests() {
  const { restaurantId } = useRestaurantAccess();
  const { user } = useAuth();
  return useCollection<ShiftChangeRequest>(
    user
      ? query(collectionAt(paths.restaurantSub(restaurantId, 'shiftChangeRequests')), where('employeeUid', '==', user.uid), orderBy('createdAt', 'desc'))
      : null,
  );
}

export function useShiftTemplates() {
  const { restaurantId } = useRestaurantAccess();
  const can = useCan();
  return useCollection<ShiftTemplate>(can('planning.view') ? query(collectionAt(paths.restaurantSub(restaurantId, 'shiftTemplates')), orderBy('name')) : null);
}

export function shiftDuration(shift: Pick<Shift, 'startTime' | 'endTime' | 'breakMinutes'>): number {
  return shiftMinutes(shift.startTime, shift.endTime, shift.breakMinutes);
}

/** Créneaux indexés par salarié puis par jour. */
export function groupShifts(shifts: WithId<Shift>[]): Map<string, Map<string, WithId<Shift>[]>> {
  const map = new Map<string, Map<string, WithId<Shift>[]>>();
  for (const shift of shifts) {
    const byDay = map.get(shift.employeeId) ?? new Map<string, WithId<Shift>[]>();
    const list = byDay.get(shift.date) ?? [];
    list.push(shift);
    list.sort((a, b) => a.startTime.localeCompare(b.startTime));
    byDay.set(shift.date, list);
    map.set(shift.employeeId, byDay);
  }
  return map;
}

/** Deux créneaux du même jour se chevauchent-ils ? */
export function overlaps(a: Pick<Shift, 'startTime' | 'endTime'>, b: Pick<Shift, 'startTime' | 'endTime'>): boolean {
  const range = (s: Pick<Shift, 'startTime' | 'endTime'>) => {
    const [sh = 0, sm = 0] = s.startTime.split(':').map(Number);
    const [eh = 0, em = 0] = s.endTime.split(':').map(Number);
    const start = sh * 60 + sm;
    let end = eh * 60 + em;
    if (end <= start) end += 24 * 60;
    return [start, end] as const;
  };
  const [as, ae] = range(a);
  const [bs, be] = range(b);
  return as < be && bs < ae;
}
