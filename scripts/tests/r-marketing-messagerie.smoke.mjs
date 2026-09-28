// Contrôle visuel des rubriques marketing et messagerie du back-office restaurant.
// Une connexion, plusieurs pages ; capture pleine page, débordement horizontal
// et erreurs de console pour chacune.
//
// Usage : node scripts/tests/r-marketing-messagerie.smoke.mjs <e-mail> <largeur> <chemin> [chemin…]
//   PORT=5305 (défaut), RESTAURANT=<id> pour choisir l'établissement actif,
//   STEPS=<fichier.mjs> : module exportant `default async (page, path) => void` (interactions).
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import puppeteer from 'puppeteer-core';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const [email, width = '1440', ...pages] = process.argv.slice(2);
const port = process.env.PORT ?? '5305';
const accounts = readFileSync(join(root, '.test-accounts.local.md'), 'utf8');
const password = [...accounts.matchAll(/\|\s*`([^`]+)`\s*\|\s*`([^`]+)`\s*\|/g)].find((m) => m[1] === email)?.[2];
if (!password) throw new Error(`Compte inconnu : ${email}`);

const steps = process.env.STEPS ? (await import(pathToFileURL(process.env.STEPS).href)).default : null;
const base = `http://localhost:${port}`;
const outDir = join(root, '.smoke');
mkdirSync(outDir, { recursive: true });
const chrome = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
if (!existsSync(chrome)) throw new Error('Chrome introuvable');

const browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ['--no-sandbox'] });
const results = [];
try {
  const page = await browser.newPage();
  let errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text().slice(0, Number(process.env.ERRLEN ?? 300)) + (m.args().length > 1 ? ' | ' + m.args().slice(1).map((a) => String(a.remoteObject().value ?? '')).join(' ').slice(0, 1500) : '')));
  page.on('pageerror', (e) => errors.push(e.message.slice(0, 300)));
  await page.setViewport({ width: Number(width), height: Number(width) < 600 ? 844 : 900 });
  // Thème : COLOR=light (défaut du thème restaurant) ou COLOR=dark.
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: process.env.COLOR ?? 'light' }]);
  await page.goto(`${base}/connexion`, { waitUntil: 'networkidle0', timeout: 90_000 });
  await page.type('input[type=email]', email);
  await page.type('input[autocomplete=current-password]', password);
  await page.click('button[type=submit]');
  await page.waitForFunction(() => window.location.pathname !== '/connexion', { timeout: 30_000 });
  if (process.env.RESTAURANT) {
    await page.evaluate((rid) => {
      for (const key of Object.keys(localStorage)) if (key.startsWith('golink:restaurant:')) localStorage.setItem(key, JSON.stringify(rid));
    }, process.env.RESTAURANT);
  }
  for (const path of pages.length ? pages : ['/parametres']) {
    errors = [];
    await page.goto(`${base}${path}`, { waitUntil: 'networkidle2', timeout: 60_000 });
    await new Promise((r) => setTimeout(r, Number(process.env.WAIT ?? 2500)));
    if (steps) await steps(page, path);
    const report = await page.evaluate(() => ({
      title: document.querySelector('main h1')?.textContent?.trim() ?? null,
      overflow: document.documentElement.scrollWidth - window.innerWidth,
    }));
    const name = `rmm-${email.split('@')[0]}-${path.replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '')}-${width}${process.env.TAG ? `-${process.env.TAG}` : ''}.png`;
    await page.screenshot({ path: join(outDir, name), fullPage: true });
    results.push({ path, ...report, screenshot: name, errors });
  }
} finally {
  await browser.close();
}
console.log(JSON.stringify(results, null, 2));
