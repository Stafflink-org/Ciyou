// Parcours réels des rubriques marketing et messagerie du back-office restaurant,
// sur la vraie base (Cloud Functions déployées) : chaque étape clique dans
// l'interface, attend la confirmation et enregistre une capture.
//
// Usage : node scripts/tests/r-marketing-messagerie.flow.mjs [e-mail] [largeur] [parcours…]
//   parcours : promo, campagne, avis, message, support, modele, fidelite, social (défaut : tous)
//   PORT=5305 (défaut). Les données créées portent « TEST » dans leur titre : voir _rmm-cleanup.ts.
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const [email = 'sofia.martin@golink.test', width = '1440', ...only] = process.argv.slice(2);
const port = process.env.PORT ?? '5305';
const base = `http://localhost:${port}`;
const accounts = readFileSync(join(root, '.test-accounts.local.md'), 'utf8');
const password = [...accounts.matchAll(/\|\s*`([^`]+)`\s*\|\s*`([^`]+)`\s*\|/g)].find((m) => m[1] === email)?.[2];
if (!password) throw new Error(`Compte inconnu : ${email}`);
const chrome = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
if (!existsSync(chrome)) throw new Error('Chrome introuvable');
const outDir = join(root, '.smoke');
mkdirSync(outDir, { recursive: true });

const stamp = new Date().toISOString().slice(11, 16).replace(':', 'h');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];

const browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();
let errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text().slice(0, 300)));
page.on('pageerror', (e) => errors.push(e.message.slice(0, 300)));
await page.setViewport({ width: Number(width), height: Number(width) < 600 ? 844 : 900 });

async function shot(name) {
  await sleep(600);
  await page.screenshot({ path: join(outDir, `rmm-flow-${name}-${width}.png`), fullPage: false });
}

/** Clique le premier bouton (ou lien) visible dont le texte contient `text`. */
async function click(text, { within = 'body', exact = false, last = false } = {}) {
  const ok = await page.evaluate(
    (text, within, exact, last) => {
      const scope = [...document.querySelectorAll(within)].at(-1) ?? document.body;
      const nodes = [...scope.querySelectorAll('button, a, [role=tab], [role=radio], [role=menuitem], [role=option], label, tbody tr')];
      const pick = last ? nodes.findLast.bind(nodes) : nodes.find.bind(nodes);
      const match = pick((n) => {
        const t = (n.textContent ?? '').replace(/\s+/g, ' ').trim();
        const visible = n.getBoundingClientRect().width > 0 && !n.hasAttribute('disabled');
        return visible && (exact ? t === text : t.includes(text));
      });
      if (!match) return false;
      match.scrollIntoView({ block: 'center' });
      match.click();
      return true;
    },
    text,
    within,
    exact,
    last,
  );
  if (!ok) throw new Error(`Élément introuvable : « ${text} »`);
  await sleep(500);
}

/** Saisit dans le champ dont le placeholder ou l'aria-label contient `hint`. */
async function fill(hint, value) {
  const handle = await page.evaluateHandle((hint) => {
    const fields = [...document.querySelectorAll('input, textarea')].filter((f) => f.getBoundingClientRect().width > 0);
    return fields.findLast((f) => (f.placeholder ?? '').includes(hint) || (f.getAttribute('aria-label') ?? '').includes(hint)) ?? null;
  }, hint);
  const el = handle.asElement();
  if (!el) throw new Error(`Champ introuvable : « ${hint} »`);
  await el.click({ clickCount: 3 });
  await page.keyboard.press('Backspace');
  await el.type(value, { delay: 5 });
}

/** Attend un toast contenant `text` (ou un message d'erreur). */
async function toast(text, timeout = 30_000) {
  const found = await page
    .waitForFunction(
      (text) => {
        const t = [...document.querySelectorAll('[data-sonner-toast]')].map((n) => n.textContent ?? '').join(' | ');
        if (!t) return false;
        if (/erreur|impossible|refus/i.test(t)) return `ERREUR: ${t}`;
        return t.includes(text) ? t : false;
      },
      { timeout },
      text,
    )
    .then((h) => h.jsonValue())
    .catch(() => 'aucun toast');
  if (found === 'aucun toast' || String(found).startsWith('ERREUR') || !String(found).includes(text)) throw new Error(`Toast attendu « ${text} » : ${found}`);
  return found;
}

async function go(path) {
  await page.goto(`${base}${path}`, { waitUntil: 'networkidle2', timeout: 60_000 });
  await sleep(2000);
}

async function step(name, fn) {
  if (only.length && !only.includes(name)) return;
  errors = [];
  try {
    const detail = await fn();
    results.push({ step: name, ok: true, detail: detail ?? null, errors });
  } catch (error) {
    await page.screenshot({ path: join(outDir, `rmm-flow-${name}-echec-${width}.png`) }).catch(() => {});
    results.push({ step: name, ok: false, error: String(error.message ?? error).slice(0, 400), errors });
  }
}

try {
  await page.goto(`${base}/connexion`, { waitUntil: 'networkidle0', timeout: 90_000 });
  await page.type('input[type=email]', email);
  await page.type('input[autocomplete=current-password]', password);
  await page.click('button[type=submit]');
  await page.waitForFunction(() => window.location.pathname !== '/connexion', { timeout: 30_000 });

  await step('promo', async () => {
    await go('/promotions');
    await click('Nouvelle offre');
    await sleep(800);
    await fill('EX. BIENVENUE10', `TEST${stamp.replace('h', '')}`);
    await fill('Le déjeuner à prix doux', `TEST parcours ${stamp}`);
    await shot('promo-1-formulaire');
    await click('Mettre en ligne', { within: '[role=dialog]' }).catch(() => click('Soumettre à GoLink', { within: '[role=dialog]' }));
    const t = await toast('');
    await sleep(1500);
    await shot('promo-2-liste');
    // Fiche de l'offre : pause, relance puis fin (Cloud Function updatePromotion).
    await click(`TEST parcours ${stamp}`);
    await page.waitForFunction(() => /\/promotions\/.+/.test(location.pathname), { timeout: 15_000 });
    await sleep(2000);
    await shot('promo-3-fiche');
    await click('Mettre en pause', { exact: true });
    const paused = await toast('Offre mise en pause');
    await sleep(1500);
    await click('Relancer', { exact: true });
    const resumed = await toast('Offre relancée');
    await sleep(1500);
    const more = await page.$('button[aria-label="Plus d’actions"]');
    await more.click();
    await sleep(500);
    await click('Terminer l’offre');
    await click('Terminer', { within: '[role=alertdialog], [role=dialog]', exact: true, last: true });
    const ended = await toast('Offre terminée');
    await sleep(1500);
    await shot('promo-4-terminee');
    return [t, paused, resumed, ended].join(' → ');
  });

  await step('campagne', async () => {
    await go('/campagnes');
    await click('Nouvelle campagne');
    await sleep(800);
    await fill('Relance du vendredi soir', `TEST campagne ${stamp}`);
    await fill('Ce soir, on cuisine pour vous', 'Nouveau à la carte');
    await fill('Vos plats préférés vous attendent', 'Découvrez notre nouveau mezzé, disponible dès ce soir.');
    await shot('campagne-1-composer');
    // Programmée (demain par défaut) puis annulée : aucun envoi réel.
    await click('Programmer', { within: '[role=dialog]', exact: true, last: true });
    await shot('campagne-2-confirmation');
    await click('Programmer', { within: '[role=alertdialog], [role=dialog]', exact: true, last: true });
    const scheduled = await toast('');
    await sleep(1500);
    await click(`TEST campagne ${stamp}`);
    await sleep(1000);
    await shot('campagne-3-detail');
    await click('Annuler l’envoi', { within: '[role=dialog]' });
    await click('Confirmer', { within: '[role=alertdialog], [role=dialog]' });
    const cancelled = await toast('Campagne annulée');
    await shot('campagne-4-annulee');
    return `${scheduled} → ${cancelled}`;
  });

  await step('avis', async () => {
    await go('/avis');
    await click('Sans réponse');
    await click('Répondre');
    await fill('Votre réponse publique', 'Merci pour votre retour, au plaisir de vous régaler à nouveau ! (TEST)');
    await shot('avis-1-reponse');
    await click('Publier', { exact: true });
    const t = await toast('Réponse publiée');
    await shot('avis-2-publiee');
    return t;
  });

  await step('message', async () => {
    await go('/messages/conv-o-12858');
    await fill('Écrivez votre message', `TEST message ${stamp} : votre commande part dans 5 minutes.`);
    await page.keyboard.press('Enter');
    await page.waitForFunction((s) => document.body.innerText.includes(`TEST message ${s}`), { timeout: 20_000 }, stamp);
    await sleep(2500);
    await shot('message-1-envoye');
    return 'message affiché dans le fil';
  });

  await step('support', async () => {
    await go('/support');
    await click('Nouvelle demande');
    await sleep(800);
    await click('Choisir un motif');
    await sleep(400);
    // « Problème de paiement » : motif sans commande obligatoire.
    await page.waitForSelector('[role=option]', { timeout: 10_000 });
    await click('Problème de paiement', { within: 'body', exact: true, last: true });
    await sleep(400);
    await fill('Écart sur le reversement', `TEST demande ${stamp}`);
    await fill('Décrivez la situation', 'Demande créée par le parcours de contrôle du back-office, à clôturer.');
    await shot('support-1-formulaire');
    await click('Envoyer la demande', { within: '[role=dialog]' });
    await toast('envoyée au support', 45_000);
    await page.waitForFunction(() => /\/support\/.+/.test(location.pathname), { timeout: 30_000 });
    await sleep(2500);
    await fill('Votre réponse au support', 'Complément : merci de clôturer cette demande de test.');
    await click('Envoyer', { exact: true });
    await toast('Message envoyé au support');
    await shot('support-2-fil');
    return page.url();
  });

  await step('modele', async () => {
    await go('/modeles');
    await click('Nouvelle réponse');
    await sleep(800);
    await fill('Merci pour un avis 5 étoiles', `TEST modèle ${stamp}`);
    await fill('Bonjour {{prenom}}, merci pour votre retour', 'Bonjour {{prenom}}, merci !');
    await shot('modele-1-formulaire');
    await click('Enregistrer', { within: '[role=dialog]' });
    const t = await toast('');
    await shot('modele-2-liste');
    await click('Messages automatiques');
    await sleep(1200);
    await shot('modele-3-automatiques');
    return t;
  });

  await step('fidelite', async () => {
    await go('/fidelite');
    await fill('Ex. Le dessert offert', 'Le café offert');
    await sleep(500);
    await shot('fidelite-1-modifie');
    await click('Annuler');
    return 'modification annulée';
  });

  await step('social', async () => {
    await go('/reseaux-sociaux');
    await click('Plat');
    await sleep(2500);
    await shot('social-1-visuel-plat');
    await click('Offre');
    await sleep(2500);
    await shot('social-2-visuel-offre');
    return 'visuels générés';
  });
} finally {
  await browser.close();
}
console.log(JSON.stringify(results, null, 2));
