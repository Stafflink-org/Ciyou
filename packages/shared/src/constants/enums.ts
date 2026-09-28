// Valeurs énumérées stockées en base (anglais, snake_case). Chaque liste est la
// source des types correspondants ; les libellés français sont dans labels.ts.

const values = <const T extends readonly string[]>(list: T): T => list;

// ------------------------------------------------------------------ Rôles
export const USER_ROLES = values(['client', 'driver', 'restaurant', 'admin']);
export type UserRole = (typeof USER_ROLES)[number];

export const ADMIN_ROLES = values(['super_admin', 'support', 'finance', 'sales', 'ops', 'city_manager']);
export type AdminRole = (typeof ADMIN_ROLES)[number];

export const STAFF_ROLES = values(['owner', 'manager', 'kitchen', 'service', 'accountant', 'employee', 'custom']);
export type StaffRole = (typeof STAFF_ROLES)[number];

// ------------------------------------------------------------------ Comptes
export const ACCOUNT_STATUSES = values(['active', 'blocked', 'pending_deletion', 'deleted']);
export type AccountStatus = (typeof ACCOUNT_STATUSES)[number];

/** Parcours de validation d'un partenaire (restaurant ou livreur). */
export const ONBOARDING_STATUSES = values(['draft', 'pending', 'documents_missing', 'approved', 'rejected']);
export type OnboardingStatus = (typeof ONBOARDING_STATUSES)[number];

export const RESTAURANT_STATUSES = values(['onboarding', 'active', 'paused', 'suspended', 'closed']);
export type RestaurantStatus = (typeof RESTAURANT_STATUSES)[number];

export const DRIVER_STATUSES = values(['onboarding', 'active', 'suspended', 'deactivated']);
export type DriverStatus = (typeof DRIVER_STATUSES)[number];

export const DRIVER_AVAILABILITIES = values(['offline', 'online', 'on_delivery', 'paused']);
export type DriverAvailability = (typeof DRIVER_AVAILABILITIES)[number];

/** `restaurant` = livreur salarié du commerce (« merchant »), `platform` = indépendant Ciyou Eats. */
export const DRIVER_TYPES = values(['platform', 'restaurant']);
export type DriverType = (typeof DRIVER_TYPES)[number];

/** Types de commerces (le « restaurant » des modèles désigne tout commerce). */
export const MERCHANT_TYPES = values(['restaurant', 'grocery', 'bakery', 'florist', 'pharmacy', 'other']);
export type MerchantType = (typeof MERCHANT_TYPES)[number];

/** Mode de vente d'un produit : à l'unité, au poids (prix au kg) ou à prix variable (ajusté à la préparation). */
export const PRODUCT_SALE_UNITS = values(['unit', 'weight', 'variable']);
export type ProductSaleUnit = (typeof PRODUCT_SALE_UNITS)[number];

export const VEHICLE_TYPES = values(['bike', 'e_bike', 'cargo_bike', 'scooter', 'motorbike', 'car', 'on_foot']);
export type VehicleType = (typeof VEHICLE_TYPES)[number];

/** Statut d'un livreur vu par un restaurant (livreurs propres ou préférences). */
export const RESTAURANT_COURIER_STATUSES = values(['active', 'inactive', 'blocked']);
export type RestaurantCourierStatus = (typeof RESTAURANT_COURIER_STATUSES)[number];

export const SANCTION_TYPES = values(['warning', 'temporary_suspension', 'deactivation']);
export type SanctionType = (typeof SANCTION_TYPES)[number];

export const SANCTION_STATUSES = values(['active', 'contested', 'upheld', 'overturned', 'expired']);
export type SanctionStatus = (typeof SANCTION_STATUSES)[number];

// ------------------------------------------------------------------ Documents partenaires
export const PARTNER_DOCUMENT_TYPES = values([
  // Restaurant
  'kbis',
  'siret_notice',
  'manager_id',
  'bank_details',
  'alcohol_license',
  'hygiene_certificate',
  // Livreur
  'identity',
  'residence_permit',
  'work_permit',
  'siret_registration',
  'urssaf_certificate',
  'insurance',
  'driving_license',
  'vehicle_registration',
  'other',
]);
export type PartnerDocumentType = (typeof PARTNER_DOCUMENT_TYPES)[number];

export const DOCUMENT_STATUSES = values(['pending', 'approved', 'rejected', 'expired']);
export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number];

// ------------------------------------------------------------------ Commandes
export const ORDER_STATUSES = values([
  'scheduled',
  'new',
  'accepted',
  'preparing',
  'ready',
  'assigned',
  'picked_up',
  'delivered',
  'cancelled',
]);
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const ACTIVE_ORDER_STATUSES: readonly OrderStatus[] = [
  'new',
  'accepted',
  'preparing',
  'ready',
  'assigned',
  'picked_up',
];
export const TERMINAL_ORDER_STATUSES: readonly OrderStatus[] = ['delivered', 'cancelled'];

export const FULFILLMENT_MODES = values(['delivery', 'pickup', 'dine_in']);
export type FulfillmentMode = (typeof FULFILLMENT_MODES)[number];

export const ORDER_ACTORS = values(['customer', 'restaurant', 'driver', 'admin', 'system']);
export type OrderActor = (typeof ORDER_ACTORS)[number];

export const CANCEL_REASONS = values([
  'customer_request',
  'restaurant_rejected',
  'restaurant_timeout',
  'restaurant_closed',
  'item_unavailable',
  'no_driver_available',
  'customer_absent',
  'address_unreachable',
  'payment_failed',
  'fraud_suspected',
  'duplicate',
  'other',
]);
export type CancelReason = (typeof CANCEL_REASONS)[number];

export const ORDER_EVENT_TYPES = values([
  'created',
  'status_changed',
  'driver_assigned',
  'driver_unassigned',
  'prep_time_extended',
  'pickup_code_verified',
  'delivery_proof',
  'item_removed',
  'item_replaced',
  'refund_issued',
  'credit_issued',
  'note_added',
  'payment_updated',
  'item_proposed',
  'driver_arrived',
  'customer_called',
  'customer_absent',
  'item_weight_adjusted',
]);
export type OrderEventType = (typeof ORDER_EVENT_TYPES)[number];

export const DISPATCH_OFFER_STATUSES = values(['offered', 'accepted', 'declined', 'expired', 'cancelled']);
export type DispatchOfferStatus = (typeof DISPATCH_OFFER_STATUSES)[number];

// ------------------------------------------------------------------ Paiements et finance
export const PAYMENT_METHODS = values(['card', 'apple_pay', 'google_pay', 'cash', 'meal_voucher', 'wallet']);
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const PAYMENT_STATUSES = values([
  'pending',
  'requires_action',
  'authorized',
  'paid',
  'partially_refunded',
  'refunded',
  'failed',
  'cancelled',
]);
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const REFUND_STATUSES = values(['requested', 'pending_approval', 'approved', 'processed', 'rejected', 'failed']);
export type RefundStatus = (typeof REFUND_STATUSES)[number];

export const REFUND_METHODS = values(['original_payment', 'wallet_credit']);
export type RefundMethod = (typeof REFUND_METHODS)[number];

export const LEDGER_ACCOUNT_TYPES = values(['restaurant', 'driver', 'driver_cash', 'platform', 'customer_wallet']);
export type LedgerAccountType = (typeof LEDGER_ACCOUNT_TYPES)[number];

export const LEDGER_ENTRY_TYPES = values([
  'order_revenue',
  'commission',
  'promo_funded',
  'delivery_fee',
  'payment_fee',
  'courier_earning',
  'courier_tip',
  'courier_bonus',
  'hourly_guarantee_topup',
  'refund_charge',
  'wallet_credit',
  'wallet_debit',
  'subscription_fee',
  'sponsored_placement',
  'cash_collected',
  'cash_remitted',
  'manual_adjustment',
  'payout',
  'payout_reversal',
]);
export type LedgerEntryType = (typeof LEDGER_ENTRY_TYPES)[number];

export const PAYOUT_STATUSES = values(['scheduled', 'processing', 'paid', 'failed', 'on_hold', 'cancelled']);
export type PayoutStatus = (typeof PAYOUT_STATUSES)[number];

export const PAYOUT_FREQUENCIES = values(['weekly', 'biweekly', 'monthly']);
export type PayoutFrequency = (typeof PAYOUT_FREQUENCIES)[number];

export const INVOICE_KINDS = values([
  'customer_receipt',
  'commission_invoice',
  'subscription_invoice',
  'driver_statement',
  'credit_note',
  'sponsored_invoice',
]);
export type InvoiceKind = (typeof INVOICE_KINDS)[number];

export const INVOICE_STATUSES = values(['draft', 'issued', 'paid', 'overdue', 'credited']);
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

export const VAT_CATEGORIES = values(['food', 'soft_drink', 'alcohol', 'grocery']);
export type VatCategory = (typeof VAT_CATEGORIES)[number];

/** Catégories interdites (décision client : vente d'alcool interdite). Conservées pour la compatibilité des données. */
export const FORBIDDEN_VAT_CATEGORIES: readonly VatCategory[] = ['alcohol'];
/** Catégories proposées à la saisie d'un produit. */
export const SELECTABLE_VAT_CATEGORIES: readonly VatCategory[] = VAT_CATEGORIES.filter((c) => !FORBIDDEN_VAT_CATEGORIES.includes(c));
export function isVatCategorySelectable(category: VatCategory): boolean {
  return !FORBIDDEN_VAT_CATEGORIES.includes(category);
}

// ------------------------------------------------------------------ Abonnements
export const SUBSCRIPTION_STATUSES = values(['trialing', 'active', 'past_due', 'restricted', 'suspended', 'cancelled']);
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

export const COMMISSION_SCOPES = values(['country', 'city', 'plan', 'group', 'restaurant']);
export type CommissionScope = (typeof COMMISSION_SCOPES)[number];

// ------------------------------------------------------------------ Marketing
export const PROMOTION_SCOPES = values(['platform', 'country', 'city', 'restaurant']);
export type PromotionScope = (typeof PROMOTION_SCOPES)[number];

export const PROMOTION_KINDS = values(['percentage', 'fixed', 'free_delivery']);
export type PromotionKind = (typeof PROMOTION_KINDS)[number];

export const PROMOTION_FUNDINGS = values(['platform', 'restaurant', 'shared']);
export type PromotionFunding = (typeof PROMOTION_FUNDINGS)[number];

export const PROMOTION_TARGETS = values(['everyone', 'new_customers', 'inactive_customers', 'loyal_customers']);
export type PromotionTarget = (typeof PROMOTION_TARGETS)[number];

export const PROMOTION_STATUSES = values(['draft', 'pending_review', 'active', 'paused', 'rejected', 'ended']);
export type PromotionStatus = (typeof PROMOTION_STATUSES)[number];

export const CAMPAIGN_CHANNELS = values(['push', 'email', 'sms', 'in_app']);
export type CampaignChannel = (typeof CAMPAIGN_CHANNELS)[number];

export const CAMPAIGN_STATUSES = values(['draft', 'scheduled', 'sending', 'sent', 'cancelled', 'failed']);
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];

export const REFERRAL_STATUSES = values(['pending', 'qualified', 'rewarded', 'expired', 'rejected']);
export type ReferralStatus = (typeof REFERRAL_STATUSES)[number];

// ------------------------------------------------------------------ Support et avis
export const TICKET_STATUSES = values(['open', 'in_progress', 'waiting_customer', 'resolved', 'closed']);
export type TicketStatus = (typeof TICKET_STATUSES)[number];

export const TICKET_PRIORITIES = values(['low', 'normal', 'high', 'urgent']);
export type TicketPriority = (typeof TICKET_PRIORITIES)[number];

export const TICKET_REQUESTER_TYPES = values(['client', 'restaurant', 'driver']);
export type TicketRequesterType = (typeof TICKET_REQUESTER_TYPES)[number];

export const REVIEW_STATUSES = values(['published', 'pending_moderation', 'hidden', 'removed']);
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

export const REPORT_STATUSES = values(['open', 'under_review', 'actioned', 'dismissed']);
export type ReportStatus = (typeof REPORT_STATUSES)[number];

// ------------------------------------------------------------------ CRM
export const PROSPECT_STAGES = values(['to_contact', 'contacted', 'demo', 'negotiation', 'signed_up', 'lost']);
export type ProspectStage = (typeof PROSPECT_STAGES)[number];

// ------------------------------------------------------------------ Équipe (gestion d'entreprise)
export const EMPLOYEE_STATUSES = values(['active', 'inactive', 'on_leave', 'terminated']);
export type EmployeeStatus = (typeof EMPLOYEE_STATUSES)[number];

export const CONTRACT_TYPES = values(['cdi', 'cdd', 'interim', 'extra', 'internship', 'apprenticeship']);
export type ContractType = (typeof CONTRACT_TYPES)[number];

export const TIME_ENTRY_STATUSES = values(['open', 'pending', 'validated', 'corrected', 'rejected']);
export type TimeEntryStatus = (typeof TIME_ENTRY_STATUSES)[number];

export const WEEK_VALIDATION_STATUSES = values(['pending', 'employee_validated', 'manager_validated', 'rejected']);
export type WeekValidationStatus = (typeof WEEK_VALIDATION_STATUSES)[number];

export const ABSENCE_TYPES = values(['paid_leave', 'unpaid_leave', 'sick', 'rtt', 'training', 'family_event', 'other']);
export type AbsenceType = (typeof ABSENCE_TYPES)[number];

export const REQUEST_STATUSES = values(['pending', 'approved', 'rejected', 'cancelled']);
export type RequestStatus = (typeof REQUEST_STATUSES)[number];

export const PAYSLIP_STATUSES = values(['draft', 'generated', 'validated', 'sent']);
export type PayslipStatus = (typeof PAYSLIP_STATUSES)[number];

export const TASK_STATUSES = values(['todo', 'in_progress', 'review', 'done']);
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_PRIORITIES = values(['low', 'medium', 'high', 'urgent']);
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

/** Checklists du service : ouverture, fermeture, pendant le service, autre. */
export const CHECKLIST_KINDS = values(['opening', 'closing', 'service', 'other']);
export type ChecklistKind = (typeof CHECKLIST_KINDS)[number];

/** Catégories des documents de l'entreprise. */
export const COMPANY_DOCUMENT_CATEGORIES = values(['rules', 'procedure', 'training', 'legal', 'supplier', 'other']);
export type CompanyDocumentCategory = (typeof COMPANY_DOCUMENT_CATEGORIES)[number];

/** Types de documents salariés. */
export const EMPLOYEE_DOCUMENT_TYPES = values(['contract', 'amendment', 'identity', 'certificate', 'medical', 'payslip', 'other']);
export type EmployeeDocumentType = (typeof EMPLOYEE_DOCUMENT_TYPES)[number];

// ------------------------------------------------------------------ HACCP
export const HACCP_SEVERITIES = values(['minor', 'major', 'critical']);
export type HaccpSeverity = (typeof HACCP_SEVERITIES)[number];

export const HACCP_NC_STATUSES = values(['open', 'in_progress', 'resolved']);
export type HaccpNonConformityStatus = (typeof HACCP_NC_STATUSES)[number];

export const HACCP_CLEANING_FREQUENCIES = values(['after_service', 'daily', 'weekly', 'monthly']);
export type HaccpCleaningFrequency = (typeof HACCP_CLEANING_FREQUENCIES)[number];

export const HACCP_RECEPTION_STATUSES = values(['pending', 'accepted', 'refused']);
export type HaccpReceptionStatus = (typeof HACCP_RECEPTION_STATUSES)[number];

/** Les 14 allergènes réglementaires (règlement UE 1169/2011, annexe II). */
export const ALLERGENS = values([
  'gluten',
  'crustaceans',
  'eggs',
  'fish',
  'peanuts',
  'soy',
  'milk',
  'nuts',
  'celery',
  'mustard',
  'sesame',
  'sulphites',
  'lupin',
  'molluscs',
]);
export type Allergen = (typeof ALLERGENS)[number];

// ------------------------------------------------------------------ Plateforme
export const FEATURE_KEYS = values([
  'delivery',
  'pickup',
  'dine_in',
  'card_payment',
  'cash_payment',
  'meal_voucher',
  'tips',
  'loyalty',
  'referral',
  'promotions',
  'driver_tracking',
  'stock_management',
  'multi_outlet',
  'scheduled_orders',
  'alcohol_sales',
  'live_chat',
  'pos_integration',
  'restaurant_own_drivers',
]);
export type FeatureKey = (typeof FEATURE_KEYS)[number];

export const FEATURE_SCOPES = values(['platform', 'country', 'city', 'plan', 'restaurant']);
export type FeatureScope = (typeof FEATURE_SCOPES)[number];

export const SERVICE_KEYS = values([
  'client_app',
  'driver_app',
  'restaurant_backoffice',
  'admin_backoffice',
  'orders',
  'payments',
  'notifications',
  'emails',
  'sms',
  'geolocation',
  'maps',
]);
export type ServiceKey = (typeof SERVICE_KEYS)[number];

export const SERVICE_HEALTH = values(['operational', 'degraded', 'partial_outage', 'major_outage', 'maintenance']);
export type ServiceHealth = (typeof SERVICE_HEALTH)[number];

export const ALERT_SEVERITIES = values(['info', 'warning', 'critical']);
export type AlertSeverity = (typeof ALERT_SEVERITIES)[number];

export const ALERT_STATUSES = values(['open', 'acknowledged', 'resolved', 'dismissed']);
export type AlertStatus = (typeof ALERT_STATUSES)[number];

export const GDPR_REQUEST_TYPES = values(['access', 'portability', 'rectification', 'erasure', 'objection']);
export type GdprRequestType = (typeof GDPR_REQUEST_TYPES)[number];

export const GDPR_REQUEST_STATUSES = values(['received', 'identity_check', 'in_progress', 'completed', 'rejected']);
export type GdprRequestStatus = (typeof GDPR_REQUEST_STATUSES)[number];

export const LEGAL_DOCUMENT_TYPES = values([
  'terms_client',
  'terms_sale',
  'terms_restaurant',
  'terms_driver',
  'privacy_policy',
  'cookie_policy',
  'legal_notice',
]);
export type LegalDocumentType = (typeof LEGAL_DOCUMENT_TYPES)[number];

export const CONSENT_KEYS = values(['marketing_email', 'marketing_push', 'marketing_sms', 'analytics_cookies', 'personalization']);
export type ConsentKey = (typeof CONSENT_KEYS)[number];

export const BLOCKLIST_TYPES = values(['phone', 'email', 'device', 'card_fingerprint', 'iban', 'ip']);
export type BlocklistType = (typeof BLOCKLIST_TYPES)[number];

export const FRAUD_SUBJECT_TYPES = values(['client', 'driver', 'restaurant']);
export type FraudSubjectType = (typeof FRAUD_SUBJECT_TYPES)[number];

export const APPS = values(['client', 'driver', 'restaurant', 'admin']);
export type AppKey = (typeof APPS)[number];

export const LOCALES = values(['fr', 'en', 'ar', 'de', 'lb', 'pt']);
export type Locale = (typeof LOCALES)[number];

/** Langues de l'interface retenues par le client (français, anglais, arabe). */
export const APP_LOCALES: readonly Locale[] = ['fr', 'en', 'ar'];
/** Langues écrites de droite à gauche. */
export const RTL_LOCALES: readonly Locale[] = ['ar'];
export function isRtlLocale(locale: string): boolean {
  return (RTL_LOCALES as readonly string[]).includes(locale);
}
