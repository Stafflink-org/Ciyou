// Test réel des correctifs « sécurité et audit » du cahier (tâche cdc-fix-d), sur la base golink-9f16d :
// écritures directes fermées dans les règles, double authentification contrôlée par le serveur,
// responsable de ville sans ville refusé, plafond de remboursement unique, masquage des données
// personnelles, motif obligatoire et audit des actions sensibles, interrupteurs de fonctionnalités
// lus par les modules et resynchronisation des fiches.
//
// Le script utilise des comptes JETABLES créés pour l'occasion (administrateurs `cdcd-…`, client de
// test) : le compte superadmin@golink.test et sa double authentification ne sont jamais utilisés.
// Toutes les données créées portent `test: true` et l'identifiant `cdcd-…` ; elles sont supprimées à la fin.
//
//   npx tsx scripts/tests/cdc-fix-d.flow.mjs [scénario ...]     (sans argument : tous)
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Timestamp } from '@google-cloud/firestore';
import { auth, db } from '../lib/admin.mjs';
import { callFn, hotp, nextCode, signIn } from '../lib/test-mfa.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const accountsText = readFileSync(join(root, '.test-accounts.local.md'), 'utf8');
const passwordOf = (email) => [...accountsText.matchAll(/\|\s*`([^`]+)`\s*\|\s*`([^`]+)`\s*\|/g)].find((m) => m[1] === email)?.[2];
const PROJECT = 'golink-9f16d';
const FS = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;

const RES = 'cdcd-resto';
const CLIENT = 'cdcd-client';
const SUPER = 'cdcd-super';
const SUPPORT = 'cdcd-support';
const MFAADM = 'cdcd-mfa';
const CITYMGR = 'cdcd-cityless';
const at = (offsetMs = 0) => Timestamp.fromMillis(Date.now() + offsetMs);
const DAY = 86_400_000;
const only = process.argv.slice(2);
const results = [];
const created = { authUsers: new Set(), docs: [], orders: new Set() };

function record(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'OK   ' : 'ÉCHEC'} ${name}${detail ? ` — ${detail}` : ''}`);
}
const check = (name, condition, detail) => record(name, Boolean(condition), detail);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, timeoutMs = 90_000, everyMs = 2500) {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const value = await fn();
    if (value) return value;
    if (Date.now() > end) return null;
    await sleep(everyMs);
  }
}

// ------------------------------------------------------------------ Sessions et appels

const tokens = new Map();
const passwords = new Map();
async function throwaway(uid, email, claims) {
  const password = `${randomBytes(18).toString('base64url')}Aa1`;
  try {
    await auth.getUser(uid);
    await auth.updateUser(uid, { password, email });
  } catch {
    await auth.createUser({ uid, email, password, emailVerified: true, displayName: uid });
  }
  created.authUsers.add(uid);
  if (claims) await auth.setCustomUserClaims(uid, claims);
  passwords.set(uid, { email, password });
  const token = await signIn(email, password);
  tokens.set(uid, token);
  return token;
}
async function relogin(uid) {
  const { email, password } = passwords.get(uid);
  const token = await signIn(email, password);
  tokens.set(uid, token);
  return token;
}
async function makeAdmin(uid, role, { permissions, cityIds = [], refundLimitCents = null } = {}) {
  const email = `${uid}@golink.test`;
  const roleDoc = (await db.doc(`adminRoles/${role}`).get()).data();
  const perms = permissions ?? roleDoc?.permissions ?? [];
  await db.doc(`admins/${uid}`).set({
    uid, email, displayName: `Test ${uid}`, role, permissions: perms, active: true, countryIds: [], cityIds, refundLimitCents,
    mfaEnrolled: false, lastLoginAt: null, lastLoginIp: null, createdAt: at(0), createdBy: 'system', updatedAt: at(0), updatedBy: 'system', test: true,
  });
  await db.doc(`users/${uid}`).set({ role: 'admin', email, firstName: 'Test', lastName: uid, displayName: `Test ${uid}`, status: 'active', locale: 'fr', test: true, createdAt: at(0), updatedAt: at(0) }, { merge: true });
  created.docs.push(`admins/${uid}`, `users/${uid}`);
  return throwaway(uid, email, { role: 'admin', adminRole: role });
}
async function call(token, name, data) {
  for (let attempt = 0; ; attempt += 1) {
    const res = await callFn(name, data, token);
    if (res.ok) return res.data;
    const status = String(res.error?.status ?? res.status);
    const transient = status === 'UNAVAILABLE' || res.status === 503 || res.status === 429 || (res.status === 500 && !res.error);
    if (attempt < 10 && transient) {
      await sleep(8000 + attempt * 4000);
      continue;
    }
    const error = new Error(res.error?.message ?? `HTTP ${res.status}`);
    error.status = status;
    error.http = res.status;
    error.details = res.error?.details;
    throw error;
  }
}
async function expectError(name, promise, status, fragment) {
  try {
    await promise;
    record(name, false, 'accepté alors qu’un refus était attendu');
  } catch (error) {
    const ok = (!status || error.status === status) && (!fragment || String(error.message).includes(fragment));
    record(name, ok, `${error.status} : ${error.message}`);
  }
}
/** Écriture directe dans Firestore avec le jeton d'un compte (règles de sécurité appliquées). */
async function rest(token, method, path, body) {
  const res = await fetch(`${FS}/${path}`, {
    method,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.status;
}
const patchField = (token, path) => rest(token, 'PATCH', `${path}?updateMask.fieldPaths=cdcdProbe`, { fields: { cdcdProbe: { stringValue: 'x' } } });
const auditOf = async (action, targetId) => {
  const snap = await db.collection('auditLogs').where('action', '==', action).limit(400).get();
  return snap.docs.map((d) => d.data()).filter((a) => !targetId || a.target?.id === targetId).sort((a, b) => (b.at?.toMillis?.() ?? 0) - (a.at?.toMillis?.() ?? 0));
};

// ------------------------------------------------------------------ Décor de test

async function clone(path, target, override = {}) {
  const snap = await db.doc(path).get();
  if (!snap.exists) throw new Error(`Modèle introuvable : ${path}`);
  await db.doc(target).set({ ...snap.data(), ...override });
  created.docs.push(target);
}

async function setupRestaurant() {
  await clone('restaurants/mina-kitchen', `restaurants/${RES}`, {
    name: 'Test D Resto', slug: 'test-d-resto', groupId: null, status: 'active', onboardingStatus: 'approved', isOpen: true, acceptingOrders: true,
    fulfillmentModes: ['delivery', 'pickup'], deliveredBy: 'restaurant', acceptedPaymentMethods: ['card', 'apple_pay', 'google_pay', 'cash'], sponsored: false, test: true, seed: true,
    lastOrderAt: at(-DAY), createdAt: at(-30 * DAY), metrics30d: null, missedOrdersInARow: 0, ordersCount: 0,
  });
  await clone('restaurants/mina-kitchen/private/commercial', `restaurants/${RES}/private/commercial`, { subscriptionStatus: 'active', negotiatedCommission: null, specialOffer: null, billingMode: null, allowedPaymentMethods: ['card', 'apple_pay', 'google_pay', 'cash'], payoutsBlocked: false, stripeAccountStatus: 'enabled', test: true });
  await clone('restaurants/mina-kitchen/private/legal', `restaurants/${RES}/private/legal`, { test: true });
  await clone('restaurants/mina-kitchen/settings/orders', `restaurants/${RES}/settings/orders`, { autoAccept: false, delivery: true, pickup: true, dineIn: false, scheduledOrders: true, test: true });
  await clone('restaurants/mina-kitchen/settings/hours', `restaurants/${RES}/settings/hours`, { test: true });
  await clone('restaurants/mina-kitchen/settings/payments', `restaurants/${RES}/settings/payments`, { test: true });
  const products = db.collection('restaurants').doc(RES).collection('products');
  const base = { sectionId: null, description: null, vatCategory: 'food', available: true, stock: null, lowStockThreshold: 0, optionGroupIds: [], allergens: [], allergensDeclared: true, dietary: [], containsAlcohol: false, featured: false, order: 999, salesCount: 0, searchKeywords: [], seed: true, test: true, createdAt: at(0), updatedAt: at(0), createdBy: 'system', updatedBy: 'system' };
  await products.doc('cdcd-p1').set({ ...base, name: 'Test plat D', priceCents: 2000 });
  await products.doc('cdcd-stock').set({ ...base, name: 'Test plat stock D', priceCents: 1000, stock: 1 });
  await db.doc(`users/${CLIENT}`).set({}, { merge: true });
  const clientToken = await throwaway(CLIENT, 'cdcd-client@golink.test', null);
  tokens.set(CLIENT, clientToken);
  await clone('users/sim-client-longwy-1', `users/${CLIENT}`, { email: 'cdcd-client@golink.test', firstName: 'Cdcd', lastName: 'Client', displayName: 'Cdcd Client', referralCode: 'CDCDREF1', referredBy: null, walletBalanceCents: 1_000_000, test: true, seed: true, stats: { firstOrderAt: null, cancelledCount: 0, refundsCount: 0, lastOrderAt: null, ordersCount: 0, totalSpentCents: 0 } });
}

let seq = 0;
async function place(extra = {}) {
  const clientRequestId = `cdcd${Date.now().toString(36)}${(seq += 1)}${randomBytes(3).toString('hex')}`;
  const result = await call(tokens.get(CLIENT), 'placeOrder', { restaurantId: RES, fulfillment: 'pickup', lines: [{ productId: 'cdcd-p1', quantity: 1 }], paymentMethod: 'card', useWallet: true, clientRequestId, ...extra });
  created.orders.add(result.orderId);
  return result;
}
const cancelOrder = (orderId) => call(tokens.get(CLIENT), 'cancelOrder', { orderId, reason: 'customer_request', details: 'Test cdcd : annulation' }).catch(() => undefined);

// ------------------------------------------------------------------ Scénarios

const scenarios = {};

scenarios.invoker = async () => {
  for (const name of ['getRefundPolicy', 'resolveMenuIssue', 'saveSponsoredOffer', 'fixRestaurantProduct']) {
    const res = await callFn(name, {}, null);
    check(`Invoker public — appel anonyme de ${name}`, res.status === 401 || res.status === 400, `HTTP ${res.status} ${res.error?.status ?? ''}`);
  }
};

scenarios.rules = async () => {
  const superToken = tokens.get(SUPER);
  const supportToken = tokens.get(SUPPORT);
  const firstDoc = async (col) => (await db.collection(col).limit(1).get()).docs[0]?.id ?? 'cdcd-x';
  const targets = [
    'settings/general', 'settings/security', 'featureFlags/alcohol_sales', 'featureFlags/tips', 'adminRoles/support', 'countries/FR', 'cities/metz', 'appVersions/client',
    'integrations/stripe', 'plans/basic', `commissionRules/${await firstDoc('commissionRules')}`, `platformAlerts/${await firstDoc('platformAlerts')}`,
    `scheduledReports/${await firstDoc('scheduledReports')}`, `securityAlerts/${await firstDoc('securityAlerts')}`, `zones/${await firstDoc('zones')}`, `surgeRules/${await firstDoc('surgeRules')}`,
    `sponsoredOffers/${await firstDoc('sponsoredOffers')}`, `promotions/${await firstDoc('promotions')}`, `messageTemplates/${await firstDoc('messageTemplates')}`,
    `fraudCases/${await firstDoc('fraudCases')}`, `blocklist/${await firstDoc('blocklist')}`, `restaurantGroups/${await firstDoc('restaurantGroups')}`,
    `restaurants/${RES}`, `restaurants/${RES}/products/cdcd-p1`, `restaurants/${RES}/settings/orders`,
  ];
  for (const path of targets) {
    const status = await patchField(superToken, path);
    check(`Règles — écriture directe d'un super admin refusée : ${path}`, status === 403, `HTTP ${status}`);
  }
  check('Règles — le super admin de test lit toujours les réglages', (await rest(superToken, 'GET', 'settings/general')) === 200);
  const driverId = (await db.collection('driverPrivate').limit(1).get()).docs[0]?.id;
  if (driverId) {
    check('Règles — driverPrivate lisible avec « données personnelles non masquées »', (await rest(superToken, 'GET', `driverPrivate/${driverId}`)) === 200);
    check('Règles — driverPrivate masqué pour un agent support', (await rest(supportToken, 'GET', `driverPrivate/${driverId}`)) === 403);
  }
};

scenarios.mfa = async () => {
  // Compte jetable enrôlé : la vérification de session est exigée par TOUTES les fonctions d'administration.
  const token = tokens.get(MFAADM);
  const tracked = await call(token, 'trackAdminSession', {});
  check('2FA — session ouverte sans vérification', tracked.mfaEnrolled === false && tracked.mfaVerified === false, JSON.stringify({ enrolled: tracked.mfaEnrolled, required: tracked.mfaRequired }));
  const started = await call(token, 'enrollTotp', { action: 'start' });
  const { code } = await nextCode(started.secret, null);
  const confirmed = await call(token, 'enrollTotp', { action: 'confirm', code });
  check('2FA — enrôlement du compte jetable', Array.isArray(confirmed.recoveryCodes) && confirmed.recoveryCodes.length > 0);
  // Nouvelle session (nouveau jeton) : non vérifiée.
  const fresh = await relogin(MFAADM);
  await call(fresh, 'trackAdminSession', {});
  await expectError('2FA — fonction d’administration refusée tant que le code n’est pas validé (getRefundPolicy)', call(fresh, 'getRefundPolicy', {}), 'FAILED_PRECONDITION', 'double authentification');
  await expectError('2FA — action sensible refusée avant validation (creditCustomer)', call(fresh, 'creditCustomer', { userId: CLIENT, amountCents: 100, reason: 'commercial_gesture', note: 'Test cdcd' }), 'FAILED_PRECONDITION', 'double authentification');
  await expectError('2FA — code erroné refusé', call(fresh, 'verifyTotp', { code: '000000', method: 'totp' }), undefined, 'Code incorrect');
  const secretDoc = (await db.doc(`adminSecrets/${MFAADM}`).get()).data();
  const step = secretDoc?.lastUsedStep ?? null;
  const next = await nextCode(started.secret, step);
  const verified = await call(fresh, 'verifyTotp', { code: next.code, method: 'totp' });
  check('2FA — code valide accepté', verified.verified === true);
  const policy = await call(fresh, 'getRefundPolicy', {});
  check('2FA — fonction d’administration accessible après validation', policy && typeof policy.maxCreditCents === 'number');
  await expectError('2FA — rejeu du même code refusé', call(await (async () => { const t = await relogin(MFAADM); await call(t, 'trackAdminSession', {}); return t; })(), 'verifyTotp', { code: next.code, method: 'totp' }), undefined, 'Code incorrect');
  // Le compte enrôlé n'est jamais désactivé par ces contrôles.
  check('2FA — le compte reste enrôlé', (await db.doc(`admins/${MFAADM}`).get()).get('mfaEnrolled') === true);
  // Le super admin de test non enrôlé : sans obligation, pas de contrainte ; avec obligation, invitation à s'enrôler.
  const policyDoc = (await db.doc('settings/security').get()).data();
  if (policyDoc?.requireMfaForAdmins === true) {
    await expectError('2FA obligatoire — administrateur non enrôlé refusé', call(tokens.get(SUPER), 'getRefundPolicy', {}), 'FAILED_PRECONDITION', 'Activez la double authentification');
    await expectError('2FA obligatoire — désactivation refusée', call(tokens.get(MFAADM), 'updatePlatformSettings', { doc: 'security', reason: 'test', data: {} }), undefined, undefined);
  } else {
    check('2FA — sans obligation, un administrateur non enrôlé passe (mode de transition)', (await call(tokens.get(SUPER), 'getRefundPolicy', {})).limitCents === null);
  }
};

scenarios.invite = async () => {
  const token = tokens.get(SUPER);
  const base = { email: 'cdcd-invite@golink.test', firstName: 'Cdcd', lastName: 'Invite', adminRole: 'city_manager', cityIds: [], countryIds: [], reason: 'Test cdcd : invitation' };
  await expectError('Invitation — responsable de ville sans ville refusé', call(token, 'inviteAdmin', base), 'INVALID_ARGUMENT', 'au moins une ville');
  await expectError('Invitation — ville inconnue refusée', call(token, 'inviteAdmin', { ...base, cityIds: ['ville-fantome'] }), 'INVALID_ARGUMENT', 'Ville inconnue');
  await expectError('Invitation — motif obligatoire', call(token, 'inviteAdmin', { ...base, cityIds: ['metz'], reason: undefined }), 'INVALID_ARGUMENT');
  await expectError('Attribution de rôle — responsable de ville sans ville refusé', call(token, 'setUserRole', { uid: CLIENT, role: 'admin', adminRole: 'city_manager', cityIds: [], countryIds: [], reason: 'Test cdcd' }), 'INVALID_ARGUMENT', 'au moins une ville');
  check('Aucun compte créé par les invitations refusées', (await db.collection('admins').where('email', '==', 'cdcd-invite@golink.test').get()).empty);
};

scenarios.refund = async () => {
  const supportToken = tokens.get(SUPPORT);
  const policy = await call(supportToken, 'getRefundPolicy', {});
  const role = (await db.doc('adminRoles/support').get()).data();
  const threshold = (await db.doc('settings/refunds').get()).get('approvalThresholdCents');
  const expected = threshold > 0 ? Math.min(role.defaultRefundLimitCents, threshold) : role.defaultRefundLimitCents;
  check('Plafond — un seul plafond calculé côté serveur (rôle borné par le seuil de la plateforme)', policy.limitCents === expected, `${policy.limitCents} c (rôle ${role.defaultRefundLimitCents} c, seuil ${threshold} c)`);
  check('Plafond — montant maximal d’un avoir réglable', policy.maxCreditCents === 50_000, `${policy.maxCreditCents} c`);
  const superPolicy = await call(tokens.get(SUPER), 'getRefundPolicy', {});
  check('Plafond — super administrateur sans plafond', superPolicy.limitCents === null);
  const customer = { userId: CLIENT, note: 'Test cdcd : geste commercial', reason: 'commercial_gesture' };
  await expectError('Plafond — avoir au-dessus du plafond de l’agent refusé (creditCustomer)', call(supportToken, 'creditCustomer', { ...customer, amountCents: expected + 100 }), 'PERMISSION_DENIED', 'plafond');
  const ok = await call(supportToken, 'creditCustomer', { ...customer, amountCents: 300 });
  check('Plafond — avoir dans le plafond accepté', ok.balanceAfterCents >= 300, `solde ${ok.balanceAfterCents} c`);
  // Le plafond du rôle est bien celui qui compte : un plafond individuel plus bas s'applique.
  await db.doc(`admins/${SUPPORT}`).update({ refundLimitCents: 200 });
  await expectError('Plafond — plafond individuel de l’agent respecté', call(supportToken, 'creditCustomer', { ...customer, amountCents: 300 }), 'PERMISSION_DENIED', 'plafond');
  await db.doc(`admins/${SUPPORT}`).update({ refundLimitCents: null });
  // Montant maximal d'un avoir : même un responsable sans plafond ne peut pas le dépasser.
  await expectError('Plafond — montant maximal d’un avoir respecté, même sans plafond', call(tokens.get(SUPER), 'creditCustomer', { ...customer, amountCents: 60_000 }), 'INVALID_ARGUMENT', 'limité');
  // Avoir depuis un ticket : la permission de valider ne lève plus le plafond (pas d'auto-validation).
  const ticketId = 'cdcd-ticket';
  const srcTicket = (await db.collection('supportTickets').limit(1).get()).docs[0];
  await db.doc(`supportTickets/${ticketId}`).set({ ...srcTicket.data(), requesterType: 'client', requesterId: CLIENT, requesterName: 'Cdcd Client', restaurantId: RES, status: 'open', orderId: null, assigneeId: null, cityId: null, messagesCount: 0, test: true, number: 'TK-CDCD' });
  created.docs.push(`supportTickets/${ticketId}`);
  await db.doc(`admins/${SUPPORT}`).update({ permissions: [...new Set([...(role.permissions ?? []), 'refunds.approve', 'customers.credit', 'support.handle'])] });
  await expectError('Plafond — pas d’auto-validation d’un avoir de ticket (refunds.approve ne lève pas le plafond)', call(supportToken, 'creditFromTicket', { ticketId, amountCents: expected + 100, reason: 'Test cdcd', chargedTo: 'platform' }), 'PERMISSION_DENIED', 'plafond');
  const credited = await call(supportToken, 'creditFromTicket', { ticketId, amountCents: 200, reason: 'Test cdcd', chargedTo: 'platform' });
  check('Plafond — avoir de ticket dans le plafond accepté', typeof credited.balanceCents === 'number');
};

scenarios.mask = async () => {
  const token = tokens.get(SUPER);
  const before = (await db.doc('adminRoles/ops').get()).data();
  try {
    const withData = [...new Set([...before.permissions, 'personal_data.view'])];
    await call(token, 'updateAdminRoleDefinition', { role: 'ops', label: before.label, description: before.description, permissions: withData, defaultRefundLimitCents: before.defaultRefundLimitCents, reason: 'Test cdcd : masquage' });
    const on = (await db.doc('adminRoles/ops').get()).data();
    check('Masquage — avec « données personnelles non masquées », le rôle n’est pas masqué', on.maskPersonalData === false);
    await call(token, 'updateAdminRoleDefinition', { role: 'ops', label: before.label, description: before.description, permissions: before.permissions.filter((p) => p !== 'personal_data.view'), defaultRefundLimitCents: before.defaultRefundLimitCents, maskPersonalData: false, reason: 'Test cdcd : masquage (retour)' });
    const off = (await db.doc('adminRoles/ops').get()).data();
    check('Masquage — sans la permission, le rôle est masqué même si le champ envoyé dit le contraire (source unique)', off.maskPersonalData === true);
  } finally {
    await db.doc('adminRoles/ops').set(before);
  }
  // Export : coordonnées masquées sans la permission (contrôle serveur).
  await expectError('Export — motif obligatoire', call(tokens.get(SUPPORT), 'exportData', { entity: 'clients', format: 'csv', filters: {} }), 'INVALID_ARGUMENT');
};

scenarios.reasons = async () => {
  const token = tokens.get(SUPER);
  const invalid = async (name, fn, data) => expectError(`Motif obligatoire — ${name}`, call(token, fn, data), 'INVALID_ARGUMENT');
  await invalid('executePayout', 'executePayout', { payoutId: 'cdcd-inexistant' });
  await invalid('generateTaxReport', 'generateTaxReport', { type: 'vat', countryId: 'FR', period: '2026-01' });
  await invalid('exportAccounting', 'exportAccounting', { month: '2026-01', countryId: 'FR' });
  await invalid('exportAuditLogs', 'exportAuditLogs', { from: Date.now() - DAY, to: Date.now(), sensitiveOnly: true });
  await invalid('runManualBackup', 'runManualBackup', { collections: ['counters'] });
  await invalid('receiveGdprRequest', 'receiveGdprRequest', { type: 'access', subjectType: 'client', email: 'cdcd@example.test', notes: null });
  await invalid('publishPage', 'publishPage', { kind: 'page', id: 'cdcd-inexistante', requiresReacceptance: false });
  await invalid('bookSponsoredPlacement', 'bookSponsoredPlacement', { restaurantId: RES, offerId: 'x', startDay: '2099-01-01', periods: 1, billing: 'offered', categoryId: null });
  await invalid('createPlatformPromotion', 'createPlatformPromotion', { scope: 'platform', kind: 'fixed', value: 100 });
  await invalid('updateMessageTemplate', 'updateMessageTemplate', { key: 'order_confirmed', active: true, channels: ['push'], subject: null, title: 'Test', body: 'Test cdcd texte' });
  await invalid('saveScheduledReport', 'saveScheduledReport', { name: 'Test cdcd', report: 'finance', frequency: 'weekly', recipients: ['cdcd@example.test'], format: 'csv', hour: 8, active: false });
  await invalid('reviewRestaurantApplication (validation sans motif)', 'reviewRestaurantApplication', { restaurantId: RES, decision: 'approve' });
  await db.doc('drivers/seed-driver-029').update({ onboardingStatus: 'submitted', status: 'onboarding' });
  await expectError('Motif obligatoire — reviewDriverApplication (validation sans motif)', call(token, 'reviewDriverApplication', { driverId: 'seed-driver-029', decision: 'reject' }), 'INVALID_ARGUMENT');
  await invalid('generateMonthlyInvoicesNow (réel)', 'generateMonthlyInvoicesNow', { month: '2026-01', countryId: 'FR' });
  await invalid('buildPayoutsNow (réel)', 'buildPayoutsNow', { beneficiaryType: 'restaurant' });
  await invalid('importRestaurants (réel)', 'importRestaurants', { rows: [{ name: 'Test cdcd' }], dryRun: false });
  // Offre du catalogue : création puis modification avec motif, historique et audit.
  const offer = await call(token, 'saveSponsoredOffer', { label: 'Offre test cdcd', slot: 'home_featured', priceHtCents: 1234, durationDays: 7, maxConcurrent: 2, cityIds: null, active: false, reason: 'Test cdcd : création' });
  created.docs.push(`sponsoredOffers/${offer.offerId}`);
  await call(token, 'saveSponsoredOffer', { offerId: offer.offerId, label: 'Offre test cdcd', slot: 'home_featured', priceHtCents: 2345, durationDays: 7, maxConcurrent: 2, cityIds: null, active: false, reason: 'Test cdcd : nouveau prix' });
  const updated = (await db.doc(`sponsoredOffers/${offer.offerId}`).get()).data();
  check('Offre sponsorisée — prix modifié par la fonction', updated.priceHtCents === 2345);
  const audits = await auditOf('sponsored_offer.updated', `sponsoredOffers/${offer.offerId}`);
  check('Offre sponsorisée — audit avec motif, avant et après', audits[0]?.reason === 'Test cdcd : nouveau prix' && audits[0].before?.priceHtCents === 1234 && audits[0].after?.priceHtCents === 2345 && audits[0].sensitive === true);
  await expectError('Offre sponsorisée — motif obligatoire', call(token, 'saveSponsoredOffer', { offerId: offer.offerId, label: 'Offre test cdcd', slot: 'home_featured', priceHtCents: 1, durationDays: 7, maxConcurrent: 2, cityIds: null, active: false }), 'INVALID_ARGUMENT');
  // Demande RGPD : motif conservé.
  const gdpr = await call(token, 'receiveGdprRequest', { type: 'access', subjectType: 'client', subjectId: CLIENT, email: 'cdcd-client@golink.test', notes: null, reason: 'Test cdcd : demande reçue par courrier' });
  created.docs.push(`gdprRequests/${gdpr.requestId}`);
  const gAudit = await auditOf('gdpr_request.received');
  check('Demande RGPD — motif dans le journal d’audit', gAudit[0]?.reason === 'Test cdcd : demande reçue par courrier');
  // Anomalie de carte : clôture avec motif et audit ; correction de produit.
  await db.doc('menuIssues/cdcd-issue').set({ restaurantId: RES, productId: 'cdcd-p1', type: 'missing_description', status: 'open', details: 'Test cdcd', detectedAt: at(0), test: true });
  created.docs.push('menuIssues/cdcd-issue');
  await expectError('Anomalie de carte — motif obligatoire', call(token, 'resolveMenuIssue', { issueId: 'cdcd-issue', status: 'fixed' }), 'INVALID_ARGUMENT');
  await call(token, 'fixRestaurantProduct', { restaurantId: RES, productId: 'cdcd-p1', name: 'Test plat D', description: 'Description corrigée par l’équipe', allergens: ['gluten'], available: true, reason: 'Test cdcd : description manquante' });
  const fixed = (await db.doc(`restaurants/${RES}/products/cdcd-p1`).get()).data();
  check('Correction de produit — appliquée par la fonction', fixed.description === 'Description corrigée par l’équipe' && fixed.allergens.includes('gluten'));
  await expectError('Correction de produit — alcool refusé', call(token, 'fixRestaurantProduct', { restaurantId: RES, productId: 'cdcd-p1', name: 'Bière blonde', description: null, allergens: [], available: true, reason: 'Test cdcd' }), 'INVALID_ARGUMENT', 'alcool');
  await call(token, 'resolveMenuIssue', { issueId: 'cdcd-issue', status: 'fixed', reason: 'Test cdcd : corrigée' });
  check('Anomalie de carte — clôturée', (await db.doc('menuIssues/cdcd-issue').get()).get('status') === 'fixed');
  const mAudit = await auditOf('menu_issue.resolved', RES);
  check('Anomalie de carte — audit avec motif', mAudit[0]?.reason === 'Test cdcd : corrigée');
};

scenarios.audits = async () => {
  // Actions d'administration autrefois sans audit : closeSupportChat, respondToTicket, logProspectActivity, generateStatement.
  const superToken = tokens.get(SUPER);
  const ticketId = 'cdcd-ticket-audit';
  const srcTicket = (await db.collection('supportTickets').limit(1).get()).docs[0];
  await db.doc(`supportTickets/${ticketId}`).set({ ...srcTicket.data(), requesterType: 'client', requesterId: CLIENT, requesterName: 'Cdcd Client', restaurantId: RES, status: 'open', orderId: null, assigneeId: null, cityId: null, test: true, number: 'TK-CDCD2' });
  created.docs.push(`supportTickets/${ticketId}`);
  await call(superToken, 'respondToTicket', { ticketId, body: 'Réponse de test cdcd', internal: true, status: null, cannedResponseId: null });
  const tAudit = await auditOf('ticket.internal_note', ticketId);
  check('Audit — respondToTicket', tAudit.length > 0 && tAudit[0].actor?.type === 'admin');
  const prospect = (await db.collection('prospects').limit(1).get()).docs[0];
  if (prospect) {
    await call(superToken, 'logProspectActivity', { prospectId: prospect.id, type: 'note', summary: 'Note de test cdcd', nextFollowUpAt: null });
    const pAudit = await auditOf('prospect.activity_logged', prospect.id);
    check('Audit — logProspectActivity', pAudit.length > 0);
    await prospect.ref.collection('activities').where('summary', '==', 'Note de test cdcd').get().then((s) => Promise.all(s.docs.map((d) => d.ref.delete())));
  }
  const payout = (await db.collection('payouts').where('beneficiaryType', '==', 'restaurant').limit(1).get()).docs[0];
  if (payout) {
    await call(superToken, 'generateStatement', { payoutId: payout.id });
    const sAudit = await auditOf('statement.viewed', payout.get('beneficiaryId'));
    check('Audit — consultation d’un relevé par l’équipe (generateStatement)', sAudit.length > 0);
  }
};

scenarios.flags = async () => {
  const token = tokens.get(SUPER);
  const setFlag = async (key, enabled, overrides = [], reason = 'Test cdcd : interrupteur') => {
    const cur = (await db.doc(`featureFlags/${key}`).get()).data();
    const res = await call(token, 'setFeatureFlag', { key, enabled, overrides, reason, description: cur?.description });
    // Cache serveur des interrupteurs (10 s) : on laisse le temps au changement de se propager avant de tester.
    await sleep(12_000);
    return res;
  };
  const original = {};
  for (const key of ['pickup', 'delivery', 'tips', 'card_payment', 'promotions', 'stock_management', 'scheduled_orders', 'loyalty', 'referral', 'live_chat', 'multi_outlet']) {
    original[key] = (await db.doc(`featureFlags/${key}`).get()).data();
  }
  const restore = async () => {
    for (const [key, flag] of Object.entries(original)) {
      if (!flag) continue;
      await db.doc(`featureFlags/${key}`).set(flag);
    }
  };
  try {
    // Base : tout fonctionne.
    const ok = await place();
    check('Interrupteurs — commande de base acceptée (retrait, carte)', Boolean(ok.orderId));
    await cancelOrder(ok.orderId);

    // Retrait éteint : refusé à la commande, pas seulement dans les réglages.
    await setFlag('pickup', false);
    await expectError('Interrupteur « Retrait » éteint : commande en retrait refusée', place(), 'FAILED_PRECONDITION', 'Retrait');
    const sync = await until(async () => !(((await db.doc(`restaurants/${RES}`).get()).get('fulfillmentModes') ?? []).includes('pickup')), 120_000, 4000);
    check('Interrupteur « Retrait » éteint : fiche du commerce resynchronisée (mode retiré)', sync);
    await setFlag('pickup', true);
    const back = await until(async () => ((await db.doc(`restaurants/${RES}`).get()).get('fulfillmentModes') ?? []).includes('pickup'), 120_000, 4000);
    check('Interrupteur « Retrait » rallumé : mode rétabli tel que le commerce l’avait choisi', back);
    const settingsKept = (await db.doc(`restaurants/${RES}/settings/orders`).get()).get('pickup') === true;
    check('Le réglage saisi par le commerce n’a pas été modifié', settingsKept);
    const again = await place();
    check('Interrupteur « Retrait » rallumé : commande acceptée', Boolean(again.orderId));
    await cancelOrder(again.orderId);

    // Surcharge par commerce : éteint seulement pour ce restaurant.
    await setFlag('tips', true, [{ scope: 'restaurant', scopeId: RES, enabled: false }]);
    await expectError('Surcharge « Pourboires » pour ce commerce : pourboire refusé', place({ tipCents: 200 }), 'FAILED_PRECONDITION', 'pourboire');
    await setFlag('tips', true, []);
    const tipOrder = await place({ tipCents: 200 }).catch((e) => e);
    check('Interrupteur « Pourboires » rallumé : pourboire accepté', !(tipOrder instanceof Error), tipOrder instanceof Error ? tipOrder.message : '');
    if (!(tipOrder instanceof Error)) await cancelOrder(tipOrder.orderId);

    // Carte bancaire éteinte.
    await setFlag('card_payment', false);
    await expectError('Interrupteur « Carte bancaire » éteint : paiement par carte refusé', place(), 'FAILED_PRECONDITION');
    await setFlag('card_payment', true);

    // Commandes programmées.
    await setFlag('scheduled_orders', false);
    await expectError('Interrupteur « Commandes programmées » éteint : commande programmée refusée', place({ scheduledFor: new Date(Date.now() + 3 * 3_600_000).toISOString() }), 'FAILED_PRECONDITION');
    await setFlag('scheduled_orders', true);

    // Promotions éteintes : ni code, ni offre automatique.
    await db.doc('promotions/cdcd-promo').set({
      scope: 'platform', countryId: 'FR', cityIds: [], restaurantId: null, restaurantIds: [RES], title: { fr: 'Test cdcd' }, description: null, code: 'CDCDPROMO', kind: 'fixed', value: 300, maxDiscountCents: null,
      minSubtotalCents: 0, funding: 'platform', restaurantShareBps: null, target: 'everyone', inactiveDays: null, modes: [], totalUsageLimit: null, perCustomerLimit: 5, startsAt: at(-DAY), endsAt: null, status: 'active',
      showcase: false, stats: { redemptions: 0, discountCents: 0, ordersSubtotalCents: 0, newCustomers: 0 }, createdAt: at(0), updatedAt: at(0), createdBy: 'system', updatedBy: 'system', test: true, seed: true,
    });
    created.docs.push('promotions/cdcd-promo');
    const withPromo = await place({ promoCode: 'CDCDPROMO' });
    check('Promotions allumées : code accepté', (await db.doc(`orders/${withPromo.orderId}`).get()).get('promoCode') === 'CDCDPROMO');
    await cancelOrder(withPromo.orderId);
    await setFlag('promotions', false);
    await expectError('Interrupteur « Promotions » éteint : code refusé', place({ promoCode: 'CDCDPROMO' }), 'FAILED_PRECONDITION', 'promotions');
    const noAuto = await place();
    check('Interrupteur « Promotions » éteint : aucune offre automatique appliquée', (await db.doc(`orders/${noAuto.orderId}`).get()).get('promotionId') == null);
    await cancelOrder(noAuto.orderId);
    await setFlag('promotions', true);

    // Stock : suivi désactivé = quantités non contrôlées.
    await expectError('Stock suivi : quantité au-delà du stock refusée', place({ lines: [{ productId: 'cdcd-stock', quantity: 3 }] }), 'FAILED_PRECONDITION');
    await setFlag('stock_management', false);
    const noStock = await place({ lines: [{ productId: 'cdcd-stock', quantity: 3 }] }).catch((e) => e);
    check('Interrupteur « Stock » éteint : la quantité n’est plus contrôlée', !(noStock instanceof Error), noStock instanceof Error ? noStock.message : '');
    if (!(noStock instanceof Error)) await cancelOrder(noStock.orderId);
    await setFlag('stock_management', true);

    // Fidélité, parrainage, chat en direct.
    await setFlag('loyalty', false);
    await expectError('Interrupteur « Fidélité » éteint : échange de points refusé', call(tokens.get(CLIENT), 'redeemLoyaltyPoints', { points: 100 }), 'FAILED_PRECONDITION');
    await setFlag('loyalty', true);
    await setFlag('referral', false);
    await expectError('Interrupteur « Parrainage » éteint : code de parrainage refusé', call(tokens.get(CLIENT), 'applyReferralCode', { code: 'CDCDXXXX' }), 'FAILED_PRECONDITION');
    await setFlag('referral', true);
  } finally {
    await restore();
  }
  // Verrou de la vente d'alcool : jamais modifiable, ni par la fonction ni en direct.
  await expectError('Verrou « Vente d’alcool » : setFeatureFlag refusé', call(token, 'setFeatureFlag', { key: 'alcohol_sales', enabled: true, overrides: [], reason: 'Test cdcd' }), 'FAILED_PRECONDITION', 'verrouillée');
  check('Verrou « Vente d’alcool » : écriture directe refusée par les règles', (await patchField(token, 'featureFlags/alcohol_sales')) === 403);
  check('Verrou « Vente d’alcool » : toujours verrouillé et éteint', (await db.doc('featureFlags/alcohol_sales').get()).get('locked') === true && (await db.doc('featureFlags/alcohol_sales').get()).get('enabled') === false);
  const flagAudits = await auditOf('feature.updated');
  check('Interrupteurs — chaque changement tracé avec son motif', flagAudits.filter((a) => a.reason === 'Test cdcd : interrupteur').length >= 10, `${flagAudits.filter((a) => a.reason === 'Test cdcd : interrupteur').length} entrées`);
};


scenarios.markets = async () => {
  const token = tokens.get(SUPER);
  const idCountry = 'ZZ';
  const audits = () => auditOf('country.created', `countries/${idCountry}`);
  try {
    await expectError('Marché — motif obligatoire à la création', call(token, 'createCountry', { countryId: idCountry, name: 'Pays test cdcd', currency: 'EUR', locales: ['fr'], defaultLocale: 'fr', timezone: 'Europe/Paris', phonePrefix: '+33', stripeAvailable: true }), 'INVALID_ARGUMENT');
    const created = await call(token, 'createCountry', { countryId: idCountry, name: 'Pays test cdcd', currency: 'EUR', locales: ['fr'], defaultLocale: 'fr', timezone: 'Europe/Paris', phonePrefix: '+33', stripeAvailable: true, templateCountryId: 'FR', reason: 'Test cdcd : ouverture d’un nouveau marché' });
    const doc = (await db.doc(`countries/${idCountry}`).get()).data();
    check('Marché — pays créé fermé, avec tarifs et moyens de paiement du modèle', created.countryId === idCountry && doc.active === false && Boolean(doc.pricing?.serviceFee) && Boolean(doc.paymentMethods));
    const auditRows = await audits();
    check('Marché — création tracée (audit sensible avec motif)', auditRows[0]?.reason === 'Test cdcd : ouverture d’un nouveau marché' && auditRows[0].sensitive === true);
    await expectError('Marché — un pays existant ne peut pas être recréé', call(token, 'createCountry', { countryId: idCountry, name: 'Doublon', currency: 'EUR', locales: ['fr'], defaultLocale: 'fr', timezone: 'Europe/Paris', phonePrefix: '+33', stripeAvailable: true, reason: 'Test cdcd' }), 'ALREADY_EXISTS');
    // Périmètre par pays : converti en villes.
    const roleBody = () => ({ adminId: SUPPORT, role: 'support', cityIds: [], countryIds: [idCountry], refundLimitCents: null, active: true, reason: 'Test cdcd : périmètre pays' });
    await expectError('Périmètre pays — pays sans ville refusé', call(token, 'updateAdminRole', roleBody()), 'INVALID_ARGUMENT', 'Aucune ville');
    const hours = (await db.doc('cities/metz').get()).get('serviceHours');
    const city = await call(token, 'saveCity', { countryId: idCountry, name: 'Ville test cdcd', timezone: 'Europe/Paris', center: { lat: 48.6, lng: 6.1 }, serviceHours: hours, reason: 'Test cdcd : création de ville' });
    const cityDoc = (await db.doc(`cities/${city.cityId}`).get()).data();
    const cityAudit = await auditOf('city.created', city.cityId);
    check('Ville — créée inactive avec motif (saveCity)', cityDoc.active === false && cityAudit[0]?.reason === 'Test cdcd : création de ville');
    await expectError('Ville — motif obligatoire', call(token, 'saveCity', { countryId: idCountry, name: 'Autre ville cdcd', timezone: 'Europe/Paris', center: { lat: 48.6, lng: 6.1 }, serviceHours: hours }), 'INVALID_ARGUMENT');
    await call(token, 'updateAdminRole', roleBody());
    const scoped = (await db.doc(`admins/${SUPPORT}`).get()).data();
    check('Périmètre pays — un administrateur limité à un pays est ramené aux villes du pays', JSON.stringify(scoped.cityIds) === JSON.stringify([city.cityId]), JSON.stringify(scoped.cityIds));
    const city2 = await call(token, 'saveCity', { countryId: idCountry, name: 'Seconde ville cdcd', timezone: 'Europe/Paris', center: { lat: 48.7, lng: 6.2 }, serviceHours: hours, reason: 'Test cdcd : seconde ville' });
    const after = (await db.doc(`admins/${SUPPORT}`).get()).data();
    check('Périmètre pays — une nouvelle ville du pays entre dans le périmètre de l’administrateur', after.cityIds.includes(city2.cityId), JSON.stringify(after.cityIds));
  } finally {
    await db.doc(`countries/${idCountry}`).delete().catch(() => undefined);
    for (const d of (await db.collection('cities').where('countryId', '==', idCountry).get()).docs) await d.ref.delete();
    await db.doc(`admins/${SUPPORT}`).update({ cityIds: [], countryIds: [] }).catch(() => undefined);
  }
};

scenarios.branding = async () => {
  const token = tokens.get(SUPER);
  const before = (await db.doc('settings/branding').get()).data();
  const data = { logo: before.logo ?? null, logoDark: before.logoDark ?? null, favicon: before.favicon ?? null, colors: { ...before.colors, accent: '#123456' } };
  try {
    await expectError('Marque — motif obligatoire', call(token, 'updatePlatformSettings', { doc: 'branding', data }), 'INVALID_ARGUMENT');
    await expectError('Marque — couleur invalide refusée', call(token, 'updatePlatformSettings', { doc: 'branding', reason: 'Test cdcd', data: { ...data, colors: { ...data.colors, primary: 'orange' } } }), 'INVALID_ARGUMENT');
    await call(token, 'updatePlatformSettings', { doc: 'branding', reason: 'Test cdcd : couleur d’accent', data });
    check('Marque — enregistrée par la fonction', (await db.doc('settings/branding').get()).get('colors.accent') === '#123456');
    const hist = (await db.collection('settingsHistory').where('docPath', '==', 'settings/branding').get()).docs.map((d) => d.data()).sort((a, b) => b.changedAt.toMillis() - a.changedAt.toMillis())[0];
    check('Marque — historique (ancienne et nouvelle valeur, motif)', hist?.reason === 'Test cdcd : couleur d’accent' && hist.changedFields.includes('colors'));
    check('Marque — écriture directe refusée par les règles', (await patchField(token, 'settings/branding')) === 403);
  } finally {
    await db.doc('settings/branding').set(before);
  }
};

scenarios.pos = async () => {
  const token = tokens.get(SUPER);
  const originalFlag = (await db.doc('featureFlags/pos_integration').get()).data();
  const base = { restaurantId: RES, provider: 'generic_webhook', label: 'Caisse test cdcd', pushOrders: true, reason: 'Test cdcd : caisse' };
  const ids = [];
  try {
    await expectError('Caisse — refusée tant que l’interrupteur « Intégration caisse » est éteint', call(token, 'savePosConnection', { ...base, webhookUrl: 'https://postman-echo.com/post' }), 'FAILED_PRECONDITION', 'Intégration caisse');
    await call(token, 'setFeatureFlag', { key: 'pos_integration', enabled: originalFlag?.enabled ?? false, overrides: [{ scope: 'restaurant', scopeId: RES, enabled: true }], reason: 'Test cdcd : caisse', description: originalFlag?.description });
    // Cache serveur des interrupteurs (10 s) : on laisse le temps au changement de se propager avant de tester.
    await sleep(12_000);
    for (const url of ['http://postman-echo.com/post', 'https://localhost/hook', 'https://127.0.0.1/hook', 'https://10.1.2.3/hook', 'https://192.168.1.10/hook', 'https://169.254.169.254/latest', 'https://metadata.google.internal/x', 'ftp://exemple.fr/x']) {
      await expectError(`Caisse — adresse refusée : ${url}`, call(token, 'savePosConnection', { ...base, webhookUrl: url }), 'INVALID_ARGUMENT');
    }
    const ok = await call(token, 'savePosConnection', { ...base, webhookUrl: 'https://postman-echo.com/post' });
    ids.push(ok.connectionId);
    check('Caisse — connexion créée, secret de signature montré une fois', typeof ok.secret === 'string' && ok.secret.startsWith('pos_'));
    const doc = (await db.doc(`posConnections/${ok.connectionId}`).get()).data();
    check('Caisse — le secret n’est pas dans la connexion lisible', !JSON.stringify(doc).includes(ok.secret) && (await db.doc(`posConnections/${ok.connectionId}/private/signing`).get()).get('secret') === ok.secret);
    check('Caisse — le secret est inaccessible aux clients (règles)', (await rest(token, 'GET', `posConnections/${ok.connectionId}/private/signing`)) === 403);
    const ping = await call(token, 'testPosConnection', { connectionId: ok.connectionId, reason: 'Test cdcd : essai' });
    check('Caisse — événement de test signé reçu (état « connectée »)', ping.ok === true && (await db.doc(`posConnections/${ok.connectionId}`).get()).get('status') === 'connected', JSON.stringify(ping));
    const order = await place();
    const delivered = await until(async () => {
      const snap = await db.collection(`posConnections/${ok.connectionId}/deliveries`).where('orderId', '==', order.orderId).get();
      return snap.docs.find((d) => d.get('event') === 'order.created');
    }, 90_000, 3000);
    check('Caisse — commande transmise à la caisse (order.created, journal des envois)', Boolean(delivered) && delivered.get('ok') === true, delivered ? `HTTP ${delivered.get('httpStatus')}` : 'aucun envoi');
    await cancelOrder(order.orderId);
    const cancelledSent = await until(async () => {
      const snap = await db.collection(`posConnections/${ok.connectionId}/deliveries`).where('orderId', '==', order.orderId).get();
      return snap.docs.find((d) => d.get('event') === 'order.cancelled');
    }, 90_000, 3000);
    check('Caisse — annulation transmise (order.cancelled)', Boolean(cancelledSent));
    // Caisse injoignable : erreur suivie, statut « en erreur » après trois échecs.
    const bad = await call(token, 'savePosConnection', { ...base, label: 'Caisse injoignable cdcd', webhookUrl: 'https://cdcd-caisse-injoignable.invalid/hook' });
    ids.push(bad.connectionId);
    for (let i = 0; i < 3; i += 1) await call(token, 'testPosConnection', { connectionId: bad.connectionId, reason: 'Test cdcd : caisse injoignable' });
    const badDoc = (await db.doc(`posConnections/${bad.connectionId}`).get()).data();
    check('Caisse injoignable — erreur consignée et statut « en erreur » après 3 échecs', badDoc.status === 'error' && Boolean(badDoc.lastError) && badDoc.failedCount >= 3, `${badDoc.status} : ${badDoc.lastError}`);
    await call(token, 'disconnectPosConnection', { connectionId: ok.connectionId, reason: 'Test cdcd : déconnexion' });
    const order2 = await place();
    await sleep(20_000);
    const after = await db.collection(`posConnections/${ok.connectionId}/deliveries`).where('orderId', '==', order2.orderId).get();
    check('Caisse déconnectée — plus aucune commande transmise', after.empty);
    await cancelOrder(order2.orderId);
    check('Caisse — audit de création, test et déconnexion', (await auditOf('pos_connection.created')).length > 0 && (await auditOf('pos_connection.tested')).length > 0 && (await auditOf('pos_connection.disconnected')).length > 0);
  } finally {
    if (originalFlag) await db.doc('featureFlags/pos_integration').set(originalFlag);
    for (const id of ids) await db.recursiveDelete(db.doc(`posConnections/${id}`)).catch(() => undefined);
  }
};

scenarios.security = async () => {
  const token = tokens.get(SUPER);
  const current = (await db.doc('settings/security').get()).data();
  // Alerte « connexion inhabituelle » : la plage horaire est réglable ; nouvelle session sur une plage couvrant l'heure courante.
  const hour = Number(new Intl.DateTimeFormat('fr-FR', { hour: 'numeric', hourCycle: 'h23', timeZone: 'Europe/Paris' }).format(new Date()));
  const before = (await db.collection('securityAlerts').where('adminId', '==', SUPER).get()).size;
  await db.doc('settings/security').set({ ...current, unusualLoginHours: { fromHour: hour, toHour: (hour + 3) % 24 } });
  try {
    const t = await relogin(SUPER);
    await call(t, 'trackAdminSession', {});
    await call(await relogin(SUPER), 'trackAdminSession', {});
    const alerts = await db.collection('securityAlerts').where('adminId', '==', SUPER).where('type', '==', 'unusual_login').get();
    check('Alerte « connexion inhabituelle » levée dans la plage horaire réglée', alerts.size > 0, `${alerts.size} alerte(s) unusual_login`);
  } finally {
    await db.doc('settings/security').set(current);
  }
  // Échecs de vérification : seuil réglable (ici 2 par heure) sur un compte enrôlé jetable.
  const mfaToken = await relogin(MFAADM);
  await call(mfaToken, 'trackAdminSession', {});
  await db.doc('settings/security').set({ ...current, alerts: { ...(current.alerts ?? {}), failedLoginsPerHour: 2 } });
  try {
    for (let i = 0; i < 2; i += 1) await call(mfaToken, 'verifyTotp', { code: '000000', method: 'totp' }).catch(() => undefined);
    await sleep(2000);
    const failed = await db.collection('securityAlerts').where('adminId', '==', MFAADM).where('type', '==', 'failed_logins').get();
    check('Alerte « connexions échouées » levée au-delà du seuil réglé', !failed.empty);
  } finally {
    await db.doc('settings/security').set(current);
  }
  // La double authentification obligatoire ne peut pas être désactivée quand elle est exigée.
  if (current.requireMfaForAdmins === true) {
    await expectError('Politique — désactiver la double authentification obligatoire refusé', call(token, 'updatePlatformSettings', { doc: 'security', reason: 'Test cdcd', data: { requireMfaForAdmins: false, mfaEnforcedFrom: null, adminSessionMaxHours: 12, mfaMaxAttempts: 5, mfaLockMinutes: 15, alertOnNewDevice: true, unusualLoginHours: { fromHour: 0, toHour: 5 }, alerts: { massExportRows: 5000, refundsPerAgentPerHour: 15, failedLoginsPerHour: 8 } } }), 'FAILED_PRECONDITION', 'obligatoire');
  }
};

// ------------------------------------------------------------------ Nettoyage et exécution

async function cleanup() {
  for (const id of created.orders) {
    const o = await db.doc(`orders/${id}`).get().catch(() => null);
    if (o?.exists) await o.ref.delete().catch(() => undefined);
  }
  for (const path of created.docs) await db.doc(path).delete().catch(() => undefined);
  for (const col of ['promotionRedemptions']) {
    const snap = await db.collection(col).where('userId', '==', CLIENT).get().catch(() => null);
    if (snap) await Promise.all(snap.docs.map((d) => d.ref.delete()));
  }
  // Mouvements d'argent créés par les avoirs de test (jamais laissés dans le grand livre).
  for (const [col, field, values] of [
    ['ledgerEntries', 'createdBy', [SUPPORT, SUPER]],
    ['ledgerEntries', 'accountId', [CLIENT]],
    ['walletTransactions', 'userId', [CLIENT]],
    ['walletTransactions', 'createdBy', [SUPPORT]],
    ['orders', 'customerId', [CLIENT]],
  ]) {
    for (const v of values) {
      const snap = await db.collection(col).where(field, '==', v).get().catch(() => null);
      if (snap) await Promise.all(snap.docs.map((d) => d.ref.delete()));
    }
  }
  for (const uid of [SUPER, SUPPORT, MFAADM, CITYMGR]) {
    await db.recursiveDelete(db.doc(`adminSecrets/${uid}`)).catch(() => undefined);
    const sessions = await db.collection('adminSessions').where('adminId', '==', uid).get().catch(() => null);
    if (sessions) await Promise.all(sessions.docs.map((d) => d.ref.delete()));
    const alerts = await db.collection('securityAlerts').where('adminId', '==', uid).get().catch(() => null);
    if (alerts) await Promise.all(alerts.docs.map((d) => d.ref.delete()));
  }
  for (const col of ['restaurants']) {
    for (const sub of ['products', 'settings', 'private', 'members']) {
      const snap = await db.collection(col).doc(RES).collection(sub).get().catch(() => null);
      if (snap) await Promise.all(snap.docs.map((d) => d.ref.delete()));
    }
  }
  for (const uid of created.authUsers) await auth.deleteUser(uid).catch(() => undefined);
}

async function main() {
  const run = (name) => only.length === 0 || only.includes(name);
  try {
    await makeAdmin(SUPER, 'super_admin', { permissions: [] });
    await makeAdmin(SUPPORT, 'support');
    await makeAdmin(MFAADM, 'support');
    await setupRestaurant();
    for (const [name, fn] of Object.entries(scenarios)) {
      if (!run(name)) continue;
      console.log(`\n== ${name}`);
      try {
        await fn();
      } catch (error) {
        record(`${name} — exécution`, false, error instanceof Error ? error.message : String(error));
      }
    }
  } finally {
    await cleanup();
  }
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} vérifications réussies.`);
  if (failed.length) {
    console.log('Échecs :');
    for (const f of failed) console.log(` - ${f.name}${f.detail ? ` — ${f.detail}` : ''}`);
  }
  process.exit(failed.length ? 1 : 0);
}

main();
