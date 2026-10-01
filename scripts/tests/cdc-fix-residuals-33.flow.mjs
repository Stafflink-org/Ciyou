// Test réel cdc-fix-residuals-33 (§5 Fiche restaurant, « Voir comme le restaurant ») : une
// session d'impersonation arrivée à expiration (`expiresAt` dépassé) restait ouverte
// (`endedAt: null`) indéfiniment si l'administrateur fermait simplement son onglet au lieu de
// cliquer sur « Terminer » — aucune tâche planifiée ne la refermait, alors que la bannière
// affichée au restaurant promet un accès « tracé au journal d'audit » et limité dans le temps.
//
// Corrigé : `runImpersonationExpiryCheck` (functions/src/admin/acteurs/impersonation.ts)
// referme toute session dont `expiresAt <= now` et `endedAt == null`, avec une entrée d'audit
// (`restaurant.impersonation_ended`, `after.auto: true`, acteur système) — exposée en tâche
// planifiée `closeExpiredImpersonations` (toutes les 15 min) et testée ici directement. Nouvel
// index composite Firestore `impersonationSessions` (endedAt + expiresAt) ajouté et déployé.
//
// Test réel sur `golink-9f16d` : une session jetable déjà expirée doit être refermée (et
// auditée) par la fonction ; une session jetable non expirée doit rester intacte (non-
// régression). Nettoyage complet après coup.
//
//   npx tsx scripts/tests/cdc-fix-residuals-33.flow.mjs
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Timestamp } from '@google-cloud/firestore';
import { db } from '../lib/admin.mjs';
import { CLI_CLIENT_ID, CLI_CLIENT_SECRET, PROJECT_ID, readCliRefreshToken } from '../gcp-token.mjs';

const adcPath = join(tmpdir(), `cdcres33-adc-${process.pid}.json`);
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

const EXPIRED_ID = 'cdcres33-expired';
const ACTIVE_ID = 'cdcres33-active';

async function findAudits() {
  // Pas d'index dedie pour ce tri ponctuel (meme motif que cdc-fix-residuals-3/29) : filtre
  // par action seule (limite large), puis par sessionId cote client.
  const snap = await db.collection('auditLogs').where('action', '==', 'restaurant.impersonation_ended').limit(500).get();
  return snap.docs.map((d) => d.data()).filter((a) => a.after?.sessionId === EXPIRED_ID || a.after?.sessionId === ACTIVE_ID);
}

async function main() {
  const now = Timestamp.now();
  const past = Timestamp.fromMillis(now.toMillis() - 10 * 60_000);
  const startedAt = Timestamp.fromMillis(now.toMillis() - 40 * 60_000);
  const future = Timestamp.fromMillis(now.toMillis() + 20 * 60_000);

  await db.doc(`impersonationSessions/${EXPIRED_ID}`).set({
    adminId: 'cdcres33-admin', restaurantId: 'mina-kitchen', mode: 'read_only', reason: 'Test cdcres33 (expiree)', startedAt, expiresAt: past, endedAt: null, actionsCount: 0, adminName: 'CDCRES33 Admin', restaurantName: 'Mina Kitchen', cityId: 'longwy', endedBy: null,
  });
  await db.doc(`impersonationSessions/${ACTIVE_ID}`).set({
    adminId: 'cdcres33-admin', restaurantId: 'mina-kitchen', mode: 'read_only', reason: 'Test cdcres33 (active)', startedAt, expiresAt: future, endedAt: null, actionsCount: 0, adminName: 'CDCRES33 Admin', restaurantName: 'Mina Kitchen', cityId: 'longwy', endedBy: null,
  });

  const { runImpersonationExpiryCheck } = await import('../../functions/src/admin/acteurs/impersonation.ts');
  const report = await runImpersonationExpiryCheck();
  check('runImpersonationExpiryCheck renvoie au moins une session fermee', report.closed >= 1, JSON.stringify(report));

  const expired = (await db.doc(`impersonationSessions/${EXPIRED_ID}`).get()).data();
  check('session expiree refermee automatiquement (correctif attendu)', expired?.endedAt != null, JSON.stringify({ endedAt: expired?.endedAt, endedBy: expired?.endedBy }));
  check('session expiree : endedBy = system', expired?.endedBy === 'system', `endedBy=${expired?.endedBy}`);

  const active = (await db.doc(`impersonationSessions/${ACTIVE_ID}`).get()).data();
  check('session active non touchee (non-regression)', active?.endedAt == null, JSON.stringify({ endedAt: active?.endedAt }));

  const audits = await findAudits();
  const audit = audits.find((a) => a.after?.sessionId === EXPIRED_ID);
  check('audit ecrit pour la fermeture automatique', Boolean(audit), JSON.stringify(audit ?? null));
  check('audit marque auto:true, acteur systeme', audit?.after?.auto === true && audit?.actor?.type === 'system', JSON.stringify({ after: audit?.after, actor: audit?.actor }));

  const report2 = await runImpersonationExpiryCheck();
  const auditsAfter = await findAudits();
  check('relance : pas de double traitement ni de doublon d audit', auditsAfter.length === 1, `audits=${auditsAfter.length} report2.closed=${report2.closed}`);
}

async function cleanup() {
  await db.doc(`impersonationSessions/${EXPIRED_ID}`).delete().catch(() => {});
  await db.doc(`impersonationSessions/${ACTIVE_ID}`).delete().catch(() => {});
  const snap = await db.collection('auditLogs').where('action', '==', 'restaurant.impersonation_ended').limit(500).get();
  const toDelete = snap.docs.filter((d) => {
    const a = d.data();
    return a.after?.sessionId === EXPIRED_ID || a.after?.sessionId === ACTIVE_ID;
  });
  await Promise.all(toDelete.map((d) => d.ref.delete()));
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
