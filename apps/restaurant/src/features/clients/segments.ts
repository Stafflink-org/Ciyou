// Segments CRM du restaurant, calculés à partir des agrégats de la fiche client.
import type { RestaurantCustomer } from '@golink/shared';
import { toDate } from '@/lib/firestore';

export type Segment = 'all' | 'new' | 'loyal' | 'inactive' | 'blocked';

export const NEW_DAYS = 30;
export const INACTIVE_DAYS = 45;
export const LOYAL_ORDERS = 4;

const DAY = 86_400_000;

export const SEGMENTS: Array<{ value: Segment; label: string; hint: string }> = [
  { value: 'all', label: 'Tous', hint: 'Tous les clients ayant commandé chez vous.' },
  { value: 'new', label: 'Nouveaux', hint: `Première commande il y a moins de ${NEW_DAYS} jours.` },
  { value: 'loyal', label: 'Fidèles', hint: `Au moins ${LOYAL_ORDERS} commandes.` },
  { value: 'inactive', label: 'Inactifs', hint: `Aucune commande depuis ${INACTIVE_DAYS} jours.` },
  { value: 'blocked', label: 'Bloqués', hint: 'Ne peuvent plus commander dans votre établissement.' },
];

export function customerSegments(customer: RestaurantCustomer, now = Date.now()): Segment[] {
  const segments: Segment[] = ['all'];
  const first = toDate(customer.firstOrderAt)?.getTime();
  const last = toDate(customer.lastOrderAt)?.getTime();
  if (customer.blocked) segments.push('blocked');
  if (first && now - first <= NEW_DAYS * DAY) segments.push('new');
  if (customer.ordersCount >= LOYAL_ORDERS) segments.push('loyal');
  if (last && now - last > INACTIVE_DAYS * DAY) segments.push('inactive');
  return segments;
}

export const SUGGESTED_TAGS = ['Fidèle', 'VIP', 'Allergies', 'Réclamation', 'Entreprise', 'Anniversaire'];
