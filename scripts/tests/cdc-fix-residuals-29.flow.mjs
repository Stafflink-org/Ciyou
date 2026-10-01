// Test réel cdc-fix-residuals-29 (§29 Légal/RGPD/conformité, « Signalements de contenus ») :
// `reportContent` (functions/src/platform/gdpr.ts), fonction déployée et atteignable par tout
// administrateur authentifié, écrivait un document `contentReports` au format
// `{ entityType, entityId, reason, status, createdAt, createdBy }` — un schéma qui ne correspond
// à RIEN de ce que lisent le reste du code (`decideContentReport`, `ReportsPage.tsx`) ni le
// modèle réel `ContentReport` (`packages/shared/src/models/support.ts`), qui attendent
// `targetType`/`targetPath`/`reporterId`/`reporterType`/`reason` (énumération stricte) et aucun
// `entityType`/`entityId`/`createdBy`. Conséquence réelle : un signalement créé par cette
// fonction n'a ni `targetType` ni `targetPath` — `decideContentReport` plante immédiatement sur
// `report.targetPath.startsWith(...)` (TypeError sur `undefined`) dès qu'un agent tente de le
// traiter.
//
// Corrigé : `reportContent` écrit désormais exactement le modèle `ContentReport`, sur le même
// patron que `reportReview` (seul autre producteur de `contentReports`).
//
// Test réel sur `golink-9f16d` : signalement réel d'un commerce existant (lecture seule, aucune
// mutation du commerce lui-même), vérification du document créé, puis traitement réel par
// `decideContentReport` (doit s'exécuter sans lever d'exception). Nettoyage complet après coup.
//
//   npx tsx scripts/tests/cdc-fix-residuals-29.flow.mjs
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const { CLI_CLIENT_ID, CLI_CLIENT_SECRET, PROJECT_ID, readCliRefreshToken } = await import('../gcp-token.mjs');
const adcPath = join(tmpdir(), `cdcres29-adc-${process.pid}.json`);
writeFileSync(adcPath, JSON.stringify({ type: 'authorized_user', client_id: CLI_CLIENT_ID, client_secret: CLI_CLIENT_SECRET, refresh_token: readCliRefreshToken() }));
process.env.GOOGLE_APPLICATION_CREDENTIALS = adcPath;
process.env.GOOGLE_CLOUD_PROJECT = PROJECT_ID;
process.env.GCLOUD_PROJECT = PROJECT_ID;

const results = [];
const record = (name, ok, detail) => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'OK   ' : 'ÉCHEC'} ${name}${detail ? ` — ${detail}` : ''}`);
};

const ADMIN_UID = 'test-super-admin';
const TARGET_RESTAURANT_ID = 'mina-kitchen'; // commerce réel existant, jamais modifié par ce test
const TARGET_PATH = `restaurants/${TARGET_RESTAURANT_ID}`;

async function main() {
  const { db } = await import('../../functions/src/lib/admin.ts');
  const { reportContent } = await import('../../functions/src/platform/gdpr.ts');
  const { decideContentReport } = await import('../../functions/src/admin/experience/reviews.ts');

  const adminAuth = { uid: ADMIN_UID, token: { role: 'admin', adminRole: 'super_admin' } };
  let reportId;

  try {
    const created = await reportContent.run({
      data: { targetType: 'restaurant', targetPath: TARGET_PATH, reason: 'other', details: 'Test réel cdc-fix-residuals-29 (sans conséquence, supprimé après coup)' },
      auth: adminAuth,
    });
    reportId = created?.reportId;
    record('reportContent accepte le nouveau schéma et retourne un reportId', !!reportId, JSON.stringify(created));

    const snap = await db.doc(`contentReports/${reportId}`).get();
    const data = snap.data();
    record(
      'le document créé porte bien targetType/targetPath (pas entityType/entityId) — correctif attendu',
      snap.exists && data.targetType === 'restaurant' && data.targetPath === TARGET_PATH && data.entityType === undefined && data.entityId === undefined,
      JSON.stringify(data),
    );
    record('reporterType posé à « system » (signalement par un administrateur)', data?.reporterType === 'system', `reporterType=${data?.reporterType}`);
    record('status initial « open »', data?.status === 'open', `status=${data?.status}`);

    // Traitement réel par decideContentReport : avant le correctif, `report.targetPath.startsWith`
    // levait une TypeError sur `undefined` ici — c'est précisément ce que ce test vérifie.
    let decideError = null;
    try {
      await decideContentReport.run({ data: { reportId, decision: 'no_action', reason: 'Test réel cdc-fix-residuals-29 : aucune action requise' }, auth: adminAuth });
    } catch (error) {
      decideError = error;
    }
    record('decideContentReport traite le signalement sans planter — correctif attendu', decideError === null, decideError ? `${decideError.name}: ${decideError.message}` : undefined);

    const afterDecision = (await db.doc(`contentReports/${reportId}`).get()).data();
    record('status passé à « dismissed » après la décision « no_action »', afterDecision?.status === 'dismissed', `status=${afterDecision?.status}`);
  } finally {
    if (reportId) {
      await db.doc(`contentReports/${reportId}`).delete().catch(() => {});
    }
    const auditSnap = await db.collection('auditLogs').where('action', 'in', ['content.reported', 'report.dismissed']).where('target.id', '==', reportId ?? TARGET_PATH).get();
    await Promise.all(auditSnap.docs.map((d) => d.ref.delete()));
    const gone = reportId ? !(await db.doc(`contentReports/${reportId}`).get()).exists : true;
    record('nettoyage : signalement de test et audits associés supprimés', gone);
  }
}

await main();
const ok = results.every((r) => r.ok);
console.log(`\n${results.filter((r) => r.ok).length}/${results.length} OK`);
process.exit(ok ? 0 : 1);
