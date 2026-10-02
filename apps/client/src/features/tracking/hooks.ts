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

// Les libellés viennent du namespace i18n `tracking` (clés `steps.<status>`) ; `stepLabel`/
// `trackingSteps` prennent une fonction de traduction en paramètre (appelées depuis un composant,
// pas un hook, pour rester utilisables hors contexte React si besoin — ex. tests).
export function stepLabel(status: string, t: (key: string) => string): string {
  const label = t(`tracking:steps.${status}`);
  return label === `tracking:steps.${status}` ? status : label;
}

/** Étapes affichées dans la frise, dans l'ordre, avec leur horodatage s'il est atteint.
 * Le retrait (`pickup`) saute les étapes de livraison (assigned/picked_up). */
export function trackingSteps(order: Order, t: (key: string) => string): { key: string; label: string; at: number | null; done: boolean; current: boolean }[] {
  const sequence: (keyof Order['timeline'])[] =
    order.fulfillment === 'delivery' ? ['new', 'accepted', 'preparing', 'ready', 'assigned', 'picked_up', 'delivered'] : ['new', 'accepted', 'preparing', 'ready', 'delivered'];
  // Annulée : plus aucune étape « en cours », et seules les étapes réellement atteintes avant
  // l'annulation (horodatage présent) sont marquées atteintes — pas « livré » par défaut, sinon la
  // frise affichait une progression complète jusqu'à la livraison pour une commande annulée.
  const cancelled = order.status === 'cancelled';
  const order_ = cancelled
    ? sequence.reduce((last, key, index) => (order.timeline[key as keyof Order['timeline']] ? index : last), -1)
    : sequence.indexOf(order.status as never);
  return sequence.map((key, index) => {
    const ts = order.timeline[key as keyof Order['timeline']];
    const at = ts && typeof ts === 'object' && 'toDate' in ts ? (ts as { toDate(): Date }).toDate().getTime() : null;
    const done = cancelled ? index <= order_ : index < order_ || (index === order_ && order.status === 'delivered');
    const current = !cancelled && index === order_ && order.status !== 'delivered';
    return { key: key as string, label: stepLabel(key as string, t), at, done, current };
  });
}
