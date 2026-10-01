// Présentation des commandes : statuts vus par le restaurant, modes, minuteurs
// et action principale attendue à chaque étape.
import type { Tone } from '@golink/ui';
import { getLocale, translate } from '@golink/web';
import {
  labelOf,
  type FulfillmentMode,
  type Order,
  type OrderStatus,
  type WithId,
} from '@golink/shared';

export type OrderRow = WithId<Order>;

/** Colonnes du service (vue « En cours »). */
export type Lane = 'new' | 'kitchen' | 'ready' | 'delivery';

export const LANES: Array<{ id: Lane; label: string; hint: string; tone: Tone }> = [
  { id: 'new', label: 'Nouvelles', hint: 'À accepter', tone: 'brand' },
  { id: 'kitchen', label: 'En cuisine', hint: 'Acceptées et en préparation', tone: 'amber' },
  { id: 'ready', label: 'Prêtes', hint: 'Au comptoir ou en attente du livreur', tone: 'teal' },
  { id: 'delivery', label: 'En livraison', hint: 'Récupérées par le livreur', tone: 'info' },
];

export function laneOf(order: Order): Lane | null {
  switch (order.status) {
    case 'new':
      return 'new';
    case 'accepted':
    case 'preparing':
      return 'kitchen';
    case 'ready':
    case 'assigned':
      return 'ready';
    case 'picked_up':
      return 'delivery';
    default:
      return null;
  }
}

export const ACTIVE_STATUSES: OrderStatus[] = ['new', 'accepted', 'preparing', 'ready', 'assigned', 'picked_up'];
export const CLOSED_STATUSES: OrderStatus[] = ['delivered', 'cancelled'];

/**
 * Tuiles de résumé du service (alignées sur la maquette de référence) :
 * « En cours » = total des commandes actives, « À traiter » = nouvelles et
 * acceptées (pas encore en préparation), « En préparation » = en cuisine,
 * « Prêtes » = prêtes ou assignées à un livreur, en attente de récupération.
 */
export type SummaryTile = 'active' | 'toHandle' | 'preparing' | 'ready';

export const SUMMARY_TILES: Array<{ id: SummaryTile; label: string; hint: string; tone: Tone; statuses: OrderStatus[] }> = [
  { id: 'active', label: 'En cours', hint: 'Total des commandes actives', tone: 'brand', statuses: ['new', 'accepted', 'preparing', 'ready', 'assigned', 'picked_up'] },
  { id: 'toHandle', label: 'À traiter', hint: 'Nouvelles et acceptées', tone: 'amber', statuses: ['new', 'accepted'] },
  { id: 'preparing', label: 'En préparation', hint: 'En cuisine', tone: 'plum', statuses: ['preparing'] },
  { id: 'ready', label: 'Prêtes', hint: 'Prêtes ou assignées à un livreur', tone: 'teal', statuses: ['ready', 'assigned'] },
];

/** Filtres par statut (file « En cours »), alignés sur la maquette de référence. */
export type StatusFilter = 'all' | OrderStatus;

export const STATUS_FILTERS: Array<{ id: StatusFilter; label: string; statuses: OrderStatus[] | null }> = [
  { id: 'all', label: 'Tous les statuts', statuses: null },
  { id: 'new', label: 'Nouvelles', statuses: ['new'] },
  { id: 'accepted', label: 'Acceptées', statuses: ['accepted'] },
  { id: 'preparing', label: 'En préparation', statuses: ['preparing'] },
  { id: 'ready', label: 'Prêtes', statuses: ['ready'] },
  { id: 'assigned', label: 'Assignées', statuses: ['assigned'] },
  { id: 'picked_up', label: 'En livraison', statuses: ['picked_up'] },
];

const STATUS_TONES: Record<OrderStatus, Tone> = {
  scheduled: 'plum',
  new: 'brand',
  accepted: 'neutral',
  preparing: 'amber',
  ready: 'teal',
  assigned: 'teal',
  picked_up: 'info',
  delivered: 'success',
  cancelled: 'danger',
};

export function statusMeta(order: Pick<Order, 'status' | 'fulfillment'>): { label: string; tone: Tone; pulse: boolean } {
  const locale = getLocale();
  const label =
    order.fulfillment !== 'delivery'
      ? order.status === 'delivered'
        ? translate('accueil:status.handedOver', undefined, locale)
        : order.status === 'ready'
          ? translate('accueil:status.readyAtCounter', undefined, locale)
          : labelOf('ORDER_STATUS_LABELS', order.status, locale)
      : labelOf('ORDER_STATUS_LABELS', order.status, locale);
  return { label, tone: STATUS_TONES[order.status], pulse: order.status === 'new' || order.status === 'picked_up' };
}

export const FULFILLMENT_TONES: Record<FulfillmentMode, Tone> = { delivery: 'info', pickup: 'amber', dine_in: 'plum' };

export function fulfillmentLabel(mode: FulfillmentMode): string {
  return mode === 'pickup' ? translate('accueil:fulfillment.pickup') : labelOf('FULFILLMENT_LABELS', mode, getLocale());
}

/** Paiement en attente d'authentification : la commande n'est pas encore transmise. */
export function isAwaitingPayment(order: Order): boolean {
  return order.status === 'new' && (order.payment.status === 'requires_action' || (order.payment.status === 'pending' && order.payment.method !== 'cash'));
}

function ms(value: { toMillis(): number } | null | undefined): number | null {
  return value ? value.toMillis() : null;
}

/** Heure de fin de préparation prévue (ms), selon le temps annoncé et les prolongations. */
export function readyAtMs(order: Order): number | null {
  const start = ms(order.timeline.preparing) ?? ms(order.timeline.accepted);
  if (start === null) return null;
  return start + (order.prepMinutes + order.prepExtendedMinutes) * 60_000;
}

export interface Countdown {
  /** Secondes restantes (négatif = dépassé). */
  seconds: number;
  /** Durée totale de référence (secondes), pour la jauge. */
  total: number;
  kind: 'accept' | 'prep' | 'pickup' | 'delivery';
}

/** Minuteur affiché sur une commande en cours, selon son étape. */
export function countdownOf(order: Order, now: number): Countdown | null {
  if (order.status === 'new') {
    const deadline = ms(order.acceptDeadline);
    const placed = ms(order.timeline.new) ?? ms(order.createdAt) ?? now;
    if (deadline === null) return null;
    return { seconds: Math.round((deadline - now) / 1000), total: Math.max(60, Math.round((deadline - placed) / 1000)), kind: 'accept' };
  }
  if (order.status === 'accepted' || order.status === 'preparing') {
    const readyAt = readyAtMs(order);
    if (readyAt === null) return null;
    return { seconds: Math.round((readyAt - now) / 1000), total: (order.prepMinutes + order.prepExtendedMinutes) * 60, kind: 'prep' };
  }
  if ((order.status === 'ready' || order.status === 'assigned') && order.fulfillment === 'delivery') {
    return null;
  }
  if (order.status === 'picked_up') {
    const eta = ms(order.delivery?.estimatedArrivalAt) ?? ms(order.delivery?.promisedTo);
    const picked = ms(order.timeline.picked_up) ?? now;
    if (eta === null) return null;
    return { seconds: Math.round((eta - now) / 1000), total: Math.max(60, Math.round((eta - picked) / 1000)), kind: 'delivery' };
  }
  return null;
}

/** « 04:32 », « −02:10 ». */
export function formatCountdown(seconds: number): string {
  const sign = seconds < 0 ? '−' : '';
  const abs = Math.abs(seconds);
  const m = Math.floor(abs / 60);
  const s = abs % 60;
  return `${sign}${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/** Minutes écoulées depuis la commande, en texte court. */
export function elapsedLabel(order: Order, now: number): string {
  const placed = ms(order.createdAt) ?? now;
  const minutes = Math.max(0, Math.floor((now - placed) / 60_000));
  if (minutes < 1) return 'à l’instant';
  if (minutes < 60) return `il y a ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return `il y a ${hours} h ${String(minutes % 60).padStart(2, '0')}`;
}

/** Nombre total d'articles, options comprises (lecture cuisine). */
export function itemsSummary(order: Order): string {
  return order.items.map((i) => `${i.quantity}× ${i.name}`).join(' · ');
}

export function orderMatches(order: OrderRow, term: string): boolean {
  const t = term.trim().toLocaleLowerCase('fr');
  if (!t) return true;
  const hay = [order.number, order.customerName, order.delivery?.address.line1, order.delivery?.address.city, order.delivery?.driverName, ...order.items.map((i) => i.name)]
    .filter(Boolean)
    .join(' ')
    .toLocaleLowerCase('fr')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
  return hay.includes(t.normalize('NFD').replace(/[̀-ͯ]/g, ''));
}
