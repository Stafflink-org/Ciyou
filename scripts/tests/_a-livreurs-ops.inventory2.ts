import { db } from '../lib/admin.mjs';
async function main() {
  const e = await db.collection('driverEarnings').limit(1).get();
  e.docs.forEach(x => console.log('EARN', JSON.stringify(x.data()).slice(0,400)));
  const s = await db.collection('surgeRules').get();
  s.docs.forEach(x => console.log('SURGE', x.id, JSON.stringify(x.data()).slice(0,300)));
  const o = await db.collection('dispatchOffers').limit(1).get();
  o.docs.forEach(x => console.log('OFFER', x.id, JSON.stringify(x.data()).slice(0,400)));
  const ic = await db.collection('identityChecks').get();
  ic.docs.forEach(x => console.log('IC', x.id, x.get('driverId'), x.get('status')));
  const sa = await db.collection('driverSanctions').get();
  sa.docs.forEach(x => console.log('SAN', x.id, x.get('driverId'), x.get('status'), x.get('type')));
  const d = await db.collection('drivers').where('status','==','onboarding').get();
  d.docs.forEach(x => console.log('ONB', x.id, x.get('cityId'), x.get('onboardingStatus'), x.get('type'), x.get('vehicle.type')));
  const z = await db.collection('zones').get();
  z.docs.forEach(x => console.log('ZONE', x.id, x.get('cityId'), x.get('active'), JSON.stringify(x.get('live')), JSON.stringify(x.get('currentSurge'))));
  const pd = await db.collection('partnerDocuments').where('ownerType','==','driver').get();
  const agg: Record<string, number> = {};
  pd.docs.forEach(x => { const k = `${x.get('status')}|${x.get('expiresAt') ? 'exp' : 'noexp'}`; agg[k]=(agg[k]??0)+1; });
  console.log(agg);
  const active = await db.collection('orders').where('status','in',['new','accepted','preparing','ready','assigned','picked_up']).get();
  console.log('ACTIVE ORDERS', active.size);
  process.exit(0);
}
void main();
