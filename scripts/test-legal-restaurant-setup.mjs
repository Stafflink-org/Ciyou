// Prépare/restaure un test réel de réacceptation des CGU commerce, sans jamais
// toucher la version publiée réelle (partagée par tout le réseau) : on modifie
// uniquement `acceptedLegal.terms_restaurant` du compte de test lui-même
// (sofia.martin@golink.test), temporairement, pour simuler « n'a pas encore
// accepté la dernière version ». L'écran réel (LegalGate) remet ensuite ce champ
// à la bonne valeur via acceptLegalDocument — état final identique à l'état de départ.
import { auth, db } from './lib/admin.mjs';

const EMAIL = 'sofia.martin@golink.test';
const mode = process.argv[2]; // 'downgrade' | 'restore' | 'check'

const user = await auth.getUserByEmail(EMAIL);
const ref = db.collection('users').doc(user.uid);

if (mode === 'downgrade') {
  await ref.set({ acceptedLegal: { terms_restaurant: '2025-01-test-ancienne' } }, { merge: true });
  console.log('acceptedLegal.terms_restaurant mis à une ancienne version fictive pour déclencher la porte légale.');
} else if (mode === 'restore') {
  await ref.set({ acceptedLegal: { terms_restaurant: '2026-06' } }, { merge: true });
  console.log('acceptedLegal.terms_restaurant restauré à 2026-06 (version réellement publiée).');
} else {
  const snap = await ref.get();
  console.log('acceptedLegal actuel :', JSON.stringify(snap.data()?.acceptedLegal));
}
