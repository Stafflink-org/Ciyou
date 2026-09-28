import { gcp, PROJECT_ID } from '../gcp-token.mjs';
let token = ''; const all = [];
do {
  const r = await gcp(`https://run.googleapis.com/v2/projects/${PROJECT_ID}/locations/europe-west1/services?pageSize=500${token ? `&pageToken=${token}` : ''}`);
  all.push(...(r.data.services ?? [])); token = r.data.nextPageToken ?? '';
} while (token);
let total = 0; const rows = [];
for (const s of all) {
  const c = s.template?.containers?.[0]?.resources?.limits?.cpu ?? '1';
  const cpu = c.endsWith('m') ? Number(c.slice(0, -1)) / 1000 : Number(c);
  const max = s.template?.scaling?.maxInstanceCount ?? 100;
  total += cpu * max; rows.push([s.name.split('/').pop(), cpu, max]);
}
rows.sort((a, b) => b[1] * b[2] - a[1] * a[2]);
console.log('services', all.length, 'sum cpu*max', total);
console.log(rows.slice(0, 25).map((r) => r.join(' ')).join('\n'));
const q = await gcp(`https://serviceusage.googleapis.com/v1beta1/projects/${PROJECT_ID}/services/run.googleapis.com/consumerQuotaMetrics?pageSize=100`);
for (const m of q.data.metrics ?? []) if (/cpu/i.test(m.metric)) for (const l of m.consumerQuotaLimits ?? []) for (const b of l.quotaBuckets ?? []) if (b.dimensions?.region === 'europe-west1' || !b.dimensions) console.log(m.metric, l.unit, b.effectiveLimit, JSON.stringify(b.dimensions ?? {}));
