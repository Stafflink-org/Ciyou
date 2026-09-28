// Opérations du back-office sur les commandes : motifs de refus, catégories de
// signalement, bornes des temps de préparation et libellés des événements.
import type { CancelReason, OrderEventType } from './enums';

/** Motifs proposés au restaurant pour refuser une nouvelle commande (sous-ensemble de CANCEL_REASONS). */
export const ORDER_REJECT_REASONS = ['item_unavailable', 'restaurant_closed', 'restaurant_rejected'] as const satisfies readonly CancelReason[];
export type OrderRejectReason = (typeof ORDER_REJECT_REASONS)[number];

export const ORDER_REJECT_REASON_LABELS: Record<OrderRejectReason, string> = {
  item_unavailable: 'Article indisponible',
  restaurant_closed: 'Cuisine fermée ou débordée',
  restaurant_rejected: 'Autre motif',
};

/** Motifs d'annulation par le restaurant d'une commande déjà acceptée. */
export const RESTAURANT_CANCEL_REASONS = [
  'item_unavailable',
  'customer_request',
  'customer_absent',
  'address_unreachable',
  'no_driver_available',
  'duplicate',
  'other',
] as const satisfies readonly CancelReason[];
export type RestaurantCancelReason = (typeof RESTAURANT_CANCEL_REASONS)[number];

/** Catégories d'un problème signalé par le restaurant sur une commande. */
export const ORDER_ISSUE_CATEGORIES = [
  'courier_late',
  'courier_behavior',
  'customer_unreachable',
  'wrong_address',
  'payment',
  'app_issue',
  'other',
] as const;
export type OrderIssueCategory = (typeof ORDER_ISSUE_CATEGORIES)[number];

export const ORDER_ISSUE_CATEGORY_LABELS: Record<OrderIssueCategory, string> = {
  courier_late: 'Livreur en retard ou introuvable',
  courier_behavior: 'Comportement du livreur',
  customer_unreachable: 'Client injoignable',
  wrong_address: 'Adresse de livraison erronée',
  payment: 'Problème de paiement',
  app_issue: 'Dysfonctionnement de l’application',
  other: 'Autre problème',
};

/** Identifiant du motif de ticket utilisé pour les signalements de commande du restaurant. */
export const ORDER_ISSUE_TICKET_REASON_ID = 'commande-restaurant';

/** Bornes du temps de préparation saisi à l'acceptation (minutes). */
export const PREP_MINUTES_MIN = 5;
export const PREP_MINUTES_MAX = 120;

/** Paliers proposés pour allonger une préparation en cours (minutes). */
export const PREP_EXTENSION_STEPS = [5, 10, 15] as const;

export const ORDER_EVENT_TYPE_LABELS: Record<OrderEventType, string> = {
  created: 'Commande passée',
  status_changed: 'Changement de statut',
  driver_assigned: 'Livreur attribué',
  driver_unassigned: 'Livreur retiré',
  prep_time_extended: 'Préparation prolongée',
  pickup_code_verified: 'Code de retrait vérifié',
  delivery_proof: 'Preuve de livraison',
  item_removed: 'Article retiré',
  item_replaced: 'Article remplacé',
  refund_issued: 'Remboursement',
  credit_issued: 'Avoir accordé',
  note_added: 'Note ajoutée',
  payment_updated: 'Paiement mis à jour',
  item_proposed: 'Remplacement proposé',
  driver_arrived: 'Livreur arrivé chez le client',
  customer_called: 'Client appelé',
  customer_absent: 'Client absent',
  item_weight_adjusted: 'Poids ou prix ajusté',
};
