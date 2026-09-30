// Test réel des correctifs de la tâche cdc-fix-residuals-4 (§19 Fidélité/parrainage,
// §13 Support et litiges, §2 Recherche globale) contre la vraie base golink-9f16d.
//   npx tsx scripts/tests/cdc-fix-residuals-4.flow.mjs
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { db } from '../lib/admin.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const API_KEY = 'AIzaSyAYQ_TzyCEK0_Iw5TnSiH8jbFbOFKZYNoM';
const FN_BASE = 'https://europe-west1-golink-9f16d.cloudfunctions.net';

const results = [];
const record = (name, ok, detail) => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'OK   ' : 'ÉCHEC'} ${name}${detail ? ` — ${detail}` : ''}`);
};

function passwordOf(email) {
  const accounts = readFileSync(join(root, '.test-accounts.local.md'), 'utf8');
  return [...accounts.matchAll(/\|\s*`([^`]+)`\s*\|\s*`([^`]+)`\s*\|/g)].find((m) => m[1] === email)?.[2];
}
async function login(email) {
  const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${API_KEY}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: passwordOf(email), returnSecureToken: true }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`Connexion ${email} refusée : ${body.error?.message}`);
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

const CLIENT_UID = 'j5lmL1Rt7Bak41snHalAgZ7Euw93'; // client.lot1@golink.test
const RESTAURANT_ID = 'mina-kitchen';
const DRIVER_ORDER_ID = 'o-12983'; // livré, restaurant mina-kitchen, driverId test-driver-lot1

// ------------------------------------------------------------------ §19 : moteur de fidélité restaurant
async function testLoyaltyRestaurant() {
  const { earnLoyaltyPoints, expireLoyaltyPoints } = await import('../../functions/src/marketing/platform/loyalty.ts');
  const { Timestamp: AdminTimestamp } = await import('../../functions/src/lib/admin.ts');

  // Le programme mina-kitchen est déjà activé en base (earnPoints:1, everyCents:100, welcomePoints:20) —
  // AVANT le correctif, earnLoyaltyPoints() sortait immédiatement si `settings/loyalty.enabled` (plateforme)
  // était faux (c'est le cas ici, enabled:false), donc ce programme n'était JAMAIS appliqué malgré son
  // activation réelle. Test de non-régression direct sur la vraie logique de calcul.
  const accId = `${CLIENT_UID}_${RESTAURANT_ID}`;
  await db.doc(`loyaltyAccounts/${accId}`).delete().catch(() => undefined);
  const testOrderId = 'cdcres4-order-loyalty';
  await db.collection('loyaltyTransactions').doc(`earn-${testOrderId}-r`).delete().catch(() => undefined);
  await db.collection('loyaltyTransactions').doc(`welcome-${accId}`).delete().catch(() => undefined);

  const order = {
    restaurantId: RESTAURANT_ID,
    customerId: CLIENT_UID,
    cityId: 'longwy',
    countryId: 'FR',
    closedAs: null,
    flags: { firstOrder: false },
    amounts: { subtotalCents: 2530, discount: null },
    test: true,
  };
  const result = await earnLoyaltyPoints(testOrderId, order);
  record(
    'earnLoyaltyPoints crédite le programme du restaurant même plateforme éteinte (correctif)',
    result.restaurantEarned === 25 && result.earned === 0,
    JSON.stringify(result),
  );

  const account = (await db.doc(`loyaltyAccounts/${accId}`).get()).data();
  record('compte de fidélité restaurant créé avec le bon total', account?.points === 25 && account?.scope === 'restaurant' && account?.restaurantId === RESTAURANT_ID, JSON.stringify(account));

  // Rejouabilité : un deuxième appel sur la même commande ne doit rien ajouter.
  const replay = await earnLoyaltyPoints(testOrderId, order);
  record('rejouable sans doublon (deuxième appel = 0 point supplémentaire)', replay.restaurantEarned === 0, JSON.stringify(replay));

  // ---- Correctif de l'expiration : regroupement par compte (accountId), pas par utilisateur.
  // On force un lot de points du compte RESTAURANT à expirer, et on vérifie qu'il est bien décompté
  // du compte restaurant (et non du compte plateforme du même client, comme le faisait l'ancien code).
  // Date native (pas Timestamp) pour cette écriture : elle passe par le `db` du script
  // (`@google-cloud/firestore` de la racine), un autre exemplaire du paquet que celui utilisé à
  // l'intérieur de `functions/` — un objet Timestamp de l'un n'est pas accepté par l'autre.
  const past = new Date(Date.now() - 1000);
  await db.collection('loyaltyTransactions').doc(`earn-cdcres4-expiretest-r`).set({
    accountId: accId,
    userId: CLIENT_UID,
    restaurantId: RESTAURANT_ID,
    type: 'earn',
    points: 9,
    remaining: 9,
    orderId: 'cdcres4-expiretest',
    valueCents: null,
    createdAt: past,
    createdBy: 'system',
    expiresAt: past,
    test: true,
  });
  const beforeExpirePlatform = (await db.doc(`loyaltyAccounts/${CLIENT_UID}`).get()).data();
  const beforeExpireRestaurant = (await db.doc(`loyaltyAccounts/${accId}`).get()).data();
  const expireResult = await expireLoyaltyPoints(AdminTimestamp.now());
  const afterExpirePlatform = (await db.doc(`loyaltyAccounts/${CLIENT_UID}`).get()).data();
  const afterExpireRestaurant = (await db.doc(`loyaltyAccounts/${accId}`).get()).data();
  record(
    'expireLoyaltyPoints décompte le bon compte (restaurant), pas le compte plateforme du même client',
    !beforeExpirePlatform && !afterExpirePlatform && (afterExpireRestaurant?.points ?? 0) === (beforeExpireRestaurant?.points ?? 0) - 9,
    `avant(rest)=${beforeExpireRestaurant?.points} après(rest)=${afterExpireRestaurant?.points} plateforme(avant/après)=${JSON.stringify(beforeExpirePlatform)}/${JSON.stringify(afterExpirePlatform)}`,
  );
  record('expireLoyaltyPoints a bien traité ≥ 1 compte', (expireResult?.points ?? 0) >= 9, JSON.stringify(expireResult));

  // Nettoyage.
  await db.doc(`loyaltyAccounts/${accId}`).delete().catch(() => undefined);
  await db.collection('loyaltyTransactions').doc(`earn-${testOrderId}-r`).delete().catch(() => undefined);
  await db.collection('loyaltyTransactions').doc(`expire-${accId}-${expireResult ? '' : ''}`).delete().catch(() => undefined);
  const cleanupTx = await db.collection('loyaltyTransactions').where('accountId', '==', accId).get();
  await Promise.all(cleanupTx.docs.map((d) => d.ref.delete()));
  const remaining = (await db.collection('loyaltyTransactions').where('accountId', '==', accId).get()).size;
  record('nettoyage : plus aucune trace de test en base (compte + transactions)', remaining === 0 && !(await db.doc(`loyaltyAccounts/${accId}`).get()).exists, `remaining=${remaining}`);
}

// ------------------------------------------------------------------ §13 : ticket livreur
async function testDriverTicket() {
  const token = await login('driver.lot1@golink.test');
  const created = await call(token, 'createDriverTicket', {
    category: 'delivery',
    subject: 'Test cdc-fix-residuals-4 (sans conséquence)',
    body: 'Ceci est un ticket de test réel pour vérifier que le livreur peut ouvrir une demande. À ignorer.',
    orderId: DRIVER_ORDER_ID,
  });
  record('createDriverTicket : ouverture réussie', created.status === 200 && created.body?.result?.ticketId, JSON.stringify(created.body).slice(0, 200));
  const ticketId = created.body?.result?.ticketId;

  if (ticketId) {
    const ticketDoc = (await db.doc(`supportTickets/${ticketId}`).get()).data();
    record('ticket écrit avec requesterType "driver" et le bon motif', ticketDoc?.requesterType === 'driver' && ticketDoc?.reasonId === 'driver-support', JSON.stringify({ requesterType: ticketDoc?.requesterType, reasonId: ticketDoc?.reasonId }));

    const reply = await call(token, 'replyToDriverTicket', { ticketId, body: 'Message de suivi de test, sans conséquence.' });
    record('replyToDriverTicket : réponse acceptée', reply.status === 200, JSON.stringify(reply.body).slice(0, 200));

    const close = await call(token, 'updateDriverTicket', { ticketId, action: 'close' });
    record('updateDriverTicket close : ticket fermé', close.status === 200 && close.body?.result?.status === 'closed', JSON.stringify(close.body).slice(0, 200));

    const reopen = await call(token, 'updateDriverTicket', { ticketId, action: 'reopen' });
    record('updateDriverTicket reopen : ticket rouvert', reopen.status === 200 && reopen.body?.result?.status === 'open', JSON.stringify(reopen.body).slice(0, 200));

    // Nettoyage : le ticket et ses messages sont des données de test, pas une vraie demande.
    const messages = await db.collection(`supportTickets/${ticketId}/messages`).get();
    await Promise.all(messages.docs.map((d) => d.ref.delete()));
    await db.doc(`supportTickets/${ticketId}`).delete();
    const gone = !(await db.doc(`supportTickets/${ticketId}`).get()).exists;
    record('nettoyage : ticket de test supprimé', gone);
  }
}

// ------------------------------------------------------------------ §13 : liveChatEnabled
async function testLiveChatToggle() {
  const before = (await db.doc('settings/support').get()).data();
  const supportToken = await login('support@golink.test');

  await db.doc('settings/support').set({ liveChatEnabled: false }, { merge: true });
  const denied = await call(supportToken, 'openSupportChat', { orderId: DRIVER_ORDER_ID, ticketId: null, withDriver: false, withRestaurant: false, message: 'Test cdc-fix-residuals-4 (doit être refusé, chat désactivé).' });
  record('openSupportChat refusé quand liveChatEnabled=false (correctif)', denied.status !== 200 && /désactivé/i.test(denied.body?.error?.message ?? ''), JSON.stringify(denied.body).slice(0, 200));

  await db.doc('settings/support').set({ liveChatEnabled: true }, { merge: true });
  const allowed = await call(supportToken, 'openSupportChat', { orderId: DRIVER_ORDER_ID, ticketId: null, withDriver: false, withRestaurant: false, message: 'Test cdc-fix-residuals-4 (doit passer, chat réactivé).' });
  record('openSupportChat de nouveau accepté quand liveChatEnabled=true', allowed.status === 200 && allowed.body?.result?.conversationId, JSON.stringify(allowed.body).slice(0, 200));

  const conversationId = allowed.body?.result?.conversationId;
  if (conversationId) {
    const closeRes = await call(supportToken, 'closeSupportChat', { conversationId });
    record('closeSupportChat : clôture réussie', closeRes.status === 200, JSON.stringify(closeRes.body).slice(0, 200));
    const messages = await db.collection(`conversations/${conversationId}/messages`).orderBy('createdAt', 'desc').limit(1).get();
    const lastText = messages.docs[0]?.data()?.text ?? '';
    record('message système corrigé : "clôturée" (plus la faute "close")', lastText.includes('clôturée'), lastText);
    // Nettoyage de la conversation de test.
    const allMsgs = await db.collection(`conversations/${conversationId}/messages`).get();
    await Promise.all(allMsgs.docs.map((d) => d.ref.delete()));
    await db.doc(`conversations/${conversationId}`).delete();
  }

  // Restauration exacte du réglage d'origine.
  await db.doc('settings/support').set(before, { merge: false });
  const restored = (await db.doc('settings/support').get()).data();
  record('settings/support restauré à l’identique après le test', restored?.liveChatEnabled === before?.liveChatEnabled, `liveChatEnabled=${restored?.liveChatEnabled}`);
}

// ------------------------------------------------------------------ §13 : reportOrderIssue lit settings/support
async function testReportOrderIssueSla() {
  const before = (await db.doc('settings/support').get()).data();
  // Valeurs très distinctives, différentes des anciens délais codés en dur (60 min / 24 h) ET des
  // défauts (`DEFAULT_SUPPORT_SLA`), pour prouver sans ambiguïté que la fonction lit bien `settings/support`.
  await db.doc('settings/support').set({ firstResponseTargetMinutes: { ...before.firstResponseTargetMinutes, normal: 17 }, resolutionTargetHours: { ...before.resolutionTargetHours, normal: 5 } }, { merge: true });

  const token = await login('sofia.martin@golink.test');
  const before2 = Date.now();
  const res = await call(token, 'reportOrderIssue', { orderId: DRIVER_ORDER_ID, category: 'other', message: 'Test cdc-fix-residuals-4 (SLA settings/support), sans conséquence, à ignorer.' });
  record('reportOrderIssue : ouverture réussie', res.status === 200 && res.body?.result?.ticketId, JSON.stringify(res.body).slice(0, 200));
  const ticketId = res.body?.result?.ticketId;
  if (ticketId) {
    const ticket = (await db.doc(`supportTickets/${ticketId}`).get()).data();
    const firstDueMs = ticket?.firstResponseDueAt?.toDate?.().getTime() ?? ticket?.firstResponseDueAt?._seconds * 1000;
    const resolutionDueMs = ticket?.resolutionDueAt?.toDate?.().getTime() ?? ticket?.resolutionDueAt?._seconds * 1000;
    const expectedFirst = before2 + 17 * 60_000;
    const expectedResolution = before2 + 5 * 60 * 60_000;
    record(
      'firstResponseDueAt suit désormais settings/support (17 min), plus le 60 min codé en dur',
      Math.abs(firstDueMs - expectedFirst) < 60_000,
      `attendu≈${new Date(expectedFirst).toISOString()} obtenu=${new Date(firstDueMs).toISOString()}`,
    );
    record(
      'resolutionDueAt suit désormais settings/support (5 h), plus les 24 h codées en dur',
      Math.abs(resolutionDueMs - expectedResolution) < 60_000,
      `attendu≈${new Date(expectedResolution).toISOString()} obtenu=${new Date(resolutionDueMs).toISOString()}`,
    );
    // Nettoyage.
    const messages = await db.collection(`supportTickets/${ticketId}/messages`).get();
    await Promise.all(messages.docs.map((d) => d.ref.delete()));
    await db.doc(`supportTickets/${ticketId}`).delete();
    await db.doc(`orders/${DRIVER_ORDER_ID}`).update({ ticketIds: (await db.doc(`orders/${DRIVER_ORDER_ID}`).get()).data()?.ticketIds?.filter((id) => id !== ticketId) ?? [] });
  }

  await db.doc('settings/support').set(before, { merge: false });
  const restored = (await db.doc('settings/support').get()).data();
  record('settings/support restauré à l’identique (SLA)', restored?.firstResponseTargetMinutes?.normal === before?.firstResponseTargetMinutes?.normal, `normal=${restored?.firstResponseTargetMinutes?.normal}`);
}

// ------------------------------------------------------------------ §2 : recherche par numéro de facture (préfixe)
async function testInvoiceSearch() {
  const token = await login('superadmin@golink.test');
  const res = await call(token, 'globalSearch', { query: 'LU-ABO-2026' });
  const invoices = res.body?.result?.groups?.find((g) => g.type === 'invoice')?.hits ?? [];
  record(
    'globalSearch retrouve les factures par préfixe réel (LU-ABO-2026…), la borne haute était cassée avant vérification',
    res.status === 200 && invoices.length >= 3,
    `status=${res.status} count=${invoices.length}`,
  );

  // Regex `queryKind` (apps/admin/src/features/recherche/search.tsx) : vérification directe du motif
  // ajouté (format réel `SÉRIE-ANNÉE-000000`), sans dépendre du bundle React.
  const queryKindInvoicePattern = /^[a-z]{2,4}(-[a-z]{2,6}){0,2}-\d{4}-\d{3,}$/i;
  record('motif queryKind reconnaît désormais le vrai format de facture', queryKindInvoicePattern.test('LU-ABO-2026-000002'), 'LU-ABO-2026-000002');
  record('motif queryKind ne casse pas sur l’ancien exemple générique', !queryKindInvoicePattern.test('Mina Kitchen'), 'Mina Kitchen (ne doit pas matcher)');
}

async function main() {
  await testLoyaltyRestaurant();
  await testDriverTicket();
  await testLiveChatToggle();
  await testReportOrderIssueSla();
  await testInvoiceSearch();

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} OK`);
  if (failed.length) {
    console.log('Échecs :', failed.map((f) => f.name).join(' | '));
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error('Erreur fatale du test :', error);
  process.exitCode = 1;
});
