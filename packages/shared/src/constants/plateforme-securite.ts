// Libellés et valeurs par défaut des rubriques « Plateforme & sécurité » du super admin
// (paramètres, marchés, fonctionnalités, connexions, administrateurs, sécurité, fraude,
// légal et RGPD, santé, données et sauvegardes).
import type { BlocklistEntry, FraudCase } from '../models/compliance';
import type { Incident, PlatformIntegration } from '../models/platform';
import type { SecurityAlertType } from '../models/plateforme-securite';
import type { AdminPermission } from '../permissions/admin';
import type { AppKey, ConsentKey, FeatureScope, ServiceKey } from './enums';

/** Libellé de chaque permission interne, pour la matrice des rôles. */
export const ADMIN_PERMISSION_LABELS: Record<AdminPermission, string> = {
  'dashboard.view': 'Voir le tableau de bord',
  'search.use': 'Recherche universelle',
  'analytics.view': 'Voir les analytics',
  'reports.view': 'Voir les rapports',
  'reports.schedule': 'Programmer des rapports',
  'exports.run': 'Exporter des données',
  'restaurants.view': 'Voir les commerces',
  'restaurants.edit': 'Modifier les commerces',
  'restaurants.validate': 'Valider les commerces',
  'restaurants.suspend': 'Suspendre les commerces',
  'restaurants.delete': 'Supprimer les commerces',
  'restaurants.commercial': 'Conditions commerciales',
  'restaurants.impersonate': 'Voir comme le commerce',
  'restaurants.bulk': 'Actions groupées commerces',
  'restaurants.import': 'Importer des commerces',
  'drivers.view': 'Voir les livreurs',
  'drivers.edit': 'Modifier les livreurs',
  'drivers.validate': 'Valider les livreurs',
  'drivers.sanction': 'Sanctionner les livreurs',
  'drivers.pay_rules': 'Rémunération des livreurs',
  'drivers.bulk': 'Actions groupées livreurs',
  'customers.view': 'Voir les clients',
  'customers.edit': 'Modifier les clients',
  'customers.block': 'Bloquer les clients',
  'customers.delete': 'Supprimer les clients',
  'customers.credit': 'Créditer les clients',
  'personal_data.view': 'Données personnelles non masquées',
  'orders.view': 'Voir les commandes',
  'orders.intervene': 'Intervenir sur les commandes',
  'order_rules.edit': 'Règles automatiques',
  'zones.edit': 'Zones et villes',
  'display.edit': 'Affichage de l’app client',
  'reviews.view': 'Voir les avis',
  'reviews.moderate': 'Modérer les avis',
  'support.view': 'Voir le support',
  'support.handle': 'Traiter les tickets',
  'support.escalate': 'Escalader les tickets',
  'support.configure': 'Configurer le support',
  'payments.view': 'Voir les paiements',
  'payments.configure': 'Configurer les paiements',
  'refunds.create': 'Rembourser',
  'refunds.approve': 'Valider les remboursements',
  'finance.view': 'Voir la finance',
  'finance.payouts': 'Reversements',
  'finance.adjust': 'Ajustements financiers',
  'finance.hold': 'Geler des reversements',
  'invoices.view': 'Voir les factures',
  'invoices.issue': 'Émettre des factures',
  'tax.reports': 'Déclarations fiscales',
  'plans.edit': 'Formules',
  'commissions.edit': 'Commissions',
  'subscriptions.manage': 'Abonnements',
  'promotions.view': 'Voir les promotions',
  'promotions.edit': 'Gérer les promotions',
  'loyalty.edit': 'Fidélité et parrainage',
  'notifications.send': 'Envoyer des notifications',
  'templates.edit': 'Modèles de messages',
  'announcements.edit': 'Annonces',
  'crm.view': 'Voir la prospection',
  'crm.edit': 'Gérer la prospection',
  'crm.manage_team': 'Équipe commerciale',
  'platform.access': 'Accès à la rubrique Plateforme & sécurité',
  'settings.view': 'Voir les paramètres',
  'settings.edit': 'Modifier les paramètres',
  'markets.edit': 'Pays et marchés',
  'features.edit': 'Fonctionnalités',
  'integrations.view': 'Voir les connexions',
  'integrations.edit': 'Gérer les connexions',
  'admins.view': 'Voir les administrateurs',
  'admins.manage': 'Gérer les administrateurs',
  'audit.view': 'Journal d’audit',
  'security.manage': 'Sécurité et sessions',
  'fraud.view': 'Voir la fraude',
  'fraud.manage': 'Traiter la fraude',
  'legal.edit': 'Documents légaux',
  'gdpr.handle': 'Demandes RGPD',
  'system.view': 'Voir la santé des services',
  'system.manage': 'Maintenance et incidents',
  'trash.view': 'Voir la corbeille',
  'trash.restore': 'Restaurer depuis la corbeille',
  'backups.manage': 'Sauvegardes',
};

/** Regroupement des permissions dans la matrice (ordre d'affichage). */
export const ADMIN_PERMISSION_GROUPS: ReadonlyArray<{ id: string; label: string; prefixes: readonly string[] }> = [
  { id: 'pilotage', label: 'Pilotage', prefixes: ['dashboard', 'search', 'analytics', 'reports', 'exports'] },
  { id: 'acteurs', label: 'Acteurs', prefixes: ['restaurants', 'drivers', 'customers', 'personal_data'] },
  { id: 'operations', label: 'Opérations', prefixes: ['orders', 'order_rules', 'zones', 'display', 'reviews', 'support'] },
  { id: 'argent', label: 'Argent', prefixes: ['payments', 'refunds', 'finance', 'invoices', 'tax', 'plans', 'commissions', 'subscriptions'] },
  { id: 'croissance', label: 'Croissance', prefixes: ['promotions', 'loyalty', 'notifications', 'templates', 'announcements', 'crm'] },
  { id: 'plateforme', label: 'Plateforme & sécurité', prefixes: ['platform', 'settings', 'markets', 'features', 'integrations', 'admins', 'audit', 'security', 'fraud', 'legal', 'gdpr', 'system', 'trash', 'backups'] },
];

/** Actions du cahier (§26) auxquelles chaque permission se rattache. */
export type AdminPermissionAction = 'view' | 'edit' | 'refund' | 'export' | 'delete';

export const ADMIN_PERMISSION_ACTION_LABELS: Record<AdminPermissionAction, string> = {
  view: 'Voir',
  edit: 'Modifier',
  refund: 'Rembourser',
  export: 'Exporter',
  delete: 'Supprimer',
};

export function adminPermissionAction(permission: AdminPermission): AdminPermissionAction {
  if (permission === 'refunds.create' || permission === 'refunds.approve' || permission === 'customers.credit') return 'refund';
  if (permission === 'exports.run' || permission === 'reports.schedule' || permission === 'tax.reports') return 'export';
  if (permission.endsWith('.delete') || permission === 'trash.restore' || permission === 'backups.manage') return 'delete';
  if (permission.endsWith('.view') || permission === 'search.use') return 'view';
  return 'edit';
}

export const SECURITY_ALERT_TYPE_LABELS: Record<SecurityAlertType, string> = {
  unusual_login: 'Connexion inhabituelle',
  mass_export: 'Export massif',
  refund_spike: 'Remboursements en série',
  failed_logins: 'Échecs de connexion',
  permission_change: 'Changement de droits',
  mfa_disabled: 'Double authentification désactivée',
  new_device: 'Nouvel appareil',
  mfa_failed: 'Codes de vérification erronés',
  session_revoked: 'Session révoquée',
};

export const FRAUD_SIGNAL_LABELS: Record<FraudCase['signals'][number]['code'], string> = {
  repeated_claims: 'Réclamations répétées',
  frequent_not_received: '« Non reçue » fréquent',
  linked_accounts: 'Comptes liés',
  promo_abuse: 'Abus de codes promo',
  off_address_delivery: 'Livraison hors adresse',
  abnormal_cancellations: 'Annulations anormales',
  shared_account: 'Compte partagé',
  fake_orders: 'Commandes fictives',
  refund_rate: 'Taux de remboursement élevé',
  chargeback: 'Rétrofacturation bancaire',
};

export const FRAUD_STATUS_LABELS: Record<FraudCase['status'], string> = {
  open: 'À traiter',
  investigating: 'En enquête',
  confirmed: 'Fraude confirmée',
  dismissed: 'Classé sans suite',
};

export const FRAUD_DECISION_LABELS: Record<NonNullable<FraudCase['decision']>['action'], string> = {
  none: 'Aucune mesure',
  warning: 'Avertissement',
  blocked: 'Blocage du compte',
  suspended: 'Suspension',
  payout_hold: 'Gel des reversements',
};

export const FRAUD_SUBJECT_LABELS: Record<FraudCase['subjectType'], string> = {
  client: 'Client',
  driver: 'Livreur',
  restaurant: 'Commerce',
};

export const BLOCKLIST_TYPE_LABELS: Record<BlocklistEntry['type'], string> = {
  phone: 'Téléphone',
  email: 'E-mail',
  device: 'Appareil',
  card_fingerprint: 'Carte bancaire',
  iban: 'IBAN',
  ip: 'Adresse IP',
};

export const APP_LABELS: Record<AppKey, string> = {
  client: 'App client',
  driver: 'App livreur',
  restaurant: 'Back-office commerce',
  admin: 'Super admin',
};

export const INTEGRATION_CATEGORY_LABELS: Record<PlatformIntegration['category'], string> = {
  payment: 'Paiement',
  email: 'E-mails',
  sms: 'SMS',
  maps: 'Cartographie',
  push: 'Notifications push',
  accounting: 'Comptabilité',
  pos: 'Logiciels de caisse',
  other: 'Autre',
};

export const INCIDENT_STATUS_LABELS: Record<Incident['status'], string> = {
  investigating: 'Analyse en cours',
  identified: 'Cause identifiée',
  monitoring: 'Sous surveillance',
  resolved: 'Résolu',
};

export const CONSENT_LABELS: Record<ConsentKey, string> = {
  marketing_email: 'E-mails marketing',
  marketing_push: 'Notifications marketing',
  marketing_sms: 'SMS marketing',
  analytics_cookies: 'Mesure d’audience',
  personalization: 'Personnalisation',
};

export const FEATURE_SCOPE_LABELS: Record<FeatureScope, string> = {
  platform: 'Plateforme',
  country: 'Pays',
  city: 'Ville',
  plan: 'Formule',
  restaurant: 'Commerce',
};

/** Ordre de priorité des surcharges d'une fonctionnalité (la plus spécifique l'emporte). */
export const FEATURE_SCOPE_PRIORITY: Record<Exclude<FeatureScope, 'platform'>, number> = {
  country: 1,
  city: 2,
  plan: 3,
  restaurant: 4,
};

/** Libellé lisible d'un document de réglage (historique des modifications). */
export const SETTINGS_DOC_LABELS: Record<string, string> = {
  general: 'Identité et régional',
  branding: 'Marque',
  orderRules: 'Règles des commandes',
  dispatch: 'Attribution des courses',
  payments: 'Paiements',
  refunds: 'Remboursements',
  loyalty: 'Fidélité',
  referral: 'Parrainage',
  promotions: 'Promotions',
  display: 'Affichage app client',
  support: 'Support',
  security: 'Sécurité',
  retention: 'Conservation des données',
  maintenance: 'Maintenance',
  payouts: 'Reversements',
  monitoring: 'Surveillance',
  dunning: 'Relances des impayés',
  crm: 'Prospection',
};

/** Politique de sécurité par défaut (double authentification obligatoire). */
export const DEFAULT_SECURITY_POLICY = {
  requireMfaForAdmins: true,
  adminSessionMaxHours: 12,
  alerts: { massExportRows: 5000, refundsPerAgentPerHour: 15, failedLoginsPerHour: 8 },
  mfaMaxAttempts: 5,
  mfaLockMinutes: 15,
  alertOnNewDevice: true,
  unusualLoginHours: { fromHour: 0, toHour: 5 },
} as const;

/** Libellé de chaque service surveillé (santé et maintenance, cahier §30). */
export const SERVICE_KEY_LABELS: Record<ServiceKey, string> = {
  client_app: 'App client',
  driver_app: 'App livreur',
  restaurant_backoffice: 'Back-office commerce',
  admin_backoffice: 'Super admin',
  orders: 'Commandes',
  payments: 'Paiements',
  notifications: 'Notifications',
  emails: 'E-mails',
  sms: 'SMS',
  geolocation: 'Géolocalisation',
  maps: 'Cartographie',
};

/** Émetteur affiché dans les applications d'authentification. */
export const TOTP_ISSUER = 'Ciyou Eats Admin';
/** Paramètres TOTP (RFC 6238) : 6 chiffres, pas de 30 s, tolérance d'un pas. */
export const TOTP_DIGITS = 6;
export const TOTP_PERIOD_SECONDS = 30;
