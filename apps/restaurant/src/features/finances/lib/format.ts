// Formats d'affichage des écrans financiers (montants en centimes, taux en bps).
import { formatEUR, formatNumber } from '@golink/ui';

/** Montant en centimes → « 1 234,56 € ». */
export function eur(cents: number): string {
  return formatEUR(cents, { cents: true });
}

/** Montant compact pour les axes et les cartes : « 12,4 k € ». */
export function eurCompact(cents: number): string {
  return formatEUR(cents, { cents: true, compact: true });
}

/** Montant signé : « + 12,00 € » / « − 3,50 € ». */
export function eurSigned(cents: number): string {
  if (cents === 0) return eur(0);
  return `${cents > 0 ? '+' : '−'} ${eur(Math.abs(cents))}`;
}

/** Taux en points de base → « 10 % », « 5,5 % ». */
export function bpsLabel(bps: number): string {
  return `${formatNumber(bps / 100, { decimals: true })} %`;
}

/** Ratio → « 12,5 % » (une décimale au plus). */
export function ratioLabel(ratio: number): string {
  return `${formatNumber(Math.round(ratio * 1000) / 10, { decimals: true })} %`;
}

/** Pluriel simple : plural(3, 'commande') → « 3 commandes ». */
export function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return `${formatNumber(count)} ${count > 1 ? pluralForm : singular}`;
}

/** Montant pour les fichiers exportés (tableur français) : 1234.5 → « 1234,50 ». */
export function csvAmount(cents: number): string {
  return (cents / 100).toFixed(2).replace('.', ',');
}

/** Libellés des mouvements du grand livre vus par un restaurant. */
export const LEDGER_LABELS: Record<string, string> = {
  order_revenue: 'Ventes',
  commission: 'Commission GoLink',
  promo_funded: 'Remise financée',
  delivery_fee: 'Frais de livraison',
  payment_fee: 'Frais de paiement',
  refund_charge: 'Remboursement imputé',
  subscription_fee: 'Abonnement',
  sponsored_placement: 'Mise en avant',
  manual_adjustment: 'Ajustement',
  payout: 'Virement',
  payout_reversal: 'Virement annulé',
};

/** Ton d'affichage d'un statut de reversement. */
export const PAYOUT_TONES = {
  scheduled: 'info',
  processing: 'amber',
  paid: 'success',
  failed: 'danger',
  on_hold: 'danger',
  cancelled: 'neutral',
} as const;

/** Ton d'affichage d'un statut de facture. */
export const INVOICE_TONES = {
  draft: 'neutral',
  issued: 'info',
  paid: 'success',
  overdue: 'danger',
  credited: 'neutral',
} as const;
