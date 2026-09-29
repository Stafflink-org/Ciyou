/**
 * Crée (ou met à jour) un DEUXIÈME compte livreur de test réel, dédié à la
 * vérification visuelle du solde d'espèces (mission driver-lot3, point 5) :
 * un livreur SALARIÉ d'un commerce (`type: 'restaurant'`), seul cas où
 * `CashBalanceCard` (apps/driver/src/features/dispatch/ActiveOrderPanels.tsx)
 * s'affiche. Copie adaptée de scripts/create-test-driver.mjs (compte partagé
 * `test-driver-lot1`, de type `platform`, non modifié — un changement de son
 * type aurait affecté d'autres tâches concurrentes, voir docs/CONTRAT_MODULES.md
 * §11 bis) : même structure, UID/e-mail dédiés, solde d'espèces non nul pour
 * que la carte soit visible dès la connexion (sans avoir à simuler une course).
 *
 * Usage : node scripts/create-test-driver-restaurant.mjs --apply
 */
import { randomBytes, randomInt } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { GeoPoint, Timestamp } from '@google-cloud/firestore';
import { auth, db } from './lib/admin.mjs';

const apply = process.argv.includes('--apply');
const EMAIL = 'driver.lot3-restaurant@golink.test';
const UID = 'test-driver-lot3-restaurant';
const RESTAURANT_ID = 'mina-kitchen';
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

  const restaurantSnap = await db.collection('restaurants').doc(RESTAURANT_ID).get();
  if (!restaurantSnap.exists) throw new Error(`Restaurant ${RESTAURANT_ID} introuvable : adaptez RESTAURANT_ID.`);

  let userRecord;
  try {
    userRecord = await auth.getUser(UID);
    if (storedPassword()) await auth.updateUser(UID, { password });
  } catch {
    userRecord = await auth.createUser({ uid: UID, email: EMAIL, password, displayName: 'Driver Test (salarié)', emailVerified: true });
  }
  await auth.setCustomUserClaims(UID, { role: 'driver' });

  const now = Timestamp.now();
  await db.collection('drivers').doc(UID).set(
    {
      cityId: 'longwy',
      countryId: 'fr',
      firstName: 'Driver',
      lastName: 'Salarié',
      displayName: 'Driver Test (salarié)',
      phone: '+33600000098',
      email: EMAIL,
      avatar: null,
      type: 'restaurant',
      restaurantIds: [RESTAURANT_ID],
      employeeId: null,
      maxDistanceMeters: 5000,
      vehicle: { type: 'scooter', plate: 'TEST-99', model: 'Scooter test', color: 'Gris' },
      zoneIds: [],
      status: 'active',
      onboardingStatus: 'approved',
      rejectionReason: null,
      availability: 'offline',
      activeOrderIds: [],
      acceptsCash: true,
      rating: { average: 0, count: 0 },
      stats: { deliveries: 0, acceptanceRate: 0, cancellationRate: 0, onTimeRate: 0, averageDeliveryMinutes: 0 },
      documentsValidUntil: null,
      lastIdentityCheckAt: null,
      lastSeenAt: null,
      locale: 'fr',
      searchKeywords: ['driver', 'test', 'salarie'],
      deletedAt: null,
      createdAt: now,
      createdBy: 'script:create-test-driver-restaurant',
      updatedAt: now,
      updatedBy: 'script:create-test-driver-restaurant',
    },
    { merge: true },
  );

  await db.collection('driverPrivate').doc(UID).set(
    {
      birthDate: '1992-05-12',
      nationality: 'FR',
      address: { line1: '2 rue de Test', postalCode: '54400', city: 'Longwy', countryCode: 'FR' },
      siret: null,
      vatNumber: null,
      vatExempt: true,
      urssafValidUntil: null,
      workPermitValidUntil: null,
      ibanMasked: null,
      stripeAccountId: null,
      stripeAccountStatus: null,
      payoutAccount: null,
      // Solde non nul (visible dès la connexion, sans course à simuler) : vérification visuelle du point 5.
      cashBalanceCents: 4250,
      cashLimitCents: 15000,
      cashSinceAt: now,
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
    const section = '| Livreur salarié (test lot 3 réglages, solde espèces) | `' + EMAIL + '` | `' + password + '` |\n';
    const updated = md.includes('App livreur mobile')
      ? md.replace(/(\| Livreur \(test lot 1[^\n]*\n)/, `$1${section}`)
      : md + '\n## App livreur mobile (`apps/driver`) — compte de test réel\n\n| Rôle | E-mail | Mot de passe |\n|---|---|---|\n' + section;
    writeFileSync(CREDENTIALS_FILE, updated, 'utf8');
    console.log('Ajouté à .test-accounts.local.md');
  }
  console.log(`OK : ${userRecord.uid}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
