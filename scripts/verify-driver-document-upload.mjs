/**
 * Vérification réelle ponctuelle de uploadDriverDocument (mission driver-lot3) :
 * l'UI (expo-document-picker) ouvre une boîte de dialogue OS que l'automatisation
 * du navigateur ne peut pas piloter (pas d'outil de dépôt de fichier disponible
 * pour le navigateur intégré) — ce script exerce donc le même chemin réel
 * (upload Storage puis appel de la Cloud Function) avec le compte de test réel,
 * pour vérifier bout en bout la partie serveur que l'UI ne pouvait pas exercer.
 * Restaure le mot de passe du compte de test après usage (comme pour les tests
 * REST précédents du lot 2).
 *
 * Usage : node scripts/verify-driver-document-upload.mjs --apply
 */
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { auth, bucket, db, PROJECT_ID } from './lib/admin.mjs';

const TEST_DRIVER_UID = 'test-driver-lot1';
const TEST_DRIVER_EMAIL = 'driver.lot1@golink.test';
const FIREBASE_REGION = 'europe-west1';

const apply = process.argv.includes('--apply');
const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const API_KEY = /apiKey:\s*'([^']+)'/.exec(readFileSync(`${repoRoot}/apps/client/src/lib/firebase.ts`, 'utf8'))?.[1] ?? '';
const CREDENTIALS_FILE = `${repoRoot}/.test-accounts.local.md`;

function storedPassword() {
  if (!existsSync(CREDENTIALS_FILE)) return null;
  const match = readFileSync(CREDENTIALS_FILE, 'utf8').match(new RegExp('`' + TEST_DRIVER_EMAIL + '`\\s*\\|\\s*`([^`]+)`'));
  return match?.[1] ?? null;
}

async function signIn(uid, email) {
  const password = `${randomBytes(18).toString('base64url')}Aa1`;
  await auth.updateUser(uid, { password });
  const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${API_KEY}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  });
  const body = await res.json();
  if (!body.idToken) throw new Error(`Connexion impossible (${email}) : ${body.error?.message ?? res.status}`);
  return body.idToken;
}

async function callFn(name, token, data) {
  const res = await fetch(`https://${FIREBASE_REGION}-${PROJECT_ID}.cloudfunctions.net/${name}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ data }),
  });
  const body = await res.json().catch(() => ({}));
  if (body.error || !res.ok) throw new Error(`${name} : ${JSON.stringify(body.error ?? res.status)}`);
  return body.result;
}

async function main() {
  console.log(`Compte testé : ${TEST_DRIVER_EMAIL} (${TEST_DRIVER_UID})`);
  if (!apply) {
    console.log('Aperçu seulement (--apply pour exécuter réellement).');
    return;
  }

  const originalPassword = storedPassword();
  const idToken = await signIn(TEST_DRIVER_UID, TEST_DRIVER_EMAIL);
  console.log('Connexion réelle OK (idToken obtenu).');

  // 1) Dépôt réel du fichier dans Storage, au chemin attendu par la fonction.
  const fileName = `identity-verif-${Date.now()}.pdf`;
  const storagePath = `drivers/${TEST_DRIVER_UID}/private/documents/${fileName}`;
  const tinyPdf = Buffer.from('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF', 'binary');
  await bucket.file(storagePath).save(tinyPdf, { contentType: 'application/pdf' });
  console.log(`Fichier réel déposé dans Storage : ${storagePath}`);

  // 2) Appel réel de la Cloud Function (même charge utile que ProfileSettingsScreen.tsx).
  const result = await callFn('uploadDriverDocument', idToken, {
    driverId: TEST_DRIVER_UID,
    type: 'identity',
    storagePath,
    fileName,
    number: null,
    issuedAt: null,
    expiresAt: null,
  });
  console.log('uploadDriverDocument OK :', result);

  // 3) Vérification réelle en base (le document existe, statut pending).
  const docSnap = await db.collection('partnerDocuments').doc(result.documentId).get();
  if (!docSnap.exists) throw new Error('Document introuvable après création.');
  const doc = docSnap.data();
  console.log('Document Firestore réel :', { ownerType: doc.ownerType, ownerId: doc.ownerId, type: doc.type, status: doc.status, path: doc.file?.path });
  if (doc.ownerType !== 'driver' || doc.ownerId !== TEST_DRIVER_UID || doc.status !== 'pending') {
    throw new Error('Contenu du document inattendu.');
  }

  // 4) Doublon refusé (même storagePath) — vérifie le contrôle serveur.
  try {
    await callFn('uploadDriverDocument', idToken, {
      driverId: TEST_DRIVER_UID,
      type: 'identity',
      storagePath,
      fileName,
      number: null,
      issuedAt: null,
      expiresAt: null,
    });
    throw new Error('Le doublon aurait dû être refusé.');
  } catch (err) {
    if (!String(err.message).includes('déjà été enregistré') && !String(err.message).includes('already-exists')) throw err;
    console.log('Doublon correctement refusé par le serveur.');
  }

  // Nettoyage : ne laisse pas un faux justificatif « pending » sur le compte de test.
  await docSnap.ref.delete();
  await bucket.file(storagePath).delete().catch(() => undefined);
  console.log('Nettoyage effectué (document et fichier de test supprimés).');

  if (originalPassword) {
    await auth.updateUser(TEST_DRIVER_UID, { password: originalPassword });
    console.log('Mot de passe du compte de test restauré.');
  }
  console.log('OK : vérification réelle terminée avec succès.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
