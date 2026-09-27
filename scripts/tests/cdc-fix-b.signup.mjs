// Contrôle visuel et fonctionnel de l'écran d'inscription d'un commerce (apps/restaurant, /inscription).
// Ne crée aucun compte : la soumission utilise une ville non ouverte (Bruxelles), qui n'enregistre
// qu'un prospect (supprimé à la fin). Usage : node scripts/tests/cdc-fix-b.signup.mjs
import { existsSync, mkdirSync } from 'node:fs';
import puppeteer from 'puppeteer-core';
import { db } from '../lib/admin.mjs';

const chrome = ['C:/Program Files/Google/Chrome/Application/chrome.exe'].find(existsSync);
mkdirSync('.smoke', { recursive: true });
const browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ['--no-sandbox'] });
let failed = 0;
const ok = (name, cond, detail = '') => {
  if (!cond) failed += 1;
  console.log(`${cond ? 'OK   ' : 'ÉCHEC'} ${name}${detail ? ` — ${detail}` : ''}`);
};
try {
  for (const width of [1440, 390]) {
    const page = await browser.newPage();
    await page.setViewport({ width, height: width < 600 ? 844 : 900 });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('http://localhost:5173/inscription', { waitUntil: 'networkidle2', timeout: 60000 });
    await page.waitForSelector('form');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    ok(`Écran d'inscription à ${width} px : aucun débordement`, overflow <= 0, `${overflow}px`);
    await page.screenshot({ path: `.smoke/restaurant-inscription-${width}.png`, fullPage: true });
    if (width === 1440) {
      // Six pays proposés.
      await page.click('button[role="combobox"]');
      const options = await page.$$eval('[role="option"]', (els) => els.map((e) => e.textContent.trim()));
      ok('Six pays proposés', options.length === 6, options.join(', '));
      await page.keyboard.press('Escape');
      // Contrôle du numéro en direct.
      const inputs = await page.$$('input');
      const byLabel = async (label) => {
        const handle = await page.evaluateHandle((l) => [...document.querySelectorAll('label')].find((x) => x.textContent.includes(l))?.querySelector('input') ?? document.getElementById([...document.querySelectorAll('label')].find((x) => x.textContent.includes(l))?.htmlFor ?? ''), label);
        return handle.asElement();
      };
      void inputs;
      const registration = await byLabel('SIRET');
      if (registration) {
        await registration.type('73282932000075');
        await new Promise((r) => setTimeout(r, 500));
        const bad = await page.evaluate(() => document.body.innerText.includes('clé de contrôle'));
        ok('SIRET à clé incorrecte signalé en direct', bad);
        await registration.click({ clickCount: 3 });
        await registration.type('73282932000074');
        ok('SIRET valide accepté', await page.evaluate(() => document.body.innerText.includes('Numéro conforme')));
      } else ok('Champ SIRET trouvé', false);
    }
    ok(`Aucune erreur de page à ${width} px`, errors.length === 0, errors.join(' | '));
    await page.close();
  }

  // Soumission vers une ville non ouverte (Belgique) : prospect enregistré, aucun compte créé.
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto('http://localhost:5173/inscription', { waitUntil: 'networkidle2', timeout: 60000 });
  await page.waitForSelector('form');
  await page.click('button[role="combobox"]');
  const options = await page.$$('[role="option"]');
  for (const o of options) if ((await o.evaluate((n) => n.textContent)).includes('Belgique')) await o.click();
  await new Promise((r) => setTimeout(r, 500));
  const fill = async (label, value) => {
    const handle = await page.evaluateHandle((l) => {
      const lab = [...document.querySelectorAll('label')].find((x) => x.textContent.includes(l));
      return lab ? (lab.querySelector('input') ?? document.getElementById(lab.htmlFor)) : null;
    }, label);
    const el = handle.asElement();
    if (!el) throw new Error(`Champ introuvable : ${label}`);
    await el.type(value);
  };
  await fill('Nom du commerce', 'Test Bruxelles cdcb');
  await fill('Téléphone du commerce', '+32 2 123 45 67');
  await fill('Adresse', '1 rue Neuve');
  await fill('Code postal', '1000');
  await fill('Ville', 'Bruxelles');
  await fill('Raison sociale', 'Test SRL');
  await fill('Numéro d’entreprise', '0403.170.701');
  await fill('Prénom', 'Test');
  await fill('Nom du gérant', 'Signup');
  await fill('E-mail', 'cdcb.waitlist@golink.test');
  await fill('Téléphone du gérant', '+32 470 12 34 56');
  await fill('Mot de passe', 'MotDePasse-Test-2026');
  await page.click('[role="checkbox"]');
  await page.click('button[type="submit"]');
  await page.waitForFunction(() => document.body.innerText.includes('pas encore dans votre ville'), { timeout: 60000 }).then(
    () => ok('Ville non ouverte : liste d’attente affichée (six pays acceptés par le serveur)', true),
    () => ok('Ville non ouverte : liste d’attente affichée', false, 'écran non atteint'),
  );
  await page.screenshot({ path: '.smoke/restaurant-inscription-attente-1440.png' });
  await page.close();
  const prospects = await db.collection('prospects').where('contactEmail', '==', 'cdcb.waitlist@golink.test').get();
  ok('Prospect enregistré côté serveur', prospects.size >= 1, `${prospects.size}`);
  for (const d of prospects.docs) await d.ref.delete();
} finally {
  await browser.close();
}
process.exit(failed ? 1 : 0);
