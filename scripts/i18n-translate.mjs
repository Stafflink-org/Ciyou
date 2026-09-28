/**
 * Complète les clés manquantes des fichiers de traduction (apps/*/src/i18n/{en,ar}/*.json)
 * à partir du français, via la Cloud Function `translateTexts` (Azure Translator, réglée
 * dans le super admin > Plateforme & sécurité > Traduction). N'écrase JAMAIS une clé déjà
 * présente dans le fichier cible : seules les clés absentes sont ajoutées (une clé déjà
 * relue à la main, même identique au français, est donc toujours conservée).
 *
 * Usage :
 *   node scripts/i18n-translate.mjs                 (dry-run : affiche ce qui serait ajouté)
 *   node scripts/i18n-translate.mjs --apply          (écrit les fichiers en/ar)
 *   node scripts/i18n-translate.mjs --apply --app admin
 *
 * Nécessite un compte de test super admin dans .test-accounts.local.md (voir ce fichier),
 * et une clé Azure Translator déjà enregistrée dans le super admin (settings/translator).
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deleteApp, initializeApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { getFunctions, httpsCallable } from 'firebase/functions';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const apply = args.includes('--apply');
const onlyApp = args.includes('--app') ? args[args.indexOf('--app') + 1] : null;
const TARGET_LOCALES = ['en', 'ar'];
const MAX_TEXTS_PER_CALL = 50;

const config = {
  apiKey: 'AIzaSyAYQ_TzyCEK0_Iw5TnSiH8jbFbOFKZYNoM',
  authDomain: 'golink-9f16d.firebaseapp.com',
  projectId: 'golink-9f16d',
  storageBucket: 'golink-9f16d.firebasestorage.app',
  appId: '1:683198090102:web:3640bfa24dd0d325910857',
};

function readAccounts() {
  const file = join(root, '.test-accounts.local.md');
  if (!existsSync(file)) throw new Error('.test-accounts.local.md introuvable : nécessaire pour se connecter en super admin.');
  const text = readFileSync(file, 'utf8');
  const row = [...text.matchAll(/\|\s*Super administratrice\s*\|\s*`([^`]+)`\s*\|\s*`([^`]+)`\s*\|/g)][0];
  if (!row) throw new Error('Compte super administrateur introuvable dans .test-accounts.local.md');
  return { email: row[1], password: row[2] };
}

/** Aplatit un objet JSON imbriqué en paires "a.b.c" -> valeur (chaînes uniquement). */
function flatten(obj, prefix = '') {
  const out = {};
  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === 'object' && !Array.isArray(value)) Object.assign(out, flatten(value, path));
    else out[path] = value;
  }
  return out;
}

/** Réinjecte des paires "a.b.c" -> valeur dans un objet imbriqué, en partant d'une base existante. */
function unflatten(pairs, base = {}) {
  const out = structuredClone(base);
  for (const [path, value] of Object.entries(pairs)) {
    const parts = path.split('.');
    let node = out;
    for (let i = 0; i < parts.length - 1; i++) {
      node[parts[i]] = typeof node[parts[i]] === 'object' && node[parts[i]] !== null ? node[parts[i]] : {};
      node = node[parts[i]];
    }
    node[parts[parts.length - 1]] = value;
  }
  return out;
}

function readJson(path) {
  return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : {};
}

function chunk(array, size) {
  const out = [];
  for (let i = 0; i < array.length; i += size) out.push(array.slice(i, i + size));
  return out;
}

async function main() {
  const apps = readdirSync(join(root, 'apps')).filter((a) => (onlyApp ? a === onlyApp : true) && existsSync(join(root, 'apps', a, 'src', 'i18n', 'fr')));
  console.log(`Applications : ${apps.join(', ')}${apply ? ' (écriture)' : ' (aperçu — utilisez --apply pour écrire)'}`);

  const { email, password } = readAccounts();
  const app = initializeApp(config, `i18n-${Date.now()}`);
  const auth = getAuth(app);
  await signInWithEmailAndPassword(auth, email, password);
  const functions = getFunctions(app, 'europe-west1');
  const translateTexts = httpsCallable(functions, 'translateTexts');

  let totalAdded = 0;
  let totalErrors = 0;

  for (const appName of apps) {
    const frDir = join(root, 'apps', appName, 'src', 'i18n', 'fr');
    for (const file of readdirSync(frDir).filter((f) => f.endsWith('.json'))) {
      const frPath = join(frDir, file);
      const fr = flatten(readJson(frPath));
      for (const locale of TARGET_LOCALES) {
        const targetDir = join(root, 'apps', appName, 'src', 'i18n', locale);
        const targetPath = join(targetDir, file);
        const targetBase = readJson(targetPath);
        const targetFlat = flatten(targetBase);
        const missingKeys = Object.keys(fr).filter((k) => !(k in targetFlat) && typeof fr[k] === 'string' && fr[k].trim());
        if (missingKeys.length === 0) continue;
        console.log(`${appName}/${file} → ${locale} : ${missingKeys.length} clé(s) manquante(s)`);
        if (!apply) {
          for (const k of missingKeys.slice(0, 10)) console.log(`  + ${k} = "${fr[k]}"`);
          if (missingKeys.length > 10) console.log(`  … et ${missingKeys.length - 10} autre(s)`);
          totalAdded += missingKeys.length;
          continue;
        }
        const additions = {};
        for (const batch of chunk(missingKeys, MAX_TEXTS_PER_CALL)) {
          try {
            const { data } = await translateTexts({ texts: batch.map((k) => fr[k]), from: 'fr', to: [locale] });
            batch.forEach((k, i) => { additions[k] = data.translations[locale]?.[i] ?? fr[k]; });
          } catch (error) {
            console.error(`  ÉCHEC (${appName}/${file} → ${locale}) : ${error.message}`);
            totalErrors += batch.length;
          }
        }
        if (Object.keys(additions).length) {
          const merged = unflatten(additions, targetBase);
          writeFileSync(targetPath, `${JSON.stringify(merged, null, 2)}\n`, 'utf8');
          totalAdded += Object.keys(additions).length;
        }
      }
    }
  }

  await signOut(auth).catch(() => undefined);
  await deleteApp(app);
  console.log(`${apply ? 'Ajoutées' : 'À ajouter'} : ${totalAdded} clé(s)${totalErrors ? ` — ${totalErrors} échec(s) (voir ci-dessus)` : ''}.`);
  if (!apply && totalAdded > 0) console.log('Relancez avec --apply pour écrire les fichiers.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
