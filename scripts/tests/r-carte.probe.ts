// Inventaire des éléments de test de la carte (noms « Test… » ou test:true) et, avec --clean, suppression.
import { bucket, db } from '../lib/admin.mjs';
const CLEAN = process.argv.includes('--clean');
const RIDS = ['mina-kitchen', 'lune-coffee', 'onda-pasta-club'];
async function main() {
  for (const rid of RIDS) {
    for (const sub of ['sections', 'products', 'options', 'optionGroups', 'stockMovements']) {
      const snap = await db.collection(`restaurants/${rid}/${sub}`).get();
      const hits = snap.docs.filter((d) => d.get('test') === true || /^(test|e2e)/i.test(String(d.get('name') ?? d.get('productName') ?? '')) || /copie/i.test(String(d.get('name') ?? '')));
      for (const d of hits) {
        console.log(rid, sub, d.id, d.get('name') ?? d.get('productName'), d.get('test') ? 'test:true' : '', d.get('seed') ? 'seed' : '');
        if (CLEAN) {
          await d.ref.delete();
          // Photos déposées pour ce produit ou cette section de test.
          if (sub === 'products' || sub === 'sections') await bucket.deleteFiles({ prefix: `restaurants/${rid}/public/menu/${sub}/${d.id}/` }).catch(() => undefined);
          if (sub === 'products') await db.collection('menuIssues').where('restaurantId', '==', rid).where('productId', '==', d.id).get().then((q) => Promise.all(q.docs.map((i) => i.ref.delete())));
        }
      }
      if (sub === 'products') console.log(rid, 'products', snap.size);
    }
  }
  const trash = await db.collection('trash').where('restaurantId', 'in', RIDS).get();
  for (const d of trash.docs) {
    console.log('trash', d.id, d.get('menuKind'), JSON.stringify(d.get('snapshot')?.name ?? ''), d.get('restoredAt') ? 'restored' : '');
    if (CLEAN && (d.get('test') === true || /^(test|e2e)/i.test(String(d.get('snapshot')?.name ?? '')))) await d.ref.delete();
  }
  const issues = await db.collection('menuIssues').where('restaurantId', 'in', RIDS).get();
  const byType: Record<string, number> = {};
  for (const d of issues.docs) byType[`${d.get('restaurantId')}:${d.get('type')}:${d.get('status')}`] = (byType[`${d.get('restaurantId')}:${d.get('type')}:${d.get('status')}`] ?? 0) + 1;
  console.log(byType);
}
main().then(() => process.exit(0));
