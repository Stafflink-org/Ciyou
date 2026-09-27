// Données et sauvegardes (cahier §31) : export Firestore planifié vers un bucket de
// sauvegarde (API d'export gérée), historique des opérations, et corbeille avec
// restauration documentée (déplacement puis restauration d'un document supprimé).
import { COLLECTIONS, type Backup, type BackupRestore, type TrashItem } from '@golink/shared';
import { v1 } from '@google-cloud/firestore';
import { logger } from 'firebase-functions/v2';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { db, FieldValue, Timestamp } from '../lib/admin';
import { actorFromCaller, writeAudit } from '../lib/audit';
import { sendEmail } from '../lib/brevo';
import { fail } from '../lib/errors';
import { EMAIL_SECRETS } from '../lib/secrets';
import { z, zId, zReason } from '../lib/validation';
import { PLATFORM_HEAVY_RUNTIME, PLATFORM_SCHEDULE_RUNTIME, TIMEZONE, platformCallable, requireSecureAdmin } from './runtime';

/** Alerte d'échec de sauvegarde (§31) : par e-mail aux super administrateurs, pas seulement dans l'historique. */
async function notifyBackupFailure(backupId: string, error: string): Promise<void> {
  const admins = await db.collection(COLLECTIONS.admins).where('role', '==', 'super_admin').where('active', '==', true).get();
  const subject = 'Échec de la sauvegarde Ciyou Eats';
  const html = `<p>La sauvegarde <strong>${backupId}</strong> a échoué :</p><p>${error}</p>`;
  for (const doc of admins.docs) {
    const email = doc.get('email') as string | undefined;
    if (!email) continue;
    await sendEmail({ to: { email }, message: { subject, html, text: `${subject} : ${error}` }, recipientType: 'admin', recipientId: doc.id, templateKey: 'backup_failed' }).catch((e) =>
      logger.error('Alerte d’échec de sauvegarde : envoi e-mail échoué', { adminId: doc.id, error: String(e) }),
    );
  }
}

const PROJECT_ID = process.env.GCLOUD_PROJECT ?? process.env.GCP_PROJECT ?? 'golink-9f16d';
/**
 * Bucket de sauvegarde : distinct du bucket de stockage applicatif (Storage sert les
 * médias publics). À créer une fois en dehors des fonctions (`gsutil mb`), dans la
 * même région que Firestore (europe-west1), avant la première exécution planifiée.
 */
const BACKUP_BUCKET = process.env.BACKUP_BUCKET ?? `${PROJECT_ID}-backups`;

const adminClient = new v1.FirestoreAdminClient();

async function runExport(kind: Backup['kind'], requestedBy: string, collections: string[] | null): Promise<string> {
  const ref = db.collection(COLLECTIONS.backups).doc();
  const startedAt = Timestamp.now();
  await ref.set({
    kind,
    status: 'running',
    bucketPath: `gs://${BACKUP_BUCKET}/${ref.id}`,
    collections,
    sizeBytes: null,
    startedAt,
    finishedAt: null,
    error: null,
    requestedBy,
    operationName: null,
  } as Omit<Backup, 'finishedAt'> & { operationName: string | null });

  try {
    const databasePath = adminClient.databasePath(PROJECT_ID, '(default)');
    const [operation] = await adminClient.exportDocuments({
      name: databasePath,
      outputUriPrefix: `gs://${BACKUP_BUCKET}/${ref.id}`,
      collectionIds: collections ?? [],
    });
    await ref.update({ operationName: operation.name ?? null });
    // Suit l'opération en tâche de fond (les exports volumineux dépassent le délai d'une fonction).
    operation
      .promise()
      .then(async () => {
        await ref.update({ status: 'completed', finishedAt: FieldValue.serverTimestamp() });
      })
      .catch(async (error: unknown) => {
        logger.error('Export Firestore échoué', { backupId: ref.id, error: String(error) });
        await ref.update({ status: 'failed', finishedAt: FieldValue.serverTimestamp(), error: String(error).slice(0, 500) });
        await notifyBackupFailure(ref.id, String(error).slice(0, 500)).catch(() => undefined);
      });
    return ref.id;
  } catch (error) {
    logger.error('Lancement de l’export Firestore impossible', { error: String(error) });
    await ref.update({ status: 'failed', finishedAt: FieldValue.serverTimestamp(), error: String(error).slice(0, 500) });
    await notifyBackupFailure(ref.id, String(error).slice(0, 500)).catch(() => undefined);
    throw error;
  }
}

/** Chaque nuit à 2 h : sauvegarde complète planifiée. */
export const scheduledFirestoreBackup = onSchedule(
  { schedule: '0 2 * * *', timeZone: TIMEZONE, ...PLATFORM_SCHEDULE_RUNTIME, timeoutSeconds: 540, memory: '512MiB', secrets: EMAIL_SECRETS },
  async () => {
    await runExport('scheduled', 'system', null);
  },
);

/** Sauvegarde manuelle à la demande, éventuellement restreinte à des collections. */
export const runManualBackup = platformCallable(
  z.object({ collections: z.array(z.string().trim().min(1).max(60)).max(30).nullable(), reason: zReason }),
  async (data, request) => {
    const { caller } = await requireSecureAdmin(request, 'backups.manage');
    const backupId = await runExport('manual', caller.uid, data.collections && data.collections.length > 0 ? data.collections : null);
    await writeAudit({
      actor: actorFromCaller(caller, 'admin'),
      action: 'backup.started',
      target: { type: 'other', id: backupId, label: 'Sauvegarde manuelle' },
      reason: data.reason,
      sensitive: true,
      request,
    });
    return { backupId };
  },
  { ...PLATFORM_HEAVY_RUNTIME, secrets: EMAIL_SECRETS },
);

/** Rafraîchit le statut d'une sauvegarde en cours (l'opération longue peut dépasser la durée d'une fonction). */
export const checkBackupStatus = platformCallable(
  z.object({ backupId: zId }),
  async (data, request) => {
    await requireSecureAdmin(request, 'backups.manage');
    const ref = db.collection(COLLECTIONS.backups).doc(data.backupId);
    const snap = await ref.get();
    if (!snap.exists) throw fail.notFound('Sauvegarde');
    const backup = snap.data() as Backup & { operationName?: string | null };
    if (backup.status !== 'running' || !backup.operationName) return { status: backup.status };
    try {
      const operation = await adminClient.checkExportDocumentsProgress(backup.operationName);
      if (operation.done) {
        const failed = Boolean(operation.error);
        const errorMessage = failed ? String(operation.error?.message ?? 'Échec inconnu').slice(0, 500) : null;
        await ref.update({
          status: failed ? 'failed' : 'completed',
          finishedAt: FieldValue.serverTimestamp(),
          error: errorMessage,
        });
        if (failed) await notifyBackupFailure(data.backupId, errorMessage ?? 'Échec inconnu').catch(() => undefined);
        return { status: failed ? 'failed' : 'completed' };
      }
      return { status: 'running' };
    } catch (error) {
      logger.warn('Suivi de l’export impossible', { backupId: data.backupId, error: String(error) });
      return { status: backup.status };
    }
  },
  { secrets: EMAIL_SECRETS },
);

// ------------------------------------------------------------------ Restauration outillée

/**
 * Restaure des collections d'une sauvegarde COMPLÈTE (§31) : double confirmation
 * (motif obligatoire + collections nommées explicitement, jamais « tout ») car
 * l'import écrase les documents existants aux mêmes chemins dans la base en cours.
 * À réserver à une reprise après incident, hors heures de forte activité.
 */
export const startBackupRestore = platformCallable(
  z.object({
    backupId: zId,
    collections: z.array(z.string().trim().min(1).max(60)).min(1).max(30),
    confirm: z.literal(true, { message: 'Confirmez la restauration : elle écrase les documents existants.' }),
    reason: zReason,
  }),
  async (data, request) => {
    const { caller } = await requireSecureAdmin(request, 'backups.manage');
    const backupRef = db.collection(COLLECTIONS.backups).doc(data.backupId);
    const backupSnap = await backupRef.get();
    if (!backupSnap.exists) throw fail.notFound('Sauvegarde');
    const backup = backupSnap.data() as Backup;
    if (backup.status !== 'completed') throw fail.precondition('Seule une sauvegarde terminée avec succès peut être restaurée.');
    const available = backup.collections ?? [];
    if (available.length > 0) {
      const unknown = data.collections.filter((c) => !available.includes(c));
      if (unknown.length) throw fail.invalid(`Cette sauvegarde ne contient pas : ${unknown.join(', ')}.`);
    }
    const restoreRef = db.collection(COLLECTIONS.backupRestores).doc();
    const record: BackupRestore = {
      backupId: data.backupId,
      collections: data.collections,
      status: 'running',
      operationName: null,
      startedAt: Timestamp.now(),
      finishedAt: null,
      error: null,
      requestedBy: caller.uid,
      reason: data.reason,
    };
    await restoreRef.set(record);
    try {
      const databasePath = adminClient.databasePath(PROJECT_ID, '(default)');
      const [operation] = await adminClient.importDocuments({
        name: databasePath,
        inputUriPrefix: backup.bucketPath,
        collectionIds: data.collections,
      });
      await restoreRef.update({ operationName: operation.name ?? null });
      operation
        .promise()
        .then(async () => {
          await restoreRef.update({ status: 'completed', finishedAt: FieldValue.serverTimestamp() });
        })
        .catch(async (error: unknown) => {
          logger.error('Restauration Firestore échouée', { restoreId: restoreRef.id, error: String(error) });
          await restoreRef.update({ status: 'failed', finishedAt: FieldValue.serverTimestamp(), error: String(error).slice(0, 500) });
          await notifyBackupFailure(`restauration ${restoreRef.id}`, String(error).slice(0, 500)).catch(() => undefined);
        });
    } catch (error) {
      await restoreRef.update({ status: 'failed', finishedAt: FieldValue.serverTimestamp(), error: String(error).slice(0, 500) });
      await notifyBackupFailure(`restauration ${restoreRef.id}`, String(error).slice(0, 500)).catch(() => undefined);
      throw error;
    }
    await writeAudit({
      actor: actorFromCaller(caller, 'admin'),
      action: 'backup.restore_started',
      target: { type: 'other', id: restoreRef.id, label: `Restauration de ${data.backupId}` },
      reason: data.reason,
      after: { backupId: data.backupId, collections: data.collections },
      sensitive: true,
      request,
    });
    return { restoreId: restoreRef.id };
  },
  { ...PLATFORM_HEAVY_RUNTIME, secrets: EMAIL_SECRETS },
);

/** Rafraîchit le statut d'une restauration en cours. */
export const checkBackupRestoreStatus = platformCallable(
  z.object({ restoreId: zId }),
  async (data, request) => {
    await requireSecureAdmin(request, 'backups.manage');
    const ref = db.collection(COLLECTIONS.backupRestores).doc(data.restoreId);
    const snap = await ref.get();
    if (!snap.exists) throw fail.notFound('Restauration');
    const restore = snap.data() as BackupRestore;
    if (restore.status !== 'running' || !restore.operationName) return { status: restore.status };
    try {
      const operation = await adminClient.checkImportDocumentsProgress(restore.operationName);
      if (operation.done) {
        const failed = Boolean(operation.error);
        await ref.update({ status: failed ? 'failed' : 'completed', finishedAt: FieldValue.serverTimestamp(), error: failed ? String(operation.error?.message ?? 'Échec inconnu').slice(0, 500) : null });
        return { status: failed ? 'failed' : 'completed' };
      }
      return { status: 'running' };
    } catch (error) {
      logger.warn('Suivi de la restauration impossible', { restoreId: data.restoreId, error: String(error) });
      return { status: restore.status };
    }
  },
);

// ------------------------------------------------------------------ Corbeille

/**
 * Déplace un document (et ses éventuels sous-documents) vers la corbeille avant
 * suppression réelle. Appelée par les fonctions métier de suppression (restaurants,
 * produits, comptes…), jamais directement par un client.
 */
export async function moveToTrash(input: {
  entity: TrashItem['entity'];
  path: string;
  snapshot: Record<string, unknown>;
  children?: TrashItem['children'];
  restaurantId?: string | null;
  deletedBy: string;
  reason?: string | null;
  retentionDays?: number;
  menuKind?: TrashItem['menuKind'];
  detached?: TrashItem['detached'];
}): Promise<string> {
  const now = Timestamp.now();
  const ref = db.collection(COLLECTIONS.trash).doc();
  const record: TrashItem = {
    entity: input.entity,
    path: input.path,
    snapshot: input.snapshot,
    children: input.children ?? [],
    restaurantId: input.restaurantId ?? null,
    deletedBy: input.deletedBy,
    deletedAt: now,
    reason: input.reason ?? null,
    purgeAt: Timestamp.fromMillis(now.toMillis() + (input.retentionDays ?? 30) * 86_400_000),
    restoredAt: null,
    restoredBy: null,
    menuKind: input.menuKind ?? null,
    detached: input.detached ?? null,
  };
  await ref.set(record);
  return ref.id;
}

export const restoreFromTrash = platformCallable(
  z.object({ trashId: zId, reason: zReason }),
  async (data, request) => {
    const { caller } = await requireSecureAdmin(request, 'trash.restore');
    const ref = db.collection(COLLECTIONS.trash).doc(data.trashId);
    const snap = await ref.get();
    if (!snap.exists) throw fail.notFound('Élément de la corbeille');
    const item = snap.data() as TrashItem;
    if (item.restoredAt) throw fail.precondition('Cet élément a déjà été restauré.');
    if (item.purgeAt.toMillis() < Date.now()) throw fail.precondition('Cet élément a dépassé son délai de restauration et a été purgé.');

    const batch = db.batch();
    batch.set(db.doc(item.path), item.snapshot);
    for (const child of item.children) batch.set(db.doc(child.path), child.snapshot);
    if (item.detached) {
      for (const path of item.detached.paths) {
        batch.update(db.doc(path), { [item.detached.field]: FieldValue.arrayUnion(item.entity.id) });
      }
    }
    batch.update(ref, { restoredAt: FieldValue.serverTimestamp(), restoredBy: caller.uid });
    await batch.commit();

    await writeAudit({
      actor: actorFromCaller(caller, 'admin'),
      action: 'trash.restored',
      target: { type: item.entity.type, id: item.entity.id, label: item.entity.label },
      reason: data.reason,
      request,
    });
    return { restored: true, path: item.path };
  },
);

/** Purge manuelle immédiate (au-delà de la purge automatique planifiée). */
export const purgeTrashItem = platformCallable(
  z.object({ trashId: zId, reason: zReason }),
  async (data, request) => {
    const { caller } = await requireSecureAdmin(request, 'trash.restore');
    const ref = db.collection(COLLECTIONS.trash).doc(data.trashId);
    const snap = await ref.get();
    if (!snap.exists) throw fail.notFound('Élément de la corbeille');
    const item = snap.data() as TrashItem;
    if (item.restoredAt) throw fail.precondition('Cet élément a déjà été restauré.');
    await ref.delete();
    await writeAudit({
      actor: actorFromCaller(caller, 'admin'),
      action: 'trash.purged',
      target: { type: item.entity.type, id: item.entity.id, label: item.entity.label },
      reason: data.reason,
      sensitive: true,
      request,
    });
    return { purged: true };
  },
);
