// Assemble les règles de sécurité à partir des fichiers par domaine :
//   firebase/rules/_helpers.rules + firebase/rules/*.rules      → firebase/firestore.rules
//   firebase/rules/storage/_helpers.rules + storage/*.rules      → firebase/storage.rules
// Les fichiers générés ne doivent pas être modifiés à la main.
// Usage : node scripts/build-rules.mjs [--check]
//   --check : échoue si les fichiers générés ne sont pas à jour (CI).
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const rulesDir = join(root, 'firebase', 'rules');
const checkOnly = process.argv.includes('--check');

const HEADER = [
  '// ===========================================================================',
  '// FICHIER GÉNÉRÉ, NE PAS ÉDITER.',
  '// Source : firebase/rules/ — régénérer avec `npm run rules:build`.',
  '// ===========================================================================',
].join('\n');

function indent(text, spaces) {
  const pad = ' '.repeat(spaces);
  return text
    .split('\n')
    .map((line) => (line.trim() === '' ? '' : pad + line))
    .join('\n');
}

/** Lit _helpers.rules puis les autres fichiers .rules du dossier, par ordre alphabétique. */
function readParts(dir) {
  const helpers = join(dir, '_helpers.rules');
  if (!existsSync(helpers)) throw new Error(`Fichier manquant : ${helpers}`);
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.rules') && f !== '_helpers.rules')
    .sort();
  return [
    { name: '_helpers.rules', body: readFileSync(helpers, 'utf8').trim() },
    ...files.map((f) => ({ name: f, body: readFileSync(join(dir, f), 'utf8').trim() })),
  ];
}

function assemble(parts, service, matchPath) {
  const body = parts
    .map((p) => `// ----- ${p.name}\n\n${p.body}`)
    .join('\n\n');
  return [
    HEADER,
    "rules_version = '2';",
    '',
    `service ${service} {`,
    `  match ${matchPath} {`,
    '',
    indent(body, 4),
    '',
    '    // Tout chemin non décrit ci-dessus est refusé.',
    '    match /{document=**} {',
    '      allow read, write: if false;',
    '    }',
    '  }',
    '}',
    '',
  ].join('\n');
}

const outputs = [
  {
    file: join(root, 'firebase', 'firestore.rules'),
    content: assemble(readParts(rulesDir), 'cloud.firestore', '/databases/{database}/documents'),
  },
  {
    file: join(root, 'firebase', 'storage.rules'),
    content: assemble(readParts(join(rulesDir, 'storage')), 'firebase.storage', '/b/{bucket}/o'),
  },
];

let stale = false;
for (const { file, content } of outputs) {
  const current = existsSync(file) ? readFileSync(file, 'utf8') : '';
  if (current === content) {
    console.log(`À jour : ${file}`);
    continue;
  }
  if (checkOnly) {
    console.error(`Obsolète : ${file}`);
    stale = true;
  } else {
    writeFileSync(file, content, 'utf8');
    console.log(`Généré : ${file}`);
  }
}
if (stale) process.exit(1);
