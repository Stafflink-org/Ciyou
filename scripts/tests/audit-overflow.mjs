// Audit « zéro débordement » d'un back-office (admin ou restaurant).
//
// Pour chaque route déclarée par les modules (apps/<app>/src/features/*/module.tsx),
// pour chaque largeur : mesure du défilement horizontal de la page, éléments hors
// fenêtre ou hors de leur parent, conteneurs qui défilent, texte coupé sans info-bulle,
// chevauchements, images/graphiques plus larges que leur carte. Les largeurs sont
// enchaînées EN DIRECT (redimensionnement de la fenêtre sans rechargement), en
// réduisant puis en agrandissant. Les modales principales sont ouvertes et mesurées.
//
// Usage :
//   node scripts/tests/audit-overflow.mjs <admin|restaurant> <e-mail> [options]
// Options :
//   --port=5190            port du serveur de dev (défaut 5174 admin / 5173 restaurant)
//   --widths=1440,1024,768,390,320
//   --themes=default,alt   « alt » = l'autre thème (admin : clair ; restaurant : sombre)
//   --stress               remplace les textes courts par des noms très longs
//   --rtl                  passe le document en dir="rtl" avec du texte arabe
//   --routes=a,b           limite aux routes (sous-chaînes)
//   --no-shots             pas de captures
//   --dialogs=false        n'ouvre pas les modales
// Sorties : .smoke/overflow-<app>.json (rapport) et .smoke/overflow-<app>/*.jpg (captures).
// Mots de passe : lus dans .test-accounts.local.md, jamais recopiés.
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const positional = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const opts = Object.fromEntries(
  process.argv
    .slice(2)
    .filter((a) => a.startsWith('--'))
    .map((a) => {
      const [k, v] = a.slice(2).split('=');
      return [k, v ?? 'true'];
    }),
);
const [app, email] = positional;
const ports = { restaurant: 5173, admin: 5174 };
if (!(app in ports) || !email) {
  console.error('Usage : node scripts/tests/audit-overflow.mjs <admin|restaurant> <e-mail> [--port=..] [--widths=..] [--themes=default,alt] [--stress] [--rtl]');
  process.exit(1);
}
const widths = (opts.widths ?? '1440,1024,768,390,320').split(',').map(Number);
const themes = (opts.themes ?? 'default,alt').split(',');
const routeFilter = opts.routes?.split(',');
const withDialogs = opts.dialogs !== 'false';
const shots = opts['no-shots'] === undefined;
const base = `http://localhost:${opts.port ?? ports[app]}`;

const accounts = readFileSync(join(root, '.test-accounts.local.md'), 'utf8');
const password = [...accounts.matchAll(/\|\s*`([^`]+)`\s*\|\s*`([^`]+)`\s*\|/g)].find((m) => m[1] === email)?.[2];
if (!password) throw new Error(`Compte inconnu : ${email}`);
const chrome = ['C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/google-chrome'].find((c) => existsSync(c));

// --- Découverte des routes depuis les modules -------------------------------------------
function discoverRoutes() {
  const dir = join(root, 'apps', app, 'src', 'features');
  const found = new Set();
  for (const feature of readdirSync(dir)) {
    const file = join(dir, feature, 'module.tsx');
    if (!existsSync(file)) continue;
    const src = readFileSync(file, 'utf8');
    for (const m of src.matchAll(/path:\s*'([^']+)'/g)) found.add(m[1]);
    if (/index:\s*true/.test(src)) found.add('');
  }
  return [...found].sort();
}
const allRoutes = discoverRoutes();
const staticRoutes = allRoutes.filter((r) => !r.includes(':'));
const dynamicRoutes = allRoutes.filter((r) => r.includes(':'));

// --- Mesure exécutée dans la page ---------------------------------------------------------
function measureInPage(scope) {
  const vw = document.documentElement.clientWidth;
  const out = [];
  const seen = new Set();
  const short = (el) => {
    const cls = typeof el.className === 'string' ? el.className.trim().split(/\s+/).slice(0, 4).join('.') : '';
    const txt = (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40);
    return `${el.tagName.toLowerCase()}${cls ? '.' + cls : ''}${txt ? ` « ${txt} »` : ''}`;
  };
  const push = (type, el, detail) => {
    const key = `${type}|${short(el)}`;
    if (seen.has(key) || out.length > 60) return;
    seen.add(key);
    out.push({ type, el: short(el), detail });
  };
  const rootEl = scope ? document.querySelector(scope) : document.body;
  if (!rootEl) return { vw, docScroll: 0, issues: [] };
  const docScroll = Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - vw;
  const visible = (el, r, cs) => !el.closest('[data-stacked] thead') &&
    r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && !el.closest('[aria-hidden="true"], .sr-only, [hidden]');
  const clippers = (el) => {
    const list = [];
    for (let p = el.parentElement; p && p !== document.documentElement; p = p.parentElement) {
      const cs = getComputedStyle(p);
      if (/(hidden|clip|auto|scroll)/.test(cs.overflowX)) list.push({ p, cs });
      if (cs.position === 'fixed') break;
    }
    return list;
  };
  const els = [...rootEl.querySelectorAll('*')];
  for (const el of els) {
    if (el.closest('svg') && el.tagName.toLowerCase() !== 'svg') continue;
    if (['SCRIPT', 'STYLE', 'TEMPLATE', 'OPTION', 'PATH', 'BR', 'WBR'].includes(el.tagName)) continue;
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    if (!visible(el, r, cs)) continue;
    const tolerance = 1.5;
    const chain = clippers(el);
    // 1) Sorti de la fenêtre sans être contenu par un ancêtre qui coupe : débordement réel de page.
    const clippedByAncestor = chain.some(({ p }) => {
      const pr = p.getBoundingClientRect();
      return pr.right <= vw + tolerance && pr.left >= -tolerance;
    });
    const fixedOrAbs = cs.position === 'fixed';
    if (!clippedByAncestor && (r.right > vw + tolerance || r.left < -tolerance) && cs.display !== 'inline') {
      const inOverlay = el.closest('[role=dialog], [data-radix-popper-content-wrapper]');
      push(fixedOrAbs || inOverlay ? 'hors-fenetre-overlay' : 'hors-fenetre', el, `gauche=${Math.round(r.left)} droite=${Math.round(r.right)} fenetre=${vw}`);
    }
    // 2) Plus large que le parent direct qui laisse déborder (overflow visible).
    const parent = el.parentElement;
    if (parent && parent !== document.body && cs.position !== 'absolute' && cs.position !== 'fixed' && cs.display !== 'inline' && cs.display !== 'contents') {
      const ps = getComputedStyle(parent);
      const pr = parent.getBoundingClientRect();
      if (parseFloat(cs.marginRight) >= 0 && parseFloat(cs.marginLeft) >= 0 && ps.overflowX === 'visible' && pr.width > 0 && ps.display !== 'contents' && !el.hasAttribute('data-scroll-ok')) {
        const pad = parseFloat(ps.paddingRight) || 0;
        if (r.right > pr.right - 0 + 2 && r.width > 0 && !(ps.display.includes('flex') && ps.flexWrap === 'nowrap' && false)) {
          push('depasse-parent', el, `enfant droite=${Math.round(r.right)} parent droite=${Math.round(pr.right)} (pad ${pad}) dans ${short(parent).replace(/ « .*/, '').slice(0, 90)}`);
        }
      }
    }
    // 3) Conteneur qui défile horizontalement (tableau, carte…) : à éviter, sauf marqué.
    if (/(auto|scroll)/.test(cs.overflowX) && el.scrollWidth > el.clientWidth + 2 && !el.closest('[data-scroll-ok]') && !el.hasAttribute('data-scroll-ok')) {
      push('defile-horizontalement', el, `contenu=${el.scrollWidth} visible=${el.clientWidth}`);
    }
    // 4) Texte coupé : ellipsis sans info-bulle, ou overflow hidden qui masque du contenu.
    if (/(hidden|clip)/.test(cs.overflowX) && el.scrollWidth > el.clientWidth + 2 && el.children.length === 0 && (el.textContent || '').trim() && !/line-clamp/.test(typeof el.className === 'string' ? el.className : '')) {
      // Le kit révèle le texte complet en info-bulle au survol : on simule le survol.
      if (!el.title) el.dispatchEvent(new Event('pointerover', { bubbles: true }));
      const hasTip = el.title || el.getAttribute('aria-label') || el.closest('[title], [data-tooltip]');
      if (cs.textOverflow === 'ellipsis') {
        if (!hasTip) push('tronque-sans-infobulle', el, `contenu=${el.scrollWidth} visible=${el.clientWidth}`);
      } else {
        push('texte-coupe', el, `contenu=${el.scrollWidth} visible=${el.clientWidth}`);
      }
    }
    // 4 ter) line-clamp : coupure voulue, mais le texte complet doit rester accessible (title).
    if (/line-clamp/.test(typeof el.className === 'string' ? el.className : '') && el.scrollHeight > el.clientHeight + 3 && !(el.dispatchEvent(new Event('pointerover', { bubbles: true })) && false) && !el.title && !el.closest('[title]')) {
      push('tronque-sans-infobulle', el, `line-clamp contenu=${el.scrollHeight} visible=${el.clientHeight}`);
    }
    // 4 bis) Texte multi-lignes coupé verticalement (line-clamp maison / hauteur fixe).
    if (/(hidden|clip)/.test(cs.overflowY) && cs.textOverflow !== 'ellipsis' && el.scrollHeight > el.clientHeight + 3 && el.children.length === 0 && (el.textContent || '').trim().length > 3 && !/-webkit-box/.test(cs.display) && !/line-clamp/.test(typeof el.className === 'string' ? el.className : '')) {
      push('texte-coupe-vertical', el, `contenu=${el.scrollHeight} visible=${el.clientHeight}`);
    }
    // 5) Images, canvas, svg plus larges que la carte qui les contient.
    if (['IMG', 'CANVAS', 'SVG', 'VIDEO', 'IFRAME'].includes(el.tagName.toUpperCase())) {
      const host = el.closest('[class*="rounded"], section, article, li, td, main') || parent;
      // Tuiles de carte (Google/Leaflet) : bien plus grandes que le cadre par construction, mais
      // le cadre les masque déjà (overflow-hidden) — ce n'est pas un débordement visuel réel.
      const framed = host && /(hidden|clip)/.test(getComputedStyle(host).overflowX);
      if (host && host !== el && !framed) {
        const hr = host.getBoundingClientRect();
        if (r.right > hr.right + 2 || r.left < hr.left - 2) push('media-plus-large-que-carte', el, `media ${Math.round(r.left)}-${Math.round(r.right)} carte ${Math.round(hr.left)}-${Math.round(hr.right)}`);
      }
    }
    // 6) Chevauchement de frères en flux normal (texte/boutons qui se marchent dessus).
    if (el.children.length > 1 && cs.display !== 'contents' && !cs.display.includes('table') && el.tagName.toLowerCase() !== 'svg' && !el.closest('svg')) {
      const kids = [...el.children].filter((k) => {
        const kcs = getComputedStyle(k);
        const kr = k.getBoundingClientRect();
        return kr.width > 4 && kr.height > 4 && kcs.position !== 'absolute' && kcs.position !== 'fixed' && kcs.display !== 'none' && kcs.visibility !== 'hidden' && !/^(SCRIPT|STYLE)$/.test(k.tagName);
      });
      for (let i = 0; i < kids.length && i < 30; i++) {
        const a = kids[i].getBoundingClientRect();
        for (let j = i + 1; j < kids.length && j < 30; j++) {
          const b = kids[j].getBoundingClientRect();
          const ox = Math.min(a.right, b.right) - Math.max(a.left, b.left);
          const oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
          const neg = (k) => { const c = getComputedStyle(k); return parseFloat(c.marginLeft) < 0 || parseFloat(c.marginRight) < 0 || parseFloat(c.marginInlineStart) < 0; };
          if (ox > 4 && oy > 4 && !neg(kids[i]) && !neg(kids[j]) && getComputedStyle(kids[j]).position !== 'sticky' && getComputedStyle(kids[i]).position !== 'sticky' && getComputedStyle(kids[i]).display !== 'inline' && getComputedStyle(kids[j]).display !== 'inline' && !getComputedStyle(kids[i]).transform.includes('matrix') && !getComputedStyle(kids[j]).transform.includes('matrix')) {
            push('chevauchement', kids[j], `avec ${short(kids[i])} (${Math.round(ox)}x${Math.round(oy)})`);
          }
        }
      }
    }
  }
  return { vw, docScroll, issues: out };
}

// --- Contraintes de stress : noms longs, montants élevés, arabe --------------------------------
function stressInPage(mode) {
  const long = 'Restaurant Les Délices Du Grand Marché Oriental et Méditerranéen Établissements Associés SARL';
  const number = '1 234 567 890,12 €';
  const arabic = 'مطعم الأصالة للمأكولات الشرقية والمشاوي العربية الأصيلة في قلب المدينة القديمة';
  const main = document.querySelector('main') || document.body;
  const walker = document.createTreeWalker(main, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  let i = 0;
  for (const node of nodes) {
    const el = node.parentElement;
    const text = node.textContent.trim();
    if (!el || !text || el.closest('button, label, th, nav, script, style, [role=tab], [role=tablist], svg, option, select, .select-none, .absolute, [aria-hidden=true]')) continue;
    if (text.length < 3 || text.length > 60) continue;
    i++;
    if (/\d/.test(text) && /[€%]|\d\s?\d/.test(text)) node.textContent = number;
    else if (mode === 'rtl') node.textContent = arabic;
    else if (i % 2 === 0) node.textContent = `${text} ${long}`;
    else if (i % 5 === 0) node.textContent = `${text}-${long.replace(/ /g, '-')}`;
  }
  if (mode === 'rtl') {
    document.documentElement.dir = 'rtl';
    document.documentElement.lang = 'ar';
  }
}

// Fonction autonome (sérialisée dans la page) : `alt` = l'autre thème que celui par défaut de l'app.
function applyThemeInPage(theme, isAdmin) {
  const root = document.documentElement;
  if (isAdmin) root.dataset.theme = theme === 'alt' ? 'restaurant' : 'admin';
  else if (theme === 'alt') root.dataset.mode = 'dark';
  else delete root.dataset.mode;
}

// --- Exécution ---------------------------------------------------------------------------------
const variant = (opts.stress ? '-stress' : opts.rtl ? '-rtl' : '') + (opts.themes === 'alt' ? '-alt' : '');
const outDir = join(root, '.smoke', `overflow-${app}`);
mkdirSync(outDir, { recursive: true });
let browser = null;
let page = null;
const lightArgs = ['--no-sandbox', '--disable-gpu', '--disable-extensions', '--disable-dev-shm-usage', '--disable-background-networking', '--js-flags=--max-old-space-size=384'];
async function boot() {
  for (let i = 1; ; i++) {
    try {
      return await boot1();
    } catch (e) {
      if (i >= 3) throw e;
      console.log(`  démarrage échoué (${String(e.message).slice(0, 60)}), nouvel essai`);
    }
  }
}
async function boot1() {
  if (browser) await browser.close().catch(() => {});
  browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: lightArgs });
  page = await browser.newPage();
  page.on('pageerror', (e) => consoleErrors.add(e.message.slice(0, 200)));
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto(`${base}/connexion`, { waitUntil: 'domcontentloaded', timeout: 90_000 });
  await page.waitForSelector('input[type=email]', { timeout: 90_000 });
  await page.type('input[type=email]', email);
  await page.type('input[autocomplete=current-password]', password);
  await page.click('button[type=submit]');
  await page.waitForFunction(() => window.location.pathname !== '/connexion', { timeout: 30_000 });
}
const isDead = (e) => /Session closed|detached|Target closed|Connection closed|Protocol error/i.test(String(e?.message ?? e));
const report = { app, base, widths, themes, stress: Boolean(opts.stress), rtl: Boolean(opts.rtl), startedAt: new Date().toISOString(), pages: [], summary: {} };
const consoleErrors = new Set();
const partialReportFile = join(root, '.smoke', `overflow-${app}-${email.split('@')[0]}${variant}.partial.json`);
const saveProgress = () => { try { writeFileSync(partialReportFile, JSON.stringify(report, null, 1)); } catch {} };

try {
  await boot();

  const settle = (ms = 700) => new Promise((r) => setTimeout(r, ms));
  const setWidth = async (w) => {
    await page.setViewport({ width: w, height: w < 600 ? 844 : w < 1000 ? 1024 : 900 });
    await settle(450);
  };
  const shotOf = async (name) => {
    if (!shots) return null;
    const file = join(outDir, `${name}.jpg`);
    await page.screenshot({ path: file, type: 'jpeg', quality: 55, fullPage: true });
    return file;
  };

  const targets = [];
  for (const r of staticRoutes) targets.push({ route: r, url: `/${r}` });
  await setWidth(1440);
  // Routes dynamiques : on ouvre la première ligne / le premier lien de la liste parente
  // et on relève l'adresse atteinte (les identifiants réels viennent des données de démonstration).
  const hints = {
    'analytics/:section': ['analytics/croissance', 'analytics/commerces', 'analytics/livreurs', 'analytics/villes', 'analytics/abonnements', 'analytics/tunnel'],
    'commandes/:orderId': ['commandes/o-12888'],
    'livreurs/:driverId': ['livreurs/sim-driver-longwy-3'],
    'support/:ticketId': ['support/ticket-4511'],
    'clients/:userId': ['clients/sim-client-metz-6'],
    'restaurants/:restaurantId': ['restaurants/onda-pasta-club'],
    'finance/reversements/:payoutId': ['finance/reversements/po-r-santo-smash-2026-09-21'],
  };
  const resolved = [];
  for (const pattern of dynamicRoutes) {
    if (routeFilter && !routeFilter.some((f) => pattern.includes(f))) continue;
    const regex = new RegExp('^/' + pattern.replace(/:[^/]+/g, '[^/]+') + '$');
    const parts = pattern.split('/');
    const parents = [];
    for (let i = parts.length - 1; i >= 1; i--) {
      const candidate = parts.slice(0, i).filter((p) => !p.startsWith(':')).join('/');
      if (staticRoutes.includes(candidate)) parents.push(candidate);
    }
    parents.push(parts[0]);
    let url = null;
    for (const parent of new Set(parents)) {
     try {
      await page.goto(`${base}/${parent}`, { waitUntil: 'networkidle2', timeout: 60_000 }).catch(() => {});
      await page
        .waitForFunction(
          (src) => {
            const re = new RegExp(src);
            return [...document.querySelectorAll('a[href^="/"]')].some((a) => re.test(a.getAttribute('href').split('?')[0])) || document.querySelectorAll('main tbody tr, main [role=row]').length > 1;
          },
          { timeout: 20_000, polling: 500 },
          regex.source,
        )
        .catch(() => {});
      await settle(800);
      const hrefs = await page.$$eval('a[href^="/"]', (as) => as.map((a) => a.getAttribute('href').split('?')[0]));
      url = hrefs.find((h) => regex.test(h) && !staticRoutes.includes(h.slice(1))) ?? null;
      for (const selector of ['main tbody tr', 'main [role=row]', 'main a[href]', 'main [role=button]', 'main li', 'main article']) {
        if (url) break;
        const handles = await page.$$(selector);
        for (const h of handles.slice(0, 3)) {
         try {
          await h.click().catch(() => {});
          await settle(900);
          const path = new URL(page.url()).pathname;
          if (regex.test(path) && !staticRoutes.includes(path.slice(1))) {
            url = path;
            break;
          }
          if (new URL(page.url()).pathname !== `/${parent}`) await page.goto(`${base}/${parent}`, { waitUntil: 'networkidle2' }).catch(() => {});
          await settle(700);
         } catch (e) {
          await page.goto(`${base}/${parent}`, { waitUntil: 'networkidle2' }).catch(() => {});
          await settle(1500);
         }
        }
      }
      if (url) break;
     } catch (e) {
      if (isDead(e)) await boot().catch(() => {});
      console.log(`  résolution ${pattern} via ${parent} : ${String(e.message).slice(0, 80)}`);
     }
    }
    resolved.push({ pattern, url });
    console.log(`dynamique ${pattern} -> ${url ?? 'NON RÉSOLUE'}`);
  }
  for (const d of resolved) if (d.url && !targets.some((t) => t.url === d.url)) targets.push({ route: d.pattern, url: d.url });
  // Identifiants connus des données de démonstration : repli quand la découverte par clic échoue.
  for (const [pattern, urls] of Object.entries(hints)) {
    if (!dynamicRoutes.includes(pattern) || (routeFilter && !routeFilter.some((f) => pattern.includes(f)))) continue;
    for (const u of urls) if (!targets.some((t) => t.url === `/${u}`)) targets.push({ route: pattern, url: `/${u}` });
  }
  report.unresolvedDynamic = resolved.filter((d) => !d.url).map((d) => d.pattern);
  // --skip-done : ignore les pages déjà auditées (non refusées) par un autre compte, même mode.
  const doneUrls = new Set();
  if (opts['skip-done']) {
    const suffix = variant;
    for (const f of readdirSync(join(root, '.smoke'))) {
      if (!f.startsWith(`overflow-${app}-`) || !f.endsWith(`${suffix}.json`) || (!suffix && /-(stress|rtl|alt)\.json$/.test(f))) continue;
      if (f === `overflow-${app}-${email.split('@')[0]}${suffix}.json`) continue;
      try {
        for (const p of JSON.parse(readFileSync(join(root, '.smoke', f), 'utf8')).pages) if (!p.denied && !p.error) doneUrls.add(p.url);
      } catch {}
    }
  }
  const toVisit = targets.filter((t) => (!routeFilter || routeFilter.some((f) => t.route.includes(f))) && !doneUrls.has(t.url));
  const sequence = [...widths, ...widths.slice(0, -1).reverse()]; // réduit puis agrandit, en direct
  const isAdmin = app === 'admin';

  for (const theme of themes) {
    for (const t of toVisit) {
     let attempt = 0;
     for (;;) {
      attempt++;
      const entry = { route: t.route, url: t.url, theme, mode: opts.stress ? 'stress' : opts.rtl ? 'rtl' : 'normal', measures: [], dialogs: [] };
      try {
        await setWidth(widths[0]);
        await page.goto(`${base}${t.url}`, { waitUntil: 'networkidle2', timeout: 60_000 });
        await page.evaluate(applyThemeInPage, theme, isAdmin);
        await settle(1200);
        if (opts.stress || opts.rtl) {
          await page.evaluate(stressInPage, opts.rtl ? 'rtl' : 'stress');
          await settle(300);
        }
        entry.denied = await page.evaluate(() => /Rubrique non accessible|Accès refusé/i.test(document.body.innerText));
        if (entry.denied) {
          report.pages.push(entry);
          console.log(`${theme.padEnd(7)} ${t.url.padEnd(38)} refusé pour ce rôle`);
          break;
        }
        entry.title = await page.$eval('main h1', (h) => h.textContent.trim()).catch(() => null);
        entry.finalUrl = new URL(page.url()).pathname;
        for (const w of sequence) {
          await setWidth(w);
          const m = await page.evaluate(measureInPage, null);
          entry.measures.push({ width: w, live: true, docScroll: m.docScroll, issues: m.issues });
          const isMin = w === widths[widths.length - 1] && entry.measures.length === widths.length;
          if (theme === 'default' && shots && !opts.stress && !opts.rtl && (w === 1440 || w === 390) && entry.measures.length <= widths.length) {
            entry.shots ??= [];
            const s = await shotOf(`${t.url.replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '') || 'accueil'}-${w}`);
            entry.shots.push(s);
          }
          void isMin;
        }
        // Rechargement direct à la plus petite largeur : le rendu initial doit aussi tenir.
        if (widths.length > 1) {
          await setWidth(widths[widths.length - 1]);
          await page.reload({ waitUntil: 'networkidle2', timeout: 60_000 });
          await page.evaluate(applyThemeInPage, theme, isAdmin);
          if (opts.stress || opts.rtl) await page.evaluate(stressInPage, opts.rtl ? 'rtl' : 'stress');
          await settle(1200);
          const m = await page.evaluate(measureInPage, null);
          entry.measures.push({ width: widths[widths.length - 1], live: false, docScroll: m.docScroll, issues: m.issues });
        }
        // Modales / tiroirs ouverts depuis les boutons primaires.
        if (withDialogs && theme === 'default') {
          for (const w of [widths[0], widths[widths.length - 2] ?? widths[0], widths[widths.length - 1]]) {
            await setWidth(w);
            const labels = await page.$$eval('main button, main a[role=button]', (bs) =>
              bs
                .filter((b) => b.offsetParent && !b.disabled && b.type !== 'submit')
                .map((b) => (b.textContent || '').trim())
                .filter((x) => /^(Nouveau|Nouvelle|Ajouter|Créer|Inviter|Importer|Modifier|Configurer|Programmer|Planifier|Enregistrer un|Publier)/i.test(x))
                .slice(0, 2),
            );
            for (const label of labels) {
              const handle = await page.evaluateHandle((l) => [...document.querySelectorAll('main button, main a[role=button]')].find((b) => (b.textContent || '').trim() === l && b.offsetParent), label);
              const el = handle.asElement();
              if (!el) continue;
              const beforeUrl = page.url();
              await el.click().catch(() => {});
              await settle(700);
              const dlg = await page.evaluate(() => {
                const d = document.querySelector('[role=dialog]');
                if (!d) return null;
                const r = d.getBoundingClientRect();
                return { right: r.right, left: r.left, top: r.top, bottom: r.bottom, vw: document.documentElement.clientWidth, vh: window.innerHeight };
              });
              if (dlg) {
                const m = await page.evaluate(measureInPage, '[role=dialog]');
                const outside = dlg.right > dlg.vw + 1 || dlg.left < -1 || dlg.bottom > dlg.vh + 1 || dlg.top < -1;
                const issues = m.issues.filter((i) => i.type !== 'hors-fenetre-overlay' || outside);
                if (outside) issues.push({ type: 'modale-hors-ecran', el: 'dialog', detail: JSON.stringify(dlg) });
                entry.dialogs.push({ label, width: w, docScroll: m.docScroll, issues });
                if (shots && w === widths[widths.length - 1]) await page.screenshot({ path: join(outDir, `${(t.url.replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '') || 'accueil')}-dialog-${w}.jpg`), type: 'jpeg', quality: 55 });
                await page.keyboard.press('Escape');
                await settle(400);
              } else if (page.url() !== beforeUrl) {
                await page.goBack({ waitUntil: 'networkidle2' }).catch(() => {});
                await settle(600);
              }
            }
          }
        }
      } catch (error) {
        entry.error = String(error.message ?? error).slice(0, 200);
        if (/Execution context|Navigation|timeout/i.test(String(error?.message)) && !isDead(error) && attempt < 3) {
          console.log(`  nouvel essai (${t.url}) : ${String(error.message).slice(0, 60)}`);
          continue;
        }
        if (isDead(error) && attempt < 3) {
          console.log(`  navigateur perdu, relance (${t.url})`);
          await boot().catch(() => {});
          continue;
        }
      }
      report.pages.push(entry);
      saveProgress();
      const n = entry.measures.reduce((a, m) => a + m.issues.length + (m.docScroll > 1 ? 1 : 0), 0) + entry.dialogs.reduce((a, d) => a + d.issues.length, 0);
      console.log(`${theme.padEnd(7)} ${t.url.padEnd(38)} défauts=${n}${entry.error ? ' ERREUR ' + entry.error : ''}`);
      break;
     }
    }
  }

  // Coquille : menu mobile et palette ⌘K.
  const shell = [];
  try {
    if (withDialogs) {
      await page.goto(`${base}/`, { waitUntil: 'networkidle2', timeout: 60_000 });
      await page.evaluate(applyThemeInPage, 'default', isAdmin);
      for (const w of [widths[widths.length - 2] ?? 390, widths[widths.length - 1]]) {
        await setWidth(w);
        const btn = await page.evaluateHandle(() => [...document.querySelectorAll('header button, button[aria-label]')].find((b) => /menu|navigation/i.test(b.getAttribute('aria-label') || '') && b.offsetParent));
        const el = btn.asElement();
        if (el) {
          await el.click();
          await settle(600);
          const m = await page.evaluate(measureInPage, null);
          shell.push({ what: 'menu-mobile', width: w, docScroll: m.docScroll, issues: m.issues });
          await page.keyboard.press('Escape');
          await settle(300);
        }
        await page.keyboard.down('Control');
        await page.keyboard.press('k');
        await page.keyboard.up('Control');
        await settle(600);
        if (await page.$('[role=dialog]')) {
          const m = await page.evaluate(measureInPage, '[role=dialog]');
          shell.push({ what: 'palette', width: w, docScroll: m.docScroll, issues: m.issues });
          await page.keyboard.press('Escape');
        }
      }
    }
  } catch (error) {
    console.log(`  coquille (menu/palette) ignorée après erreur : ${String(error.message ?? error).slice(0, 100)}`);
  }
  report.shell = shell;
} finally {
  // Windows : le nettoyage du profil Chrome peut échouer (fichier verrouillé) sans conséquence.
  await browser.close().catch(() => {});
}

// --- Synthèse ------------------------------------------------------------------------------------
const byType = {};
let total = 0;
const add = (type) => {
  byType[type] = (byType[type] ?? 0) + 1;
  total++;
};
const pagesWithDefects = new Set();
for (const p of report.pages) {
  if (p.error) (add('erreur-audit'), pagesWithDefects.add(p.url));
  for (const m of p.measures) {
    if (m.docScroll > 1) {
      add('defilement-page');
      pagesWithDefects.add(p.url);
    }
    for (const i of m.issues) {
      add(i.type);
      pagesWithDefects.add(p.url);
    }
  }
  for (const d of p.dialogs) for (const i of d.issues) (add(i.type), pagesWithDefects.add(p.url));
}
for (const s of report.shell ?? []) for (const i of s.issues) add(i.type);
report.summary = { pagesAudited: report.pages.length, pagesWithDefects: [...pagesWithDefects].length, totalDefects: total, byType, pageErrors: [...consoleErrors] };
report.finishedAt = new Date().toISOString();
const reportFile = join(root, '.smoke', `overflow-${app}-${email.split('@')[0]}${variant}.json`);
writeFileSync(reportFile, JSON.stringify(report, null, 1));
try { rmSync(partialReportFile); } catch {}
console.log(JSON.stringify(report.summary, null, 1));
console.log('Rapport :', reportFile);
process.exitCode = total > 0 ? 1 : 0;
