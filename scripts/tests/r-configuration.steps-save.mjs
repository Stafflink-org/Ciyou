// Scénarios d'écriture réels (Cloud Function updateRestaurantSettings) : chaque
// réglage est modifié, enregistré, vérifié par le message de succès, puis rétabli.
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function clickByLabel(page, label) {
  const ok = await page.evaluate((l) => {
    const el = document.querySelector(`[aria-label="${l}"]`);
    if (!el) return false;
    el.click();
    return true;
  }, label);
  if (!ok) throw new Error(`Élément introuvable : ${label}`);
}

async function clickButton(page, text) {
  const ok = await page.evaluate((t) => {
    const el = [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === t && !b.disabled);
    if (!el) return false;
    el.click();
    return true;
  }, text);
  if (!ok) throw new Error(`Bouton introuvable ou désactivé : ${text}`);
}

async function toast(page) {
  for (let i = 0; i < 40; i += 1) {
    const text = await page.evaluate(() => [...document.querySelectorAll('[data-sonner-toast]')].map((t) => t.textContent?.trim()).join(' | '));
    if (text) return text;
    await wait(500);
  }
  return '(aucun message)';
}

/** Attend la disparition des messages (les retirer du DOM casserait le rendu React). */
async function dismissToasts(page) {
  for (let i = 0; i < 30; i += 1) {
    const count = await page.evaluate(() => document.querySelectorAll('[data-sonner-toast]').length);
    if (count === 0) return;
    await wait(500);
  }
}

async function roundTrip(page, label, toggleLabel) {
  await clickByLabel(page, toggleLabel);
  await wait(300);
  await clickButton(page, 'Enregistrer');
  const first = await toast(page);
  await dismissToasts(page);
  await wait(2500);
  await clickByLabel(page, toggleLabel);
  await wait(300);
  await clickButton(page, 'Enregistrer');
  const second = await toast(page);
  await dismissToasts(page);
  console.error(`[${label}] modification : ${first} / rétablissement : ${second}`);
}

export default async function steps(page, path) {
  if (path === '/reglages-commandes') await roundTrip(page, 'commandes', 'Acceptation automatique');
  if (path === '/notifications') await roundTrip(page, 'notifications', 'Rapport hebdomadaire');
  if (path === '/paiements') await roundTrip(page, 'paiements', 'Apple Pay');
  if (path === '/horaires') await roundTrip(page, 'horaires', 'Ouverture le dimanche');
  await wait(1500);
}
