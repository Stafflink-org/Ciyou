import { db } from '../lib/admin.mjs';
async function main() {
  for (const id of ['seed-driver-014', 'seed-driver-027']) {
    const s = await db.collection('driverLocations').doc(id).get();
    console.log(id, s.exists, s.exists ? Object.keys(s.data()!) : null);
    if (s.exists && !s.get('position')) { await s.ref.delete(); console.log('supprimé', id); }
  }
  process.exit(0);
}
void main();
