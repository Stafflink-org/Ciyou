/**
 * Crée (ou met à jour) un compte livreur de test réel : Firebase Auth (claims
 * `role: 'driver'`), fiche `drivers/{uid}` déjà validée (`status: 'active'`),
 * `driverPrivate/{uid}` minimale et `driverLocations/{uid}` initiale (hors
 * ligne, sans quoi l'app ne pourrait jamais y écrire sa position : les règles
 * n'autorisent le livreur qu'à mettre à jour ce document, jamais à le créer).
 *
 * Nécessaire pour tester réellement apps/driver : il n'existe aucune Cloud
 * Function d'inscription livreur en libre-service (validation manuelle,
 * docs/DECISIONS_CLIENT.md) — ce script joue donc le rôle d'un dossier déjà
 * validé par l'équipe, comme `create-first-admin.mjs` pour le tout premier
 * super administrateur.
 *
 * Usage : node scripts/create-test-driver.mjs --apply
 */
import { randomBytes, randomInt } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { GeoPoint, Timestamp } from '@google-cloud/firestore';
import { auth, db } from './lib/admin.mjs';

const apply = process.argv.includes('--apply');
const EMAIL = 'driver.lot1@golink.test';
const UID = 'test-driver-lot1';
const CREDENTIALS_FILE = fileURLToPath(new URL('../.test-accounts.local.md', import.meta.url));

function strongPassword() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const symbols = '!#$%*+-?@';
  const core = Array.from({ length: 14 }, () => alphabet[randomInt(alphabet.length)]).join('');
  return `${core}${symbols[randomInt(symbols.length)]}${randomInt(10, 99)}${randomBytes(1)[0] % 10}`;
}

function storedPassword() {
  if (!existsSync(CREDENTIALS_FILE)) return null;
  const match = readFileSync(CREDENTIALS_FILE, 'utf8').match(new RegExp('`' + EMAIL + '`\\s*\\|\\s*`([^`]+)`'));
  return match?.[1] ?? null;
}

async function main() {
  const password = storedPassword() ?? strongPassword();
  console.log(`Compte : ${EMAIL} (uid ${UID})`);
  if (!apply) {
    console.log('Aperçu seulement (--apply pour créer/mettre à jour réellement).');
    return;
  }

  let userRecord;
  try {
    userRecord = await auth.getUser(UID);
    if (storedPassword()) await auth.updateUser(UID, { password });
  } catch {
    userRecord = await auth.createUser({ uid: UID, email: EMAIL, password, displayName: 'Driver Test', emailVerified: true });
  }
  await auth.setCustomUserClaims(UID, { role: 'driver' });

  const now = Timestamp.now();
  await db.collection('drivers').doc(UID).set(
    {
      cityId: 'longwy',
      // Code pays exact des documents `countries/{id}` (`FR`, voir packages/shared/src/pricing/decisions.ts) :
      // une casse différente empêche toute lecture (`countries/fr` n'existe pas) — bug réel trouvé et
      // corrigé ici (cdc-fix-residuals-5), qui bloquait l'écran de compte de paiement du livreur.
      countryId: 'FR',
      firstName: 'Driver',
      lastName: 'Test',
      displayName: 'Driver Test',
      phone: '+33600000099',
      email: EMAIL,
      avatar: null,
      type: 'platform',
      restaurantIds: [],
      employeeId: null,
      maxDistanceMeters: 8000,
      vehicle: { type: 'bike', plate: null, model: null, color: null },
      zoneIds: [],
      status: 'active',
      onboardingStatus: 'approved',
      rejectionReason: null,
      availability: 'offline',
      activeOrderIds: [],
      acceptsCash: false,
      rating: { average: 0, count: 0 },
      stats: { deliveries: 0, acceptanceRate: 0, cancellationRate: 0, onTimeRate: 0, averageDeliveryMinutes: 0 },
      documentsValidUntil: null,
      lastIdentityCheckAt: null,
      lastSeenAt: null,
      locale: 'fr',
      searchKeywords: ['driver', 'test'],
      deletedAt: null,
      createdAt: now,
      createdBy: 'script:create-test-driver',
      updatedAt: now,
      updatedBy: 'script:create-test-driver',
    },
    { merge: true },
  );

  await db.collection('driverPrivate').doc(UID).set(
    {
      birthDate: '1990-01-01',
      nationality: 'FR',
      address: { line1: '1 rue de Test', postalCode: '54400', city: 'Longwy', countryCode: 'FR' },
      siret: null,
      vatNumber: null,
      vatExempt: true,
      urssafValidUntil: null,
      workPermitValidUntil: null,
      ibanMasked: null,
      stripeAccountId: null,
      stripeAccountStatus: null,
      payoutAccount: null,
      cashBalanceCents: 0,
      cashLimitCents: 0,
      cashSinceAt: null,
      lastCashRemittanceAt: null,
      payoutsBlocked: false,
      payoutsBlockedReason: null,
      taxIdentificationNumber: null,
      dac7Complete: false,
      partnerTermsVersion: null,
      partnerTermsAcceptedAt: null,
      internalRating: null,
      updatedAt: now,
    },
    { merge: true },
  );

  const locationRef = db.collection('driverLocations').doc(UID);
  if (!(await locationRef.get()).exists) {
    await locationRef.set({
      position: new GeoPoint(49.5218, 5.7658), // centre approximatif de Longwy
      geohash: 'u0j1z8mxg',
      heading: null,
      speedKmh: null,
      accuracyMeters: null,
      availability: 'offline',
      cityId: 'longwy',
      zoneId: null,
      activeOrderIds: [],
      visibleTo: [],
      updatedAt: now,
    });
  }

  const md = existsSync(CREDENTIALS_FILE) ? readFileSync(CREDENTIALS_FILE, 'utf8') : '';
  if (!md.includes(EMAIL)) {
    const section = '\n## App livreur mobile (`apps/driver`) — compte de test réel\n\n| Rôle | E-mail | Mot de passe |\n|---|---|---|\n| Livreur (test lot 1 fondations, ville Longwy) | `' + EMAIL + '` | `' + password + '` |\n';
    writeFileSync(CREDENTIALS_FILE, md + section, 'utf8');
    console.log('Ajouté à .test-accounts.local.md');
  }
  console.log(`OK : ${userRecord.uid}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
