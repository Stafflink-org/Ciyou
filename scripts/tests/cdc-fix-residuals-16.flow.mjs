// Test réel cdc-fix-residuals-16 (§17 Abonnements et commissions, « Formules » — application des
// limites) : la limite de produits d'une formule (`plan.limits.maxProducts`) n'était appliquée que
// par la règle Firestore `withinProductLimit` (saisie manuelle côté écran) — `importMenu` (import
// CSV de la carte) écrit en lot avec le SDK Admin, qui contourne entièrement les règles Firestore,
// et ne vérifiait jamais cette limite : un commerce en formule limitée pouvait la dépasser à
// volonté via l'import.
//
// Corrigé : `importMenu` vérifie désormais la limite ligne à ligne (`planLimitOf`,
// `finance/argent/entitlements.ts`) et refuse la création au-delà, avec une erreur par ligne
// (cohérent avec le rapport ligne par ligne déjà produit par cette fonction), sans annuler
// l'import entier.
//
// Appelle directement le handler déployé via `.run()` (patron déjà utilisé par les tests
// précédents), sur un restaurant et une formule entièrement jetables, supprimés après coup.
//
//   npx tsx scripts/tests/cdc-fix-residuals-16.flow.mjs
import { writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const { CLI_CLIENT_ID, CLI_CLIENT_SECRET, PROJECT_ID, readCliRefreshToken } = await import('../gcp-token.mjs');
const adcPath = join(tmpdir(), `cdcres16-adc-${process.pid}.json`);
writeFileSync(adcPath, JSON.stringify({ type: 'authorized_user', client_id: CLI_CLIENT_ID, client_secret: CLI_CLIENT_SECRET, refresh_token: readCliRefreshToken() }));
process.env.GOOGLE_APPLICATION_CREDENTIALS = adcPath;
process.env.GOOGLE_CLOUD_PROJECT = PROJECT_ID;
process.env.GCLOUD_PROJECT = PROJECT_ID;

const results = [];
const record = (name, ok, detail) => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'OK   ' : 'ÉCHEC'} ${name}${detail ? ` — ${detail}` : ''}`);
};

const RESTAURANT_ID = 'cdcres16-test-restaurant';
const PLAN_CODE = 'cdcres16-test-plan';
const ADMIN_UID = 'test-super-admin';

function csvRow(i) {
  return { section: 'Test', name: `Produit test ${i}`, priceCents: 500, vatCategory: 'food' };
}

async function main() {
  const { db, Timestamp } = await import('../../functions/src/lib/admin.ts');
  const { importMenu } = await import('../../functions/src/menu/import.ts');

  await db.doc(`plans/${PLAN_CODE}`).set({
    name: 'Formule de test (3 produits max)',
    priceCents: 0,
    features: [],
    limits: { maxProducts: 3, maxStaff: null, maxPromotions: null },
    stripePriceId: null,
    test: true,
  });
  await db.doc(`restaurants/${RESTAURANT_ID}`).set({
    name: 'Commerce de test (limite formule)',
    status: 'active',
    countryId: 'FR',
    cityId: 'longwy',
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
    test: true,
  });
  await db.doc(`restaurants/${RESTAURANT_ID}/private/commercial`).set({
    planCode: PLAN_CODE,
    subscriptionStatus: 'active',
    test: true,
  });

  const request = { data: { restaurantId: RESTAURANT_ID, rows: [1, 2, 3, 4, 5].map(csvRow), dryRun: false }, auth: { uid: ADMIN_UID, token: { role: 'admin', adminRole: 'super_admin' } } };

  const createdSectionIds = [];
  try {
    const report = await importMenu.run(request);
    record('rapport : 3 produits créés (pas 5)', report.created === 3, `created=${report.created}`);
    record('rapport : 2 lignes en erreur de limite', report.errors.length === 2 && report.errors.every((e) => e.message.includes('Limite de produits')), JSON.stringify(report.errors));

    const productsSnap = await db.collection(`restaurants/${RESTAURANT_ID}/products`).get();
    record('seulement 3 produits réellement écrits en base', productsSnap.size === 3, `trouvés=${productsSnap.size}`);
    productsSnap.docs.forEach((d) => createdSectionIds.push(['product', d.ref]));

    const sectionsSnap = await db.collection(`restaurants/${RESTAURANT_ID}/sections`).get();
    sectionsSnap.docs.forEach((d) => createdSectionIds.push(['section', d.ref]));
  } finally {
    for (const [, ref] of createdSectionIds) await ref.delete().catch(() => {});
    await db.doc(`restaurants/${RESTAURANT_ID}/private/commercial`).delete().catch(() => {});
    await db.doc(`restaurants/${RESTAURANT_ID}`).delete().catch(() => {});
    await db.doc(`plans/${PLAN_CODE}`).delete().catch(() => {});
    const gone = !(await db.doc(`restaurants/${RESTAURANT_ID}`).get()).exists && !(await db.doc(`plans/${PLAN_CODE}`).get()).exists;
    record('nettoyage : restaurant, formule et produits de test supprimés', gone);
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
