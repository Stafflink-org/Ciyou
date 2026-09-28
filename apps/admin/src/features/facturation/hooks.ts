// Données temps réel de la rubrique Facturation.
import { useMemo } from 'react';
import { collection, limit, query, where } from 'firebase/firestore';
import { COLLECTIONS, type Invoice } from '@golink/shared';
import { useCan } from '@/auth/AdminAccess';
import { useGeoScope } from '@/layout/GeoScope';
import { db } from '@/lib/firebase';
import { useCollection } from '@/lib/firestore';
import { inGeo } from '../argent-commun/hooks';

/** Factures en retard de paiement dans le périmètre (pastille du menu). */
export function useOverdueInvoicesCount(): number | null {
  const can = useCan();
  const geo = useGeoScope();
  const allowed = can('invoices.view');
  const q = useMemo(() => (allowed ? query(collection(db, COLLECTIONS.invoices), where('status', '==', 'overdue'), limit(100)) : null), [allowed]);
  const { data } = useCollection<Invoice>(q);
  if (!allowed) return null;
  return data.filter((i) => inGeo(geo, i)).length || null;
}
