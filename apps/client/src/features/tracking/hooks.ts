// Suivi de commande réel (§11 client.md) : statut temps réel (orders/{id}),
// position du livreur si assigné (driverLocations/{driverId}, lisible par le
// client tant que son uid est dans `visibleTo` — écrit par le serveur à
// l'attribution, jamais par l'app, cf. firebase/rules/drivers.rules).
import { useMemo } from 'react';
import type { Order } from '@golink/shared';
import { docAt, useDoc } from '../../lib/firestore';

export interface DriverLocationPoint {
  lat: number;
  lng: number;
  heading?: number | null;
  updatedAt: number | null;
}

/** Commande suivie en temps réel. */
export function useTrackedOrder(orderId: string) {
  return useDoc<Order>(docAt(`orders/${orderId}`));
}

/** Position temps réel du livreur assigné (null tant qu'aucun livreur n'est assigné,
 * ou si les règles refusent la lecture — ex. livreur retiré entre-temps). */
export function useDriverLocation(driverId: string | null | undefined) {
  const { data, error } = useDoc<{
    position: { latitude: number; longitude: number };
    heading?: number | null;
    updatedAt: unknown;
  }>(driverId ? docAt(`driverLocations/${driverId}`) : null);

  return useMemo<DriverLocationPoint | null>(() => {
    if (!data || error) return null;
    return {
      lat: data.position.latitude,
      lng: data.position.longitude,
      heading: data.heading ?? null,
      updatedAt: null,
    };
  }, [data, error]);
}

const STEP_LABELS: Record<string, string> = {
  scheduled: 'Commande programmée',
  new: 'Commande envoyée',
  accepted: 'Acceptée par le restaurant',
  preparing: 'En préparation',
  ready: 'Prête',
  assigned: 'Livreur en route vers le commerce',
  picked_up: 'En route vers vous',
  delivered: 'Livrée',
  cancelled: 'Annulée',
};

export function stepLabel(status: string): string {
  return STEP_LABELS[status] ?? status;
}

/** Étapes affichées dans la frise, dans l'ordre, avec leur horodatage s'il est atteint.
 * Le retrait (`pickup`) saute les étapes de livraison (assigned/picked_up). */
export function trackingSteps(order: Order): { key: string; label: string; at: number | null; done: boolean; current: boolean }[] {
  const sequence: (keyof Order['timeline'])[] =
    order.fulfillment === 'delivery' ? ['new', 'accepted', 'preparing', 'ready', 'assigned', 'picked_up', 'delivered'] : ['new', 'accepted', 'preparing', 'ready', 'delivered'];
  const order_ = order.status === 'cancelled' ? sequence.length : sequence.indexOf(order.status as never);
  return sequence.map((key, index) => {
    const ts = order.timeline[key as keyof Order['timeline']];
    const at = ts && typeof ts === 'object' && 'toDate' in ts ? (ts as { toDate(): Date }).toDate().getTime() : null;
    return { key: key as string, label: stepLabel(key as string), at, done: index < order_ || (index === order_ && order.status === 'delivered'), current: index === order_ && order.status !== 'delivered' };
  });
}
