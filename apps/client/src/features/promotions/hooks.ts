// Promotions (§16 client.md) — vitrine réelle (`promotions`, showcase &&
// active, cf. firebase/rules/marketing.rules).
import { collection, query, where } from 'firebase/firestore';
import type { Promotion } from '@golink/shared';
import { db } from '../../lib/firebase';
import { useCollection } from '../../lib/firestore';

export function useShowcasePromotions() {
  const q = query(collection(db, 'promotions'), where('showcase', '==', true), where('status', '==', 'active'));
  return useCollection<Promotion>(q);
}

export function promotionValueLabel(promo: Promotion): string {
  if (promo.kind === 'percentage') return `− ${(promo.value / 100).toFixed(0)} %`;
  if (promo.kind === 'fixed') return `− ${(promo.value / 100).toFixed(2).replace('.', ',')} €`;
  return 'Livraison offerte';
}
