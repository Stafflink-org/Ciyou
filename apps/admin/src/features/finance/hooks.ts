// Données temps réel de la rubrique Finance.
import { useMemo } from 'react';
import { collection, limit, query, where } from 'firebase/firestore';
import { COLLECTIONS, type Payout } from '@golink/shared';
import { useCan } from '@/auth/AdminAccess';
import { useGeoScope } from '@/layout/GeoScope';
import { db } from '@/lib/firebase';
import { useCollection } from '@/lib/firestore';
import { inGeo } from '../argent-commun/hooks';

/** Reversements en échec dans le périmètre (pastille du menu). */
export function useFailedPayoutsCount(): number | null {
  const can = useCan();
  const geo = useGeoScope();
  const allowed = can('finance.view');
  const q = useMemo(() => (allowed ? query(collection(db, COLLECTIONS.payouts), where('status', '==', 'failed'), limit(100)) : null), [allowed]);
  const { data } = useCollection<Payout>(q);
  if (!allowed) return null;
  const count = data.filter((p) => inGeo(geo, p)).length;
  return count || null;
}
