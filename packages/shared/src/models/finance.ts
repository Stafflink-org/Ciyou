// Argent : paiements, remboursements, grand livre, reversements, blocages,
// factures et avoirs, déclarations (TVA, DAC7), abonnements et commissions.
import type {
  CommissionScope,
  InvoiceKind,
  InvoiceStatus,
  LedgerAccountType,
  LedgerEntryType,
  PaymentMethod,
  PaymentStatus,
  PayoutStatus,
  RefundMethod,
  RefundStatus,
  SubscriptionStatus,
} from '../constants/enums';
import type { CollectedPaymentMethod } from './orders';
import type { Bps, Cents } from '../pricing/money';
import type { PlanCode } from '../pricing/plans';
import type { RefundAllocation, RefundCause } from '../pricing/policies';
import type { CurrencyCode } from '../pricing/currency';
import type { BillingMode } from '../pricing/types';
import type { Localized, StoredFile, Timestamp, Tracked } from './common';

/** payments/{id} : tentative de paiement (commande, abonnement, mise en avant). */
export interface Payment extends Localized {
  purpose: 'order' | 'subscription' | 'sponsored_placement';
  orderId?: string | null;
  subscriptionId?: string | null;
  invoiceId?: string | null;
  payerType: 'client' | 'restaurant';
  payerId: string;
  restaurantId?: string | null;
  method: PaymentMethod;
  amountCents: Cents;
  currency: CurrencyCode;
  status: PaymentStatus;
  provider: 'stripe' | 'cash' | 'wallet';
  providerIntentId?: string | null;
  providerChargeId?: string | null;
  /** Empreinte de carte (détection de fraude), jamais le numéro. */
  cardFingerprint?: string | null;
  cardLabel?: string | null;
  feeCents: Cents;
  failureCode?: string | null;
  failureMessage?: string | null;
  attempts: number;
  refundedCents: Cents;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

/** refunds/{id} : remboursement ou avoir, avec imputation selon la cause. */
export interface Refund extends Localized {
  orderId: string;
  orderNumber: string;
  customerId: string;
  restaurantId: string;
  driverId?: string | null;
  ticketId?: string | null;
  amountCents: Cents;
  method: RefundMethod;
  cause: RefundCause;
  allocation: RefundAllocation;
  items?: Array<{ lineId: string; quantity: number; amountCents: Cents }> | null;
  status: RefundStatus;
  automatic: boolean;
  reason?: string | null;
  requestedBy: string;
  requestedAt: Timestamp;
  approvedBy?: string | null;
  approvedAt?: Timestamp | null;
  rejectionReason?: string | null;
  providerRefundId?: string | null;
  creditNoteId?: string | null;
  processedAt?: Timestamp | null;
}

/** ledgerEntries/{id} : grand livre, chaque mouvement d'argent (non modifiable). */
export interface LedgerEntry extends Localized {
  accountType: LedgerAccountType;
  /** Identifiant du restaurant, du livreur ou du client ; « golink » pour la plateforme. */
  accountId: string;
  type: LedgerEntryType;
  /** Positif = dû au titulaire du compte ; négatif = retenu. */
  amountCents: Cents;
  currency: CurrencyCode;
  vatCents?: Cents | null;
  orderId?: string | null;
  refundId?: string | null;
  payoutId?: string | null;
  invoiceId?: string | null;
  subscriptionId?: string | null;
  description: string;
  reason?: string | null;
  /** Date comptable (AAAA-MM-JJ) pour les exports. */
  bookingDate: string;
  createdAt: Timestamp;
  createdBy: string;
}

/** payouts/{id} : reversement à un restaurant ou à un livreur. */
export interface Payout extends Localized {
  beneficiaryType: 'restaurant' | 'driver';
  beneficiaryId: string;
  beneficiaryName: string;
  periodStart: string;
  periodEnd: string;
  grossCents: Cents;
  commissionCents: Cents;
  refundsChargedCents: Cents;
  adjustmentsCents: Cents;
  tipsCents: Cents;
  cashDeductedCents: Cents;
  netCents: Cents;
  entriesCount: number;
  status: PayoutStatus;
  scheduledFor: Timestamp;
  paidAt?: Timestamp | null;
  providerTransferId?: string | null;
  failureReason?: string | null;
  holdId?: string | null;
  statementInvoiceId?: string | null;
  /** Devise du reversement (celle du pays du bénéficiaire). */
  currency?: CurrencyCode;
  /** Stripe Connect (virement automatique) ou virement manuel (pays sans Stripe : Algérie, Maroc, Tunisie). */
  provider?: PayoutProvider;
  /** Référence du virement saisi à la main (relevé bancaire). */
  manualReference?: string | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export type PayoutProvider = 'stripe' | 'manual';

/** payoutHolds/{id} : suspension des reversements (fraude, litige, document manquant). */
export interface PayoutHold extends Tracked {
  beneficiaryType: 'restaurant' | 'driver';
  beneficiaryId: string;
  reason: 'fraud' | 'dispute' | 'missing_document' | 'unpaid_subscription' | 'other';
  details?: string | null;
  active: boolean;
  releasedAt?: Timestamp | null;
  releasedBy?: string | null;
}

export interface InvoiceParty {
  type: 'platform' | 'restaurant' | 'driver' | 'client' | 'group';
  id: string;
  name: string;
  address: string;
  vatNumber?: string | null;
  registrationNumber?: string | null;
  email?: string | null;
}

export interface InvoiceLine {
  label: string;
  quantity: number;
  unitHtCents: Cents;
  vatRateBps: Bps;
  htCents: Cents;
  vatCents: Cents;
  ttcCents: Cents;
}

/**
 * invoices/{id} : factures, reçus, relevés et avoirs. Numérotation continue par
 * série (`counters/invoice_{série}`) ; une facture n'est jamais supprimée ni modifiée
 * après émission : on émet un avoir.
 */
export interface Invoice extends Localized {
  number: string;
  series: string;
  kind: InvoiceKind;
  status: InvoiceStatus;
  issuer: InvoiceParty;
  recipient: InvoiceParty;
  /** Autofacturation (relevés livreurs émis par la plateforme au nom du livreur). */
  selfBilling: boolean;
  lines: InvoiceLine[];
  vatSummary: Array<{ rateBps: Bps; htCents: Cents; vatCents: Cents }>;
  totalHtCents: Cents;
  totalVatCents: Cents;
  totalTtcCents: Cents;
  currency: CurrencyCode;
  periodStart?: string | null;
  periodEnd?: string | null;
  orderId?: string | null;
  payoutId?: string | null;
  subscriptionId?: string | null;
  /** Pour un avoir : facture d'origine. */
  creditedInvoiceId?: string | null;
  /** Montant TTC déjà crédité par avoir (annulation partielle). */
  creditedCents?: Cents | null;
  /** Motif de l'avoir. */
  creditReason?: string | null;
  refundId?: string | null;
  creditNoteIds: string[];
  pdf?: StoredFile | null;
  issuedAt: Timestamp;
  dueAt?: Timestamp | null;
  paidAt?: Timestamp | null;
  legalMentions: string[];
  /**
   * Part de la facture retenue sur les reversements du commerce (abonnement, mises en avant) :
   * `pending` tant que son solde à reverser ne la couvre pas, `done` une fois compensée.
   */
  compensation?: { debitCents: Cents; status: 'pending' | 'done'; settledAt?: Timestamp | null } | null;
  /** Les factures sont conservées même après suppression du compte (anonymisation du destinataire interdite). */
  retainUntil: string;
}

/** taxReports/{id} : déclarations et exports réglementaires. */
export interface TaxReport extends Tracked {
  type: 'dac7' | 'vat' | 'accounting_export';
  countryId: string;
  /** « 2026 » pour DAC7, « 2026-09 » pour un export mensuel. */
  period: string;
  status: 'draft' | 'generating' | 'ready' | 'submitted' | 'failed';
  sellersCount?: number | null;
  totals?: { grossCents: Cents; feesCents: Cents; vatCents: Cents } | null;
  file?: StoredFile | null;
  submittedAt?: Timestamp | null;
  submissionReference?: string | null;
  error?: string | null;
  /** Détail par vendeur (DAC7) ou par taux (TVA), produit par generateTaxReport. */
  dac7Lines?: import('./argent').Dac7Line[] | null;
  vatLines?: import('./argent').VatReportLine[] | null;
  /** Ventilation des montants collectés et déductibles (TVA). */
  vatBreakdown?: { collectedCents: number; creditNotesCents: number; netCents: number } | null;
  generatedBy?: string | null;
}

/** plans/{planCode} : formules d'abonnement restaurant. */
export interface Plan extends Tracked {
  code: PlanCode;
  name: string;
  description: string;
  active: boolean;
  countryIds: string[];
  monthlyPriceHtCents: Cents;
  yearlyPriceHtCents?: Cents | null;
  trialDays: number;
  commission: { platformDeliveryBps: Bps; restaurantDeliveryBps: Bps; pickupBps: Bps };
  /** La formule impose ses taux (défaut) ou laisse le barème du pays s'appliquer (les barèmes de la ville et du commerce restent prioritaires). */
  commissionInherit?: boolean;
  rankingBoost: number;
  maxDeliveryRadiusMeters: number;
  includedOutlets: number;
  features: string[];
  limits: { maxProducts?: number | null; maxStaff?: number | null; maxPromotions?: number | null };
  order: number;
  stripePriceId?: string | null;
  /** Mode de facturation de la formule (commission, abonnement ou les deux), surchargeable par commerce. */
  billingMode?: BillingMode;
  /** Durée d'engagement en mois (0 = sans engagement). */
  commitmentMonths?: number;
  /** Carte bancaire exigée à la souscription ou au début de l'essai. */
  cardRequired?: boolean;
  /** Délai de grâce après un impayé avant suspension (jours ; 0 = immédiat). */
  gracePeriodDays?: number;
}

/** subscriptions/{id} : abonnement d'un restaurant ou d'un groupe. */
export interface Subscription extends Tracked, Localized {
  subscriberType: 'restaurant' | 'group';
  subscriberId: string;
  restaurantIds: string[];
  planCode: PlanCode;
  status: SubscriptionStatus;
  billingCycle: 'monthly' | 'yearly';
  priceHtCents: Cents;
  trialEndsAt?: Timestamp | null;
  currentPeriodStart: Timestamp;
  currentPeriodEnd: Timestamp;
  cancelAtPeriodEnd: boolean;
  cancelledAt?: Timestamp | null;
  cancelReason?: string | null;
  specialOffer?: { discountBps: Bps; freeUntil?: Timestamp | null; reason: string; endsAt?: Timestamp | null } | null;
  dunning: {
    attempts: number;
    lastAttemptAt?: Timestamp | null;
    nextRetryAt?: Timestamp | null;
    restrictedAt?: Timestamp | null;
    /** Premier échec de l'impayé en cours. */
    firstFailedAt?: Timestamp | null;
    suspendedAt?: Timestamp | null;
    /** Journal des relances (tentatives, e-mails, restrictions). */
    log?: Array<{ at: Timestamp; kind: 'retry_failed' | 'retry_succeeded' | 'reminder_sent' | 'restricted' | 'suspended' | 'restored'; note?: string | null }>;
  };
  history: Array<{ at: Timestamp; event: 'created' | 'upgraded' | 'downgraded' | 'renewed' | 'past_due' | 'trial_converted' | 'cancelled' | 'reactivated' | 'suspended' | 'restricted' | 'restored' | 'trial_extended' | 'offer_applied' | 'offer_removed' | 'cancel_scheduled'; planCode: PlanCode; by: string; reason?: string | null }>;
  stripeSubscriptionId?: string | null;
  /** Changement de formule programmé (passage à une formule inférieure : effet en fin de période). */
  pendingChange?: {
    planCode: PlanCode;
    effectiveAt: Timestamp;
    requestedAt: Timestamp;
    requestedBy: string;
    reason?: string | null;
  } | null;
}

/** commissionRules/{id} : barème de commission par portée, versionné (historique conservé). */
export interface CommissionRule extends Tracked {
  scope: CommissionScope;
  scopeId: string;
  countryId: string;
  platformDeliveryBps: Bps;
  restaurantDeliveryBps: Bps;
  pickupBps: Bps;
  validFrom: Timestamp;
  validTo?: Timestamp | null;
  reason: string;
  /** Règle remplacée par celle-ci. */
  supersedesId?: string | null;
}

// ------------------------------------------------------------ Comptes et prestataires de paiement

/**
 * Compte sur lequel un commerce ou un livreur est payé. `stripe_connect` : virement automatique
 * (Stripe Connect Express) ; `bank_transfer` et `mobile_wallet` : prestataires locaux
 * (Algérie, Maroc, Tunisie), virement manuel de l'équipe finance avec référence.
 */
export interface PayoutAccount {
  provider: 'stripe_connect' | 'bank_transfer' | 'mobile_wallet';
  /** Prestataire local (paymentProviders/{id}) pour les virements hors Stripe. */
  paymentProviderId?: string | null;
  holderName: string;
  /** IBAN / RIB / numéro de portefeuille masqué : le numéro complet n'est jamais stocké en clair ici. */
  accountMasked: string;
  currency: CurrencyCode;
  verified: boolean;
  verifiedAt?: Timestamp | null;
  verifiedBy?: string | null;
  updatedAt: Timestamp;
}

export type PaymentProviderKind = 'card' | 'bank_transfer' | 'mobile_wallet' | 'cash';

/**
 * paymentProviders/{id} : prestataire de paiement d'un ou plusieurs pays (Stripe, ou prestataire
 * local là où Stripe n'est pas disponible). Géré par le super admin.
 */
export interface PaymentProvider extends Tracked {
  code: string;
  label: string;
  countryIds: string[];
  currencies: CurrencyCode[];
  /** Encaissement des commandes et/ou reversements aux partenaires. */
  supports: { collect: boolean; payout: boolean };
  kinds: PaymentProviderKind[];
  /** `api` : intégration automatique ; `manual` : suivi par l'équipe finance (référence saisie à la main). */
  mode: 'api' | 'manual';
  enabled: boolean;
  note?: string | null;
}

// ------------------------------------------------------------ Espèces des livreurs salariés

/**
 * cashMovements/{id} : mouvement d'espèces d'un livreur salarié du commerce. Les espèces restent
 * chez le commerce (décision client) : le livreur encaisse à la livraison puis remet la caisse
 * au commerce ; le solde détenu est plafonné.
 */
export interface CashMovement {
  countryId: string;
  cityId?: string | null;
  restaurantId: string;
  driverId: string;
  driverName?: string | null;
  type: 'collected' | 'remitted' | 'adjustment';
  /** Moyen concerné (espèces, ticket restaurant, carte) ; absent = espèces, mouvements
   * antérieurs à l'extension aux 3 moyens (Backoffice resto #6). */
  method?: CollectedPaymentMethod;
  /** Positif = espèces détenues en plus ; négatif = remise ou correction. */
  amountCents: Cents;
  balanceAfterCents: Cents;
  orderId?: string | null;
  orderNumber?: string | null;
  note?: string | null;
  createdAt: Timestamp;
  createdBy: string;
}
