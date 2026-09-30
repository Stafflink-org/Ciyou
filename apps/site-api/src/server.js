import http from 'node:http';
const PORT = Number(process.env.PORT || 8080);
const MAX_BODY = 24 * 1024;
const COMPANY_NAME = process.env.ODOO_CIYOU_COMPANY_NAME || 'Ciyou';

function env(name, fallback) {
  const value = process.env[name] || fallback || '';
  return value.trim();
}

function positiveId(value) {
  return value && /^[1-9]\d*$/.test(value) ? Number(value) : undefined;
}

function json(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': 'https://ciyou.io',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(Object.assign(new Error('payload_too_large'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function cleanString(value, max) {
  if (typeof value !== 'string') return '';
  return value.trim().replace(/\s+/g, ' ').slice(0, max);
}

function cleanMessage(value) {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, 1200);
}

function validate(input) {
  const lead = {
    fullName: cleanString(input.fullName, 120),
    restaurantName: cleanString(input.businessName || input.restaurantName, 140),
    email: cleanString(input.email, 160).toLowerCase(),
    phone: cleanString(input.phone, 10).replace(/\D/g, ''),
    message: cleanMessage(input.message),
  };
  if (!lead.fullName || !lead.restaurantName || !lead.email || !lead.phone) throw Object.assign(new Error('invalid_input'), { status: 400 });
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(lead.email)) throw Object.assign(new Error('invalid_email'), { status: 400 });
  if (!/^\d{10}$/.test(lead.phone)) throw Object.assign(new Error('invalid_phone'), { status: 400 });
  return lead;
}

function escapeHtml(text) {
  return text.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
}

async function createOdooClient() {
  const url = env('ODOO_URL').replace(/\/$/, '');
  const db = env('ODOO_DB', env('ODOO_DATABASE'));
  const login = env('ODOO_LOGIN', env('ODOO_USERNAME'));
  const credential = env('ODOO_API_KEY', env('ODOO_PASSWORD'));
  if (!url || !db || !login || !credential) throw new Error('odoo_config_missing');

  async function rpc(service, method, args) {
    const response = await fetch(`${url}/jsonrpc`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'call', params: { service, method, args }, id: 1 }),
      signal: AbortSignal.timeout(15000),
    });
    const data = await response.json();
    if (!response.ok || data.error) throw new Error('odoo_request_failed');
    return data.result;
  }

  const uid = await rpc('common', 'authenticate', [db, login, credential, {}]);
  if (!Number.isInteger(uid) || uid <= 0) throw new Error('odoo_auth_failed');
  return { db, uid, credential, rpc };
}

async function ensureCompany(client) {
  const configuredCompanyId = positiveId(process.env.ODOO_CIYOU_COMPANY_ID);
  if (configuredCompanyId) return configuredCompanyId;
  const context = { active_test: false };
  const found = await client.rpc('object', 'execute_kw', [client.db, client.uid, client.credential, 'res.company', 'search', [[[ 'name', '=', COMPANY_NAME ]]], { limit: 1, context }]);
  const companyId = Array.isArray(found) && Number.isInteger(found[0]) ? found[0] : await client.rpc('object', 'execute_kw', [client.db, client.uid, client.credential, 'res.company', 'create', [{ name: COMPANY_NAME }], { context }]);
  const userId = positiveId(process.env.ODOO_CIYOU_USER_ID || process.env.ODOO_STAFFLINK_USER_ID) || client.uid;
  await client.rpc('object', 'execute_kw', [client.db, client.uid, client.credential, 'res.users', 'write', [[userId], { company_ids: [[4, companyId]] }], { context }]);
  return companyId;
}

async function createLead(lead) {
  const client = await createOdooClient();
  const companyId = await ensureCompany(client);
  const context = { allowed_company_ids: [companyId], mail_create_nosubscribe: true, mail_create_nolog: true };
  const description = lead.message ? escapeHtml(lead.message).replace(/\n/g, '<br>') : '';

  const values = {
    name: lead.restaurantName,
    partner_name: lead.restaurantName,
    contact_name: lead.fullName,
    email_from: lead.email,
    phone: lead.phone,
    company_id: companyId,
  };
  if (description) values.description = description;

  const id = await client.rpc('object', 'execute_kw', [client.db, client.uid, client.credential, 'crm.lead', 'create', [values], { context }]);
  if (!Number.isInteger(id) || id <= 0) throw new Error('odoo_invalid_lead_id');
  return id;
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'OPTIONS') return json(res, 204, {});
    if (req.method === 'GET' && req.url === '/health') return json(res, 200, { ok: true });
    if (req.method !== 'POST' || req.url !== '/api/contact') return json(res, 404, { ok: false });
    const raw = await readBody(req);
    const lead = validate(JSON.parse(raw || '{}'));
    const leadId = await createLead(lead);
    return json(res, 200, { ok: true, leadId });
  } catch (error) {
    const status = Number(error?.status) || 503;
    if (status >= 500) console.error('Ciyou contact submission failed');
    return json(res, status, { ok: false, error: status >= 500 ? 'service_unavailable' : 'invalid_request' });
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Ciyou site API listening on ${PORT}`);
});
