// Rend appelables (invoker public, l'authentification est vérifiée par la fonction) les callables du module.
import { gcp, PROJECT_ID } from '../gcp-token.mjs';
const fns = process.argv.slice(2);
for (const fn of fns) {
  const url = `https://run.googleapis.com/v2/projects/${PROJECT_ID}/locations/europe-west1/services/${fn.toLowerCase()}`;
  const got = await gcp(`${url}:getIamPolicy`);
  const policy = got.data ?? {};
  const bindings = policy.bindings ?? [];
  const inv = bindings.find((b) => b.role === 'roles/run.invoker');
  if (inv?.members?.includes('allUsers')) { console.log(fn, 'déjà public'); continue; }
  if (inv) inv.members.push('allUsers'); else bindings.push({ role: 'roles/run.invoker', members: ['allUsers'] });
  const set = await gcp(`${url}:setIamPolicy`, { method: 'POST', body: { policy: { ...policy, bindings } } });
  console.log(fn, got.status, set.status, set.status !== 200 ? JSON.stringify(set.data).slice(0, 300) : 'ok');
}
