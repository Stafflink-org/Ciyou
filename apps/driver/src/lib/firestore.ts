// Accès Firestore de l'app livreur : hooks temps réel, conversions et appels de
// Cloud Functions, sur les instances Firebase de `lib/firebase.ts`. Copie
// fidèle de apps/client/src/lib/firestore.ts (mêmes signatures, même
// justification : `@golink/web` exporte aussi des écrans DOM que Metro ne peut
// pas empaqueter pour React Native).
import { useEffect, useState } from 'react';
import {
  DocumentReference,
  Timestamp,
  collection,
  doc,
  onSnapshot,
  queryEqual,
  refEqual,
  serverTimestamp,
  type CollectionReference,
  type DocumentSnapshot,
  type FieldValue,
  type FirestoreError,
  type Query,
  type QueryDocumentSnapshot,
} from 'firebase/firestore';
import { FirebaseError } from 'firebase/app';
import { httpsCallable, type Functions } from 'firebase/functions';
import type { WithId } from '@golink/shared';
import { db, functions } from './firebase';

/* ------------------------------- Conversions ------------------------------ */

export type DateInput = Timestamp | Date | number | string | { toDate(): Date } | null | undefined;

/** Timestamp Firestore (ou Date, ms, chaîne ISO) vers Date JavaScript. */
export function toDate(value: DateInput): Date | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === 'number') return new Date(value);
  if (typeof value === 'string') {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return value.toDate();
}

/** Millisecondes depuis l'époque Unix, ou null. */
export function toMillis(value: DateInput): number | null {
  return toDate(value)?.getTime() ?? null;
}

/** Date JavaScript vers Timestamp Firestore. */
export function toTimestamp(value: Date | number): Timestamp {
  return Timestamp.fromMillis(value instanceof Date ? value.getTime() : value);
}

/** Données d'un instantané avec son identifiant (horodatages serveur en attente estimés). */
export function withId<T>(snapshot: QueryDocumentSnapshot | DocumentSnapshot): WithId<T> {
  return { ...(snapshot.data({ serverTimestamps: 'estimate' }) as T), id: snapshot.id };
}

export function createdFields(uid: string): { createdAt: FieldValue; createdBy: string; updatedAt: FieldValue; updatedBy: string } {
  return { createdAt: serverTimestamp(), createdBy: uid, updatedAt: serverTimestamp(), updatedBy: uid };
}

export function updatedFields(uid: string): { updatedAt: FieldValue; updatedBy: string } {
  return { updatedAt: serverTimestamp(), updatedBy: uid };
}

/* --------------------------------- Erreurs --------------------------------- */

// Codes Functions dont le message vient déjà rédigé (en français) par le serveur.
const SERVER_WORDED = new Set(['invalid-argument', 'failed-precondition', 'already-exists', 'not-found', 'permission-denied', 'out-of-range']);

/** Fonction de traduction minimale (compatible `t` de n'importe quel namespace via `common:...`). */
export type TranslateFn = (key: string, vars?: Record<string, string | number | undefined>) => string;

/**
 * Message lisible pour une erreur Firebase quelconque, dans la langue courante.
 * `t` peut être le `t` de n'importe quel namespace (les clés `common:errors.*` sont préfixées).
 */
export function errorMessage(error: unknown, t: TranslateFn, fallback?: string): string {
  const fb = fallback ?? t('common:errors.default');
  if (error instanceof FirebaseError) {
    const isFunctions = error.code.startsWith('functions/');
    const code = isFunctions ? error.code.slice('functions/'.length) : error.code;
    if (isFunctions && SERVER_WORDED.has(code) && error.message && error.message !== code.toUpperCase()) {
      return error.message.replace(/\s*\[\d{3}\]$/, '');
    }
    switch (code) {
      case 'wrong-password':
      case 'invalid-credential':
        return t('common:errors.wrongPassword');
      case 'user-not-found':
        return t('common:errors.userNotFound');
      case 'email-already-in-use':
        return t('common:errors.emailAlreadyInUse');
      case 'weak-password':
        return t('common:errors.weakPassword');
      case 'invalid-email':
        return t('common:errors.invalidEmail');
      case 'too-many-requests':
        return t('common:errors.tooManyRequests');
      case 'network-request-failed':
        return t('common:errors.networkRequestFailed');
      case 'permission-denied':
        return t('common:errors.permissionDenied');
      default:
        return fb;
    }
  }
  return fb;
}

export function errorCode(error: unknown): string | null {
  if (!(error instanceof FirebaseError)) return null;
  return error.code.replace(/^(functions|auth|firestore|storage)\//, '');
}

/* ---------------------------------- Refs ----------------------------------- */

export function docAt(path: string): DocumentReference {
  return doc(db, path);
}

export function collectionAt(path: string): CollectionReference {
  return collection(db, path);
}

/** Cloud Function « callable » (europe-west1) typée. */
export function callFunction<Input = void, Output = void>(name: string, fx: Functions = functions) {
  const ref = httpsCallable<Input, Output>(fx, name);
  return async (input: Input): Promise<Output> => (await ref(input)).data;
}

/* --------------------------------- Hooks ------------------------------------ */

type Target = Query | DocumentReference;

function sameTarget(a: Target | null, b: Target | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  if (a instanceof DocumentReference) return b instanceof DocumentReference && refEqual(a, b);
  if (b instanceof DocumentReference) return false;
  return queryEqual(a, b);
}

/** Conserve la même instance tant que la requête est équivalente (évite de relancer l'abonnement à chaque rendu). */
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
  missing: boolean;
  loading: boolean;
  error: FirestoreError | null;
}

interface Snapshot<V> {
  target: Target | null;
  value: V;
  error: FirestoreError | null;
}

/** Document Firestore en temps réel. `ref` null/undefined : aucun abonnement. */
export function useDoc<T>(ref: DocumentReference | null | undefined): DocState<T> {
  const target = useStableTarget(ref);
  const [snap, setSnap] = useState<Snapshot<WithId<T> | null | undefined>>({ target: null, value: undefined, error: null });

  useEffect(() => {
    if (!target) return;
    return onSnapshot(
      target,
      (d) => setSnap({ target, value: d.exists() ? withId<T>(d) : null, error: null }),
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
      (result) => setSnap({ target, value: result.docs.map((d) => withId<T>(d)), error: null }),
      (error) => setSnap({ target, value: [], error }),
    );
  }, [target]);

  if (!target) return { data: [], loading: false, error: null };
  const current = snap.target === target;
  return { data: current ? snap.value : [], loading: !current, error: current ? snap.error : null };
}
