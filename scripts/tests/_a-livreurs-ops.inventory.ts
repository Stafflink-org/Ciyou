import { db } from '../lib/admin.mjs';
async function main() {
const cols = ['drivers','driverPrivate','driverLocations','driverSessions','driverSanctions','identityChecks','dispatchOffers','driverEarnings','zones','cities','countries','surgeRules','partnerDocuments','platformAlerts','settingsHistory','orders','orderFinancials','settings'];
for (const c of cols) {
  const s = await db.collection(c).count().get();
  console.log(c, s.data().count);
}
const d = await db.collection('drivers').limit(2).get();
d.docs.forEach(x => console.log(JSON.stringify(x.data()).slice(0,1500)));
const z = await db.collection('zones').limit(1).get();
z.docs.forEach(x => console.log('ZONE', x.id, JSON.stringify(x.data()).slice(0,1500)));
const ci = await db.collection('cities').get();
ci.docs.forEach(x => console.log('CITY', x.id, x.get('name'), x.get('active'), x.get('countryId'), JSON.stringify(x.get('dispatch')), JSON.stringify(x.get('orderRules')), JSON.stringify(x.get('pricing'))?.slice(0,400)));
const st = await db.collection('settings').get();
st.docs.forEach(x => console.log('SET', x.id, JSON.stringify(x.data()).slice(0,900)));
const sess = await db.collection('drivers').get();
const agg: Record<string, number> = {};
sess.docs.forEach(x => { const k = `${x.get('cityId')}|${x.get('type')}|${x.get('status')}|${x.get('onboardingStatus')}|${x.get('availability')}`; agg[k]=(agg[k]??0)+1; });
console.log(agg);
const pd = await db.collection('partnerDocuments').where('ownerType','==','driver').limit(2).get();
pd.docs.forEach(x => console.log('DOC', JSON.stringify(x.data()).slice(0,800)));
const ic = await db.collection('identityChecks').limit(1).get();
ic.docs.forEach(x => console.log('IC', JSON.stringify(x.data()).slice(0,800)));
const sa = await db.collection('driverSanctions').limit(1).get();
sa.docs.forEach(x => console.log('SAN', JSON.stringify(x.data()).slice(0,800)));
const loc = await db.collection('driverLocations').limit(1).get();
loc.docs.forEach(x => console.log('LOC', JSON.stringify(x.data()).slice(0,800)));
}
void main();
