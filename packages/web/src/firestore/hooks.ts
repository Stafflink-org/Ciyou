import { useEffect, useState } from 'react';
import {
  DocumentReference,
  onSnapshot,
  queryEqual,
  refEqual,
  type FirestoreError,
  type Query,
} from 'firebase/firestore';
import type { WithId } from '@golink/shared';
import { withId } from './convert';

type Target = Query | DocumentReference;

function sameTarget(a: Target | null, b: Target | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  if (a instanceof DocumentReference) return b instanceof DocumentReference && refEqual(a, b);
  if (b instanceof DocumentReference) return false;
  return queryEqual(a, b);
}

/**
 * Conserve la même instance tant que la requête est équivalente : les appelants
 * peuvent reconstruire leur requête à chaque rendu sans relancer l'abonnement.
 */
export function useStableTarget<T extends Target>(target: T | null | undefined): T | null {
  const next = target ?? null;
  const [stable, setStable] = useState<T | null>(next);
  if (!sameTarget(stable, next)) {
    setStable(next);
    return next;
  }
  return stable;
}

export interface DocState<T> {
  data: WithId<T> | null;
  /** Le document a été lu et n'existe pas. */
  missing: boolean;
  loading: boolean;
  error: FirestoreError | null;
}

interface Snapshot<V> {
  target: Target | null;
  value: V;
  error: FirestoreError | null;
}

/**
 * Document Firestore en temps réel. `ref` null ou undefined : aucun abonnement
 * (utile tant qu'un identifiant n'est pas connu).
 */
export function useDoc<T>(ref: DocumentReference | null | undefined): DocState<T> {
  const target = useStableTarget(ref);
  const [snap, setSnap] = useState<Snapshot<WithId<T> | null | undefined>>({ target: null, value: undefined, error: null });

  useEffect(() => {
    if (!target) return;
    return onSnapshot(
      target,
      (doc) => setSnap({ target, value: doc.exists() ? withId<T>(doc) : null, error: null }),
      (error) => setSnap({ target, value: null, error }),
    );
  }, [target]);

  if (!target) return { data: null, missing: false, loading: false, error: null };
  const current = snap.target === target;
  return {
    data: current ? (snap.value ?? null) : null,
    missing: current && snap.value === null && !snap.error,
    loading: !current,
    error: current ? snap.error : null,
  };
}

export interface CollectionState<T> {
  data: WithId<T>[];
  loading: boolean;
  error: FirestoreError | null;
}

/** Résultats d'une requête Firestore en temps réel (tableau vide pendant le chargement). */
export function useCollection<T>(query: Query | null | undefined): CollectionState<T> {
  const target = useStableTarget(query);
  const [snap, setSnap] = useState<Snapshot<WithId<T>[]>>({ target: null, value: [], error: null });

  useEffect(() => {
    if (!target) return;
    return onSnapshot(
      target,
      (result) => setSnap({ target, value: result.docs.map((doc) => withId<T>(doc)), error: null }),
      (error) => setSnap({ target, value: [], error }),
    );
  }, [target]);

  if (!target) return { data: [], loading: false, error: null };
  const current = snap.target === target;
  return { data: current ? snap.value : [], loading: !current, error: current ? snap.error : null };
}

/**
 * Plusieurs documents en temps réel (ex. établissements d'un groupe), dans
 * l'ordre des références. Les documents absents ou illisibles sont omis.
 */
export function useDocs<T>(refs: readonly DocumentReference[]): CollectionState<T> {
  const key = refs.map((ref) => ref.path).join('|');
  const [snap, setSnap] = useState<{ key: string; byPath: Record<string, WithId<T> | null>; error: FirestoreError | null }>({
    key: '',
    byPath: {},
    error: null,
  });

  useEffect(() => {
    if (!key) return;
    const paths = key.split('|');
    const byPath: Record<string, WithId<T> | null> = {};
    let firstError: FirestoreError | null = null;
    const publish = () => {
      if (Object.keys(byPath).length === paths.length) setSnap({ key, byPath: { ...byPath }, error: firstError });
    };
    const unsubscribes = refs.map((ref) =>
      onSnapshot(
        ref,
        (doc) => {
          byPath[ref.path] = doc.exists() ? withId<T>(doc) : null;
          publish();
        },
        (error) => {
          firstError ??= error;
          byPath[ref.path] = null;
          publish();
        },
      ),
    );
    return () => unsubscribes.forEach((unsubscribe) => unsubscribe());
    // `key` résume les chemins : `refs` peut changer d'instance à chaque rendu.
  }, [key]);

  if (!key) return { data: [], loading: false, error: null };
  const current = snap.key === key;
  return {
    data: current ? refs.map((ref) => snap.byPath[ref.path]).filter((doc): doc is WithId<T> => Boolean(doc)) : [],
    loading: !current,
    error: current ? snap.error : null,
  };
}
