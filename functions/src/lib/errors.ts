// Erreurs renvoyées aux applications, avec des messages en français prêts à afficher.
import { HttpsError } from 'firebase-functions/v2/https';

export const fail = {
  unauthenticated: () => new HttpsError('unauthenticated', 'Vous devez être connecté pour effectuer cette action.'),
  forbidden: (message = "Vous n'avez pas les droits nécessaires pour effectuer cette action.") =>
    new HttpsError('permission-denied', message),
  invalid: (message: string, details?: unknown) => new HttpsError('invalid-argument', message, details),
  notFound: (what: string) => new HttpsError('not-found', `${what} introuvable.`),
  alreadyExists: (message: string) => new HttpsError('already-exists', message),
  precondition: (message: string) => new HttpsError('failed-precondition', message),
  unavailable: (message = 'Service momentanément indisponible. Réessayez dans un instant.') =>
    new HttpsError('unavailable', message),
  internal: () => new HttpsError('internal', 'Une erreur interne est survenue. Réessayez dans un instant.'),
};

/** Code d'erreur Firestore « le document existe déjà » (create()). */
export const FIRESTORE_ALREADY_EXISTS = 6;

export function isFirestoreAlreadyExists(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === FIRESTORE_ALREADY_EXISTS;
}

export function isAuthError(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === `auth/${code}`;
}
