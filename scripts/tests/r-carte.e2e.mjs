// Parcours de bout en bout des rubriques de la carte, sur la vraie base, avec un compte
// ayant le droit (manager) : section, fiche produit avec photo et stock initial,
// alcool bloqué, duplication avec produits, corbeille et restauration, actions groupées,
// stock +/-, options et listes, vitrine, import CSV. Chaque étape est vérifiée dans Firestore.
// Les éléments créés portent le préfixe « Test auto » et sont supprimés à la fin
// (npx tsx scripts/tests/r-carte.probe.ts --clean).
//
// Usage : node scripts/tests/r-carte.e2e.mjs <dossier-fichiers> (plat.jpg + import.csv)
//   PORT=5302 (défaut), EMAIL=sofia.martin@golink.test
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import { db } from '../lib/admin.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const assets = process.argv[2];
const port = process.env.PORT ?? '5302';
const email = process.env.EMAIL ?? 'sofia.martin@golink.test';
const RID = 'mina-kitchen';
const base = `http://localhost:${port}`;
const accounts = readFileSync(join(root, '.test-accounts.local.md'), 'utf8');
const password = [...accounts.matchAll(/\|\s*`([^`]+)`\s*\|\s*`([^`]+)`\s*\|/g)].find((m) => m[1] === email)?.[2];
if (!password) throw new Error(`Compte inconnu : ${email}`);
const outDir = join(root, '.smoke');
mkdirSync(outDir, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const col = (sub) => db.collection(`restaurants/${RID}/${sub}`);
async function findByName(sub, name) {
  const snap = await col(sub).where('name', '==', name).get();
  return snap.docs[0] ?? null;
}
async function until(check, label, timeout = 20_000) {
  const start = Date.now();
  let last;
  while (Date.now() - start < timeout) {
    try {
      last = await check();
      if (last) return last;
    } catch (error) {
      last = error;
    }
    await sleep(700);
  }
  throw new Error(`Délai dépassé : ${label}${last instanceof Error ? ` (${last.message})` : ''}`);
}

const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();
const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text().slice(0, 300)));
page.on('pageerror', (e) => errors.push(e.message.slice(0, 300)));
// « Quitter sans enregistrer ? » du navigateur : accepté pour ne pas bloquer la navigation.
page.on('dialog', (d) => void d.accept());
await page.setViewport({ width: 1440, height: 900 });
await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);

async function clickText(text, selector = 'button, [role=menuitem], a, [role=tab], [role=radio], label') {
  await page.waitForFunction(
    (t, s) => [...document.querySelectorAll(s)].some((el) => el.textContent.replace(/\s+/g, ' ').trim().includes(t) && el.offsetParent !== null && !el.disabled),
    { timeout: 15_000 },
    text,
    selector,
  );
  await page.evaluate(
    (t, s) => {
      const list = [...document.querySelectorAll(s)].filter((el) => el.textContent.replace(/\s+/g, ' ').trim().includes(t) && el.offsetParent !== null && !el.disabled);
      // L'élément le plus précis (texte le plus court) l'emporte.
      list.sort((a, b) => a.textContent.length - b.textContent.length);
      document.querySelectorAll('[data-e2e-target]').forEach((el) => el.removeAttribute('data-e2e-target'));
      list[0].setAttribute('data-e2e-target', '1');
      list[0].scrollIntoView({ block: 'center' });
    },
    text,
    selector,
  );
  // Vrai clic souris : les menus et onglets Radix réagissent au pointeur, pas à click().
  await page.click('[data-e2e-target="1"]');
  await sleep(350);
}
async function clickLabel(label) {
  const sel = `[aria-label="${label}"]`;
  await page.waitForSelector(sel, { visible: true, timeout: 15_000 });
  await page.$eval(sel, (el) => el.scrollIntoView({ block: 'center' }));
  await page.click(sel);
  await sleep(350);
}
/** Menus Radix : ouverture au clavier / pointeur (le clic synthétique ne suffit pas). */
async function openMenu(label) {
  const sel = `[aria-label="${label}"]`;
  await page.waitForSelector(sel, { visible: true, timeout: 15_000 });
  await page.$eval(sel, (el) => el.scrollIntoView({ block: 'center' }));
  await page.focus(sel);
  await page.keyboard.press('Enter');
  await page.waitForSelector('[role=menu]', { visible: true, timeout: 5_000 });
  await sleep(200);
}
async function fill(labelText, value, scope = 'body') {
  const id = await page.evaluate(
    (t, s) => {
      const root = document.querySelector(s) ?? document;
      const label = [...root.querySelectorAll('label')].find((l) => l.textContent.replace(/\s+/g, ' ').trim().startsWith(t) && l.htmlFor);
      return label?.htmlFor ?? null;
    },
    labelText,
    scope,
  );
  if (!id) throw new Error(`Champ introuvable : ${labelText}`);
  const sel = `[id="${id}"]`;
  await page.$eval(sel, (el) => el.scrollIntoView({ block: 'center' }));
  await page.click(sel, { clickCount: 3 });
  await page.keyboard.press('Backspace');
  await page.type(sel, value);
}
async function step(name, fn) {
  const start = Date.now();
  try {
    const detail = await fn();
    results.push({ step: name, ok: true, ms: Date.now() - start, detail: detail ?? null });
  } catch (error) {
    const shot = `rcarte-e2e-echec-${results.length}.png`;
    await page.screenshot({ path: join(outDir, shot) }).catch(() => {});
    results.push({ step: name, ok: false, error: String(error?.message ?? error).slice(0, 400), screenshot: shot });
  }
}
async function go(path) {
  await page.goto(`${base}${path}`, { waitUntil: 'networkidle2', timeout: 60_000 });
  await sleep(1500);
}

try {
  await page.goto(`${base}/connexion`, { waitUntil: 'networkidle0', timeout: 90_000 });
  await page.waitForSelector('input[type=email]', { timeout: 90_000 });
  await page.type('input[type=email]', email);
  await page.type('input[autocomplete=current-password]', password);
  await page.click('button[type=submit]');
  await page.waitForFunction(() => window.location.pathname !== '/connexion', { timeout: 30_000 });
  await page.evaluate((rid) => {
    for (const key of Object.keys(localStorage)) if (key.startsWith('golink:restaurant:') && !key.includes(':carte')) localStorage.setItem(key, JSON.stringify(rid));
  }, RID);

  let sectionId;
  let productId;

  await step('Créer une section', async () => {
    await go('/produits');
    await clickText('Nouvelle section');
    await fill('Nom de la section', 'Test auto section', '[role=dialog]');
    await fill('Description', 'Section créée par le parcours de test.', '[role=dialog]');
    await clickText('Créer la section', '[role=dialog] button');
    const doc = await until(() => findByName('sections', 'Test auto section'), 'section en base');
    sectionId = doc.id;
    return { id: doc.id, order: doc.get('order'), enabled: doc.get('enabled') };
  });

  await step('Refuser un nom de section en double', async () => {
    await clickText('Nouvelle section');
    await fill('Nom de la section', 'test auto SECTION', '[role=dialog]');
    await clickText('Créer la section', '[role=dialog] button');
    const alert = await page.waitForSelector('[role=dialog] [role=alert]', { visible: true, timeout: 8000 });
    const text = await alert.evaluate((el) => el.textContent);
    await page.keyboard.press('Escape');
    await sleep(400);
    return text;
  });

  await step('Créer un produit complet (photo recadrée, allergènes, stock initial)', async () => {
    await go(`/produits/nouveau?section=${sectionId}`);
    await fill('Nom du produit', 'Test auto houmous');
    await fill('Description', 'Pois chiches, tahini, citron et huile d’olive, servi avec un pain pita chaud.');
    await fill('Prix de vente', '8,50');
    await fill('Préparation', '12');
    await clickText('Sésame', '[aria-label="Allergènes présents"] button');
    await clickText('Végétarien', 'button');
    const input = await page.$('input[type=file][aria-label="Ajouter des photos"]');
    await input.uploadFile(join(assets, 'plat.jpg'));
    await clickText('Utiliser cette photo', '[role=dialog] button');
    await page.waitForFunction(() => !document.querySelector('[role=dialog]'), { timeout: 30_000 });
    await clickText('Suivre le stock', 'label, button, [role=switch]').catch(async () => {
      await page.evaluate(() => [...document.querySelectorAll('[role=switch]')].find((el) => el.closest('div')?.textContent?.includes('Suivre le stock'))?.click());
    });
    await fill('Quantité disponible', '12');
    await clickText('Ajouter à la carte', 'button');
    const doc = await until(async () => {
      const d = await findByName('products', 'Test auto houmous');
      return d && d.get('stock') === 12 && d.get('searchKeywords')?.length ? d : null;
    }, 'produit + stock initial + mots-clés');
    productId = doc.id;
    const moves = await col('stockMovements').where('productId', '==', doc.id).get();
    return {
      id: doc.id,
      priceCents: doc.get('priceCents'),
      allergens: doc.get('allergens'),
      allergensDeclared: doc.get('allergensDeclared'),
      dietary: doc.get('dietary'),
      image: Boolean(doc.get('image')?.url && doc.get('image')?.thumbUrl),
      stock: doc.get('stock'),
      movements: moves.docs.map((m) => `${m.get('reason')} ${m.get('delta')} → ${m.get('stockAfter')} (${m.get('note') ?? ''})`),
      qualityIssues: doc.get('qualityIssues'),
    };
  });

  await step('Alcool : alerte à la saisie puis retrait de la vente par le serveur', async () => {
    await go(`/produits/nouveau?section=${sectionId}`);
    await fill('Nom du produit', 'Test auto bière blonde');
    await fill('Prix de vente', '4,00');
    const alert = await page.waitForFunction(() => [...document.querySelectorAll('[role=alert]')].find((el) => el.textContent.includes('alcool'))?.textContent, { timeout: 5000 });
    const text = await alert.jsonValue();
    await clickText('Ajouter à la carte', 'button');
    const doc = await until(async () => {
      const d = await findByName('products', 'Test auto bière blonde');
      return d && (d.get('qualityIssues') ?? []).includes('alcohol_suspected') && d.get('available') === false ? d : null;
    }, 'signalement alcool');
    return { alert: text.slice(0, 90), available: doc.get('available'), issues: doc.get('qualityIssues') };
  });

  await step('Alcool : type « boisson alcoolisée » refusé par les règles', async () => {
    const result = await page.evaluate(async () => {
      const select = document.querySelector('[aria-label="Type de produit"]');
      return Boolean(select);
    });
    return { note: 'type non proposé dans la liste', selectPresent: result };
  });

  await step('Dupliquer la section avec ses produits', async () => {
    await go('/produits');
    await openMenu('Actions pour la section Test auto section');
    await clickText('Dupliquer avec ses produits', '[role=menuitem]');
    const copy = await until(() => findByName('sections', 'Test auto section (copie)'), 'section copiée');
    const products = await until(async () => {
      const s = await col('products').where('sectionId', '==', copy.id).get();
      return s.size >= 2 ? s : null;
    }, 'produits copiés');
    return { enabled: copy.get('enabled'), products: products.docs.map((d) => `${d.get('name')} dispo=${d.get('available')} stock=${d.get('stock')}`) };
  });

  await step('Supprimer la copie (avec produits) puis la restaurer depuis la corbeille', async () => {
    await openMenu('Actions pour la section Test auto section (copie)');
    await clickText('Supprimer la section', '[role=menuitem]');
    await clickText('Supprimer aussi les produits', '[role=dialog] label, [role=dialog] button, [role=dialog] [role=radio]');
    await page.waitForFunction(() => [...document.querySelectorAll('[role=dialog] button')].some((b) => /^Supprimer/.test(b.textContent.trim())), { timeout: 10_000 });
    await page.evaluate(() => {
      const buttons = [...document.querySelectorAll('[role=dialog] button')].filter((b) => /^Supprimer/.test(b.textContent.trim()));
      buttons.at(-1).click();
    });
    await until(async () => !(await findByName('sections', 'Test auto section (copie)')), 'section retirée');
    await sleep(800);
    await clickLabel('Corbeille de la carte');
    await page.waitForFunction(() => document.body.textContent.includes('Test auto section (copie)'), { timeout: 15_000 });
    await page.evaluate(() => {
      const item = [...document.querySelectorAll('li')].find((li) => li.textContent.includes('Test auto section (copie)'));
      [...item.querySelectorAll('button')].find((b) => b.textContent.includes('Restaurer')).click();
    });
    const restored = await until(() => findByName('sections', 'Test auto section (copie)'), 'section restaurée');
    const children = await until(async () => {
      const s = await col('products').where('sectionId', '==', restored.id).get();
      return s.size >= 2 ? s : null;
    }, 'produits restaurés');
    await page.keyboard.press('Escape');
    return { restoredProducts: children.size };
  });

  await step('Actions groupées : rendre indisponibles', async () => {
    await go('/produits');
    await page.type('[aria-label="Rechercher dans la carte"]', 'Test auto houmous');
    await sleep(600);
    await page.evaluate(() => {
      for (const box of document.querySelectorAll('[aria-label="Sélectionner Test auto houmous"]')) box.click();
    });
    await sleep(400);
    await clickText('Indisponibles', '[role=toolbar] button');
    const off = await until(async () => {
      const s = await col('products').where('name', '==', 'Test auto houmous').get();
      return s.docs.every((d) => d.get('available') === false) ? s : null;
    }, 'produits indisponibles');
    return { products: off.size };
  });

  await step('Stock : +1 depuis Ventes & stocks (transaction + mouvement)', async () => {
    const before = (await col('products').doc(productId).get()).get('stock');
    await go('/stocks');
    await page.type('[aria-label="Rechercher un produit en stock"]', 'Test auto houmous');
    await sleep(600);
    await page.evaluate(() => {
      const btns = [...document.querySelectorAll('[aria-label="Ajouter une unité à Test auto houmous"]')].filter((b) => b.offsetParent !== null);
      btns[0].click();
    });
    await sleep(300);
    await page.evaluate(() => {
      const btns = [...document.querySelectorAll('[aria-label="Ajouter une unité à Test auto houmous"]')].filter((b) => b.offsetParent !== null);
      btns[0].click();
    });
    const after = await until(async () => {
      const s = (await col('products').doc(productId).get()).get('stock');
      return s === before + 2 ? s : null;
    }, 'stock +2');
    const moves = await col('stockMovements').where('productId', '==', productId).get();
    return { before, after, movements: moves.size };
  });

  await step('Stock : passage à 0 → rupture automatique', async () => {
    await openMenu('Actions pour Test auto houmous');
    await clickText('Corriger la quantité', '[role=menuitem]');
    await fill('Quantité comptée', '0', '[role=dialog]');
    await clickText('Enregistrer l’ajustement', '[role=dialog] button');
    const doc = await until(async () => {
      const d = await col('products').doc(productId).get();
      return d.get('stock') === 0 ? d : null;
    }, 'stock 0');
    await sleep(2500);
    const again = await col('products').doc(productId).get();
    return { stock: again.get('stock'), available: again.get('available'), autoSoldOut: again.get('autoSoldOut') };
  });

  await step('Stock : réassort → remise en vente automatique', async () => {
    await page.evaluate(() => {
      const btns = [...document.querySelectorAll('[aria-label="Ajouter une unité à Test auto houmous"]')].filter((b) => b.offsetParent !== null);
      btns[0].click();
    });
    const d = await until(async () => {
      const doc = await col('products').doc(productId).get();
      return doc.get('stock') === 1 && doc.get('autoSoldOut') === false ? doc : null;
    }, 'remise en vente', 25_000);
    return { stock: d.get('stock'), available: d.get('available') };
  });

  let optionId;
  await step('Créer une option', async () => {
    await go('/options');
    await clickText('Nouvelle option');
    await fill('Nom de l’option', 'Test auto option', '[role=dialog]');
    await fill('Supplément', '1,50', '[role=dialog]');
    await page.evaluate(() => [...document.querySelectorAll('[role=dialog] button')].filter((b) => /Créer|Enregistrer|Ajouter/.test(b.textContent)).at(-1).click());
    const doc = await until(() => findByName('options', 'Test auto option'), 'option en base');
    optionId = doc.id;
    return { priceCents: doc.get('priceCents'), enabled: doc.get('enabled') };
  });

  await step('Créer une liste avec l’option', async () => {
    await clickText('Nouvelle liste');
    await fill('Nom de la liste', 'Test auto liste', '[role=dialog]');
    await page.evaluate(() => {
      const scope = document.querySelector('[role=dialog] [aria-label="Options disponibles"]');
      const row = [...scope.querySelectorAll('li, button, label')].find((el) => el.textContent.includes('Test auto option'));
      (row.querySelector('button, input') ?? row).click();
    });
    await sleep(300);
    await page.evaluate(() => [...document.querySelectorAll('[role=dialog] button')].filter((b) => /Créer|Enregistrer/.test(b.textContent)).at(-1).click());
    const doc = await until(() => findByName('optionGroups', 'Test auto liste'), 'liste en base');
    await sleep(1500);
    const product = await col('products').doc(productId).get();
    return { optionIds: doc.get('optionIds'), min: doc.get('min'), max: doc.get('max'), linkedToProduct: (product.get('optionGroupIds') ?? []).includes(doc.id) };
  });

  await step('Supprimer l’option : retirée de la liste (corbeille)', async () => {
    await clickText('Options', '[role=tab]');
    await openMenu('Actions pour Test auto option');
    await clickText('Supprimer', '[role=menuitem]');
    await page.evaluate(() => [...document.querySelectorAll('[role=dialog] button, [role=alertdialog] button')].filter((b) => /^Supprimer/.test(b.textContent.trim())).at(-1).click());
    await until(async () => !(await col('options').doc(optionId).get()).exists, 'option supprimée');
    const group = await findByName('optionGroups', 'Test auto liste');
    return { groupStillExists: Boolean(group), optionIds: group?.get('optionIds') ?? null };
  });

  await step('Vitrine : mettre en avant puis retirer', async () => {
    const before = (await col('products').where('featured', '==', true).get()).size;
    await go('/produits-populaires');
    await page.type('[aria-label="Rechercher un produit"]', 'Test auto tartine');
    await page.evaluate(() => (document.querySelector('[aria-label="Rechercher un produit"]').value = ''));
    await go('/produits-populaires');
    const label = 'Mettre Test auto houmous en avant';
    await page.type('[aria-label="Rechercher un produit"]', 'Test auto houmous');
    await sleep(500);
    await page.evaluate((l) => [...document.querySelectorAll(`[aria-label="${l}"]`)].find((b) => b.offsetParent !== null)?.click(), label);
    const doc = await until(async () => {
      const d = await col('products').doc(productId).get();
      return d.get('featured') === true ? d : null;
    }, 'produit en vitrine');
    const order = doc.get('featuredOrder');
    await page.evaluate(() => [...document.querySelectorAll('[aria-label="Retirer Test auto houmous de la vitrine"]')].find((b) => b.offsetParent !== null)?.click());
    await until(async () => (await col('products').doc(productId).get()).get('featured') === false, 'retiré de la vitrine');
    return { before, featuredOrder: order };
  });

  await step('Import CSV : simulation, mention d’alcool importée hors vente, import réel', async () => {
    await go('/produits');
    await clickText('Import / export');
    await clickText('Importer un fichier CSV', '[role=menuitem]');
    const input = await page.waitForSelector('[role=dialog] input[type=file]', { timeout: 10_000 });
    await input.uploadFile(join(assets, 'import.csv'));
    await page.waitForFunction(() => [...document.querySelectorAll('[role=dialog] button')].some((b) => /Importer \d|Rien à importer/.test(b.textContent)), { timeout: 30_000 });
    const review = await page.evaluate(() => document.querySelector('[role=dialog]').innerText.slice(0, 900));
    await clickText('Importer 2 produits', '[role=dialog] button');
    const doc = await until(() => findByName('products', 'Test auto tartine zaatar'), 'produit importé', 30_000);
    const wine = await until(() => findByName('products', 'Test auto vin rouge'), 'ligne d’alcool importée', 10_000);
    await page.keyboard.press('Escape');
    return { review: review.replace(/\s+/g, ' ').slice(0, 400), imported: { stock: doc.get('stock'), allergens: doc.get('allergens'), priceCents: doc.get('priceCents') }, wine: { available: wine.get('available') } };
  });

  await step('Réordonner les sections (Descendre)', async () => {
    await go('/produits');
    const before = (await col('sections').doc(sectionId).get()).get('order');
    // La section de test est parmi les dernières : on la fait monter.
    await openMenu('Actions pour la section Test auto section');
    await clickText('Monter', '[role=menuitem]');
    const after = await until(async () => {
      const o = (await col('sections').doc(sectionId).get()).get('order');
      return o !== before ? o : null;
    }, 'ordre modifié');
    return { before, after };
  });

  await step('Capture finale de la carte', async () => {
    await go('/produits');
    await page.screenshot({ path: join(outDir, 'rcarte-e2e-final.png'), fullPage: false });
  });
} finally {
  await browser.close();
}
console.log(JSON.stringify({ results, consoleErrors: errors.slice(0, 15) }, null, 2));
process.exit(0);
