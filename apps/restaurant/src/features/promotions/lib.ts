// Libellés, statuts d'affichage et lectures Firestore des offres de l'établissement.
import { limit, orderBy, query, where } from 'firebase/firestore';
import {
  COLLECTIONS,
  FULFILLMENT_LABELS,
  PROMOTION_STATUS_LABELS,
  SETTINGS_DOCS,
  paths,
  type Promotion,
  type PromotionRedemption,
  type PromotionSettings,
  type WithId,
} from '@golink/shared';
import { formatEUR, formatPercent, type StatusMeta } from '@golink/ui';
import { useCan, useRestaurantAccess } from '@/auth/RestaurantAccess';
import { collectionAt, docAt, toMillis, useCollection, useDoc } from '@/lib/firestore';

export type PromotionRow = WithId<Promotion>;

/** Plafonds par défaut si le réglage plateforme n'est pas lisible. */
export const FALLBACK_PROMOTION_SETTINGS = {
  capsEnabled: true as boolean,
  restaurantMaxPercentBps: 5000,
  restaurantMaxFixedCents: 1500,
  restaurantRequiresReview: true,
  maxActivePerRestaurant: 3,
};

export function useRestaurantPromotions() {
  const { restaurantId } = useRestaurantAccess();
  const can = useCan();
  const q = can('marketing.manage')
    ? query(
        collectionAt(COLLECTIONS.promotions),
        where('scope', '==', 'restaurant'),
        where('restaurantId', '==', restaurantId),
        orderBy('createdAt', 'desc'),
        limit(100),
      )
    : null;
  return useCollection<Promotion>(q);
}

export function usePromotionSettings() {
  const state = useDoc<PromotionSettings>(docAt(paths.settings(SETTINGS_DOCS.promotions)));
  const merged = { ...FALLBACK_PROMOTION_SETTINGS, ...(state.data ?? {}) };
  return { ...merged, capsEnabled: merged.capsEnabled !== false };
}

/** Règles Ciyou Eats applicables, en une phrase. */
export function promotionRulesText(limits: ReturnType<typeof usePromotionSettings>): string {
  const caps = limits.capsEnabled
    ? `remise jusqu’à ${limits.restaurantMaxPercentBps / 100} % ou ${formatEUR(limits.restaurantMaxFixedCents, { cents: true })}, ${limits.maxActivePerRestaurant} offres en ligne au plus`
    : 'aucun plafond de remise ni de nombre d’offres';
  const review = limits.restaurantRequiresReview ? 'chaque nouvelle offre est vérifiée par Ciyou Eats avant publication (sous 24 h ouvrées)' : 'vos offres sont publiées immédiatement';
  return `${caps.charAt(0).toUpperCase()}${caps.slice(1)} ; ${review}. Les remises sont à la charge de l’établissement.`;
}

export function useRedemptions(promotionId: string | null) {
  const { restaurantId } = useRestaurantAccess();
  const q = promotionId
    ? query(
        collectionAt(COLLECTIONS.promotionRedemptions),
        where('restaurantId', '==', restaurantId),
        where('promotionId', '==', promotionId),
        orderBy('createdAt', 'desc'),
        limit(500),
      )
    : null;
  return useCollection<PromotionRedemption>(q);
}

/** Remise lisible : « 20 % », « 3,00 € », « Livraison offerte ». */
export function discountLabel(p: Pick<Promotion, 'kind' | 'value'>): string {
  if (p.kind === 'percentage') return formatPercent(p.value / 10_000);
  if (p.kind === 'fixed') return formatEUR(p.value, { cents: true });
  return 'Livraison offerte';
}

/** Description courte des conditions. */
export function conditionsLabel(p: Pick<Promotion, 'minSubtotalCents' | 'maxDiscountCents' | 'kind'>): string {
  const parts: string[] = [];
  parts.push(p.minSubtotalCents > 0 ? `dès ${formatEUR(p.minSubtotalCents, { cents: true })}` : 'sans minimum');
  if (p.kind === 'percentage' && p.maxDiscountCents) parts.push(`plafond ${formatEUR(p.maxDiscountCents, { cents: true })}`);
  return parts.join(' · ');
}

export const TARGET_LABELS: Record<Promotion['target'], string> = {
  everyone: 'Tous les clients',
  new_customers: 'Nouveaux clients',
  loyal_customers: 'Clients fidèles',
  inactive_customers: 'Clients inactifs',
};

export function modesLabel(modes: Promotion['modes']): string {
  return modes.map((m) => FULFILLMENT_LABELS[m]).join(' · ');
}

export type DisplayStatus = Promotion['status'] | 'scheduled' | 'expired';

export const DISPLAY_STATUS: Record<DisplayStatus, StatusMeta> = {
  draft: { label: PROMOTION_STATUS_LABELS.draft, tone: 'neutral' },
  pending_review: { label: 'En validation', tone: 'info', pulse: true },
  active: { label: 'En ligne', tone: 'success' },
  scheduled: { label: 'Programmée', tone: 'teal' },
  paused: { label: PROMOTION_STATUS_LABELS.paused, tone: 'amber' },
  rejected: { label: PROMOTION_STATUS_LABELS.rejected, tone: 'danger' },
  ended: { label: PROMOTION_STATUS_LABELS.ended, tone: 'neutral' },
  expired: { label: 'Expirée', tone: 'neutral' },
};

/** Statut vu par le restaurant : une offre en ligne peut être programmée ou expirée. */
export function displayStatus(p: Promotion, now = Date.now()): DisplayStatus {
  if (p.status === 'active') {
    const starts = toMillis(p.startsAt) ?? 0;
    const ends = toMillis(p.endsAt);
    if (ends !== null && ends < now) return 'expired';
    if (starts > now) return 'scheduled';
  }
  return p.status;
}

export function promotionName(p: Pick<Promotion, 'code' | 'title'>): string {
  return p.code ?? p.title.fr;
}

/** Code aléatoire lisible (sans caractères ambigus). */
export function generateCode(prefix: string): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const clean = prefix
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 8);
  let suffix = '';
  for (let i = 0; i < 4; i += 1) suffix += alphabet[Math.floor(Math.random() * alphabet.length)];
  return `${clean || 'OFFRE'}${suffix}`;
}
