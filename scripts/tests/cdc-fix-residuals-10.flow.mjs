// Test réel cdc-fix-residuals-10 (§27 Sécurité et journal d'audit).
//
// L'audit documenté (docs/AUDIT_COUVERTURE_CDC.md §27, écrit 01/10 par cdc-fix-residuals-23)
// affirme trois défauts P0 encore ouverts. En relisant le code actuel (inchangé depuis le
// commit aaebf71 du 28/09, vérifié par `git log`), deux des trois se révèlent déjà FAUX :
//
//  A. « La double authentification de session n'est contrôlée que par les fonctions
//     platform/* (requireSecureAdmin) » — FAUX : requireSecureAdmin (functions/src/platform/
//     runtime.ts) n'est qu'un relais direct vers requireAdmin (functions/src/lib/permissions.ts),
//     qui appelle systématiquement assertAdminMfa pour TOUTE fonction d'administration (sauf
//     skipMfa, réservé à l'enrôlement/au suivi de session). Testé ici sur une fonction NON
//     platform (getSupportAgents, admin/experience/tickets.ts) : bloquée sans session vérifiée,
//     acceptée après un enrôlement + vérification TOTP réels.
//
//  B. « Le type d'alerte unusual_login est défini mais jamais levé » — FAUX : trackAdminSession
//     (functions/src/platform/security.ts:104-114) le lève déjà réellement (adresse réseau jamais
//     vue OU heure inhabituelle). Testé ici en configurant temporairement la fenêtre horaire
//     inhabituelle sur l'heure courante (restaurée après), deux connexions du même compte jetable.
//
//  C. « Le seuil failedLoginsPerHour est réglable mais jamais lu : le type failed_logins est du
//     code mort » — FAUX : verifyTotp (security.ts:265-279) le lève déjà réellement. Testé ici en
//     abaissant temporairement le seuil (restauré après) et en soumettant des codes TOTP erronés.
//     Défaut réel trouvé au passage et documenté (pas corrigé : réglage, pas un bug) : sous la
//     politique PAR DÉFAUT (mfaMaxAttempts=5 < alerts.failedLoginsPerHour=8), le verrouillage du
//     compte intervient toujours avant qu'une seule salve d'échecs atteigne le seuil d'alerte.
//
// Compte(s) administrateur JETABLES créés pour ce test, nettoyés en fin de script (succès ou
// échec). Le document settings/security est lu avant modification et réécrit à l'identique après.
// Jamais de mot de passe de compte partagé touché.
//
//   npx tsx scripts/tests/cdc-fix-residuals-10.flow.mjs
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const { CLI_CLIENT_ID, CLI_CLIENT_SECRET, PROJECT_ID, readCliRefreshToken } = await import('../gcp-token.mjs');
const adcPath = join(tmpdir(), `cdcres10-adc-${process.pid}.json`);
writeFileSync(adcPath, JSON.stringify({ type: 'authorized_user', client_id: CLI_CLIENT_ID, client_secret: CLI_CLIENT_SECRET, refresh_token: readCliRefreshToken() }));
process.env.GOOGLE_APPLICATION_CREDENTIALS = adcPath;
process.env.GOOGLE_CLOUD_PROJECT = PROJECT_ID;
process.env.GCLOUD_PROJECT = PROJECT_ID;

const { signIn, callFn, hotp, stepNow } = await import('../lib/test-mfa.mjs');

const results = [];
const record = (name, ok, detail) => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'OK   ' : 'ÉCHEC'} ${name}${detail ? ` — ${detail}` : ''}`);
};

const UID_A = 'test-admin-cdcres10-mfacov';
const UID_B = 'test-admin-cdcres10-unusual';
const UID_C = 'test-admin-cdcres10-failedlogins';
const EMAIL_A = 'cdcres10-mfacov@golink.test';
const EMAIL_B = 'cdcres10-unusual@golink.test';
const EMAIL_C = 'cdcres10-failedlogins@golink.test';
const PASSWORD = `Cdcres10!${Math.random().toString(36).slice(2, 10)}`;

async function main() {
  const { auth, db } = await import('../../functions/src/lib/admin.ts');
  const { syncClaims } = await import('../../functions/src/lib/claims.ts');

  const SETTINGS_REF = db.doc('settings/security');
  const originalSettings = (await SETTINGS_REF.get()).data() ?? null;

  const createAdmin = async (uid, email, permissions, mfaEnrolled) => {
    await auth.deleteUser(uid).catch(() => {});
    await auth.createUser({ uid, email, password: PASSWORD });
    await db.doc(`admins/${uid}`).set({
      role: 'support',
      active: true,
      permissions,
      cityIds: [],
      countryIds: [],
      displayName: `Test ${uid}`,
      email,
      mfaEnrolled,
      test: true,
    });
    await syncClaims(uid);
  };

  const cleanupAdmin = async (uid) => {
    await db.doc(`admins/${uid}`).delete().catch(() => {});
    await db.doc(`adminSecrets/${uid}`).delete().catch(() => {});
    const sessions = await db.collection('adminSessions').where('adminId', '==', uid).get();
    await Promise.all(sessions.docs.map((d) => d.ref.delete()));
    const alerts = await db.collection('securityAlerts').where('adminId', '==', uid).get();
    await Promise.all(alerts.docs.map((d) => d.ref.delete()));
    await auth.deleteUser(uid).catch(() => {});
  };

  try {
    // ---------------------------------------------------------------- A. Couverture MFA universelle
    console.log('\n--- A. Couverture MFA (fonction non-platform) ---');
    await createAdmin(UID_A, EMAIL_A, ['support.view'], true); // mfaEnrolled=true d'emblée, indépendant de la politique globale
    try {
      const token = await signIn(EMAIL_A, PASSWORD);
      const blocked = await callFn('getSupportAgents', {}, token);
      record(
        'getSupportAgents (NON platform) bloqué sans session MFA vérifiée',
        !blocked.ok && (blocked.status === 401 || blocked.error?.status === 'UNAUTHENTICATED'),
        `status=${blocked.status} code=${blocked.error?.status}`,
      );

      // Enrôlement + vérification réels (comme un administrateur le ferait à l'écran).
      const started = await callFn('enrollTotp', { action: 'start' }, token);
      if (!started.ok) throw new Error(`enrollTotp start : ${JSON.stringify(started.error)}`);
      const secret = started.data.secret;
      const confirmed = await callFn('enrollTotp', { action: 'confirm', code: hotp(secret, stepNow()) }, token);
      record('enrollTotp confirm (code réel, secret jetable)', confirmed.ok, JSON.stringify(confirmed.error ?? {}));

      const allowed = await callFn('getSupportAgents', {}, token);
      record(
        'getSupportAgents (NON platform) accepté après vérification MFA réelle',
        allowed.ok,
        `status=${allowed.status} ${JSON.stringify(allowed.error ?? {})}`,
      );
    } finally {
      await cleanupAdmin(UID_A);
    }

    // ---------------------------------------------------------------- B. Alerte unusual_login
    console.log('\n--- B. Alerte « connexion inhabituelle » (unusual_login) ---');
    await createAdmin(UID_B, EMAIL_B, ['support.view'], false);
    try {
      const parisHourPart = new Intl.DateTimeFormat('fr-FR', { hour: 'numeric', hourCycle: 'h23', timeZone: 'Europe/Paris' }).formatToParts(new Date()).find((p) => p.type === 'hour');
      const parisHour = Number(parisHourPart?.value ?? NaN);
      await SETTINGS_REF.set({ ...originalSettings, unusualLoginHours: { fromHour: parisHour, toHour: (parisHour + 1) % 24 } }, { merge: true });

      const decodeAuthTime = (idToken) => JSON.parse(Buffer.from(idToken.split('.')[1], 'base64url').toString('utf8')).auth_time;

      const token1 = await signIn(EMAIL_B, PASSWORD);
      const first = await callFn('trackAdminSession', {}, token1);
      record('1re connexion (aucune alerte attendue : pas d’historique)', first.ok, `status=${first.status}`);

      // auth_time (Firebase) est en secondes : attendre le changement de seconde garantit un
      // authTime distinct donc un sessionId distinct (sinon la 2e connexion mettrait juste à
      // jour la session existante, sans repasser par le code qui lève l'alerte).
      let token2;
      for (let i = 0; i < 10; i++) {
        await new Promise((resolve) => setTimeout(resolve, 600));
        token2 = await signIn(EMAIL_B, PASSWORD);
        if (decodeAuthTime(token2) !== decodeAuthTime(token1)) break;
      }
      record('2e connexion avec un authTime distinct de la 1re', decodeAuthTime(token2) !== decodeAuthTime(token1));
      const second = await callFn('trackAdminSession', {}, token2);
      record('2e connexion dans la fenêtre « heure inhabituelle » configurée', second.ok, `status=${second.status}`);

      await new Promise((resolve) => setTimeout(resolve, 1500)); // laisser le temps à l'écriture Firestore de raiseSecurityAlert
      const alerts = await db.collection('securityAlerts').where('adminId', '==', UID_B).where('type', '==', 'unusual_login').get();
      record('alerte unusual_login réellement créée en base', !alerts.empty, `${alerts.size} alerte(s)`);
      if (alerts.empty) {
        const sessDebug = await db.collection('adminSessions').where('adminId', '==', UID_B).get();
        for (const d of sessDebug.docs) console.log('DEBUG session', d.id, JSON.stringify(d.data()));
        console.log('DEBUG policy now', JSON.stringify((await SETTINGS_REF.get()).data()));
      }
    } finally {
      await SETTINGS_REF.set(originalSettings ?? {}, { merge: false });
      await cleanupAdmin(UID_B);
    }

    // ---------------------------------------------------------------- C. Alerte failed_logins
    console.log('\n--- C. Alerte « échecs de vérification » (failed_logins) ---');
    await createAdmin(UID_C, EMAIL_C, ['support.view'], true);
    try {
      // Enrôlement réel (TOTP) pour pouvoir échouer volontairement verifyTotp ensuite.
      const token = await signIn(EMAIL_C, PASSWORD);
      await callFn('trackAdminSession', {}, token);
      const started = await callFn('enrollTotp', { action: 'start' }, token);
      if (!started.ok) throw new Error(`enrollTotp start : ${JSON.stringify(started.error)}`);
      const secret = started.data.secret;
      const confirmed = await callFn('enrollTotp', { action: 'confirm', code: hotp(secret, stepNow()) }, token);
      if (!confirmed.ok) throw new Error(`enrollTotp confirm : ${JSON.stringify(confirmed.error)}`);

      // Seuil abaissé temporairement (2 au lieu de 8) pour ne pas devoir attendre deux cycles
      // de verrouillage réels (la politique par défaut verrouille à 5 échecs, avant le seuil
      // d'alerte par défaut de 8 — voir le constat documenté dans le rapport de tâche).
      await SETTINGS_REF.set({ ...originalSettings, alerts: { ...(originalSettings?.alerts ?? {}), failedLoginsPerHour: 2 } }, { merge: true });

      const wrong1 = await callFn('verifyTotp', { code: '000000', method: 'totp' }, token);
      record('1er code TOTP erroné refusé', !wrong1.ok, `status=${wrong1.status}`);
      const wrong2 = await callFn('verifyTotp', { code: '000001', method: 'totp' }, token);
      record('2e code TOTP erroné refusé (seuil atteint)', !wrong2.ok, `status=${wrong2.status}`);

      await new Promise((resolve) => setTimeout(resolve, 1500));
      const alerts = await db.collection('securityAlerts').where('adminId', '==', UID_C).where('type', '==', 'failed_logins').get();
      record('alerte failed_logins réellement créée en base', !alerts.empty, `${alerts.size} alerte(s)`);
    } finally {
      await SETTINGS_REF.set(originalSettings ?? {}, { merge: false });
      await cleanupAdmin(UID_C);
    }

    // ---------------------------------------------------------------- Nettoyage : vérification finale
    const settingsAfter = (await SETTINGS_REF.get()).data();
    record(
      'settings/security restauré à l’identique après les 3 tests',
      JSON.stringify(settingsAfter) === JSON.stringify(originalSettings),
      '',
    );
    for (const uid of [UID_A, UID_B, UID_C]) {
      const gone = !(await db.doc(`admins/${uid}`).get()).exists;
      record(`compte jetable ${uid} supprimé`, gone);
    }
  } finally {
    // Garde-fou : si une étape a levé une exception avant son propre nettoyage, on force la
    // restauration des réglages et la suppression des comptes jetables malgré tout.
    const SETTINGS_REF2 = db.doc('settings/security');
    const current = (await SETTINGS_REF2.get()).data();
    if (originalSettings && JSON.stringify(current) !== JSON.stringify(originalSettings)) {
      await SETTINGS_REF2.set(originalSettings, { merge: false });
      console.log('(garde-fou) settings/security restauré');
    }
    for (const uid of [UID_A, UID_B, UID_C]) await cleanupAdmin(uid);
  }

  console.log(`\n${results.filter((r) => r.ok).length}/${results.length} OK`);
  if (results.some((r) => !r.ok)) process.exitCode = 1;
}

await main();
