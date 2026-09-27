import { useMemo } from 'react';
import { COLLECTIONS, type Order } from '@golink/shared';
import { useCan } from '@/auth/RestaurantAccess';
import { docAt, useDocs } from '@/lib/firestore';

/**
 * Numéros lisibles (« GL-12807 ») des commandes citées dans une liste, lus
 * seulement pour les identifiants qui n'ont pas déjà leur numéro. Sans le droit
 * de voir les commandes, la table reste vide et l'appelant garde l'identifiant.
 */
export function useOrderNumbers(orderIds: readonly (string | null | undefined)[]): Record<string, string> {
  const can = useCan();
  const allowed = can('orders.view');
  const key = allowed ? [...new Set(orderIds.filter((id): id is string => Boolean(id)))].sort().slice(0, 60).join('|') : '';
  const refs = useMemo(() => (key ? key.split('|').map((id) => docAt(`${COLLECTIONS.orders}/${id}`)) : []), [key]);
  const { data } = useDocs<Order>(refs);
  return useMemo(() => Object.fromEntries(data.filter((o) => o.number).map((o) => [o.id, o.number])), [data]);
}
