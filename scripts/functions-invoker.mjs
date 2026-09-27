/**
 * Repose l'invoker public sur les fonctions appelables déjà déployées, aux DEUX niveaux
 * IAM que Cloud Functions gen2 expose (constaté sur une fonction toute neuve créée par un
 * déploiement ciblé `--only functions:x,y,z` : le niveau Cloud Run était public mais pas le
 * niveau Cloud Functions, avec pour symptôme un 401 « The access token could not be verified »
 * malgré un appel authentifié) :
 * - `roles/run.invoker` sur le service Cloud Run sous-jacent (déjà géré ici de longue date) ;
 * - `roles/cloudfunctions.invoker` sur la ressource Cloud Functions elle-même, requis par la
 *   porte d'entrée `https://<region>-<projet>.cloudfunctions.net/<nom>` utilisée par le SDK
 *   client Firebase — normalement posé par `firebase deploy`, mais pas toujours propagé sur
 *   un déploiement ciblé, d'où ce script de rattrapage.
 * Utile si un déploiement a laissé des fonctions en 401/403 (Google Frontend). Les fonctions
 * de type webhook ou planifiées sont ignorées : on ne touche que celles dont le nom figure
 * dans la liste retournée par l'API Cloud Functions comme déclencheur HTTPS appelable.
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
    failed.push(`${short} (run.invoker): ${error.message}`);
  }
  // Second niveau : la ressource Cloud Functions elle-même (porte d'entrée .cloudfunctions.net).
  try {
    const cfPolicy = await api(`https://cloudfunctions.googleapis.com/v2/${fn.name}:getIamPolicy`);
    const cfBindings = cfPolicy.bindings ?? [];
    const cfHas = cfBindings.some((b) => b.role === 'roles/cloudfunctions.invoker' && (b.members ?? []).includes('allUsers'));
    if (!cfHas) {
      const cfInvoker = cfBindings.find((b) => b.role === 'roles/cloudfunctions.invoker');
      if (cfInvoker) cfInvoker.members = [...(cfInvoker.members ?? []), 'allUsers'];
      else cfBindings.push({ role: 'roles/cloudfunctions.invoker', members: ['allUsers'] });
      await api(`https://cloudfunctions.googleapis.com/v2/${fn.name}:setIamPolicy`, {
        method: 'POST',
        body: JSON.stringify({ policy: { ...cfPolicy, bindings: cfBindings } }),
      });
    }
  } catch (error) {
    failed.push(`${short} (cloudfunctions.invoker): ${error.message}`);
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
