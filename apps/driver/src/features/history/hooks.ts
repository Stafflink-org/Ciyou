// Historique réel des courses terminées du livreur connecté (orders où
// driverId == moi, status == 'delivered') — index déjà déployé (driverId,
// status, createdAt desc, firebase/firestore.indexes.json).
import { limit, orderBy, query, where } from 'firebase/firestore';
import type { DriverEarning, Order } from '@golink/shared';
import { collectionAt, docAt, useCollection, useDoc } from '../../lib/firestore';

export function useDeliveredOrders(uid: string | null, take = 50) {
  const target = uid ? query(collectionAt('orders'), where('driverId', '==', uid), where('status', '==', 'delivered'), orderBy('createdAt', 'desc'), limit(take)) : null;
  return useCollection<Order>(target);
}

export function useOrderDetail(orderId: string | null) {
  return useDoc<Order>(orderId ? docAt(`orders/${orderId}`) : null);
}

/** Gain de cette course : `driverEarnings/{orderId}` (même identifiant que la commande, voir functions/src/finance/argent/settlement.ts). */
export function useOrderEarning(orderId: string | null) {
  return useDoc<DriverEarning>(orderId ? docAt(`driverEarnings/${orderId}`) : null);
}
