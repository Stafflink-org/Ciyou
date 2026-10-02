// Données et sauvegardes (cahier §31) : export Firestore planifié vers un bucket de
// sauvegarde (API d'export gérée), historique des opérations, et corbeille avec
// restauration documentée (déplacement puis restauration d'un document supprimé).
import { COLLECTIONS, SETTINGS_DOCS, type Backup, type BackupRestore, type TrashItem } from '@golink/shared';
import { v1 } from '@google-cloud/firestore';
import { logger } from 'firebase-functions/v2';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { db, FieldValue, storage, Timestamp } from '../lib/admin';
import { actorFromCaller, writeAudit } from '../lib/audit';
import { sendEmail } from '../lib/brevo';
import { fail } from '../lib/errors';
import { assertAdminCovers, assertAdminCoversCountry } from '../lib/permissions';
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

/**
 * Logique partagée entre le rafraîchissement manuel (`checkBackupStatus`) et le balayage
 * planifié (`sweepRunningBackupOperations`) : le suivi par `.then()/.catch()` posé sur
 * `operation.promise()` au lancement de l'export (voir `runExport`) suppose que l'instance de la
 * fonction reste active jusqu'à la fin de l'opération — ce n'est garanti par aucune configuration
 * ici, et une sauvegarde planifiée (2 h du matin, personne pour cliquer « Actualiser ») dont
 * l'instance est recyclée reste alors bloquée à `running` indéfiniment, sans jamais déclencher
 * l'alerte d'échec. Le balayage périodique est le vrai filet de sécurité.
 */
async function refreshBackupStatus(backupId: string): Promise<{ status: Backup['status'] }> {
  const ref = db.collection(COLLECTIONS.backups).doc(backupId);
  const snap = await ref.get();
  if (!snap.exists) return { status: 'failed' };
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
      if (failed) await notifyBackupFailure(backupId, errorMessage ?? 'Échec inconnu').catch(() => undefined);
      return { status: failed ? 'failed' : 'completed' };
    }
    return { status: 'running' };
  } catch (error) {
    logger.warn('Suivi de l’export impossible', { backupId, error: String(error) });
    return { status: backup.status };
  }
}

/** Rafraîchit le statut d'une sauvegarde en cours (l'opération longue peut dépasser la durée d'une fonction). */
export const checkBackupStatus = platformCallable(
  z.object({ backupId: zId }),
  async (data, request) => {
    await requireSecureAdmin(request, 'backups.manage');
    return refreshBackupStatus(data.backupId);
  },
  { secrets: EMAIL_SECRETS },
);

/**
 * Export « téléchargeable » (§31) : liens signés (15 min) vers les fichiers de la
 * sauvegarde native, pour un téléchargement direct par le super admin (jusque-là,
 * seul l'état de la sauvegarde était consultable, jamais son contenu). Les fichiers
 * restent dans le bucket de sauvegarde dédié (`BACKUP_BUCKET`) ; rien n'est copié.
 */
export const getBackupDownloadLinks = platformCallable(
  z.object({ backupId: zId }),
  async (data, request) => {
    const { caller } = await requireSecureAdmin(request, 'backups.manage');
    const ref = db.collection(COLLECTIONS.backups).doc(data.backupId);
    const snap = await ref.get();
    if (!snap.exists) throw fail.notFound('Sauvegarde');
    const backup = snap.data() as Backup;
    if (backup.status !== 'completed') throw fail.precondition('Seule une sauvegarde terminée avec succès peut être téléchargée.');
    const [files] = await storage
      .bucket(BACKUP_BUCKET)
      .getFiles({ prefix: `${data.backupId}/` })
      .catch((error: unknown) => {
        logger.error('Liste des fichiers de sauvegarde impossible', { backupId: data.backupId, error: String(error) });
        throw fail.unavailable('Bucket de sauvegarde introuvable ou inaccessible.');
      });
    if (files.length === 0) throw fail.notFound('Aucun fichier trouvé pour cette sauvegarde.');
    const limited = files.slice(0, 300);
    const links = await Promise.all(
      limited.map(async (file: (typeof files)[number]) => {
        const [url] = await file.getSignedUrl({ action: 'read', expires: Date.now() + 15 * 60_000 });
        const [meta] = await file.getMetadata().catch(() => [{ size: undefined }]);
        return { name: file.name.slice(`${data.backupId}/`.length) || file.name, url, sizeBytes: meta?.size ? Number(meta.size) : null };
      }),
    );
    await writeAudit({
      actor: actorFromCaller(caller, 'admin'),
      action: 'backup.download_links_issued',
      target: { type: 'other', id: data.backupId, label: 'Liens de téléchargement de sauvegarde' },
      reason: 'Consultation du super admin',
      sensitive: true,
      request,
    });
    return { files: links, truncated: files.length > limited.length };
  },
);

/** Sérialise un document Firestore en JSON lisible (dates ISO, points géo, références en chemin). */
function serializeForExport(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (value instanceof Timestamp) return value.toDate().toISOString();
  if (Array.isArray(value)) return value.map(serializeForExport);
  if (typeof value === 'object') {
    const anyValue = value as Record<string, unknown> & { path?: unknown; latitude?: unknown; longitude?: unknown };
    if (typeof anyValue.path === 'string' && typeof anyValue.latitude !== 'number') return anyValue.path; // DocumentReference
    if (typeof anyValue.latitude === 'number' && typeof anyValue.longitude === 'number') return { lat: anyValue.latitude, lng: anyValue.longitude }; // GeoPoint
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(anyValue)) out[key] = serializeForExport(val);
    return out;
  }
  return value;
}

const READABLE_EXPORT_RUNTIME = { maxInstances: 1, memory: '1GiB', timeoutSeconds: 300 } as const;
const READABLE_EXPORT_MAX_DOCS_PER_COLLECTION = 5_000;

/**
 * Export complémentaire lisible par collection (§31 : le téléchargement natif ci-dessus
 * donne l'export Firestore managé, plusieurs fichiers binaires par « kind », illisibles
 * sans outil dédié). Ici : un fichier `.jsonl` (une ligne JSON par document, encodage
 * UTF-8) par collection choisie, avec liens signés (15 min). Bornes volontaires (10
 * collections, 5000 documents chacune) pour rester dans le budget d'une fonction : au-delà,
 * utiliser l'export natif restauré par `startBackupRestore`, prévu pour les gros volumes.
 */
export const exportReadableCollections = platformCallable(
  z.object({ collections: z.array(z.string().trim().min(1).max(60)).min(1).max(10), reason: zReason }),
  async (data, request) => {
    const { caller } = await requireSecureAdmin(request, 'backups.manage');
    const exportId = `readable-${Date.now()}`;
    const files: Array<{ name: string; url: string; count: number; truncated: boolean }> = [];
    for (const collectionId of data.collections) {
      const snap = await db.collection(collectionId).limit(READABLE_EXPORT_MAX_DOCS_PER_COLLECTION + 1).get();
      const docs = snap.docs.slice(0, READABLE_EXPORT_MAX_DOCS_PER_COLLECTION);
      const lines = docs.map((d) => JSON.stringify({ id: d.id, ...(serializeForExport(d.data()) as Record<string, unknown>) }));
      const path = `${exportId}/${collectionId}.jsonl`;
      const file = storage.bucket(BACKUP_BUCKET).file(path);
      await file.save(Buffer.from(lines.join('\n'), 'utf-8'), { contentType: 'application/x-ndjson; charset=utf-8' });
      const [url] = await file.getSignedUrl({ action: 'read', expires: Date.now() + 15 * 60_000 });
      files.push({ name: `${collectionId}.jsonl`, url, count: docs.length, truncated: snap.docs.length > READABLE_EXPORT_MAX_DOCS_PER_COLLECTION });
    }
    await writeAudit({
      actor: actorFromCaller(caller, 'admin'),
      action: 'backup.readable_export',
      target: { type: 'other', id: exportId, label: `Export lisible (${data.collections.join(', ')})` },
      reason: data.reason,
      sensitive: true,
      request,
    });
    return { exportId, files };
  },
  { ...READABLE_EXPORT_RUNTIME },
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

/** Même raison d'être que `refreshBackupStatus` ci-dessus, pour une restauration. */
async function refreshBackupRestoreStatus(restoreId: string): Promise<{ status: BackupRestore['status'] }> {
  const ref = db.collection(COLLECTIONS.backupRestores).doc(restoreId);
  const snap = await ref.get();
  if (!snap.exists) return { status: 'failed' };
  const restore = snap.data() as BackupRestore;
  if (restore.status !== 'running' || !restore.operationName) return { status: restore.status };
  try {
    const operation = await adminClient.checkImportDocumentsProgress(restore.operationName);
    if (operation.done) {
      const failed = Boolean(operation.error);
      const errorMessage = failed ? String(operation.error?.message ?? 'Échec inconnu').slice(0, 500) : null;
      await ref.update({ status: failed ? 'failed' : 'completed', finishedAt: FieldValue.serverTimestamp(), error: errorMessage });
      if (failed) await notifyBackupFailure(`restauration ${restoreId}`, errorMessage ?? 'Échec inconnu').catch(() => undefined);
      return { status: failed ? 'failed' : 'completed' };
    }
    return { status: 'running' };
  } catch (error) {
    logger.warn('Suivi de la restauration impossible', { restoreId, error: String(error) });
    return { status: restore.status };
  }
}

/** Rafraîchit le statut d'une restauration en cours. */
export const checkBackupRestoreStatus = platformCallable(
  z.object({ restoreId: zId }),
  async (data, request) => {
    await requireSecureAdmin(request, 'backups.manage');
    return refreshBackupRestoreStatus(data.restoreId);
  },
);

/**
 * Filet de sécurité pour les sauvegardes/restaurations qui restent bloquées à `running` faute
 * d'instance de fonction encore active pour recevoir le `.then()/.catch()` posé au lancement
 * (voir le commentaire sur `refreshBackupStatus`) : relit périodiquement tout ce qui est encore
 * `running` et force la mise à jour, sans attendre un clic manuel sur « Actualiser » que personne
 * ne fait pour la sauvegarde planifiée de 2 h du matin.
 */
export const sweepRunningBackupOperations = onSchedule(
  { schedule: 'every 15 minutes', timeZone: TIMEZONE, ...PLATFORM_SCHEDULE_RUNTIME, timeoutSeconds: 300, memory: '256MiB', secrets: EMAIL_SECRETS },
  async () => {
    const [runningBackups, runningRestores] = await Promise.all([
      db.collection(COLLECTIONS.backups).where('status', '==', 'running').get(),
      db.collection(COLLECTIONS.backupRestores).where('status', '==', 'running').get(),
    ]);
    for (const doc of runningBackups.docs) {
      await refreshBackupStatus(doc.id).catch((error) => logger.error('Balayage sauvegarde échoué', { backupId: doc.id, error: String(error) }));
    }
    for (const doc of runningRestores.docs) {
      await refreshBackupRestoreStatus(doc.id).catch((error) => logger.error('Balayage restauration échoué', { restoreId: doc.id, error: String(error) }));
    }
  },
);

// ------------------------------------------------------------------ Corbeille

const DEFAULT_TRASH_RETENTION_DAYS = 30;
let trashRetentionCache: { at: number; days: number } | null = null;

/**
 * Durée de conservation en corbeille (jours) : le réglage plateforme
 * `settings/retention.trashRetentionDays` (§29/§31) s'il est renseigné, sinon 30 jours
 * par défaut. Mis en cache 5 min (même modèle que `resolveInvoiceRetentionYears`,
 * `finance/argent/common.ts`) : `moveToTrash`/`trashMenuItems` sont appelées sur des
 * chemins fréquents (suppression de produit, section, option, offre, promotion),
 * une lecture Firestore par suppression serait un coût inutile pour un réglage qui
 * change rarement.
 */
export async function resolveTrashRetentionDays(): Promise<number> {
  if (trashRetentionCache && Date.now() - trashRetentionCache.at < 300_000) return trashRetentionCache.days;
  let days = DEFAULT_TRASH_RETENTION_DAYS;
  try {
    const snap = await db.collection(COLLECTIONS.settings).doc(SETTINGS_DOCS.retention).get();
    const configured = Number((snap.data() as Record<string, unknown> | undefined)?.trashRetentionDays);
    if (Number.isFinite(configured) && configured > 0) days = configured;
  } catch {
    // Défaut conservé en cas d'erreur de lecture du réglage.
  }
  trashRetentionCache = { at: Date.now(), days };
  return days;
}

/**
 * Déplace un document (et ses éventuels sous-documents) vers la corbeille avant
 * suppression réelle. Appelée par les fonctions métier de suppression (restaurants,
 * produits, comptes…), jamais directement par un client. Si `retentionDays` n'est
 * pas fourni par l'appelant, le réglage plateforme (`resolveTrashRetentionDays`) est
 * lu — ce n'était pas le cas avant `cdc-fix-residuals-10` : la constante 30 était
 * codée en dur, le réglage `trashRetentionDays` de l'écran Données n'avait alors
 * aucun effet (cahier §31).
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
  const retentionDays = input.retentionDays ?? (await resolveTrashRetentionDays());
  const record: TrashItem = {
    entity: input.entity,
    path: input.path,
    snapshot: input.snapshot,
    children: input.children ?? [],
    restaurantId: input.restaurantId ?? null,
    deletedBy: input.deletedBy,
    deletedAt: now,
    reason: input.reason ?? null,
    purgeAt: Timestamp.fromMillis(now.toMillis() + retentionDays * 86_400_000),
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
    const { caller, admin } = await requireSecureAdmin(request, 'trash.restore');
    const ref = db.collection(COLLECTIONS.trash).doc(data.trashId);
    const snap = await ref.get();
    if (!snap.exists) throw fail.notFound('Élément de la corbeille');
    const item = snap.data() as TrashItem;
    if (item.restoredAt) throw fail.precondition('Cet élément a déjà été restauré.');
    if (item.purgeAt.toMillis() < Date.now()) throw fail.precondition('Cet élément a dépassé son délai de restauration et a été purgé.');
    // `trash.restore` seul laissait un admin restreint par ville/pays restaurer un élément de
    // n'importe quel restaurant hors de son périmètre (fuite + action hors mandat) — même défaut
    // que posConnections/fraudCases corrigés plus tôt, jamais appliqué ici alors que l'écran
    // restaurant équivalent (restoreMenuItem) le fait déjà.
    if (item.restaurantId) {
      const restaurant = (await db.collection(COLLECTIONS.restaurants).doc(item.restaurantId).get()).data() as { cityId?: string | null; countryId?: string | null } | undefined;
      assertAdminCovers(admin, restaurant?.cityId ?? null);
      assertAdminCoversCountry(admin, restaurant?.countryId ?? null);
    }

    const batch = db.batch();
    batch.set(db.doc(item.path), item.snapshot);
    for (const child of item.children) batch.set(db.doc(child.path), child.snapshot);
    if (item.detached) {
      for (const path of item.detached.paths) {
        // `arrayUnion` ne convient qu'aux champs tableau (optionIds, optionGroupIds) : `sectionId`
        // (détaché par `trashMenuItems` quand une section est supprimée sans ses produits) est un
        // champ SCALAIRE (string|null) — y appliquer `arrayUnion` le transforme en tableau à la
        // restauration, corrompant silencieusement le type du champ en base (même bug déjà évité
        // dans `restoreMenuItem`, l'écran dédié du restaurant, qui traite ce cas séparément).
        if (item.detached.field === 'sectionId') {
          batch.update(db.doc(path), { [item.detached.field]: item.entity.id });
        } else {
          batch.update(db.doc(path), { [item.detached.field]: FieldValue.arrayUnion(item.entity.id) });
        }
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
    const { caller, admin } = await requireSecureAdmin(request, 'trash.restore');
    const ref = db.collection(COLLECTIONS.trash).doc(data.trashId);
    const snap = await ref.get();
    if (!snap.exists) throw fail.notFound('Élément de la corbeille');
    const item = snap.data() as TrashItem;
    if (item.restoredAt) throw fail.precondition('Cet élément a déjà été restauré.');
    if (item.restaurantId) {
      const restaurant = (await db.collection(COLLECTIONS.restaurants).doc(item.restaurantId).get()).data() as { cityId?: string | null; countryId?: string | null } | undefined;
      assertAdminCovers(admin, restaurant?.cityId ?? null);
      assertAdminCoversCountry(admin, restaurant?.countryId ?? null);
    }
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
