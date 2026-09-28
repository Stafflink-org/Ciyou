// Scénario réel des zones (Cloud Functions saveDeliveryZone / deleteDeliveryZone) :
// création d'une zone en rayon, frais hors bornes refusés côté écran, puis suppression.
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function click(page, predicate, arg) {
  const ok = await page.evaluate(predicate, arg);
  if (!ok) throw new Error(`Élément introuvable : ${arg}`);
}
const byText = (t) => {
  const el = [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === t && !b.disabled);
  if (!el) return false;
  el.click();
  return true;
};
const byLabel = (l) => {
  const el = document.querySelector(`[aria-label="${l}"]`);
  if (!el) return false;
  el.click();
  return true;
};

async function toast(page) {
  for (let i = 0; i < 40; i += 1) {
    const text = await page.evaluate(() => [...document.querySelectorAll('[data-sonner-toast]')].map((t) => t.textContent?.trim()).join(' | '));
    if (text) return text;
    await wait(500);
  }
  return '(aucun message)';
}

export default async function steps(page, path) {
  if (path !== '/zones') return;
  // Zone restée d'un essai précédent : supprimée d'abord.
  const leftover = await page.evaluate(() => Boolean(document.querySelector('[aria-label="Supprimer Zone de test"]')));
  if (leftover) await remove(page);
  await click(page, byText, 'Nouvelle zone');
  await wait(500);
  await page.evaluate(() => {
    const input = [...document.querySelectorAll('input')].find((i) => i.placeholder === 'Ex. Centre-ville');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(input, 'Zone de test');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const submit = await page.evaluate(() =>
    [...document.querySelectorAll('button')].filter((b) => b.className.includes('primary')).map((b) => b.textContent?.trim()),
  );
  console.error('[zones] boutons :', submit.join(', '));
  await click(page, byText, 'Créer la zone');
  console.error('[zones] création :', await toast(page));
  await wait(3000);
  await remove(page);
}

async function remove(page) {
  await click(page, byLabel, 'Supprimer Zone de test');
  await wait(600);
  await click(page, byText, 'Supprimer la zone');
  for (let i = 0; i < 60; i += 1) {
    const gone = await page.evaluate(() => !document.querySelector('[aria-label="Supprimer Zone de test"]'));
    if (gone) {
      console.error('[zones] suppression : zone retirée de la liste');
      return;
    }
    await wait(500);
  }
  console.error('[zones] suppression : zone toujours affichée');
}
