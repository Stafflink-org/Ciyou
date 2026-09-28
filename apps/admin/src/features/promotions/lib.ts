// Calculs et filtres des offres (périmètre, coût, période).
import { useCallback, useMemo } from 'react';
import { collection, limit, orderBy, query } from 'firebase/firestore';
import { COLLECTIONS, type Promotion, type WithId } from '@golink/shared';
import { formatDate } from '@golink/ui';
import { useGeoScope } from '@/layout/GeoScope';
import { db } from '@/lib/firebase';
import { toMillis, useCollection } from '@/lib/firestore';
import { platformShare } from '../_croissance/labels';

export type PromotionRow = WithId<Promotion>;

/** Toutes les offres (quelques centaines au plus), triées de la plus récente à la plus ancienne. */
export function usePromotions() {
  const q = useMemo(() => query(collection(db, COLLECTIONS.promotions), orderBy('createdAt', 'desc'), limit(1000)), []);
  return useCollection<Promotion>(q);
}

/** L'offre s'applique-t-elle au périmètre choisi en barre supérieure ? */
export function usePromotionCovers() {
  const geo = useGeoScope();
  return useCallback(
    (p: Pick<Promotion, 'scope' | 'countryId' | 'cityIds'>) => {
      const cityIds = p.cityIds ?? [];
      if (geo.cityIds) {
        if (p.scope === 'platform') return true;
        if (p.scope === 'country') return geo.cities.some((c) => geo.cityIds?.includes(c.id) && c.countryId === p.countryId);
        return cityIds.some((c) => geo.cityIds?.includes(c));
      }
      if (geo.countryId) return p.scope === 'platform' || p.countryId === geo.countryId;
      return true;
    },
    [geo.cityIds, geo.countryId, geo.cities],
  );
}

/** Coût des remises accordées, réparti entre GoLink et les restaurants (centimes). */
export function promotionCost(p: Pick<Promotion, 'funding' | 'restaurantShareBps' | 'stats'>) {
  const total = p.stats?.discountCents ?? 0;
  const platform = Math.round(total * platformShare(p));
  return { total, platform, restaurant: total - platform };
}

/** L'offre est-elle réellement visible des clients maintenant ? */
export function isLive(p: Pick<Promotion, 'status' | 'startsAt' | 'endsAt'>, now: number): boolean {
  if (p.status !== 'active') return false;
  const start = toMillis(p.startsAt) ?? 0;
  const end = toMillis(p.endsAt);
  return start <= now && (end === null || end > now);
}

export function periodLabel(p: Pick<Promotion, 'startsAt' | 'endsAt'>): string {
  const start = toMillis(p.startsAt);
  const end = toMillis(p.endsAt);
  if (!start) return '—';
  return end ? `${formatDate(start)} → ${formatDate(end)}` : `Depuis le ${formatDate(start)}`;
}

/** Libellé d'état tenant compte des dates (programmée, expirée). */
export function timingHint(p: Pick<Promotion, 'status' | 'startsAt' | 'endsAt'>, now: number): string | null {
  if (p.status !== 'active') return null;
  const start = toMillis(p.startsAt) ?? 0;
  const end = toMillis(p.endsAt);
  if (start > now) return `Démarre le ${formatDate(start)}`;
  if (end !== null && end <= now) return 'Date de fin dépassée';
  if (end !== null && end - now < 3 * 86_400_000) return 'Se termine bientôt';
  return null;
}
