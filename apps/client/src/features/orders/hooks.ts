// Historique (§12 client.md) : commandes réelles du client (orders, filtrées
// customerId, index customerId+createdAt déjà déployé), détail, avis (reviews/{orderId}).
import { collection, orderBy, query, where } from 'firebase/firestore';
import type { Order, Review } from '@golink/shared';
import { db } from '../../lib/firebase';
import { docAt, useCollection, useDoc } from '../../lib/firestore';
import { useAuth } from '../../auth/AuthContext';
import { ACTIVE_ORDER_STATUSES } from '@golink/shared';

/** Toutes les commandes du client, plus récentes d'abord. */
export function useMyOrders() {
  const { user } = useAuth();
  const q = user ? query(collection(db, 'orders'), where('customerId', '==', user.uid), orderBy('createdAt', 'desc')) : null;
  return useCollection<Order>(q);
}

export function isActiveOrder(order: Order): boolean {
  return (ACTIVE_ORDER_STATUSES as readonly string[]).includes(order.status);
}

export function useOrder(orderId: string) {
  return useDoc<Order>(docAt(`orders/${orderId}`));
}

/** Avis déjà déposé pour une commande (id du document = id de la commande), s'il existe. */
export function useOrderReview(orderId: string) {
  return useDoc<Review>(docAt(`reviews/${orderId}`));
}
