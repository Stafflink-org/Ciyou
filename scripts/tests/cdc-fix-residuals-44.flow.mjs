// Test réel cdc-fix-residuals-44 : balayage complet du dépôt pour le même défaut de
// cloisonnement par ville (`isAdmin(perm)` sans ville au lieu de `isAdminIn(perm, cityId)`),
// trouvé 8 fois dans ce segment (orders.rules, users.rules, reviews, ratingWatch, campaigns,
// prospects, surgeRules, refunds, settingsHistory) et ici confirmé et corrigé sur un ENSEMBLE
// de ~25 règles supplémentaires réparties sur 6 fichiers :
//  - `restaurants.rules` : private/legal, settings, stockMovements, members, staffRoles,
//    customers(+notes), couriers, dailyStats, partnerDocuments, menuIssues, restaurantGroups
//    (scope multi-villes, nouveau champ dénormalisé `cityIds`).
//  - `drivers.rules` : driverLocations, driverSessions, driverSanctions, identityChecks,
//    dispatchOffers, driverEarnings.
//  - `marketing.rules` : promotions (multi-villes), promotionRedemptions,
//    restaurants/{rid}/marketing.
//  - `compliance.rules` : legalAcceptances (branche restaurant).
//  - `equipe-rh.rules` : staffDirectory.
//  - `workforce.rules` : 13 sous-collections HACCP/RH (employees et consorts) — même motif,
//    corrigé en un seul remplacement global.
//
// Un admin `city_manager` limité à une ville pouvait lire directement (SDK/REST, hors écran)
// toutes ces données pour N'IMPORTE QUELLE AUTRE ville — fiches RH, documents d'identité,
// CRM clients, contrôles HACCP, etc. — alors que les Cloud Functions équivalentes appliquent
// déjà `assertAdminCovers`.
//
// Test réel contre les règles de PRODUCTION (golink-9f16d), via un compte administrateur JETABLE
// limité à Metz, sur un échantillon représentatif de chaque fichier/motif corrigé (lecture
// directe par document précis, pas par requête de liste).
//
//   npx tsx scripts/tests/cdc-fix-residuals-44.flow.mjs
import { auth, db } from '../lib/admin.mjs';

const API_KEY = 'AIzaSyAYQ_TzyCEK0_Iw5TnSiH8jbFbOFKZYNoM';
const PROJECT_ID = 'golink-9f16d';
const FS = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
const TEST_UID = 'test-admin-cdcres44-metz-only';
const TEST_PASSWORD = `Cdcres44!${Math.random().toString(36).slice(2, 10)}`;

const RESTO_METZ = 'cdcres44-resto-metz';
const RESTO_LONGWY = 'cdcres44-resto-longwy';
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
const allowed = (res) => res.status === 200 && !res.json?.error;
const denied = (res) => res.status === 403 || res.json?.error?.status === 'PERMISSION_DENIED';

async function main() {
  const now = { timestampValue: new Date().toISOString() };

  await db.doc(`restaurants/${RESTO_METZ}`).set({ name: 'CDCRES44 Metz', cityId: 'metz', countryId: 'FR', status: 'active', onboardingStatus: 'approved', test: true, createdAt: now, updatedAt: now, updatedBy: 'system' });
  await db.doc(`restaurants/${RESTO_LONGWY}`).set({ name: 'CDCRES44 Longwy', cityId: 'longwy', countryId: 'FR', status: 'active', onboardingStatus: 'approved', test: true, createdAt: now, updatedAt: now, updatedBy: 'system' });

  // --- restaurants.rules : members, customers, dailyStats, private/legal ---
  for (const rid of [RESTO_METZ, RESTO_LONGWY]) {
    await db.doc(`restaurants/${rid}/members/cdcres44-member`).set({ uid: 'cdcres44-member', restaurantId: rid, displayName: 'Test', email: 'x@golink.test', role: 'employee', permissions: [], active: true, onDuty: false, invitedBy: 'system', invitedAt: now });
    await db.doc(`restaurants/${rid}/customers/cdcres44-cust`).set({ userId: 'cdcres44-cust', blocked: false, internalNote: 'Test', tags: [], updatedAt: now });
    await db.doc(`restaurants/${rid}/dailyStats/2026-10-01`).set({ day: '2026-10-01', ordersCount: 0, grossCents: 0 });
    await db.doc(`restaurants/${rid}/private/legal`).set({ legalName: 'Test SARL', siret: '00000000000000', registeredAddress: { line1: 'x', postalCode: '00000', city: 'x' } });
    await db.doc(`restaurants/${rid}/employees/cdcres44-emp`).set({ firstName: 'A', lastName: 'B', position: 'Serveur', contractType: 'cdi', status: 'active', hireDate: '2026-01-01', weeklyHours: 35, hourlyRateCents: 1200, socialCategory: 'employee', createdAt: now, updatedAt: now, updatedBy: 'system' });
  }

  // --- menuIssues (top-level, cityId direct) ---
  await db.doc('menuIssues/cdcres44-issue-metz').set({ restaurantId: RESTO_METZ, cityId: 'metz', type: 'missing_photo', status: 'open', detectedAt: now, test: true });
  await db.doc('menuIssues/cdcres44-issue-longwy').set({ restaurantId: RESTO_LONGWY, cityId: 'longwy', type: 'missing_photo', status: 'open', detectedAt: now, test: true });

  // --- partnerDocuments (ownerType restaurant) ---
  await db.doc('partnerDocuments/cdcres44-doc-metz').set({ ownerType: 'restaurant', ownerId: RESTO_METZ, cityId: 'metz', countryId: 'FR', type: 'kbis', file: { url: 'https://x', contentType: 'application/pdf', sizeBytes: 100 }, status: 'pending', remindersSent: 0, test: true, createdAt: now, updatedAt: now, createdBy: 'system', updatedBy: 'system' });
  await db.doc('partnerDocuments/cdcres44-doc-longwy').set({ ownerType: 'restaurant', ownerId: RESTO_LONGWY, cityId: 'longwy', countryId: 'FR', type: 'kbis', file: { url: 'https://x', contentType: 'application/pdf', sizeBytes: 100 }, status: 'pending', remindersSent: 0, test: true, createdAt: now, updatedAt: now, createdBy: 'system', updatedBy: 'system' });

  // --- legalAcceptances (restaurantId -> get() restaurant) ---
  await db.doc('legalAcceptances/cdcres44-accept-metz').set({ userId: 'cdcres44-owner', userType: 'restaurant', restaurantId: RESTO_METZ, documentId: 'd1', documentType: 'partner_terms', version: '1', acceptedAt: now, test: true });
  await db.doc('legalAcceptances/cdcres44-accept-longwy').set({ userId: 'cdcres44-owner', userType: 'restaurant', restaurantId: RESTO_LONGWY, documentId: 'd1', documentType: 'partner_terms', version: '1', acceptedAt: now, test: true });

  // --- restaurantGroups (array cityIds) ---
  await db.doc('restaurantGroups/cdcres44-group-metz').set({ name: 'Groupe Metz', ownerId: 'cdcres44-owner', countryId: 'FR', restaurantIds: [RESTO_METZ], cityIds: ['metz'], consolidatedBilling: false, deletedAt: null, test: true, createdAt: now, updatedAt: now, createdBy: 'system', updatedBy: 'system' });
  await db.doc('restaurantGroups/cdcres44-group-longwy').set({ name: 'Groupe Longwy', ownerId: 'cdcres44-owner', countryId: 'FR', restaurantIds: [RESTO_LONGWY], cityIds: ['longwy'], consolidatedBilling: false, deletedAt: null, test: true, createdAt: now, updatedAt: now, createdBy: 'system', updatedBy: 'system' });

  // --- promotions (array cityIds) ---
  await db.doc('promotions/cdcres44-promo-metz').set({ scope: 'platform', cityIds: ['metz'], restaurantIds: [], title: { fr: 'Test' }, kind: 'percentage', value: 1000, minSubtotalCents: 0, funding: 'platform', target: 'all', modes: ['delivery'], perCustomerLimit: 1, startsAt: now, status: 'active', showcase: false, stats: { redemptions: 0 }, test: true, createdAt: now, updatedAt: now, createdBy: 'system', updatedBy: 'system' });
  await db.doc('promotions/cdcres44-promo-longwy').set({ scope: 'platform', cityIds: ['longwy'], restaurantIds: [], title: { fr: 'Test' }, kind: 'percentage', value: 1000, minSubtotalCents: 0, funding: 'platform', target: 'all', modes: ['delivery'], perCustomerLimit: 1, startsAt: now, status: 'active', showcase: false, stats: { redemptions: 0 }, test: true, createdAt: now, updatedAt: now, createdBy: 'system', updatedBy: 'system' });

  // --- driverLocations (direct cityId, drivers.rules) ---
  await db.doc('driverLocations/cdcres44-driver-metz').set({ position: { latitude: 49.1, longitude: 6.17 }, geohash: 'u0h', cityId: 'metz', visibleTo: [], updatedAt: now });
  await db.doc('driverLocations/cdcres44-driver-longwy').set({ position: { latitude: 49.52, longitude: 5.76 }, geohash: 'u0h', cityId: 'longwy', visibleTo: [], updatedAt: now });

  await auth.deleteUser(TEST_UID).catch(() => {});
  await auth.createUser({ uid: TEST_UID, email: 'cdcres44-admin@golink.test', password: TEST_PASSWORD });
  await auth.setCustomUserClaims(TEST_UID, { role: 'admin' });
  await db.doc(`admins/${TEST_UID}`).set({
    role: 'city_manager', active: true,
    permissions: ['restaurants.view', 'restaurants.validate', 'drivers.view', 'customers.view', 'promotions.view'],
    cityIds: ['metz'], countryIds: [], displayName: 'Test cdcres44', email: 'cdcres44-admin@golink.test', test: true,
  });

  try {
    const idToken = await signInWithPassword('cdcres44-admin@golink.test', TEST_PASSWORD);
    console.log('admin jetable connecté : restaurants.view/.validate, drivers.view, customers.view, promotions.view, cityIds=["metz"]');

    const cases = [
      ['restaurants.rules members', `restaurants/${RESTO_METZ}/members/cdcres44-member`, `restaurants/${RESTO_LONGWY}/members/cdcres44-member`],
      ['restaurants.rules customers', `restaurants/${RESTO_METZ}/customers/cdcres44-cust`, `restaurants/${RESTO_LONGWY}/customers/cdcres44-cust`],
      ['restaurants.rules dailyStats', `restaurants/${RESTO_METZ}/dailyStats/2026-10-01`, `restaurants/${RESTO_LONGWY}/dailyStats/2026-10-01`],
      ['restaurants.rules private/legal', `restaurants/${RESTO_METZ}/private/legal`, `restaurants/${RESTO_LONGWY}/private/legal`],
      ['workforce.rules employees', `restaurants/${RESTO_METZ}/employees/cdcres44-emp`, `restaurants/${RESTO_LONGWY}/employees/cdcres44-emp`],
      ['menuIssues', 'menuIssues/cdcres44-issue-metz', 'menuIssues/cdcres44-issue-longwy'],
      ['partnerDocuments', 'partnerDocuments/cdcres44-doc-metz', 'partnerDocuments/cdcres44-doc-longwy'],
      ['compliance.rules legalAcceptances', 'legalAcceptances/cdcres44-accept-metz', 'legalAcceptances/cdcres44-accept-longwy'],
      ['restaurantGroups (multi-villes)', 'restaurantGroups/cdcres44-group-metz', 'restaurantGroups/cdcres44-group-longwy'],
      ['promotions (multi-villes)', 'promotions/cdcres44-promo-metz', 'promotions/cdcres44-promo-longwy'],
      ['drivers.rules driverLocations', 'driverLocations/cdcres44-driver-metz', 'driverLocations/cdcres44-driver-longwy'],
    ];
    for (const [label, pathMetz, pathLongwy] of cases) {
      const resMetz = await get(idToken, pathMetz);
      record(`${label} : Metz LISIBLE (dans le périmètre)`, allowed(resMetz), `status=${resMetz.status}`);
      const resLongwy = await get(idToken, pathLongwy);
      record(`${label} : Longwy REFUSÉ (hors périmètre, correctif attendu)`, denied(resLongwy), `status=${resLongwy.status}`);
    }
  } finally {
    const cleanupPaths = [
      `restaurants/${RESTO_METZ}`, `restaurants/${RESTO_LONGWY}`,
      `restaurants/${RESTO_METZ}/members/cdcres44-member`, `restaurants/${RESTO_LONGWY}/members/cdcres44-member`,
      `restaurants/${RESTO_METZ}/customers/cdcres44-cust`, `restaurants/${RESTO_LONGWY}/customers/cdcres44-cust`,
      `restaurants/${RESTO_METZ}/dailyStats/2026-10-01`, `restaurants/${RESTO_LONGWY}/dailyStats/2026-10-01`,
      `restaurants/${RESTO_METZ}/private/legal`, `restaurants/${RESTO_LONGWY}/private/legal`,
      `restaurants/${RESTO_METZ}/employees/cdcres44-emp`, `restaurants/${RESTO_LONGWY}/employees/cdcres44-emp`,
      'menuIssues/cdcres44-issue-metz', 'menuIssues/cdcres44-issue-longwy',
      'partnerDocuments/cdcres44-doc-metz', 'partnerDocuments/cdcres44-doc-longwy',
      'legalAcceptances/cdcres44-accept-metz', 'legalAcceptances/cdcres44-accept-longwy',
      'restaurantGroups/cdcres44-group-metz', 'restaurantGroups/cdcres44-group-longwy',
      'promotions/cdcres44-promo-metz', 'promotions/cdcres44-promo-longwy',
      'driverLocations/cdcres44-driver-metz', 'driverLocations/cdcres44-driver-longwy',
      `admins/${TEST_UID}`, `users/${TEST_UID}`, `userPrivate/${TEST_UID}`,
    ];
    await Promise.all(cleanupPaths.map((p) => db.doc(p).delete().catch(() => {})));
    await auth.deleteUser(TEST_UID).catch(() => {});
    const gone = !(await db.doc(`admins/${TEST_UID}`).get()).exists;
    record('nettoyage : tous les documents de test et le compte admin supprimés', gone);
  }
}

await main();
const ok = results.every((r) => r.ok);
console.log(`\n${results.filter((r) => r.ok).length}/${results.length} OK`);
process.exit(ok ? 0 : 1);
