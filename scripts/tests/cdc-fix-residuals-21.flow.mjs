// Test réel cdc-fix-residuals-21 (§5 Gestion des restaurants, « Groupes et chaînes ») :
// `saveRestaurantGroup` n'appliquait les conditions commerciales communes du groupe
// (`applyCommercialPatch`) que si CES conditions changeaient par rapport au dernier appel
// (`commercialChanged`). Un établissement ajouté à un groupe dont les conditions communes
// n'avaient pas changé n'héritait donc jamais de la formule/commission du groupe : il gardait
// silencieusement ses conditions individuelles antérieures (ou l'absence de conditions, pour un
// commerce tout neuf).
//
// Corrigé : les établissements NOUVELLEMENT AJOUTÉS reçoivent désormais les conditions du groupe
// même quand celles-ci n'ont pas changé par rapport au dernier appel.
//
// Appelle directement le handler déployé via `.run()`, sur le VRAI groupe « Maison Haddad »
// (3 établissements, formule « pro », commission non négociée) auquel on ajoute un 4e
// établissement entièrement jetable, sans modifier les conditions communes du groupe. Restauré
// intégralement après coup (groupe remis à son état exact d'origine, établissement jetable
// supprimé).
//
//   npx tsx scripts/tests/cdc-fix-residuals-21.flow.mjs
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const { CLI_CLIENT_ID, CLI_CLIENT_SECRET, PROJECT_ID, readCliRefreshToken } = await import('../gcp-token.mjs');
const adcPath = join(tmpdir(), `cdcres21-adc-${process.pid}.json`);
writeFileSync(adcPath, JSON.stringify({ type: 'authorized_user', client_id: CLI_CLIENT_ID, client_secret: CLI_CLIENT_SECRET, refresh_token: readCliRefreshToken() }));
process.env.GOOGLE_APPLICATION_CREDENTIALS = adcPath;
process.env.GOOGLE_CLOUD_PROJECT = PROJECT_ID;
process.env.GCLOUD_PROJECT = PROJECT_ID;

const results = [];
const record = (name, ok, detail) => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'OK   ' : 'ÉCHEC'} ${name}${detail ? ` — ${detail}` : ''}`);
};

const GROUP_ID = 'maison-haddad';
const ADMIN_UID = 'test-super-admin';
const NEW_RESTAURANT_ID = 'cdcres21-test-restaurant-haddad4';

async function main() {
  const { db, Timestamp } = await import('../../functions/src/lib/admin.ts');
  const { saveRestaurantGroup } = await import('../../functions/src/admin/acteurs/commercial.ts');

  const groupRef = db.doc(`restaurantGroups/${GROUP_ID}`);
  const groupSnapBefore = await groupRef.get();
  if (!groupSnapBefore.exists) throw new Error('Groupe « Maison Haddad » introuvable — test interrompu sans modification.');
  const originalGroup = groupSnapBefore.data();

  const now = Timestamp.now();
  await db.doc(`restaurants/${NEW_RESTAURANT_ID}`).set({
    name: 'Commerce de test (cdcres21, 4e établissement Haddad)',
    status: 'active',
    countryId: 'FR',
    cityId: 'longwy',
    groupId: null,
    planCode: null,
    createdAt: now,
    updatedAt: now,
    test: true,
  });

  const originalMembersBefore = new Map();
  for (const id of originalGroup.restaurantIds) {
    const r = await db.doc(`restaurants/${id}`).get();
    originalMembersBefore.set(id, r.data()?.planCode ?? null);
  }

  try {
    const commercialBefore = await db.doc(`restaurants/${NEW_RESTAURANT_ID}/private/commercial`).get();
    record('avant correctif : nouveau commerce sans conditions commerciales', !commercialBefore.exists, `exists=${commercialBefore.exists}`);

    const request = {
      data: {
        groupId: GROUP_ID,
        name: originalGroup.name,
        ownerEmail: 'mina.haddad@golink.test',
        countryId: originalGroup.countryId,
        legalName: originalGroup.legalName,
        siren: originalGroup.siren,
        vatNumber: originalGroup.vatNumber,
        restaurantIds: [...originalGroup.restaurantIds, NEW_RESTAURANT_ID],
        commissionBps: originalGroup.commercial.commissionBps,
        planCode: originalGroup.commercial.planCode,
        consolidatedBilling: originalGroup.consolidatedBilling,
        reason: 'Test réel cdc-fix-residuals-21 : ajout 4e établissement, conditions communes INCHANGÉES',
      },
      auth: { uid: ADMIN_UID, token: { role: 'admin', adminRole: 'super_admin' } },
    };

    const res = await saveRestaurantGroup.run(request);
    record('appel saveRestaurantGroup réussi (conditions communes non modifiées)', res.groupId === GROUP_ID, JSON.stringify(res));

    const restaurantAfter = await db.doc(`restaurants/${NEW_RESTAURANT_ID}`).get();
    record('le 4e établissement a bien reçu groupId=maison-haddad', restaurantAfter.data()?.groupId === GROUP_ID);
    record(
      'le 4e établissement a hérité de la formule du groupe (planCode=pro) — correctif attendu',
      restaurantAfter.data()?.planCode === originalGroup.commercial.planCode,
      `planCode=${restaurantAfter.data()?.planCode}`,
    );

    const commercialAfter = await db.doc(`restaurants/${NEW_RESTAURANT_ID}/private/commercial`).get();
    record(
      'private/commercial du 4e établissement créé avec la formule du groupe — correctif attendu',
      commercialAfter.exists && commercialAfter.data()?.planCode === originalGroup.commercial.planCode,
      JSON.stringify(commercialAfter.data() ?? null),
    );

    const groupAfter = await groupRef.get();
    record('groupe : restaurantIds contient bien les 4 établissements', groupAfter.data()?.restaurantIds.length === 4, JSON.stringify(groupAfter.data()?.restaurantIds));

    // Non-régression : les 3 établissements d'origine gardent EXACTEMENT la même formule qu'avant
    // l'appel (aucun effet de bord sur les membres déjà présents, puisque les conditions
    // communes n'ont pas changé — seuls les AJOUTS reçoivent le patch, conformément au
    // correctif). Note : `lune-coffee` est déjà en formule « basic » dans les données de départ
    // (incohérence préexistante, probablement la même trace du bug corrigé ici — hors périmètre
    // de ce test, qui vérifie uniquement l'ABSENCE de changement, pas la valeur absolue).
    for (const id of originalGroup.restaurantIds) {
      const r = await db.doc(`restaurants/${id}`).get();
      const before = originalMembersBefore.get(id);
      const after = r.data()?.planCode ?? null;
      record(`non-régression : ${id} formule inchangée (${before})`, after === before, `avant=${before} après=${after}`);
    }
  } finally {
    // Restauration intégrale du groupe à son état exact d'origine.
    await groupRef.set(originalGroup);
    const groupRestored = await groupRef.get();
    record('nettoyage : groupe restauré à son état exact d’origine', JSON.stringify(groupRestored.data()?.restaurantIds) === JSON.stringify(originalGroup.restaurantIds));

    // Suppression complète du commerce jetable (fiche + sous-collections touchées).
    await db.doc(`restaurants/${NEW_RESTAURANT_ID}/private/commercial`).delete().catch(() => {});
    const commissionRulesSnap = await db.collection('commissionRules').where('scope', '==', 'restaurant').where('scopeId', '==', NEW_RESTAURANT_ID).get();
    await Promise.all(commissionRulesSnap.docs.map((d) => d.ref.delete()));
    const auditSnap = await db.collection('auditLogs').where('target.id', '==', NEW_RESTAURANT_ID).get();
    await Promise.all(auditSnap.docs.map((d) => d.ref.delete()));
    await db.doc(`restaurants/${NEW_RESTAURANT_ID}`).delete().catch(() => {});

    const gone = !(await db.doc(`restaurants/${NEW_RESTAURANT_ID}`).get()).exists;
    record('nettoyage : commerce jetable et traces associées supprimés', gone);
  }
}

await main();
const ok = results.every((r) => r.ok);
console.log(`\n${results.filter((r) => r.ok).length}/${results.length} OK`);
process.exit(ok ? 0 : 1);
