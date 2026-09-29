// Lecture réelle des gains du livreur connecté (driverEarnings) — aucune
// formule inventée (contrairement à la maquette Replit, voir
// golink-maquette/v2/livreur-admin.md §1.3 : le barème réel, fixe sous 2 km
// puis au km + bonus de pointe par ville, est calculé côté serveur à chaque
// livraison, `onOrderDelivered` → `driverEarnings`).
import { limit, orderBy, query, where } from 'firebase/firestore';
import type { DriverEarning, WithId } from '@golink/shared';
import { collectionAt, useCollection } from '../../lib/firestore';

export function useDriverEarnings(uid: string | null, take = 60) {
  const target = uid ? query(collectionAt('driverEarnings'), where('driverId', '==', uid), orderBy('earnedAt', 'desc'), limit(take)) : null;
  return useCollection<DriverEarning>(target);
}

function startOfWeek(now: Date): number {
  const d = new Date(now);
  const day = (d.getDay() + 6) % 7; // lundi = 0
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - day);
  return d.getTime();
}

export interface EarningsSummary {
  weekTotalCents: number;
  weekTipsCents: number;
  weekDeliveries: number;
  weekEntries: WithId<DriverEarning>[];
  recentPayouts: WithId<DriverEarning>[];
}

/** Regroupement local (aucun agrégat serveur dédié pour ce lot) : semaine en cours + liste récente. */
export function summarizeEarnings(entries: WithId<DriverEarning>[]): EarningsSummary {
  const weekStart = startOfWeek(new Date());
  const weekEntries = entries.filter((e) => (e.earnedAt?.toMillis?.() ?? 0) >= weekStart);
  return {
    weekTotalCents: weekEntries.reduce((sum, e) => sum + e.amountCents + e.tipCents, 0),
    weekTipsCents: weekEntries.reduce((sum, e) => sum + e.tipCents, 0),
    weekDeliveries: weekEntries.filter((e) => e.kind === 'delivery').length,
    weekEntries,
    recentPayouts: entries,
  };
}
