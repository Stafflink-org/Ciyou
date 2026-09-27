// Données communes des rubriques Équipe & RH : annuaire de l'équipe, fiche
// salarié du compte connecté, fiches complètes (avec le droit team.view).
import { useMemo } from 'react';
import { orderBy, query } from 'firebase/firestore';
import { paths, type Employee, type StaffDirectoryEntry, type WithId } from '@golink/shared';
import { useAuth } from '@golink/web';
import { useCan, useRestaurantAccess } from '@/auth/RestaurantAccess';
import { collectionAt, useCollection } from '@/lib/firestore';

export interface StaffDirectory {
  entries: WithId<StaffDirectoryEntry>[];
  /** Salariés (fiches), actifs en premier. */
  employees: WithId<StaffDirectoryEntry>[];
  byEmployeeId: Map<string, WithId<StaffDirectoryEntry>>;
  byUid: Map<string, WithId<StaffDirectoryEntry>>;
  nameOfUid: (uid: string | null | undefined) => string;
  loading: boolean;
  error: Error | null;
}

/** Annuaire de l'établissement actif (noms, postes, couleurs) lisible par tout le personnel. */
export function useStaffDirectory(): StaffDirectory {
  const { restaurantId } = useRestaurantAccess();
  const state = useCollection<StaffDirectoryEntry>(query(collectionAt(paths.restaurantSub(restaurantId, 'staffDirectory')), orderBy('firstName')));
  return useMemo(() => {
    const entries = state.data;
    const employees = entries
      .filter((entry) => entry.kind === 'employee')
      .sort((a, b) => Number(b.active) - Number(a.active) || a.displayName.localeCompare(b.displayName, 'fr'));
    const byEmployeeId = new Map(employees.map((entry) => [entry.employeeId ?? entry.id, entry]));
    const byUid = new Map(entries.filter((entry) => entry.uid).map((entry) => [entry.uid!, entry]));
    return {
      entries,
      employees,
      byEmployeeId,
      byUid,
      nameOfUid: (uid) => (uid ? (byUid.get(uid)?.displayName ?? 'Membre de l’équipe') : '—'),
      loading: state.loading,
      error: state.error,
    };
  }, [state.data, state.loading, state.error]);
}

/** Fiche salarié reliée au compte connecté (null si aucune). */
export function useMyEmployeeId(directory: StaffDirectory): string | null {
  const { member } = useRestaurantAccess();
  const { user } = useAuth();
  if (member.employeeId && directory.byEmployeeId.has(member.employeeId)) return member.employeeId;
  const entry = user ? directory.byUid.get(user.uid) : undefined;
  return entry?.kind === 'employee' ? (entry.employeeId ?? entry.id) : null;
}

/** Fiches complètes (taux horaire, soldes…) : uniquement avec le droit team.view. */
export function useEmployees(): { data: WithId<Employee>[]; loading: boolean; error: Error | null; allowed: boolean } {
  const { restaurantId } = useRestaurantAccess();
  const can = useCan();
  const allowed = can('team.view');
  const state = useCollection<Employee>(allowed ? query(collectionAt(paths.restaurantSub(restaurantId, 'employees')), orderBy('firstName')) : null);
  return { ...state, allowed };
}
