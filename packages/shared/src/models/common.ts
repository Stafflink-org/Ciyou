// Types de base partagés par tous les documents Firestore.
// Les types Timestamp et GeoPoint sont décrits structurellement pour rester
// compatibles avec le SDK web, le SDK mobile et le SDK Admin sans en dépendre.
import type { Cents } from '../pricing/money';

export interface Timestamp {
  readonly seconds: number;
  readonly nanoseconds: number;
  toDate(): Date;
  toMillis(): number;
}

export interface GeoPoint {
  readonly latitude: number;
  readonly longitude: number;
}

/** Point d'un polygone (zones de livraison). Firestore n'accepte pas les tableaux de GeoPoint imbriqués. */
export interface LatLng {
  lat: number;
  lng: number;
}

/** Document lu avec son identifiant. */
export type WithId<T> = T & { id: string };

/** Traçabilité de création / modification. */
export interface Tracked {
  createdAt: Timestamp;
  createdBy?: string | null;
  updatedAt: Timestamp;
  updatedBy?: string | null;
}

/** Suppression logique : le document part dans la corbeille (`trash`) avant purge. */
export interface SoftDeletable {
  deletedAt?: Timestamp | null;
  deletedBy?: string | null;
  deleteReason?: string | null;
}

/** Rattachement géographique (multi-pays). */
export interface Localized {
  countryId: string;
  cityId?: string | null;
}

export interface PostalAddress {
  line1: string;
  line2?: string | null;
  postalCode: string;
  city: string;
  countryCode: string;
  geo?: GeoPoint | null;
  /** Geohash (précision 9) pour les recherches de proximité. */
  geohash?: string | null;
  /** Identifiant Google Places de l'adresse, si géocodée. */
  placeId?: string | null;
}

/** Fichier stocké dans Cloud Storage. */
export interface StoredFile {
  path: string;
  /** URL de téléchargement pour les fichiers publics uniquement. */
  url?: string | null;
  contentType: string;
  size: number;
  name?: string | null;
  uploadedAt: Timestamp;
  uploadedBy?: string | null;
}

/** Image publique avec variantes générées (vignette, grande taille). */
export interface ImageRef {
  path: string;
  url: string;
  thumbUrl?: string | null;
  width?: number | null;
  height?: number | null;
  alt?: string | null;
}

/** Montant ventilé HT / TVA / TTC. */
export interface AmountBreakdown {
  htCents: Cents;
  vatCents: Cents;
  ttcCents: Cents;
  vatRateBps: number;
}

/** Plage horaire locale « HH:MM ». */
export interface TimeRange {
  from: string;
  to: string;
}

/** Horaires hebdomadaires : 0 = lundi … 6 = dimanche, plusieurs créneaux par jour. */
export interface WeeklyHours {
  days: Array<{ day: 0 | 1 | 2 | 3 | 4 | 5 | 6; open: boolean; slots: TimeRange[] }>;
  /** Fermetures ou horaires exceptionnels (AAAA-MM-JJ). */
  exceptions: Array<{ date: string; closed: boolean; slots?: TimeRange[]; label?: string | null }>;
  timezone: string;
}

/** Référence vers une entité, pour l'audit, les alertes et la recherche. */
export interface EntityRef {
  type:
    | 'restaurant'
    | 'restaurant_group'
    | 'driver'
    | 'client'
    | 'order'
    | 'invoice'
    | 'payout'
    | 'refund'
    | 'ticket'
    | 'review'
    | 'promotion'
    | 'zone'
    | 'city'
    | 'country'
    | 'setting'
    | 'admin'
    | 'subscription'
    | 'document'
    | 'other';
  id: string;
  label?: string | null;
}

/** Texte traduisible : clé = code langue (fr, en…). Le français est obligatoire. */
export type LocalizedText = { fr: string } & Partial<Record<string, string>>;
