// Contrôle visuel des rubriques Restaurants et Clients du super admin : connexion
// réelle, parcours de plusieurs pages, captures pleine page, débordement horizontal
// et erreurs de console.
//
// Usage : node scripts/tests/a-restaurants-clients.smoke.mjs <e-mail> <largeur> <chemin>...
//   PORT (défaut 5402), APP (admin | restaurant), OUT (dossier des captures, défaut .smoke)
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const [email, width = '1440', ...paths] = process.argv.slice(2);
const port = process.env.PORT ?? '5402';
const app = process.env.APP ?? 'admin';
const outDir = process.env.OUT ?? join(root, '.smoke');
const accounts = readFileSync(join(root, '.test-accounts.local.md'), 'utf8');
const password = [...accounts.matchAll(/\|\s*`([^`]+)`\s*\|\s*`([^`]+)`\s*\|/g)].find((m) => m[1] === email)?.[2];
if (!password) {
  console.error(`Compte inconnu : ${email}`);
  process.exit(1);
}
const chrome = ['C:/Program Files/Google/Chrome/Application/chrome.exe'].find((c) => existsSync(c));
const base = `http://localhost:${port}`;
const viewport = { width: Number(width), height: Number(width) < 600 ? 844 : 900 };
mkdirSync(outDir, { recursive: true });

const browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ['--no-sandbox'] });
const results = [];
try {
  const page = await browser.newPage();
  let errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text().slice(0, 300)));
  page.on('pageerror', (e) => errors.push(e.message.slice(0, 300)));
  await page.setViewport(viewport);
  await page.goto(`${base}/connexion`, { waitUntil: 'networkidle0', timeout: 90_000 });
  await page.type('input[type=email]', email);
  await page.type('input[autocomplete=current-password]', password);
  await page.click('button[type=submit]');
  await page.waitForFunction(() => window.location.pathname !== '/connexion', { timeout: 30_000 });
  await new Promise((r) => setTimeout(r, 1500));
  for (const path of paths.length ? paths : ['/restaurants']) {
    errors = [];
    await page.goto(`${base}${path}`, { waitUntil: 'networkidle2', timeout: 60_000 });
    await new Promise((r) => setTimeout(r, Number(process.env.WAIT ?? 3500)));
    const report = await page.evaluate(() => ({
      title: document.querySelector('main h1')?.textContent?.trim() ?? null,
      overflow: document.documentElement.scrollWidth - window.innerWidth,
    }));
    const name = `${app}-arc-${email.split('@')[0]}-${path.replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '') || 'accueil'}-${width}.png`;
    await page.screenshot({ path: join(outDir, name), fullPage: true });
    results.push({ path, ...report, screenshot: name, errors });
  }
} finally {
  await browser.close();
}
console.log(JSON.stringify(results, null, 1));
if (results.some((r) => r.errors.length || r.overflow > 0)) process.exitCode = 1;
