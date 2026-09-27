// Contrôle visuel des rubriques d'exploitation du super admin (livreurs, flotte,
// commandes, règles, zones) : une connexion par compte, chaque page à la largeur
// demandée, capture pleine page, débordement horizontal et erreurs de la console.
//
// Usage : node scripts/tests/a-livreurs-operations.smoke.mjs <e-mail> [largeur] [port] [chemins…]
// Captures : .smoke/ops-<compte>-<chemin>-<largeur>.png
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const [email, width = '1440', port = '5403', ...custom] = process.argv.slice(2);
const PAGES = custom.length
  ? custom
  : [
      '/livreurs',
      '/livreurs/validation',
      '/livreurs/documents',
      '/livreurs/identite',
      '/livreurs/sanctions',
      '/livreurs/remuneration',
      '/livreurs/attribution',
      '/livreurs/seed-driver-003',
      '/flotte',
      '/commandes',
      '/commandes/direct',
      '/commandes/anomalies',
      '/regles-commandes',
      '/zones',
    ];

const accounts = readFileSync(join(root, '.test-accounts.local.md'), 'utf8');
const password = [...accounts.matchAll(/\|\s*`([^`]+)`\s*\|\s*`([^`]+)`\s*\|/g)].find((m) => m[1] === email)?.[2];
if (!password) {
  console.error(`Compte inconnu : ${email}`);
  process.exit(1);
}
const chrome = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
if (!existsSync(chrome)) {
  console.error('Chrome introuvable.');
  process.exit(1);
}
const base = `http://${process.env.SMOKE_HOST ?? 'localhost'}:${port}`;
const outDir = join(root, '.smoke');
mkdirSync(outDir, { recursive: true });

const browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ['--no-sandbox'] });
let failures = 0;
try {
  const page = await browser.newPage();
  let errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text().slice(0, 300)));
  page.on('pageerror', (e) => errors.push(e.message.slice(0, 300)));
  await page.setViewport({ width: Number(width), height: Number(width) < 600 ? 844 : 900 });
  await page.goto(`${base}/connexion`, { waitUntil: 'networkidle0', timeout: 90_000 });
  await page.type('input[type=email]', email);
  await page.type('input[autocomplete=current-password]', password);
  await page.click('button[type=submit]');
  await page.waitForFunction(() => window.location.pathname !== '/connexion', { timeout: 30_000 });
  await new Promise((r) => setTimeout(r, 2000));
  for (const path of PAGES) {
    errors = [];
    await page.goto(`${base}${path}`, { waitUntil: 'networkidle2', timeout: 60_000 }).catch(() => undefined);
    await new Promise((r) => setTimeout(r, 3500));
    const report = await page.evaluate(() => ({
      title: document.querySelector('main h1')?.textContent?.trim() ?? null,
      overflow: document.documentElement.scrollWidth - window.innerWidth,
    }));
    const file = join(outDir, `ops-${email.split('@')[0]}-${path.replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '')}-${width}.png`);
    await page.screenshot({ path: file, fullPage: true });
    const ok = errors.length === 0 && report.overflow <= 0;
    if (!ok) failures += 1;
    console.log(`${ok ? 'OK ' : 'KO '} ${path} · « ${report.title} » · débordement ${report.overflow}px${errors.length ? ` · erreurs : ${errors.join(' | ')}` : ''}`);
  }
} finally {
  await browser.close();
}
process.exitCode = failures ? 1 : 0;
