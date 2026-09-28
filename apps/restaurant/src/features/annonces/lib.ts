// Offres automatiques sur un plat (« 1 acheté, 1 offert », « Le 2e à -50 % ») : libellés,
// statuts d'affichage et lecture Firestore. Distinct des codes promo (features/promotions).
import { limit, orderBy, query, where } from 'firebase/firestore';
import {
  PRODUCT_OFFER_KINDS,
  PRODUCT_OFFER_RULES,
  paths,
  productOfferStatus,
  type ProductOffer,
  type ProductOfferKind,
  type ProductOfferStatus,
  type WithId,
} from '@golink/shared';
import type { StatusMeta } from '@golink/ui';
import { useCan, useRestaurantAccess } from '@/auth/RestaurantAccess';
import { collectionAt, useCollection } from '@/lib/firestore';

export type OfferRow = WithId<ProductOffer>;

export { PRODUCT_OFFER_KINDS, PRODUCT_OFFER_RULES, productOfferStatus };

export function useRestaurantOffers() {
  const { restaurantId } = useRestaurantAccess();
  const can = useCan();
  const q = can('marketing.manage') ? query(collectionAt(paths.restaurantSub(restaurantId, 'productOffers')), orderBy('createdAt', 'desc'), limit(300)) : null;
  return useCollection<ProductOffer>(q);
}

/** Offres (toutes, quel que soit leur statut) portant sur un plat précis — onglet « Visibilité » de la fiche produit (§B6). */
export function useOffersForProduct(restaurantId: string, productId: string | null) {
  const can = useCan();
  const q = productId && can('marketing.manage') ? query(collectionAt(paths.restaurantSub(restaurantId, 'productOffers')), where('productId', '==', productId), limit(20)) : null;
  return useCollection<ProductOffer>(q);
}

export const KIND_LABELS: Record<ProductOfferKind, string> = {
  bogo: '1 acheté, 1 offert',
  half_second: 'Le 2ᵉ à -50 %',
};

export const KIND_SHORT_LABELS: Record<ProductOfferKind, string> = {
  bogo: 'Offert',
  half_second: '-50 % le 2ᵉ',
};

export const STATUS_META: Record<ProductOfferStatus, StatusMeta> = {
  live: { label: 'En ligne', tone: 'success' },
  scheduled: { label: 'Programmée', tone: 'teal' },
  paused: { label: 'En pause', tone: 'amber' },
  ended: { label: 'Terminée', tone: 'neutral' },
  disabled: { label: 'Désactivée par Ciyou Eats', tone: 'danger' },
};

export function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** AAAA-MM-JJ -> JJ/MM/AAAA (aucune dépendance de fuseau, la date est déjà un jour civil). */
export function formatDay(day: string): string {
  const [y, m, d] = day.split('-');
  return `${d}/${m}/${y}`;
}

export function periodLabel(o: Pick<OfferRow, 'startDay' | 'endDay'>): string {
  return o.endDay ? `${formatDay(o.startDay)} → ${formatDay(o.endDay)}` : `Depuis le ${formatDay(o.startDay)}`;
}
