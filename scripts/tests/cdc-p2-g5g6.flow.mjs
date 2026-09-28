// Test réel des correctifs de la tâche cdc-p2-g5-g6 (annexe J §18-21 / §22-27) sur la base
// golink-9f16d : le drapeau « message de service » ne doit plus permettre de contourner le
// consentement marketing pour une offre.
//
//   node scripts/tests/cdc-p2-g5g6.flow.mjs
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const API_KEY = 'AIzaSyAYQ_TzyCEK0_Iw5TnSiH8jbFbOFKZYNoM';
const FN_BASE = 'https://europe-west1-golink-9f16d.cloudfunctions.net';

const results = [];
function record(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'OK   ' : 'ÉCHEC'} ${name}${detail ? ` — ${detail}` : ''}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function readAccounts() {
  const accounts = readFileSync(join(root, '.test-accounts.local.md'), 'utf8');
  return (email) => [...accounts.matchAll(/\|\s*`([^`]+)`\s*\|\s*`([^`]+)`\s*\|/g)].find((m) => m[1] === email)?.[2];
}
const passwordOf = readAccounts();
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
  for (let attempt = 0; ; attempt += 1) {
    const res = await fetch(`${FN_BASE}/${name}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ data }),
    });
    const body = await res.json().catch(() => ({}));
    if (res.ok) return body.result;
    const status = String(body.error?.status ?? res.status);
    const transient = status === 'UNAVAILABLE' || res.status === 503 || res.status === 429 || (res.status === 500 && !body.error);
    if (attempt < 6 && transient) {
      await sleep(6000 + attempt * 4000);
      continue;
    }
    const error = new Error(body.error?.message ?? `HTTP ${res.status}`);
    error.status = status;
    throw error;
  }
}

async function main() {
  const token = await loginPassword('superadmin@golink.test', passwordOf('superadmin@golink.test'));

  // 1) Un envoi lié à une offre marqué « message de service » (marketing:false) doit être refusé.
  try {
    await call(token, 'savePlatformCampaign', {
      campaignId: null,
      mode: 'draft',
      name: `Test cdc-p2-g5g6 ${Date.now()}`,
      channel: 'push',
      title: 'Titre de test',
      body: 'Corps de message de test suffisamment long pour passer la validation.',
      link: { type: 'promotion', target: 'promo-inexistante-test' },
      audience: { userType: 'client', marketing: false },
      scheduledAt: null,
    });
    record('service-flag-refuse-promo', false, 'accepté alors qu’un refus était attendu');
  } catch (error) {
    record('service-flag-refuse-promo', String(error.message).includes('promotionnel'), `${error.status ?? ''} : ${error.message}`);
  }

  // 2) Un envoi identique marqué « promotionnel » (marketing:true) doit être accepté (brouillon).
  try {
    const res = await call(token, 'savePlatformCampaign', {
      campaignId: null,
      mode: 'draft',
      name: `Test cdc-p2-g5g6 ok ${Date.now()}`,
      channel: 'push',
      title: 'Titre de test',
      body: 'Corps de message de test suffisamment long pour passer la validation.',
      link: { type: 'promotion', target: 'promo-inexistante-test' },
      audience: { userType: 'client', marketing: true },
      scheduledAt: null,
    });
    record('service-flag-accepte-marketing-true', Boolean(res?.campaignId), JSON.stringify(res));
  } catch (error) {
    record('service-flag-accepte-marketing-true', false, `${error.status ?? ''} : ${error.message}`);
  }

  console.log('');
  const failed = results.filter((r) => !r.ok);
  console.log(`${results.length - failed.length}/${results.length} OK`);
  if (failed.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
