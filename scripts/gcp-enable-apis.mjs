/** Active les API Google Cloud nécessaires. Usage : node scripts/gcp-enable-apis.mjs api1 api2 ... */
import { gcp, PROJECT_ID } from './gcp-token.mjs';

const ids = process.argv.slice(2);
const r = await gcp(`https://serviceusage.googleapis.com/v1/projects/${PROJECT_ID}/services:batchEnable`, { method: 'POST', body: { serviceIds: ids } });
console.log(r.status, JSON.stringify(r.data).slice(0, 400));
