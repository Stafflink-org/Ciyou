// Migration réelle cdc-pdf-02 (PDF client « Points à corriger », Super Admin #2 — charte
// graphique) : `settings/branding.colors` était figé sur l'ancienne palette corail
// (#e8784b/#19343b/#f7f2e8), jamais retouchée depuis le seed. Les jetons CSS de la plateforme
// ont été mis à jour vers la nouvelle charte (orange #FF6B00/#FF8A00, noir #0B0F10, blanc,
// gris #98A2B3), mais `BrandingEffect` (packages/web/src/branding/branding.tsx) surcharge ces
// jetons avec la valeur stockée dès qu'elle diffère du défaut codé en dur — sans cette
// migration, le réglage restait silencieusement sur l'ancien corail (et l'écran Paramètres du
// super admin aurait continué à afficher l'ancienne couleur comme étant la couleur active).
//
//   npx tsx scripts/tests/cdc-pdf-02-charte-migration.flow.mjs
import { randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Timestamp } from '@google-cloud/firestore';
import { auth, db } from '../lib/admin.mjs';
import { CLI_CLIENT_ID, CLI_CLIENT_SECRET, PROJECT_ID, readCliRefreshToken } from '../gcp-token.mjs';

const adcPath = join(tmpdir(), `cdcpdf02-adc-${process.pid}.json`);
writeFileSync(adcPath, JSON.stringify({ type: 'authorized_user', client_id: CLI_CLIENT_ID, client_secret: CLI_CLIENT_SECRET, refresh_token: readCliRefreshToken() }));
process.env.GOOGLE_APPLICATION_CREDENTIALS = adcPath;
process.env.GOOGLE_CLOUD_PROJECT = PROJECT_ID;
process.env.GCLOUD_PROJECT = PROJECT_ID;
const { syncClaims } = await import('../../functions/src/lib/claims.ts');

const API_KEY = 'AIzaSyAYQ_TzyCEK0_Iw5TnSiH8jbFbOFKZYNoM';
const FN_BASE = 'https://europe-west1-golink-9f16d.cloudfunctions.net';
const at = (offsetMs = 0) => Timestamp.fromMillis(Date.now() + offsetMs);

const results = [];
function record(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'OK   ' : 'ÉCHEC'} ${name}${detail ? ` — ${detail}` : ''}`);
}
const check = (name, condition, detail) => record(name, Boolean(condition), detail);

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

const ADMIN_UID = 'cdcpdf02-admin';

async function main() {
  const before = await db.doc('settings/branding').get();
  console.log('Avant migration :', JSON.stringify(before.data()?.colors));
  check('settings/branding : ancienne valeur confirmée (corail de seed)', before.data()?.colors?.primary === '#e8784b', `primary=${before.data()?.colors?.primary}`);

  const password = `${randomBytes(18).toString('base64url')}Aa1`;
  await auth.deleteUser(ADMIN_UID).catch(() => {});
  await auth.createUser({ uid: ADMIN_UID, email: `${ADMIN_UID}@golink.test`, password, emailVerified: true, displayName: ADMIN_UID });
  await db.doc(`admins/${ADMIN_UID}`).set({ role: 'super_admin', active: true, permissions: [], cityIds: [], countryIds: [], refundLimitCents: null, displayName: ADMIN_UID, email: `${ADMIN_UID}@golink.test`, test: true, createdAt: at(), updatedAt: at(), updatedBy: 'system' });
  await syncClaims(ADMIN_UID);
  const token = await loginPassword(`${ADMIN_UID}@golink.test`, password);

  const existing = before.data() ?? {};
  const result = await call(token, 'updatePlatformSettings', {
    doc: 'branding',
    reason: 'Migration charte graphique Ciyou Eats (document client "Points à corriger", 30/09/2026) : orange #FF6B00/#FF8A00, noir #0B0F10, blanc, gris #98A2B3.',
    data: {
      logo: existing.logo ?? null,
      logoDark: existing.logoDark ?? null,
      favicon: existing.favicon ?? null,
      colors: { primary: '#ff6b00', secondary: '#0b0f10', accent: '#ffffff', background: '#f7f8fa' },
    },
  });
  check('updatePlatformSettings(branding) : accepté', Boolean(result), JSON.stringify(result));

  const after = await db.doc('settings/branding').get();
  check('settings/branding : nouvelle couleur primaire enregistrée', after.data()?.colors?.primary === '#ff6b00', `primary=${after.data()?.colors?.primary}`);
  check('settings/branding : secondaire (noir charte)', after.data()?.colors?.secondary === '#0b0f10', `secondary=${after.data()?.colors?.secondary}`);

  const history = await db.collection('settingsHistory').where('docPath', '==', 'settings/branding').orderBy('changedAt', 'desc').limit(1).get();
  check('settingsHistory : entrée historisée avec le motif', !history.empty && history.docs[0].get('reason')?.includes('charte graphique'), history.empty ? 'aucune entrée' : history.docs[0].get('reason'));

  await db.doc(`admins/${ADMIN_UID}`).delete().catch(() => {});
  await Promise.all([`users/${ADMIN_UID}`, `userPrivate/${ADMIN_UID}`].map((p) => db.doc(p).delete().catch(() => {})));
  await auth.deleteUser(ADMIN_UID).catch(() => {});
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
