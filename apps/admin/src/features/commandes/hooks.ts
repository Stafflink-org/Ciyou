// Lectures de la rubrique Commandes : commandes en cours du périmètre (temps réel),
// alertes « course sans livreur ».
import { useMemo } from 'react';
import { collection, limit, query, where } from 'firebase/firestore';
import { ACTIVE_ORDER_STATUSES, COLLECTIONS, type Order, type PlatformAlert } from '@golink/shared';
import { useAdminAccess } from '@/auth/AdminAccess';
import { useGeoScope } from '@/layout/GeoScope';
import { db } from '@/lib/firebase';
import { useCollection } from '@/lib/firestore';

/** Commandes en cours (statuts actifs + programmées) du périmètre, en temps réel. */
export function useActiveOrders() {
  const geo = useGeoScope();
  const ids = geo.cityIds ?? (geo.countryId ? geo.cities.filter((c) => c.countryId === geo.countryId).map((c) => c.id) : null);
  const key = ids?.join(',') ?? 'all';
  const q = useMemo(() => {
    const base = collection(db, COLLECTIONS.orders);
    const statuses = where('status', 'in', [...ACTIVE_ORDER_STATUSES, 'scheduled']);
    if (ids && ids.length === 0) return null;
    if (ids) return query(base, ids.length === 1 ? where('cityId', '==', ids[0]) : where('cityId', 'in', ids.slice(0, 4)), statuses, limit(1000));
    return query(base, statuses, limit(1000));
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return useCollection<Order>(q);
}

/** Alertes ouvertes « course sans livreur » du périmètre. */
export function useDispatchFailedAlerts(enabled = true) {
  const geo = useGeoScope();
  const key = geo.cityIds?.join(',') ?? 'all';
  const q = useMemo(() => {
    if (!enabled) return null;
    const base = [where('kind', '==', 'dispatch_failed'), where('status', 'in', ['open', 'acknowledged'])];
    if (geo.cityIds?.length) base.push(geo.cityIds.length === 1 ? where('cityId', '==', geo.cityIds[0]) : where('cityId', 'in', geo.cityIds.slice(0, 10)));
    return query(collection(db, COLLECTIONS.platformAlerts), ...base, limit(50));
  }, [key, enabled]); // eslint-disable-line react-hooks/exhaustive-deps
  return useCollection<PlatformAlert>(q);
}

/** Pastille du menu : courses sans livreur à traiter. */
export function useDispatchFailedCount(): number | null {
  const { can } = useAdminAccess();
  const allowed = can('orders.view') && can('dashboard.view');
  const alerts = useDispatchFailedAlerts(allowed).data;
  if (!allowed) return null;
  return alerts.length || null;
}
