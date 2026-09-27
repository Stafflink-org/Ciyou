import {
  Timestamp,
  serverTimestamp,
  type DocumentSnapshot,
  type FieldValue,
  type QueryDocumentSnapshot,
} from 'firebase/firestore';
import type { WithId } from '@golink/shared';

/** Valeurs de date rencontrées dans Firestore et dans les formulaires. */
export type DateInput = Timestamp | Date | number | string | { toDate(): Date } | null | undefined;

/** Convertit un Timestamp Firestore (ou une date, un nombre de ms, une chaîne ISO) en Date. */
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

/** Date JavaScript vers Timestamp Firestore (écriture de champs datés). */
export function toTimestamp(value: Date | number): Timestamp {
  return Timestamp.fromMillis(value instanceof Date ? value.getTime() : value);
}

/**
 * Données d'un instantané avec son identifiant. Les horodatages serveur encore
 * en attente d'écriture sont estimés localement plutôt que renvoyés à null.
 */
export function withId<T>(snapshot: QueryDocumentSnapshot | DocumentSnapshot): WithId<T> {
  return { ...(snapshot.data({ serverTimestamps: 'estimate' }) as T), id: snapshot.id };
}

/** Champs de traçabilité d'une création (vérifiés par les règles : horodatage serveur). */
export function createdFields(uid: string): {
  createdAt: FieldValue;
  createdBy: string;
  updatedAt: FieldValue;
  updatedBy: string;
} {
  return { createdAt: serverTimestamp(), createdBy: uid, updatedAt: serverTimestamp(), updatedBy: uid };
}

/** Champs de traçabilité d'une mise à jour. */
export function updatedFields(uid: string): { updatedAt: FieldValue; updatedBy: string } {
  return { updatedAt: serverTimestamp(), updatedBy: uid };
}
