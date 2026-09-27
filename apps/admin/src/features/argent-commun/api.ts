// Cloud Functions des rubriques « Argent » (domaine finance, europe-west1).
import type {
  AccountingExportResult,
  BuildPayoutsInput,
  BuildPayoutsResult,
  FinanceOverview,
  FinanceScopeInput,
  MonthlyInvoicesInput,
  MonthlyInvoicesResult,
  PaymentMethod,
  PayoutHoldReason,
  PlanCode,
  PlanFeatureKey,
} from '@golink/shared';
import { callFunction } from '@/lib/firestore';
import { callFunctionWithReason } from '@/lib/reason';

export const getFinanceOverview = callFunction<FinanceScopeInput, FinanceOverview>('getFinanceOverview');

// Reversements
export const buildPayoutsNow = callFunctionWithReason<BuildPayoutsInput, BuildPayoutsResult>('buildPayoutsNow', { title: 'Construire les reversements maintenant', description: 'Mouvement d’argent : le motif est conservé dans le journal d’audit.' }, (input) => Boolean(input.dryRun));
export const executePayout = callFunctionWithReason<{ payoutId: string }, { status: string; failureReason: string | null }>('executePayout', { title: 'Exécuter ce reversement', description: 'Le virement part immédiatement : indiquez pourquoi il est lancé à la main.', confirmLabel: 'Exécuter' });
export const cancelPayout = callFunction<{ payoutId: string; reason: string }, { entriesReleased: number }>('cancelPayout');
export const holdPayouts = callFunction<
  { beneficiaryType: 'restaurant' | 'driver'; beneficiaryId: string; reason: PayoutHoldReason; details: string },
  { holdId: string; payoutsHeld: number }
>('holdPayouts');
export const releasePayoutHold = callFunction<{ holdId: string; reason: string }, { payoutsReleased: number }>('releasePayoutHold');
export const createAdjustment = callFunction<
  { beneficiaryType: 'restaurant' | 'driver'; beneficiaryId: string; amountCents: number; label: string; reason: string; orderId?: string | null },
  { entryId: string }
>('createAdjustment');
export const recordCashRemittance = callFunction<{ driverId: string; amountCents: number; reason: string }, { cashBalanceCents: number }>('recordCashRemittance');
export const generateStatement = callFunction<{ payoutId: string }, StatementResult>('generateStatement');
// Pays sans Stripe : virement manuel avec référence bancaire, comptes locaux vérifiés, prestataires par pays.
export const markPayoutPaidManually = callFunction<{ payoutId: string; reference: string; reason: string }, { status: 'paid'; reference: string }>('markPayoutPaidManually');
export const verifyPayoutAccount = callFunction<{ beneficiaryType: 'restaurant' | 'driver'; beneficiaryId: string; verified: boolean; reason: string }, { verified: boolean }>('verifyPayoutAccount');
export interface PaymentProviderInput {
  providerId?: string | null;
  code: string;
  label: string;
  countryIds: string[];
  currencies: Array<'EUR' | 'DZD' | 'MAD' | 'TND'>;
  supports: { collect: boolean; payout: boolean };
  kinds: Array<'card' | 'bank_transfer' | 'mobile_wallet' | 'cash'>;
  mode: 'api' | 'manual';
  enabled: boolean;
  note?: string | null;
  reason: string;
}
export const savePaymentProvider = callFunction<PaymentProviderInput, { providerId: string }>('savePaymentProvider');
export const setCountryProviders = callFunction<{ countryId: string; providerIds: string[]; reason: string }, { countryId: string }>('setCountryProviders');
export const recordMerchantCashRemittance = callFunction<{ restaurantId: string; driverId: string; amountCents: number; note?: string | null }, { cashBalanceCents: number; movementId: string }>('recordMerchantCashRemittance');

// Facturation
export const generateMonthlyInvoicesNow = callFunctionWithReason<MonthlyInvoicesInput, MonthlyInvoicesResult>('generateMonthlyInvoicesNow', { title: 'Émettre les factures du mois', description: 'La numérotation légale est consommée : indiquez le motif de cette émission manuelle.' }, (input) => Boolean(input.dryRun));
export const issueCreditNote = callFunction<{ invoiceId: string; amountCents?: number | null; reason: string }, { creditNoteId: string; number: string }>('issueCreditNote');
export const markInvoicePaid = callFunction<{ invoiceId: string; reason: string }, { ok: true }>('markInvoicePaid');
export const issueCustomerReceipt = callFunction<{ orderId: string }, { invoiceId: string; created: boolean }>('issueCustomerReceipt');
export const generateTaxReport = callFunctionWithReason<{ type: 'dac7' | 'vat'; countryId: string; period: string }, { reportId: string }>('generateTaxReport', { title: 'Générer la déclaration' });
export const markTaxReportSubmitted = callFunction<{ reportId: string; reference: string; reason?: string }, { ok: true }>('markTaxReportSubmitted');
export const exportAccounting = callFunctionWithReason<{ month: string; countryId: string }, AccountingExportResult>('exportAccounting', { title: 'Exporter la comptabilité' });

// Abonnements et commissions
export interface PlanInput {
  code: PlanCode;
  name: string;
  description: string;
  active: boolean;
  countryIds: string[];
  monthlyPriceHtCents: number;
  yearlyPriceHtCents: number | null;
  trialDays: number;
  billingMode: 'commission' | 'subscription' | 'hybrid';
  commitmentMonths: number;
  cardRequired: boolean;
  gracePeriodDays: number;
  commission: { platformDeliveryBps: number; restaurantDeliveryBps: number; pickupBps: number };
  commissionInherit?: boolean;
  rankingBoost: number;
  maxDeliveryRadiusMeters: number;
  includedOutlets: number;
  features: PlanFeatureKey[];
  limits: { maxProducts: number | null; maxStaff: number | null; maxPromotions: number | null };
  order: number;
  reason: string;
}
export const updatePlan = callFunction<PlanInput, { changedFields: string[] }>('updatePlan');
export type CommissionRuleInput =
  | {
      action: 'create';
      scope: 'country' | 'city' | 'plan' | 'group' | 'restaurant';
      scopeId: string;
      platformDeliveryBps: number;
      restaurantDeliveryBps: number;
      pickupBps: number;
      validTo?: string | null;
      reason: string;
    }
  | { action: 'end'; ruleId: string; reason: string };
export const updateCommissionRule = callFunction<CommissionRuleInput, { ruleId: string }>('updateCommissionRule');
export type SubscriptionAction =
  | 'cancel'
  | 'cancel_now'
  | 'reactivate'
  | 'extend_trial'
  | 'suspend'
  | 'restore'
  | 'retry_payment'
  | 'mark_paid'
  | 'special_offer'
  | 'clear_offer';
export const manageSubscription = callFunction<
  {
    subscriptionId: string;
    action: SubscriptionAction;
    reason: string;
    days?: number | null;
    discountBps?: number | null;
    freeUntil?: string | null;
    commissionReductionBps?: number | null;
    offerEndsAt?: string | null;
  },
  { ok: true; note?: string }
>('manageSubscription');
export const changePlan = callFunction<{ restaurantId: string; planCode: PlanCode; reason?: string | null }, { status: string; effectiveAt: number | null }>('changePlan');

// Réglages
export const updateFinanceSettings = callFunction<
  | { doc: 'payouts'; reason: string; data: { restaurants: ScheduleInput; drivers: ScheduleInput } }
  | { doc: 'payments'; reason: string; data: { methods: Record<PaymentMethod, boolean>; tips: TipsInput; cash: { enabled: boolean; driverCashLimitCents: number }; failedPaymentRetry: { maxAttempts: number } } }
  | { doc: 'refunds'; reason: string; data: { approvalThresholdCents: number; defaultMethod: 'original_payment' | 'wallet_credit'; walletCreditValidityDays: number; maxCreditCents: number } }
  | { doc: 'dunning'; reason: string; data: { enabled: boolean; retryIntervalDays: number; maxAttempts: number; emailReminders: boolean; restrictedFeatures: PlanFeatureKey[]; holdPayouts: boolean } },
  { changedFields: string[] }
>('updateFinanceSettings');
export interface ScheduleInput {
  frequency: 'weekly' | 'biweekly' | 'monthly';
  dayOfWeek: number;
  minimumCents: number;
  delayDays: number;
}
export interface TipsInput {
  enabled: boolean;
  presetsCents: number[];
  maxCents: number;
}
export const updateCountryPayments = callFunction<
  {
    countryId: string;
    methods: Record<PaymentMethod, boolean>;
    payment: { percentBps: number; fixedCents: number; connectPercentBps: number; payer: 'platform' | 'restaurant' };
    tips: TipsInput;
    reason: string;
  },
  { changedFields: string[] }
>('updateCountryPayments');
export const updateRestaurantPayments = callFunction<
  { restaurantId: string; allowedPaymentMethods: PaymentMethod[]; payoutFrequency: 'weekly' | 'biweekly' | 'monthly' | null; reason: string },
  { changedFields: string[] }
>('updateRestaurantPayments');

/** Relevé détaillé d'un reversement commerce (fonction generateStatement). */
export interface StatementResult {
  payout: {
    id: string;
    periodStart: string;
    periodEnd: string;
    status: string;
    grossCents: number;
    commissionCents: number;
    refundsChargedCents: number;
    adjustmentsCents: number;
    tipsCents: number;
    cashDeductedCents: number;
    netCents: number;
    scheduledFor: string | null;
    paidAt: string | null;
    providerTransferId: string | null;
    failureReason: string | null;
  };
  restaurant: { id: string; name: string; legalName: string | null; siret: string | null; vatNumber: string | null; address: string; ibanMasked: string | null };
  issuer: { legalName: string; vatNumber: string; registrationNumber: string; address: string };
  lines: Array<{ entryId: string; bookingDate: string; type: string; description: string; orderId: string | null; refundId: string | null; amountCents: number; vatCents: number | null }>;
  orderNumbers: Record<string, string>;
  totals: { byType: Record<string, number>; vatCents: number; linesCount: number };
  generatedAt: string;
}
