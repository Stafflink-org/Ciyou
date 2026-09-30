// Test réel cdc-fix-residuals-11 (§19 Fidélité) : redeemLoyaltyPoints (functions/src/marketing/platform/loyalty.ts)
//  - Ajout du support d'un compte scope:'restaurant' (paramètre restaurantId), manquant jusque-là
//    (seul le compte plateforme était géré).
//  - Bug de contamination croisée corrigé : la requête de consommation des lots de points filtrait
//    par `userId` (partagé entre le compte plateforme et tous les comptes restaurant d'un même
//    client) au lieu de `accountId` — un échange sur un scope pouvait consommer silencieusement les
//    lots de points d'un AUTRE scope du même client.
//
// Appelle directement le handler de la fonction callable déployée via `.run()` (bypass HTTP,
// même identifiants ADC/session CLI que les autres scripts de ce repo), avec des données de test
// jetables sur un compte client réel existant (pour que `users/{uid}` soit un profil valide).
//
//   npx tsx scripts/tests/cdc-fix-residuals-11.flow.mjs
import { writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const { CLI_CLIENT_ID, CLI_CLIENT_SECRET, PROJECT_ID, readCliRefreshToken } = await import('../gcp-token.mjs');
const adcPath = join(tmpdir(), `cdcres11-adc-${process.pid}.json`);
writeFileSync(adcPath, JSON.stringify({ type: 'authorized_user', client_id: CLI_CLIENT_ID, client_secret: CLI_CLIENT_SECRET, refresh_token: readCliRefreshToken() }));
process.env.GOOGLE_APPLICATION_CREDENTIALS = adcPath;
process.env.GOOGLE_CLOUD_PROJECT = PROJECT_ID;
process.env.GCLOUD_PROJECT = PROJECT_ID;

const results = [];
const record = (name, ok, detail) => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'OK   ' : 'ÉCHEC'} ${name}${detail ? ` — ${detail}` : ''}`);
};

const UID = 'JpbbCEhHZIX8Jk5wOx5WyOUW6292'; // client.mobilerecompte@golink.test, compte réel existant
const RESTAURANT_ID = 'mina-kitchen';
const PLATFORM_ACCOUNT = UID;
const RESTAURANT_ACCOUNT = `${UID}_${RESTAURANT_ID}`;

async function main() {
  const { db, Timestamp } = await import('../../functions/src/lib/admin.ts');
  const { redeemLoyaltyPoints } = await import('../../functions/src/marketing/platform/loyalty.ts');

  const userRef = db.collection('users').doc(UID);
  const originalWallet = (await userRef.get()).get('walletBalanceCents') ?? 0;
  const createdDocIds = [];

  try {
    const now = Timestamp.now();
    await db.collection('loyaltyAccounts').doc(PLATFORM_ACCOUNT).set({
      userId: UID, scope: 'platform', restaurantId: null, points: 50, lifetimePoints: 50, tier: null, updatedAt: now, test: true,
    });
    await db.collection('loyaltyTransactions').doc('cdcres11-earn-platform').set({
      accountId: PLATFORM_ACCOUNT, userId: UID, restaurantId: null, type: 'earn', points: 50, remaining: 50, orderId: null, valueCents: null, createdAt: now, createdBy: 'system', test: true,
    });
    createdDocIds.push(['loyaltyTransactions', 'cdcres11-earn-platform']);

    await db.collection('loyaltyAccounts').doc(RESTAURANT_ACCOUNT).set({
      userId: UID, scope: 'restaurant', restaurantId: RESTAURANT_ID, points: 100, lifetimePoints: 100, tier: null, updatedAt: now, test: true,
    });
    await db.collection('loyaltyTransactions').doc('cdcres11-earn-restaurant').set({
      accountId: RESTAURANT_ACCOUNT, userId: UID, restaurantId: RESTAURANT_ID, type: 'earn', points: 100, remaining: 100, orderId: null, valueCents: null, createdAt: now, createdBy: 'system', test: true,
    });
    createdDocIds.push(['loyaltyTransactions', 'cdcres11-earn-restaurant']);

    const request = (data) => ({ data, auth: { uid: UID, token: {} } });

    // --- Cas d'erreur : palier inexistant pour ce commerce ---
    let badErr = null;
    try {
      await redeemLoyaltyPoints.run(request({ points: 999, restaurantId: RESTAURANT_ID }));
    } catch (e) {
      badErr = e;
    }
    record('palier inexistant côté restaurant rejeté', Boolean(badErr), badErr ? String(badErr.message || badErr) : 'aucune erreur levée');

    // --- Cas réel : échange de 100 points du programme mina-kitchen (palier 100 -> 500 centimes) ---
    const result = await redeemLoyaltyPoints.run(request({ points: 100, restaurantId: RESTAURANT_ID }));
    record('échange restaurant accepté, valeur = 500 centimes', result.valueCents === 500, JSON.stringify(result));

    const [platAfter, restAfter, platTxAfter, restTxAfter, userAfter] = await Promise.all([
      db.collection('loyaltyAccounts').doc(PLATFORM_ACCOUNT).get(),
      db.collection('loyaltyAccounts').doc(RESTAURANT_ACCOUNT).get(),
      db.collection('loyaltyTransactions').doc('cdcres11-earn-platform').get(),
      db.collection('loyaltyTransactions').doc('cdcres11-earn-restaurant').get(),
      userRef.get(),
    ]);

    record('compte plateforme INTACT après échange restaurant (anti-contamination, points=50)', platAfter.get('points') === 50, `points=${platAfter.get('points')}`);
    record('lot plateforme INTACT (remaining=50, preuve anti-contamination sur le filtre accountId)', platTxAfter.get('remaining') === 50, `remaining=${platTxAfter.get('remaining')}`);
    record('compte restaurant correctement débité (points=0)', restAfter.get('points') === 0, `points=${restAfter.get('points')}`);
    record('lot restaurant correctement consommé (remaining=0)', restTxAfter.get('remaining') === 0, `remaining=${restTxAfter.get('remaining')}`);
    record('portefeuille crédité de 500 centimes', userAfter.get('walletBalanceCents') === originalWallet + 500, `avant=${originalWallet} après=${userAfter.get('walletBalanceCents')}`);

    const redeemQuery = await db.collection('loyaltyTransactions').where('accountId', '==', RESTAURANT_ACCOUNT).where('type', '==', 'redeem').get();
    redeemQuery.docs.forEach((d) => createdDocIds.push(['loyaltyTransactions', d.id]));
    record('transaction redeem écrite avec accountId = compte restaurant (pas le compte plateforme)', redeemQuery.size === 1, `trouvées=${redeemQuery.size}`);

    const ledgerCost = await db.collection('ledgerEntries').where('accountType', '==', 'restaurant').where('accountId', '==', RESTAURANT_ID).where('type', '==', 'wallet_credit').where('amountCents', '==', -500).get();
    ledgerCost.docs.forEach((d) => createdDocIds.push(['ledgerEntries', d.id]));
    record('coût du programme imputé au commerce (ledgerEntries accountType=restaurant), pas à la plateforme', ledgerCost.size === 1, `trouvées=${ledgerCost.size}`);

    const walletTxQuery = await db.collection('walletTransactions').where('userId', '==', UID).where('note', '==', 'Échange de 100 points').get();
    walletTxQuery.docs.forEach((d) => createdDocIds.push(['walletTransactions', d.id]));

    const creditLedger = await db.collection('ledgerEntries').where('accountType', '==', 'customer_wallet').where('accountId', '==', UID).where('amountCents', '==', 500).get();
    creditLedger.docs.forEach((d) => createdDocIds.push(['ledgerEntries', d.id]));
  } finally {
    for (const [col, id] of createdDocIds) {
      await db.collection(col).doc(id).delete().catch(() => {});
    }
    await db.collection('loyaltyAccounts').doc(PLATFORM_ACCOUNT).delete().catch(() => {});
    await db.collection('loyaltyAccounts').doc(RESTAURANT_ACCOUNT).delete().catch(() => {});
    await userRef.set({ walletBalanceCents: originalWallet }, { merge: true });
    const finalWallet = (await userRef.get()).get('walletBalanceCents');
    record('nettoyage complet : wallet restauré, données de test supprimées', finalWallet === originalWallet, `wallet final=${finalWallet}`);
  }
}

try {
  await main();
} finally {
  try {
    rmSync(adcPath, { force: true });
  } catch {}
}

const ok = results.every((r) => r.ok);
console.log(`\n${results.filter((r) => r.ok).length}/${results.length} OK`);
process.exit(ok ? 0 : 1);
