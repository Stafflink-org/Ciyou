// Test réel cdc-fix-residuals-53 (audit back-office restaurant demandé par le client, suite au
// balayage §1-§31 clos) :
//
// 1. Storage `restaurants/{rid}/private/` (Kbis, pièce du gérant, RIB) et `drivers/{uid}/private/`
//    (pièce d'identité, selfie) n'étaient cloisonnés PAR AUCUNE ville — `isAdmin('restaurants.validate'
//    /'drivers.validate')` seul, contrairement à la règle Firestore équivalente déjà cloisonnée.
//    Un admin restreint par ville pouvait télécharger directement (SDK Storage, sans Cloud
//    Function) les justificatifs KYC de n'importe quel restaurant/livreur hors de son périmètre.
//    Corrigé : nouvel helper `isAdminIn` ajouté aux règles Storage (`storage/_helpers.rules`),
//    appliqué aux deux chemins privés.
//
// 2. `supportTickets` (et ses sous-collections messages) + les Cloud Functions associées
//    (assignTickets, escalateTicket, respondToTicket, updateTicket, contactTicketParty,
//    createTicketAsAgent) n'étaient bornées QUE par la permission (`support.view`/`support.handle`
//    /`support.escalate`), jamais par la ville/pays — contrairement à `orders.rules` qui utilise
//    déjà `isAdminIn('support.view', ...)` pour le même usage. Un admin restreint pouvait lire et
//    traiter les tickets (contenant des échanges client et parfois des pièces jointes) de
//    n'importe quel sujet hors de son périmètre. Corrigé (règle : dualité ville/pays comme
//    fraudCases ; fonctions : `assertAdminCoversCountry` ajouté à `loadTicketFor`/`createTicketAsAgent`).
//
// 3. `driverPrivate.cashBalanceCents` est un solde GLOBAL par livreur (pas par établissement),
//    mais `inviteOwnCourier` ne vérifiait l'exclusivité qu'envers la flotte Ciyou Eats (type
//    `platform`), jamais envers un AUTRE établissement : un établissement B pouvait inviter un
//    livreur déjà livreur salarié actif de l'établissement A, mélangeant silencieusement les
//    espèces encaissées pour A avec celles remises à B. Corrigé : `inviteOwnCourier` refuse
//    désormais l'invitation si le livreur a déjà un rattachement `own`/`active` ailleurs ; reste
//    possible une fois l'ancien employeur l'a passé en `inactive`/`blocked`.
//
//   npx tsx scripts/tests/cdc-fix-residuals-53.flow.mjs
import { randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Timestamp } from '@google-cloud/firestore';
import { auth, bucket, db } from '../lib/admin.mjs';
import { CLI_CLIENT_ID, CLI_CLIENT_SECRET, PROJECT_ID, readCliRefreshToken } from '../gcp-token.mjs';

const adcPath = join(tmpdir(), `cdcres53-adc-${process.pid}.json`);
writeFileSync(adcPath, JSON.stringify({ type: 'authorized_user', client_id: CLI_CLIENT_ID, client_secret: CLI_CLIENT_SECRET, refresh_token: readCliRefreshToken() }));
process.env.GOOGLE_APPLICATION_CREDENTIALS = adcPath;
process.env.GOOGLE_CLOUD_PROJECT = PROJECT_ID;
process.env.GCLOUD_PROJECT = PROJECT_ID;
const { syncClaims } = await import('../../functions/src/lib/claims.ts');

const API_KEY = 'AIzaSyAYQ_TzyCEK0_Iw5TnSiH8jbFbOFKZYNoM';
const BUCKET = 'golink-9f16d.firebasestorage.app';
const FN_BASE = 'https://europe-west1-golink-9f16d.cloudfunctions.net';
const FS = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

const results = [];
function record(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'OK   ' : 'ÉCHEC'} ${name}${detail ? ` — ${detail}` : ''}`);
}
const check = (name, condition, detail) => record(name, Boolean(condition), detail);
const now = () => Timestamp.now();

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
async function testUserSession(uid, email) {
  const password = `${randomBytes(18).toString('base64url')}Aa1`;
  try {
    await auth.getUser(uid);
    await auth.updateUser(uid, { password, email });
  } catch {
    await auth.createUser({ uid, email, password, emailVerified: true, displayName: uid });
  }
  return loginPassword(email, password);
}
async function call(token, name, data) {
  const res = await fetch(`${FN_BASE}/${name}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ data }),
  });
  const body = await res.json().catch(() => ({}));
  if (res.ok) return body.result;
  const error = new Error(body.error?.message ?? `HTTP ${res.status}`);
  error.status = body.error?.status;
  throw error;
}
async function expectError(name, promise, fragment) {
  try {
    await promise;
    record(name, false, 'accepté alors qu’un refus était attendu');
  } catch (error) {
    const ok = !fragment || String(error.message).includes(fragment);
    record(name, ok, `${error.status ?? ''} : ${error.message}`);
  }
}
async function restGet(token, path) {
  const res = await fetch(`${FS}/${path}`, { headers: { authorization: `Bearer ${token}` } });
  return { status: res.status, json: await res.json() };
}
const allowed = (res) => res.status === 200 && !res.json?.error;
const denied = (res) => res.status === 403 || res.json?.error?.status === 'PERMISSION_DENIED';

const PNG_1PX = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');
async function storageUpload(idToken, path) {
  const res = await fetch(`https://firebasestorage.googleapis.com/v0/b/${BUCKET}/o?name=${encodeURIComponent(path)}`, {
    method: 'POST',
    headers: { Authorization: `Firebase ${idToken}`, 'Content-Type': 'image/png' },
    body: PNG_1PX,
  });
  return { status: res.status, body: await res.text() };
}
async function storageGet(idToken, path) {
  const res = await fetch(`https://firebasestorage.googleapis.com/v0/b/${BUCKET}/o/${encodeURIComponent(path)}`, {
    headers: { Authorization: `Firebase ${idToken}` },
  });
  return { status: res.status, body: await res.text() };
}

async function createAdmin(uid, email, { role = 'ops', permissions = [], cityIds = [], countryIds = [] } = {}) {
  const password = `${randomBytes(18).toString('base64url')}Aa1`;
  await auth.deleteUser(uid).catch(() => {});
  await auth.createUser({ uid, email, password, emailVerified: true, displayName: uid });
  await db.doc(`admins/${uid}`).set({ role, active: true, permissions, cityIds, countryIds, refundLimitCents: null, displayName: uid, email, test: true, createdAt: now(), updatedAt: now(), updatedBy: 'system' });
  await syncClaims(uid);
  return { password, token: await loginPassword(email, password) };
}
async function cleanupAdmin(uid) {
  await Promise.all([`admins/${uid}`, `users/${uid}`, `userPrivate/${uid}`].map((p) => db.doc(p).delete().catch(() => {})));
  await auth.deleteUser(uid).catch(() => {});
}

// ------------------------------------------------------------------ 1a. Storage KYC restaurant

async function testRestaurantKycScope() {
  const ADMIN_IN = 'cdcres53-admin-rkyc-in';
  const ADMIN_OUT = 'cdcres53-admin-rkyc-out';
  const CITY_IN = 'cdcres53-ville-rkyc-in';
  const CITY_OUT = 'cdcres53-ville-rkyc-out';
  const RES = 'cdcres53-resto-kyc';
  const OBJECT_PATH = `restaurants/${RES}/private/cdcres53-kbis.png`;

  await db.doc(`restaurants/${RES}`).set({ name: 'CDCRES53 KYC', cityId: CITY_IN, countryId: 'FR', status: 'active', onboardingStatus: 'pending', test: true, createdAt: now(), updatedAt: now(), updatedBy: 'system' });
  // Dépôt du justificatif via le SDK Admin (hors règles) : seul un membre restaurant (settings.manage)
  // peut légitimement écrire ici, non simulable facilement par un compte jetable — seule la LECTURE
  // (le périmètre en cause) est testée via de vrais comptes et les règles réelles.
  await bucket.file(OBJECT_PATH).save(PNG_1PX, { contentType: 'image/png' });
  const { token: adminInToken } = await createAdmin(ADMIN_IN, 'cdcres53-admin-rkyc-in@golink.test', { permissions: ['restaurants.validate'], cityIds: [CITY_IN], countryIds: ['FR'] });
  const { token: adminOutToken } = await createAdmin(ADMIN_OUT, 'cdcres53-admin-rkyc-out@golink.test', { permissions: ['restaurants.validate'], cityIds: [CITY_OUT], countryIds: ['FR'] });
  try {
    const readIn = await storageGet(adminInToken, OBJECT_PATH);
    check('storage.restaurants_private : admin DANS le périmètre (ville IN) autorisé à lire — non-régression', readIn.status === 200, `status=${readIn.status}`);

    const readOut = await storageGet(adminOutToken, OBJECT_PATH);
    check('storage.restaurants_private : admin HORS périmètre (ville OUT) REFUSÉ à lire — correctif attendu', readOut.status === 403, `status=${readOut.status} body=${readOut.body.slice(0, 150)}`);
  } finally {
    await bucket.file(OBJECT_PATH).delete().catch(() => {});
    await db.doc(`restaurants/${RES}`).delete().catch(() => {});
    await cleanupAdmin(ADMIN_IN);
    await cleanupAdmin(ADMIN_OUT);
  }
}

// ------------------------------------------------------------------ 1b. Storage KYC livreur

async function testDriverKycScope() {
  const ADMIN_IN = 'cdcres53-admin-dkyc-in';
  const ADMIN_OUT = 'cdcres53-admin-dkyc-out';
  const CITY_IN = 'cdcres53-ville-dkyc-in';
  const CITY_OUT = 'cdcres53-ville-dkyc-out';
  const DRIVER_UID = 'cdcres53-driver-kyc';
  const OBJECT_PATH = `drivers/${DRIVER_UID}/private/cdcres53-id.png`;

  await db.doc(`drivers/${DRIVER_UID}`).set({ cityId: CITY_IN, countryId: 'FR', firstName: 'Test', lastName: 'CDCRES53', displayName: 'Test CDCRES53', phone: '+33600000000', email: 'cdcres53-driver-kyc@golink.test', type: 'platform', restaurantIds: [], vehicle: { type: 'bike' }, zoneIds: [], status: 'pending', onboardingStatus: 'draft', availability: 'offline', activeOrderIds: [], acceptsCash: false, rating: { average: 0, count: 0 }, stats: { deliveries: 0, acceptanceRate: 0, cancellationRate: 0, onTimeRate: 0, averageDeliveryMinutes: 0 }, searchKeywords: [], test: true, createdAt: now(), updatedAt: now(), updatedBy: 'system' });
  const driverToken = await testUserSession(DRIVER_UID, 'cdcres53-driver-kyc@golink.test');
  const { token: adminInToken } = await createAdmin(ADMIN_IN, 'cdcres53-admin-dkyc-in@golink.test', { permissions: ['drivers.validate'], cityIds: [CITY_IN], countryIds: ['FR'] });
  const { token: adminOutToken } = await createAdmin(ADMIN_OUT, 'cdcres53-admin-dkyc-out@golink.test', { permissions: ['drivers.validate'], cityIds: [CITY_OUT], countryIds: ['FR'] });
  try {
    const upload = await storageUpload(driverToken, OBJECT_PATH);
    check('storage.drivers_private : dépôt de la pièce par le livreur lui-même — non-régression', upload.status === 200, `status=${upload.status} body=${upload.body.slice(0, 150)}`);

    const readSelf = await storageGet(driverToken, OBJECT_PATH);
    check('storage.drivers_private : le livreur lit sa propre pièce — non-régression', readSelf.status === 200, `status=${readSelf.status}`);

    const readIn = await storageGet(adminInToken, OBJECT_PATH);
    check('storage.drivers_private : admin DANS le périmètre (ville IN) autorisé à lire — non-régression', readIn.status === 200, `status=${readIn.status}`);

    const readOut = await storageGet(adminOutToken, OBJECT_PATH);
    check('storage.drivers_private : admin HORS périmètre (ville OUT) REFUSÉ à lire — correctif attendu', readOut.status === 403, `status=${readOut.status} body=${readOut.body.slice(0, 150)}`);
  } finally {
    await bucket.file(OBJECT_PATH).delete().catch(() => {});
    await db.doc(`drivers/${DRIVER_UID}`).delete().catch(() => {});
    await auth.deleteUser(DRIVER_UID).catch(() => {});
    await cleanupAdmin(ADMIN_IN);
    await cleanupAdmin(ADMIN_OUT);
  }
}

// ------------------------------------------------------------------ 2. supportTickets : scope ville/pays

async function testSupportTicketScope() {
  const CITY_IN = 'cdcres53-ville-sup-in';
  const CITY_OUT = 'cdcres53-ville-sup-out';
  const ADMIN_CITY_IN = 'cdcres53-admin-sup-cityin';
  const ADMIN_CITY_OUT = 'cdcres53-admin-sup-cityout';
  const ADMIN_COUNTRY_OUT = 'cdcres53-admin-sup-countryout';
  const TICKET_ID = 'cdcres53-ticket';

  await db.doc(`users/cdcres53-requester`).set({ role: 'client', firstName: 'Test', lastName: 'Requester', test: true });
  await db.doc(`supportTickets/${TICKET_ID}`).set({
    number: 'T-CDCRES53', requesterType: 'client', requesterId: 'cdcres53-requester-uid', requesterName: 'Test Requester',
    countryId: 'FR', cityId: CITY_IN, reasonId: 'autre', subject: 'Test cdcres53', status: 'open', priority: 'normal',
    channel: 'app', assigneeId: null, escalated: false, refundIds: [], compensationCents: 0, tags: [],
    lastMessageAt: now(), lastMessagePreview: 'Test', unreadByRequester: 0, unreadBySupport: 1,
    firstResponseDueAt: now(), resolutionDueAt: now(), test: true, createdAt: now(), updatedAt: now(), updatedBy: 'system',
  });

  const { token: cityInToken } = await createAdmin(ADMIN_CITY_IN, 'cdcres53-admin-sup-cityin@golink.test', { permissions: ['support.view', 'support.handle'], cityIds: [CITY_IN], countryIds: ['FR'] });
  const { token: cityOutToken } = await createAdmin(ADMIN_CITY_OUT, 'cdcres53-admin-sup-cityout@golink.test', { permissions: ['support.view', 'support.handle'], cityIds: [CITY_OUT], countryIds: ['FR'] });
  // Admin sans restriction de ville (cityIds vide) mais restreint au pays BE : doit quand même être refusé sur un ticket FR — preuve que la dualité ville/pays est bien appliquée, pas seulement la ville.
  const { token: countryOutToken } = await createAdmin(ADMIN_COUNTRY_OUT, 'cdcres53-admin-sup-countryout@golink.test', { permissions: ['support.view', 'support.handle'], cityIds: [], countryIds: ['BE'] });
  try {
    const readIn = await restGet(cityInToken, `supportTickets/${TICKET_ID}`);
    check('supportTickets : lecture directe DANS le périmètre (ville IN, pays FR) autorisée — non-régression', allowed(readIn), `status=${readIn.status}`);

    const readOutCity = await restGet(cityOutToken, `supportTickets/${TICKET_ID}`);
    check('supportTickets : lecture directe HORS périmètre ville REFUSÉE — correctif attendu', denied(readOutCity), `status=${readOutCity.status}`);

    const readOutCountry = await restGet(countryOutToken, `supportTickets/${TICKET_ID}`);
    check('supportTickets : lecture directe HORS périmètre pays (cityIds vide, countryIds=[BE]) REFUSÉE — correctif attendu', denied(readOutCountry), `status=${readOutCountry.status}`);

    await expectError('respondToTicket : ticket HORS périmètre ville REFUSÉ (fonction) — correctif attendu', call(cityOutToken, 'respondToTicket', { ticketId: TICKET_ID, body: 'Test réponse hors périmètre', internal: true, status: null, cannedResponseId: null }), 'périmètre');
    await expectError('respondToTicket : ticket HORS périmètre pays REFUSÉ (fonction) — correctif attendu', call(countryOutToken, 'respondToTicket', { ticketId: TICKET_ID, body: 'Test réponse hors périmètre', internal: true, status: null, cannedResponseId: null }), 'périmètre');

    const respondIn = await call(cityInToken, 'respondToTicket', { ticketId: TICKET_ID, body: 'Note interne de test cdcres53', internal: true, status: null, cannedResponseId: null });
    check('respondToTicket : ticket DANS le périmètre accepté (fonction) — non-régression', Boolean(respondIn?.messageId), JSON.stringify(respondIn));
  } finally {
    const messages = await db.collection(`supportTickets/${TICKET_ID}/messages`).listDocuments();
    await Promise.all(messages.map((m) => m.delete().catch(() => {})));
    await db.doc(`supportTickets/${TICKET_ID}`).delete().catch(() => {});
    await db.doc(`users/cdcres53-requester`).delete().catch(() => {});
    await cleanupAdmin(ADMIN_CITY_IN);
    await cleanupAdmin(ADMIN_CITY_OUT);
    await cleanupAdmin(ADMIN_COUNTRY_OUT);
  }
}

// ------------------------------------------------------------------ 3. inviteOwnCourier : exclusivité caisse

async function testOwnCourierExclusivity() {
  const RES_A = 'cdcres53-resto-a';
  const RES_B = 'cdcres53-resto-b';
  const ADMIN_UID = 'cdcres53-admin-courier';
  const DRIVER_EMAIL = 'cdcres53-courier-partage@golink.test';

  await db.doc(`restaurants/${RES_A}`).set({ name: 'CDCRES53 A', cityId: 'longwy', countryId: 'FR', status: 'active', onboardingStatus: 'approved', test: true, createdAt: now(), updatedAt: now(), updatedBy: 'system' });
  await db.doc(`restaurants/${RES_B}`).set({ name: 'CDCRES53 B', cityId: 'longwy', countryId: 'FR', status: 'active', onboardingStatus: 'approved', test: true, createdAt: now(), updatedAt: now(), updatedBy: 'system' });
  // Membre admin SDK pour simuler requireRestaurantAccess sans passer par un vrai compte restaurant (on utilise un admin super_admin, qui satisfait aussi requireRestaurantAccess côté admin).
  const { token: adminToken, } = await createAdmin(ADMIN_UID, 'cdcres53-admin-courier@golink.test', { role: 'super_admin', permissions: [] });
  let driverUid = null;
  try {
    const invite1 = await call(adminToken, 'inviteOwnCourier', { restaurantId: RES_A, firstName: 'Test', lastName: 'CDCRES53', email: DRIVER_EMAIL, phone: '+33600000001', vehicle: 'bike', zoneIds: [] });
    check('inviteOwnCourier : première invitation (restaurant A) acceptée', Boolean(invite1?.driverId), JSON.stringify(invite1));
    driverUid = invite1?.driverId;

    // Statut par défaut du rattachement à l'invitation : vérifié actif pour que le test ait un sens.
    const courierA = (await db.doc(`restaurants/${RES_A}/couriers/${driverUid}`).get()).data();
    check('inviteOwnCourier : rattachement A créé avec statut actif', courierA?.status === 'active', `status=${courierA?.status}`);

    await expectError(
      'inviteOwnCourier : seconde invitation (restaurant B), livreur déjà actif chez A, REFUSÉE — correctif attendu',
      call(adminToken, 'inviteOwnCourier', { restaurantId: RES_B, firstName: 'Test', lastName: 'CDCRES53', email: DRIVER_EMAIL, phone: '+33600000001', vehicle: 'bike', zoneIds: [] }),
      'un seul établissement',
    );

    // Non-régression : une fois le rattachement A désactivé, le livreur doit pouvoir rejoindre B.
    await db.doc(`restaurants/${RES_A}/couriers/${driverUid}`).update({ status: 'inactive', updatedAt: now(), updatedBy: 'system' });
    const invite2 = await call(adminToken, 'inviteOwnCourier', { restaurantId: RES_B, firstName: 'Test', lastName: 'CDCRES53', email: DRIVER_EMAIL, phone: '+33600000001', vehicle: 'bike', zoneIds: [] });
    check('inviteOwnCourier : invitation (restaurant B) acceptée une fois A inactif — non-régression', Boolean(invite2?.driverId), JSON.stringify(invite2));
  } finally {
    if (driverUid) {
      await Promise.all([
        `restaurants/${RES_A}/couriers/${driverUid}`,
        `restaurants/${RES_B}/couriers/${driverUid}`,
        `drivers/${driverUid}`,
        `users/${driverUid}`,
        `userPrivate/${driverUid}`,
      ].map((p) => db.doc(p).delete().catch(() => {})));
      await auth.deleteUser(driverUid).catch(() => {});
    }
    await db.doc(`restaurants/${RES_A}`).delete().catch(() => {});
    await db.doc(`restaurants/${RES_B}`).delete().catch(() => {});
    await cleanupAdmin(ADMIN_UID);
  }
}

async function main() {
  await testRestaurantKycScope();
  await testDriverKycScope();
  await testSupportTicketScope();
  await testOwnCourierExclusivity();
}

main()
  .catch((error) => record('exception', false, String(error.stack ?? error)))
  .finally(() => {
    const failed = results.filter((r) => !r.ok);
    console.log(`\n${results.length - failed.length}/${results.length} OK`);
    if (failed.length) {
      console.log('Échecs :');
      for (const f of failed) console.log(` - ${f.name} : ${f.detail}`);
      process.exitCode = 1;
    }
  });
