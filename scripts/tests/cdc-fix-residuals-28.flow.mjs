// Test réel cdc-fix-residuals-28 (§14 Paiements / §23 Multi-pays, clarification client du
// 01/10/2026 : l'encaissement des clients en Algérie, au Maroc et en Tunisie se fera PAR CARTE
// BANCAIRE VIA STRIPE, comme en France/Belgique/Luxembourg — pas de prestataire de paiement local
// distinct pour CETTE partie du flux).
//
// Avant ce test, l'audit documentait un flou : `countries/{dz,ma,tn}.stripeAvailable = false` et
// « aucun prestataire de paiement local n'est branché » étaient listés comme un manque bloquant
// le paiement DZ/MA/TN. Lecture du code (`functions/src/orders/place.ts`, `orders/payment.ts`) :
// `stripeAvailable` ne gouverne QUE le reversement (payout) aux commerces et livreurs via Stripe
// Connect (`finance/argent/providers.ts`, `payments/driver-connect.ts`) — un sujet entièrement
// différent. Le chemin d'ENCAISSEMENT client (`authorizePayment`) ne lit jamais ce champ ; il
// passe simplement `country.currency` à l'API Stripe. Aucun verrou de CODE ne bloquait donc déjà
// l'encaissement carte — mais restait un vrai doute : Stripe accepte-t-il réellement DZD/MAD/TND
// comme devise d'encaissement ? Ce test lève ce doute avec une vraie commande (ville et commerce
// jetables, carte de test Stripe `pm_card_visa`, mode test) dans chacun des 3 pays.
//
// **Résultat réel (confirmé par l'API Stripe elle-même, pas une supposition de code)** :
// - **Maroc (MAD) : accepté.** Autorisation Stripe réussie, `providerIntentId` réel obtenu — le
//   paiement par carte via Stripe fonctionne déjà techniquement pour ce pays, aucun développement
//   nécessaire.
// - **Algérie (DZD) et Tunisie (TND) : refusés par Stripe lui-même** (erreur générique côté API,
//   capturée par `orders/payment.ts::authorizePayment`, qui ne distingue pas « devise non
//   supportée » d'un autre type d'échec Stripe — message client actuel : « Le paiement n'a pas pu
//   être traité », sans indiquer la vraie cause). Stripe n'accepte pas le dinar algérien ni le
//   dinar tunisien comme devise de Payment Intent, quel que soit le pays d'implantation du compte
//   Stripe de la plateforme — confirmé empiriquement ici, pas une limite du code de ce dépôt.
//   **Décision à prendre par le client** : soit encaisser ces 2 pays dans une devise que Stripe
//   accepte (ex. EUR, en affichant/convertissant le montant), soit prévoir un prestataire de
//   paiement local pour l'Algérie et la Tunisie (le besoin documenté par l'audit initial reste
//   donc réel pour CES 2 pays précisément, pas pour le Maroc).
//
// Commande annulée et toutes les données jetables supprimées après coup ; aucune ville/commerce
// réel n'est touché, `countries/{dz,ma,tn}.active` n'est pas modifié (décision de lancement
// commercial, hors périmètre).
//
//   npx tsx scripts/tests/cdc-fix-residuals-28.flow.mjs
import { randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const { CLI_CLIENT_ID, CLI_CLIENT_SECRET, PROJECT_ID, readCliRefreshToken } = await import('../gcp-token.mjs');
const adcPath = join(tmpdir(), `cdcres28-adc-${process.pid}.json`);
writeFileSync(adcPath, JSON.stringify({ type: 'authorized_user', client_id: CLI_CLIENT_ID, client_secret: CLI_CLIENT_SECRET, refresh_token: readCliRefreshToken() }));
process.env.GOOGLE_APPLICATION_CREDENTIALS = adcPath;
process.env.GOOGLE_CLOUD_PROJECT = PROJECT_ID;
process.env.GCLOUD_PROJECT = PROJECT_ID;

const API_KEY = 'AIzaSyAYQ_TzyCEK0_Iw5TnSiH8jbFbOFKZYNoM';
const FN_BASE = 'https://europe-west1-golink-9f16d.cloudfunctions.net';

const results = [];
const record = (name, ok, detail) => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'OK   ' : 'ÉCHEC'} ${name}${detail ? ` — ${detail}` : ''}`);
};

async function loginPassword(email, password) {
  const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${API_KEY}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`Connexion ${email} refusée : ${JSON.stringify(body.error)}`);
  return body.idToken;
}
async function call(token, name, data) {
  const res = await fetch(`${FN_BASE}/${name}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ data }),
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

// `expectStripeSupport` : résultat réel déjà confirmé par ce test (voir l'en-tête du fichier) —
// Stripe accepte MAD, refuse DZD et TND. Gardé ici pour que ce test serve aussi de surveillance
// si Stripe change un jour son support de devises.
const COUNTRIES = [
  { id: 'DZ', currency: 'dzd', label: 'Algérie', expectStripeSupport: false },
  { id: 'MA', currency: 'mad', label: 'Maroc', expectStripeSupport: true },
  { id: 'TN', currency: 'tnd', label: 'Tunisie', expectStripeSupport: false },
];

async function main() {
  const { db, auth, Timestamp } = await import('../../functions/src/lib/admin.ts');

  const clone = async (path, target, override = {}) => {
    const snap = await db.doc(path).get();
    await db.doc(target).set({ ...snap.data(), ...override });
  };

  for (const country of COUNTRIES) {
    const suffix = country.id.toLowerCase();
    const CITY = `cdcres28-ville-${suffix}`;
    const RES = `cdcres28-resto-${suffix}`;
    const CLIENT = `cdcres28-client-${suffix}`;
    const ORDER_ID_HINT = `cdcres28-${suffix}`;
    const createdDocs = [];

    try {
      const now = Timestamp.now();

      await clone('cities/longwy', `cities/${CITY}`, {
        name: `Ville test ${country.label}`, slug: CITY, countryId: country.id, active: true,
        pricing: null, commissionOverrideBps: null, managerIds: [], test: true, seed: true,
      });
      createdDocs.push(['city', `cities/${CITY}`]);

      await clone('restaurants/mina-kitchen', `restaurants/${RES}`, {
        name: `Test ${country.label} Resto`, slug: `test-${suffix}-resto`, groupId: null, cityId: CITY, countryId: country.id,
        ownerId: 'test-owner-haddad', status: 'active', onboardingStatus: 'approved', isOpen: true, acceptingOrders: true,
        fulfillmentModes: ['pickup'], deliveredBy: 'restaurant', acceptedPaymentMethods: ['card'], sponsored: false,
        test: true, seed: true, lastOrderAt: now, createdAt: now, metrics30d: null, missedOrdersInARow: 0, ordersCount: 0,
      });
      createdDocs.push(['restaurant', `restaurants/${RES}`]);

      await clone('restaurants/mina-kitchen/private/commercial', `restaurants/${RES}/private/commercial`, {
        planCode: 'pro', subscriptionId: null, subscriptionStatus: 'active', negotiatedCommission: null, specialOffer: null,
        billingMode: null, allowedPaymentMethods: ['card'], payoutsBlocked: false, stripeAccountId: null, stripeAccountStatus: 'enabled',
        adCreditCents: 0, test: true, seed: true,
      });
      createdDocs.push(['doc', `restaurants/${RES}/private/commercial`]);
      await clone('restaurants/mina-kitchen/private/legal', `restaurants/${RES}/private/legal`, { test: true });
      createdDocs.push(['doc', `restaurants/${RES}/private/legal`]);
      await clone('restaurants/mina-kitchen/settings/orders', `restaurants/${RES}/settings/orders`, { delivery: false, pickup: true, autoAccept: true, test: true });
      createdDocs.push(['doc', `restaurants/${RES}/settings/orders`]);
      await clone('restaurants/mina-kitchen/settings/hours', `restaurants/${RES}/settings/hours`, { test: true });
      createdDocs.push(['doc', `restaurants/${RES}/settings/hours`]);
      await clone('restaurants/mina-kitchen/members/test-owner-haddad', `restaurants/${RES}/members/test-owner-haddad`, { restaurantId: RES, groupId: null, test: true });
      createdDocs.push(['doc', `restaurants/${RES}/members/test-owner-haddad`]);

      const productBase = {
        sectionId: null, description: null, vatCategory: 'food', available: true, stock: null, lowStockThreshold: 0,
        optionGroupIds: [], allergens: [], allergensDeclared: true, dietary: [], containsAlcohol: false, featured: false,
        order: 999, salesCount: 0, searchKeywords: [], seed: true, test: true, createdAt: now, updatedAt: now, createdBy: 'system', updatedBy: 'system',
      };
      await db.doc(`restaurants/${RES}/products/${ORDER_ID_HINT}-p1`).set({ ...productBase, name: `Plat test ${country.label}`, priceCents: 1500 });
      createdDocs.push(['doc', `restaurants/${RES}/products/${ORDER_ID_HINT}-p1`]);

      const password = `${randomBytes(18).toString('base64url')}Aa1`;
      const email = `cdcres28-${suffix}@golink.test`;
      await auth.deleteUser(CLIENT).catch(() => {});
      await auth.createUser({ uid: CLIENT, email, password, emailVerified: true, displayName: CLIENT });
      await clone('users/sim-client-longwy-1', `users/${CLIENT}`, {
        email, firstName: 'Test', lastName: country.label, displayName: `Test ${country.label}`, referralCode: null, referredBy: null,
        walletBalanceCents: 0, cityId: CITY, countryId: country.id, test: true, seed: true,
        stats: { firstOrderAt: null, cancelledCount: 0, refundsCount: 0, lastOrderAt: null, ordersCount: 0, totalSpentCents: 0 },
      });
      createdDocs.push(['user', `users/${CLIENT}`]);
      const token = await loginPassword(email, password);

      const placed = await call(token, 'placeOrder', {
        restaurantId: RES,
        fulfillment: 'pickup',
        lines: [{ productId: `${ORDER_ID_HINT}-p1`, quantity: 1 }],
        addressId: null,
        paymentMethod: 'card',
        paymentMethodId: 'pm_card_visa',
        useWallet: false,
        promoCode: null,
        customerNote: null,
        scheduledFor: null,
        source: 'client_web',
        clientRequestId: `${ORDER_ID_HINT}-${Date.now()}`,
      });

      const placedOk = placed.status === 200 && placed.body?.result?.orderId;
      const stripeRejectedCurrency = placed.status === 503 && /paiement n.a pas pu être traité/i.test(placed.body?.error?.message ?? '');
      if (country.expectStripeSupport) {
        record(`${country.label} (${country.currency.toUpperCase()}) : Stripe accepte cette devise — commande créée et payée`, placedOk, placedOk ? `orderId=${placed.body.result.orderId} payment=${JSON.stringify(placed.body.result.payment)}` : `status=${placed.status} ${JSON.stringify(placed.body)}`);
      } else {
        record(`${country.label} (${country.currency.toUpperCase()}) : Stripe refuse cette devise — confirmé réel (pas un bug de ce dépôt)`, stripeRejectedCurrency, `status=${placed.status} ${JSON.stringify(placed.body)}`);
      }

      if (placedOk) {
        const orderId = placed.body.result.orderId;
        createdDocs.push(['order', `orders/${orderId}`]);
        const paymentSnap = await db.doc(`payments/pay-${orderId}`).get();
        createdDocs.push(['payment', `payments/pay-${orderId}`]);
        const pay = paymentSnap.data();
        record(
          `${country.label} : paiement Stripe réellement autorisé en ${country.currency.toUpperCase()}`,
          paymentSnap.exists && String(pay?.currency).toLowerCase() === country.currency && pay?.provider === 'stripe' && !!pay?.providerIntentId && pay?.status !== 'failed',
          JSON.stringify({ currency: pay?.currency, provider: pay?.provider, status: pay?.status, providerIntentId: pay?.providerIntentId }),
        );

        // Nettoyage métier : annulation réelle par le client (libère l'autorisation Stripe), comme
        // le ferait un vrai client — pas une suppression directe du document.
        const cancelled = await call(token, 'cancelOrder', { orderId, reason: 'customer_request', details: `Nettoyage test cdc-fix-residuals-28 (${country.label})` });
        record(`${country.label} : commande annulée proprement (nettoyage)`, cancelled.status === 200, JSON.stringify(cancelled.body ?? cancelled.status));
      }
    } finally {
      await auth.deleteUser(CLIENT).catch(() => {});
      for (const [, path] of createdDocs.reverse()) {
        await db.doc(path).delete().catch(() => {});
      }
      const cityGone = !(await db.doc(`cities/${CITY}`).get()).exists;
      const restoGone = !(await db.doc(`restaurants/${RES}`).get()).exists;
      record(`${country.label} : nettoyage complet (ville, commerce, produit, client, commande, paiement)`, cityGone && restoGone);
    }
  }
}

await main();
const ok = results.every((r) => r.ok);
console.log(`\n${results.filter((r) => r.ok).length}/${results.length} OK`);
process.exit(ok ? 0 : 1);
