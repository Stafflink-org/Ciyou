// Enrôle la double authentification (TOTP) des comptes de TEST de l'équipe interne, pour que les
// recettes continuent de fonctionner quand la double authentification est obligatoire.
// Le compte du super administrateur n'est JAMAIS touché (son secret n'est pas accessible et sa
// double authentification ne doit être ni contournée ni réinitialisée).
//   node scripts/tests/mfa-enroll-test-accounts.mjs [e-mail ...]   (sans argument : les 4 comptes de test)
// Les secrets sont consignés dans .test-mfa.local.json (ignoré par git) ; les codes de secours ne sont pas conservés.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { callFn, nextCode, readMfa, signIn, writeMfa } from '../lib/test-mfa.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const accounts = readFileSync(join(root, '.test-accounts.local.md'), 'utf8');
const passwordOf = (email) => [...accounts.matchAll(/\|\s*`([^`]+)`\s*\|\s*`([^`]+)`\s*\|/g)].find((m) => m[1] === email)?.[2];
const DEFAULT = ['finance@golink.test', 'support@golink.test', 'commercial@golink.test', 'metz@golink.test'];
const targets = process.argv.length > 2 ? process.argv.slice(2) : DEFAULT;

for (const email of targets) {
  if (email === 'superadmin@golink.test') {
    console.log(`IGNORÉ ${email} : double authentification déjà active, jamais contournée.`);
    continue;
  }
  const password = passwordOf(email);
  if (!password) {
    console.log(`ABSENT ${email} : compte inconnu dans .test-accounts.local.md`);
    continue;
  }
  const mfa = readMfa();
  const token = await signIn(email, password);
  const tracked = await callFn('trackAdminSession', {}, token);
  if (!tracked.ok) {
    console.log(`ÉCHEC  ${email} : trackAdminSession ${tracked.status} ${JSON.stringify(tracked.error)}`);
    continue;
  }
  if (tracked.data.mfaEnrolled) {
    console.log(`DÉJÀ   ${email} : double authentification active${mfa[email] ? '' : ' (secret inconnu de ce poste)'}`);
    continue;
  }
  const started = await callFn('enrollTotp', { action: 'start' }, token);
  if (!started.ok) {
    console.log(`ÉCHEC  ${email} : enrollTotp start ${started.status} ${JSON.stringify(started.error)}`);
    continue;
  }
  const secret = started.data.secret;
  const { code, step } = await nextCode(secret, null);
  const confirmed = await callFn('enrollTotp', { action: 'confirm', code }, token);
  if (!confirmed.ok) {
    console.log(`ÉCHEC  ${email} : enrollTotp confirm ${confirmed.status} ${JSON.stringify(confirmed.error)}`);
    continue;
  }
  mfa[email] = { secret, enrolledAt: new Date().toISOString(), lastStep: step };
  writeMfa(mfa);
  console.log(`OK     ${email} : double authentification enrôlée (secret conservé dans .test-mfa.local.json)`);
}
process.exit(0);
