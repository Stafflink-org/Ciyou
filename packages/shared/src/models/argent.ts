// Rubriques « Argent » du super admin : réglages des relances d'impayés, entrées et
// sorties des Cloud Functions de finance (vue d'ensemble, reversements, facturation,
// déclarations, export comptable).
import type { PayoutFrequency } from '../constants/enums';
import type { Cents } from '../pricing/money';
import type { PlanCode } from '../pricing/plans';
import type { Timestamp } from './common';

/**
 * settings/dunning : relances des abonnements impayés. Après `maxAttempts`
 * tentatives en échec, l'abonnement est restreint ; il est suspendu quand le délai
 * de grâce de la formule (`plans.gracePeriodDays`) est écoulé depuis la restriction.
 */
export interface DunningSettings {
  enabled: boolean;
  /** Jours entre deux nouvelles tentatives de prélèvement. */
  retryIntervalDays: number;
  /** Nombre de tentatives avant restriction. */
  maxAttempts: number;
  /** Relance par e-mail du commerce à chaque échec. */
  emailReminders: boolean;
  /** Fonctionnalités coupées en statut « restreint » (ex. mise en avant, campagnes). */
  restrictedFeatures: string[];
  /** Bloquer les reversements du commerce pendant l'impayé. */
  holdPayouts: boolean;
  updatedAt: Timestamp;
  updatedBy: string;
}

export const DEFAULT_DUNNING_SETTINGS: Omit<DunningSettings, 'updatedAt' | 'updatedBy'> = {
  enabled: true,
  retryIntervalDays: 3,
  maxAttempts: 3,
  emailReminders: true,
  restrictedFeatures: ['push_campaigns', 'promo_codes'],
  holdPayouts: false,
};

// ------------------------------------------------------------ Vue d'ensemble

export interface FinanceScopeInput {
  /** Bornes incluses, AAAA-MM-JJ (heure de Paris). */
  from: string;
  to: string;
  countryId?: string | null;
  cityIds?: string[] | null;
}

export interface FinanceTotals {
  ordersCount: number;
  /** Payé par les clients (TTC, pourboires compris). */
  grossCents: Cents;
  /** Chiffre d'affaires net de la plateforme (HT) : commissions + frais clients + abonnements + mises en avant. */
  netRevenueCents: Cents;
  commissionHtCents: Cents;
  customerFeesHtCents: Cents;
  subscriptionsHtCents: Cents;
  sponsoredHtCents: Cents;
  paymentFeesCents: Cents;
  courierCostCents: Cents;
  tipsCents: Cents;
  promoPlatformCents: Cents;
  promoRestaurantCents: Cents;
  refundsCents: Cents;
  refundsRestaurantCents: Cents;
  refundsPlatformCents: Cents;
  restaurantsPayoutCents: Cents;
  vatDueCents: Cents;
  /** Marge nette plateforme après coûts et remboursements à sa charge. */
  marginCents: Cents;
}

export interface FinanceDailyPoint extends Pick<FinanceTotals, 'grossCents' | 'netRevenueCents' | 'marginCents' | 'refundsCents'> {
  day: string;
  ordersCount: number;
}

export interface FinanceOverview {
  totals: FinanceTotals;
  previous: FinanceTotals;
  daily: FinanceDailyPoint[];
  /** Soldes des comptes (reversements en attente, espèces détenues). */
  balances: {
    restaurantsPendingCents: Cents;
    driversPendingCents: Cents;
    onHoldCents: Cents;
    failedCents: Cents;
    driverCashHeldCents: Cents;
    scheduledCount: number;
    failedCount: number;
    onHoldCount: number;
  };
  promotions: Array<{ promotionId: string; name: string; funding: string; uses: number; platformCents: Cents; restaurantCents: Cents }>;
  topRestaurants: Array<{ restaurantId: string; name: string; grossCents: Cents; commissionHtCents: Cents; orders: number }>;
  byMethod: Array<{ method: string; amountCents: Cents; count: number }>;
  generatedAt: string;
}

// ------------------------------------------------------------ Reversements

export interface BuildPayoutsInput {
  beneficiaryType: 'restaurant' | 'driver';
  /** Dernier jour inclus (AAAA-MM-JJ) ; défaut : veille. */
  until?: string | null;
  /** Limite à un bénéficiaire (reversement manuel). */
  beneficiaryId?: string | null;
  /** Aperçu sans écriture. */
  dryRun?: boolean;
}

export interface BuildPayoutsResult {
  created: number;
  skippedBelowMinimum: number;
  skippedHeld: number;
  totalNetCents: Cents;
  preview: Array<{ beneficiaryId: string; beneficiaryName: string; netCents: Cents; entries: number; status: 'scheduled' | 'on_hold' | 'below_minimum' }>;
}

/** Surcharge du calendrier pour un bénéficiaire (restaurants/{rid}/private/commercial.payoutFrequency). */
export interface PayoutScheduleView {
  frequency: PayoutFrequency;
  dayOfWeek: number;
  minimumCents: Cents;
  delayDays: number;
}

// ------------------------------------------------------------ Facturation

export interface MonthlyInvoicesInput {
  /** Mois facturé AAAA-MM ; défaut : mois précédent. */
  month?: string | null;
  countryId?: string | null;
  dryRun?: boolean;
}

export interface MonthlyInvoicesResult {
  month: string;
  restaurantInvoices: number;
  driverStatements: number;
  skippedExisting: number;
  totalTtcCents: Cents;
  preview: Array<{ recipient: string; kind: string; totalTtcCents: Cents; exists: boolean }>;
}

// ------------------------------------------------------------ Déclarations

/** Ligne d'une déclaration DAC7 (un vendeur ou prestataire). */
export interface Dac7Line {
  sellerType: 'restaurant' | 'driver';
  sellerId: string;
  name: string;
  taxId: string | null;
  address: string | null;
  countryId: string;
  quarters: Array<{ quarter: 1 | 2 | 3 | 4; grossCents: Cents; feesCents: Cents; transactionsCount: number }>;
  grossCents: Cents;
  feesCents: Cents;
  transactionsCount: number;
  reportable: boolean;
  /** Informations manquantes pour la déclaration (identifiant fiscal, adresse…). */
  missing: string[];
}

/** Ligne du récapitulatif de TVA (par taux). */
export interface VatReportLine {
  rateBps: number;
  label: string;
  htCents: Cents;
  vatCents: Cents;
}

/**
 * Écriture de l'export comptable, conforme aux 18 champs réglementaires du FEC
 * (article A47 A-1 du Livre des procédures fiscales) : JournalCode, JournalLib,
 * EcritureNum, EcritureDate, CompteNum, CompteLib, CompAuxNum, CompAuxLib, PieceRef,
 * PieceDate, EcritureLib, Debit, Credit, EcritureLet, DateLet, ValidDate,
 * Montantdevise, Idevise.
 */
export interface AccountingLine {
  journal: string;
  /** JournalLib : libellé du journal (Ventes, Achats, Banque…). */
  journalLib: string;
  /** EcritureNum : numéro de séquence continue de l'écriture (partagée par les lignes d'une même pièce). */
  ecritureNum: number;
  /** EcritureDate au format FEC AAAAMMDD. */
  date: string;
  piece: string;
  /** PieceDate au format FEC AAAAMMDD (date de la pièce justificative). */
  pieceDate: string;
  /** ValidDate au format FEC AAAAMMDD (date de validation, écritures non modifiables dès l'émission). */
  validDate: string;
  account: string;
  accountLabel: string;
  thirdParty: string | null;
  label: string;
  debitCents: Cents;
  creditCents: Cents;
}

export interface AccountingExportResult {
  reportId: string;
  month: string;
  countryId: string;
  lines: AccountingLine[];
  totals: { debitCents: Cents; creditCents: Cents; invoices: number; payouts: number };
  /** Identité de l'entité facturante du pays (FEC : nom du fichier `<SIREN>FEC<clôture>.txt`). */
  issuer: { legalName: string; registrationNumber: string | null };
}

// ------------------------------------------------------------ Abonnements

export interface SubscriptionActionInput {
  subscriptionId: string;
  action: 'cancel' | 'cancel_now' | 'reactivate' | 'extend_trial' | 'suspend' | 'restore' | 'retry_payment' | 'special_offer' | 'clear_offer';
  reason: string;
  /** extend_trial : jours ajoutés. */
  days?: number | null;
  /** special_offer : remise en points de base sur l'abonnement, fin de gratuité, réduction de commission. */
  discountBps?: number | null;
  freeUntil?: string | null;
  commissionReductionBps?: number | null;
  offerEndsAt?: string | null;
  planCode?: PlanCode | null;
}
