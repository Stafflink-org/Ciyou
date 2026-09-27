// Alertes « à traiter » du tableau de bord levées par les fonctions d'argent
// (reversement en échec, abonnement impayé). Une seule alerte ouverte par clé.
import { COLLECTIONS, type PlatformAlert } from '@golink/shared';
import { createHash } from 'node:crypto';
import { db, Timestamp } from '../../lib/admin';

export async function raiseAlert(alert: Omit<PlatformAlert, 'status' | 'detectedAt' | 'queue'> & { queue?: PlatformAlert['queue'] }): Promise<void> {
  const id = `argent-${createHash('sha1').update(alert.dedupKey).digest('hex').slice(0, 20)}`;
  const ref = db.collection(COLLECTIONS.platformAlerts).doc(id);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (snap.exists && ['open', 'acknowledged'].includes(String(snap.get('status')))) {
      tx.update(ref, { message: alert.message, metric: alert.metric ?? null });
      return;
    }
    const doc: PlatformAlert = { ...alert, queue: alert.queue ?? 'todo', status: 'open', detectedAt: Timestamp.now() };
    tx.set(ref, doc);
  });
}

export async function resolveAlert(dedupKey: string): Promise<void> {
  const id = `argent-${createHash('sha1').update(dedupKey).digest('hex').slice(0, 20)}`;
  const ref = db.collection(COLLECTIONS.platformAlerts).doc(id);
  const snap = await ref.get();
  if (snap.exists && snap.get('status') !== 'resolved') await ref.update({ status: 'resolved', resolvedAt: Timestamp.now() });
}
