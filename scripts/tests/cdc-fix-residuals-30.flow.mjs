// Test réel cdc-fix-residuals-30 (§19 client.md, « 10 bis » Moyens de paiement du profil) :
// jusqu'ici `apps/client/src/features/profile/PaymentMethodsScreen.tsx` ne faisait que lire
// `users/{uid}/paymentMethods` en lecture seule — aucune fonction serveur n'existait pour
// enregistrer une carte depuis le profil (seule la saisie de carte au moment de payer existait,
// voir `authorizePayment`, mais sans jamais créer de client Stripe réutilisable).
//
// Ajouté : `createSetupIntent` (functions/src/payments/cards.ts) prépare un `SetupIntent` Stripe
// sur le client Stripe du compte (créé au premier besoin) ; `savePaymentMethod` relit la carte
// confirmée côté Stripe et l'enregistre dans `users/{uid}/paymentMethods` (marque/4 derniers
// chiffres seulement, jamais le PAN).
//
// Test réel sur `golink-9f16d` : appel des deux fonctions DÉPLOYÉES via HTTP (comme le ferait
// l'app), confirmation du SetupIntent directement via l'API Stripe (carte de test `pm_card_visa`
// — la saisie Stripe Elements/CardField elle-même ne peut pas être scriptée, voir
// docs/_deps-demandees.md), puis vérification du document Firestore créé. Vérifie aussi le
// contrôle de propriété (un SetupIntent d'un autre client Stripe doit être refusé). Décor isolé
// (compte de test dédié), nettoyé à la fin (Firestore + client Stripe de test).
//
//   node scripts/tests/cdc-fix-residuals-30.flow.mjs
import { randomBytes } from 'node:crypto';
import { auth, db } from '../lib/admin.mjs';
import { getAccessToken, PROJECT_ID } from '../gcp-token.mjs';

const API_KEY = 'AIzaSyAYQ_TzyCEK0_Iw5TnSiH8jbFbOFKZYNoM';
const FN_BASE = 'https://europe-west1-golink-9f16d.cloudfunctions.net';

/** Lue depuis Secret Manager (session Firebase CLI locale) : `functions/.env.local.secrets` n'existe pas sur cette machine. */
async function readStripeSecretKey() {
  const token = await getAccessToken();
  const res = await fetch(`https://secretmanager.googleapis.com/v1/projects/${PROJECT_ID}/secrets/STRIPE_SECRET_KEY/versions/latest:access`, {
    headers: { authorization: `Bearer ${token}` },
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`Secret Manager STRIPE_SECRET_KEY : ${body.error?.message ?? res.status}`);
  return Buffer.from(body.payload.data, 'base64').toString('utf8').trim();
}
const STRIPE_SECRET_KEY = await readStripeSecretKey();

async function stripeApi(method, path, form) {
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    method,
    headers: {
      authorization: `Bearer ${STRIPE_SECRET_KEY}`,
      ...(form ? { 'content-type': 'application/x-www-form-urlencoded' } : {}),
    },
    body: form ? new URLSearchParams(form) : undefined,
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`Stripe ${method} ${path} : ${body.error?.message ?? res.status}`);
  return body;
}

const CLIENT = 'cdcres30-client';
const CLIENT_B = 'cdcres30-client-b';
const results = [];
const created = { authUsers: new Set(), stripeCustomers: new Set() };

function record(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'OK   ' : 'ÉCHEC'} ${name}${detail ? ` — ${detail}` : ''}`);
}
const check = (name, condition, detail) => record(name, Boolean(condition), detail);

const sessions = new Map();
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
  if (sessions.has(uid)) return sessions.get(uid);
  const password = `${randomBytes(18).toString('base64url')}Aa1`;
  try {
    await auth.getUser(uid);
    await auth.updateUser(uid, { password, email });
  } catch {
    await auth.createUser({ uid, email, password, emailVerified: true, displayName: uid });
  }
  created.authUsers.add(uid);
  const token = await loginPassword(email, password);
  sessions.set(uid, token);
  return token;
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
  error.status = body.error?.status ?? res.status;
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

/** auth.createUser() déclenche onUserCreate (profil users/{uid} "client" fantôme) : purgé en fin de test. */
async function cleanupUser(uid) {
  await db.doc(`users/${uid}`).delete().catch(() => {});
  await db.doc(`userPrivate/${uid}`).delete().catch(() => {});
  for (const method of (await db.collection(`users/${uid}/paymentMethods`).listDocuments())) await method.delete().catch(() => {});
}

async function main() {
  const tokenA = await testUserSession(CLIENT, 'cdcres30-client@golink.test');
  const tokenB = await testUserSession(CLIENT_B, 'cdcres30-client-b@golink.test');

  // --- Scénario principal : préparation, confirmation (carte de test), enregistrement réel ---
  const prepared = await call(tokenA, 'createSetupIntent', {});
  check('createSetupIntent.clientSecret_renvoye', typeof prepared?.clientSecret === 'string' && prepared.clientSecret.startsWith('seti_'), JSON.stringify(prepared));
  const setupIntentId = prepared.clientSecret.split('_secret_')[0];

  const privateAfterPrepare = (await db.doc(`userPrivate/${CLIENT}`).get()).data();
  check('createSetupIntent.cree_un_client_stripe_reutilisable', typeof privateAfterPrepare?.stripeCustomerId === 'string', JSON.stringify(privateAfterPrepare));
  if (privateAfterPrepare?.stripeCustomerId) created.stripeCustomers.add(privateAfterPrepare.stripeCustomerId);

  // Confirmation du SetupIntent avec une carte de test (CardField/CardElement ne sont pas
  // scriptables ici) : équivalent côté serveur de ce que fait `confirmCardSetup` côté app.
  const confirmed = await stripeApi('POST', `setup_intents/${setupIntentId}/confirm`, { payment_method: 'pm_card_visa' });
  check('stripe.setup_intent_confirme', confirmed.status === 'succeeded', `status=${confirmed.status}`);

  const saved = await call(tokenA, 'savePaymentMethod', { setupIntentId });
  check('savePaymentMethod.renvoie_id', typeof saved?.id === 'string', JSON.stringify(saved));

  const doc = (await db.doc(`users/${CLIENT}/paymentMethods/${saved?.id}`).get()).data();
  check('savePaymentMethod.carte_enregistree_visa', doc?.brand === 'visa', JSON.stringify(doc));
  check('savePaymentMethod.4_derniers_chiffres_seulement', doc?.last4 === '4242', `last4=${doc?.last4}`);
  check('savePaymentMethod.aucune_donnee_bancaire_complete', !('number' in (doc ?? {})) && !('cvc' in (doc ?? {})), JSON.stringify(doc));
  check('savePaymentMethod.premiere_carte_par_defaut', doc?.isDefault === true, `isDefault=${doc?.isDefault}`);

  // --- Non-régression : une deuxième carte du même client n'écrase pas isDefault de la première ---
  const prepared2 = await call(tokenA, 'createSetupIntent', {});
  const setupIntentId2 = prepared2.clientSecret.split('_secret_')[0];
  await stripeApi('POST', `setup_intents/${setupIntentId2}/confirm`, { payment_method: 'pm_card_mastercard' });
  const saved2 = await call(tokenA, 'savePaymentMethod', { setupIntentId: setupIntentId2 });
  const doc2 = (await db.doc(`users/${CLIENT}/paymentMethods/${saved2?.id}`).get()).data();
  check('savePaymentMethod.deuxieme_carte_pas_par_defaut', doc2?.isDefault === false, `isDefault=${doc2?.isDefault}`);
  check('savePaymentMethod.deuxieme_carte_mastercard', doc2?.brand === 'mastercard', JSON.stringify(doc2));

  // --- Sécurité : un client ne peut pas s'approprier le SetupIntent d'un autre client ---
  const preparedB = await call(tokenB, 'createSetupIntent', {});
  const setupIntentIdB = preparedB.clientSecret.split('_secret_')[0];
  await stripeApi('POST', `setup_intents/${setupIntentIdB}/confirm`, { payment_method: 'pm_card_visa' });
  const privateB = (await db.doc(`userPrivate/${CLIENT_B}`).get()).data();
  if (privateB?.stripeCustomerId) created.stripeCustomers.add(privateB.stripeCustomerId);
  await expectError('savePaymentMethod.refuse_setupintent_dun_autre_client', call(tokenA, 'savePaymentMethod', { setupIntentId: setupIntentIdB }));

  // --- Carte refusée à l'autorisation : non enregistrée ---
  const preparedDecline = await call(tokenA, 'createSetupIntent', {});
  const setupIntentIdDecline = preparedDecline.clientSecret.split('_secret_')[0];
  let declineConfirmFailed = false;
  try {
    await stripeApi('POST', `setup_intents/${setupIntentIdDecline}/confirm`, { payment_method: 'pm_card_chargeDeclinedInsufficientFunds' });
  } catch {
    declineConfirmFailed = true;
  }
  check('stripe.carte_refusee_bloquee_a_la_confirmation', declineConfirmFailed);
}

async function cleanup() {
  await cleanupUser(CLIENT);
  await cleanupUser(CLIENT_B);
  for (const uid of created.authUsers) await auth.deleteUser(uid).catch(() => {});
  for (const customerId of created.stripeCustomers) await stripeApi('DELETE', `customers/${customerId}`).catch(() => {});
}

main()
  .catch((error) => {
    record('exception', false, String(error.stack ?? error));
  })
  .finally(async () => {
    if (!process.env.NO_CLEANUP) await cleanup();
    const failed = results.filter((r) => !r.ok);
    console.log(`\n${results.length - failed.length}/${results.length} OK`);
    if (failed.length) {
      console.log('Échecs :');
      for (const f of failed) console.log(` - ${f.name} : ${f.detail}`);
      process.exitCode = 1;
    }
  });
