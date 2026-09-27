// Données temps réel de la rubrique Abonnements.
import { useMemo } from 'react';
import { collection, limit, orderBy, query } from 'firebase/firestore';
import { COLLECTIONS, type Plan, type Subscription } from '@golink/shared';
import { useCan } from '@/auth/AdminAccess';
import { useGeoScope } from '@/layout/GeoScope';
import { db } from '@/lib/firebase';
import { useCollection } from '@/lib/firestore';
import { inGeo } from '../argent-commun/hooks';

export const UNPAID_STATUSES: Subscription['status'][] = ['past_due', 'restricted', 'suspended'];

/** Tous les abonnements (volume modéré : un par commerce abonné), filtrés par périmètre. */
export function useSubscriptions() {
  const can = useCan();
  const geo = useGeoScope();
  const allowed = can('subscriptions.manage') || can('finance.view');
  const q = useMemo(() => (allowed ? query(collection(db, COLLECTIONS.subscriptions), limit(2000)) : null), [allowed]);
  const state = useCollection<Subscription>(q);
  const data = useMemo(() => state.data.filter((s) => inGeo(geo, s)), [state.data, geo]);
  return { ...state, data };
}

/** Abonnements en impayé (pastille du menu). */
export function useUnpaidSubscriptionsCount(): number | null {
  const { data } = useSubscriptions();
  return data.filter((s) => UNPAID_STATUSES.includes(s.status)).length || null;
}

/** Formules (lecture publique), dans l'ordre du catalogue. */
export function usePlans() {
  const q = useMemo(() => query(collection(db, COLLECTIONS.plans), orderBy('order')), []);
  return useCollection<Plan>(q);
}
