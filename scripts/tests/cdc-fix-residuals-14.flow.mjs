// Test réel cdc-fix-residuals-14 (§12 Avis et notes, « Réponses des restaurants ») :
// `replyToReview` (functions/src/messaging/restaurant/reviews.ts) vérifiait les coordonnées de
// contact dans la réponse d'un commerce (`containsContactDetails`), mais ne la passait JAMAIS par
// le filtre de modération automatique (`scanReviewText`) appliqué à l'avis lui-même — la réponse
// est une mise à jour du document `reviews/{orderId}`, pas une création, donc le trigger
// `onReviewCreated` ne se redéclenche pas. Un commerce pouvait donc publier une insulte, un propos
// haineux ou une menace en réponse publique à un client sans aucun contrôle automatique.
//
// Corrigé : `replyToReview` passe désormais le texte par le même filtre (`moderationRules()` +
// `scanReviewText`, exportée depuis `admin/experience/reviews.ts`) et rejette immédiatement la
// réponse si elle est bloquée (comme pour les coordonnées de contact, sans nouvel état de
// workflow).
//
// Appelle directement le handler déployé via `.run()` (même patron que les tests précédents), sur
// un avis réel de mina-kitchen sans réponse (o-10007), avec le compte réel de la responsable
// (sofia.martin@golink.test, permission reviews.reply) — réponse de test retirée après coup.
//
//   npx tsx scripts/tests/cdc-fix-residuals-14.flow.mjs
import { writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const { CLI_CLIENT_ID, CLI_CLIENT_SECRET, PROJECT_ID, readCliRefreshToken } = await import('../gcp-token.mjs');
const adcPath = join(tmpdir(), `cdcres14-adc-${process.pid}.json`);
writeFileSync(adcPath, JSON.stringify({ type: 'authorized_user', client_id: CLI_CLIENT_ID, client_secret: CLI_CLIENT_SECRET, refresh_token: readCliRefreshToken() }));
process.env.GOOGLE_APPLICATION_CREDENTIALS = adcPath;
process.env.GOOGLE_CLOUD_PROJECT = PROJECT_ID;
process.env.GCLOUD_PROJECT = PROJECT_ID;

const results = [];
const record = (name, ok, detail) => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'OK   ' : 'ÉCHEC'} ${name}${detail ? ` — ${detail}` : ''}`);
};

const ORDER_ID = 'o-10007';
const MANAGER_UID = 'test-manager-mina';

async function main() {
  const { db } = await import('../../functions/src/lib/admin.ts');
  const { replyToReview } = await import('../../functions/src/messaging/restaurant/reviews.ts');

  const ref = db.doc(`reviews/${ORDER_ID}`);
  const before = (await ref.get()).data();
  if (before?.reply) throw new Error(`L'avis ${ORDER_ID} a déjà une réponse — choisir un autre avis de test pour ne pas l'écraser.`);

  const request = (text) => ({ data: { orderId: ORDER_ID, text, templateId: null }, auth: { uid: MANAGER_UID, token: {} } });

  try {
    // 1. Texte avec un terme du filtre par défaut (catégorie insulte, action "block") : doit être rejeté.
    let blockedErr = null;
    try {
      await replyToReview.run(request('Vous êtes vraiment un connard de laisser un avis pareil.'));
    } catch (e) {
      blockedErr = e;
    }
    record('réponse contenant une insulte REJETÉE', Boolean(blockedErr), blockedErr ? String(blockedErr.message || blockedErr) : 'aucune erreur levée');

    const afterBlocked = (await ref.get()).data();
    record('aucune réponse publiée après le rejet (reply toujours null)', afterBlocked.reply == null, `reply=${JSON.stringify(afterBlocked.reply)}`);

    // 2. Texte neutre : doit toujours être publié normalement (non-régression).
    const okResult = await replyToReview.run(request('Merci pour votre retour, nous en tenons compte pour nous améliorer.'));
    record('réponse neutre acceptée (non régressé)', Boolean(okResult), JSON.stringify(okResult));

    const afterOk = (await ref.get()).data();
    record('réponse neutre bien publiée en base', afterOk.reply?.status === 'published' && afterOk.reply?.text?.includes('Merci pour votre retour'), JSON.stringify(afterOk.reply));
  } finally {
    await ref.update({ reply: before?.reply ?? null, updatedAt: before?.updatedAt ?? new Date() });
    const restored = (await ref.get()).data();
    record('nettoyage : avis restauré à son état d’origine (sans réponse)', restored.reply == null, `reply=${JSON.stringify(restored.reply)}`);
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
