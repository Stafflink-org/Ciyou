/**
 * Prépare une course réelle attribuée au DEUXIÈME compte de test (livreur
 * salarié, mission driver-lot3 point 5) pour vérifier à l'écran que
 * `CashBalanceCard` s'affiche (elle n'apparaît que pendant une course active,
 * voir apps/driver/src/features/dispatch/DispatchScreen.tsx). Copie adaptée de
 * scripts/simulate-driver-lot2-order.mjs (même mécanique, cible
 * `test-driver-lot3-restaurant` au lieu de `test-driver-lot1`, ne touche pas au
 * compte partagé). Le livreur de test doit être mis « en ligne » à la main dans
 * l'app avant d'exécuter ce script pour recevoir l'offre (ou l'attribution
 * directe ci-dessous fonctionne même hors ligne, comme pour le lot 2).
 *
 * Usage : node scripts/simulate-driver-lot3-cash-order.mjs --apply
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { FieldValue, GeoPoint, Timestamp } from '@google-cloud/firestore';
import { auth, db, PROJECT_ID } from './lib/admin.mjs';

const TEST_DRIVER_UID = 'test-driver-lot3-restaurant';

const FIREBASE_REGION = 'europe-west1';

const apply = process.argv.includes('--apply');
const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const API_KEY = /apiKey:\s*'([^']+)'/.exec(readFileSync(`${repoRoot}/apps/client/src/lib/firebase.ts`, 'utf8'))?.[1] ?? '';

async function signIn(uid) {
  const user = await auth.getUser(uid);
  const email = user.email ?? '';
  const password = `${randomUUID()}Aa1`;
  await auth.updateUser(uid, { password });
  const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${API_KEY}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  });
  const body = await res.json();
  if (!body.idToken) throw new Error(`Connexion impossible (${email}) : ${body.error?.message ?? res.status}`);
  return body.idToken;
}

async function call(name, token, data) {
  const res = await fetch(`https://${FIREBASE_REGION}-${PROJECT_ID}.cloudfunctions.net/${name}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ data }),
  });
  const body = await res.json().catch(() => ({}));
  if (body.error || !res.ok) throw new Error(`${name} : ${body.error?.message ?? res.status}`);
  return body.result;
}

async function main() {
  const clientUser = await auth.getUserByEmail('client.lot1@golink.test');
  const managerUser = await auth.getUserByEmail('sofia.martin@golink.test');
  console.log(`Client ${clientUser.uid} · Manager ${managerUser.uid} · Livreur ${TEST_DRIVER_UID}`);

  const addressRef = db.collection('users').doc(clientUser.uid).collection('addresses').doc('test-lot3-cash-livraison');
  const address = {
    label: 'Test lot 3 (espèces)',
    line1: '5 rue du Casino',
    line2: null,
    postalCode: '54400',
    city: 'Longwy',
    countryCode: 'FR',
    geo: new GeoPoint(49.525, 5.765),
    geohash: null,
    placeId: null,
    details: null,
    instructions: 'Test lot 3 — vérification CashBalanceCard.',
    floor: null,
    doorCode: null,
    isDefault: true,
    createdAt: Timestamp.now(),
    createdBy: clientUser.uid,
    updatedAt: Timestamp.now(),
    updatedBy: clientUser.uid,
  };
  if (apply) await addressRef.set(address, { merge: true });
  console.log(`Adresse : ${address.line1}, ${address.city} (${apply ? 'écriture réelle' : 'aperçu'})`);

  if (!apply) {
    console.log('Aperçu seulement (--apply pour exécuter réellement).');
    return;
  }

  const clientToken = await signIn(clientUser.uid);
  const placed = await call('placeOrder', clientToken, {
    restaurantId: 'mina-kitchen',
    fulfillment: 'delivery',
    lines: [{ productId: 'p1', quantity: 2 }],
    addressId: addressRef.id,
    paymentMethod: 'card',
    paymentMethodId: 'pm_card_visa',
    clientRequestId: randomUUID(),
    source: 'client_web',
  });
  console.log(`Commande créée : ${placed.number} (${placed.orderId}), statut ${placed.status}`);

  const managerToken = await signIn(managerUser.uid);
  await call('acceptOrder', managerToken, { orderId: placed.orderId, prepMinutes: 5 });
  await call('markOrderReady', managerToken, { orderId: placed.orderId });
  console.log('Commande acceptée puis prête.');

  const orderId = placed.orderId;
  await db.runTransaction(async (tx) => {
    const [orderSnap, driverSnap, locationSnap] = await tx.getAll(
      db.collection('orders').doc(orderId),
      db.collection('drivers').doc(TEST_DRIVER_UID),
      db.collection('driverLocations').doc(TEST_DRIVER_UID),
    );
    const order = orderSnap.data();
    const driver = driverSnap.data();
    if (order.driverId) throw new Error(`Commande déjà attribuée à ${order.delivery?.driverName}.`);
    const at = Timestamp.now();
    const driverName = `${driver.firstName} ${driver.lastName.charAt(0)}.`;
    tx.update(orderSnap.ref, {
      driverId: TEST_DRIVER_UID,
      'delivery.driverId': TEST_DRIVER_UID,
      'delivery.driverName': driverName,
      'delivery.driverPhoneMasked': driver.phone ? `${driver.phone.slice(0, 6)}··· ${driver.phone.slice(-2)}` : null,
      'delivery.driverVehicle': 'Scooter',
      'delivery.dispatchStatus': 'assigned',
      'delivery.dispatchRound': 1,
      'delivery.dispatchOfferId': null,
      'timeline.assigned': at,
      status: 'assigned',
      updatedAt: at,
    });
    tx.update(driverSnap.ref, { activeOrderIds: FieldValue.arrayUnion(orderId), availability: 'on_delivery', updatedAt: at });
    if (locationSnap.exists) {
      const location = locationSnap.data();
      tx.update(locationSnap.ref, {
        activeOrderIds: FieldValue.arrayUnion(orderId),
        availability: 'on_delivery',
        visibleTo: [...new Set([...(location.visibleTo ?? []), order.customerId, managerUser.uid])],
      });
    }
    tx.set(db.collection('orders').doc(orderId).collection('events').doc(), {
      type: 'driver_assigned',
      from: null,
      to: null,
      actor: { type: 'system', uid: null, name: 'Script de test lot 3 (espèces)' },
      visibleToCustomer: true,
      message: `${driverName} prend en charge la commande.`,
      data: { driverId: TEST_DRIVER_UID, distanceMeters: null, round: 1 },
      at,
    });
  });
  console.log(`Commande ${placed.number} attribuée directement à ${TEST_DRIVER_UID} (driver.lot3-restaurant@golink.test).`);
  console.log('\nOuvrez/rafraîchissez l’app livreur : la course en cours doit apparaître, avec la carte du solde d’espèces (CashBalanceCard).');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
