// Garde-fou de non-régression (incident réel du 01/10/2026, voir docs/CONTRAT_MODULES.md §10
// quater) : un correctif natif iOS pour Stripe (`expo-build-properties`, `ios.useFrameworks:
// "dynamic"`) a été accidentellement remplacé par un autre correctif Stripe (`with-stripe-
// disable-spm`) au lieu d'être ajouté à côté — l'app client a planté au lancement sur un vrai
// appareil iOS toute une journée, avant d'être signalé par un client, avant d'être détecté ici.
//
// Ce script vérifie que toute app mobile dépendant de `@stripe/stripe-react-native` déclare bien
// les DEUX réglages requis dans `expo.plugins` (sans build, sans Xcode, juste le JSON) — à lancer
// avant toute soumission EAS, ou périodiquement pour détecter une régression silencieuse.
//
//   npx tsx scripts/tests/check-mobile-native-config.mjs
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const results = [];
const record = (name, ok, detail) => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'OK   ' : 'ÉCHEC'} ${name}${detail ? ` — ${detail}` : ''}`);
};

const APPS = ['client', 'driver'];

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function pluginNames(plugins) {
  // Un plugin Expo est soit une chaîne ("mon-plugin"), soit un tuple ["mon-plugin", { options }].
  return (plugins ?? []).map((p) => (Array.isArray(p) ? p[0] : p));
}

function findPluginConfig(plugins, name) {
  return (plugins ?? []).find((p) => (Array.isArray(p) ? p[0] : p) === name);
}

for (const appName of APPS) {
  const appDir = join(root, 'apps', appName);
  const pkg = readJson(join(appDir, 'package.json'));
  const usesStripeNative = Boolean(pkg.dependencies?.['@stripe/stripe-react-native']);
  if (!usesStripeNative) {
    record(`apps/${appName} : ne dépend pas de @stripe/stripe-react-native, rien à vérifier`, true);
    continue;
  }

  const appJson = readJson(join(appDir, 'app.json'));
  const plugins = appJson.expo?.plugins ?? [];
  const names = pluginNames(plugins);

  const hasSpmDisable = names.some((n) => typeof n === 'string' && n.includes('with-stripe-disable-spm'));
  record(`apps/${appName} : plugin with-stripe-disable-spm présent`, hasSpmDisable, hasSpmDisable ? undefined : `plugins déclarés : ${JSON.stringify(names)}`);

  const buildPropsEntry = findPluginConfig(plugins, 'expo-build-properties');
  const useFrameworks = Array.isArray(buildPropsEntry) ? buildPropsEntry[1]?.ios?.useFrameworks : undefined;
  const hasDynamicFrameworks = useFrameworks === 'dynamic' || useFrameworks === 'static';
  record(
    `apps/${appName} : expo-build-properties avec ios.useFrameworks réglé`,
    hasDynamicFrameworks,
    hasDynamicFrameworks ? `useFrameworks=${useFrameworks}` : `plugins déclarés : ${JSON.stringify(names)} (expo-build-properties manquant ou sans ios.useFrameworks)`,
  );

  const hasDep = Boolean(pkg.dependencies?.['expo-build-properties']);
  record(`apps/${appName} : expo-build-properties déclaré dans package.json`, hasDep);
}

const ok = results.every((r) => r.ok);
console.log(`\n${results.filter((r) => r.ok).length}/${results.length} OK`);
if (!ok) {
  console.error('\nRégression détectée : voir docs/CONTRAT_MODULES.md §10 quater (« Config native iOS requise ») pour le correctif exact.');
}
process.exit(ok ? 0 : 1);
