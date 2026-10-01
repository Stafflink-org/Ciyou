// Test réel cdc-fix-residuals-34 (§5 Fiche restaurant, validation des commerces) :
// `runDocumentExpiryCheck` (tâche quotidienne existante) ne relance que les pièces déjà
// APPROUVÉES proches de l'expiration — un dossier resté en attente (`pending`/
// `documents_missing`) sans qu'AUCUNE pièce obligatoire n'ait jamais été déposée pour un type
// donné n'a aucune entrée dans `partnerDocuments` pour ce type et n'était donc jamais inclus
// dans ce contrôle : il pouvait rester bloqué indéfiniment sans relance ni alerte (seule une
// relance manuelle existait, `sendDocumentReminder`, à l'initiative d'un administrateur).
//
// Corrigé : `runStuckOnboardingReminderCheck` (functions/src/admin/acteurs/applications.ts)
// relance aux mêmes seuils que les autres relances documentaires (3/7/14 jours depuis
// l'inscription), plafonné par un nouveau compteur sur le restaurant
// (`onboardingRemindersSent`/`onboardingLastReminderAt`, packages/shared). Exposé en tâche
// planifiée `checkStuckOnboarding` (quotidien 07:00).
//
// Test réel sur `golink-9f16d` : un commerce jetable en attente depuis 10 jours SANS aucune
// pièce déposée doit être relancé (seuil 7 j franchi, compteur posé à 2) ; un commerce jetable
// en attente ayant déposé toutes les pièces obligatoires (même non encore approuvées) ne doit
// PAS être relancé par ce correctif (ce cas reste couvert par la file de validation normale) ;
// une seconde exécution ne doit pas redoubler la relance pour le même palier. Nettoyage complet
// après coup.
//
//   npx tsx scripts/tests/cdc-fix-residuals-34.flow.mjs
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Timestamp } from '@google-cloud/firestore';
import { db } from '../lib/admin.mjs';
import { CLI_CLIENT_ID, CLI_CLIENT_SECRET, PROJECT_ID, readCliRefreshToken } from '../gcp-token.mjs';

const adcPath = join(tmpdir(), `cdcres34-adc-${process.pid}.json`);
writeFileSync(adcPath, JSON.stringify({ type: 'authorized_user', client_id: CLI_CLIENT_ID, client_secret: CLI_CLIENT_SECRET, refresh_token: readCliRefreshToken() }));
process.env.GOOGLE_APPLICATION_CREDENTIALS = adcPath;
process.env.GOOGLE_CLOUD_PROJECT = PROJECT_ID;
process.env.GCLOUD_PROJECT = PROJECT_ID;

const results = [];
function record(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'OK   ' : 'ECHEC'} ${name}${detail ? ` - ${detail}` : ''}`);
}
const check = (name, condition, detail) => record(name, Boolean(condition), detail);

const STUCK_ID = 'cdcres34-stuck';
const COMPLETE_ID = 'cdcres34-complete';

async function main() {
  const now = Timestamp.now();
  const createdAt10d = Timestamp.fromMillis(now.toMillis() - 10 * 86_400_000);

  const base = {
    name: 'CDCRES34 Test', slug: 'cdcres34-test', cityId: 'longwy', countryId: 'FR', status: 'onboarding',
    onboardingStatus: 'pending', ownerId: 'cdcres34-owner', email: 'cdcres34-owner@golink.test',
    test: true, createdAt: createdAt10d, updatedAt: createdAt10d, deletedAt: null,
  };
  await db.doc(`restaurants/${STUCK_ID}`).set({ ...base, name: 'CDCRES34 Bloqué (aucune pièce)' });
  await db.doc(`restaurants/${COMPLETE_ID}`).set({ ...base, name: 'CDCRES34 Complet (pièces déposées)' });

  // Le commerce "complet" a bien déposé les 3 groupes obligatoires (même non approuvés) : ne
  // doit pas être relancé par ce correctif.
  for (const [id, type] of [['cdcres34-kbis', 'kbis'], ['cdcres34-id', 'manager_id'], ['cdcres34-rib', 'bank_details']]) {
    await db.doc(`partnerDocuments/${id}`).set({
      ownerType: 'restaurant', ownerId: COMPLETE_ID, type, status: 'pending_review', fileUrl: 'https://example.test/x.pdf', createdAt: createdAt10d, updatedAt: createdAt10d, test: true,
    });
  }

  const { runStuckOnboardingReminderCheck } = await import('../../functions/src/admin/acteurs/applications.ts');
  const report = await runStuckOnboardingReminderCheck();
  check('runStuckOnboardingReminderCheck : au moins un dossier relancé', report.reminded >= 1, JSON.stringify(report));

  const stuck = (await db.doc(`restaurants/${STUCK_ID}`).get()).data();
  check('dossier bloqué (10j, 0 pièce) relancé, seuil 7j atteint -> compteur=2 (correctif attendu)', stuck?.onboardingRemindersSent === 2, `onboardingRemindersSent=${stuck?.onboardingRemindersSent}`);
  check('dossier bloqué : onboardingLastReminderAt posé', stuck?.onboardingLastReminderAt != null, JSON.stringify(stuck?.onboardingLastReminderAt));

  const complete = (await db.doc(`restaurants/${COMPLETE_ID}`).get()).data();
  check('dossier complet (3 pièces déposées) NON relancé (non-régression)', complete?.onboardingRemindersSent == null, `onboardingRemindersSent=${complete?.onboardingRemindersSent}`);

  const notifSnap = await db.collection(`users/cdcres34-owner/notifications`).where('category', '==', 'document').get();
  check('notification réelle écrite pour le propriétaire du dossier bloqué', notifSnap.size >= 1, `count=${notifSnap.size}`);

  // Relance : le palier (2) est déjà atteint, pas de nouvelle relance pour le même seuil.
  await db.doc(`restaurants/${STUCK_ID}`).get(); // pas de changement de date, même jour
  const report2 = await runStuckOnboardingReminderCheck();
  const stuckAfter = (await db.doc(`restaurants/${STUCK_ID}`).get()).data();
  check('relance : pas de double traitement pour le même palier', stuckAfter?.onboardingRemindersSent === 2, `onboardingRemindersSent=${stuckAfter?.onboardingRemindersSent} report2=${JSON.stringify(report2)}`);
}

async function cleanup() {
  await db.doc(`restaurants/${STUCK_ID}`).delete().catch(() => {});
  await db.doc(`restaurants/${COMPLETE_ID}`).delete().catch(() => {});
  for (const id of ['cdcres34-kbis', 'cdcres34-id', 'cdcres34-rib']) await db.doc(`partnerDocuments/${id}`).delete().catch(() => {});
  const notifSnap = await db.collection('users/cdcres34-owner/notifications').get();
  await Promise.all(notifSnap.docs.map((d) => d.ref.delete()));
}

main()
  .catch((error) => record('exception', false, String(error.stack ?? error)))
  .finally(async () => {
    if (!process.env.NO_CLEANUP) await cleanup();
    const failed = results.filter((r) => !r.ok);
    console.log(`\n${results.length - failed.length}/${results.length} OK`);
    if (failed.length) {
      console.log('Echecs :');
      for (const f of failed) console.log(` - ${f.name} : ${f.detail}`);
      process.exitCode = 1;
    }
  });
