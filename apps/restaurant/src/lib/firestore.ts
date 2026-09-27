// Accès Firestore de l'application : hooks temps réel, pagination, conversions
// et appels de Cloud Functions, liés aux instances Firebase de lib/firebase.ts.
import { collection, doc, type CollectionReference, type DocumentReference } from 'firebase/firestore';
import { callable } from '@golink/web';
import { db, functions } from './firebase';

export {
  createdFields,
  errorCode,
  errorMessage,
  toDate,
  toMillis,
  toTimestamp,
  updatedFields,
  useCollection,
  useDoc,
  useDocs,
  useInfiniteCollection,
  useMutation,
  usePagedQuery,
  withId,
} from '@golink/web';

/** Référence de document à partir d'un chemin (voir `paths` de @golink/shared). */
export function docAt(path: string): DocumentReference {
  return doc(db, path);
}

/** Référence de collection à partir d'un chemin. */
export function collectionAt(path: string): CollectionReference {
  return collection(db, path);
}

/**
 * Cloud Function « callable » (europe-west1) typée.
 * Ex. : `const acceptOrder = callFunction<{ orderId: string }, void>('advanceOrder');`
 */
export function callFunction<Input = void, Output = void>(name: string) {
  return callable<Input, Output>(functions, name);
}
