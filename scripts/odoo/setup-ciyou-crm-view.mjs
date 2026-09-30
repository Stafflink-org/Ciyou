const COMPANY_NAME = process.env.ODOO_CIYOU_COMPANY_NAME || 'Ciyou';
const MENU_NAME = process.env.ODOO_CIYOU_MENU_NAME || 'Ciyou prospects';
const url = (process.env.ODOO_URL || '').replace(/\/$/, '');
const db = process.env.ODOO_DB || process.env.ODOO_DATABASE;
const login = process.env.ODOO_LOGIN || process.env.ODOO_USERNAME;
const credential = process.env.ODOO_API_KEY || process.env.ODOO_PASSWORD;

if (!url || !db || !login || !credential) {
  console.error('Missing Odoo configuration');
  process.exit(1);
}

async function rpc(service, method, args) {
  const response = await fetch(`${url}/jsonrpc`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'call', params: { service, method, args }, id: 1 }),
    signal: AbortSignal.timeout(20000),
  });
  const data = await response.json();
  if (!response.ok || data.error) throw new Error(data.error ? JSON.stringify(data.error) : `HTTP ${response.status}`);
  return data.result;
}

const uid = await rpc('common', 'authenticate', [db, login, credential, {}]);
if (!Number.isInteger(uid) || uid <= 0) throw new Error('Odoo authentication failed');

async function kw(model, method, args = [], kwargs = {}) {
  return rpc('object', 'execute_kw', [db, uid, credential, model, method, args, kwargs]);
}

async function first(model, domain, fields = ['id']) {
  const rows = await kw(model, 'search_read', [domain], { fields, limit: 1, context: { active_test: false } });
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

async function ensureCompany() {
  const existing = await first('res.company', [['name', '=', COMPANY_NAME]], ['id']);
  if (existing?.id) return existing.id;
  return kw('res.company', 'create', [{ name: COMPANY_NAME }], { context: { active_test: false } });
}

async function upsertView({ name, type, arch }) {
  const existing = await first('ir.ui.view', [['name', '=', name], ['model', '=', 'crm.lead']], ['id']);
  const values = { name, type, model: 'crm.lead', mode: 'primary', arch };
  if (existing?.id) {
    await kw('ir.ui.view', 'write', [[existing.id], values]);
    return existing.id;
  }
  return kw('ir.ui.view', 'create', [values]);
}

const companyId = await ensureCompany();

const listViewId = await upsertView({
  name: 'ciyou.crm.lead.list.only.entered.fields',
  type: 'list',
  arch: `<list string="Ciyou prospects" create="false" edit="false">
  <field name="name" string="Restaurant"/>
  <field name="contact_name" string="Nom complet"/>
  <field name="email_from" string="E-mail professionnel"/>
  <field name="phone" string="Téléphone"/>
  <field name="create_date" string="Date"/>
</list>`,
});

const formViewId = await upsertView({
  name: 'ciyou.crm.lead.form.only.entered.fields',
  type: 'form',
  arch: `<form string="Prospect Ciyou" create="false">
  <sheet>
    <div class="oe_title">
      <label for="name" string="Restaurant"/>
      <h1><field name="name" placeholder="Restaurant"/></h1>
    </div>
    <group string="Informations saisies depuis ciyou.io">
      <group>
        <field name="contact_name" string="Nom complet"/>
        <field name="partner_name" string="Restaurant / société"/>
      </group>
      <group>
        <field name="email_from" string="E-mail professionnel"/>
        <field name="phone" string="Téléphone"/>
      </group>
    </group>
    <group string="Message">
      <field name="description" nolabel="1" placeholder="Aucun message saisi"/>
    </group>
  </sheet>
</form>`,
});

let action = await first('ir.actions.act_window', [['name', '=', MENU_NAME], ['res_model', '=', 'crm.lead']], ['id']);
const actionValues = {
  name: MENU_NAME,
  res_model: 'crm.lead',
  type: 'ir.actions.act_window',
  view_mode: 'list,form',
  domain: `[('company_id','=',${companyId})]`,
  context: `{'default_company_id': ${companyId}, 'allowed_company_ids': [${companyId}], 'search_default_ci_you': 1}`,
  target: 'current',
};
if (action?.id) {
  await kw('ir.actions.act_window', 'write', [[action.id], actionValues]);
} else {
  action = { id: await kw('ir.actions.act_window', 'create', [actionValues]) };
}

const existingViews = await kw('ir.actions.act_window.view', 'search', [[['act_window_id', '=', action.id]]]);
if (existingViews.length) await kw('ir.actions.act_window.view', 'unlink', [existingViews]);
await kw('ir.actions.act_window.view', 'create', [{ act_window_id: action.id, view_mode: 'list', view_id: listViewId, sequence: 1 }]);
await kw('ir.actions.act_window.view', 'create', [{ act_window_id: action.id, view_mode: 'form', view_id: formViewId, sequence: 2 }]);

const parentData = await first('ir.model.data', [['module', '=', 'crm'], ['name', '=', 'crm_menu_sales'], ['model', '=', 'ir.ui.menu']], ['res_id']);
const parentId = parentData?.res_id || false;
let menu = await first('ir.ui.menu', [['name', '=', MENU_NAME]], ['id']);
const menuValues = {
  name: MENU_NAME,
  action: `ir.actions.act_window,${action.id}`,
  sequence: 30,
};
if (parentId) menuValues.parent_id = parentId;
if (menu?.id) {
  await kw('ir.ui.menu', 'write', [[menu.id], menuValues]);
} else {
  menu = { id: await kw('ir.ui.menu', 'create', [menuValues]) };
}

console.log(JSON.stringify({ ok: true, companyId, actionId: action.id, menuId: menu.id, listViewId, formViewId }));
