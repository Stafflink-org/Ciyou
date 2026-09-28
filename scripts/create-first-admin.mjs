/**
 * Crée le tout premier compte super administrateur (bootstrap) et lui envoie
 * l'invitation par e-mail. À utiliser une seule fois, avant l'ouverture du
 * super admin en production — ensuite, les administrateurs suivants sont
 * invités depuis l'application elle-même (Équipe > Inviter).
 *
 * Ce script écrit directement en base (il n'existe encore aucun admin pour
 * appeler la fonction `inviteAdmin`, réservée aux administrateurs déjà en
 * poste). Il journalise quand même une entrée d'audit pour la traçabilité.
 *
 * Usage :
 *   node scripts/create-first-admin.mjs --email dg@exemple.com                       (aperçu, ne modifie rien)
 *   node scripts/create-first-admin.mjs --email dg@exemple.com --apply               (crée le compte + envoie l'invitation)
 *   node scripts/create-first-admin.mjs --email dg@exemple.com --apply --admin-url https://admin.golink.fr
 *
 * --admin-url : adresse du super admin à utiliser dans le lien de l'e-mail
 * (par défaut ADMIN_APP_URL de functions/.env.local.secrets, sinon http://localhost:5174).
 */
import { readFileSync, existsSync } from 'node:fs';
import { Timestamp } from 'firebase-admin/firestore';
import { auth, db } from './lib/admin.mjs';

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const flag = (name) => {
  const i = args.indexOf(name);
  return i === -1 ? undefined : args[i + 1];
};
const email = flag('--email');
const firstName = flag('--prenom') ?? 'Super';
const lastName = flag('--nom') ?? 'Admin';

if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  console.error('Usage : node scripts/create-first-admin.mjs --email <e-mail> [--prenom <prénom>] [--nom <nom>] [--admin-url <https://...>] [--apply]');
  process.exit(1);
}

// Permissions complètes du super administrateur (copie de ADMIN_PERMISSIONS,
// packages/shared/src/permissions/admin.ts — tenir à jour si la liste évolue ;
// note : le contrôle d'accès admin laisse de toute façon passer role==='super_admin'
// quel que soit le contenu de `permissions`).
const SUPER_ADMIN_PERMISSIONS = [
  'dashboard.view', 'search.use', 'analytics.view', 'reports.view', 'reports.schedule', 'exports.run',
  'restaurants.view', 'restaurants.edit', 'restaurants.validate', 'restaurants.suspend', 'restaurants.delete',
  'restaurants.commercial', 'restaurants.impersonate', 'restaurants.bulk', 'restaurants.import',
  'drivers.view', 'drivers.edit', 'drivers.validate', 'drivers.sanction', 'drivers.pay_rules', 'drivers.bulk',
  'customers.view', 'customers.edit', 'customers.block', 'customers.delete', 'customers.credit', 'personal_data.view',
  'orders.view', 'orders.intervene', 'order_rules.edit', 'zones.edit', 'display.edit',
  'reviews.view', 'reviews.moderate', 'support.view', 'support.handle', 'support.escalate', 'support.configure',
  'payments.view', 'payments.configure', 'refunds.create', 'refunds.approve', 'finance.view', 'finance.payouts',
  'finance.adjust', 'finance.hold', 'invoices.view', 'invoices.issue', 'tax.reports', 'plans.edit', 'commissions.edit',
  'subscriptions.manage', 'promotions.view', 'promotions.edit', 'loyalty.edit', 'notifications.send', 'templates.edit',
  'announcements.edit', 'crm.view', 'crm.edit', 'crm.manage_team', 'platform.access', 'settings.view', 'settings.edit',
  'markets.edit', 'features.edit', 'integrations.view', 'integrations.edit', 'admins.view', 'admins.manage',
  'audit.view', 'security.manage', 'fraud.view', 'fraud.manage', 'legal.edit', 'gdpr.handle', 'system.view',
  'system.manage', 'trash.view', 'trash.restore', 'backups.manage',
];

/** Lecture minimale d'un fichier .env (clé=valeur, une par ligne) sans dépendance. */
function readDotEnv(path) {
  if (!existsSync(path)) return {};
  const out = {};
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return out;
}

const secrets = readDotEnv('functions/.env.local.secrets');
const adminUrl = flag('--admin-url') ?? process.env.ADMIN_APP_URL ?? secrets.ADMIN_APP_URL ?? 'http://localhost:5174';

console.log(`E-mail : ${email}`);
console.log(`Adresse du super admin utilisée dans le lien : ${adminUrl}${adminUrl === 'http://localhost:5174' ? '  (⚠ valeur par défaut locale — passer --admin-url une fois le domaine réel connu)' : ''}`);
console.log(apply ? 'Mode : --apply (création réelle)' : 'Mode : --dry-run (aperçu, ajouter --apply pour créer le compte)');
console.log('');

const existingAdmins = await db.collection('admins').where('active', '==', true).where('role', '==', 'super_admin').get();
if (!existingAdmins.empty) {
  console.log(`⚠ ${existingAdmins.size} super administrateur(s) déjà actif(s) : ${existingAdmins.docs.map((d) => d.data().email).join(', ')}`);
  console.log('  (ce script reste idempotent : relancer avec le même e-mail ne duplique rien, mais vérifier que c’est bien voulu.)');
  console.log('');
}

const existingUser = await auth.getUserByEmail(email).catch((e) => {
  if (e?.errorInfo?.code === 'auth/user-not-found') return null;
  throw e;
});
const existingAdminDoc = existingUser ? await db.collection('admins').doc(existingUser.uid).get() : null;
if (existingAdminDoc?.exists && existingAdminDoc.data().active) {
  console.log(`✓ ${email} est déjà un administrateur actif (role=${existingAdminDoc.data().role}). Rien à faire.`);
  process.exit(0);
}

console.log(existingUser ? `Compte Firebase Auth existant réutilisé (uid=${existingUser.uid}).` : 'Nouveau compte Firebase Auth à créer.');
console.log(`Document admins/{uid} à créer avec role="super_admin" et ${SUPER_ADMIN_PERMISSIONS.length} permissions.`);
console.log('Profil users/{uid} + userPrivate/{uid} à créer (si absents).');
console.log('Claims personnalisés à poser : { role: "admin", adminRole: "super_admin" }.');
console.log('Lien de définition du mot de passe à générer, e-mail d’invitation à envoyer via Brevo.');

if (!apply) {
  console.log('\nRien n’a été créé (dry-run). Relancer avec --apply pour créer le compte et envoyer l’invitation.');
  process.exit(0);
}

const displayName = `${firstName} ${lastName}`;
const user =
  existingUser ??
  (await auth.createUser({
    email,
    displayName,
    password: (await import('node:crypto')).randomBytes(24).toString('base64url'),
    emailVerified: false,
    disabled: false,
  }));
const created = !existingUser;

const now = Timestamp.now();
await db.collection('admins').doc(user.uid).set({
  uid: user.uid,
  email,
  displayName,
  role: 'super_admin',
  permissions: SUPER_ADMIN_PERMISSIONS,
  active: true,
  countryIds: [],
  cityIds: [],
  refundLimitCents: null,
  mfaEnrolled: false,
  lastLoginAt: null,
  lastLoginIp: null,
  createdAt: now,
  createdBy: 'bootstrap-script',
  updatedAt: now,
  updatedBy: 'bootstrap-script',
});

await db.runTransaction(async (tx) => {
  const userRef = db.collection('users').doc(user.uid);
  const privateRef = db.collection('userPrivate').doc(user.uid);
  const [userSnap, privateSnap] = await Promise.all([tx.get(userRef), tx.get(privateRef)]);
  if (!privateSnap.exists) {
    tx.set(privateRef, {
      stripeCustomerId: null, riskScore: 0, riskFlags: [], deviceHashes: [], cardFingerprints: [],
      phoneHash: null, fraudCaseIds: [], updatedAt: now,
    });
  }
  if (!userSnap.exists) {
    tx.set(userRef, {
      role: 'admin', firstName, lastName, displayName, email, emailVerified: false,
      phone: null, phoneVerified: false, avatar: null, locale: 'fr', status: 'active',
      defaultAddressId: null, consents: {}, notificationPrefs: { orderUpdates: true, promotions: false, newsletter: false },
      walletBalanceCents: 0, referralCode: null, referredBy: null,
      stats: { ordersCount: 0, totalSpentCents: 0, lastOrderAt: null, firstOrderAt: null, cancelledCount: 0, refundsCount: 0 },
      acceptedLegal: {}, cityId: null, lastLoginAt: null, lastSeenAt: null, searchKeywords: [],
      createdAt: now, createdBy: null, updatedAt: now, updatedBy: null,
    });
  }
});

await auth.setCustomUserClaims(user.uid, { role: 'admin', adminRole: 'super_admin' });

const actionLink = await auth.generatePasswordResetLink(email);
const oobCode = new URL(actionLink).searchParams.get('oobCode');
const link = new URL('/definir-mot-de-passe', adminUrl);
if (oobCode) link.searchParams.set('oobCode', oobCode);

await db.collection('auditLogs').add({
  actor: { uid: 'bootstrap-script', type: 'system', role: null, name: 'Ciyou Eats (script de démarrage)' },
  action: 'admin.invited',
  target: { type: 'admin', id: user.uid, label: email },
  countryId: null,
  cityId: null,
  reason: 'Création du premier super administrateur (préparation mise en production).',
  before: null,
  after: { role: 'super_admin' },
  sensitive: true,
  impersonationSessionId: null,
  ipHash: null,
  userAgent: null,
  at: now,
});

console.log(`\n✓ Compte super admin ${created ? 'créé' : 'mis à jour'} : uid=${user.uid}`);
console.log(`Lien de définition du mot de passe : ${link.toString()}`);

// Envoi de l'invitation par Brevo (si les identifiants sont disponibles localement).
if (secrets.BREVO_API_KEY && secrets.BREVO_SENDER_EMAIL) {
  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': secrets.BREVO_API_KEY, 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      sender: { name: 'Ciyou Eats', email: secrets.BREVO_SENDER_EMAIL },
      to: [{ email, name: displayName }],
      subject: "Votre accès à l'administration Ciyou Eats",
      htmlContent: `<p>Bonjour ${firstName},</p><p>Un accès super administrateur à la plateforme Ciyou Eats vient d'être créé pour vous.</p><p><a href="${link.toString()}">Définir mon mot de passe</a></p><p>Si le lien a expiré, redemandez une réinitialisation depuis la page de connexion.</p>`,
      textContent: `Bonjour ${firstName},\nUn accès super administrateur Ciyou Eats a été créé pour vous.\nDéfinir votre mot de passe : ${link.toString()}`,
      tags: ['admin_invitation', 'bootstrap'],
    }),
  });
  const body = await res.json().catch(() => ({}));
  console.log(res.ok ? `✓ Invitation envoyée par e-mail (Brevo messageId=${body.messageId ?? '?'}).` : `✗ Échec envoi Brevo (${res.status}) : ${JSON.stringify(body).slice(0, 300)} — transmettre le lien ci-dessus manuellement.`);
} else {
  console.log('Identifiants Brevo introuvables localement (functions/.env.local.secrets) : transmettre le lien ci-dessus manuellement.');
}

console.log('\nRappel : ce compte doit enrôler la double authentification (2FA) dès sa première connexion.');
