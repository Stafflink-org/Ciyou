// Test réel cdc-fix-residuals-12 (§2 Recherche globale) : adminUpdateRestaurant
// (functions/src/admin/acteurs/commercial.ts) ne recalculait `searchKeywords` que si le nom ou
// l'adresse changeaient — jamais si seuls l'e-mail ou le téléphone étaient modifiés — et, même
// dans les cas où il les recalculait (changement de nom/adresse), utilisait les ANCIENNES valeurs
// d'e-mail/téléphone (`r.email`/`r.phone`) au lieu des nouvelles (`data.email`/`data.phone`). Un
// restaurant dont le téléphone/e-mail est modifié par le back-office super admin devenait donc
// introuvable par ce téléphone/e-mail dans la recherche universelle, silencieusement.
//
// Appelle directement le handler de la fonction callable déployée via `.run()` (même patron que
// cdc-fix-residuals-11), sur le restaurant réel mina-kitchen (téléphone temporairement changé,
// restauré en `finally`) — aucune autre donnée du profil n'est modifiée.
//
//   npx tsx scripts/tests/cdc-fix-residuals-12.flow.mjs
import { writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const { CLI_CLIENT_ID, CLI_CLIENT_SECRET, PROJECT_ID, readCliRefreshToken } = await import('../gcp-token.mjs');
const adcPath = join(tmpdir(), `cdcres12-adc-${process.pid}.json`);
writeFileSync(adcPath, JSON.stringify({ type: 'authorized_user', client_id: CLI_CLIENT_ID, client_secret: CLI_CLIENT_SECRET, refresh_token: readCliRefreshToken() }));
process.env.GOOGLE_APPLICATION_CREDENTIALS = adcPath;
process.env.GOOGLE_CLOUD_PROJECT = PROJECT_ID;
process.env.GCLOUD_PROJECT = PROJECT_ID;

const results = [];
const record = (name, ok, detail) => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'OK   ' : 'ÉCHEC'} ${name}${detail ? ` — ${detail}` : ''}`);
};

const RESTAURANT_ID = 'mina-kitchen';
const ADMIN_UID = 'test-super-admin';
const TEST_PHONE = '+33 6 99 88 77 66';

async function main() {
  const { db } = await import('../../functions/src/lib/admin.ts');
  const { adminUpdateRestaurant } = await import('../../functions/src/admin/acteurs/commercial.ts');

  const ref = db.doc(`restaurants/${RESTAURANT_ID}`);
  const before = (await ref.get()).data();
  const originalPhone = before.phone;
  const originalKeywords = before.searchKeywords ?? [];
  console.log('téléphone avant :', originalPhone);

  const basePayload = {
    restaurantId: RESTAURANT_ID,
    name: before.name,
    merchantType: before.merchantType ?? 'restaurant',
    description: before.description ?? null,
    email: before.email ?? null,
    cuisineIds: before.cuisineIds ?? [],
    tags: before.tags ?? [],
    priceLevel: before.priceLevel,
    zoneIds: before.zoneIds ?? [],
    fulfillmentModes: before.fulfillmentModes ?? [],
    deliveredBy: before.deliveredBy,
    address: { line1: before.address.line1, line2: before.address.line2 ?? null, postalCode: before.address.postalCode, city: before.address.city },
    currency: before.currency ?? 'EUR',
    reason: 'Test réel cdc-fix-residuals-12 : vérifier que le changement de téléphone seul régénère searchKeywords',
  };

  try {
    const request = { data: { ...basePayload, phone: TEST_PHONE }, auth: { uid: ADMIN_UID, token: { role: 'admin', adminRole: 'super_admin' } } };
    const result = await adminUpdateRestaurant.run(request);
    // `searchKeywords` est un champ dérivé, jamais listé dans `changed` (qui ne porte que sur les
    // champs soumis par le formulaire) : seule sa présence réelle en base (vérifiée plus bas) compte.
    record('appel accepté, changed inclut phone', result.changed.includes('phone'), JSON.stringify(result.changed));

    const after = (await ref.get()).data();
    record('téléphone bien mis à jour en base', after.phone === TEST_PHONE, `phone=${after.phone}`);
    const digits = TEST_PHONE.replace(/[^0-9]/g, ''); // 33699887766
    const kw = after.searchKeywords ?? [];
    record('searchKeywords contient désormais le nouveau numéro (recherche possible par ce numéro)', kw.includes(digits), `digits attendus=${digits}, trouvés=${JSON.stringify(kw.filter((k) => /^\d+$/.test(k)))}`);
    const oldDigits = originalPhone.replace(/[^0-9]/g, '');
    record('searchKeywords ne contient plus l’ancien numéro (pas resté périmé)', !kw.includes(oldDigits), `ancien=${oldDigits}`);
  } finally {
    const request = { data: { ...basePayload, phone: originalPhone }, auth: { uid: ADMIN_UID, token: { role: 'admin', adminRole: 'super_admin' } } };
    await adminUpdateRestaurant.run(request);
    const restored = (await ref.get()).data();
    record('nettoyage : téléphone restauré à sa valeur d’origine', restored.phone === originalPhone, `phone=${restored.phone}`);
    const restoredKw = restored.searchKeywords ?? [];
    const sameSet = JSON.stringify([...restoredKw].sort()) === JSON.stringify([...originalKeywords].sort());
    record('nettoyage : searchKeywords revenus à l’état d’origine', sameSet, sameSet ? 'identique' : `avant=${JSON.stringify(originalKeywords)} après=${JSON.stringify(restoredKw)}`);
  }
}

try {
  await main();
} finally {
  try {
    rmSync(adcPath, { force: true });
  } catch {}
}

const ok = results.every((r) => r.ok);
console.log(`\n${results.filter((r) => r.ok).length}/${results.length} OK`);
process.exit(ok ? 0 : 1);
