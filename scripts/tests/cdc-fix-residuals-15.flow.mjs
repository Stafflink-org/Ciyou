// Test réel cdc-fix-residuals-15 (§13 Support et litiges, « Centre d'aide ») : les compteurs
// `views`/`helpfulYes`/`helpfulNo` de `helpArticles` n'avaient aucun producteur — les règles
// Firestore interdisent même à un admin de les écrire directement (`platform.rules`), seule une
// Cloud Function (SDK Admin) le peut, et aucune n'existait. Testé d'abord en direct dans le
// navigateur (back-office restaurant réel, article réel `aide-3`, compteurs restaurés après coup) ;
// ce script rejoue la vérification serveur pour une preuve reproductible.
//
//   npx tsx scripts/tests/cdc-fix-residuals-15.flow.mjs
import { writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const { CLI_CLIENT_ID, CLI_CLIENT_SECRET, PROJECT_ID, readCliRefreshToken } = await import('../gcp-token.mjs');
const adcPath = join(tmpdir(), `cdcres15-adc-${process.pid}.json`);
writeFileSync(adcPath, JSON.stringify({ type: 'authorized_user', client_id: CLI_CLIENT_ID, client_secret: CLI_CLIENT_SECRET, refresh_token: readCliRefreshToken() }));
process.env.GOOGLE_APPLICATION_CREDENTIALS = adcPath;
process.env.GOOGLE_CLOUD_PROJECT = PROJECT_ID;
process.env.GCLOUD_PROJECT = PROJECT_ID;

const results = [];
const record = (name, ok, detail) => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'OK   ' : 'ÉCHEC'} ${name}${detail ? ` — ${detail}` : ''}`);
};

const ARTICLE_ID = 'aide-3';
const MANAGER_UID = 'test-manager-mina';

async function main() {
  const { db } = await import('../../functions/src/lib/admin.ts');
  const { recordHelpArticleFeedback } = await import('../../functions/src/messaging/restaurant/support.ts');

  const ref = db.doc(`helpArticles/${ARTICLE_ID}`);
  const before = (await ref.get()).data();
  const request = (action) => ({ data: { articleId: ARTICLE_ID, action }, auth: { uid: MANAGER_UID, token: {} } });

  try {
    await recordHelpArticleFeedback.run(request('view'));
    const afterView = (await ref.get()).data();
    record('views incrémenté de 1', afterView.views === before.views + 1, `avant=${before.views} après=${afterView.views}`);

    await recordHelpArticleFeedback.run(request('helpful_no'));
    const afterNo = (await ref.get()).data();
    record('helpfulNo incrémenté de 1', afterNo.helpfulNo === before.helpfulNo + 1, `avant=${before.helpfulNo} après=${afterNo.helpfulNo}`);

    let unpublishedErr = null;
    try {
      await recordHelpArticleFeedback.run({ data: { articleId: 'article-inexistant-cdcres15', action: 'view' }, auth: { uid: MANAGER_UID, token: {} } });
    } catch (e) {
      unpublishedErr = e;
    }
    record('article inexistant rejeté', Boolean(unpublishedErr), unpublishedErr ? String(unpublishedErr.message || unpublishedErr) : 'aucune erreur levée');
  } finally {
    await ref.update({ views: before.views, helpfulYes: before.helpfulYes, helpfulNo: before.helpfulNo });
    const restored = (await ref.get()).data();
    const ok = restored.views === before.views && restored.helpfulYes === before.helpfulYes && restored.helpfulNo === before.helpfulNo;
    record('nettoyage : compteurs restaurés à leur valeur d’origine', ok, `views=${restored.views} yes=${restored.helpfulYes} no=${restored.helpfulNo}`);
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
