// Contrôle visuel des rubriques Argent du super admin (paiements, finance,
// facturation, abonnements) : connexion réelle, captures 1440 / 390 px, erreurs console,
// débordement horizontal. Serveur de développement du module sur le port 5404.
//
// Usage : node scripts/tests/a-argent.smoke.mjs <e-mail> <chemin,chemin…> [largeurs] [--wait=ms]
//   ex. : node scripts/tests/a-argent.smoke.mjs finance@golink.test /finance,/paiements 1440,390
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const flags = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => a.slice(2).split('=')));
const [email, pathsArg = '/', widthsArg = '1440,390'] = args;
const base = `http://localhost:${process.env.ARGENT_PORT ?? 5404}`;
const wait = Number(flags.wait ?? 3500);

const accounts = readFileSync(join(root, '.test-accounts.local.md'), 'utf8');
const password = [...accounts.matchAll(/\|\s*`([^`]+)`\s*\|\s*`([^`]+)`\s*\|/g)].find((m) => m[1] === email)?.[2];
if (!password) {
  console.error(`Compte inconnu : ${email}`);
  process.exit(1);
}
const chrome = ['C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/google-chrome'].find((c) => existsSync(c));
const outDir = join(root, '.smoke', 'a-argent');
mkdirSync(outDir, { recursive: true });

const browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ['--no-sandbox'] });
let failed = false;
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text().slice(0, 400)));
  page.on('pageerror', (e) => errors.push(e.message.slice(0, 400)));
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto(`${base}/connexion`, { waitUntil: 'networkidle0', timeout: 90_000 });
  await page.type('input[type=email]', email);
  await page.type('input[autocomplete=current-password]', password);
  await page.click('button[type=submit]');
  await page.waitForFunction(() => window.location.pathname !== '/connexion', { timeout: 30_000 });
  await new Promise((r) => setTimeout(r, 1500));

  for (const width of widthsArg.split(',').map(Number)) {
    await page.setViewport({ width, height: width < 600 ? 844 : 900 });
    for (const path of pathsArg.split(',')) {
      errors.length = 0;
      await page.goto(`${base}${path}`, { waitUntil: 'networkidle2', timeout: 90_000 });
      await new Promise((r) => setTimeout(r, wait));
      const report = await page.evaluate(() => ({
        title: document.querySelector('main h1')?.textContent?.trim() ?? null,
        overflow: document.documentElement.scrollWidth - window.innerWidth,
        wide: [...document.querySelectorAll('main *')]
          .filter((el) => el.getBoundingClientRect().right > window.innerWidth + 1 && !el.closest('[data-scroll], .overflow-x-auto, .overflow-auto, table'))
          .slice(0, 5)
          .map((el) => `${el.tagName.toLowerCase()}.${String(el.className).slice(0, 80)}`),
      }));
      const name = `${email.split('@')[0]}-${path.replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '') || 'accueil'}-${width}.png`;
      // Viewport à la hauteur de la page : évite que la capture pleine page relance les animations des graphiques.
      const fullHeight = await page.evaluate(() => document.documentElement.scrollHeight);
      await page.setViewport({ width, height: Math.min(fullHeight, 12_000) });
      await new Promise((r) => setTimeout(r, 2200));
      await page.screenshot({ path: join(outDir, name) });
      await page.setViewport({ width, height: width < 600 ? 844 : 900 });
      const ok = report.overflow <= 0 && errors.length === 0;
      if (!ok) failed = true;
      console.log(JSON.stringify({ path, width, ...report, errors: [...errors], shot: name }));
    }
  }
} finally {
  await browser.close();
}
process.exitCode = failed ? 1 : 0;
