// Lectures des avis : badge de modération, noms des restaurants et livreurs.
import { useMemo } from 'react';
import { collection, limit, query, where } from 'firebase/firestore';
import { COLLECTIONS, type Driver, type Restaurant, type Review } from '@golink/shared';
import { useCan } from '@/auth/AdminAccess';
import { db } from '@/lib/firebase';
import { useCollection } from '@/lib/firestore';
import { useAdminPerimeter, useScopeFilter } from '../_experience/scope';

/** Badge : avis retenus par le filtre automatique, en attente d'une décision. */
export function useModerationQueueCount(): number | null {
  const can = useCan();
  const scope = useAdminPerimeter();
  const allowed = can('reviews.view');
  const q = useMemo(
    () => (allowed ? query(collection(db, COLLECTIONS.reviews), where('status', '==', 'pending_moderation'), ...scope.constraints, limit(99)) : null),
    [allowed, scope.key],
  );
  const { data } = useCollection<Review>(q);
  return allowed ? data.length : null;
}

/** Restaurants du périmètre (noms, villes, notes). */
export function useScopedRestaurants(enabled = true) {
  const scope = useScopeFilter();
  const q = useMemo(
    () => (enabled ? query(collection(db, COLLECTIONS.restaurants), ...scope.constraints, limit(1000)) : null),
    [enabled, scope.key],
  );
  const state = useCollection<Restaurant>(q);
  const byId = useMemo(() => new Map(state.data.map((r) => [r.id, r])), [state.data]);
  return { ...state, byId };
}

/** Livreurs du périmètre (lecture soumise à drivers.view). */
export function useScopedDrivers(enabled = true) {
  const can = useCan();
  const scope = useScopeFilter();
  const allowed = enabled && can('drivers.view');
  const q = useMemo(
    () => (allowed ? query(collection(db, COLLECTIONS.drivers), ...scope.constraints, limit(1000)) : null),
    [allowed, scope.key],
  );
  const state = useCollection<Driver>(q);
  const byId = useMemo(() => new Map(state.data.map((d) => [d.id, d])), [state.data]);
  return { ...state, byId };
}
