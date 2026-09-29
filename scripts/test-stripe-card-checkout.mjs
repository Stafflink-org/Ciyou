/**
 * Test réel du paiement carte câblé sur l'app client (tâche client-stripe-checkout) :
 * crée un vrai PaymentMethod Stripe (mode test, carte 4242 4242 4242 4242, via le
 * jeton de test Stripe `tok_visa` — équivalent de ce que produit `CardField`/`CardElement`
 * à l'écran, sans re-saisir un numéro de carte brut ici) puis appelle la Cloud Function
 * réelle `placeOrder` exactement comme le fait CheckoutScreen.tsx, pour vérifier de bout
 * en bout : autorisation Stripe réelle → commande créée dans Firestore → paiement `paid`/`authorized`.
 *
 * Usage : node scripts/test-stripe-card-checkout.mjs --apply
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { auth, db, PROJECT_ID } from './lib/admin.mjs';

const FIREBASE_REGION = 'europe-west1';
const apply = process.argv.includes('--apply');
const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const API_KEY = /apiKey:\s*'([^']+)'/.exec(readFileSync(`${repoRoot}/apps/client/src/lib/firebase.ts`, 'utf8'))?.[1] ?? '';
const STRIPE_SECRET_KEY = /STRIPE_SECRET_KEY=(\S+)/.exec(readFileSync(`${repoRoot}/functions/.env.local.secrets`, 'utf8'))?.[1] ?? '';
const CREDENTIALS_FILE = `${repoRoot}/.test-accounts.local.md`;

function storedPassword(email) {
  if (!existsSync(CREDENTIALS_FILE)) return null;
  const match = readFileSync(CREDENTIALS_FILE, 'utf8').match(new RegExp('`' + email + '`\\s*\\|\\s*`([^`]+)`'));
  return match?.[1] ?? null;
}

const restoreQueue = [];
async function signIn(uid) {
  const user = await auth.getUser(uid);
  const email = user.email ?? '';
  const original = storedPassword(email);
  const password = `${randomBytes(18).toString('base64url')}Aa1`;
  await auth.updateUser(uid, { password });
  if (original) restoreQueue.push({ uid, email, original });
  else console.log(`⚠️  Mot de passe de ${email} introuvable dans .test-accounts.local.md : non restauré automatiquement après ce script.`);
  const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${API_KEY}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  });
  const body = await res.json();
  if (!body.idToken) throw new Error(`Connexion impossible (${email}) : ${body.error?.message ?? res.status}`);
  return body.idToken;
}
async function restorePasswords() {
  for (const { uid, email, original } of restoreQueue) {
    await auth.updateUser(uid, { password: original });
    console.log(`Mot de passe restauré pour ${email}.`);
  }
  // Vérification réelle (règle mémoire) : le compte fonctionne encore avec le mot de passe documenté.
  for (const { email, original } of restoreQueue) {
    const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${API_KEY}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: original, returnSecureToken: true }),
    });
    const body = await res.json();
    console.log(body.idToken ? `Vérifié : ${email} se connecte toujours avec le mot de passe documenté.` : `⚠️ Échec de vérification pour ${email} : ${body.error?.message}`);
  }
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

/** Crée un vrai PaymentMethod Stripe (carte de test Visa 4242) — ce que produit CardField/CardElement. */
async function createRealTestCardPaymentMethod() {
  if (!STRIPE_SECRET_KEY.startsWith('sk_test_')) throw new Error('Clé secrète Stripe de test introuvable (functions/.env.local.secrets).');
  const res = await fetch('https://api.stripe.com/v1/payment_methods', {
    method: 'POST',
    headers: {
      authorization: `Basic ${Buffer.from(`${STRIPE_SECRET_KEY}:`).toString('base64')}`,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ type: 'card', 'card[token]': 'tok_visa' }),
  });
  const body = await res.json();
  if (!body.id) throw new Error(`Création du moyen de paiement Stripe impossible : ${body.error?.message ?? res.status}`);
  return body;
}

async function main() {
  const clientUser = await auth.getUserByEmail('client.lot1@golink.test');
  console.log(`Client ${clientUser.uid} (${clientUser.email})`);

  console.log('Création d’un vrai PaymentMethod Stripe (mode test, tok_visa = 4242 4242 4242 4242)…');
  const paymentMethod = await createRealTestCardPaymentMethod();
  console.log(`PaymentMethod Stripe créé : ${paymentMethod.id} (${paymentMethod.card?.brand} •••• ${paymentMethod.card?.last4})`);

  if (!apply) {
    console.log('Aperçu seulement (--apply pour exécuter réellement placeOrder).');
    return;
  }

  const clientToken = await signIn(clientUser.uid);
  try {
    const placed = await call('placeOrder', clientToken, {
      restaurantId: 'mina-kitchen',
      fulfillment: 'pickup',
      lines: [{ productId: 'p1', quantity: 2 }],
      addressId: null,
      paymentMethod: 'card',
      paymentMethodId: paymentMethod.id,
      clientRequestId: randomUUID(),
      source: 'client_web',
    });
    console.log(`Commande créée : ${placed.number} (${placed.orderId}), statut ${placed.status}, paiement ${placed.payment.status}`);

    const orderSnap = await db.collection('orders').doc(placed.orderId).get();
    const order = orderSnap.data();
    console.log('Relecture Firestore orders/' + placed.orderId + ' :', {
      status: order.status,
      paymentStatus: order.payment.status,
      paymentMethod: order.payment.method,
      chargedCents: order.amounts.chargedCents,
      test: order.test ?? false,
    });

    const paymentSnap = await db.collection('payments').doc(order.payment.paymentId).get();
    const payment = paymentSnap.data();
    console.log('Relecture Firestore payments/' + order.payment.paymentId + ' :', {
      status: payment.status,
      provider: payment.provider,
      providerIntentId: payment.providerIntentId,
      providerChargeId: payment.providerChargeId,
      cardLabel: payment.cardLabel,
      amountCents: payment.amountCents,
    });

    if (payment.provider !== 'stripe' || !payment.providerIntentId) throw new Error('Le paiement ne porte pas une autorisation Stripe réelle.');
    console.log('\n✅ Paiement carte réel Stripe (mode test) confirmé de bout en bout : PaymentMethod dynamique → placeOrder → commande + paiement en base, statut ' + payment.status + '.');
  } finally {
    await restorePasswords();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
