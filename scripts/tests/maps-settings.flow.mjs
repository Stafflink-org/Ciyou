// Contrôle réel des Cloud Functions de la cartographie (Google Maps, tâche « maps-settings ») :
// écran, chiffrement des deux clés (web + mobile), masquage, permissions, distribution
// publique de la clé web (getPublicRuntimeConfig, jamais la mobile), débit, comportement
// « non configurée ». Sans clé Google valide (le client la fournira lui-même via le seed
// dédié). Nettoie ses propres écritures à la fin.
//
// Usage : node scripts/tests/maps-settings.flow.mjs
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
  const app = initializeApp(config, `${email}-${Date.now()}-${Math.random()}`);
  const auth = getAuth(app);
  if (email) await signInWithEmailAndPassword(auth, email, passwordOf(email));
  const functions = getFunctions(app, 'europe-west1');
  return {
    uid: auth.currentUser?.uid ?? null,
    call: (name, data) => httpsCallable(functions, name)(data).then((r) => r.data),
    close: async () => { await signOut(auth).catch(() => undefined); await deleteApp(app); },
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

const SETTINGS_REF = db.collection('settings').doc('maps');
const SECRET_REF = db.collection('mapsSecrets').doc('config');

async function snapshotBefore() {
  const [settings, secret] = await Promise.all([SETTINGS_REF.get(), SECRET_REF.get()]);
  return { settings: settings.exists ? settings.data() : null, secret: secret.exists ? secret.data() : null };
}

async function main() {
  const before = await snapshotBefore();
  const superadmin = await session('superadmin@golink.test');
  const support = await session('support@golink.test');
  const anonymous = await session(null);

  try {
    // ---------------------------------------------------------------- Permissions
    await expectError(
      'Support : refusé sur saveMapsSettings (droit settings.edit requis)',
      support.call('saveMapsSettings', { webApiKey: '', mobileApiKey: '', allowedWebReferrers: [], allowedMobileIdentifiers: [], reason: 'tentative refusée' }),
      'permission-denied',
    );

    // ---------------------------------------------------------------- Enregistrement + chiffrement + masquage (2 clés)
    const fakeWebKey = `test-maps-web-key-${Date.now()}`;
    const fakeMobileKey = `test-maps-mobile-key-${Date.now()}`;
    const saveResult = await superadmin.call('saveMapsSettings', {
      webApiKey: fakeWebKey,
      mobileApiKey: fakeMobileKey,
      allowedWebReferrers: ['http://localhost:*/*'],
      allowedMobileIdentifiers: ['AA:BB:CC (test)'],
      reason: 'test réel maps-settings (nettoyé automatiquement)',
    });
    check('saveMapsSettings : configuredWeb=true', saveResult.configuredWeb === true);
    check('saveMapsSettings : configuredMobile=true', saveResult.configuredMobile === true);
    check('saveMapsSettings : webKeyLast4 masqué (4 caractères)', saveResult.webKeyLast4 === fakeWebKey.slice(-4), saveResult.webKeyLast4);
    check('saveMapsSettings : mobileKeyLast4 masqué (4 caractères)', saveResult.mobileKeyLast4 === fakeMobileKey.slice(-4), saveResult.mobileKeyLast4);

    const secretSnap = await SECRET_REF.get();
    const secretData = secretSnap.data();
    check('Clé web chiffrée en base (jamais en clair)', typeof secretData?.webKeyEnc === 'string' && !secretData.webKeyEnc.includes(fakeWebKey));
    check('Clé mobile chiffrée en base (jamais en clair)', typeof secretData?.mobileKeyEnc === 'string' && !secretData.mobileKeyEnc.includes(fakeMobileKey));
    check('Clés chiffrées au format iv.tag.texte (AES-256-GCM, comme le TOTP)', (secretData?.webKeyEnc.match(/\./g) ?? []).length === 2 && (secretData?.mobileKeyEnc.match(/\./g) ?? []).length === 2);

    const settingsData = (await SETTINGS_REF.get()).data();
    check('settings/maps ne porte jamais les clés', !('webApiKey' in settingsData) && !('mobileApiKey' in settingsData) && !JSON.stringify(settingsData).includes(fakeWebKey) && !JSON.stringify(settingsData).includes(fakeMobileKey));
    check('settings/maps : référents et identifiants publics présents', Array.isArray(settingsData.allowedWebReferrers) && settingsData.allowedWebReferrers.includes('http://localhost:*/*'));

    // ---------------------------------------------------------------- Test de connexion (clé invalide : échec propre attendu)
    const testWeb = await superadmin.call('testMapsConnection', { which: 'web' });
    check('testMapsConnection (web, clé invalide) : ok=false + message clair', testWeb.ok === false && typeof testWeb.error === 'string' && testWeb.error.length > 0, testWeb.error);
    const testMobile = await superadmin.call('testMapsConnection', { which: 'mobile' });
    check('testMapsConnection (mobile, clé invalide) : ok=false + message clair', testMobile.ok === false && typeof testMobile.error === 'string', testMobile.error);

    // ---------------------------------------------------------------- Distribution publique : jamais authentifié, jamais la clé mobile
    const publicConfig = await anonymous.call('getPublicRuntimeConfig', {});
    check('getPublicRuntimeConfig : accessible sans authentification', true);
    check('getPublicRuntimeConfig : renvoie la clé web enregistrée', publicConfig.googleMapsWebKey === fakeWebKey, publicConfig.googleMapsWebKey);
    check('getPublicRuntimeConfig : mapsConfigured=true', publicConfig.mapsConfigured === true);
    check('getPublicRuntimeConfig : ne renvoie jamais la clé mobile', !JSON.stringify(publicConfig).includes(fakeMobileKey));

    // ---------------------------------------------------------------- Non configuré : repli honnête
    await superadmin.call('saveMapsSettings', { webApiKey: '', mobileApiKey: '', allowedWebReferrers: [], allowedMobileIdentifiers: [], reason: 'test réel : reset temporaire (clé conservée en base, non retestée)' });
    // Le save sans clé fournie conserve la clé déjà enregistrée (comportement voulu, comme translator) :
    // on force donc un état non configuré en supprimant directement le secret pour ce test.
    const savedSecret = (await SECRET_REF.get()).data();
    await SECRET_REF.delete();
    await SETTINGS_REF.set({ configuredWeb: false, webKeyLast4: null }, { merge: true });
    const publicConfigEmpty = await anonymous.call('getPublicRuntimeConfig', {});
    check('getPublicRuntimeConfig : googleMapsWebKey=null quand non configurée', publicConfigEmpty.googleMapsWebKey === null);
    check('getPublicRuntimeConfig : mapsConfigured=false quand non configurée', publicConfigEmpty.mapsConfigured === false);
    // Restauration de la clé de test pour la suite (débit) sans repasser par saveMapsSettings.
    await SECRET_REF.set(savedSecret, { merge: true });
    await SETTINGS_REF.set({ configuredWeb: true, webKeyLast4: fakeWebKey.slice(-4) }, { merge: true });

    // ---------------------------------------------------------------- Débit : plafond par adresse IP (endpoint public)
    let limited = false;
    for (let i = 0; i < 65 && !limited; i++) {
      try {
        await anonymous.call('getPublicRuntimeConfig', {});
      } catch (error) {
        limited = String(error.code ?? '').includes('failed-precondition');
      }
    }
    check('getPublicRuntimeConfig : plafond de débit appliqué', limited);
  } finally {
    // ------------------------------------------------------------------ Nettoyage
    if (before.settings) await SETTINGS_REF.set(before.settings);
    else await SETTINGS_REF.delete().catch(() => undefined);
    if (before.secret) await SECRET_REF.set(before.secret);
    else await SECRET_REF.delete().catch(() => undefined);
    await db.collection('mapsSecrets').doc('_rate_limits').collection('byKey').get().then((snap) => Promise.all(snap.docs.map((d) => d.ref.delete()))).catch(() => undefined);
    await superadmin.close();
    await support.close();
    await anonymous.close();
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
