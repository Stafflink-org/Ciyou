// Test réel cdc-fix-residuals-11 (§6 Gestion des livreurs, « Documents ») : la relance de pièce
// livreur qui approche de son expiration n'envoyait qu'une notification dans l'application,
// jamais d'e-mail — contrairement à la même relance côté restaurant
// (functions/src/admin/acteurs/applications.ts::checkRestaurantDocuments, `documentExpiringEmail`)
// et contrairement au blocage livreur qui suit la même pièce une fois réellement expirée
// (`driverDocumentExpiredEmail`, déjà avec e-mail). Manque documenté depuis plusieurs tâches
// (docs/AUDIT_COUVERTURE_CDC.md §6 « Documents »).
//
// Corrigé : nouvelle fonction `driverDocumentExpiringEmail` (functions/src/admin/operations/
// emails.ts) construite sur le même modèle que `documentExpiringEmail` (restaurant) et
// `driverDocumentExpiredEmail` (livreur), câblée dans la relance
// (`functions/src/admin/operations/live.ts::remindDriverDocumentExpiry`, logique de relance
// extraite de `documentExpiry` pour pouvoir la tester sur un seul document jetable sans
// parcourir — et donc sans notifier en double — la collection réelle `partnerDocuments`).
//
// Appelle directement `remindDriverDocumentExpiry` sur un livreur et un document Storage
// entièrement jetables (document `test: true`, e-mail `*.test` donc simulé, pas d'envoi réel),
// supprimés après coup.
//
//   npx tsx scripts/tests/cdc-fix-residuals-11.flow.mjs
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const { CLI_CLIENT_ID, CLI_CLIENT_SECRET, PROJECT_ID, readCliRefreshToken } = await import('../gcp-token.mjs');
const adcPath = join(tmpdir(), `cdcres11-adc-${process.pid}.json`);
writeFileSync(adcPath, JSON.stringify({ type: 'authorized_user', client_id: CLI_CLIENT_ID, client_secret: CLI_CLIENT_SECRET, refresh_token: readCliRefreshToken() }));
process.env.GOOGLE_APPLICATION_CREDENTIALS = adcPath;
process.env.GOOGLE_CLOUD_PROJECT = PROJECT_ID;
process.env.GCLOUD_PROJECT = PROJECT_ID;
process.env.FIREBASE_CONFIG = JSON.stringify({ projectId: PROJECT_ID, storageBucket: 'golink-9f16d.firebasestorage.app' });

const results = [];
const record = (name, ok, detail) => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'OK   ' : 'ÉCHEC'} ${name}${detail ? ` — ${detail}` : ''}`);
};

const TEMPLATE_DRIVER_ID = 'ops-applicant-03';
const DRIVER_ID = 'cdcres11-test-driver';
const DOC_ID = 'cdcres11-test-document';

function parisDayPlus(n) {
  const d = new Date(Date.now() + n * 86_400_000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(d); // YYYY-MM-DD
}

async function main() {
  const { db, Timestamp } = await import('../../functions/src/lib/admin.ts');
  const { remindDriverDocumentExpiry } = await import('../../functions/src/admin/operations/live.ts');
  const { driverDocumentExpiringEmail } = await import('../../functions/src/admin/operations/emails.ts');

  // 0) La fonction d'e-mail elle-même construit un message valide (sujet, html, text).
  const sample = driverDocumentExpiringEmail('Test', 'insurance', '05/10/2026', 5);
  record('driverDocumentExpiringEmail produit un e-mail bien formé', !!sample?.subject && !!sample?.html && !!sample?.text, `sujet="${sample?.subject}"`);
  record('le sujet mentionne le délai restant', sample.subject.includes('5 jour'), sample.subject);

  const templateSnap = await db.doc(`drivers/${TEMPLATE_DRIVER_ID}`).get();
  if (!templateSnap.exists) throw new Error('Livreur modèle introuvable — test interrompu sans modification.');
  const template = templateSnap.data();

  const driverRef = db.doc(`drivers/${DRIVER_ID}`);
  const docRef = db.doc(`partnerDocuments/${DOC_ID}`);
  const now = Timestamp.now();
  const today = parisDayPlus(0);
  const expiresAt = parisDayPlus(5); // dans la fenêtre J-7 (relance immédiate)

  await driverRef.set({
    ...template,
    firstName: 'Test',
    lastName: 'CdcRes11',
    displayName: 'Test CdcRes11',
    email: 'cdcres11-driver@golink.test',
    phone: '+33600000011',
    searchKeywords: ['test', 'cdcres11'],
    createdAt: now,
    updatedAt: now,
    test: true,
  });
  await docRef.set({
    ownerType: 'driver',
    ownerId: DRIVER_ID,
    type: 'insurance',
    status: 'approved',
    expiresAt,
    remindersSent: 0,
    lastReminderAt: null,
    createdAt: now,
    updatedAt: now,
    test: true,
  });

  try {
    const driverSnap = await driverRef.get();
    const docSnap = await docRef.get();
    const driver = { id: driverSnap.id, data: driverSnap.data() };
    const d = docSnap.data();

    const sent = await remindDriverDocumentExpiry(docSnap, d, driver, today);
    record('remindDriverDocumentExpiry signale une relance envoyée (dans la fenêtre J-7)', sent === true, `sent=${sent}`);

    const afterDoc = await docRef.get();
    record('remindersSent incrémenté sur le document (preuve que la relance a bien été traitée)', afterDoc.data().remindersSent === 2, `remindersSent=${afterDoc.data().remindersSent}`);

    const notifSnap = await db.collection('users').doc(DRIVER_ID).collection('notifications').where('category', '==', 'document').get();
    record('notification in-app écrite pour le livreur', notifSnap.size >= 1, `notifications=${notifSnap.size}`);

    // Deuxième appel immédiat : ne doit pas relancer une deuxième fois (remindersSent déjà à 2).
    const secondDocSnap = await docRef.get();
    const secondSent = await remindDriverDocumentExpiry(secondDocSnap, secondDocSnap.data(), driver, today);
    record('non-régression : pas de double relance le même jour (remindersSent déjà à 2)', secondSent === false, `sent=${secondSent}`);

    // Nettoyage des notifications de test.
    await Promise.all(notifSnap.docs.map((n) => n.ref.delete()));
  } finally {
    await docRef.delete().catch(() => {});
    await driverRef.delete().catch(() => {});
    const gone = !(await docRef.get()).exists && !(await driverRef.get()).exists;
    record('nettoyage : livreur et document jetables supprimés', gone);
  }
}

await main();
const ok = results.every((r) => r.ok);
console.log(`\n${results.filter((r) => r.ok).length}/${results.length} OK`);
process.exit(ok ? 0 : 1);
