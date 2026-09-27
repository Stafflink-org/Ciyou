// Parcours réels du pilotage dans le navigateur (super admin, port 5401) :
// palette ⌘K reliée à la recherche universelle, export CSV téléchargé depuis
// l'écran Rapports, aperçu d'un rapport programmé (sans envoi), fiche d'une alerte.
//
// Usage : node scripts/tests/a-pilotage.flow.mjs [largeur]
import { mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import { db } from '../lib/admin.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const width = Number(process.argv[2] ?? 1440);
const base = `http://localhost:${process.env.PILOTAGE_PORT ?? 5401}`;
const email = 'superadmin@golink.test';
const accounts = readFileSync(join(root, '.test-accounts.local.md'), 'utf8');
const password = [...accounts.matchAll(/\|\s*`([^`]+)`\s*\|\s*`([^`]+)`\s*\|/g)].find((m) => m[1] === email)?.[2];
const shots = join(root, '.smoke', 'a-pilotage');
const downloads = join(shots, 'telechargements');
rmSync(downloads, { recursive: true, force: true });
mkdirSync(downloads, { recursive: true });

const results = [];
const record = (name, ok, detail) => {
  results.push(ok);
  console.log(`${ok ? 'OK   ' : 'ÉCHEC'}  ${name}${detail ? ` — ${detail}` : ''}`);
};
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const errors = [];

const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--no-sandbox'] });
try {
  const page = await browser.newPage();
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text().slice(0, 300)));
  page.on('pageerror', (e) => errors.push(e.message.slice(0, 300)));
  await page.setViewport({ width, height: width < 600 ? 844 : 900 });
  const cdp = await page.createCDPSession();
  await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloads });

  await page.goto(`${base}/connexion`, { waitUntil: 'networkidle0', timeout: 90_000 });
  await page.type('input[type=email]', email);
  await page.type('input[autocomplete=current-password]', password);
  await page.click('button[type=submit]');
  await page.waitForFunction(() => location.pathname !== '/connexion', { timeout: 30_000 });
  await pause(2500);

  // 1. Palette ⌘K : numéro de commande → fiche
  const order = (await db.collection('orders').orderBy('createdAt', 'desc').limit(1).get()).docs[0];
  const number = order.get('number');
  await page.keyboard.down('Control');
  await page.keyboard.press('KeyK');
  await page.keyboard.up('Control');
  await page.waitForSelector('[cmdk-input]', { timeout: 5000 });
  await page.type('[cmdk-input]', number);
  try {
    await page.waitForFunction((n) => [...document.querySelectorAll('[cmdk-item]')].some((el) => el.textContent.includes(n)), { timeout: 20_000 }, number);
    await page.screenshot({ path: join(shots, `flow-palette-${width}.png`) });
    record('Palette : commande trouvée', true, number);
    await page.keyboard.press('Enter');
    await page.waitForFunction((id) => location.pathname.includes(id) || location.pathname.startsWith('/commandes/'), { timeout: 10_000 }, order.id);
    record('Palette : ouverture de la fiche', true, await page.evaluate(() => location.pathname));
  } catch (error) {
    record('Palette : recherche universelle', false, error.message);
  }

  // 2. Export CSV des commandes depuis Rapports
  await page.goto(`${base}/rapports`, { waitUntil: 'networkidle2' });
  await pause(2500);
  const cards = await page.$$('main button');
  let clicked = false;
  for (const card of cards) {
    const text = await card.evaluate((el) => el.textContent ?? '');
    if (text.startsWith('Commandes')) {
      await card.click();
      clicked = true;
      break;
    }
  }
  if (!clicked) record('Export : carte Commandes', false, 'introuvable');
  await page.waitForSelector('[role=dialog]', { timeout: 5000 });
  await page.evaluate(() => {
    const label = [...document.querySelectorAll('[role=dialog] label')].find((l) => l.textContent?.startsWith('CSV'));
    label?.click();
  });
  await page.type('[role=dialog] textarea', 'Contrôle automatisé du parcours export');
  await page.screenshot({ path: join(shots, `flow-export-dialog-${width}.png`) });
  await page.evaluate(() => [...document.querySelectorAll('[role=dialog] button')].find((b) => b.textContent?.includes('Générer'))?.click());
  let file = null;
  for (let i = 0; i < 60 && !file; i += 1) {
    await pause(1000);
    file = readdirSync(downloads).find((f) => f.endsWith('.csv'));
  }
  if (file) {
    const content = readFileSync(join(downloads, file), 'utf8');
    record('Export : fichier CSV téléchargé', content.split('\n').length > 1, `${file}, ${content.split('\n').length - 1} lignes`);
  } else record('Export : fichier CSV téléchargé', false, 'aucun fichier');
  await pause(1500);
  const job = (await db.collection('bulkJobs').where('type', '==', 'export').where('reason', '==', 'Contrôle automatisé du parcours export').get()).docs;
  for (const doc of job) await doc.ref.delete();

  // 3. Aperçu d'un rapport programmé (dryRun, aucun envoi)
  await page.goto(`${base}/rapports/programmes`, { waitUntil: 'networkidle2' });
  await pause(2500);
  const menu = await page.$('main button[aria-label^="Actions sur"]');
  if (menu) {
    await menu.click();
    await pause(400);
    await page.evaluate(() => [...document.querySelectorAll('[role=menuitem]')].find((i) => i.textContent?.includes('Aperçu'))?.click());
    try {
      await page.waitForSelector('[role=dialog] iframe', { timeout: 60_000 });
      await pause(800);
      await page.screenshot({ path: join(shots, `flow-report-preview-${width}.png`) });
      record('Rapport : aperçu affiché', true, await page.evaluate(() => document.querySelector('[role=dialog] h2')?.textContent ?? ''));
    } catch (error) {
      record('Rapport : aperçu affiché', false, error.message);
    }
    await page.keyboard.press('Escape');
  } else record('Rapport : menu d’actions', false, 'introuvable');

  // 4. Fiche d'une alerte
  await page.goto(`${base}/alertes`, { waitUntil: 'networkidle2' });
  await pause(3000);
  const first = await page.$('main ul li button');
  if (first) {
    await first.click();
    await page.waitForSelector('[role=dialog]', { timeout: 5000 });
    await pause(600);
    await page.screenshot({ path: join(shots, `flow-alert-sheet-${width}.png`) });
    record('Alerte : fiche ouverte', true, await page.evaluate(() => document.querySelector('[role=dialog] h2')?.textContent ?? ''));
  } else record('Alerte : fiche ouverte', false, 'aucune alerte');

  // 5. Création puis suppression d'un rapport depuis l'interface
  await page.goto(`${base}/rapports/programmes`, { waitUntil: 'networkidle2' });
  await pause(2000);
  await page.evaluate(() => [...document.querySelectorAll('main button')].find((b) => b.textContent?.includes('Programmer un rapport'))?.click());
  await page.waitForSelector('[role=dialog] input', { timeout: 5000 });
  await page.type('[role=dialog] input', 'Parcours automatisé Pilotage');
  await page.screenshot({ path: join(shots, `flow-report-form-${width}.png`) });
  await page.evaluate(() => [...document.querySelectorAll('[role=dialog] button')].find((b) => b.textContent?.trim() === 'Programmer')?.click());
  let created = null;
  for (let i = 0; i < 30 && !created; i += 1) {
    await pause(1000);
    created = (await db.collection('scheduledReports').where('name', '==', 'Parcours automatisé Pilotage').get()).docs[0] ?? null;
  }
  record('Rapport : création depuis le formulaire', Boolean(created), created ? `${created.get('recipients').join(', ')} · ${created.get('frequency')}` : 'non créé');
  if (created) await created.ref.delete();
} finally {
  await browser.close();
}
const relevant = errors.filter((e) => !e.includes('favicon'));
record('Console sans erreur', relevant.length === 0, relevant.slice(0, 3).join(' | '));
console.log(`\n${results.filter(Boolean).length}/${results.length} étapes réussies.`);
process.exit(results.every(Boolean) ? 0 : 1);
