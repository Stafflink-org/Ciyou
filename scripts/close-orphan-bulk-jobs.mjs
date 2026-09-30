// Ponctuel : clôture les bulkJobs restés `running` à cause du bug set_feature
// (throw hors du try, déjà corrigé le 28/09/2026) — il ne reste que des
// documents orphelins créés avant le correctif. cdc-fix-residuals-6.
import { Timestamp, FieldValue } from '@google-cloud/firestore';
import { db } from './lib/admin.mjs';

const snap = await db.collection('bulkJobs').where('status', '==', 'running').get();

let closed = 0;
for (const doc of snap.docs) {
  const data = doc.data();
  console.log('running job:', doc.id, data.type, data.params?.action, data.params?.feature, data.startedAt?.toDate?.());
  await doc.ref.update({
    status: 'failed',
    processed: data.total ?? 0,
    succeeded: 0,
    failed: data.total ?? 0,
    errors: [{ id: '*', row: null, message: 'Job orphelin (bug set_feature corrigé le 28/09/2026, clôturé rétroactivement par cdc-fix-residuals-6).' }],
    finishedAt: Timestamp.now(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  closed += 1;
}
console.log(`Clôturés : ${closed}`);
