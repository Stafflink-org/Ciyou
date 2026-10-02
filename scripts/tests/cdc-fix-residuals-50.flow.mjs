// Test réel cdc-fix-residuals-50 (§25 Connexions logiciels externes, §26 Administrateurs
// internes, §27 Sécurité et journal d'audit — 4 bugs trouvés en auditant ces rubriques) :
//
// 1. `posConnections` (connexion caisse d'un restaurant) : règle Firestore et les 3 Cloud
//    Functions (`savePosConnection`/`testPosConnection`/`disconnectPosConnection`) ne vérifiaient
//    que la permission `integrations.view`/`integrations.edit`, jamais la ville du restaurant —
//    un admin restreint pouvait lire/modifier/tester/couper la connexion caisse (webhook, URL) de
//    n'importe quel restaurant hors de son périmètre. Corrigé (`isAdminIn`/`assertAdminCovers`).
//
// 2. SSRF sur le webhook caisse : `assertPublicHttpsUrl` ne refusait qu'une IP littérale privée ou
//    un suffixe de nom connu (`.local`, `localhost`…) — un nom de domaine PUBLIC dont
//    l'enregistrement DNS pointe vers une IP privée ou le serveur de métadonnées cloud
//    (169.254.169.254) le traversait sans contrôle. Corrigé : résolution DNS réelle avant
//    enregistrement ET avant chaque envoi (`assertResolvesToPublicIp`).
//
// 3. `/auditLogs` (journal d'audit) : lisible par tout titulaire de `audit.view`, sans aucune
//    borne de ville, alors que les entrées portent un `cityId` réel (contrairement à
//    `platformAlerts`, juste à côté dans le même fichier, qui applique déjà ce scoping). Même
//    trou dans `exportAuditLogs` (export CSV). Corrigé (règle + filtre côté fonction).
//
// 4. `updateAdminRole` : le garde-fou « vous ne pouvez pas modifier votre propre rôle » ne
//    couvrait que `role`/`active` — un titulaire de `admins.manage` pouvait s'appeler lui-même
//    pour élargir son propre périmètre (cityIds/countryIds) ou relever son propre plafond de
//    remboursement personnel. Aggravant : `refundLimitOf` retournait ce plafond personnel SANS le
//    borner par `settings/refunds.approvalThresholdCents` (contrairement au plafond par défaut du
//    rôle). Les deux corrigés.
//
//   npx tsx scripts/tests/cdc-fix-residuals-50.flow.mjs
import { randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Timestamp } from '@google-cloud/firestore';
import { auth, db } from '../lib/admin.mjs';
import { CLI_CLIENT_ID, CLI_CLIENT_SECRET, PROJECT_ID, readCliRefreshToken } from '../gcp-token.mjs';

const adcPath = join(tmpdir(), `cdcres50-adc-${process.pid}.json`);
writeFileSync(adcPath, JSON.stringify({ type: 'authorized_user', client_id: CLI_CLIENT_ID, client_secret: CLI_CLIENT_SECRET, refresh_token: readCliRefreshToken() }));
process.env.GOOGLE_APPLICATION_CREDENTIALS = adcPath;
process.env.GOOGLE_CLOUD_PROJECT = PROJECT_ID;
process.env.GCLOUD_PROJECT = PROJECT_ID;
const { syncClaims } = await import('../../functions/src/lib/claims.ts');

const API_KEY = 'AIzaSyAYQ_TzyCEK0_Iw5TnSiH8jbFbOFKZYNoM';
const FN_BASE = 'https://europe-west1-golink-9f16d.cloudfunctions.net';
const FS = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

const results = [];
function record(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'OK   ' : 'ÉCHEC'} ${name}${detail ? ` — ${detail}` : ''}`);
}
const check = (name, condition, detail) => record(name, Boolean(condition), detail);
const now = () => Timestamp.now();

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
async function call(token, name, data) {
  const res = await fetch(`${FN_BASE}/${name}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ data }),
  });
  const body = await res.json().catch(() => ({}));
  if (res.ok) return body.result;
  const error = new Error(body.error?.message ?? `HTTP ${res.status}`);
  error.status = body.error?.status;
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
async function restGet(token, path) {
  const res = await fetch(`${FS}/${path}`, { headers: { authorization: `Bearer ${token}` } });
  return { status: res.status, json: await res.json() };
}
const allowed = (res) => res.status === 200 && !res.json?.error;
const denied = (res) => res.status === 403 || res.json?.error?.status === 'PERMISSION_DENIED';

async function createAdmin(uid, email, { role = 'ops', permissions = [], cityIds = [], countryIds = [], refundLimitCents = null } = {}) {
  const password = `${randomBytes(18).toString('base64url')}Aa1`;
  await auth.deleteUser(uid).catch(() => {});
  await auth.createUser({ uid, email, password, emailVerified: true, displayName: uid });
  await db.doc(`admins/${uid}`).set({ role, active: true, permissions, cityIds, countryIds, refundLimitCents, displayName: uid, email, test: true, createdAt: now(), updatedAt: now(), updatedBy: 'system' });
  await syncClaims(uid);
  return { password, token: await loginPassword(email, password) };
}
async function cleanupAdmin(uid) {
  await Promise.all([`admins/${uid}`, `users/${uid}`, `userPrivate/${uid}`].map((p) => db.doc(p).delete().catch(() => {})));
  await auth.deleteUser(uid).catch(() => {});
}

// ------------------------------------------------------------------ 1+2. posConnections (ville + SSRF)

async function testPosConnections() {
  const CITY_IN = 'cdcres50-ville-in';
  const CITY_OUT = 'cdcres50-ville-out';
  const RES_IN = 'cdcres50-resto-in';
  const RES_OUT = 'cdcres50-resto-out';
  const ADMIN_UID = 'cdcres50-admin-pos';

  await db.doc(`cities/${CITY_IN}`).set({ name: 'Test IN', slug: CITY_IN, countryId: 'FR', active: true, test: true, managerIds: [] });
  await db.doc(`cities/${CITY_OUT}`).set({ name: 'Test OUT', slug: CITY_OUT, countryId: 'FR', active: true, test: true, managerIds: [] });
  await db.doc(`restaurants/${RES_IN}`).set({ name: 'CDCRES50 IN', cityId: CITY_IN, countryId: 'FR', status: 'active', onboardingStatus: 'approved', test: true, createdAt: now(), updatedAt: now(), updatedBy: 'system' });
  await db.doc(`restaurants/${RES_OUT}`).set({ name: 'CDCRES50 OUT', cityId: CITY_OUT, countryId: 'FR', status: 'active', onboardingStatus: 'approved', test: true, createdAt: now(), updatedAt: now(), updatedBy: 'system' });
  await db.doc('featureFlags/pos_integration').set({ key: 'pos_integration', description: 'Caisse', enabled: true, overrides: [], updatedAt: now(), updatedBy: 'system' }, { merge: true });
  await db.doc('posConnections/cdcres50-conn-in').set({ restaurantId: RES_IN, provider: 'generic_webhook', status: 'pending', syncMenu: false, pushOrders: true, errorCount24h: 0, test: true, createdAt: now(), createdBy: 'system', updatedAt: now(), updatedBy: 'system' });
  await db.doc('posConnections/cdcres50-conn-out').set({ restaurantId: RES_OUT, provider: 'generic_webhook', status: 'pending', syncMenu: false, pushOrders: true, errorCount24h: 0, test: true, createdAt: now(), createdBy: 'system', updatedAt: now(), updatedBy: 'system' });

  const { token } = await createAdmin(ADMIN_UID, 'cdcres50-admin-pos@golink.test', { permissions: ['integrations.view', 'integrations.edit'], cityIds: [CITY_IN] });

  try {
    const resIn = await restGet(token, 'posConnections/cdcres50-conn-in');
    check('posConnections : lecture directe DANS le périmètre (ville IN) autorisée', allowed(resIn), `status=${resIn.status}`);
    const resOut = await restGet(token, 'posConnections/cdcres50-conn-out');
    check('posConnections : lecture directe HORS périmètre (ville OUT) REFUSÉE (correctif attendu)', denied(resOut), `status=${resOut.status}`);

    await expectError(
      'savePosConnection : création sur un restaurant HORS périmètre REFUSÉE (correctif attendu)',
      call(token, 'savePosConnection', { restaurantId: RES_OUT, provider: 'generic_webhook', label: null, webhookUrl: 'https://example.com/webhook', externalLocationId: null, pushOrders: true, reason: 'Test cdcres50' }),
      'périmètre',
    );
    await expectError(
      'testPosConnection : test sur une connexion HORS périmètre REFUSÉE (correctif attendu)',
      call(token, 'testPosConnection', { connectionId: 'cdcres50-conn-out', reason: 'Test cdcres50' }),
      'périmètre',
    );
    await expectError(
      'disconnectPosConnection : coupure d’une connexion HORS périmètre REFUSÉE (correctif attendu)',
      call(token, 'disconnectPosConnection', { connectionId: 'cdcres50-conn-out', reason: 'Test cdcres50' }),
      'périmètre',
    );

    // --- SSRF : domaine public dont le DNS pointe vers le serveur de métadonnées cloud (nip.io, wildcard DNS réel).
    await expectError(
      'savePosConnection : webhook dont le DNS résout vers 169.254.169.254 (métadonnées cloud) REFUSÉ (correctif attendu)',
      call(token, 'savePosConnection', { restaurantId: RES_IN, provider: 'generic_webhook', label: null, webhookUrl: 'https://169.254.169.254.nip.io/latest/meta-data/', externalLocationId: null, pushOrders: true, reason: 'Test cdcres50 SSRF' }),
      'publique',
    );
    await expectError(
      'savePosConnection : webhook dont le DNS résout vers une IP privée (10.x via nip.io) REFUSÉ (correctif attendu)',
      call(token, 'savePosConnection', { restaurantId: RES_IN, provider: 'generic_webhook', label: null, webhookUrl: 'https://10.1.2.3.nip.io/x', externalLocationId: null, pushOrders: true, reason: 'Test cdcres50 SSRF 2' }),
      'publique',
    );
    // Non-régression : un domaine public légitime passe toujours.
    const legit = await call(token, 'savePosConnection', { restaurantId: RES_IN, provider: 'generic_webhook', label: 'Test', webhookUrl: 'https://example.com/webhook', externalLocationId: null, pushOrders: true, reason: 'Test cdcres50 non-regression' });
    check('non-régression : webhook public légitime (example.com) accepté', Boolean(legit?.connectionId), JSON.stringify(legit));
    if (legit?.connectionId) await db.doc(`posConnections/${legit.connectionId}`).delete().catch(() => {});
    await db.doc(`posConnections/${legit?.connectionId}/private/signing`).delete().catch(() => {});
  } finally {
    const paths = [
      `cities/${CITY_IN}`, `cities/${CITY_OUT}`, `restaurants/${RES_IN}`, `restaurants/${RES_OUT}`,
      'posConnections/cdcres50-conn-in', 'posConnections/cdcres50-conn-out', 'featureFlags/pos_integration',
    ];
    await Promise.all(paths.map((p) => db.doc(p).delete().catch(() => {})));
    await cleanupAdmin(ADMIN_UID);
  }
}

// ------------------------------------------------------------------ 3. auditLogs (ville)

async function testAuditLogsScope() {
  const CITY_IN = 'cdcres50-ville-audit-in';
  const CITY_OUT = 'cdcres50-ville-audit-out';
  const ADMIN_UID = 'cdcres50-admin-audit';
  await db.doc(`cities/${CITY_IN}`).set({ name: 'Test audit IN', slug: CITY_IN, countryId: 'FR', active: true, test: true, managerIds: [] });
  await db.doc(`cities/${CITY_OUT}`).set({ name: 'Test audit OUT', slug: CITY_OUT, countryId: 'FR', active: true, test: true, managerIds: [] });
  const base = { actor: { uid: 'system', type: 'system', name: 'Système' }, action: 'cdcres50.test', target: { type: 'city', id: 'x', label: 'x' }, at: now(), test: true };
  await db.doc('auditLogs/cdcres50-log-in').set({ ...base, cityId: CITY_IN, countryId: 'FR' });
  await db.doc('auditLogs/cdcres50-log-out').set({ ...base, cityId: CITY_OUT, countryId: 'FR' });
  await db.doc('auditLogs/cdcres50-log-platform').set({ ...base, cityId: null, countryId: null });

  const { token } = await createAdmin(ADMIN_UID, 'cdcres50-admin-audit@golink.test', { permissions: ['audit.view'], cityIds: [CITY_IN] });
  try {
    const resIn = await restGet(token, 'auditLogs/cdcres50-log-in');
    check('auditLogs : lecture directe DANS le périmètre (ville IN) autorisée', allowed(resIn), `status=${resIn.status}`);
    const resOut = await restGet(token, 'auditLogs/cdcres50-log-out');
    check('auditLogs : lecture directe HORS périmètre (ville OUT) REFUSÉE (correctif attendu)', denied(resOut), `status=${resOut.status}`);
    const resPlatform = await restGet(token, 'auditLogs/cdcres50-log-platform');
    check('auditLogs : entrée sans ville (plateforme/pays) toujours lisible (non-régression)', allowed(resPlatform), `status=${resPlatform.status}`);

    const from = Date.now() - 60_000;
    const to = Date.now() + 60_000;
    const exported = await call(token, 'exportAuditLogs', { from, to, actionPrefix: 'cdcres50.', actorUid: null, targetType: null, sensitiveOnly: false, search: null, reason: 'Test cdcres50 export' });
    const csv = exported?.contentBase64 ? Buffer.from(exported.contentBase64, 'base64').toString('utf8') : '';
    check('exportAuditLogs : l’entrée hors périmètre (ville OUT) est absente de l’export (correctif attendu)', !csv.includes(CITY_OUT), 'CITY_OUT trouvé dans le CSV');
    check('exportAuditLogs : l’entrée dans le périmètre (ville IN) est présente dans l’export', csv.includes(CITY_IN), 'CITY_IN absent du CSV');
  } finally {
    const paths = [`cities/${CITY_IN}`, `cities/${CITY_OUT}`, 'auditLogs/cdcres50-log-in', 'auditLogs/cdcres50-log-out', 'auditLogs/cdcres50-log-platform'];
    await Promise.all(paths.map((p) => db.doc(p).delete().catch(() => {})));
    await cleanupAdmin(ADMIN_UID);
  }
}

// ------------------------------------------------------------------ 4. updateAdminRole (auto-élévation) + refundLimitOf

async function testAdminSelfEscalation() {
  const SUPER_UID = 'cdcres50-super';
  const TARGET_UID = 'cdcres50-self-target';
  const { token: superToken } = await createAdmin(SUPER_UID, 'cdcres50-super@golink.test', { role: 'super_admin', permissions: [] });

  const settingsRef = db.doc('settings/refunds');
  const previousSettings = (await settingsRef.get()).data() ?? null;
  await settingsRef.set({ ...(previousSettings ?? {}), approvalThresholdCents: 5000, updatedAt: now(), updatedBy: 'system' }, { merge: true });

  const { token: targetToken } = await createAdmin(TARGET_UID, 'cdcres50-self-target@golink.test', {
    role: 'ops', permissions: ['admins.manage'], cityIds: ['cdcres50-ville-self'], countryIds: [], refundLimitCents: null,
  });
  await db.doc('cities/cdcres50-ville-self').set({ name: 'Test self', slug: 'cdcres50-ville-self', countryId: 'FR', active: true, test: true, managerIds: [] });

  try {
    // --- Auto-élévation refusée : même rôle/actif, mais cityIds élargi (vide = toutes les villes).
    await expectError(
      'updateAdminRole : un admin ne peut pas élargir SON PROPRE périmètre de villes (correctif attendu)',
      call(targetToken, 'updateAdminRole', { adminId: TARGET_UID, role: 'ops', cityIds: [], countryIds: [], refundLimitCents: null, active: true, reason: 'Test cdcres50 auto-élévation' }),
      'propre',
    );
    // --- Auto-élévation refusée : plafond de remboursement personnel relevé.
    await expectError(
      'updateAdminRole : un admin ne peut pas relever SON PROPRE plafond de remboursement (correctif attendu)',
      call(targetToken, 'updateAdminRole', { adminId: TARGET_UID, role: 'ops', cityIds: ['cdcres50-ville-self'], countryIds: [], refundLimitCents: 100_000_000, active: true, reason: 'Test cdcres50 auto-élévation plafond' }),
      'propre',
    );
    // --- Non-régression : un super admin PEUT modifier le périmètre d'un AUTRE admin.
    const editedByOther = await call(superToken, 'updateAdminRole', { adminId: TARGET_UID, role: 'ops', cityIds: ['cdcres50-ville-self'], countryIds: [], refundLimitCents: 50_000_000, active: true, reason: 'Test cdcres50 modification par un tiers' });
    check('non-régression : un super admin peut modifier le plafond d’un AUTRE admin', Boolean(editedByOther), JSON.stringify(editedByOther));

    // --- refundLimitOf : le plafond personnel (50 000 000) reste borné par le seuil plateforme (5000).
    const policy = await call(targetToken, 'getRefundPolicy', {});
    check(
      'getRefundPolicy : plafond personnel (50 000 000 c) borné par le seuil plateforme (5 000 c), pas de contournement (correctif attendu)',
      policy?.limitCents === 5000,
      `limitCents=${policy?.limitCents}`,
    );
  } finally {
    if (previousSettings) await settingsRef.set(previousSettings).catch(() => {});
    else await settingsRef.delete().catch(() => {});
    await db.doc('cities/cdcres50-ville-self').delete().catch(() => {});
    await cleanupAdmin(SUPER_UID);
    await cleanupAdmin(TARGET_UID);
  }
}

async function main() {
  await testPosConnections();
  await testAuditLogsScope();
  await testAdminSelfEscalation();
}

main()
  .catch((error) => record('exception', false, String(error.stack ?? error)))
  .finally(() => {
    const failed = results.filter((r) => !r.ok);
    console.log(`\n${results.length - failed.length}/${results.length} OK`);
    if (failed.length) {
      console.log('Échecs :');
      for (const f of failed) console.log(` - ${f.name} : ${f.detail}`);
      process.exitCode = 1;
    }
  });
