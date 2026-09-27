// Libellés français des valeurs énumérées. Le typage Record<…> garantit qu'aucune
// valeur n'est oubliée quand une énumération évolue.
import type {
  AbsenceType,
  AccountStatus,
  AdminRole,
  Allergen,
  AlertSeverity,
  CampaignChannel,
  CampaignStatus,
  CancelReason,
  ContractType,
  DocumentStatus,
  DriverAvailability,
  DriverStatus,
  DriverType,
  EmployeeStatus,
  FeatureKey,
  FulfillmentMode,
  GdprRequestStatus,
  GdprRequestType,
  HaccpCleaningFrequency,
  HaccpNonConformityStatus,
  HaccpSeverity,
  InvoiceKind,
  InvoiceStatus,
  LegalDocumentType,
  OnboardingStatus,
  OrderStatus,
  PartnerDocumentType,
  PaymentMethod,
  PaymentStatus,
  PayoutStatus,
  PayslipStatus,
  PromotionFunding,
  PromotionKind,
  PromotionStatus,
  ProspectStage,
  RefundStatus,
  RequestStatus,
  RestaurantCourierStatus,
  RestaurantStatus,
  ReviewStatus,
  SanctionType,
  ServiceHealth,
  StaffRole,
  SubscriptionStatus,
  TaskPriority,
  TaskStatus,
  TicketPriority,
  TicketStatus,
  TimeEntryStatus,
  VatCategory,
  VehicleType,
  WeekValidationStatus,
} from './enums';
import type { RefundCause } from '../pricing/policies';
import type { ChecklistKind, CompanyDocumentCategory, EmployeeDocumentType } from './enums';
import type { Locale, MerchantType, ProductSaleUnit } from './enums';
import type { BillingMode, CourierPayModel } from '../pricing/types';

export const MERCHANT_TYPE_LABELS: Record<MerchantType, string> = {
  restaurant: 'Restaurant',
  grocery: 'Épicerie',
  bakery: 'Boulangerie',
  florist: 'Fleuriste',
  pharmacy: 'Pharmacie',
  other: 'Autre commerce',
};

export const PRODUCT_SALE_UNIT_LABELS: Record<ProductSaleUnit, string> = {
  unit: 'À l’unité',
  weight: 'Au poids (prix au kg)',
  variable: 'Prix variable',
};

export const BILLING_MODE_LABELS: Record<BillingMode, string> = {
  commission: 'Commission sur les ventes',
  subscription: 'Abonnement seul',
  hybrid: 'Abonnement et commission',
};

export const COURIER_PAY_MODEL_LABELS: Record<CourierPayModel, string> = {
  flat_then_per_km: 'Forfait sous le seuil, puis au kilomètre',
  pickup_dropoff_per_km: 'Prise en charge, remise et kilomètres (ancien barème)',
};

export const LOCALE_LABELS: Record<Locale, string> = {
  fr: 'Français',
  en: 'Anglais',
  ar: 'Arabe',
  de: 'Allemand',
  lb: 'Luxembourgeois',
  pt: 'Portugais',
};

/** Libellés des statuts de commande, côté restaurant et super admin. */
export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  scheduled: 'Programmée',
  new: 'Nouvelle',
  accepted: 'Acceptée',
  preparing: 'En préparation',
  ready: 'Prête',
  assigned: 'Livreur assigné',
  picked_up: 'En livraison',
  delivered: 'Livrée',
  cancelled: 'Annulée',
};

/** Libellés vus par le client (vocabulaire simplifié). */
export const ORDER_STATUS_CLIENT_LABELS: Record<OrderStatus, string> = {
  scheduled: 'Programmée',
  new: 'Envoyée au restaurant',
  accepted: 'Acceptée',
  preparing: 'En préparation',
  ready: 'Prête',
  assigned: 'Prête',
  picked_up: 'En route',
  delivered: 'Livrée',
  cancelled: 'Annulée',
};

/** Pour le retrait et le sur place, « livrée » se lit « remise ». */
export const ORDER_STATUS_LABELS_NON_DELIVERY: Partial<Record<OrderStatus, string>> = {
  delivered: 'Remise',
};

/** Tonalité visuelle d'un statut (les apps associent leurs couleurs). */
export type StatusTone = 'neutral' | 'info' | 'accent' | 'warning' | 'success' | 'danger';

export const ORDER_STATUS_TONES: Record<OrderStatus, StatusTone> = {
  scheduled: 'neutral',
  new: 'accent',
  accepted: 'warning',
  preparing: 'warning',
  ready: 'info',
  assigned: 'info',
  picked_up: 'info',
  delivered: 'success',
  cancelled: 'danger',
};

export const FULFILLMENT_LABELS: Record<FulfillmentMode, string> = {
  delivery: 'Livraison',
  pickup: 'Retrait',
  dine_in: 'Sur place',
};

export const CANCEL_REASON_LABELS: Record<CancelReason, string> = {
  customer_request: 'Annulée par le client',
  restaurant_rejected: 'Refusée par le restaurant',
  restaurant_timeout: 'Non acceptée dans le délai',
  restaurant_closed: 'Restaurant fermé',
  item_unavailable: 'Article indisponible',
  no_driver_available: 'Aucun livreur disponible',
  customer_absent: 'Client absent',
  address_unreachable: 'Adresse inaccessible',
  payment_failed: 'Paiement refusé',
  fraud_suspected: 'Suspicion de fraude',
  duplicate: 'Commande en double',
  other: 'Autre motif',
};

export const REFUND_CAUSE_LABELS: Record<RefundCause, string> = {
  restaurant_error: 'Erreur du restaurant',
  restaurant_cancelled: 'Annulation par le restaurant',
  restaurant_timeout: 'Restaurant sans réponse',
  item_unavailable: 'Article indisponible',
  missing_item: 'Article manquant',
  food_quality: 'Qualité du plat',
  delivery_late: 'Livraison en retard',
  delivery_issue: 'Problème de livraison',
  courier_error: 'Erreur du livreur',
  customer_absent: 'Client absent',
  customer_cancelled: 'Annulation par le client',
  commercial_gesture: 'Geste commercial',
  platform_error: 'Erreur de la plateforme',
  payment_issue: 'Incident de paiement',
};

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  card: 'Carte bancaire',
  apple_pay: 'Apple Pay',
  google_pay: 'Google Pay',
  cash: 'Espèces',
  meal_voucher: 'Titres-restaurant',
  wallet: 'Avoir GoLink',
};

export const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  pending: 'En attente',
  requires_action: 'Action requise',
  authorized: 'Autorisé',
  paid: 'Payé',
  partially_refunded: 'Remboursé en partie',
  refunded: 'Remboursé',
  failed: 'Échoué',
  cancelled: 'Annulé',
};

export const REFUND_STATUS_LABELS: Record<RefundStatus, string> = {
  requested: 'Demandé',
  pending_approval: 'En attente de validation',
  approved: 'Validé',
  processed: 'Effectué',
  rejected: 'Refusé',
  failed: 'Échoué',
};

export const PAYOUT_STATUS_LABELS: Record<PayoutStatus, string> = {
  scheduled: 'Programmé',
  processing: 'En cours',
  paid: 'Payé',
  failed: 'Échoué',
  on_hold: 'Bloqué',
  cancelled: 'Annulé',
};

export const INVOICE_KIND_LABELS: Record<InvoiceKind, string> = {
  customer_receipt: 'Reçu client',
  commission_invoice: 'Facture de commissions',
  subscription_invoice: "Facture d'abonnement",
  driver_statement: 'Relevé livreur',
  credit_note: 'Avoir',
  sponsored_invoice: 'Facture de mise en avant',
};

export const INVOICE_STATUS_LABELS: Record<InvoiceStatus, string> = {
  draft: 'Brouillon',
  issued: 'Émise',
  paid: 'Payée',
  overdue: 'En retard',
  credited: 'Annulée par avoir',
};

export const VAT_CATEGORY_LABELS: Record<VatCategory, string> = {
  food: 'Restauration',
  soft_drink: 'Boisson sans alcool',
  alcohol: 'Boisson alcoolisée (interdite)',
  grocery: 'Épicerie',
};

export const ACCOUNT_STATUS_LABELS: Record<AccountStatus, string> = {
  active: 'Actif',
  blocked: 'Bloqué',
  pending_deletion: 'Suppression demandée',
  deleted: 'Supprimé',
};

export const ONBOARDING_STATUS_LABELS: Record<OnboardingStatus, string> = {
  draft: 'Inscription en cours',
  pending: 'En attente',
  documents_missing: 'Documents manquants',
  approved: 'Validé',
  rejected: 'Refusé',
};

export const RESTAURANT_STATUS_LABELS: Record<RestaurantStatus, string> = {
  onboarding: "En cours d'inscription",
  active: 'Actif',
  paused: 'En pause',
  suspended: 'Suspendu',
  closed: 'Fermé définitivement',
};

export const DRIVER_STATUS_LABELS: Record<DriverStatus, string> = {
  onboarding: "En cours d'inscription",
  active: 'Actif',
  suspended: 'Suspendu',
  deactivated: 'Désactivé',
};

export const DRIVER_AVAILABILITY_LABELS: Record<DriverAvailability, string> = {
  offline: 'Hors ligne',
  online: 'Disponible',
  on_delivery: 'En course',
  paused: 'En pause',
};

export const DRIVER_TYPE_LABELS: Record<DriverType, string> = {
  platform: 'Livreur GoLink',
  restaurant: 'Livreur salarié du commerce',
};

export const RESTAURANT_COURIER_STATUS_LABELS: Record<RestaurantCourierStatus, string> = {
  active: 'Disponible',
  inactive: 'Indisponible',
  blocked: 'Bloqué',
};

export const VEHICLE_LABELS: Record<VehicleType, string> = {
  bike: 'Vélo',
  e_bike: 'Vélo électrique',
  cargo_bike: 'Vélo cargo',
  scooter: 'Scooter',
  motorbike: 'Moto',
  car: 'Voiture',
  on_foot: 'À pied',
};

export const SANCTION_TYPE_LABELS: Record<SanctionType, string> = {
  warning: 'Avertissement',
  temporary_suspension: 'Suspension temporaire',
  deactivation: 'Désactivation',
};

export const PARTNER_DOCUMENT_LABELS: Record<PartnerDocumentType, string> = {
  kbis: 'Extrait Kbis',
  siret_notice: 'Avis de situation SIRET',
  manager_id: "Pièce d'identité du gérant",
  bank_details: 'RIB',
  alcohol_license: 'Licence de vente d’alcool',
  hygiene_certificate: 'Attestation de formation hygiène',
  identity: "Pièce d'identité",
  residence_permit: 'Titre de séjour',
  work_permit: 'Autorisation de travail',
  siret_registration: 'Immatriculation auto-entrepreneur',
  urssaf_certificate: 'Attestation de vigilance URSSAF',
  insurance: 'Attestation d’assurance',
  driving_license: 'Permis de conduire',
  vehicle_registration: 'Carte grise',
  other: 'Autre document',
};

export const DOCUMENT_STATUS_LABELS: Record<DocumentStatus, string> = {
  pending: 'À vérifier',
  approved: 'Validé',
  rejected: 'Refusé',
  expired: 'Expiré',
};

export const SUBSCRIPTION_STATUS_LABELS: Record<SubscriptionStatus, string> = {
  trialing: "Période d'essai",
  active: 'Actif',
  past_due: 'Impayé',
  restricted: 'Restreint',
  suspended: 'Suspendu',
  cancelled: 'Résilié',
};

export const PROMOTION_KIND_LABELS: Record<PromotionKind, string> = {
  percentage: 'Pourcentage',
  fixed: 'Montant fixe',
  free_delivery: 'Livraison offerte',
};

export const PROMOTION_FUNDING_LABELS: Record<PromotionFunding, string> = {
  platform: 'GoLink',
  restaurant: 'Restaurant',
  shared: 'Partagé',
};

export const PROMOTION_STATUS_LABELS: Record<PromotionStatus, string> = {
  draft: 'Brouillon',
  pending_review: 'À valider',
  active: 'Active',
  paused: 'En pause',
  rejected: 'Refusée',
  ended: 'Terminée',
};

export const CAMPAIGN_CHANNEL_LABELS: Record<CampaignChannel, string> = {
  push: 'Notification push',
  email: 'E-mail',
  sms: 'SMS',
  in_app: 'Message dans l’app',
};

export const CAMPAIGN_STATUS_LABELS: Record<CampaignStatus, string> = {
  draft: 'Brouillon',
  scheduled: 'Programmée',
  sending: 'Envoi en cours',
  sent: 'Envoyée',
  cancelled: 'Annulée',
  failed: 'Échec',
};

export const TICKET_STATUS_LABELS: Record<TicketStatus, string> = {
  open: 'Ouvert',
  in_progress: 'En cours',
  waiting_customer: 'En attente de réponse',
  resolved: 'Résolu',
  closed: 'Fermé',
};

export const TICKET_PRIORITY_LABELS: Record<TicketPriority, string> = {
  low: 'Basse',
  normal: 'Normale',
  high: 'Haute',
  urgent: 'Urgente',
};

export const REVIEW_STATUS_LABELS: Record<ReviewStatus, string> = {
  published: 'Publié',
  pending_moderation: 'En modération',
  hidden: 'Masqué',
  removed: 'Supprimé',
};

export const PROSPECT_STAGE_LABELS: Record<ProspectStage, string> = {
  to_contact: 'À contacter',
  contacted: 'Contacté',
  demo: 'Démo',
  negotiation: 'Négociation',
  signed_up: 'Inscrit',
  lost: 'Perdu',
};

export const ADMIN_ROLE_LABELS: Record<AdminRole, string> = {
  super_admin: 'Super admin',
  support: 'Support',
  finance: 'Finance',
  sales: 'Commercial',
  ops: 'Opérations',
  city_manager: 'Responsable de ville',
};

export const STAFF_ROLE_LABELS: Record<StaffRole, string> = {
  owner: 'Propriétaire',
  manager: 'Manager',
  kitchen: 'Cuisine',
  service: 'Service',
  accountant: 'Comptabilité',
  employee: 'Employé',
  custom: 'Rôle personnalisé',
};

export const EMPLOYEE_STATUS_LABELS: Record<EmployeeStatus, string> = {
  active: 'Actif',
  inactive: 'Inactif',
  on_leave: 'En congé',
  terminated: 'Sorti des effectifs',
};

export const CONTRACT_TYPE_LABELS: Record<ContractType, string> = {
  cdi: 'CDI',
  cdd: 'CDD',
  interim: 'Intérim',
  extra: 'Extra',
  internship: 'Stage',
  apprenticeship: 'Apprentissage',
};

export const TIME_ENTRY_STATUS_LABELS: Record<TimeEntryStatus, string> = {
  open: 'En cours',
  pending: 'À valider',
  validated: 'Validé',
  corrected: 'Corrigé',
  rejected: 'Refusé',
};

export const WEEK_VALIDATION_STATUS_LABELS: Record<WeekValidationStatus, string> = {
  pending: 'À valider',
  employee_validated: 'Validée par l’employé',
  manager_validated: 'Validée par le manager',
  rejected: 'Refusée',
};

export const ABSENCE_TYPE_LABELS: Record<AbsenceType, string> = {
  paid_leave: 'Congés payés',
  unpaid_leave: 'Congé sans solde',
  sick: 'Maladie',
  rtt: 'RTT',
  training: 'Formation',
  family_event: 'Événement familial',
  other: 'Autre',
};

export const REQUEST_STATUS_LABELS: Record<RequestStatus, string> = {
  pending: 'En attente',
  approved: 'Acceptée',
  rejected: 'Refusée',
  cancelled: 'Annulée',
};

export const PAYSLIP_STATUS_LABELS: Record<PayslipStatus, string> = {
  draft: 'Brouillon',
  generated: 'Générée',
  validated: 'Validée',
  sent: 'Envoyée',
};

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  todo: 'À faire',
  in_progress: 'En cours',
  review: 'À vérifier',
  done: 'Terminée',
};

export const TASK_PRIORITY_LABELS: Record<TaskPriority, string> = {
  low: 'Basse',
  medium: 'Moyenne',
  high: 'Haute',
  urgent: 'Urgente',
};

export const CHECKLIST_KIND_LABELS: Record<ChecklistKind, string> = {
  opening: 'Ouverture',
  closing: 'Fermeture',
  service: 'Service',
  other: 'Autre',
};

export const COMPANY_DOCUMENT_CATEGORY_LABELS: Record<CompanyDocumentCategory, string> = {
  rules: 'Règlement',
  procedure: 'Procédure',
  training: 'Formation',
  legal: 'Obligations légales',
  supplier: 'Fournisseurs',
  other: 'Autre',
};

export const EMPLOYEE_DOCUMENT_TYPE_LABELS: Record<EmployeeDocumentType, string> = {
  contract: 'Contrat de travail',
  amendment: 'Avenant',
  identity: 'Pièce d’identité',
  certificate: 'Attestation',
  medical: 'Visite médicale',
  payslip: 'Bulletin de paie',
  other: 'Autre',
};

export const HACCP_SEVERITY_LABELS: Record<HaccpSeverity, string> = {
  minor: 'Mineure',
  major: 'Majeure',
  critical: 'Critique',
};

export const HACCP_NC_STATUS_LABELS: Record<HaccpNonConformityStatus, string> = {
  open: 'Ouverte',
  in_progress: 'En traitement',
  resolved: 'Résolue',
};

export const HACCP_FREQUENCY_LABELS: Record<HaccpCleaningFrequency, string> = {
  after_service: 'Après chaque service',
  daily: 'Quotidien',
  weekly: 'Hebdomadaire',
  monthly: 'Mensuel',
};

export const ALLERGEN_LABELS: Record<Allergen, string> = {
  gluten: 'Gluten',
  crustaceans: 'Crustacés',
  eggs: 'Œufs',
  fish: 'Poissons',
  peanuts: 'Arachides',
  soy: 'Soja',
  milk: 'Lait',
  nuts: 'Fruits à coque',
  celery: 'Céleri',
  mustard: 'Moutarde',
  sesame: 'Sésame',
  sulphites: 'Sulfites',
  lupin: 'Lupin',
  molluscs: 'Mollusques',
};

export const FEATURE_LABELS: Record<FeatureKey, string> = {
  delivery: 'Livraison',
  pickup: 'Retrait sur place',
  dine_in: 'Consommation sur place',
  card_payment: 'Paiement par carte',
  cash_payment: 'Paiement en espèces',
  meal_voucher: 'Titres-restaurant',
  tips: 'Pourboires',
  loyalty: 'Fidélité',
  referral: 'Parrainage',
  promotions: 'Promotions',
  driver_tracking: 'Suivi du livreur',
  stock_management: 'Gestion des stocks',
  multi_outlet: 'Multi-établissements',
  scheduled_orders: 'Commandes programmées',
  alcohol_sales: "Vente d'alcool (interdite)",
  live_chat: 'Chat en direct',
  pos_integration: 'Connexion logiciel de caisse',
  restaurant_own_drivers: 'Livreurs du restaurant',
};

export const SERVICE_HEALTH_LABELS: Record<ServiceHealth, string> = {
  operational: 'Opérationnel',
  degraded: 'Dégradé',
  partial_outage: 'Panne partielle',
  major_outage: 'Panne majeure',
  maintenance: 'Maintenance',
};

export const ALERT_SEVERITY_LABELS: Record<AlertSeverity, string> = {
  info: 'Information',
  warning: 'Attention',
  critical: 'Critique',
};

export const GDPR_REQUEST_TYPE_LABELS: Record<GdprRequestType, string> = {
  access: "Droit d'accès",
  portability: 'Portabilité',
  rectification: 'Rectification',
  erasure: 'Effacement',
  objection: 'Opposition',
};

export const GDPR_REQUEST_STATUS_LABELS: Record<GdprRequestStatus, string> = {
  received: 'Reçue',
  identity_check: "Vérification d'identité",
  in_progress: 'En cours',
  completed: 'Traitée',
  rejected: 'Refusée',
};

export const LEGAL_DOCUMENT_LABELS: Record<LegalDocumentType, string> = {
  terms_client: "Conditions générales d'utilisation",
  terms_sale: 'Conditions générales de vente',
  terms_restaurant: 'Conditions partenaires restaurants',
  terms_driver: 'Conditions partenaires livreurs',
  privacy_policy: 'Politique de confidentialité',
  cookie_policy: 'Politique cookies',
  legal_notice: 'Mentions légales',
};
