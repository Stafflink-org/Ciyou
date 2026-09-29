/**
 * Prépare une course réelle de bout en bout pour tester apps/driver (lot 2) sans
 * réutiliser scripts/simulate/live-orders.ts (qui gère ses propres livreurs
 * simulés) : place une vraie commande en livraison (client.lot1@golink.test →
 * Mina Kitchen), la fait avancer côté restaurant (sofia.martin@golink.test :
 * acceptée → prête), puis demande un livreur Ciyou Eats (requestCourier). Le
 * livreur de test (driver.lot1@golink.test) doit être mis « en ligne » à la main
 * dans l'app avant d'exécuter ce script pour recevoir l'offre.
 *
 * Usage : node scripts/simulate-driver-lot2-order.mjs --apply
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { FieldValue, GeoPoint, Timestamp } from '@google-cloud/firestore';
import { auth, db, PROJECT_ID } from './lib/admin.mjs';

const TEST_DRIVER_UID = 'test-driver-lot1';

// node ne peut pas importer @golink/shared (source TypeScript) directement : valeur
// recopiée de packages/shared/src/index.ts (FIREBASE_REGION), jamais modifiée depuis.
const FIREBASE_REGION = 'europe-west1';

const apply = process.argv.includes('--apply');
const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const API_KEY = /apiKey:\s*'([^']+)'/.exec(readFileSync(`${repoRoot}/apps/client/src/lib/firebase.ts`, 'utf8'))?.[1] ?? '';

async function signIn(uid) {
  const user = await auth.getUser(uid);
  const email = user.email ?? '';
  const password = `${randomBytes(18).toString('base64url')}Aa1`;
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
  console.log(`Client ${clientUser.uid} · Manager ${managerUser.uid}`);

  // Adresse de livraison dans la zone « Centre et proximité » (2,5 km, gratuite dès 35 €).
  const addressRef = db.collection('users').doc(clientUser.uid).collection('addresses').doc('test-lot2-livraison');
  const address = {
    label: 'Test lot 2',
    line1: '5 rue du Casino',
    line2: null,
    postalCode: '54400',
    city: 'Longwy',
    countryCode: 'FR',
    geo: new GeoPoint(49.525, 5.765),
    geohash: null,
    placeId: null,
    details: null,
    instructions: 'Sonner à l’interphone « Test ».',
    floor: null,
    doorCode: null,
    isDefault: true,
    createdAt: Timestamp.now(),
    createdBy: clientUser.uid,
    updatedAt: Timestamp.now(),
    updatedBy: clientUser.uid,
  };
  console.log(`Adresse : ${address.line1}, ${address.city} (${apply ? 'écriture réelle' : 'aperçu'})`);
  if (apply) await addressRef.set(address, { merge: true });

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
  console.log('Commande acceptée (prépa 5 min).');
  await call('markOrderReady', managerToken, { orderId: placed.orderId });
  console.log('Commande prête.');

  // `settings/dispatch.mode === 'auto_assign'` (réglage plateforme réel, à ne pas modifier
  // pour ce test) : `requestCourier` attribue immédiatement le meilleur candidat parmi TOUS
  // les livreurs en ligne, jamais forcément notre compte de test (déjà vérifié : « Pedro R. »
  // a été pris sur un essai précédent). Pour tester spécifiquement l'app livreur avec
  // driver.lot1@golink.test sans changer ce réglage partagé, on reproduit ici exactement les
  // écritures d'attribution réelles (functions/src/orders/dispatch-advanced.ts,
  // assignDriverInTransaction) mais ciblées sur ce seul livreur.
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
      'delivery.driverVehicle': 'Vélo',
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
      actor: { type: 'system', uid: null, name: 'Script de test lot 2' },
      visibleToCustomer: true,
      message: `${driverName} prend en charge la commande.`,
      data: { driverId: TEST_DRIVER_UID, distanceMeters: null, round: 1 },
      at,
    });
  });
  console.log(`Commande ${placed.number} attribuée directement à ${TEST_DRIVER_UID} (driver.lot1@golink.test).`);
  console.log('\nOuvrez/rafraîchissez l’app livreur : la course en cours doit apparaître dans Dispatch.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
