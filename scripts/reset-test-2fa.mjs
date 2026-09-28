/**
 * Réinitialise la double authentification d'un compte de TEST (e-mail en @golink.test uniquement) pour
 * permettre de le ré-enrôler avec sa propre application d'authentification.
 *
 *   node scripts/reset-test-2fa.mjs superadmin@golink.test           (aperçu, ne modifie rien)
 *   node scripts/reset-test-2fa.mjs superadmin@golink.test --apply   (exécute)
 *
 * Refuse tout compte dont l'e-mail ne se termine pas par @golink.test.
 */
import { FieldValue } from 'firebase-admin/firestore';
import { auth, db } from './lib/admin.mjs';

const email = process.argv[2];
const apply = process.argv.includes('--apply');
if (!email || !/@golink\.test$/i.test(email)) {
  console.error('Refusé : seuls les comptes de test en @golink.test sont concernés.');
  process.exit(1);
}

const user = await auth.getUserByEmail(email);
const adminRef = db.collection('admins').doc(user.uid);
const secretRef = db.collection('adminSecrets').doc(user.uid);
const [adminSnap, secretSnap] = await Promise.all([adminRef.get(), secretRef.get()]);
if (!adminSnap.exists) {
  console.error(`Aucun profil administrateur pour ${email}.`);
  process.exit(1);
}
console.log(`${email} : mfaEnrolled=${adminSnap.data().mfaEnrolled === true}, secret présent=${secretSnap.exists}`);
if (!apply) {
  console.log('Aperçu seulement. Relancer avec --apply pour réinitialiser.');
  process.exit(0);
}

const batch = db.batch();
batch.update(adminRef, { mfaEnrolled: false, updatedAt: FieldValue.serverTimestamp() });
if (secretSnap.exists) batch.delete(secretRef);
await batch.commit();
// Invalide les sessions ouvertes pour forcer une reconnexion propre.
await auth.revokeRefreshTokens(user.uid);
console.log('Double authentification réinitialisée. Reconnectez-vous : l\'écran d\'enrôlement s\'affichera (QR à scanner).');
process.exit(0);
