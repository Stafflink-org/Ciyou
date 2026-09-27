// Comptes de test (Firebase Auth) : équipe interne et personnel restaurant.
// Les mots de passe sont générés à la première création et consignés
// uniquement dans .test-accounts.local.md (ignoré par git).
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes, randomInt } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import type { Auth } from 'firebase-admin/auth';
import type { AdminRole, AuthClaims, StaffRole } from '@golink/shared';

export interface TestAccount {
  key: string;
  uid: string;
  email: string;
  firstName: string;
  lastName: string;
  label: string;
  admin?: { role: AdminRole; cityIds: string[] };
  restaurants?: Record<string, StaffRole>;
}

const DOMAIN = 'golink.test';

export const TEST_ACCOUNTS: TestAccount[] = [
  { key: 'superAdmin', uid: 'test-super-admin', email: `superadmin@${DOMAIN}`, firstName: 'Claire', lastName: 'Vautrin', label: 'Super administratrice', admin: { role: 'super_admin', cityIds: [] } },
  { key: 'support', uid: 'test-support', email: `support@${DOMAIN}`, firstName: 'Malik', lastName: 'Benyahia', label: 'Agent support', admin: { role: 'support', cityIds: [] } },
  { key: 'finance', uid: 'test-finance', email: `finance@${DOMAIN}`, firstName: 'Hélène', lastName: 'Kremer', label: 'Responsable finance', admin: { role: 'finance', cityIds: [] } },
  { key: 'sales', uid: 'test-sales', email: `commercial@${DOMAIN}`, firstName: 'Julien', lastName: 'Mercier', label: 'Commercial', admin: { role: 'sales', cityIds: [] } },
  { key: 'cityMetz', uid: 'test-city-metz', email: `metz@${DOMAIN}`, firstName: 'Nadia', lastName: 'Schwartz', label: 'Responsable de ville (Metz)', admin: { role: 'city_manager', cityIds: ['metz'] } },
  {
    key: 'owner', uid: 'test-owner-haddad', email: `mina.haddad@${DOMAIN}`, firstName: 'Mina', lastName: 'Haddad', label: 'Propriétaire du groupe Maison Haddad (3 établissements)',
    restaurants: { 'lune-coffee': 'owner', 'mina-kitchen': 'owner', 'onda-pasta-club': 'owner' },
  },
  { key: 'manager', uid: 'test-manager-mina', email: `sofia.martin@${DOMAIN}`, firstName: 'Sofia', lastName: 'Martin', label: 'Manager de Mina Kitchen', restaurants: { 'mina-kitchen': 'manager' } },
  { key: 'employee', uid: 'test-employee-mina', email: `youssef.karim@${DOMAIN}`, firstName: 'Youssef', lastName: 'Karim', label: 'Employé (cuisine) de Mina Kitchen', restaurants: { 'mina-kitchen': 'kitchen' } },
];

export function account(key: string): TestAccount {
  const found = TEST_ACCOUNTS.find((a) => a.key === key);
  if (!found) throw new Error(`Compte de test inconnu : ${key}`);
  return found;
}

export function claimsFor(a: TestAccount): AuthClaims {
  if (a.admin) return { role: 'admin', adminRole: a.admin.role };
  const restaurants = Object.fromEntries(Object.entries(a.restaurants ?? {}).sort(([x], [y]) => x.localeCompare(y)));
  return { role: 'restaurant', restaurants };
}

const CREDENTIALS_FILE = fileURLToPath(new URL('../../.test-accounts.local.md', import.meta.url));

function strongPassword(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const symbols = '!#$%*+-?@';
  const core = Array.from({ length: 14 }, () => alphabet[randomInt(alphabet.length)]).join('');
  return `${core}${symbols[randomInt(symbols.length)]}${randomInt(10, 99)}${randomBytes(1)[0]! % 10}`;
}

function readStoredPasswords(): Map<string, string> {
  const stored = new Map<string, string>();
  if (!existsSync(CREDENTIALS_FILE)) return stored;
  for (const line of readFileSync(CREDENTIALS_FILE, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\|\s*[^|]+\|\s*`([^`]+)`\s*\|\s*`([^`]+)`\s*\|/);
    if (match?.[1] && match[2]) stored.set(match[1], match[2]);
  }
  return stored;
}

/**
 * Crée ou met à jour les comptes de test (claims compris). Un compte existant
 * garde son mot de passe s'il est connu du fichier local ; sinon il en reçoit un nouveau.
 */
export async function upsertTestAccounts(auth: Auth): Promise<{ created: number; updated: number }> {
  const stored = readStoredPasswords();
  const passwords = new Map<string, string>();
  let created = 0;
  let updated = 0;
  for (const a of TEST_ACCOUNTS) {
    const displayName = `${a.firstName} ${a.lastName}`;
    const known = stored.get(a.email);
    const password = known ?? strongPassword();
    const exists = await auth.getUser(a.uid).then(() => true, () => false);
    if (exists) {
      await auth.updateUser(a.uid, { email: a.email, displayName, emailVerified: true, disabled: false, ...(known ? {} : { password }) });
      updated += 1;
    } else {
      await auth.createUser({ uid: a.uid, email: a.email, displayName, password, emailVerified: true });
      created += 1;
    }
    await auth.setCustomUserClaims(a.uid, JSON.parse(JSON.stringify(claimsFor(a))) as Record<string, unknown>);
    passwords.set(a.email, password);
  }

  const rows = TEST_ACCOUNTS.map((a) => `| ${a.label} | \`${a.email}\` | \`${passwords.get(a.email)}\` |`);
  writeFileSync(
    CREDENTIALS_FILE,
    [
      '# Comptes de test GoLink (base de démonstration)',
      '',
      'Fichier local, ignoré par git : ne jamais le committer ni le partager.',
      'Régénéré par `npm run seed` ; un mot de passe déjà présent ici est conservé.',
      '',
      '| Rôle | E-mail | Mot de passe |',
      '|---|---|---|',
      ...rows,
      '',
      'Back-office super admin : comptes de l’équipe interne. Back-office restaurant : propriétaire, manager, employé.',
      '',
    ].join('\n'),
  );
  return { created, updated };
}
