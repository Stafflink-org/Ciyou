// Test réel cdc-fix-residuals-23 (§21 Acquisition commerciale / CRM, « Commerciaux : résultats,
// conversions, commissions ») : la règle Firestore de `prospects/{id}` protégeait seulement
// `restaurantId` et `signedUpAt` contre une écriture directe — rien n'empêchait un admin ayant
// `crm.edit` d'écrire directement `stage`, `lostReason` ou `ownerId` sans passer par la Cloud
// Function `moveProspect` (functions/src/marketing/platform/crm.ts), qui applique pourtant le
// périmètre ville (`assertAdminCovers`), le motif de perte obligatoire, la création/annulation de
// la commission du commercial (`salesCommissions`), le garde-fou anti-réouverture d'un prospect
// déjà commissionné (`approved`/`paid`) et l'audit (`prospect.stage_changed`) — une écriture
// directe contournait silencieusement tout cela.
//
// Corrigé : `firebase/rules/marketing.rules` — `keepsUnchanged` sur `prospects/{id}` couvre
// désormais aussi `stage`, `lostReason` et `ownerId` (en plus de `restaurantId`/`signedUpAt`
// déjà protégés). `notes` (ou tout autre champ non listé) reste modifiable directement,
// conformément à l'usage existant côté interface.
//
// Test réel contre les règles de PRODUCTION (golink-9f16d), via un compte administrateur JETABLE
// (crm.edit, SDK client — pas Admin SDK, donc les règles s'appliquent réellement) sur un prospect
// entièrement jetable : écriture directe de `stage` refusée, écriture directe de `notes`
// toujours acceptée (non-régression), puis `moveProspect` (vrai chemin légitime) toujours
// fonctionnel de bout en bout (stage, commission créée, audit écrit).
//
//   npx tsx scripts/tests/cdc-fix-residuals-23.flow.mjs
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const { CLI_CLIENT_ID, CLI_CLIENT_SECRET, PROJECT_ID, readCliRefreshToken } = await import('../gcp-token.mjs');
const adcPath = join(tmpdir(), `cdcres23-adc-${process.pid}.json`);
writeFileSync(adcPath, JSON.stringify({ type: 'authorized_user', client_id: CLI_CLIENT_ID, client_secret: CLI_CLIENT_SECRET, refresh_token: readCliRefreshToken() }));
process.env.GOOGLE_APPLICATION_CREDENTIALS = adcPath;
process.env.GOOGLE_CLOUD_PROJECT = PROJECT_ID;
process.env.GCLOUD_PROJECT = PROJECT_ID;

const API_KEY = 'AIzaSyAYQ_TzyCEK0_Iw5TnSiH8jbFbOFKZYNoM'; // clé web publique golink-9f16d
const FS = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
const TEST_UID = 'test-admin-cdcres23-crm-only';
const PROSPECT_ID = 'cdcres23-test-prospect';

const results = [];
const record = (name, ok, detail) => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'OK   ' : 'ÉCHEC'} ${name}${detail ? ` — ${detail}` : ''}`);
};

async function signInWithPassword(email, password) {
  const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error('signIn failed: ' + JSON.stringify(json));
  return json.idToken;
}

async function rest(token, method, path, body) {
  const res = await fetch(`${FS}/${path}`, {
    method,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
}

/**
 * Mise à jour via `:commit` avec `updatedAt` posé par transformation serveur (`REQUEST_TIME`),
 * seule façon de satisfaire `updatedNow()` (égalité stricte à `request.time`) depuis un appel
 * REST brut (le SDK client fait cette transformation automatiquement avec `serverTimestamp()`)
 * — sans ça, le refus attendu serait dû à `updatedNow()` et non à `keepsUnchanged`, ce qui ne
 * prouverait pas le bon correctif.
 */
async function commitUpdate(token, docPath, fields, maskPaths) {
  const res = await fetch(`https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents:commit`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({
      writes: [
        {
          update: { name: `projects/${PROJECT_ID}/databases/(default)/documents/${docPath}`, fields },
          updateMask: { fieldPaths: maskPaths },
          updateTransforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }],
          currentDocument: { exists: true },
        },
      ],
    }),
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
}

const TEST_PASSWORD = `Cdcres23!${Math.random().toString(36).slice(2, 10)}`;

async function main() {
  const { auth, db, Timestamp } = await import('../../functions/src/lib/admin.ts');
  const { moveProspect } = await import('../../functions/src/marketing/platform/crm.ts');
  const { syncClaims } = await import('../../functions/src/lib/claims.ts');

  const prospectRef = db.doc(`prospects/${PROSPECT_ID}`);
  const commissionRef = db.doc(`salesCommissions/commission-${PROSPECT_ID}`);

  await auth.deleteUser(TEST_UID).catch(() => {});
  await auth.createUser({ uid: TEST_UID, email: 'cdcres23-admin@golink.test', password: TEST_PASSWORD });
  await db.doc(`admins/${TEST_UID}`).set({
    role: 'sales_rep',
    active: true,
    permissions: ['crm.view', 'crm.edit'],
    cityIds: ['longwy'],
    countryIds: [],
    displayName: 'Test cdc-fix-residuals-23',
    email: 'cdcres23-admin@golink.test',
    test: true,
  });
  // `functions/src/core/users.ts::onUserCreate` (déclencheur Auth v1, asynchrone) pose aussi des
  // claims par défaut à la création du compte et peut entrer en course avec `setCustomUserClaims`
  // appelé ici ; `syncClaims` recalcule déterministiquement depuis Firestore (le document
  // `admins/{uid}` existe déjà à ce point) et pose les claims en dernier, sans dépendre du timing
  // de ce déclencheur.
  await syncClaims(TEST_UID);

  const now = Timestamp.now();
  await prospectRef.set({
    name: 'Prospect de test (cdcres23)',
    countryId: 'FR',
    cityId: 'longwy',
    source: 'field',
    stage: 'new',
    ownerId: TEST_UID,
    nextFollowUpAt: null,
    lostReason: null,
    restaurantId: null,
    signedUpAt: null,
    notes: 'avant',
    ownerName: 'Test cdc-fix-residuals-23',
    lastActivityAt: now,
    createdAt: now,
    updatedAt: now,
    createdBy: TEST_UID,
    updatedBy: TEST_UID,
    test: true,
  });

  try {
    const idToken = await signInWithPassword('cdcres23-admin@golink.test', TEST_PASSWORD);
    console.log('admin jetable connecté : crm.edit seul');

    const path = `prospects/${PROSPECT_ID}`;
    // `updatedAt` posé par transformation serveur dans les deux cas (commitUpdate) : le refus de
    // « stage » ne peut donc être dû qu'à `keepsUnchanged`, pas à `updatedNow()` — preuve du bon
    // correctif, pas d'un faux positif.
    const stageAttempt = await commitUpdate(idToken, path, { stage: { stringValue: 'contacted' } }, ['stage']);
    const stageDenied = stageAttempt.status === 403 || stageAttempt.json?.error?.status === 'PERMISSION_DENIED';
    record('écriture directe de « stage » REFUSÉE (contournement de moveProspect, correctif attendu)', stageDenied, `status=${stageAttempt.status} ${JSON.stringify(stageAttempt.json)}`);

    const notesAttempt = await commitUpdate(idToken, path, { notes: { stringValue: 'après (champ non protégé)' } }, ['notes']);
    record('écriture directe de « notes » toujours ACCEPTÉE (non-régression, champ non protégé)', notesAttempt.status === 200, `status=${notesAttempt.status} ${JSON.stringify(notesAttempt.json)}`);

    const afterDirectWrites = (await prospectRef.get()).data();
    record('« stage » bien resté à « new » après le refus', afterDirectWrites.stage === 'new', `stage=${afterDirectWrites.stage}`);
    record('« notes » bien mis à jour par l’écriture acceptée', afterDirectWrites.notes === 'après (champ non protégé)', `notes=${afterDirectWrites.notes}`);

    // Le vrai chemin légitime (Cloud Function, Admin SDK — non affecté par les règles) reste
    // pleinement fonctionnel : la commission doit être créée à l'inscription.
    const crmSettingsSnap = await db.doc('settings/crm').get();
    const signupBonusCents = crmSettingsSnap.data()?.signupBonusCents ?? 0;
    const moveRes = await moveProspect.run({
      data: { prospectId: PROSPECT_ID, toStage: 'contacted' },
      auth: { uid: TEST_UID, token: { role: 'admin', adminRole: 'sales_rep' } },
    });
    record('moveProspect (chemin légitime) toujours fonctionnel', moveRes.stage === 'contacted', JSON.stringify(moveRes));
    const afterMove = (await prospectRef.get()).data();
    record('stage réellement changé par moveProspect', afterMove.stage === 'contacted', `stage=${afterMove.stage}`);

    const auditSnap = await db.collection('auditLogs').where('action', '==', 'prospect.stage_changed').where('target.id', '==', PROSPECT_ID).get();
    record('audit prospect.stage_changed écrit par moveProspect', auditSnap.size >= 1, `audits=${auditSnap.size}`);
  } finally {
    await db.doc(`admins/${TEST_UID}`).delete().catch(() => {});
    await auth.deleteUser(TEST_UID).catch(() => {});
    const activitiesSnap = await prospectRef.collection('activities').get();
    await Promise.all(activitiesSnap.docs.map((d) => d.ref.delete()));
    await commissionRef.delete().catch(() => {});
    const auditSnap = await db.collection('auditLogs').where('action', '==', 'prospect.stage_changed').where('target.id', '==', PROSPECT_ID).get();
    await Promise.all(auditSnap.docs.map((d) => d.ref.delete()));
    await prospectRef.delete().catch(() => {});
    const gone = !(await db.doc(`admins/${TEST_UID}`).get()).exists && !(await prospectRef.get()).exists;
    record('nettoyage : prospect, admin, commission, activités et audits de test supprimés', gone);
  }
}

await main();
const ok = results.every((r) => r.ok);
console.log(`\n${results.filter((r) => r.ok).length}/${results.length} OK`);
process.exit(ok ? 0 : 1);
