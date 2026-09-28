import { db } from '../../lib/admin.mjs';
for (const id of ['general','security','retention','maintenance']) console.log(id, JSON.stringify((await db.doc('settings/'+id).get()).data()));
for (const d of (await db.collection('admins').get()).docs) console.log(d.id, d.get('email'), d.get('role'), d.get('mfaEnrolled'), d.get('cityIds'));
console.log(JSON.stringify((await db.doc('countries/FR').get()).data()).slice(0,3000));
for (const d of (await db.collection('integrations').get()).docs) console.log(d.id, JSON.stringify(d.data()).slice(0,300));
for (const d of (await db.collection('featureFlags').get()).docs) console.log(d.id, d.get('enabled'), JSON.stringify(d.get('overrides')));
