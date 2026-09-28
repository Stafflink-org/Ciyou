// Contrôle réel des Cloud Functions de la traduction automatique (Azure Translator,
// cahier « translation-azure ») : écran, chiffrement de la clé, masquage, permissions,
// comportement « non configuré », cache, plafond de débit — sans clé Azure valide (le
// client la fournira lui-même). Nettoie ses propres écritures à la fin.
//
// Usage : node scripts/tests/translation-azure.flow.mjs
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deleteApp, initializeApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { db } from '../lib/admin.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const accounts = readFileSync(join(root, '.test-accounts.local.md'), 'utf8');
const passwordOf = (email) => [...accounts.matchAll(/\|\s*`([^`]+)`\s*\|\s*`([^`]+)`\s*\|/g)].find((m) => m[1] === email)?.[2];

const config = {
  apiKey: 'AIzaSyAYQ_TzyCEK0_Iw5TnSiH8jbFbOFKZYNoM',
  authDomain: 'golink-9f16d.firebaseapp.com',
  projectId: 'golink-9f16d',
  storageBucket: 'golink-9f16d.firebasestorage.app',
  appId: '1:683198090102:web:3640bfa24dd0d325910857',
};

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'OK ' : 'ÉCHEC'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

async function session(email) {
  const app = initializeApp(config, `${email}-${Date.now()}`);
  const auth = getAuth(app);
  await signInWithEmailAndPassword(auth, email, passwordOf(email));
  const functions = getFunctions(app, 'europe-west1');
  return {
    uid: auth.currentUser.uid,
    call: (name, data) => httpsCallable(functions, name)(data).then((r) => r.data),
    close: async () => { await signOut(auth); await deleteApp(app); },
  };
}

async function expectError(name, promise, code) {
  try {
    await promise;
    check(name, false, 'accepté alors qu’un refus était attendu');
  } catch (error) {
    const got = String(error.code ?? '').replace('functions/', '');
    check(name, got === code, `${got} : ${error.message}`);
  }
}

function hashOf(from, to, text) {
  return createHash('sha256').update(`${from}:${to}:${text}`).digest('hex');
}

const SETTINGS_REF = db.collection('settings').doc('translator');
const SECRET_REF = db.collection('translatorSecrets').doc('config');

async function snapshotBefore() {
  const [settings, secret] = await Promise.all([SETTINGS_REF.get(), SECRET_REF.get()]);
  return { settings: settings.exists ? settings.data() : null, secret: secret.exists ? secret.data() : null };
}

async function main() {
  const before = await snapshotBefore();
  const superadmin = await session('superadmin@golink.test');
  const support = await session('support@golink.test');
  const seededCacheKeys = [];

  try {
    // ---------------------------------------------------------------- Permissions
    await expectError(
      'Support : refusé sur saveTranslatorSettings (droit settings.edit requis)',
      support.call('saveTranslatorSettings', { apiKey: '', region: 'francecentral', endpoint: 'https://api.cognitive.microsofttranslator.com', enabled: false, activeLocales: ['fr', 'en'], monthlyCharacterCap: 0, reason: 'tentative refusée' }),
      'permission-denied',
    );

    // ---------------------------------------------------------------- Enregistrement + chiffrement + masquage
    const fakeKey = `test-azure-key-${Date.now()}`;
    const saveResult = await superadmin.call('saveTranslatorSettings', {
      apiKey: fakeKey,
      region: 'francecentral',
      endpoint: 'https://api.cognitive.microsofttranslator.com',
      enabled: true,
      activeLocales: ['fr', 'en', 'ar'],
      monthlyCharacterCap: 5000,
      reason: 'test réel translation-azure (nettoyé automatiquement)',
    });
    check('saveTranslatorSettings : configured=true', saveResult.configured === true);
    check('saveTranslatorSettings : keyLast4 masqué (4 caractères)', saveResult.keyLast4 === fakeKey.slice(-4), saveResult.keyLast4);

    const secretSnap = await SECRET_REF.get();
    const secretData = secretSnap.data();
    check('Clé chiffrée en base (jamais en clair)', typeof secretData?.keyEnc === 'string' && !secretData.keyEnc.includes(fakeKey), 'keyEnc ne contient pas la clé en clair');
    check('Clé chiffrée au format iv.tag.texte (AES-256-GCM, comme le TOTP)', (secretData?.keyEnc.match(/\./g) ?? []).length === 2);

    const settingsSnap = await SETTINGS_REF.get();
    const settingsData = settingsSnap.data();
    check('settings/translator ne porte jamais la clé', !('apiKey' in settingsData) && !JSON.stringify(settingsData).includes(fakeKey));
    check('settings/translator : région et endpoint publics présents', settingsData.region === 'francecentral' && settingsData.endpoint.includes('cognitive.microsofttranslator.com'));

    // ---------------------------------------------------------------- Test de connexion (clé invalide : échec propre attendu)
    const testResult = await superadmin.call('testTranslatorConnection', {});
    check('testTranslatorConnection avec clé invalide : ok=false + message clair', testResult.ok === false && typeof testResult.error === 'string' && testResult.error.length > 0, testResult.error);

    // ---------------------------------------------------------------- Cache : évite un appel Azure réel pour un texte déjà traduit
    const cacheText = `Texte de test cache ${Date.now()}`;
    const hash = hashOf('fr', 'en', cacheText);
    seededCacheKeys.push(hash);
    await db.collection('translations').doc(hash).set({ sourceText: cacheText, from: 'fr', to: 'en', translated: 'Cached test text', createdAt: new Date() });
    const cached = await superadmin.call('translateTexts', { texts: [cacheText], from: 'fr', to: ['en'] });
    check('translateTexts : lit le cache sans appeler Azure', cached.translations.en?.[0] === 'Cached test text', JSON.stringify(cached.translations));

    // ---------------------------------------------------------------- Langue non activée
    await expectError('translateTexts : langue non activée refusée', superadmin.call('translateTexts', { texts: ['Bonjour'], from: 'fr', to: ['de'] }), 'invalid-argument');

    // ---------------------------------------------------------------- Échec Azure réel (clé invalide) : statut « erreur », jamais d'écran cassé côté appelant
    const freshText = `Texte jamais traduit ${Date.now()}`;
    await expectError('translateTexts : clé invalide → erreur métier claire (unavailable)', superadmin.call('translateTexts', { texts: [freshText], from: 'fr', to: ['en'] }), 'unavailable');
    const afterFailure = (await SETTINGS_REF.get()).data();
    check('Statut repassé à « error » après un échec Azure réel', afterFailure.status === 'error' && Boolean(afterFailure.lastError));

    // ---------------------------------------------------------------- Non configuré : désactivation
    await superadmin.call('saveTranslatorSettings', { apiKey: '', region: 'francecentral', endpoint: 'https://api.cognitive.microsofttranslator.com', enabled: false, activeLocales: ['fr', 'en', 'ar'], monthlyCharacterCap: 5000, reason: 'test réel : désactivation temporaire' });
    await expectError('translateTexts : non configurée → erreur métier claire (failed-precondition)', superadmin.call('translateTexts', { texts: ['Bonjour'], from: 'fr', to: ['en'] }), 'failed-precondition');

    // ---------------------------------------------------------------- Débit : plafond par utilisateur
    await superadmin.call('saveTranslatorSettings', { apiKey: '', region: 'francecentral', endpoint: 'https://api.cognitive.microsofttranslator.com', enabled: true, activeLocales: ['fr', 'en', 'ar'], monthlyCharacterCap: 5000, reason: 'test réel : réactivation pour le test de débit' });
    let limited = false;
    for (let i = 0; i < 45 && !limited; i++) {
      try {
        await superadmin.call('translateTexts', { texts: [cacheText], from: 'fr', to: ['en'] });
      } catch (error) {
        limited = String(error.code ?? '').includes('failed-precondition');
      }
    }
    check('translateTexts : plafond de débit par utilisateur appliqué', limited);
  } finally {
    // ------------------------------------------------------------------ Nettoyage
    if (before.settings) await SETTINGS_REF.set(before.settings);
    else await SETTINGS_REF.delete().catch(() => undefined);
    if (before.secret) await SECRET_REF.set(before.secret);
    else await SECRET_REF.delete().catch(() => undefined);
    for (const hash of seededCacheKeys) await db.collection('translations').doc(hash).delete().catch(() => undefined);
    await db.collection('translations').doc('_rate_limits').collection('byUser').doc(superadmin.uid).delete().catch(() => undefined);
    await superadmin.close();
    await support.close();
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} vérifications OK`);
  if (failed.length) {
    console.log('Échecs :', failed.map((f) => f.name).join(', '));
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
