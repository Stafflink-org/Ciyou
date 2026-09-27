// Amorçage de la cartographie (tâche « maps-settings ») : copie UNE FOIS en base la clé
// Google Maps déjà connue localement (`.env.local`, `VITE_GOOGLE_MAPS_API_KEY`, créée par
// scripts/gcp-token.mjs), en passant par le même chemin que l'écran super admin
// (Cloud Function `saveMapsSettings`, chiffrement, historique, audit) — jamais une
// écriture directe en base qui contournerait le chiffrement.
//
// N'écrit JAMAIS la clé en clair dans un fichier suivi par git : elle est lue depuis
// `.env.local` à l'exécution et transmise directement au serveur.
//
// Usage :
//   npx tsx scripts/seed/only/maps-settings.ts             (amorce si non configurée)
//   npx tsx scripts/seed/only/maps-settings.ts --force     (réécrit même si déjà configurée)
//   npx tsx scripts/seed/only/maps-settings.ts --dry-run   (n'appelle rien, affiche ce qui serait fait)
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { initializeApp, deleteApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { db } from '../../lib/admin.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const FORCE = process.argv.includes('--force');
const DRY_RUN = process.argv.includes('--dry-run');

function readDotEnv(path: string): Record<string, string> {
  if (!existsSync(path)) return {};
  const out: Record<string, string> = {};
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m) out[m[1]!] = m[2]!.replace(/^["']|["']$/g, '');
  }
  return out;
}

const config = {
  apiKey: 'AIzaSyAYQ_TzyCEK0_Iw5TnSiH8jbFbOFKZYNoM',
  authDomain: 'golink-9f16d.firebaseapp.com',
  projectId: 'golink-9f16d',
  storageBucket: 'golink-9f16d.firebasestorage.app',
  appId: '1:683198090102:web:3640bfa24dd0d325910857',
};

async function main() {
  const env = readDotEnv(join(root, '.env.local'));
  const webApiKey = env.VITE_GOOGLE_MAPS_API_KEY;
  if (!webApiKey) {
    console.log('Aucune VITE_GOOGLE_MAPS_API_KEY trouvée dans .env.local : rien à amorcer.');
    return;
  }

  const settingsSnap = await db.collection('settings').doc('maps').get();
  const alreadyConfigured = settingsSnap.exists && settingsSnap.data()?.configuredWeb === true;
  if (alreadyConfigured && !FORCE) {
    console.log('settings/maps.configuredWeb est déjà vrai : rien à faire (relancer avec --force pour réécrire).');
    return;
  }

  console.log(`Clé web trouvée dans .env.local (se termine par « ${webApiKey.slice(-4)} »).`);
  if (DRY_RUN) {
    console.log('--dry-run : aucun appel effectué.');
    return;
  }

  const accounts = readFileSync(join(root, '.test-accounts.local.md'), 'utf8');
  const email = 'superadmin@golink.test';
  const password = [...accounts.matchAll(/\|\s*`([^`]+)`\s*\|\s*`([^`]+)`\s*\|/g)].find((m) => m[1] === email)?.[2];
  if (!password) throw new Error(`Mot de passe introuvable pour ${email} dans .test-accounts.local.md`);

  const app = initializeApp(config, `maps-settings-seed-${Date.now()}`);
  const auth = getAuth(app);
  const functions = getFunctions(app, 'europe-west1');
  try {
    await signInWithEmailAndPassword(auth, email, password);
    const saveMapsSettings = httpsCallable(functions, 'saveMapsSettings');
    const result = await saveMapsSettings({
      webApiKey,
      mobileApiKey: '',
      allowedWebReferrers: ['http://localhost:*/*'],
      allowedMobileIdentifiers: [],
      reason: 'Amorçage automatique depuis la clé déjà créée localement (scripts/seed/only/maps-settings.ts).',
    });
    console.log('saveMapsSettings :', result.data);
  } finally {
    await signOut(auth).catch(() => undefined);
    await deleteApp(app);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
