// Test réel cdc-fix-residuals-20 (§8 Commandes, ligne « Détail pour litige », déjà COMPLET mais
// réserve de sécurité non corrigée) : la lecture de la commande elle-même (`orders/{orderId}`)
// est bornée par ville (`isAdminIn('orders.view', order.cityId)`), mais sa sous-collection
// `events` (chronologie complète, auteurs des actions) était lue avec `isAdmin('orders.view')`
// SANS borne de ville — un admin limité à une seule ville pouvait lire la chronologie d'une
// commande de n'importe quelle AUTRE ville en ouvrant directement cette sous-collection,
// contournant le cloisonnement déjà appliqué sur le document parent.
//
// Corrigé : la règle de `orders/{orderId}/events/{eventId}` utilise désormais la même ville que
// la commande parente (`isAdminIn('orders.view', <cityId de la commande>)`).
//
// Test réel contre les règles de PRODUCTION (golink-9f16d), via un compte administrateur JETABLE
// limité à Metz (orders.view seul) — doit lire les événements d'une commande de Metz, pas ceux
// d'une commande de Longwy.
//
//   npx tsx scripts/tests/cdc-fix-residuals-20.flow.mjs
import { auth, db } from '../lib/admin.mjs';

const API_KEY = 'AIzaSyAYQ_TzyCEK0_Iw5TnSiH8jbFbOFKZYNoM'; // clé web publique golink-9f16d
const PROJECT_ID = 'golink-9f16d';
const TEST_UID = 'test-admin-cdcres20-metz-only';
const ORDER_METZ = 'cdcres20-order-metz';
const ORDER_LONGWY = 'cdcres20-order-longwy';

const results = [];
const record = (name, ok, detail) => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'OK   ' : 'ÉCHEC'} ${name}${detail ? ` — ${detail}` : ''}`);
};

async function signInWithPassword(email, password) {
  const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error('signIn failed: ' + JSON.stringify(json));
  return json.idToken;
}

async function readEvent(idToken, orderId, eventId) {
  const res = await fetch(`https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/orders/${orderId}/events/${eventId}`, {
    headers: { Authorization: `Bearer ${idToken}` },
  });
  const json = await res.json();
  return { status: res.status, json };
}

const TEST_PASSWORD = `Cdcres20!${Math.random().toString(36).slice(2, 10)}`;

async function main() {
  const now = { timestampValue: new Date().toISOString() };
  // Deux commandes jetables minimales (une par ville) avec un évènement chacune.
  for (const [orderId, cityId] of [[ORDER_METZ, 'metz'], [ORDER_LONGWY, 'longwy']]) {
    await db.doc(`orders/${orderId}`).set({
      number: `GL-${orderId}`,
      status: 'accepted',
      fulfillment: 'delivery',
      restaurantId: 'cdcres20-test-restaurant',
      restaurantName: 'Commerce de test (cdcres20)',
      customerId: 'cdcres20-test-customer',
      customerName: 'Client Test Résiduel20',
      countryId: 'FR',
      cityId,
      createdAt: now,
      updatedAt: now,
      test: true,
    });
    await db.doc(`orders/${orderId}/events/e1`).set({
      type: 'test_event',
      visibleToCustomer: false,
      createdAt: now,
      test: true,
    });
  }

  await auth.deleteUser(TEST_UID).catch(() => {});
  await auth.createUser({ uid: TEST_UID, email: 'cdcres20-admin@golink.test', password: TEST_PASSWORD });
  await auth.setCustomUserClaims(TEST_UID, { role: 'admin' });
  await db.doc(`admins/${TEST_UID}`).set({
    role: 'city_manager',
    active: true,
    permissions: ['orders.view'],
    cityIds: ['metz'],
    countryIds: [],
    displayName: 'Test cdc-fix-residuals-20',
    email: 'cdcres20-admin@golink.test',
    test: true,
  });

  try {
    const idToken = await signInWithPassword('cdcres20-admin@golink.test', TEST_PASSWORD);
    console.log('admin jetable connecté : orders.view seul, cityIds=["metz"]');

    const metzEvent = await readEvent(idToken, ORDER_METZ, 'e1');
    record('événement de la commande de Metz LISIBLE (dans le périmètre)', metzEvent.status === 200 && !metzEvent.json.error, `status=${metzEvent.status}`);

    const longwyEvent = await readEvent(idToken, ORDER_LONGWY, 'e1');
    const denied = longwyEvent.status === 403 || longwyEvent.json?.error?.status === 'PERMISSION_DENIED';
    record('événement de la commande de Longwy REFUSÉ (hors périmètre, correctif attendu)', denied, `status=${longwyEvent.status}`);
  } finally {
    await db.doc(`orders/${ORDER_METZ}/events/e1`).delete().catch(() => {});
    await db.doc(`orders/${ORDER_LONGWY}/events/e1`).delete().catch(() => {});
    await db.doc(`orders/${ORDER_METZ}`).delete().catch(() => {});
    await db.doc(`orders/${ORDER_LONGWY}`).delete().catch(() => {});
    await db.doc(`admins/${TEST_UID}`).delete().catch(() => {});
    await auth.deleteUser(TEST_UID).catch(() => {});
    const gone = !(await db.doc(`admins/${TEST_UID}`).get()).exists && !(await db.doc(`orders/${ORDER_METZ}`).get()).exists && !(await db.doc(`orders/${ORDER_LONGWY}`).get()).exists;
    record('nettoyage : commandes, événements et compte admin de test supprimés', gone);
  }
}

await main();
const ok = results.every((r) => r.ok);
console.log(`\n${results.filter((r) => r.ok).length}/${results.length} OK`);
process.exit(ok ? 0 : 1);
