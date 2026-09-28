// Libellés, tons et formats des rubriques Croissance (promotions, fidélité,
// communication, annonces, prospection).
import type { Tone } from '@golink/ui';
import type {
  CampaignChannel,
  CampaignStatus,
  PlanCode,
  Promotion,
  PromotionScope,
  PromotionStatus,
  PromotionTarget,
  ProspectStage,
  ReferralStatus,
  SalesCommission,
} from '@golink/shared';
import { formatPrice } from '@golink/shared';

export const SCOPE_LABELS: Record<PromotionScope, string> = {
  platform: 'Toute la plateforme',
  country: 'Pays',
  city: 'Ville',
  restaurant: 'Restaurant',
};

export const TARGET_LABELS: Record<PromotionTarget, string> = {
  everyone: 'Tous les clients',
  new_customers: 'Nouveaux clients',
  inactive_customers: 'Clients inactifs',
  loyal_customers: 'Clients fidèles',
};

export const PROMOTION_STATUS_TONES: Record<PromotionStatus, Tone> = {
  draft: 'neutral',
  pending_review: 'amber',
  active: 'success',
  paused: 'info',
  rejected: 'danger',
  ended: 'neutral',
};

export const CAMPAIGN_STATUS_TONES: Record<CampaignStatus, Tone> = {
  draft: 'neutral',
  scheduled: 'info',
  sending: 'amber',
  sent: 'success',
  cancelled: 'neutral',
  failed: 'danger',
};

export const CHANNEL_SHORT: Record<CampaignChannel, string> = {
  push: 'Push',
  email: 'E-mail',
  sms: 'SMS',
  in_app: 'Dans l’app',
};

export const USER_TYPE_LABELS = {
  client: 'Clients',
  restaurant: 'Restaurants',
  driver: 'Livreurs',
} as const;

export const SEGMENT_LABELS = {
  all: 'Tous',
  new: 'Nouveaux (≤ 30 jours)',
  inactive: 'Inactifs',
  loyal: 'Fidèles (5 commandes et plus)',
  custom: 'Personnalisé',
} as const;

export const PLAN_LABELS: Record<PlanCode, string> = { basic: 'Basic', pro: 'Pro', premium: 'Premium' };

export const REFERRAL_STATUS_LABELS: Record<ReferralStatus, string> = {
  pending: 'En attente',
  qualified: 'Validé, prime à verser',
  rewarded: 'Récompensé',
  expired: 'Expiré',
  rejected: 'Refusé',
};

export const REFERRAL_STATUS_TONES: Record<ReferralStatus, Tone> = {
  pending: 'amber',
  qualified: 'info',
  rewarded: 'success',
  expired: 'neutral',
  rejected: 'danger',
};

export const REFERRAL_PROGRAM_LABELS = { client: 'Clients', restaurant: 'Commerces', driver: 'Livreurs' } as const;

export const STAGE_TONES: Record<ProspectStage, Tone> = {
  to_contact: 'neutral',
  contacted: 'info',
  demo: 'plum',
  negotiation: 'amber',
  signed_up: 'success',
  lost: 'danger',
};

export const SOURCE_LABELS = {
  field: 'Terrain',
  inbound: 'Demande entrante',
  referral: 'Recommandation',
  event: 'Salon, événement',
  import: 'Import de liste',
  other: 'Autre',
} as const;

export const ACTIVITY_LABELS = {
  call: 'Appel',
  email: 'E-mail',
  visit: 'Visite',
  demo: 'Démonstration',
  note: 'Note',
  stage_change: 'Changement d’étape',
} as const;

export const COMMISSION_STATUS_LABELS: Record<SalesCommission['status'], string> = {
  pending: 'À valider',
  approved: 'Validée',
  paid: 'Versée',
  cancelled: 'Annulée',
};

export const COMMISSION_STATUS_TONES: Record<SalesCommission['status'], Tone> = {
  pending: 'amber',
  approved: 'info',
  paid: 'success',
  cancelled: 'neutral',
};

export const SEVERITY_LABELS = { info: 'Information', important: 'Important', maintenance: 'Maintenance' } as const;
export const SEVERITY_TONES: Record<keyof typeof SEVERITY_LABELS, Tone> = { info: 'info', important: 'amber', maintenance: 'plum' };

/** « 20 % », « 5,00 € », « Livraison offerte ». */
export function promotionValueLabel(p: Pick<Promotion, 'kind' | 'value' | 'maxDiscountCents'>): string {
  if (p.kind === 'percentage') {
    const pct = `${(p.value / 100).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} %`;
    return p.maxDiscountCents ? `${pct} (max ${formatPrice(p.maxDiscountCents)})` : pct;
  }
  if (p.kind === 'fixed') return formatPrice(p.value);
  return 'Livraison offerte';
}

/** Part du coût d'une offre supportée par GoLink (0 à 1). */
export function platformShare(p: Pick<Promotion, 'funding' | 'restaurantShareBps'>): number {
  if (p.funding === 'platform') return 1;
  if (p.funding === 'restaurant') return 0;
  return 1 - (p.restaurantShareBps ?? 5000) / 10_000;
}

export function bpsLabel(bps: number): string {
  return `${(bps / 100).toLocaleString('fr-FR', { maximumFractionDigits: 2 })} %`;
}
