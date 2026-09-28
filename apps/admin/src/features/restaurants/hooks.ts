// Hooks légers de la rubrique Restaurants (pastille du menu).
import { useMemo } from 'react';
import { collection, limit, query, where } from 'firebase/firestore';
import { COLLECTIONS, type Restaurant } from '@golink/shared';
import { useAdminAccess } from '@/auth/AdminAccess';
import { db } from '@/lib/firebase';
import { useCollection } from '@/lib/firestore';

/** Dossiers en attente de validation dans le périmètre de l'administrateur. */
export function useValidationQueueCount(): number | null {
  const { admin, can } = useAdminAccess();
  const allowed = can('restaurants.validate');
  const cityKey = admin.cityIds.join(',');
  const q = useMemo(() => {
    if (!allowed) return null;
    const base = collection(db, COLLECTIONS.restaurants);
    // Responsable de ville : la lecture doit être bornée à ses villes (règles de sécurité).
    if (cityKey) return query(base, where('cityId', 'in', cityKey.split(',').slice(0, 30)), limit(500));
    return query(base, where('onboardingStatus', 'in', ['pending', 'documents_missing']), limit(200));
  }, [allowed, cityKey]);
  const { data } = useCollection<Restaurant>(q);
  if (!allowed) return null;
  return data.filter((r) => !r.deletedAt && r.onboardingStatus === 'pending').length || null;
}
