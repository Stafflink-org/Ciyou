// Comptes Firebase Auth et profils users/{uid} : création idempotente et
// profil initial commun à tous les rôles.
import {
  COLLECTIONS,
  buildSearchKeywords,
  generateReferralCode,
  type UserPrivate,
  type UserProfile,
  type UserRole,
} from '@golink/shared';
import { randomBytes, randomInt } from 'node:crypto';
import type { UserRecord } from 'firebase-admin/auth';
import { auth, db, Timestamp } from './admin';
import { isAuthError } from './errors';

/** Mot de passe aléatoire provisoire (jamais communiqué : l'utilisateur définit le sien par lien). */
function provisionalPassword(): string {
  return randomBytes(24).toString('base64url');
}

export async function findUserByEmail(email: string): Promise<UserRecord | null> {
  try {
    return await auth.getUserByEmail(email);
  } catch (error) {
    if (isAuthError(error, 'user-not-found')) return null;
    throw error;
  }
}

/** Renvoie le compte existant pour cet e-mail, ou le crée. */
export async function getOrCreateAuthUser(input: {
  email: string;
  displayName: string;
  password?: string;
  phoneNumber?: string | null;
}): Promise<{ user: UserRecord; created: boolean }> {
  const existing = await findUserByEmail(input.email);
  if (existing) return { user: existing, created: false };
  const user = await auth.createUser({
    email: input.email,
    displayName: input.displayName,
    password: input.password ?? provisionalPassword(),
    emailVerified: false,
    disabled: false,
  });
  return { user, created: true };
}

export function splitDisplayName(displayName: string | null | undefined): { firstName: string; lastName: string } {
  const parts = (displayName ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: '', lastName: '' };
  return { firstName: parts[0] ?? '', lastName: parts.slice(1).join(' ') };
}

/** Code de parrainage aléatoire, cryptographiquement sûr. */
function referralCode(): string {
  return generateReferralCode(() => randomInt(0, 1_000_000) / 1_000_000);
}

export function buildUserProfile(input: {
  role: UserRole;
  firstName: string;
  lastName: string;
  email: string;
  emailVerified: boolean;
  phone?: string | null;
  countryId?: string | null;
  cityId?: string | null;
}): UserProfile {
  const now = Timestamp.now();
  const displayName = [input.firstName, input.lastName].filter(Boolean).join(' ') || input.email;
  return {
    role: input.role,
    firstName: input.firstName,
    lastName: input.lastName,
    displayName,
    email: input.email,
    emailVerified: input.emailVerified,
    phone: input.phone ?? null,
    phoneVerified: false,
    avatar: null,
    locale: 'fr',
    status: 'active',
    defaultAddressId: null,
    consents: {},
    notificationPrefs: { orderUpdates: true, promotions: false, newsletter: false },
    walletBalanceCents: 0,
    referralCode: referralCode(),
    referredBy: null,
    stats: { ordersCount: 0, totalSpentCents: 0, lastOrderAt: null, firstOrderAt: null, cancelledCount: 0, refundsCount: 0 },
    acceptedLegal: {},
    countryId: input.countryId ?? undefined,
    cityId: input.cityId ?? null,
    lastLoginAt: null,
    lastSeenAt: null,
    searchKeywords: buildSearchKeywords(displayName, input.email, input.phone),
    createdAt: now,
    createdBy: null,
    updatedAt: now,
    updatedBy: null,
  };
}

function initialPrivate(): UserPrivate {
  return {
    stripeCustomerId: null,
    riskScore: 0,
    riskFlags: [],
    deviceHashes: [],
    cardFingerprints: [],
    phoneHash: null,
    fraudCaseIds: [],
    updatedAt: Timestamp.now(),
  };
}

/**
 * Crée le profil et les données privées s'ils n'existent pas encore.
 * Un profil existant n'est jamais écrasé. Renvoie true si le profil a été créé.
 */
export async function ensureUserProfile(uid: string, profile: UserProfile): Promise<boolean> {
  const userRef = db.collection(COLLECTIONS.users).doc(uid);
  const privateRef = db.collection(COLLECTIONS.userPrivate).doc(uid);
  return db.runTransaction(async (tx) => {
    const [user, priv] = await Promise.all([tx.get(userRef), tx.get(privateRef)]);
    if (!priv.exists) tx.set(privateRef, initialPrivate());
    if (user.exists) return false;
    tx.set(userRef, profile);
    return true;
  });
}
