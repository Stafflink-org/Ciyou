// Test réel cdc-fix-residuals-35 (§5 Fiche restaurant, « Notes internes et historique ») :
// une modification que le restaurant fait LUI-MÊME sur sa propre fiche (description,
// téléphone, logo, photos, cuisines, tags...) passe directement par le SDK client (autorisé
// par les règles Firestore, `can(rid,'settings.manage') && onlyChanges(restaurantProfileFields())`)
// sans jamais écrire d'entrée dans `auditLogs` — incohérent avec le reste du module, où toute
// écriture équivalente faite par l'équipe (`adminUpdateRestaurant`) est tracée.
//
// Corrigé : nouveau déclencheur `onRestaurantProfileWritten`
// (functions/src/restaurant/profile-audit.ts) sur `restaurants/{rid}` : calcule un différentiel
// sur les champs d'identité de la fiche et écrit une entrée d'audit (action
// `restaurant.profile_self_updated`, acteur = le membre restaurant). Ignore les
// resynchronisations internes (`updatedBy: 'system'`, onRestaurantSettingsWrite) et les
// modifications déjà auditées par l'équipe (`adminUpdateRestaurant`, acteur = un admin actif)
// pour ne pas dupliquer une entrée déjà écrite.
//
// Test réel sur `golink-9f16d` : le déclencheur étant un vrai déclencheur Firestore déployé, la
// vérification se fait en écrivant réellement sur un commerce jetable (admin SDK, exactement le
// document avant/après qu'une écriture cliente produirait) et en attendant la propagation
// réelle. Nettoyage complet après coup.
//
//   npx tsx scripts/tests/cdc-fix-residuals-35.flow.mjs
import { Timestamp } from '@google-cloud/firestore';
import { db } from '../lib/admin.mjs';

const results = [];
function record(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'OK   ' : 'ECHEC'} ${name}${detail ? ` - ${detail}` : ''}`);
}
const check = (name, condition, detail) => record(name, Boolean(condition), detail);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const RID = 'cdcres35-resto';
const MEMBER_UID = 'cdcres35-member';
const ADMIN_UID = 'cdcres35-admin';

async function findAudit(action, rid, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const snap = await db.collection('auditLogs').where('action', '==', action).limit(500).get();
    const match = snap.docs.map((d) => d.data()).find((a) => a.target?.id === rid);
    if (match) return match;
    await sleep(3000);
  }
  return null;
}

async function main() {
  const base = {
    name: 'CDCRES35 Resto', slug: 'cdcres35-resto', cityId: 'longwy', countryId: 'FR', status: 'active',
    onboardingStatus: 'approved', ownerId: MEMBER_UID, test: true,
    description: 'Description initiale', phone: '+33611111111', email: null, logo: null, cover: null, photos: [],
    cuisineIds: [], tags: [], priceLevel: 2, prepMinutes: 15, etaMinutes: 25, ownDeliveryFeeCents: 0, ownDeliveryRadiusMeters: 0,
    isOpen: true, updatedAt: Timestamp.now(), updatedBy: 'seed',
  };
  await db.doc(`restaurants/${RID}`).set(base);
  await db.doc(`restaurants/${RID}/members/${MEMBER_UID}`).set({ uid: MEMBER_UID, restaurantId: RID, displayName: 'CDCRES35 Membre', email: 'cdcres35-member@golink.test', role: 'owner', permissions: [], active: true, onDuty: false, invitedBy: MEMBER_UID, invitedAt: Timestamp.now() });

  // --- 1. Écriture du restaurant lui-même (description) : doit être auditée ---
  await db.doc(`restaurants/${RID}`).update({ description: 'Nouvelle description réelle', updatedAt: Timestamp.now(), updatedBy: MEMBER_UID });
  const selfAudit = await findAudit('restaurant.profile_self_updated', RID);
  check('modification du restaurant lui-même auditée (correctif attendu)', Boolean(selfAudit), JSON.stringify(selfAudit ?? null));
  check('acteur = le membre restaurant (pas admin ni system)', selfAudit?.actor?.uid === MEMBER_UID && selfAudit?.actor?.type === 'restaurant', JSON.stringify(selfAudit?.actor));
  check('avant/après corrects sur le champ modifié', selfAudit?.before?.description === 'Description initiale' && selfAudit?.after?.description === 'Nouvelle description réelle', JSON.stringify({ before: selfAudit?.before, after: selfAudit?.after }));

  // --- 2. Resynchronisation interne (updatedBy: system) : ne doit PAS être auditée ---
  await db.doc(`restaurants/${RID}`).update({ prepMinutes: 20, updatedAt: Timestamp.now(), updatedBy: 'system' });
  await sleep(8000);
  const systemSnap = await db.collection('auditLogs').where('action', '==', 'restaurant.profile_self_updated').limit(500).get();
  const systemAudit = systemSnap.docs.map((d) => d.data()).find((a) => a.target?.id === RID && a.actor?.uid === 'system');
  check('resynchronisation interne (updatedBy=system) non auditée (non-régression)', !systemAudit, JSON.stringify(systemAudit ?? 'absent, correct'));

  // --- 3. Modification par un admin actif : ne doit PAS dupliquer (déjà auditée par adminUpdateRestaurant) ---
  await db.doc(`admins/${ADMIN_UID}`).set({ active: true, role: 'ops_city', permissions: [], email: 'cdcres35-admin@golink.test', displayName: 'CDCRES35 Admin', cities: [], createdAt: Timestamp.now() });
  await db.doc(`restaurants/${RID}`).update({ tags: ['test'], updatedAt: Timestamp.now(), updatedBy: ADMIN_UID });
  await sleep(8000);
  const adminSnap = await db.collection('auditLogs').where('action', '==', 'restaurant.profile_self_updated').limit(500).get();
  const adminAudit = adminSnap.docs.map((d) => d.data()).find((a) => a.target?.id === RID && a.actor?.uid === ADMIN_UID);
  check('modification par un admin actif non dupliquée dans profile_self_updated', !adminAudit, JSON.stringify(adminAudit ?? 'absent, correct'));
}

async function cleanup() {
  await db.doc(`restaurants/${RID}/members/${MEMBER_UID}`).delete().catch(() => {});
  await db.doc(`restaurants/${RID}`).delete().catch(() => {});
  await db.doc(`admins/${ADMIN_UID}`).delete().catch(() => {});
  const snap = await db.collection('auditLogs').where('action', '==', 'restaurant.profile_self_updated').limit(500).get();
  const toDelete = snap.docs.filter((d) => d.data().target?.id === RID);
  await Promise.all(toDelete.map((d) => d.ref.delete()));
}

main()
  .catch((error) => record('exception', false, String(error.stack ?? error)))
  .finally(async () => {
    if (!process.env.NO_CLEANUP) await cleanup();
    const failed = results.filter((r) => !r.ok);
    console.log(`\n${results.length - failed.length}/${results.length} OK`);
    if (failed.length) {
      console.log('Echecs :');
      for (const f of failed) console.log(` - ${f.name} : ${f.detail}`);
      process.exitCode = 1;
    }
  });
