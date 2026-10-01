// Test réel cdc-fix-residuals-26 (§19 Fidélité et parrainage, « Programme de fidélité » —
// dépense des avoirs) : l'app client n'appelait jamais `placeOrder` avec `useWallet`, alors que
// le serveur sait déjà régler tout ou partie d'une commande avec le solde d'avoirs Ciyou Eats du
// client (`functions/src/orders/place.ts`). En câblant ce bouton côté client, un VRAI bogue de
// sécurité préexistant a été découvert : `paymentMethod` acceptait n'importe quelle valeur de
// `PAYMENT_METHODS`, y compris `'wallet'` — or `wallet` n'est censé être qu'une désignation
// CALCULÉE côté serveur (`walletAppliedCents > 0 && chargedCents === 0 ? 'wallet' : ...`), jamais
// un choix du client. En envoyant directement `paymentMethod: 'wallet'` SANS `useWallet: true`
// (ou avec un solde insuffisant), `walletAppliedCents` valait 0, `chargedCents` valait le montant
// total de la commande, mais `method` tombait quand même sur `data.paymentMethod` = `'wallet'` —
// la branche entière d'autorisation de paiement (`if (method !== 'wallet') { ... }`) était alors
// SAUTÉE : une commande complète pouvait être créée, confirmée et préparée sans qu'aucun paiement
// réel ni aucune déduction d'avoirs n'ait eu lieu. Un vecteur de fraude financière réel.
//
// Corrigé : `paymentMethod` (champ d'entrée du client) exclut désormais `'wallet'` au niveau du
// schéma (`CLIENT_PAYMENT_METHODS`) — `wallet` ne peut plus être qu'un résultat CALCULÉ par le
// serveur à partir du solde réel (`profile.walletBalanceCents`, lu en base, jamais fourni par le
// client), jamais une valeur d'entrée acceptée.
//
// Ce test vérifie UNIQUEMENT la fermeture de cette faille (rejet de `paymentMethod: 'wallet'` en
// entrée, par la validation zod du schéma — avant même la moindre lecture de restaurant/produit).
// Le flux légitime (`useWallet: true` + `paymentMethod: 'card'`, couverture totale ou partielle)
// est déjà couvert et reconfirmé sans régression par le scénario `wallet` existant de
// `scripts/tests/cdc-fix-c.flow.mjs` (12/12 OK, rejoué contre cette fonction après déploiement).
//
//   npx tsx scripts/tests/cdc-fix-residuals-26.flow.mjs
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const { CLI_CLIENT_ID, CLI_CLIENT_SECRET, PROJECT_ID, readCliRefreshToken } = await import('../gcp-token.mjs');
const adcPath = join(tmpdir(), `cdcres26-adc-${process.pid}.json`);
writeFileSync(adcPath, JSON.stringify({ type: 'authorized_user', client_id: CLI_CLIENT_ID, client_secret: CLI_CLIENT_SECRET, refresh_token: readCliRefreshToken() }));
process.env.GOOGLE_APPLICATION_CREDENTIALS = adcPath;
process.env.GOOGLE_CLOUD_PROJECT = PROJECT_ID;
process.env.GCLOUD_PROJECT = PROJECT_ID;

const results = [];
const record = (name, ok, detail) => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'OK   ' : 'ÉCHEC'} ${name}${detail ? ` — ${detail}` : ''}`);
};

async function main() {
  const { placeOrder } = await import('../../functions/src/orders/place.ts');

  // Chemin d'exploitation : paymentMethod envoyé directement à 'wallet', sans useWallet, sans
  // solde réel. Le reste de l'entrée est syntaxiquement valide (mais le restaurant/produit n'ont
  // pas besoin d'exister réellement : la validation zod du schéma s'exécute AVANT toute lecture
  // Firestore — si le rejet se produit, c'est la preuve qu'il vient bien du schéma, pas d'autre
  // chose comme un restaurant introuvable).
  const exploitInput = {
    restaurantId: 'cdcres26-nonexistent-restaurant',
    fulfillment: 'pickup',
    lines: [{ productId: 'cdcres26-nonexistent-product', quantity: 1 }],
    paymentMethod: 'wallet',
    paymentMethodId: null,
    useWallet: false,
    promoCode: null,
    customerNote: null,
    scheduledFor: null,
    clientRequestId: 'cdcres26-exploit-attempt-000001',
  };

  try {
    await placeOrder.run({ data: exploitInput, auth: { uid: 'cdcres26-test-client', token: {} } });
    record('paymentMethod: "wallet" envoyé directement par le client REFUSÉ — correctif attendu', false, 'accepté à tort : commande potentiellement créée sans paiement ni déduction d’avoirs');
  } catch (error) {
    const isSchemaRejection =
      error?.code === 'invalid-argument' &&
      (String(error?.message ?? '').includes('paymentMethod') || (Array.isArray(error?.details?.issues) && error.details.issues.some((i) => i.field === 'paymentMethod')));
    record(
      'paymentMethod: "wallet" envoyé directement par le client REFUSÉ — correctif attendu',
      isSchemaRejection,
      `code=${error?.code} message=${error?.message}`,
    );
  }

  // Non-régression : un moyen de paiement légitime (carte) avec useWallet non demandé continue de
  // passer la validation du schéma (l'échec attendu ensuite, restaurant introuvable, prouve qu'on
  // a bien dépassé l'étape de validation du schéma — donc que rien de légitime n'a été cassé).
  const legitInput = { ...exploitInput, paymentMethod: 'card', clientRequestId: 'cdcres26-legit-attempt-000001' };
  try {
    await placeOrder.run({ data: legitInput, auth: { uid: 'cdcres26-test-client', token: {} } });
    record('non-régression : paymentMethod "card" passe toujours la validation du schéma', false, 'commande inattendue acceptée avec un restaurant inexistant');
  } catch (error) {
    const passedSchema = error?.code === 'not-found' || /restaurant/i.test(String(error?.message ?? ''));
    record('non-régression : paymentMethod "card" passe toujours la validation du schéma (échoue ensuite sur le restaurant inexistant, pas sur le schéma)', passedSchema, `code=${error?.code} message=${error?.message}`);
  }
}

await main();
const ok = results.every((r) => r.ok);
console.log(`\n${results.filter((r) => r.ok).length}/${results.length} OK`);
process.exit(ok ? 0 : 1);
