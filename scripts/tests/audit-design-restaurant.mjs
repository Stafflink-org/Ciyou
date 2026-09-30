// Audit d'identité visuelle de l'application restaurant, écran par écran.
// Adapté de audit-overflow-restaurant.mjs : au lieu de chercher des débordements,
// capture une preuve visuelle (capture d'écran) + des faits CSS par route, et écrit
// le rapport PROGRESSIVEMENT (une ligne par route dès qu'elle est traitée), pour ne
// jamais perdre le travail déjà fait si la tâche est interrompue.
//
// Usage : node scripts/tests/audit-design-restaurant.mjs [--base https://restaurant.ciyou.io]
//   [--account mina.haddad@golink.test] [--width 1440] [--only /planning,/paie] [--resume]
import { existsSync, mkdirSync, readFileSync, readdirSync, appendFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const args = {};
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  if (argv[i].startsWith('--')) args[argv[i].slice(2)] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : '1';
}
const base = (args.base ?? 'https://restaurant.ciyou.io').replace(/\/$/, '');
const email = args.account ?? 'mina.haddad@golink.test';
const width = Number(args.width ?? 1440);
const only = args.only?.split(',');
const accounts = readFileSync(join(root, '.test-accounts.local.md'), 'utf8');
const password = [...accounts.matchAll(/\|\s*`([^`]+)`\s*\|\s*`([^`]+)`\s*\|/g)].find((m) => m[1] === email)?.[2];
if (!password) throw new Error(`mot de passe introuvable pour ${email} dans .test-accounts.local.md`);

const CHROME_PATH =
  process.platform === 'darwin'
    ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
    : 'C:/Program Files/Google/Chrome/Application/chrome.exe';

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
  const b = r.replace(/\/:.*$/, '');
  await page.goto(`${base}${b}`, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
  await wait(1500);
  const viaLink = await page.evaluate(
    (bb) =>
      [...document.querySelectorAll('main a[href]')]
        .map((a) => a.getAttribute('href'))
        .find((h) => h.startsWith(bb + '/') && !/historique|suivi|reglages|checklists|modeles|temperatures|nouveau/.test(h.slice(bb.length))) ?? null,
    b,
  );
  if (viaLink) return viaLink;
  for (const sel of ['main tbody tr', 'main [role=row]', 'main [role=button]', 'main li[tabindex]']) {
    const h = await page.$(sel);
    if (!h) continue;
    await h.click().catch(() => {});
    await wait(1200);
    const p = new URL(page.url()).pathname;
    if (p.startsWith(b + '/') && !/historique|suivi/.test(p)) return p;
    if (p !== b) await page.goto(`${base}${b}`, { waitUntil: 'domcontentloaded' }).catch(() => {});
  }
  return null;
};
routes = routes.filter((r) => !only || only.some((o) => r.startsWith('/' + o.replace(/^[/\\]+/, ''))));
routes.sort();

const outDir = join(root, '.smoke', 'design-audit');
mkdirSync(outDir, { recursive: true });
const reportPath = join(root, 'docs', 'AUDIT_DESIGN_RESTAURANT.md');

const already = new Set();
if (args.resume && existsSync(reportPath)) {
  const txt = readFileSync(reportPath, 'utf8');
  for (const m of txt.matchAll(/^\|\s*`([^`]+)`\s*\|/gm)) already.add(m[1]);
}
if (!args.resume || !existsSync(reportPath)) {
  writeFileSync(
    reportPath,
    `# Audit d'identité visuelle — back-office restaurant (écran par écran)\n\n` +
      `Date : ${new Date().toISOString().slice(0, 10)}. Cible : \`${base}\` (compte \`${email}\`), largeur ${width}px, thème/mode par défaut (\`data-theme=restaurant\`, \`data-mode=dark\`).\n\n` +
      `Méthode : capture d'écran (viewport, pas pleine page) + relevé des attributs de thème et des couleurs de fond réellement calculées pour chaque route du back-office restaurant, comparées à l'identité du super admin documentée dans \`docs/DESIGN_SYSTEM.md\`. Un écran est marqué DÉFAUT seulement après vérification visuelle réelle de la capture (pas une heuristique seule) ; toute correction de code réelle est indiquée avec le fichier touché.\n\n` +
      `| Route | data-theme | data-mode | Fond body | Fond barre latérale | Capture | Statut |\n` +
      `|---|---|---|---|---|---|---|\n`,
  );
}

const detectTheme = () => {
  const html = document.documentElement;
  const bodyBg = getComputedStyle(document.body).backgroundColor;
  const sidebar = document.querySelector('[class*="sidebar" i], nav[data-sidebar], aside');
  const sidebarBg = sidebar ? getComputedStyle(sidebar).backgroundColor : null;
  return {
    theme: html.dataset.theme ?? null,
    mode: html.dataset.mode ?? null,
    bodyBg,
    sidebarBg,
  };
};

const browser = await puppeteer.launch({ executablePath: CHROME_PATH, headless: true, args: ['--no-sandbox'] });
let ok = 0;
let skipped = 0;
try {
  const page = await browser.newPage();
  await page.setViewport({ width, height: 900 });
  await page.goto(`${base}/connexion`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('input[type=email]', { timeout: 30000 });
  await page.type('input[type=email]', email);
  await page.type('input[autocomplete=current-password]', password);
  await page.click('button[type=submit]');
  await page.waitForFunction(() => location.pathname !== '/connexion', { timeout: 30000 });
  await wait(3000); // porte CGU/cookies (LegalGate) à laisser se refermer avant de naviguer

  const resolved = [];
  for (const r of routes) {
    if (dyn(r) || r.endsWith('/nouveau')) {
      const t = await resolveDyn(page, r);
      if (t) resolved.push(t);
      else resolved.push(null);
    } else resolved.push(r);
  }

  for (let i = 0; i < routes.length; i++) {
    const original = routes[i];
    const r = resolved[i];
    if (already.has(original)) {
      skipped++;
      continue;
    }
    if (!r) {
      appendFileSync(reportPath, `| \`${original}\` | - | - | - | - | - | AUCUNE DONNÉE pour résoudre la route dynamique |\n`);
      continue;
    }
    await page.goto(`${base}${r}`, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
    await wait(1600);
    const d = await page.evaluate(detectTheme).catch(() => null);
    const shotName = `${original.replace(/[^a-z0-9]+/gi, '_')}.png`;
    await page.screenshot({ path: join(outDir, shotName) }).catch(() => {});
    ok++;
    const row = `| \`${original}\` | ${d?.theme ?? '?'} | ${d?.mode ?? '?'} | ${d?.bodyBg ?? '?'} | ${d?.sidebarBg ?? '?'} | \`.smoke/design-audit/${shotName}\` | À REVOIR |\n`;
    appendFileSync(reportPath, row);
    console.log(`[${ok}/${routes.length}] ${original} -> ${r}`);
  }
} finally {
  await browser.close();
}
console.log(`routes capturées : ${ok}, déjà faites (reprise) : ${skipped}, total : ${routes.length}`);
