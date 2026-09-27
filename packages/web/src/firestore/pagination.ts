import { useCallback, useEffect, useState } from 'react';
import {
  getCountFromServer,
  getDocs,
  limit,
  onSnapshot,
  query as buildQuery,
  startAfter,
  type FirestoreError,
  type Query,
  type QueryDocumentSnapshot,
} from 'firebase/firestore';
import type { WithId } from '@golink/shared';
import { withId } from './convert';
import { useStableTarget } from './hooks';

export interface InfiniteCollectionState<T> {
  data: WithId<T>[];
  /** Premier chargement. */
  loading: boolean;
  /** Chargement d'une page supplémentaire. */
  loadingMore: boolean;
  hasMore: boolean;
  error: FirestoreError | null;
  loadMore: () => void;
}

/**
 * Liste en temps réel chargée par pages successives (« Afficher plus », défilement
 * infini). La requête doit porter son propre `orderBy` ; la limite est ajoutée ici.
 */
export function useInfiniteCollection<T>(
  query: Query | null | undefined,
  { pageSize = 25 }: { pageSize?: number } = {},
): InfiniteCollectionState<T> {
  const target = useStableTarget(query);
  const [pages, setPages] = useState({ target, count: 1 });
  const count = pages.target === target ? pages.count : 1;
  const size = count * pageSize;
  const [snap, setSnap] = useState<{
    target: Query | null;
    size: number;
    docs: WithId<T>[];
    error: FirestoreError | null;
  }>({ target: null, size: 0, docs: [], error: null });

  useEffect(() => {
    if (!target) return;
    return onSnapshot(
      buildQuery(target, limit(size)),
      (result) => setSnap({ target, size, docs: result.docs.map((doc) => withId<T>(doc)), error: null }),
      (error) => setSnap({ target, size, docs: [], error }),
    );
  }, [target, size]);

  const sameQuery = snap.target === target && target !== null;
  const settled = sameQuery && snap.size === size;
  const loadMore = useCallback(() => {
    setPages((current) => ({ target, count: (current.target === target ? current.count : 1) + 1 }));
  }, [target]);

  if (!target) {
    return { data: [], loading: false, loadingMore: false, hasMore: false, error: null, loadMore };
  }
  return {
    data: sameQuery ? snap.docs : [],
    loading: !sameQuery,
    loadingMore: sameQuery && !settled,
    hasMore: settled && snap.docs.length === size,
    error: sameQuery ? snap.error : null,
    loadMore,
  };
}

export interface PagedQueryState<T> {
  data: WithId<T>[];
  /** Page courante, à partir de 0. */
  page: number;
  pageSize: number;
  /** Nombre total de documents (si `withTotal`). */
  total: number | null;
  hasNext: boolean;
  hasPrevious: boolean;
  loading: boolean;
  error: FirestoreError | null;
  next: () => void;
  previous: () => void;
  /** Recharge la page courante (et le total). */
  refresh: () => void;
}

/**
 * Pagination par curseurs (page précédente / suivante), lecture ponctuelle.
 * Adaptée aux grands tableaux du back-office où le temps réel n'est pas utile.
 */
export function usePagedQuery<T>(
  query: Query | null | undefined,
  { pageSize = 25, withTotal = false }: { pageSize?: number; withTotal?: boolean } = {},
): PagedQueryState<T> {
  const target = useStableTarget(query);
  // Curseurs : dernier document de chaque page déjà parcourue.
  const [cursor, setCursor] = useState<{ target: Query | null; stack: QueryDocumentSnapshot[] }>({ target, stack: [] });
  const stack = cursor.target === target ? cursor.stack : [];
  const page = stack.length;
  const [version, setVersion] = useState(0);
  const [result, setResult] = useState<{
    target: Query;
    key: string;
    docs: QueryDocumentSnapshot[];
    hasNext: boolean;
    error: FirestoreError | null;
  } | null>(null);
  const [total, setTotal] = useState<{ target: Query | null; value: number | null }>({ target: null, value: null });
  const key = `${page}:${version}`;

  useEffect(() => {
    if (!target) return;
    let cancelled = false;
    const last = stack[stack.length - 1];
    const pageQuery = last ? buildQuery(target, startAfter(last), limit(pageSize + 1)) : buildQuery(target, limit(pageSize + 1));
    getDocs(pageQuery).then(
      (snapshot) => {
        if (cancelled) return;
        setResult({ target, key, docs: snapshot.docs.slice(0, pageSize), hasNext: snapshot.docs.length > pageSize, error: null });
      },
      (error: FirestoreError) => {
        if (!cancelled) setResult({ target, key, docs: [], hasNext: false, error });
      },
    );
    return () => {
      cancelled = true;
    };
    // `stack` est décrit par `key` (page) et `target`.
  }, [target, key, pageSize]);

  useEffect(() => {
    if (!target || !withTotal) return;
    let cancelled = false;
    getCountFromServer(target).then(
      (snapshot) => !cancelled && setTotal({ target, value: snapshot.data().count }),
      () => !cancelled && setTotal({ target, value: null }),
    );
    return () => {
      cancelled = true;
    };
  }, [target, withTotal, version]);

  const current = result !== null && result.target === target && result.key === key ? result : null;
  const docs = current?.docs ?? [];

  const next = useCallback(() => {
    const last = docs[docs.length - 1];
    if (!current?.hasNext || !last) return;
    setCursor({ target, stack: [...stack, last] });
  }, [current, docs, stack, target]);

  const previous = useCallback(() => {
    if (stack.length === 0) return;
    setCursor({ target, stack: stack.slice(0, -1) });
  }, [stack, target]);

  const refresh = useCallback(() => setVersion((value) => value + 1), []);

  return {
    data: docs.map((doc) => withId<T>(doc)),
    page,
    pageSize,
    total: total.target === target ? total.value : null,
    hasNext: current?.hasNext ?? false,
    hasPrevious: page > 0,
    loading: Boolean(target) && current === null,
    error: current?.error ?? null,
    next,
    previous,
    refresh,
  };
}
