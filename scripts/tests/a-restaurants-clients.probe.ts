// Inventaire des données du périmètre « restaurants et clients » (lecture seule).
import { db } from '../lib/admin.mjs';

async function main() {
  for (const rid of ['maison-pita', 'brasserie-des-remparts', 'casa-arepa']) {
    const docs = await db.collection('partnerDocuments').where('ownerId', '==', rid).get();
    console.log(rid, docs.docs.map((d) => `${d.id}:${d.get('type')}:${d.get('status')}:${d.get('expiresAt')}`).join(' | '));
    const legal = await db.doc(`restaurants/${rid}/private/legal`).get();
    console.log('  legal', legal.exists, legal.get('partnerTermsAcceptedAt') ? 'signed' : 'unsigned', legal.get('siret'));
  }
  const approved = await db.collection('partnerDocuments').where('status', '==', 'approved').get();
  const exp = approved.docs.filter((d) => d.get('expiresAt')).map((d) => `${d.get('ownerId')}:${d.get('type')}:${d.get('expiresAt')}`).sort((a, b) => a.split(':')[2].localeCompare(b.split(':')[2]));
  console.log('soonest', exp.slice(0, 6));
  const clients = await db.collection('users').where('role', '==', 'client').limit(5).get();
  for (const c of clients.docs) {
    const [pm, ad, fav] = await Promise.all([c.ref.collection('paymentMethods').count().get(), c.ref.collection('addresses').count().get(), c.ref.collection('favorites').count().get()]);
    console.log(c.id, c.get('displayName'), c.get('email'), c.get('status'), 'pm', pm.data().count, 'ad', ad.data().count, 'fav', fav.data().count, 'wallet', c.get('walletBalanceCents'));
  }
  const priv = await db.collection('userPrivate').where('riskScore', '>', 30).limit(5).get();
  console.log('risky', priv.docs.map((d) => `${d.id}:${d.get('riskScore')}:${(d.get('riskFlags') ?? []).join(',')}`));
  const blocked = await db.collection('users').where('status', '==', 'blocked').get();
  console.log('blocked', blocked.docs.map((d) => d.id));
  const rules = await db.collection('commissionRules').get();
  rules.docs.forEach((d) => console.log('rule', d.id, d.get('scope'), d.get('scopeId')));
  const owners = await db.collection('restaurants').get();
  for (const r of owners.docs.slice(0, 12)) {
    const u = await db.doc(`users/${r.get('ownerId')}`).get();
    console.log('owner', r.id, u.get('email'), r.get('email'));
  }
}
main().then(() => process.exit(0));
