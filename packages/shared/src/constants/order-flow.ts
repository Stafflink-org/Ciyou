// Cycle de vie d'une commande : étapes par mode et transitions autorisées par acteur.
// Appliqué par la Cloud Function `advanceOrder` ; les apps s'en servent pour
// n'afficher que les actions possibles.
import type { FulfillmentMode, OrderActor, OrderStatus } from './enums';

export const ORDER_STEPS: Record<FulfillmentMode, readonly OrderStatus[]> = {
  delivery: ['new', 'accepted', 'preparing', 'ready', 'assigned', 'picked_up', 'delivered'],
  pickup: ['new', 'accepted', 'preparing', 'ready', 'delivered'],
  dine_in: ['new', 'accepted', 'preparing', 'ready', 'delivered'],
};

interface Transition {
  from: OrderStatus;
  to: OrderStatus;
  actors: readonly OrderActor[];
  modes: readonly FulfillmentMode[];
}

const ALL_MODES: readonly FulfillmentMode[] = ['delivery', 'pickup', 'dine_in'];

export const ORDER_TRANSITIONS: readonly Transition[] = [
  { from: 'scheduled', to: 'new', actors: ['system'], modes: ALL_MODES },
  { from: 'new', to: 'accepted', actors: ['restaurant', 'system', 'admin'], modes: ALL_MODES },
  { from: 'accepted', to: 'preparing', actors: ['restaurant', 'system', 'admin'], modes: ALL_MODES },
  { from: 'preparing', to: 'ready', actors: ['restaurant', 'admin'], modes: ALL_MODES },
  { from: 'accepted', to: 'assigned', actors: ['system', 'admin', 'restaurant'], modes: ['delivery'] },
  { from: 'preparing', to: 'assigned', actors: ['system', 'admin', 'restaurant'], modes: ['delivery'] },
  { from: 'ready', to: 'assigned', actors: ['system', 'admin', 'restaurant'], modes: ['delivery'] },
  { from: 'assigned', to: 'picked_up', actors: ['driver', 'admin'], modes: ['delivery'] },
  { from: 'picked_up', to: 'delivered', actors: ['driver', 'admin'], modes: ['delivery'] },
  // Retrait : la remise exige le code client (vérifié côté serveur).
  { from: 'ready', to: 'delivered', actors: ['restaurant', 'admin'], modes: ['pickup', 'dine_in'] },
];

/** Étapes depuis lesquelles l'annulation reste possible, par acteur. */
export const CANCELLABLE_FROM: Record<OrderActor, readonly OrderStatus[]> = {
  customer: ['scheduled', 'new', 'accepted', 'preparing'],
  restaurant: ['new', 'accepted', 'preparing', 'ready'],
  driver: [],
  admin: ['scheduled', 'new', 'accepted', 'preparing', 'ready', 'assigned', 'picked_up'],
  system: ['scheduled', 'new', 'accepted', 'preparing', 'ready', 'assigned', 'picked_up'],
};

export function canTransition(
  from: OrderStatus,
  to: OrderStatus,
  actor: OrderActor,
  mode: FulfillmentMode,
): boolean {
  if (to === 'cancelled') return CANCELLABLE_FROM[actor].includes(from);
  return ORDER_TRANSITIONS.some(
    (t) => t.from === from && t.to === to && t.actors.includes(actor) && t.modes.includes(mode),
  );
}

/** Étape suivante « normale » d'une commande (bouton principal du back-office). */
export function nextOrderStatus(current: OrderStatus, mode: FulfillmentMode): OrderStatus | null {
  const steps = ORDER_STEPS[mode];
  const index = steps.indexOf(current);
  return index >= 0 && index < steps.length - 1 ? steps[index + 1] : null;
}
