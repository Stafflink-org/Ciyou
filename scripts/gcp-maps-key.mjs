/** Crée la clé Google Maps web restreinte (referrers + API). Usage : node scripts/gcp-maps-key.mjs */
import { gcp, PROJECT_ID } from './gcp-token.mjs';

const body = {
  displayName: 'GoLink Web Maps',
  restrictions: {
    browserKeyRestrictions: { allowedReferrers: ['http://localhost:*/*', 'http://127.0.0.1:*/*', 'https://*.golink.fr/*', 'https://*.web.app/*'] },
    apiTargets: [{ service: 'maps-backend.googleapis.com' }, { service: 'places-backend.googleapis.com' }, { service: 'geocoding-backend.googleapis.com' }],
  },
};
let op = await gcp(`https://apikeys.googleapis.com/v2/projects/${PROJECT_ID}/locations/global/keys`, { method: 'POST', body });
for (let i = 0; i < 20 && op.data.name && !op.data.done; i++) {
  await new Promise(r => setTimeout(r, 2000));
  op = await gcp(`https://apikeys.googleapis.com/v2/${op.data.name}`);
}
const keyName = op.data.response?.name;
const ks = await gcp(`https://apikeys.googleapis.com/v2/${keyName}/keyString`);
console.log(keyName ? 'created ' + keyName : JSON.stringify(op.data).slice(0, 300));
if (ks.data.keyString) process.stdout.write('KEY=' + ks.data.keyString + '\n');
