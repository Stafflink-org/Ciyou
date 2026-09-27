import { db } from '../../lib/admin.mjs';
const rs = await db.collection('restaurants').get();
for (const d of rs.docs) { const c = await d.ref.collection('private').doc('commercial').get(); console.log(d.id, c.get('stripeAccountId'), c.get('stripeAccountStatus'), c.get('payoutsBlocked')); }
const dp = await db.collection('driverPrivate').where('stripeAccountId','!=',null).limit(5).get(); console.log('drivers with acct', dp.size);
