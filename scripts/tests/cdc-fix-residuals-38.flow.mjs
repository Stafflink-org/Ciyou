// Test réel cdc-fix-residuals-38 (§8 Commandes, vision globale, « Volumes en direct ») :
// `useActiveOrders` (apps/admin/src/features/commandes/hooks.ts:20) limitait la requête
// `where('cityId','in', ids.slice(0,4))` à 4 villes alors que Firestore autorise jusqu'à 10
// valeurs dans une clause `in` — limite déjà utilisée 13 lignes plus bas dans le MÊME fichier
// (`useDispatchFailedAlerts`, `geo.cityIds.slice(0, 10)`) pour une requête similaire. Un admin
// dont le périmètre couvre plus de 4 villes (scope pays, ou liste de villes assignées > 4)
// voyait silencieusement les commandes des villes au-delà de la 4ᵉ absentes de l'écran, sans
// aucun avertissement.
//
// Corrigé : `slice(0, 4)` → `slice(0, 10)`, cohérent avec le reste du fichier.
//
// Test réel sur `golink-9f16d` : vérifie directement, avec des commandes jetables réparties
// sur 6 villes de test, que la requête Firestore construite avec la nouvelle limite (10) les
// retrouve TOUTES — la requête avec l'ancienne limite (4) aurait silencieusement perdu les 2
// dernières, preuve directe du correctif. Nettoyage complet après coup.
//
//   npx tsx scripts/tests/cdc-fix-residuals-38.flow.mjs
import { db } from '../lib/admin.mjs';

const results = [];
function record(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'OK   ' : 'ECHEC'} ${name}${detail ? ` - ${detail}` : ''}`);
}
const check = (name, condition, detail) => record(name, Boolean(condition), detail);

const CITY_IDS = ['cdcres38-ville-1', 'cdcres38-ville-2', 'cdcres38-ville-3', 'cdcres38-ville-4', 'cdcres38-ville-5', 'cdcres38-ville-6'];
const created = new Set();

async function main() {
  for (const cityId of CITY_IDS) {
    const ref = db.collection('orders').doc(`cdcres38-order-${cityId}`);
    await ref.set({ cityId, status: 'placed', test: true, createdAt: new Date() });
    created.add(ref.id);
  }

  // Requête exactement comme dans useActiveOrders, avec la nouvelle limite (10).
  const snapNew = await db.collection('orders').where('cityId', 'in', CITY_IDS.slice(0, 10)).where('status', 'in', ['placed']).get();
  const foundNew = new Set(snapNew.docs.filter((d) => created.has(d.id)).map((d) => d.get('cityId')));
  check('requete avec slice(0,10) : les 6 villes de test toutes trouvees (correctif attendu)', CITY_IDS.every((c) => foundNew.has(c)), `trouvees=${[...foundNew].join(',')}`);

  // Reproduction de l'ancien bug : avec slice(0,4), les 2 dernieres villes auraient ete perdues.
  const snapOld = await db.collection('orders').where('cityId', 'in', CITY_IDS.slice(0, 4)).where('status', 'in', ['placed']).get();
  const foundOld = new Set(snapOld.docs.filter((d) => created.has(d.id)).map((d) => d.get('cityId')));
  check('preuve du bug avant correctif : slice(0,4) aurait perdu les villes 5 et 6', !foundOld.has('cdcres38-ville-5') && !foundOld.has('cdcres38-ville-6'), `trouvees=${[...foundOld].join(',')}`);
}

async function cleanup() {
  await Promise.all([...created].map((id) => db.doc(`orders/${id}`).delete().catch(() => {})));
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
