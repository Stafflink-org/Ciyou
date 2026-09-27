// Traitement des alertes du tableau de bord (prise en charge, résolution, mise à
// l'écart, réouverture) et réglage des seuils de surveillance. Actions auditées.
import { COLLECTIONS, SETTINGS_DOCS, type PlatformAlert } from '@golink/shared';
import { db, FieldValue } from '../../lib/admin';
import { actorFromCaller, writeAudit } from '../../lib/audit';
import { fail } from '../../lib/errors';
import { assertAdminCovers, requireAdmin } from '../../lib/permissions';
import { z, zId } from '../../lib/validation';
import { loadMonitoringSettings, runMonitoring } from './anomalies';
import { pilotageCallable } from './runtime';

const STATUS_ACTIONS: Record<string, string> = {
  acknowledged: 'alert.acknowledged',
  resolved: 'alert.resolved',
  dismissed: 'alert.dismissed',
  open: 'alert.reopened',
};

export const handlePlatformAlert = pilotageCallable(
  z.object({
    alertId: zId,
    status: z.enum(['acknowledged', 'resolved', 'dismissed', 'open']),
    note: z.string().trim().max(300).nullish(),
  }),
  async (data, request): Promise<{ status: PlatformAlert['status'] }> => {
    const { caller, admin } = await requireAdmin(request, 'dashboard.view');
    const ref = db.collection(COLLECTIONS.platformAlerts).doc(data.alertId);
    const result = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) throw fail.notFound('Alerte');
      const alert = snap.data() as PlatformAlert;
      if (alert.cityId) assertAdminCovers(admin, alert.cityId);
      if (data.status === 'dismissed' && !data.note) throw fail.invalid('Indiquez pourquoi cette alerte est écartée.');
      const update: Record<string, unknown> = { status: data.status };
      if (data.status === 'acknowledged') {
        update.acknowledgedBy = caller.uid;
        update.acknowledgedAt = FieldValue.serverTimestamp();
      }
      if (data.status === 'resolved' || data.status === 'dismissed') {
        update.resolvedAt = FieldValue.serverTimestamp();
        if (!alert.acknowledgedBy) {
          update.acknowledgedBy = caller.uid;
          update.acknowledgedAt = FieldValue.serverTimestamp();
        }
      }
      if (data.status === 'open') {
        update.resolvedAt = null;
        update.acknowledgedBy = null;
        update.acknowledgedAt = null;
      }
      tx.update(ref, update);
      return alert;
    });
    await writeAudit({
      actor: actorFromCaller(caller, 'admin'),
      action: STATUS_ACTIONS[data.status] ?? 'alert.updated',
      target: { type: 'other', id: data.alertId, label: result.title },
      reason: data.note ?? null,
      before: { status: result.status },
      after: { status: data.status },
      countryId: result.countryId ?? null,
      cityId: result.cityId ?? null,
      request,
    });
    return { status: data.status };
  },
);

const ratio = z.number().min(0).max(10);

export const updateMonitoringSettings = pilotageCallable(
  z.object({
    restaurantCancellationRate: ratio,
    restaurantRejectionRate: ratio,
    restaurantMinOrders: z.number().int().min(1).max(10_000),
    cityOrderDrop: z.number().min(0.05).max(0.95),
    cityMinOrders: z.number().int().min(1).max(100_000),
    refundSpike: z.number().min(0.1).max(10),
    zoneDriverRatio: z.number().min(0.05).max(10),
    gdprDueWarningDays: z.number().int().min(1).max(30),
    driverTensionRatio: z.number().min(1).max(20),
    alertReopenAfterDays: z.number().int().min(1).max(30),
    reason: z.string().trim().min(3, 'Indiquez un motif').max(300),
  }),
  async (data, request): Promise<{ ok: true }> => {
    const { caller } = await requireAdmin(request, 'settings.edit');
    const before = await loadMonitoringSettings();
    const { reason, ...values } = data;
    const ref = db.collection(COLLECTIONS.settings).doc(SETTINGS_DOCS.monitoring);
    await ref.set({ ...values, updatedAt: FieldValue.serverTimestamp(), updatedBy: caller.uid });
    const changedFields = (Object.keys(values) as Array<keyof typeof values>).filter((key) => before[key] !== values[key]);
    await db.collection(COLLECTIONS.settingsHistory).add({
      docPath: `${COLLECTIONS.settings}/${SETTINGS_DOCS.monitoring}`,
      changedFields,
      before: { ...before },
      after: values,
      reason,
      changedBy: caller.uid,
      changedAt: FieldValue.serverTimestamp(),
    });
    await writeAudit({
      actor: actorFromCaller(caller, 'admin'),
      action: 'settings.updated',
      target: { type: 'setting', id: `settings/${SETTINGS_DOCS.monitoring}`, label: 'Seuils des alertes' },
      reason,
      before: { ...before },
      after: values,
      request,
    });
    return { ok: true };
  },
);

/** Relance immédiate de la surveillance (bouton « Actualiser les alertes »). */
export const runMonitoringNow = pilotageCallable(
  z.object({}),
  async (_data, request) => {
    await requireAdmin(request, 'dashboard.view');
    return runMonitoring();
  },
  { memory: '512MiB', timeoutSeconds: 300 },
);
