// Libellés et valeurs par défaut des rubriques « Argent » du super admin :
// paiements, finance et reversements, facturation et TVA, abonnements et commissions.
import type { CommissionScope, LedgerAccountType, LedgerEntryType, PayoutFrequency } from './enums';

export const LEDGER_ENTRY_TYPE_LABELS: Record<LedgerEntryType, string> = {
  order_revenue: 'Ventes',
  commission: 'Commission Ciyou Eats',
  promo_funded: 'Remise financée',
  delivery_fee: 'Frais de livraison',
  payment_fee: 'Frais de paiement',
  courier_earning: 'Gains de course',
  courier_tip: 'Pourboire',
  courier_bonus: 'Bonus livreur',
  hourly_guarantee_topup: 'Complément de garantie horaire',
  refund_charge: 'Remboursement imputé',
  wallet_credit: 'Crédit porte-monnaie',
  wallet_debit: 'Débit porte-monnaie',
  subscription_fee: 'Abonnement',
  sponsored_placement: 'Mise en avant',
  cash_collected: 'Espèces encaissées',
  cash_remitted: 'Espèces reversées',
  manual_adjustment: 'Ajustement manuel',
  payout: 'Reversement',
  payout_reversal: 'Reversement annulé',
  sales_commission: 'Commission commerciale',
};

export const LEDGER_ACCOUNT_TYPE_LABELS: Record<LedgerAccountType, string> = {
  restaurant: 'Commerce',
  driver: 'Livreur',
  driver_cash: 'Espèces livreur',
  platform: 'Plateforme',
  customer_wallet: 'Porte-monnaie client',
};

export const PAYOUT_HOLD_REASONS = ['fraud', 'dispute', 'missing_document', 'unpaid_subscription', 'other'] as const;
export type PayoutHoldReason = (typeof PAYOUT_HOLD_REASONS)[number];

export const PAYOUT_HOLD_REASON_LABELS: Record<PayoutHoldReason, string> = {
  fraud: 'Suspicion de fraude',
  dispute: 'Litige en cours',
  missing_document: 'Document manquant',
  unpaid_subscription: 'Abonnement impayé',
  other: 'Autre motif',
};

export const PAYOUT_FREQUENCY_LABELS: Record<PayoutFrequency, string> = {
  weekly: 'Chaque semaine',
  biweekly: 'Toutes les deux semaines',
  monthly: 'Chaque mois',
};

export const COMMISSION_SCOPE_LABELS: Record<CommissionScope, string> = {
  country: 'Pays (par défaut)',
  city: 'Ville',
  plan: 'Formule',
  group: 'Groupe',
  restaurant: 'Commerce (négociée)',
};

export const TAX_REPORT_TYPE_LABELS: Record<'dac7' | 'vat' | 'accounting_export', string> = {
  dac7: 'Déclaration DAC7',
  vat: 'Récapitulatif de TVA',
  accounting_export: 'Export comptable',
};

export const TAX_REPORT_STATUS_LABELS: Record<'draft' | 'generating' | 'ready' | 'submitted' | 'failed', string> = {
  draft: 'Brouillon',
  generating: 'En préparation',
  ready: 'Prêt',
  submitted: 'Transmis',
  failed: 'En échec',
};

/** Fonctionnalités qu'une formule peut inclure (clés de `plans.features`). */
export const PLAN_FEATURE_KEYS = [
  'orders',
  'menu',
  'finance',
  'messaging',
  'promo_codes',
  'loyalty',
  'push_campaigns',
  'team',
  'planning',
  'timeclock',
  'absences',
  'tasks',
  'documents',
  'payroll',
  'haccp',
  'multi_outlet',
  'pos_integration',
  'priority_support',
  'sponsored',
] as const;
export type PlanFeatureKey = (typeof PLAN_FEATURE_KEYS)[number];

export const PLAN_FEATURE_LABELS: Record<PlanFeatureKey, string> = {
  orders: 'Commandes en temps réel',
  menu: 'Carte, options et stocks',
  finance: 'Finances et relevés',
  messaging: 'Messagerie clients et livreurs',
  promo_codes: 'Codes promo',
  loyalty: 'Programme de fidélité',
  push_campaigns: 'Campagnes de notifications',
  team: 'Gestion d’équipe',
  planning: 'Planning',
  timeclock: 'Pointage',
  absences: 'Congés et absences',
  tasks: 'Tâches',
  documents: 'Documents d’équipe',
  payroll: 'Préparation de la paie',
  haccp: 'Registre HACCP',
  multi_outlet: 'Multi-établissements',
  pos_integration: 'Caisse connectée',
  priority_support: 'Support prioritaire',
  sponsored: 'Mises en avant payantes',
};

/** Séries de numérotation continue des documents de facturation (préfixe pays + code). */
export const INVOICE_SERIES_CODES = {
  commission_invoice: 'FAC',
  subscription_invoice: 'ABO',
  driver_statement: 'LIV',
  credit_note: 'AV',
  customer_receipt: 'REC',
  sponsored_invoice: 'PUB',
} as const;

/** Délai légal de conservation des pièces comptables (années, Code de commerce L123-22). */
export const INVOICE_RETENTION_YEARS = 10;
