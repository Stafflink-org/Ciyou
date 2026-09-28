import { db } from '../../lib/admin.mjs';
const p = await db.doc('payments/pay-o-12777').get(); console.log(JSON.stringify(p.data()));
const u = await db.doc('users/seed-client-076').get(); console.log(u.get('walletBalanceCents'), u.get('firstName'));
