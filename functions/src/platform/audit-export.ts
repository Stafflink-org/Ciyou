// Export du journal d'audit (cahier §27) : CSV filtré, lui-même journalisé, avec
// alerte de sécurité au-delà du seuil d'export massif.
import { COLLECTIONS, type AuditLog } from '@golink/shared';
import { db, Timestamp } from '../lib/admin';
import { actorFromCaller, writeAudit } from '../lib/audit';
import { fail } from '../lib/errors';
import { loadLimitsSettings } from '../lib/limits';
import { z, zReason } from '../lib/validation';
import { loadSecurityPolicy, platformCallable, plainValue, raiseSecurityAlert, requireSecureAdmin, PLATFORM_HEAVY_RUNTIME } from './runtime';

function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? '' : typeof value === 'string' ? value : JSON.stringify(value);
  // Neutralise les formules des tableurs.
  const safe = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return /[";\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

function formatParis(ms: number): string {
  return new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', dateStyle: 'short', timeStyle: 'medium' }).format(new Date(ms));
}

export const exportAuditLogs = platformCallable(
  z.object({
    from: z.number().int(),
    to: z.number().int(),
    actionPrefix: z.string().trim().max(60).nullish(),
    actorUid: z.string().trim().max(128).nullish(),
    targetType: z.string().trim().max(40).nullish(),
    sensitiveOnly: z.boolean().default(false),
    search: z.string().trim().max(80).nullish(),
    reason: zReason,
  }),
  async (data, request) => {
    const { caller, admin } = await requireSecureAdmin(request, 'audit.view');
    if (data.to <= data.from) throw fail.invalid('La période est invalide.');
    if (data.to - data.from > 400 * 86_400_000) throw fail.invalid('Exportez au plus 13 mois à la fois.');
    const maxRows = (await loadLimitsSettings()).exports.auditMaxRows;
    let q = db.collection(COLLECTIONS.auditLogs).where('at', '>=', Timestamp.fromMillis(data.from)).where('at', '<=', Timestamp.fromMillis(data.to)).orderBy('at', 'desc');
    if (data.actorUid) q = db.collection(COLLECTIONS.auditLogs).where('actor.uid', '==', data.actorUid).where('at', '>=', Timestamp.fromMillis(data.from)).where('at', '<=', Timestamp.fromMillis(data.to)).orderBy('at', 'desc');
    const snap = await q.limit(maxRows + 1).get();
    const needle = data.search?.toLowerCase() ?? '';
    const rows = snap.docs
      .slice(0, maxRows)
      .map((doc) => ({ id: doc.id, ...(doc.data() as AuditLog) }))
      .filter((log) => !data.actionPrefix || log.action.startsWith(data.actionPrefix))
      .filter((log) => !data.targetType || log.target?.type === data.targetType)
      .filter((log) => !data.sensitiveOnly || log.sensitive)
      .filter((log) => !needle || `${log.action} ${log.actor?.name ?? ''} ${log.target?.label ?? ''} ${log.reason ?? ''}`.toLowerCase().includes(needle));

    const header = ['Date', 'Action', 'Auteur', 'Type d’auteur', 'Rôle', 'Cible', 'Identifiant cible', 'Type de cible', 'Pays', 'Ville', 'Motif', 'Sensible', 'Avant', 'Après', 'Identifiant'];
    const lines = rows.map((log) =>
      [
        formatParis(log.at?.toMillis?.() ?? 0),
        log.action,
        log.actor?.name,
        log.actor?.type,
        log.actor?.role,
        log.target?.label,
        log.target?.id,
        log.target?.type,
        log.countryId,
        log.cityId,
        log.reason,
        log.sensitive ? 'oui' : 'non',
        log.before ? plainValue(log.before) : null,
        log.after ? plainValue(log.after) : null,
        log.id,
      ]
        .map(csvCell)
        .join(';'),
    );
    const csv = `﻿${[header.join(';'), ...lines].join('\r\n')}`;
    const policy = await loadSecurityPolicy();
    await writeAudit({
      actor: actorFromCaller(caller, 'admin'),
      action: 'audit.exported',
      target: { type: 'other', id: 'auditLogs', label: 'Journal d’audit' },
      reason: data.reason,
      after: { rows: rows.length, from: data.from, to: data.to, filters: { actionPrefix: data.actionPrefix ?? null, actorUid: data.actorUid ?? null, targetType: data.targetType ?? null, sensitiveOnly: data.sensitiveOnly } },
      sensitive: true,
      request,
    });
    if (rows.length >= policy.alerts.massExportRows) {
      await raiseSecurityAlert({ type: 'mass_export', adminId: caller.uid, severity: 'warning', details: `Export de ${rows.length.toLocaleString('fr-FR')} lignes du journal d’audit par ${admin.displayName}.` });
    }
    const day = new Date().toISOString().slice(0, 10);
    return {
      fileName: `golink-journal-audit-${day}.csv`,
      mimeType: 'text/csv;charset=utf-8',
      contentBase64: Buffer.from(csv, 'utf8').toString('base64'),
      rowCount: rows.length,
      truncated: snap.size > maxRows,
    };
  },
  PLATFORM_HEAVY_RUNTIME,
);
