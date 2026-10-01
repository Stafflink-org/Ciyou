// Test réel cdc-fix-residuals-43 (§10 Zones et villes, §14 Paiements, §22 Paramètres
// plateforme) : trois défauts de cloisonnement par ville dans les règles Firestore, de la même
// famille que cinq défauts déjà trouvés et corrigés dans ce dépôt (orders.rules, users.rules,
// reviews, ratingWatch, campaigns, prospects).
//
//  1. `surgeRules/{ruleId}` : lecture `isAdmin('zones.edit'/'drivers.pay_rules')` sans ville —
//     un admin city_manager limité à une ville lisait les règles de majoration tarifaire de
//     n'importe quelle autre ville. Corrigé : `isAdminIn(..., resource.data.cityId)`.
//  2. `refunds/{refundId}` : lecture `isAdmin('refunds.create')` sans ville — un city_manager
//     (qui a `refunds.create` mais ni `refunds.approve` ni `finance.view`) lisait tous les
//     remboursements de la plateforme (données personnelles, montants, causes). Corrigé.
//  3. `settingsHistory/{entryId}` : lecture `isAdmin('order_rules.edit'/'zones.edit'/
//     'drivers.pay_rules')` sans ville — un city_manager lisait l'historique (avant/après,
//     motif) des réglages de n'importe quelle autre ville. Corrigé : `writeSettingsHistory`
//     pose désormais un `cityId` pour les réglages scopés à une ville, et la règle le vérifie
//     (`isAdminIn`) quand il est présent ; une entrée sans ville (réglage plateforme) reste
//     lisible comme avant.
//
// Test réel contre les règles de PRODUCTION (golink-9f16d), via un compte administrateur JETABLE
// limité à Metz (zones.edit, drivers.pay_rules, refunds.create, cityIds=['metz']).
//
//   npx tsx scripts/tests/cdc-fix-residuals-43.flow.mjs
import { auth, db } from '../lib/admin.mjs';

const API_KEY = 'AIzaSyAYQ_TzyCEK0_Iw5TnSiH8jbFbOFKZYNoM';
const PROJECT_ID = 'golink-9f16d';
const FS = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
const TEST_UID = 'test-admin-cdcres43-metz-only';
const TEST_PASSWORD = `Cdcres43!${Math.random().toString(36).slice(2, 10)}`;

const SURGE_METZ = 'cdcres43-surge-metz';
const SURGE_LONGWY = 'cdcres43-surge-longwy';
const REFUND_METZ = 'cdcres43-refund-metz';
const REFUND_LONGWY = 'cdcres43-refund-longwy';
const HIST_METZ = 'cdcres43-hist-metz';
const HIST_LONGWY = 'cdcres43-hist-longwy';
const HIST_PLATFORM = 'cdcres43-hist-platform';

const results = [];
const record = (name, ok, detail) => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'OK   ' : 'ÉCHEC'} ${name}${detail ? ` — ${detail}` : ''}`);
};

async function signInWithPassword(email, password) {
  const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${API_KEY}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error('signIn failed: ' + JSON.stringify(json));
  return json.idToken;
}
async function get(token, path) {
  const res = await fetch(`${FS}/${path}`, { headers: { authorization: `Bearer ${token}` } });
  return { status: res.status, json: await res.json() };
}
const denied = (res) => res.status === 403 || res.json?.error?.status === 'PERMISSION_DENIED';
const allowed = (res) => res.status === 200 && !res.json?.error;

async function main() {
  const now = { timestampValue: new Date().toISOString() };

  // --- 1. surgeRules ---
  for (const [id, cityId] of [[SURGE_METZ, 'metz'], [SURGE_LONGWY, 'longwy']]) {
    await db.doc(`surgeRules/${id}`).set({
      countryId: 'FR', cityId, zoneIds: ['z1'], name: 'Test cdcres43', active: true, trigger: 'manual', schedule: null, demandRatio: null,
      multiplierBps: 15000, flatFeeCents: 0, courierBonusCents: 100, startsAt: null, endsAt: null, createdAt: now, updatedAt: now, createdBy: 'system', updatedBy: 'system', test: true,
    });
  }

  // --- 2. refunds (customerId/restaurantId étrangers à l'admin de test, seul isAdminIn peut autoriser) ---
  for (const [id, cityId] of [[REFUND_METZ, 'metz'], [REFUND_LONGWY, 'longwy']]) {
    await db.doc(`refunds/${id}`).set({
      orderId: 'o-cdcres43', orderNumber: 'GL-CDCRES43', countryId: 'FR', cityId, customerId: 'cdcres43-other-customer', restaurantId: 'cdcres43-other-restaurant',
      driverId: null, ticketId: null, amountCents: 500, method: 'original_payment', cause: 'other', allocation: { restaurantCents: 0, courierCents: 0, platformCents: 500 },
      items: null, status: 'approved', automatic: false, reason: 'Test cdcres43', requestedBy: 'system', requestedAt: now, approvedBy: 'system', approvedAt: now,
      rejectionReason: null, providerRefundId: null, creditNoteId: null, processedAt: null, test: true,
    });
  }

  // --- 3. settingsHistory ---
  for (const [id, cityId] of [[HIST_METZ, 'metz'], [HIST_LONGWY, 'longwy']]) {
    await db.collection('settingsHistory').doc(id).set({
      docPath: `cities/${cityId}#dispatch`, changedFields: ['acceptanceTimeoutSeconds'], before: { acceptanceTimeoutSeconds: 60 }, after: { acceptanceTimeoutSeconds: 90 },
      reason: 'Test cdcres43', changedBy: 'system', changedByName: 'Système', changedAt: now, cityId, test: true,
    });
  }
  await db.collection('settingsHistory').doc(HIST_PLATFORM).set({
    docPath: 'settings/orderRules', changedFields: ['defaultPrepMinutes'], before: { defaultPrepMinutes: 20 }, after: { defaultPrepMinutes: 25 },
    reason: 'Test cdcres43 (plateforme)', changedBy: 'system', changedByName: 'Système', changedAt: now, cityId: null, test: true,
  });

  await auth.deleteUser(TEST_UID).catch(() => {});
  await auth.createUser({ uid: TEST_UID, email: 'cdcres43-admin@golink.test', password: TEST_PASSWORD });
  await auth.setCustomUserClaims(TEST_UID, { role: 'admin' });
  await db.doc(`admins/${TEST_UID}`).set({
    role: 'city_manager', active: true, permissions: ['zones.edit', 'drivers.pay_rules', 'refunds.create'], cityIds: ['metz'], countryIds: [],
    displayName: 'Test cdcres43', email: 'cdcres43-admin@golink.test', test: true,
  });

  try {
    const idToken = await signInWithPassword('cdcres43-admin@golink.test', TEST_PASSWORD);
    console.log('admin jetable connecté : zones.edit/drivers.pay_rules/refunds.create, cityIds=["metz"]');

    const surgeMetz = await get(idToken, `surgeRules/${SURGE_METZ}`);
    record('surgeRules de Metz LISIBLE (dans le périmètre)', allowed(surgeMetz), `status=${surgeMetz.status}`);
    const surgeLongwy = await get(idToken, `surgeRules/${SURGE_LONGWY}`);
    record('surgeRules de Longwy REFUSÉ (hors périmètre, correctif attendu)', denied(surgeLongwy), `status=${surgeLongwy.status}`);

    const refundMetz = await get(idToken, `refunds/${REFUND_METZ}`);
    record('refund de Metz LISIBLE (dans le périmètre)', allowed(refundMetz), `status=${refundMetz.status}`);
    const refundLongwy = await get(idToken, `refunds/${REFUND_LONGWY}`);
    record('refund de Longwy REFUSÉ (hors périmètre, correctif attendu)', denied(refundLongwy), `status=${refundLongwy.status}`);

    const histMetz = await get(idToken, `settingsHistory/${HIST_METZ}`);
    record('settingsHistory de Metz LISIBLE (dans le périmètre)', allowed(histMetz), `status=${histMetz.status}`);
    const histLongwy = await get(idToken, `settingsHistory/${HIST_LONGWY}`);
    record('settingsHistory de Longwy REFUSÉ (hors périmètre, correctif attendu)', denied(histLongwy), `status=${histLongwy.status}`);
    const histPlatform = await get(idToken, `settingsHistory/${HIST_PLATFORM}`);
    record('settingsHistory plateforme (sans ville) toujours LISIBLE (non-régression)', allowed(histPlatform), `status=${histPlatform.status}`);
  } finally {
    for (const id of [SURGE_METZ, SURGE_LONGWY]) await db.doc(`surgeRules/${id}`).delete().catch(() => {});
    for (const id of [REFUND_METZ, REFUND_LONGWY]) await db.doc(`refunds/${id}`).delete().catch(() => {});
    for (const id of [HIST_METZ, HIST_LONGWY, HIST_PLATFORM]) await db.doc(`settingsHistory/${id}`).delete().catch(() => {});
    await db.doc(`admins/${TEST_UID}`).delete().catch(() => {});
    await db.doc(`users/${TEST_UID}`).delete().catch(() => {});
    await db.doc(`userPrivate/${TEST_UID}`).delete().catch(() => {});
    await auth.deleteUser(TEST_UID).catch(() => {});
    const gone = !(await db.doc(`admins/${TEST_UID}`).get()).exists && !(await db.doc(`users/${TEST_UID}`).get()).exists;
    record('nettoyage : documents de test et compte admin supprimés', gone);
  }
}

await main();
const ok = results.every((r) => r.ok);
console.log(`\n${results.filter((r) => r.ok).length}/${results.length} OK`);
process.exit(ok ? 0 : 1);
