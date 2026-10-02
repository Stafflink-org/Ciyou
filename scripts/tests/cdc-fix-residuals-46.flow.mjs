// Test réel cdc-fix-residuals-46 (§3 Analytics, « Performance livreurs ») : dans le tableau par
// livreur de l'écran Analytics > Livreurs, seules les colonnes « Livraisons » et « Retards »
// (deliveriesInPeriod/lateInPeriod) respectaient réellement la période choisie — les 4 autres
// colonnes (« Acceptation », « Temps moyen », « À l'heure », « Annulations ») lisaient
// directement `driver.stats.*`, c'est-à-dire les compteurs CUMULÉS depuis l'inscription du
// livreur, identiques quelle que soit la période sélectionnée. Changer la période ne changeait
// donc rien à 4 colonnes sur 6 du tableau — ligne « Performance livreurs » marquée COMPLET dans
// le tableau §3 du cahier alors que cette réserve était documentée dans le détail de l'annexe.
//
// Corrigé : `driverPerformance` (functions/src/admin/pilotage/analytics.ts) calcule désormais
// acceptanceRate/cancellationRate/onTimeRate/averageDeliveryMinutes à partir des commandes et
// propositions de course RÉELLEMENT dans la période (même mécanique déjà appliquée à
// `byZone`/`cdc-fix-residuals-7`), au lieu de lire les compteurs cumulés du livreur.
//
// Test réel sur `golink-9f16d` : un livreur jetable avec des compteurs `stats.*` cumulés
// DÉLIBÉRÉMENT différents des valeurs attendues sur la période de test (0,11/0,22/0,33/999 min),
// 2 commandes livrées (une à l'heure, une en retard) et 1 commande annulée dans une fenêtre de
// période précise, 2 propositions de course (1 acceptée, 1 refusée) — appel réel de
// `getPilotageAnalytics` (section « drivers ») sur cette fenêtre exacte, vérification que les 4
// colonnes reflètent bien les valeurs de la période, pas les compteurs cumulés. Nettoyage
// complet après coup.
//
//   npx tsx scripts/tests/cdc-fix-residuals-46.flow.mjs
import { randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Timestamp } from '@google-cloud/firestore';
import { auth, db } from '../lib/admin.mjs';
import { CLI_CLIENT_ID, CLI_CLIENT_SECRET, PROJECT_ID, readCliRefreshToken } from '../gcp-token.mjs';

const API_KEY = 'AIzaSyAYQ_TzyCEK0_Iw5TnSiH8jbFbOFKZYNoM';
const FN_BASE = 'https://europe-west1-golink-9f16d.cloudfunctions.net';

const adcPath = join(tmpdir(), `cdcres46-adc-${process.pid}.json`);
writeFileSync(adcPath, JSON.stringify({ type: 'authorized_user', client_id: CLI_CLIENT_ID, client_secret: CLI_CLIENT_SECRET, refresh_token: readCliRefreshToken() }));
process.env.GOOGLE_APPLICATION_CREDENTIALS = adcPath;
process.env.GOOGLE_CLOUD_PROJECT = PROJECT_ID;
process.env.GCLOUD_PROJECT = PROJECT_ID;
const { syncClaims } = await import('../../functions/src/lib/claims.ts');

const results = [];
function record(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'OK   ' : 'ECHEC'} ${name}${detail ? ` - ${detail}` : ''}`);
}
const check = (name, condition, detail) => record(name, Boolean(condition), detail);

const ADMIN_UID = 'cdcres46-admin';
const DRIVER_ID = 'cdcres46-driver';
const CITY_ID = 'cdcres46-ville';
const DAY = '2026-06-15'; // fenêtre de test isolée, loin des données réelles

async function loginPassword(email, password) {
  const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${API_KEY}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`Connexion ${email} refusée : ${body.error?.message}`);
  return body.idToken;
}
const passwords = new Map();
async function ensureAuthUser(uid, email) {
  const password = `${randomBytes(18).toString('base64url')}Aa1`;
  try {
    await auth.getUser(uid);
    await auth.updateUser(uid, { password, email });
  } catch {
    await auth.createUser({ uid, email, password, emailVerified: true, displayName: uid });
  }
  passwords.set(uid, password);
}
async function call(token, name, data) {
  const res = await fetch(`${FN_BASE}/${name}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ data }),
  });
  const body = await res.json().catch(() => ({}));
  if (res.ok) return body.result;
  throw new Error(body.error?.message ?? `HTTP ${res.status}`);
}

async function main() {
  const placedA = Timestamp.fromDate(new Date(`${DAY}T10:00:00+02:00`));
  const deliveredA = Timestamp.fromDate(new Date(`${DAY}T10:20:00+02:00`)); // 20 min, a l'heure
  const placedB = Timestamp.fromDate(new Date(`${DAY}T11:00:00+02:00`));
  const deliveredB = Timestamp.fromDate(new Date(`${DAY}T11:40:00+02:00`)); // 40 min, en retard

  await db.doc(`cities/${CITY_ID}`).set({ name: 'Test cdcres46', slug: CITY_ID, countryId: 'FR', active: true, test: true, managerIds: [] });
  await db.doc(`drivers/${DRIVER_ID}`).set({
    firstName: 'CDCRES46', lastName: 'Livreur', displayName: 'CDCRES46 Livreur', cityId: CITY_ID, zoneIds: [], vehicle: { type: 'bike' },
    status: 'active', availability: 'offline', deletedAt: null, test: true,
    // Compteurs cumules DELIBEREMENT faux pour la periode testee : si le correctif ne marche pas, ce sont ces valeurs qui ressortiraient.
    stats: { deliveries: 500, acceptanceRate: 0.11, cancellationRate: 0.22, onTimeRate: 0.33, averageDeliveryMinutes: 999 },
    rating: { average: 4.5, count: 10 },
  });

  const orderBase = { restaurantId: 'cdcres46-resto', customerId: 'cdcres46-client', cityId: CITY_ID, driverId: DRIVER_ID, fulfillment: 'delivery', delivery: { zoneId: null, deliveredBy: 'platform' }, test: true };
  await db.doc('orders/cdcres46-order-a').set({ ...orderBase, status: 'delivered', flags: { late: false }, timeline: { placedAt: placedA, delivered: deliveredA }, createdAt: placedA });
  await db.doc('orders/cdcres46-order-b').set({ ...orderBase, status: 'delivered', flags: { late: true }, timeline: { placedAt: placedB, delivered: deliveredB }, createdAt: placedB });
  await db.doc('orders/cdcres46-order-c').set({ ...orderBase, status: 'cancelled', flags: {}, cancellation: { by: 'driver', reason: 'other' }, timeline: { placedAt: placedA }, createdAt: placedA });

  const offerBase = { driverId: DRIVER_ID, orderId: 'cdcres46-order-a', restaurantId: 'cdcres46-resto', cityId: CITY_ID, zoneId: null, round: 1, distanceToRestaurantMeters: 500, deliveryDistanceMeters: 1500, estimatedPayCents: 400, estimatedMinutes: 20, offeredAt: placedA, expiresAt: placedA, test: true };
  await db.doc('dispatchOffers/cdcres46-offer-accepted').set({ ...offerBase, status: 'accepted', respondedAt: placedA });
  await db.doc('dispatchOffers/cdcres46-offer-declined').set({ ...offerBase, status: 'declined', respondedAt: placedA });

  await ensureAuthUser(ADMIN_UID, 'cdcres46-admin@golink.test');
  await db.doc(`admins/${ADMIN_UID}`).set({ active: true, role: 'super_admin', permissions: [], email: 'cdcres46-admin@golink.test', displayName: 'CDCRES46 Admin', cities: [], createdAt: new Date() });
  await syncClaims(ADMIN_UID);
  const token = await loginPassword('cdcres46-admin@golink.test', passwords.get(ADMIN_UID));

  const result = await call(token, 'getPilotageAnalytics', { section: 'drivers', from: DAY, to: DAY, cityIds: [CITY_ID] });
  const row = result?.drivers?.rows?.find((r) => r.driverId === DRIVER_ID);
  check('ligne du livreur presente dans la reponse', Boolean(row), JSON.stringify(result?.drivers?.rows?.map((r) => r.driverId)));

  check('acceptanceRate reflete la periode (1 acceptee / 2 proposees = 0.5), pas stats.acceptanceRate (0.11)', row?.acceptanceRate === 0.5, `acceptanceRate=${row?.acceptanceRate}`);
  check('cancellationRate reflete la periode (1 annulee / 3 assignees = 0.333), pas stats.cancellationRate (0.22)', row?.cancellationRate === 0.333, `cancellationRate=${row?.cancellationRate}`);
  check('onTimeRate reflete la periode (1 a l heure / 2 livrees = 0.5), pas stats.onTimeRate (0.33)', row?.onTimeRate === 0.5, `onTimeRate=${row?.onTimeRate}`);
  check('averageDeliveryMinutes reflete la periode ((20+40)/2=30), pas stats.averageDeliveryMinutes (999)', row?.averageDeliveryMinutes === 30, `averageDeliveryMinutes=${row?.averageDeliveryMinutes}`);
  check('deliveriesInPeriod toujours correct (non-regression)', row?.deliveriesInPeriod === 2, `deliveriesInPeriod=${row?.deliveriesInPeriod}`);
  check('lateInPeriod toujours correct (non-regression)', row?.lateInPeriod === 1, `lateInPeriod=${row?.lateInPeriod}`);
}

async function cleanup() {
  const paths = [
    `cities/${CITY_ID}`, `drivers/${DRIVER_ID}`,
    'orders/cdcres46-order-a', 'orders/cdcres46-order-b', 'orders/cdcres46-order-c',
    'dispatchOffers/cdcres46-offer-accepted', 'dispatchOffers/cdcres46-offer-declined',
    `admins/${ADMIN_UID}`, `users/${ADMIN_UID}`, `userPrivate/${ADMIN_UID}`,
  ];
  await Promise.all(paths.map((p) => db.doc(p).delete().catch(() => {})));
  await auth.deleteUser(ADMIN_UID).catch(() => {});
}

main()
  .catch((error) => record('exception', false, String(error.stack ?? error)))
  .finally(async () => {
    if (!process.env.NO_CLEANUP) await cleanup();
    const failed = results.filter((r) => !r.ok);
    console.log(`\n${results.length - failed.length}/${results.length} OK`);
    if (failed.length) {
      console.log('Echecs :');
      for (const f of failed) console.log(` - ${f.name} : ${f.detail}`);
      process.exitCode = 1;
    }
  });
