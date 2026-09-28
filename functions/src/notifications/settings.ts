// Réglage de l'envoi réel des messages automatiques (simulation par défaut), réservé
// à l'équipe centrale : chaque changement est historisé, motivé et audité.
import { COLLECTIONS, DEFAULT_NOTIFICATION_DELIVERY, SETTINGS_DOCS, type NotificationDeliverySettings } from '@golink/shared';
import { db, FieldValue } from '../lib/admin';
import { actorFromCaller, writeAudit } from '../lib/audit';
import { callable } from '../lib/callable';
import { fail } from '../lib/errors';
import { requireAdmin } from '../lib/permissions';
import { z, zReason } from '../lib/validation';
import { OPS_RUNTIME, plain, writeSettingsHistory } from '../admin/operations/common';

export const updateNotificationDelivery = callable(
  z.object({ emailLive: z.boolean(), smsLive: z.boolean(), pushLive: z.boolean(), reason: zReason }),
  async (data, request) => {
    const { caller, admin } = await requireAdmin(request, 'templates.edit');
    if (admin.role !== 'super_admin' && (admin.cityIds.length > 0 || admin.countryIds.length > 0)) {
      throw fail.forbidden('L’envoi réel des messages s’applique à toute la plateforme : réglage réservé à l’équipe centrale.');
    }
    const ref = db.collection(COLLECTIONS.settings).doc(SETTINGS_DOCS.notificationDelivery);
    const snap = await ref.get();
    const before = plain(snap.exists ? snap.data() : DEFAULT_NOTIFICATION_DELIVERY);
    const next = { emailLive: data.emailLive, smsLive: data.smsLive, pushLive: data.pushLive };
    await ref.set({ ...next, updatedAt: FieldValue.serverTimestamp(), updatedBy: caller.uid }, { merge: true });
    const fields = await writeSettingsHistory({ docPath: `${COLLECTIONS.settings}/${SETTINGS_DOCS.notificationDelivery}`, before, after: next, reason: data.reason, caller });
    await writeAudit({
      actor: actorFromCaller(caller, 'admin'),
      action: 'notification_delivery.updated',
      target: { type: 'setting', id: SETTINGS_DOCS.notificationDelivery, label: 'Envoi des messages automatiques' },
      reason: data.reason,
      before,
      after: next,
      sensitive: true,
      request,
    });
    return { updatedFields: fields } satisfies { updatedFields: string[] };
  },
  { ...OPS_RUNTIME },
);

export type { NotificationDeliverySettings };
