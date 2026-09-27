// Lectures Firestore des écrans financiers, toutes filtrées par établissement.
// Agrégats quotidiens et reversements en temps réel ; commandes et grand livre
// d'une période en lecture ponctuelle (volumes plus importants), avec relecture.
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  getDocs,
  limit,
  orderBy,
  query,
  queryEqual,
  Timestamp,
  where,
  type FirestoreError,
  type Query,
} from 'firebase/firestore';
import {
  COLLECTIONS,
  DEFAULT_PRICING_BY_COUNTRY,
  paths,
  vatOnHt,
  type LedgerEntry,
  type Order,
  type Refund,
  type RestaurantDailyStats,
  type WithId,
} from '@golink/shared';
import { collectionAt, useCollection, withId } from '@/lib/firestore';

export interface OnceState<T> {
  data: WithId<T>[];
  loading: boolean;
  error: FirestoreError | null;
  /** Nombre maximal atteint : la période contient peut-être d'autres documents. */
  truncated: boolean;
  refresh: () => void;
}

/** Lecture ponctuelle d'une requête (relancée si la requête change ou sur `refresh`). */
export function useQueryOnce<T>(target: Query | null, max: number): OnceState<T> {
  const stable = useRef<Query | null>(null);
  if (target === null) stable.current = null;
  else if (stable.current === null || !queryEqual(stable.current, target)) stable.current = target;
  const current = stable.current;
  const [version, setVersion] = useState(0);
  const [state, setState] = useState<{ query: Query | null; version: number; docs: WithId<T>[]; error: FirestoreError | null }>({
    query: null,
    version: -1,
    docs: [],
    error: null,
  });

  useEffect(() => {
    if (!current) return;
    let cancelled = false;
    getDocs(query(current, limit(max))).then(
      (snapshot) => !cancelled && setState({ query: current, version, docs: snapshot.docs.map((doc) => withId<T>(doc)), error: null }),
      (error: FirestoreError) => !cancelled && setState({ query: current, version, docs: [], error }),
    );
    return () => {
      cancelled = true;
    };
  }, [current, version, max]);

  const refresh = useCallback(() => setVersion((value) => value + 1), []);
  if (!current) return { data: [], loading: false, error: null, truncated: false, refresh };
  const settled = state.query === current && state.version === version;
  return {
    data: settled ? state.docs : [],
    loading: !settled,
    error: settled ? state.error : null,
    truncated: settled && state.docs.length >= max,
    refresh,
  };
}

/** Agrégats quotidiens du restaurant entre deux jours inclus (AAAA-MM-JJ). */
export function useDailyStats(restaurantId: string, from: string, to: string) {
  return useCollection<RestaurantDailyStats>(
    query(
      collectionAt(paths.restaurantSub(restaurantId, 'dailyStats')),
      where('day', '>=', from),
      where('day', '<=', to),
      orderBy('day', 'asc'),
    ),
  );
}

export const ORDERS_LIMIT = 4000;

/** Commandes passées sur la période (tous statuts), les plus récentes d'abord. */
export function useOrdersInRange(restaurantId: string, start: Date, endExclusive: Date, enabled = true) {
  return useQueryOnce<Order>(
    enabled
      ? query(
          collectionAt(COLLECTIONS.orders),
          where('restaurantId', '==', restaurantId),
          where('createdAt', '>=', Timestamp.fromDate(start)),
          where('createdAt', '<', Timestamp.fromDate(endExclusive)),
          orderBy('createdAt', 'desc'),
        )
      : null,
    ORDERS_LIMIT,
  );
}

/** Mouvements du grand livre du restaurant sur la période. */
export function useLedgerInRange(restaurantId: string, start: Date, endExclusive: Date, enabled = true) {
  return useQueryOnce<LedgerEntry>(
    enabled
      ? query(
          collectionAt(COLLECTIONS.ledgerEntries),
          where('accountType', '==', 'restaurant'),
          where('accountId', '==', restaurantId),
          where('createdAt', '>=', Timestamp.fromDate(start)),
          where('createdAt', '<', Timestamp.fromDate(endExclusive)),
          orderBy('createdAt', 'desc'),
        )
      : null,
    8000,
  );
}

/** Remboursements des commandes du restaurant demandés sur la période (temps réel). */
export function useRefundsInRange(restaurantId: string, start: Date, endExclusive: Date) {
  return useCollection<Refund>(
    query(
      collectionAt(COLLECTIONS.refunds),
      where('restaurantId', '==', restaurantId),
      where('requestedAt', '>=', Timestamp.fromDate(start)),
      where('requestedAt', '<', Timestamp.fromDate(endExclusive)),
      orderBy('requestedAt', 'desc'),
      limit(500),
    ),
  );
}

export interface FinanceTotals {
  orders: number;
  delivered: number;
  cancelled: number;
  rejected: number;
  late: number;
  salesCents: number;
  discountCents: number;
  commissionHtCents: number;
  commissionVatCents: number;
  netPayoutCents: number;
  averageBasketCents: number;
  newCustomers: number;
  byMode: Record<string, number>;
  byPayment: Record<string, number>;
}

export function emptyTotals(): FinanceTotals {
  return {
    orders: 0,
    delivered: 0,
    cancelled: 0,
    rejected: 0,
    late: 0,
    salesCents: 0,
    discountCents: 0,
    commissionHtCents: 0,
    commissionVatCents: 0,
    netPayoutCents: 0,
    averageBasketCents: 0,
    newCustomers: 0,
    byMode: {},
    byPayment: {},
  };
}

/** Somme des agrégats quotidiens ; TVA sur commission au taux normal du pays. */
export function sumDaily(days: readonly RestaurantDailyStats[], countryId: string): FinanceTotals {
  const totals = emptyTotals();
  for (const day of days) {
    totals.orders += day.ordersCount ?? 0;
    totals.delivered += day.deliveredCount ?? 0;
    totals.cancelled += day.cancelledCount ?? 0;
    totals.rejected += day.rejectedCount ?? 0;
    totals.late += day.lateCount ?? 0;
    totals.salesCents += day.salesCents ?? 0;
    totals.discountCents += day.discountFundedCents ?? 0;
    totals.commissionHtCents += day.commissionCents ?? 0;
    totals.netPayoutCents += day.netPayoutCents ?? 0;
    totals.newCustomers += day.newCustomers ?? 0;
    for (const [mode, count] of Object.entries(day.byMode ?? {})) totals.byMode[mode] = (totals.byMode[mode] ?? 0) + (count ?? 0);
    for (const [method, cents] of Object.entries(day.byPayment ?? {})) {
      totals.byPayment[method] = (totals.byPayment[method] ?? 0) + (cents ?? 0);
    }
  }
  const standardBps = DEFAULT_PRICING_BY_COUNTRY[countryId]?.vat.standardBps ?? 2000;
  totals.commissionVatCents = vatOnHt(totals.commissionHtCents, standardBps);
  totals.averageBasketCents = totals.delivered > 0 ? Math.round(totals.salesCents / totals.delivered) : 0;
  return totals;
}

/** Part d'un remboursement supportée par le restaurant (retenue sur reversement). */
export function restaurantShare(refund: Refund): number {
  if (refund.status === 'rejected' || refund.status === 'failed') return 0;
  return refund.allocation?.restaurantCents ?? 0;
}
