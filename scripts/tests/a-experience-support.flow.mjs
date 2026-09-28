// Parcours réels du support et de la modération (super admin), sur la vraie base :
//   1. agent support : ouverture d'un ticket pour une commande, réponse, note interne,
//      remboursement sous plafond, remboursement au-delà (validation), avoir, escalade ;
//   2. super admin : validation du remboursement en attente, recalcul du suivi qualité ;
//   3. comptes sans droit : pages refusées ou en consultation seule.
// Les écritures sont nettoyées ensuite par a-experience-support.cleanup.ts (ticket créé).
// Usage : node scripts/tests/a-experience-support.flow.mjs <GL-numéro> [--keep]
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const base = `http://localhost:${process.env.EXPERIENCE_PORT ?? 5405}`;
const orderNumber = process.argv[2] ?? 'GL-12777';
const outDir = join(root, '.smoke', 'a-experience-support');
mkdirSync(outDir, { recursive: true });
const accounts = readFileSync(join(root, '.test-accounts.local.md'), 'utf8');
const passwordOf = (email) => [...accounts.matchAll(/\|\s*`([^`]+)`\s*\|\s*`([^`]+)`\s*\|/g)].find((m) => m[1] === email)?.[2];
const chrome = ['C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/google-chrome'].find((c) => existsSync(c));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const log = (step, ok, detail = '') => {
  results.push({ step, ok, detail });
  console.log(`${ok ? 'OK ' : 'KO '} ${step}${detail ? ` — ${detail}` : ''}`);
};

async function session(email, width = 1440) {
  const browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message.slice(0, 300)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text().slice(0, 300)));
  await page.setViewport({ width, height: 900 });
  await page.goto(`${base}/connexion`, { waitUntil: 'networkidle0', timeout: 90_000 });
  await typeInto(page, 'input[type=email]', email);
  await typeInto(page, 'input[autocomplete=current-password]', passwordOf(email));
  await click(page, 'button[type=submit]');
  await page.waitForFunction(() => window.location.pathname !== '/connexion', { timeout: 30_000 });
  await sleep(1200);
  return { browser, page, errors };
}

async function click(page, selector, timeout = 30_000) {
  await page.waitForSelector(selector, { timeout, visible: true });
  await page.click(selector);
}

async function typeInto(page, selector, text) {
  await page.waitForSelector(selector, { timeout: 30_000, visible: true });
  await page.type(selector, text);
}

async function toast(page, text, timeout = 30_000) {
  await page.waitForSelector(`[data-sonner-toast]::-p-text(${text})`, { timeout });
}

async function selectOption(page, triggerSelector, optionText) {
  await click(page, triggerSelector);
  await page.waitForSelector(`[role=option]::-p-text(${optionText})`, { timeout: 10_000 });
  await click(page, `[role=option]::-p-text(${optionText})`);
  await sleep(300);
}

/** Clique le bouton d'une fenêtre modale dont le libellé correspond à l'expression. */
async function dialogButton(page, pattern) {
  await page.waitForFunction((src) => [...document.querySelectorAll('[role=dialog] button')].some((b) => new RegExp(src).test(b.textContent ?? '') && !b.disabled), { timeout: 10_000 }, pattern.source);
  await page.evaluate((src) => {
    const button = [...document.querySelectorAll('[role=dialog] button')].find((b) => new RegExp(src).test(b.textContent ?? '') && !b.disabled);
    button?.click();
  }, pattern.source);
}

async function shot(page, name) {
  const h = await page.evaluate(() => document.documentElement.scrollHeight);
  const vp = page.viewport();
  await page.setViewport({ width: vp.width, height: Math.min(h, 6000) });
  await sleep(800);
  await page.screenshot({ path: join(outDir, `flow-${name}.png`) });
  await page.setViewport(vp);
}

let ticketPath = null;

// ------------------------------------------------------------------ 1. Agent support
{
  const { browser, page, errors } = await session('support@golink.test');
  try {
    await page.goto(`${base}/support`, { waitUntil: 'networkidle2' });
    await click(page, 'button::-p-text(Nouveau ticket)');
    await page.waitForSelector('[role=dialog] input[placeholder="GL-10482"]');
    await typeInto(page, '[role=dialog] input[placeholder="GL-10482"]', orderNumber);
    await click(page, '[role=dialog] button::-p-text(Rechercher)');
    await page.waitForFunction(() => document.querySelector('[role=dialog]')?.textContent?.includes(' · '), { timeout: 15_000 });
    await selectOption(page, '[role=dialog] button[role=combobox]::-p-text(Choisir un motif)', 'Qualité du repas');
    await typeInto(page, '[role=dialog] input[placeholder="Commande arrivée incomplète"]', 'Test : plat renversé à la livraison');
    await typeInto(page, '[role=dialog] textarea', 'Appel du client : plat principal renversé dans le sac. Nous examinons un remboursement.');
    await dialogButton(page, /^Ouvrir le ticket$/);
    await page.waitForFunction(() => /^\/support\/[A-Za-z0-9]{10,}$/.test(window.location.pathname), { timeout: 30_000 });
    ticketPath = new URL(page.url()).pathname;
    writeFileSync(join(outDir, 'flow-ticket.txt'), ticketPath.split('/').pop());
    log('Ouverture d’un ticket pour une commande', true, ticketPath);
    await sleep(2500);

    await typeInto(page, 'textarea[aria-label=Message]', 'Bonjour, nous sommes désolés pour ce désagrément. Nous revenons vers vous rapidement.');
    await click(page, 'button::-p-text(Envoyer)');
    await toast(page, 'Réponse envoyée');
    log('Réponse au demandeur', true);

    await click(page, 'button::-p-text(Note interne)');
    await typeInto(page, 'textarea[aria-label=Message]', 'Client fidèle, troisième commande ce mois-ci.');
    await click(page, 'button::-p-text(Ajouter la note)');
    await toast(page, 'Note ajoutée');
    log('Note interne', true);

    const refund = async (amount, expected) => {
      await click(page, 'aside button::-p-text(Rembourser)');
      await page.waitForSelector('[role=dialog] input[placeholder="12,50"]');
      await typeInto(page, '[role=dialog] input[placeholder="12,50"]', amount);
      await typeInto(page, '[role=dialog] textarea', 'Plat renversé, photo reçue du client.');
      await sleep(300);
      await dialogButton(page, /^(Rembourser \d|Demander la validation)/);
      await toast(page, expected);
      await page.waitForFunction(() => !document.querySelector('[role=dialog]'), { timeout: 10_000 });
      await sleep(1500);
    };
    await refund('12,50', 'Remboursement effectué');
    log('Remboursement sous le plafond (12,50 €)', true);
    await refund('60', 'Demande transmise pour validation');
    log('Remboursement au-delà du plafond (60 €) → validation', true);

    await click(page, 'aside button::-p-text(Avoir)');
    await page.waitForSelector('[role=dialog] textarea');
    await typeInto(page, '[role=dialog] textarea', 'Geste pour le désagrément.');
    await dialogButton(page, /^Créditer/);
    await toast(page, 'Avoir ajouté');
    log('Avoir de 5 € sur le compte du client', true);
    await sleep(1500);

    await click(page, 'button::-p-text(Escalader)');
    await page.waitForSelector('[role=dialog] textarea');
    await typeInto(page, '[role=dialog] textarea', 'Validation du remboursement de 60 € nécessaire.');
    await dialogButton(page, /^Escalader$/);
    await toast(page, 'Ticket escaladé');
    log('Escalade aux responsables', true);
    await sleep(2500);
    await shot(page, 'support-ticket-1440');
    await page.setViewport({ width: 390, height: 844 });
    await sleep(1500);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    log('Ticket à 390 px sans défilement horizontal', overflow <= 0, `débordement ${overflow}px`);
    await shot(page, 'support-ticket-390');
    if (errors.length) log('Console agent support', false, errors.join(' | '));
  } catch (e) {
    log('Parcours agent support', false, e.message);
    await page.screenshot({ path: join(outDir, 'flow-error-support.png'), fullPage: true });
  } finally {
    await browser.close();
  }
}

// ------------------------------------------------------------------ 2. Super admin
{
  const { browser, page, errors } = await session('superadmin@golink.test');
  try {
    if (ticketPath) {
      await page.goto(`${base}${ticketPath}`, { waitUntil: 'networkidle2' });
      await page.waitForSelector('button::-p-text(Valider)', { timeout: 20_000 });
      await click(page, 'button::-p-text(Valider)');
      await page.waitForSelector('[role=dialog] textarea');
      await typeInto(page, '[role=dialog] textarea', 'Photo probante, remboursement validé.');
      await dialogButton(page, /^Valider et rembourser$/);
      await toast(page, 'Remboursement validé');
      log('Validation du remboursement par un responsable', true);
      await sleep(2500);
      await shot(page, 'superadmin-ticket-1440');
    }
    await page.goto(`${base}/avis/qualite`, { waitUntil: 'networkidle2' });
    await click(page, 'button::-p-text(Recalculer)');
    await toast(page, 'Suivi recalculé', 90_000);
    log('Recalcul du suivi qualité', true);
    await sleep(2500);
    await shot(page, 'superadmin-qualite-1440');
    if (errors.length) log('Console super admin', false, errors.join(' | '));
  } catch (e) {
    log('Parcours super admin', false, e.message);
    await page.screenshot({ path: join(outDir, 'flow-error-superadmin.png'), fullPage: true });
  } finally {
    await browser.close();
  }
}

// ------------------------------------------------------------------ 3. Comptes sans droit
for (const [email, path, expectation] of [
  ['commercial@golink.test', '/support', 'refus'],
  ['commercial@golink.test', '/avis', 'refus'],
  ['support@golink.test', '/affichage', 'refus'],
  ['metz@golink.test', '/support', 'consultation'],
]) {
  const { browser, page } = await session(email);
  try {
    await page.goto(`${base}${path}`, { waitUntil: 'networkidle2' });
    await sleep(3000);
    const text = await page.evaluate(() => document.querySelector('main')?.textContent ?? '');
    const denied = /accès|autorisé|droit|permission/i.test(text) && !/Nouveau ticket/.test(text);
    const ok = expectation === 'refus' ? denied : !text.includes('Nouveau ticket') && text.includes('Support et litiges');
    log(`${email} sur ${path} (${expectation})`, ok, text.slice(0, 120).replace(/\s+/g, ' '));
    await shot(page, `${email.split('@')[0]}-${path.replace(/\W+/g, '_')}`);
  } finally {
    await browser.close();
  }
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} étapes réussies.`);
process.exitCode = failed ? 1 : 0;
