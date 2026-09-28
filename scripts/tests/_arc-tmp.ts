import { db } from '../lib/admin.mjs';
async function main() {
  const r = await db.collection('restaurants').where('test', '==', true).get();
  console.log('test restaurants', r.docs.map((d) => d.id));
  const u = await db.doc('users/arc-test-client').get();
  console.log('client', u.exists);
}
main().then(() => process.exit(0));
