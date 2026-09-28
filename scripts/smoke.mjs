// Contrôle visuel d'un back-office avec un compte de test : connexion réelle,
// ouverture d'une page, capture d'écran et erreurs de la console.
//
// Prérequis : serveur de développement lancé (npm run dev:restaurant → 5173,
// npm run dev:admin → 5174), Chrome installé, .test-accounts.local.md présent
// (généré par npm run seed).
//
// Usage : node scripts/smoke.mjs <restaurant|admin> <e-mail> [chemin] [largeur]
//   ex. : node scripts/smoke.mjs restaurant sofia.martin@golink.test /commandes 390
// Captures : .smoke/<app>-<compte>-<chemin>-<largeur>.png (dossier ignoré par git).
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import { nextCode, readMfa, writeMfa } from './lib/test-mfa.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const [app, email, path = '/', width = '1440'] = process.argv.slice(2);
const ports = { restaurant: Number(process.env.SMOKE_PORT ?? 5173), admin: Number(process.env.SMOKE_PORT ?? 5174) };
if (!(app in ports) || !email) {
  console.error('Usage : node scripts/smoke.mjs <restaurant|admin> <e-mail> [chemin] [largeur]');
  process.exit(1);
}

const accounts = readFileSync(join(root, '.test-accounts.local.md'), 'utf8');
const password = [...accounts.matchAll(/\|\s*`([^`]+)`\s*\|\s*`([^`]+)`\s*\|/g)].find((m) => m[1] === email)?.[2];
if (!password) {
  console.error(`Compte inconnu dans .test-accounts.local.md : ${email}`);
  process.exit(1);
}

const chrome =
  process.env.CHROME_PATH ??
  ['C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/google-chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find(
    (candidate) => existsSync(candidate),
  );
if (!chrome) {
  console.error('Chrome introuvable : indiquer son chemin dans CHROME_PATH.');
  process.exit(1);
}

const base = `http://localhost:${ports[app]}`;
const viewport = { width: Number(width), height: Number(width) < 600 ? 844 : 900 };
const outDir = join(root, '.smoke');
mkdirSync(outDir, { recursive: true });
const file = join(outDir, `${app}-${email.split('@')[0]}-${path.replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '') || 'accueil'}-${width}.png`);

const browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ['--no-sandbox'] });
const errors = [];
try {
  const page = await browser.newPage();
  page.on('console', (message) => message.type() === 'error' && errors.push(message.text().slice(0, 300)));
  page.on('pageerror', (error) => errors.push(error.message.slice(0, 300)));
  await page.setViewport(viewport);

  // networkidle2 (pas networkidle0) : la page de connexion ouvre déjà une écoute Firestore
  // (réglages publics : marque, maintenance) qui reste connectée et bloquerait networkidle0.
  await page.goto(`${base}/connexion`, { waitUntil: 'networkidle2', timeout: 90_000 });
  await page.type('input[type=email]', email);
  await page.type('input[autocomplete=current-password]', password);
  await page.click('button[type=submit]');
  await page.waitForFunction(() => window.location.pathname !== '/connexion', { timeout: 30_000 });

  // Double authentification (obligatoire pour l'équipe interne) : le code est calculé à partir du secret
  // d'enrôlement du compte de TEST (.test-mfa.local.json, voir scripts/tests/mfa-enroll-test-accounts.mjs).
  // Le compte du super administrateur n'a pas de secret ici : il n'est jamais contourné.
  if (app === 'admin') {
    const challenged = await page.waitForFunction(() => document.body.innerText.includes('Double authentification') && Boolean(document.querySelector('input[inputmode=numeric]')), { timeout: 8000 }).then(() => true, () => false);
    if (challenged) {
      const mfa = readMfa();
      const entry = mfa[email];
      if (!entry?.secret) {
        console.error(`Double authentification exigée pour ${email} : aucun secret de test (node scripts/tests/mfa-enroll-test-accounts.mjs ${email}).`);
        process.exitCode = 2;
        throw new Error('2FA sans secret de test');
      }
      const { code, step } = await nextCode(entry.secret, entry.lastStep ?? null);
      await page.type('input[inputmode=numeric]', code);
      await page.click('button[type=submit]');
      await page.waitForFunction(() => !document.body.innerText.includes('Double authentification'), { timeout: 20_000 });
      mfa[email] = { ...entry, lastStep: step };
      writeMfa(mfa);
    }
  }

  // Laisse la redirection cliente de la connexion se stabiliser avant une navigation complète
  // (sinon la page peut encore être en train de rediriger, ce qui détache le cadre en cours).
  await new Promise((resolve) => setTimeout(resolve, 600));
  // Les écoutes Firestore gardent des connexions ouvertes : networkidle2 et non networkidle0.
  if (path !== '/') await page.goto(`${base}${path}`, { waitUntil: 'networkidle2', timeout: 60_000 });
  await new Promise((resolve) => setTimeout(resolve, 2500));

  const report = await page.evaluate(() => ({
    title: document.querySelector('main h1')?.textContent?.trim() ?? null,
    horizontalOverflow: document.documentElement.scrollWidth - window.innerWidth,
  }));
  await page.screenshot({ path: file, fullPage: true });
  console.log(JSON.stringify({ url: page.url(), ...report, screenshot: file, consoleErrors: errors }, null, 2));
  if (errors.length > 0 || report.horizontalOverflow > 0) process.exitCode = 1;
} finally {
  await browser.close();
}
