// Entités exportables : icône, champ de date filtré, statuts proposés, formule.
import type { ReactNode } from 'react';
import { BarChart3, Bike, CreditCard, FileText, LifeBuoy, PiggyBank, ShoppingBag, Star, Store, Users } from 'lucide-react';
import {
  DRIVER_STATUS_LABELS,
  INVOICE_STATUS_LABELS,
  ORDER_STATUS_LABELS,
  PAYOUT_STATUS_LABELS,
  RESTAURANT_STATUS_LABELS,
  REVIEW_STATUS_LABELS,
  SUBSCRIPTION_STATUS_LABELS,
  TICKET_STATUS_LABELS,
  type ExportEntity,
} from '@golink/shared';

const CLIENT_STATUS_LABELS: Record<string, string> = { active: 'Actif', blocked: 'Bloqué', pending_deletion: 'Suppression demandée' };

export interface EntityConfig {
  icon: ReactNode;
  /** Libellé du champ de date filtré par la période ; null = pas de période. */
  dateField: string | null;
  statuses: Record<string, string> | null;
  plan: boolean;
  /** Données personnelles : un motif est demandé. */
  personal: boolean;
}

export const ENTITY_CONFIG: Record<ExportEntity, EntityConfig> = {
  restaurants: { icon: <Store />, dateField: null, statuses: RESTAURANT_STATUS_LABELS, plan: true, personal: false },
  clients: { icon: <Users />, dateField: 'date d’inscription', statuses: CLIENT_STATUS_LABELS, plan: false, personal: true },
  drivers: { icon: <Bike />, dateField: null, statuses: DRIVER_STATUS_LABELS, plan: false, personal: true },
  orders: { icon: <ShoppingBag />, dateField: 'date de commande', statuses: ORDER_STATUS_LABELS, plan: false, personal: false },
  payouts: { icon: <PiggyBank />, dateField: 'date de reversement prévue', statuses: PAYOUT_STATUS_LABELS, plan: false, personal: false },
  invoices: { icon: <FileText />, dateField: 'date d’émission', statuses: INVOICE_STATUS_LABELS, plan: false, personal: false },
  subscriptions: { icon: <CreditCard />, dateField: null, statuses: SUBSCRIPTION_STATUS_LABELS, plan: true, personal: false },
  stats: { icon: <BarChart3 />, dateField: 'jour', statuses: null, plan: false, personal: false },
  tickets: { icon: <LifeBuoy />, dateField: 'date d’ouverture', statuses: TICKET_STATUS_LABELS, plan: false, personal: false },
  reviews: { icon: <Star />, dateField: 'date de dépôt', statuses: REVIEW_STATUS_LABELS, plan: false, personal: false },
};

export const ENTITY_ORDER: ExportEntity[] = [
  'orders',
  'restaurants',
  'clients',
  'drivers',
  'payouts',
  'invoices',
  'subscriptions',
  'stats',
  'tickets',
  'reviews',
];
