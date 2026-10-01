// Test réel cdc-fix-residuals-24 (§6 Gestion des livreurs, « Documents ») : l'aperçu admin
// d'un justificatif livreur (Kbis/SIRET, URSSAF, assurance, permis, carte grise…) déposé depuis
// l'app livreur échouait systématiquement avec « Aperçu indisponible pour ce fichier ».
//
// Cause : `getDriverFile` (functions/src/admin/operations/drivers.ts) valide le chemin Storage
// reçu avec une expression régulière qui interdit tout `/` après `private/`
// (`^drivers\/[A-Za-z0-9_-]+\/private\/[^/]+$`), alors que le dépôt réel des justificatifs
// (apps/driver/src/lib/storage.ts::uploadPrivateDriverDocument, functions/src/drivers/
// documents.ts::uploadDriverDocument) écrit systématiquement sous un sous-dossier
// `private/documents/…` — exactement le même type de bug déjà trouvé et corrigé une fois pour le
// selfie d'identité (`cdc-fix-residuals-7`), resté non corrigé pour les justificatifs standards
// ajoutés ensuite (lot 3 app livreur, 30/09).
//
// Corrigé : la règle accepte désormais explicitement le sous-dossier `documents/` (toujours un
// seul niveau, toujours sous `private/`), sans élargir la validation à un chemin arbitraire.
//
// Appelle directement le handler déployé via `.run()`, sur un livreur et un fichier Storage
// entièrement jetables (chemin réel `drivers/{id}/private/documents/{type}-{ts}.{ext}`),
// supprimés après coup.
//
//   npx tsx scripts/tests/cdc-fix-residuals-24.flow.mjs
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const { CLI_CLIENT_ID, CLI_CLIENT_SECRET, PROJECT_ID, readCliRefreshToken } = await import('../gcp-token.mjs');
const adcPath = join(tmpdir(), `cdcres24-adc-${process.pid}.json`);
writeFileSync(adcPath, JSON.stringify({ type: 'authorized_user', client_id: CLI_CLIENT_ID, client_secret: CLI_CLIENT_SECRET, refresh_token: readCliRefreshToken() }));
process.env.GOOGLE_APPLICATION_CREDENTIALS = adcPath;
process.env.GOOGLE_CLOUD_PROJECT = PROJECT_ID;
process.env.GCLOUD_PROJECT = PROJECT_ID;
// `getDriverFile` appelle `storage.bucket()` sans nom explicite (correct dans la vraie Cloud
// Function, où l'environnement le fournit) : `FIREBASE_CONFIG` le fait résoudre correctement ici
// aussi, pour que `storage.bucket()` (dans le handler ET dans ce script) pointe sur le vrai bucket
// (nommé `*.firebasestorage.app`, pas le défaut `*.appspot.com` deviné sans cette variable).
process.env.FIREBASE_CONFIG = JSON.stringify({ projectId: PROJECT_ID, storageBucket: 'golink-9f16d.firebasestorage.app' });

const results = [];
const record = (name, ok, detail) => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'OK   ' : 'ÉCHEC'} ${name}${detail ? ` — ${detail}` : ''}`);
};

const TEMPLATE_DRIVER_ID = 'ops-applicant-03';
const DRIVER_ID = 'cdcres24-test-driver';
const ADMIN_UID = 'test-super-admin';
const STORAGE_PATH = `drivers/${DRIVER_ID}/private/documents/insurance-${Date.now()}.txt`;
const FILE_CONTENTS = 'Justificatif de test cdcres24 (contenu factice, non une vraie pièce).';

async function main() {
  const { db, storage, Timestamp } = await import('../../functions/src/lib/admin.ts');
  const { getDriverFile } = await import('../../functions/src/admin/operations/drivers.ts');

  const templateSnap = await db.doc(`drivers/${TEMPLATE_DRIVER_ID}`).get();
  if (!templateSnap.exists) throw new Error('Livreur modèle introuvable — test interrompu sans modification.');
  const template = templateSnap.data();

  const driverRef = db.doc(`drivers/${DRIVER_ID}`);
  const now = Timestamp.now();
  await driverRef.set({
    ...template,
    firstName: 'Test',
    lastName: 'CdcRes24',
    displayName: 'Test CdcRes24',
    email: 'cdcres24-driver@golink.test',
    phone: '+33600000024',
    searchKeywords: ['test', 'cdcres24'],
    createdAt: now,
    updatedAt: now,
    test: true,
  });

  const file = storage.bucket().file(STORAGE_PATH);
  await file.save(Buffer.from(FILE_CONTENTS), { contentType: 'text/plain' });

  try {
    const res = await getDriverFile.run({
      data: { path: STORAGE_PATH },
      auth: { uid: ADMIN_UID, token: { role: 'admin', adminRole: 'super_admin' } },
    });
    record('getDriverFile accepte le chemin avec sous-dossier « documents/ » — correctif attendu', !!res?.dataBase64, `name=${res?.name} contentType=${res?.contentType}`);
    const decoded = Buffer.from(res.dataBase64, 'base64').toString('utf8');
    record('le contenu renvoyé correspond bien au fichier déposé', decoded === FILE_CONTENTS, `reçu="${decoded}"`);

    const auditSnap = await db.collection('auditLogs').where('action', '==', 'driver.file_viewed').where('target.id', '==', DRIVER_ID).get();
    record('consultation tracée (audit driver.file_viewed, donnée personnelle sensible)', auditSnap.size >= 1, `audits=${auditSnap.size}`);

    // Non-régression : le chemin à plat du selfie (sans sous-dossier) continue de fonctionner.
    const selfiePath = `drivers/${DRIVER_ID}/private/selfie-${Date.now()}.txt`;
    const selfieFile = storage.bucket().file(selfiePath);
    await selfieFile.save(Buffer.from('selfie factice'), { contentType: 'text/plain' });
    try {
      const selfieRes = await getDriverFile.run({ data: { path: selfiePath }, auth: { uid: ADMIN_UID, token: { role: 'admin', adminRole: 'super_admin' } } });
      record('non-régression : chemin à plat (selfie) toujours accepté', !!selfieRes?.dataBase64);
    } finally {
      await selfieFile.delete().catch(() => {});
    }

    // Non-régression : un chemin hors périmètre (remontée de répertoire) reste refusé.
    try {
      await getDriverFile.run({ data: { path: `drivers/${DRIVER_ID}/private/../../secret.txt` }, auth: { uid: ADMIN_UID, token: { role: 'admin', adminRole: 'super_admin' } } });
      record('non-régression : chemin avec remontée de répertoire refusé', false, 'accepté à tort');
    } catch (error) {
      record('non-régression : chemin avec remontée de répertoire refusé', true, String(error.message ?? error));
    }
  } finally {
    await file.delete().catch(() => {});
    const auditSnap = await db.collection('auditLogs').where('action', '==', 'driver.file_viewed').where('target.id', '==', DRIVER_ID).get();
    await Promise.all(auditSnap.docs.map((d) => d.ref.delete()));
    await driverRef.delete().catch(() => {});
    const [stillThere] = await file.exists();
    const gone = !stillThere && !(await driverRef.get()).exists;
    record('nettoyage : fichier, livreur jetable et audits de test supprimés', gone);
  }
}

await main();
const ok = results.every((r) => r.ok);
console.log(`\n${results.filter((r) => r.ok).length}/${results.length} OK`);
process.exit(ok ? 0 : 1);
