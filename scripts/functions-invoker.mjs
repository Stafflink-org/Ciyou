/**
 * Repose l'invoker public (roles/run.invoker pour allUsers) sur les services Cloud Run
 * des fonctions appelables déjà déployées. Utile si un déploiement a laissé des
 * services en 403 (Google Frontend). Les fonctions de type webhook ou planifiées sont
 * ignorées : on ne touche que les services dont le nom figure dans la liste retournée
 * par l'API Cloud Functions comme déclencheur HTTPS appelable.
 *
 * Usage : npm run functions:invoker [-- nom1 nom2 ...]   (sans argument : tous les callables)
 */
import { fetchAccessToken, PROJECT_ID } from './gcp-token.mjs';

const REGION = 'europe-west1';
const only = new Set(process.argv.slice(2).map((n) => n.toLowerCase()));
const { access_token: token } = await fetchAccessToken();
const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'x-goog-user-project': PROJECT_ID };

async function api(url, init) {
  const res = await fetch(url, { headers, ...init });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${res.status} ${url} ${JSON.stringify(body).slice(0, 300)}`);
  return body;
}

const functions = [];
let pageToken = '';
do {
  const url = `https://cloudfunctions.googleapis.com/v2/projects/${PROJECT_ID}/locations/${REGION}/functions?pageSize=200${pageToken ? `&pageToken=${pageToken}` : ''}`;
  const page = await api(url);
  functions.push(...(page.functions ?? []));
  pageToken = page.nextPageToken ?? '';
} while (pageToken);

// Callable = fonction portant l'étiquette `deployment-callable` posée par Firebase au déploiement.
// Les fonctions planifiées (invoquées par Cloud Scheduler) et les déclencheurs restent privés ;
// si l'un d'eux a été rendu public par erreur, on retire allUsers (le webhook Stripe reste public).
const active = functions.filter((f) => f.state === 'ACTIVE' && f.serviceConfig?.service);
const callables = active.filter((f) => f.labels?.['deployment-callable'] === 'true');
const notCallable = active.filter((f) => f.labels?.['deployment-callable'] !== 'true' && !f.eventTrigger);
let done = 0;
let already = 0;
const failed = [];
for (const fn of callables) {
  const short = fn.name.split('/').pop();
  if (short.toLowerCase() === 'stripewebhook') continue;
  if (only.size && !only.has(short.toLowerCase())) continue;
  const service = fn.serviceConfig.service; // projects/.../locations/.../services/<nom>
  try {
    const policy = await api(`https://run.googleapis.com/v2/${service}:getIamPolicy`);
    const bindings = policy.bindings ?? [];
    const has = bindings.some((b) => b.role === 'roles/run.invoker' && (b.members ?? []).includes('allUsers'));
    if (has) {
      already += 1;
      continue;
    }
    const invoker = bindings.find((b) => b.role === 'roles/run.invoker');
    if (invoker) invoker.members = [...(invoker.members ?? []), 'allUsers'];
    else bindings.push({ role: 'roles/run.invoker', members: ['allUsers'] });
    await api(`https://run.googleapis.com/v2/${service}:setIamPolicy`, {
      method: 'POST',
      body: JSON.stringify({ policy: { ...policy, bindings } }),
    });
    done += 1;
  } catch (error) {
    failed.push(`${short}: ${error.message}`);
  }
}
let revoked = 0;
for (const fn of notCallable) {
  const short = fn.name.split('/').pop();
  if (short.toLowerCase() === 'stripewebhook') continue;
  try {
    const policy = await api(`https://run.googleapis.com/v2/${fn.serviceConfig.service}:getIamPolicy`);
    let changed = false;
    for (const b of policy.bindings ?? []) {
      if (b.role === 'roles/run.invoker' && (b.members ?? []).includes('allUsers')) {
        b.members = b.members.filter((m) => m !== 'allUsers');
        changed = true;
      }
    }
    if (!changed) continue;
    policy.bindings = (policy.bindings ?? []).filter((b) => (b.members ?? []).length > 0);
    await api(`https://run.googleapis.com/v2/${fn.serviceConfig.service}:setIamPolicy`, { method: 'POST', body: JSON.stringify({ policy }) });
    revoked += 1;
  } catch (error) {
    failed.push(`${short} (retrait): ${error.message}`);
  }
}
console.log(`Invoker public : ${done} posé(s), ${already} déjà en place, ${revoked} accès public retiré(s) sur des fonctions planifiées, ${failed.length} échec(s) sur ${callables.length} callables.`);
for (const line of failed) console.log('  ÉCHEC', line);
process.exit(failed.length ? 1 : 0);
