/** État du projet : facturation + API activées. Usage : node scripts/gcp-status.mjs */
import { gcp, PROJECT_ID } from './gcp-token.mjs';

const billing = await gcp(`https://cloudbilling.googleapis.com/v1/projects/${PROJECT_ID}/billingInfo`);
console.log('Billing:', billing.status, JSON.stringify(billing.data));
const apis = await gcp(`https://serviceusage.googleapis.com/v1/projects/${PROJECT_ID}/services?filter=state:ENABLED&pageSize=200`);
console.log('Enabled APIs:', (apis.data.services || []).map(s => s.config.name).join('\n  '));
