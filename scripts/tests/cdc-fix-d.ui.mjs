// Recette d'interface du volet « sécurité et audit » (tâche cdc-fix-d) : back-office admin, compte
// JETABLE de super administrateur (jamais superadmin@golink.test) avec double authentification TOTP
// enrôlée par le script, pages Plateforme et sécurité à 1440 px et 390 px, débordement, erreurs de console.
//
// Prérequis : serveur de développement de l'admin lancé (SMOKE_PORT, défaut 5174) sur la vraie base.
//   node scripts/tests/cdc-fix-d.ui.mjs
// Captures : .smoke/cdcd-<page>-<largeur>.png (dossier ignoré par git). Un seul navigateur, fermé en fin de script.
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import { auth, db } from '../lib/admin.mjs';
import { callFn, nextCode, signIn } from '../lib/test-mfa.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const port = Number(process.env.SMOKE_PORT ?? 5174);
const base = `http://localhost:${port}`;
const UID = 'cdcd-uisuper';
const EMAIL = `${UID}@golink.test`;
const chrome =
  process.env.CHROME_PATH ??
  ['C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/google-chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find((c) => existsSync(c));
if (!chrome) throw new Error('Chrome introuvable (CHROME_PATH).');
const outDir = join(root, '.smoke');
mkdirSync(outDir, { recursive: true });

const results = [];
const record = (name, ok, detail) => {
  results.push({ name, ok });
  console.log(`${ok ? 'OK   ' : 'ÉCHEC'} ${name}${detail ? ` — ${detail}` : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function setupAdmin() {
  const password = `${randomBytes(18).toString('base64url')}Aa1`;
  try {
    await auth.getUser(UID);
    await auth.updateUser(UID, { password });
  } catch {
    await auth.createUser({ uid: UID, email: EMAIL, password, emailVerified: true, displayName: 'Test UI cdcd' });
  }
  await auth.setCustomUserClaims(UID, { role: 'admin', adminRole: 'super_admin' });
  await db.doc(`admins/${UID}`).set({ uid: UID, email: EMAIL, displayName: 'Test UI cdcd', role: 'super_admin', permissions: [], active: true, countryIds: [], cityIds: [], refundLimitCents: null, mfaEnrolled: false, lastLoginAt: null, lastLoginIp: null, createdAt: new Date(), createdBy: 'system', updatedAt: new Date(), updatedBy: 'system', test: true });
  await db.doc(`users/${UID}`).set({ role: 'admin', email: EMAIL, firstName: 'Test', lastName: 'UI', displayName: 'Test UI cdcd', status: 'active', locale: 'fr', test: true }, { merge: true });
  // Enrôlement TOTP par les fonctions (comme un administrateur réel), puis secret gardé en mémoire.
  const token = await signIn(EMAIL, password);
  const tracked = await callFn('trackAdminSession', {}, token);
  if (!tracked.ok) throw new Error(`trackAdminSession : ${JSON.stringify(tracked.error)}`);
  const started = await callFn('enrollTotp', { action: 'start' }, token);
  if (!started.ok) throw new Error(`enrollTotp start : ${JSON.stringify(started.error)}`);
  const secret = started.data.secret;
  const { code } = await nextCode(secret, null);
  const confirmed = await callFn('enrollTotp', { action: 'confirm', code }, token);
  if (!confirmed.ok) throw new Error(`enrollTotp confirm : ${JSON.stringify(confirmed.error)}`);
  return { password, secret };
}

async function cleanup() {
  await db.doc(`admins/${UID}`).delete().catch(() => undefined);
  await db.doc(`users/${UID}`).delete().catch(() => undefined);
  await db.doc(`adminSecrets/${UID}`).delete().catch(() => undefined);
  for (const col of ['adminSessions', 'securityAlerts']) {
    const snap = await db.collection(col).where('adminId', '==', UID).get().catch(() => null);
    if (snap) await Promise.all(snap.docs.map((d) => d.ref.delete()));
  }
  await auth.deleteUser(UID).catch(() => undefined);
}

const PAGES = [
  { path: '/plateforme/parametres', title: 'Paramètres plateforme' },
  { path: '/plateforme/journal', title: 'Journal d’audit' },
  { path: '/plateforme/securite', title: 'Sécurité' },
  { path: '/plateforme/fonctionnalites', title: 'Activation des fonctionnalités' },
  { path: '/plateforme/connexions', title: 'Connexions externes' },
  { path: '/plateforme/marches', title: 'Multi-pays' },
  { path: '/plateforme/administrateurs', title: 'Administrateurs' },
  { path: '/paiements/regles', title: 'Frais et remboursements' },
];

let browser;
try {
  const { password, secret } = await setupAdmin();
  browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text().slice(0, 240)));
  page.on('pageerror', (e) => errors.push(e.message.slice(0, 240)));
  await page.setViewport({ width: 1440, height: 900 });

  // Connexion + double authentification.
  await page.goto(`${base}/connexion`, { waitUntil: 'networkidle0', timeout: 90_000 });
  await page.type('input[type=email]', EMAIL);
  await page.type('input[autocomplete=current-password]', password);
  await page.click('button[type=submit]');
  await page.waitForFunction(() => window.location.pathname !== '/connexion', { timeout: 30_000 });
  const challenged = await page.waitForFunction(() => document.body.innerText.includes('Double authentification') && Boolean(document.querySelector('input[inputmode=numeric]')), { timeout: 15_000 }).then(() => true, () => false);
  record('Écran de double authentification affiché avant l’application', challenged);
  if (challenged) {
    const last = (await db.doc(`adminSecrets/${UID}`).get()).get('lastUsedStep') ?? null;
    const { code } = await nextCode(secret, last);
    await page.type('input[inputmode=numeric]', code);
    await page.click('button[type=submit]');
    await page.waitForFunction(() => !document.body.innerText.includes('Saisissez le code'), { timeout: 20_000 });
  }

  for (const width of [1440, 390]) {
    await page.setViewport({ width, height: width < 600 ? 844 : 900 });
    for (const target of PAGES) {
      errors.length = 0;
      await page.goto(`${base}${target.path}`, { waitUntil: 'networkidle2', timeout: 60_000 });
      await sleep(2500);
      const report = await page.evaluate(() => ({ h1: document.querySelector('main h1')?.textContent?.trim() ?? null, overflow: document.documentElement.scrollWidth - window.innerWidth, text: document.body.innerText.length }));
      const file = join(outDir, `cdcd-${target.path.replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '')}-${width}.png`);
      await page.screenshot({ path: file, fullPage: true });
      const noisy = errors.filter((e) => !/favicon|maps|Failed to load resource: the server responded with a status of 4(01|03)/i.test(e));
      record(`${target.path} @${width}`, report.h1 !== null && report.overflow <= 0 && noisy.length === 0, `titre « ${report.h1} », débordement ${report.overflow}, erreurs console ${noisy.length}${noisy[0] ? ` (${noisy[0]})` : ''}`);
    }
  }

  // Interactions sur les écrans modifiés (1440 px).
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto(`${base}/plateforme/parametres`, { waitUntil: 'networkidle2' });
  await sleep(1500);
  const clickTab = async (label) => {
    const ok = await page.evaluate((text) => {
      const tab = [...document.querySelectorAll('[role=tab]')].find((t) => t.textContent?.trim() === text);
      if (!tab) return false;
      tab.click();
      return true;
    }, label);
    await sleep(800);
    return ok;
  };
  check_1: {
    const marque = await clickTab('Marque');
    const hasColors = await page.evaluate(() => document.body.innerText.includes('Couleur principale') && document.querySelectorAll('input[type=color]').length >= 4);
    record('Paramètres — onglet Marque (logo, 4 couleurs)', marque && hasColors);
    const sec = await clickTab('Sécurité');
    const secText = await page.evaluate(() => document.body.innerText);
    record('Paramètres — sécurité : plage horaire de connexion inhabituelle réglable', sec && secText.includes('Connexion inhabituelle'));
    const hist = await clickTab('Historique');
    const histText = await page.evaluate(() => document.body.innerText);
    record('Paramètres — historique de tous les réglages (settingsHistory)', hist && histText.includes('Historique des modifications') && /settings\//.test(histText));
  }

  await page.goto(`${base}/plateforme/journal`, { waitUntil: 'networkidle2' });
  await sleep(2500);
  const journal = await page.evaluate(() => ({ rows: document.querySelectorAll('tbody tr').length, hasFilters: document.body.innerText.includes('Type de cible') && document.body.innerText.includes('Seulement les sensibles') }));
  record('Journal d’audit — filtres et entrées', journal.hasFilters && journal.rows > 0, `${journal.rows} ligne(s)`);
  await page.click('tbody tr button');
  await sleep(600);
  record('Journal d’audit — détail d’une entrée', await page.evaluate(() => Boolean(document.querySelector('[role=dialog]') && document.querySelector('[role=dialog]').innerText.includes('Auteur'))));
  await page.keyboard.press('Escape');

  await page.goto(`${base}/plateforme/fonctionnalites`, { waitUntil: 'networkidle2' });
  await sleep(2000);
  const cards = await page.evaluate(() => document.querySelectorAll('[role=switch]').length);
  record('Fonctionnalités — un interrupteur par fonctionnalité (les jamais configurées comprises)', cards >= 17, `${cards} interrupteurs`);

  await page.goto(`${base}/plateforme/connexions`, { waitUntil: 'networkidle2' });
  await sleep(2000);
  record('Connexions — carte « Logiciels de caisse »', await page.evaluate(() => document.body.innerText.includes('Logiciels de caisse') && document.body.innerText.includes('Nouvelle connexion')));

  await page.goto(`${base}/plateforme/marches`, { waitUntil: 'networkidle2' });
  await sleep(2000);
  record('Multi-pays — création d’un marché et liens TVA/paiements/commissions', await page.evaluate(() => document.body.innerText.includes('Nouveau marché') && document.body.innerText.includes('TVA, paiements, commissions')));

  await page.goto(`${base}/plateforme/administrateurs`, { waitUntil: 'networkidle2' });
  await sleep(2000);
  await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => /Inviter/.test(b.textContent ?? ''))?.click());
  await sleep(800);
  const inviteOk = await page.evaluate(() => {
    const dialog = document.querySelector('[role=dialog]');
    return Boolean(dialog && dialog.innerText.includes('Motif') && dialog.innerText.includes('Inviter'));
  });
  record('Administrateurs — invitation avec motif obligatoire', inviteOk);

  await page.goto(`${base}/plateforme/securite`, { waitUntil: 'networkidle2' });
  await sleep(1500);
  await page.evaluate(() => [...document.querySelectorAll('[role=tab]')].find((t) => t.textContent?.trim() === 'Sessions')?.click());
  await sleep(1500);
  record('Sécurité — sessions : sélecteur d’administrateur et « Déconnecter partout »', await page.evaluate(() => document.body.innerText.includes('Déconnecter partout')));
} catch (error) {
  record('Exécution du script', false, error instanceof Error ? error.message : String(error));
} finally {
  if (browser) await browser.close().catch(() => undefined);
  await cleanup();
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} vérifications réussies.`);
process.exit(failed.length ? 1 : 0);
