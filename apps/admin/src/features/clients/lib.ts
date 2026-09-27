import { useEffect, useState } from 'react';
// Rubrique Clients du super admin : fonctions serveur, masquage des données
// personnelles selon le rôle, recherche et niveaux de risque.
import type { StatusMeta } from '@golink/ui';
import { customerRiskLevel, maskEmail, maskPhone, normalizeText, type CreditCustomerInput, type CustomerRiskLevel, type UserProfile, type UserPrivate } from '@golink/shared';
import { callFunction } from '@/lib/firestore';

export const creditCustomer = callFunction<CreditCustomerInput, { transactionId: string; balanceAfterCents: number; chargedToRestaurant: boolean }>('creditCustomer');
export const blockCustomer = callFunction<{ userId: string; blocked: boolean; reason: string }, { status: string; authUpdated: boolean }>('blockCustomer');
export const deleteCustomerAccount = callFunction<{ userId: string; reason: string }, { authDeleted: boolean; forfeitedCents: number }>('deleteCustomerAccount');

export const CUSTOMER_STATUS_META: Record<string, StatusMeta> = {
  active: { label: 'Actif', tone: 'success' },
  blocked: { label: 'Bloqué', tone: 'danger' },
  pending_deletion: { label: 'Suppression demandée', tone: 'amber' },
  deleted: { label: 'Supprimé', tone: 'neutral' },
};

export const RISK_META: Record<CustomerRiskLevel, StatusMeta> = {
  low: { label: 'Faible', tone: 'success' },
  medium: { label: 'À surveiller', tone: 'amber' },
  high: { label: 'Élevé', tone: 'danger' },
};

/** Coordonnées affichées selon le droit « données personnelles ». */
export function displayEmail(email: string | null | undefined, full: boolean): string {
  if (!email) return '—';
  return full ? email : maskEmail(email);
}
export function displayPhone(phone: string | null | undefined, full: boolean): string {
  if (!phone) return '—';
  return full ? phone : maskPhone(phone);
}

/** Terme de recherche au format des `searchKeywords` (préfixe normalisé). */
export function searchToken(input: string): string | null {
  const normalized = normalizeText(input).trim();
  if (normalized.length < 2) return null;
  if (/[@\d+]/.test(normalized)) return normalized.replace(/[\s.+()-]/g, '').slice(0, 30);
  const word = normalized.split(/[\s,@.'’-]+/).find((w) => w.length >= 2);
  return word ? word.slice(0, 15) : null;
}

export function riskOf(user: UserProfile, priv?: UserPrivate | null, extra?: { notCollectedCount?: number; claimsCount?: number }) {
  return customerRiskLevel({
    ordersCount: user.stats?.ordersCount ?? 0,
    cancelledCount: user.stats?.cancelledCount ?? 0,
    refundsCount: user.stats?.refundsCount ?? 0,
    riskScore: priv?.riskScore ?? null,
    riskFlags: priv?.riskFlags ?? null,
    notCollectedCount: extra?.notCollectedCount,
    claimsCount: extra?.claimsCount,
  });
}

/** Libellés des signaux de fraude (userPrivate.riskFlags, fraudCases.signals). */
export const RISK_FLAG_LABELS: Record<string, string> = {
  repeated_claims: 'Réclamations répétées',
  frequent_not_received: '« Non reçu » fréquent',
  linked_accounts: 'Comptes liés',
  promo_abuse: 'Abus de promotions',
  off_address_delivery: 'Livraison hors adresse',
  abnormal_cancellations: 'Annulations anormales',
  shared_account: 'Compte partagé',
  fake_orders: 'Commandes fictives',
  refund_rate: 'Taux de remboursement élevé',
  chargeback: 'Contestation bancaire',
};

export interface RefundPolicy {
  /** null : illimité (super administrateur). */
  limitCents: number | null;
  approvalThresholdCents: number;
  maxCreditCents: number;
  walletCreditValidityDays: number;
}
const getRefundPolicy = callFunction<void, RefundPolicy>('getRefundPolicy');

/** Plafonds du compte connecté, calculés côté serveur (règle unique de plafond). */
export function useRefundPolicy(): RefundPolicy | null {
  const [policy, setPolicy] = useState<RefundPolicy | null>(null);
  useEffect(() => {
    let alive = true;
    getRefundPolicy().then((p) => alive && setPolicy(p)).catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);
  return policy;
}
