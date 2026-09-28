/** Lit (ou active) la configuration Firebase Auth. Usage : node scripts/auth-config.mjs [init] */
import { gcp, PROJECT_ID } from './gcp-token.mjs';

const base = `https://identitytoolkit.googleapis.com/v2/projects/${PROJECT_ID}`;
if (process.argv[2] === 'init') {
  const r = await gcp(`${base}/identityPlatform:initializeAuth`, { method: 'POST', body: {} });
  console.log('init', r.status, JSON.stringify(r.data).slice(0, 300));
}
if (process.argv[2] === 'email') {
  const r = await gcp(`${base}/config?updateMask=signIn.email.enabled,signIn.email.passwordRequired`, {
    method: 'PATCH', body: { signIn: { email: { enabled: true, passwordRequired: true } } },
  });
  console.log('email', r.status, JSON.stringify(r.data).slice(0, 300));
}
const c = await gcp(`${base}/config`);
console.log(c.status, JSON.stringify(c.data?.signIn ?? c.data, null, 1).slice(0, 800));
