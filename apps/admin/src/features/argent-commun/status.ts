// Statuts affichés par les rubriques « Argent » (libellés de @golink/shared, tons du kit).
import {
  INVOICE_STATUS_LABELS,
  PAYMENT_STATUS_LABELS,
  PAYOUT_STATUS_LABELS,
  SUBSCRIPTION_STATUS_LABELS,
  TAX_REPORT_STATUS_LABELS,
  type InvoiceStatus,
  type PaymentStatus,
  type PayoutStatus,
  type SubscriptionStatus,
} from '@golink/shared';
import type { StatusMeta, Tone } from '@golink/ui';

function build<K extends string>(labels: Record<K, string>, tones: Record<K, Tone>, pulse: K[] = []): Record<string, StatusMeta> {
  return Object.fromEntries(
    (Object.keys(labels) as K[]).map((key) => [key, { label: labels[key], tone: tones[key], pulse: pulse.includes(key) }]),
  );
}

export const PAYOUT_STATUS = build<PayoutStatus>(
  PAYOUT_STATUS_LABELS,
  { scheduled: 'info', processing: 'amber', paid: 'success', failed: 'danger', on_hold: 'plum', cancelled: 'neutral' },
  ['processing'],
);

export const PAYMENT_STATUS = build<PaymentStatus>(PAYMENT_STATUS_LABELS, {
  pending: 'neutral',
  requires_action: 'amber',
  authorized: 'info',
  paid: 'success',
  partially_refunded: 'teal',
  refunded: 'neutral',
  failed: 'danger',
  cancelled: 'neutral',
});

export const INVOICE_STATUS = build<InvoiceStatus>(INVOICE_STATUS_LABELS, {
  draft: 'neutral',
  issued: 'info',
  paid: 'success',
  overdue: 'danger',
  credited: 'neutral',
});

export const SUBSCRIPTION_STATUS = build<SubscriptionStatus>(SUBSCRIPTION_STATUS_LABELS, {
  trialing: 'plum',
  active: 'success',
  past_due: 'danger',
  restricted: 'amber',
  suspended: 'danger',
  cancelled: 'neutral',
});

export const TAX_REPORT_STATUS = build<keyof typeof TAX_REPORT_STATUS_LABELS>(
  TAX_REPORT_STATUS_LABELS,
  { draft: 'neutral', generating: 'amber', ready: 'info', submitted: 'success', failed: 'danger' },
  ['generating'],
);
