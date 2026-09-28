// Audit de débordement de l'application restaurant.
// Usage : node scripts/tests/audit-overflow-restaurant.mjs [--port 5183] [--account mina.haddad@golink.test]
//   [--widths 1440,1024,768,390,320] [--modes light,dark] [--lang ar] [--only /planning,/paie] [--shots 1]
import { existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const args = {};
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  if (argv[i].startsWith('--')) args[argv[i].slice(2)] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : '1';
}
const port = args.port ?? 5183;
const email = args.account ?? 'mina.haddad@golink.test';
const widths = (args.widths ?? '1440,1024,768,390,320').split(',').map(Number);
const modes = (args.modes ?? 'light,dark').split(',');
const lang = args.lang;
const only = args.only?.split(',');
const accounts = readFileSync(join(root, '.test-accounts.local.md'), 'utf8');
const password = [...accounts.matchAll(/\|\s*`([^`]+)`\s*\|\s*`([^`]+)`\s*\|/g)].find((m) => m[1] === email)?.[2];

const feat = join(root, 'apps/restaurant/src/features');
let routes = [];
for (const d of readdirSync(feat)) {
  const f = join(feat, d, 'module.tsx');
  if (!existsSync(f)) continue;
  for (const m of readFileSync(f, 'utf8').matchAll(/path:\s*'([^']+)'/g)) routes.push('/' + m[1]);
}
routes = [...new Set(routes)];
const dyn = (r) => r.includes(':');
const wait = (ms) => new Promise((s) => setTimeout(s, ms));
const resolveDyn = async (page, r) => {
  if (r.includes('/:conversationId?')) return r.replace('/:conversationId?', '');
  if (r.endsWith('/nouveau')) return r;
  const base = r.replace(/\/:.*$/, '');
  await page.goto(`http://localhost:${port}${base}`, { waitUntil: 'networkidle2', timeout: 60000 }).catch(() => {});
  await wait(1500);
  const viaLink = await page.evaluate(
    (b) =>
      [...document.querySelectorAll('main a[href]')]
        .map((a) => a.getAttribute('href'))
        .find((h) => h.startsWith(b + '/') && !/historique|suivi|reglages|checklists|modeles|temperatures|nouveau/.test(h.slice(b.length))) ?? null,
    base,
  );
  if (viaLink) return viaLink;
  // Lignes cliquables : on clique la première et on lit l'adresse obtenue.
  for (const sel of ['main tbody tr', 'main [role=row]', 'main [role=button]', 'main li[tabindex]']) {
    const h = await page.$(sel);
    if (!h) continue;
    await h.click().catch(() => {});
    await wait(1500);
    const p = new URL(page.url()).pathname;
    if (p.startsWith(base + '/') && !/historique|suivi/.test(p)) return p;
    if (p !== base) await page.goto(`http://localhost:${port}${base}`, { waitUntil: 'networkidle2' }).catch(() => {});
  }
  return null;
};
routes = routes.filter((r) => !only || only.some((o) => r.startsWith('/' + o.replace(/^[/\\]+/, ''))));

const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--no-sandbox'] });
const out = join(root, '.smoke', 'ovr');
mkdirSync(out, { recursive: true });
const findings = [];
let pages = 0;

const detect = () => {
  const vw = window.innerWidth;
  const res = { docOverflow: document.documentElement.scrollWidth - vw, bodyOverflow: document.body.scrollWidth - vw, items: [] };
  const inScroller = (el) => {
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      const o = getComputedStyle(p).overflowX;
      if ((o === 'auto' || o === 'scroll' || o === 'hidden' || o === 'clip') && p.scrollWidth > p.clientWidth + 1) return p;
    }
    return null;
  };
  const desc = (el) => `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}.${String(el.className?.baseVal ?? el.className).split(/\s+/).slice(0, 4).join('.')}`.slice(0, 110);
  for (const el of document.querySelectorAll('body *')) {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || el.closest('[aria-hidden=true], .sr-only')) continue;
    if (['script', 'style', 'path', 'circle', 'line', 'g', 'rect', 'polyline'].includes(el.tagName.toLowerCase())) continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    if (r.right > vw + 1 || r.left < -1) {
      const sc = inScroller(el);
      if (!sc && cs.position !== 'fixed') res.items.push({ k: 'depasse', el: desc(el), left: Math.round(r.left), right: Math.round(r.right), text: (el.textContent || '').trim().slice(0, 40) });
    }
    if ((cs.overflowX === 'auto' || cs.overflowX === 'scroll') && el.scrollWidth > el.clientWidth + 1) {
      res.items.push({ k: 'scroll-interne', el: desc(el), sw: el.scrollWidth, cw: el.clientWidth, text: (el.textContent || '').trim().slice(0, 30) });
    }
    if (el.children.length === 0 && el.textContent?.trim() && (cs.overflowX === 'hidden' || cs.overflowX === 'clip') && el.scrollWidth > el.clientWidth + 1 && cs.textOverflow !== 'ellipsis') {
      res.items.push({ k: 'texte-coupe', el: desc(el), sw: el.scrollWidth, cw: el.clientWidth, text: el.textContent.trim().slice(0, 40) });
    }
    if (el.children.length === 0 && el.textContent?.trim() && cs.overflowX === 'visible' && el.scrollWidth > el.clientWidth + 2 && cs.display !== 'inline' && cs.whiteSpace === 'nowrap') {
      res.items.push({ k: 'texte-deborde', el: desc(el), sw: el.scrollWidth, cw: el.clientWidth, text: el.textContent.trim().slice(0, 40) });
    }
  }
  const seen = new Set();
  res.items = res.items.filter((i) => (seen.has(i.k + i.el) ? false : seen.add(i.k + i.el))).slice(0, 12);
  return res;
};

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  await page.evaluateOnNewDocument((lg) => { try { if (lg) localStorage.setItem('golink:locale', lg); } catch {} }, lang);
  await page.goto(`http://localhost:${port}/connexion`, { waitUntil: 'networkidle0', timeout: 90000 });
  await page.type('input[type=email]', email);
  await page.type('input[autocomplete=current-password]', password);
  await page.click('button[type=submit]');
  await page.waitForFunction(() => location.pathname !== '/connexion', { timeout: 30000 });

  const resolved = [];
  for (const r of routes) {
    if (dyn(r) || r.endsWith('/nouveau')) {
      const t = await resolveDyn(page, r);
      if (t) resolved.push(t);
      else findings.push({ route: r, note: 'aucune donnee pour resoudre la route dynamique' });
    } else resolved.push(r);
  }
  console.log('routes:', resolved.length);
  for (const mode of modes) {
    await page.evaluate((m) => { try { localStorage.setItem('golink:color-mode', m); } catch {} }, mode);
    for (const w of widths) {
      await page.setViewport({ width: w, height: w < 600 ? 844 : 900 });
      for (const r of resolved) {
        await page.goto(`http://localhost:${port}${r}`, { waitUntil: 'networkidle2', timeout: 60000 }).catch(() => {});
        await wait(1200);
        const d = await page.evaluate(detect);
        pages++;
        if (d.docOverflow > 0 || d.bodyOverflow > 0 || d.items.length) {
          findings.push({ route: r, w, mode, docOverflow: d.docOverflow, items: d.items });
          if (args.shots) await page.screenshot({ path: join(out, `${r.replace(/[^a-z0-9]+/gi, '_')}-${w}-${mode}.png`), fullPage: true });
        }
      }
    }
  }
} finally {
  await browser.close();
}
console.log('pages auditees (route x largeur x mode):', pages);
console.log(JSON.stringify(findings, null, 1));
