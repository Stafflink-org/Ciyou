// Custom claims Firebase Auth, posés uniquement par les Cloud Functions à partir
// de Firestore (admins/{uid}, restaurants/{rid}/members/{uid}). Ils servent au
// routage des applications ; les permissions fines restent lues dans Firestore
// (règles de sécurité et Cloud Functions), car les claims sont limités à 1 000 octets.
import type { AdminRole, StaffRole, UserRole } from '../constants/enums';

export interface AuthClaims {
  role?: UserRole;
  /** Rôle interne, pour role = admin. */
  adminRole?: AdminRole;
  /** Établissements accessibles et rôle du compte dans chacun. */
  restaurants?: Record<string, StaffRole>;
  /** La liste des établissements a été tronquée (trop longue pour les claims). */
  restaurantsTruncated?: boolean;
}

/** Nombre maximal d'établissements portés par les claims. */
export const MAX_CLAIMED_RESTAURANTS = 20;
