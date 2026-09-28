// Libellés du pilotage super admin : alertes, exports, rapports programmés, recherche.
import type { PlatformAlert } from '../models/admin';
import type { ExportEntity, ExportFormat, ReportFrequency, ReportKind, SearchHitType } from '../models/pilotage';
import type { AdminPermission } from '../permissions/admin';
import type { PlanCode } from '../pricing/plans';
import type { ServiceKey } from './enums';

export const PLATFORM_ALERT_KIND_LABELS: Record<PlatformAlert['kind'], string> = {
  restaurant_cancellation_rate: 'Annulations anormales',
  restaurant_rejection_rate: 'Refus de commandes',
  zone_driver_shortage: 'Manque de livreurs',
  refund_spike: 'Hausse des remboursements',
  city_order_drop: 'Chute des commandes',
  service_down: 'Service en panne',
  subscription_unpaid: 'Abonnement impayé',
  restaurant_to_validate: 'Restaurant à valider',
  driver_to_validate: 'Livreur à valider',
  document_expired: 'Document expiré',
  ticket_escalated: 'Ticket escaladé',
  review_reported: 'Avis signalé',
  gdpr_request: 'Demande RGPD',
  payout_failed: 'Reversement en échec',
  fraud_signal: 'Signal de fraude',
  menu_quality: 'Qualité des cartes',
  dispatch_failed: 'Course sans livreur',
};

export const PLATFORM_ALERT_STATUS_LABELS: Record<PlatformAlert['status'], string> = {
  open: 'À traiter',
  acknowledged: 'Pris en charge',
  resolved: 'Résolu',
  dismissed: 'Écarté',
};

export const EXPORT_ENTITY_LABELS: Record<ExportEntity, string> = {
  restaurants: 'Restaurants',
  clients: 'Clients',
  drivers: 'Livreurs',
  orders: 'Commandes',
  payouts: 'Reversements',
  invoices: 'Factures',
  subscriptions: 'Abonnements',
  stats: 'Statistiques journalières',
  tickets: 'Tickets support',
  reviews: 'Avis clients',
};

export const EXPORT_ENTITY_DESCRIPTIONS: Record<ExportEntity, string> = {
  restaurants: 'Fiche, statut, formule, note, commandes cumulées.',
  clients: 'Comptes clients, commandes, dépenses, statut.',
  drivers: 'Livreurs, véhicule, statut, performance.',
  orders: 'Commandes de la période, montants TTC, statut.',
  payouts: 'Reversements restaurants et livreurs, net versé.',
  invoices: 'Factures et avoirs émis, HT, TVA, TTC.',
  subscriptions: 'Abonnements des commerces, formule, statut.',
  stats: 'Chiffres clés jour par jour du périmètre.',
  tickets: 'Tickets du support, priorité, délais.',
  reviews: 'Avis déposés, notes et modération.',
};

/** Droit de consultation requis pour exporter chaque entité (en plus de `exports.run`). */
export const EXPORT_ENTITY_PERMISSIONS: Record<ExportEntity, AdminPermission> = {
  restaurants: 'restaurants.view',
  clients: 'customers.view',
  drivers: 'drivers.view',
  orders: 'orders.view',
  payouts: 'finance.view',
  invoices: 'invoices.view',
  subscriptions: 'finance.view',
  stats: 'analytics.view',
  tickets: 'support.view',
  reviews: 'reviews.view',
};

export const EXPORT_FORMAT_LABELS: Record<ExportFormat, string> = {
  csv: 'CSV',
  xlsx: 'Excel',
  pdf: 'PDF',
};

export const REPORT_KIND_LABELS: Record<ReportKind, string> = {
  daily_summary: 'Synthèse d’activité',
  finance: 'Finance',
  orders: 'Commandes',
  restaurants: 'Classement des restaurants',
  drivers: 'Performance des livreurs',
  support: 'Support client',
};

export const REPORT_KIND_DESCRIPTIONS: Record<ReportKind, string> = {
  daily_summary: 'Chiffres clés, évolution et alertes ouvertes.',
  finance: 'Volume d’affaires, commissions, frais, marge, remboursements.',
  orders: 'Commandes par jour et par ville, annulations, retards.',
  restaurants: 'Top et flop des restaurants par chiffre d’affaires.',
  drivers: 'Livraisons, ponctualité et annulations par livreur.',
  support: 'Tickets ouverts, résolus et délais de résolution.',
};

export const REPORT_FREQUENCY_LABELS: Record<ReportFrequency, string> = {
  daily: 'Chaque jour',
  weekly: 'Chaque lundi',
  monthly: 'Le 1er du mois',
};

export const SEARCH_HIT_TYPE_LABELS: Record<SearchHitType, string> = {
  order: 'Commandes',
  restaurant: 'Restaurants',
  client: 'Clients',
  driver: 'Livreurs',
  invoice: 'Factures',
  ticket: 'Tickets',
};

/** Libellés des services surveillés (serviceStatus). */
export const PILOTAGE_SERVICE_LABELS: Record<ServiceKey, string> = {
  client_app: 'Application client',
  driver_app: 'Application livreur',
  restaurant_backoffice: 'Back-office commerce',
  admin_backoffice: 'Super admin',
  orders: 'Prise de commande',
  payments: 'Paiements',
  notifications: 'Notifications push',
  emails: 'E-mails',
  sms: 'SMS',
  geolocation: 'Géolocalisation',
  maps: 'Cartographie',
};

/** Codes des formules d'abonnement (ordre d'affichage). Les noms viennent de la collection `plans`. */
export const PILOTAGE_PLAN_CODES: readonly PlanCode[] = ['basic', 'pro', 'premium'];
