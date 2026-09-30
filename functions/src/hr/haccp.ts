// HACCP : contrôle des relevés de température (non-conformité automatique hors
// seuil) et registre PDF d'une période (exportHaccpRegister).
import {
  HACCP_NC_STATUS_LABELS,
  HACCP_SEVERITY_LABELS,
  type HaccpAudit,
  type HaccpCleaningLog,
  type HaccpCleaningTask,
  type HaccpEquipment,
  type HaccpExport,
  type HaccpNonConformity,
  type HaccpPestVisit,
  type HaccpReception,
  type HaccpTemperatureLog,
  type Restaurant,
  type StaffDirectoryEntry,
} from '@golink/shared';
import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import type { Timestamp as AdminTimestamp } from 'firebase-admin/firestore';
import { db, FieldValue, storage, Timestamp } from '../lib/admin';
import { actorFromCaller, writeAudit } from '../lib/audit';
import { callable } from '../lib/callable';
import { assertFeatureAllowed } from '../finance/argent/entitlements';
import { fail } from '../lib/errors';
import { requireRestaurantAccess } from '../lib/permissions';
import { z, zId } from '../lib/validation';
import { HR_CALLABLE, HR_RUNTIME, sub } from './common';
import { PDF_COLORS, PdfDocument, pdfNumber } from './pdf';
import { addDays, formatShortDay, parisDateAt, parisDay, parisHourMinute } from './time';

// ---------------------------------------------------------------------------
// Relevé hors seuil → non-conformité
// ---------------------------------------------------------------------------

export const onTemperatureLogCreated = onDocumentCreated({ document: 'restaurants/{rid}/haccpTemperatureLogs/{logId}', ...HR_RUNTIME }, async (event) => {
  const snap = event.data;
  if (!snap) return;
  const log = snap.data() as HaccpTemperatureLog;
  const { rid, logId } = event.params;
  const equipmentSnap = await sub(rid, 'haccpEquipments').doc(log.equipmentId).get();
  if (!equipmentSnap.exists) return;
  const equipment = equipmentSnap.data() as HaccpEquipment;
  const min = equipment.minTemp ?? null;
  const max = equipment.maxTemp ?? null;
  const inRange = (min === null || log.value >= min) && (max === null || log.value <= max);
  if (inRange !== log.inRange) await snap.ref.update({ inRange });
  if (inRange) return;

  // Identifiant déterministe : rejouer le trigger ne crée pas de doublon.
  const ncRef = sub(rid, 'haccpNonConformities').doc(`temperature_${logId}`);
  const gap = max !== null && log.value > max ? log.value - max : min !== null ? min - log.value : 0;
  const nc: Omit<HaccpNonConformity, 'declaredAt'> & { declaredAt: FieldValue } = {
    title: `Température hors seuil : ${equipment.name}`,
    description: `Relevé de ${pdfNumber(log.value, 1)} °C pour une plage attendue de ${min ?? '—'} à ${max ?? '—'} °C.${log.comment ? ` ${log.comment}` : ''}`,
    severity: gap >= 5 ? 'critical' : gap >= 2 ? 'major' : 'minor',
    status: log.correctiveAction ? 'in_progress' : 'open',
    source: { type: 'temperature', id: logId },
    correctiveActions: log.correctiveAction ? [{ text: log.correctiveAction, by: log.recordedBy, at: log.recordedAt }] : [],
    declaredBy: log.recordedBy,
    declaredAt: FieldValue.serverTimestamp(),
    resolvedBy: null,
    resolvedAt: null,
  };
  await ncRef.create(nc).catch(() => undefined);
});

// ---------------------------------------------------------------------------
// Registre PDF
// ---------------------------------------------------------------------------

interface Column {
  label: string;
  width: number;
  align?: 'left' | 'right';
}

const LEFT = 36;
const RIGHT = 559;

class Register {
  readonly pdf = new PdfDocument();
  y = 40;
  private page = 1;

  constructor(private readonly title: string) {
    this.header();
  }

  private header() {
    this.pdf.logo(LEFT, 26, 16);
    this.pdf.text(RIGHT, 38, this.title, { size: 8, color: PDF_COLORS.muted, align: 'right' });
    this.pdf.line(LEFT, 50, RIGHT, 50, { color: PDF_COLORS.border, width: 0.5 });
    this.pdf.text(RIGHT, 826, `Page ${this.page}`, { size: 7, color: PDF_COLORS.subtle, align: 'right' });
    this.y = 70;
  }

  ensure(space: number) {
    if (this.y + space > 800) {
      this.pdf.addPage();
      this.page += 1;
      this.header();
    }
  }

  section(title: string, subtitle?: string) {
    this.ensure(70);
    this.y += 10;
    this.pdf.rect(LEFT, this.y - 11, 3, 14, { fill: PDF_COLORS.brand });
    this.pdf.text(LEFT + 10, this.y, title, { size: 12, bold: true });
    if (subtitle) this.pdf.text(RIGHT, this.y, subtitle, { size: 8, color: PDF_COLORS.muted, align: 'right' });
    this.y += 14;
  }

  empty(text: string) {
    this.ensure(24);
    this.pdf.text(LEFT + 10, this.y + 10, text, { size: 8.5, color: PDF_COLORS.subtle });
    this.y += 22;
  }

  table(columns: Column[], rows: Array<{ cells: string[]; alert?: boolean }>) {
    const drawHead = () => {
      this.pdf.rect(LEFT, this.y, RIGHT - LEFT, 16, { fill: PDF_COLORS.ink });
      let x = LEFT + 6;
      for (const column of columns) {
        this.pdf.text(column.align === 'right' ? x + column.width - 12 : x, this.y + 11, column.label.toUpperCase(), {
          size: 6.8,
          bold: true,
          color: PDF_COLORS.white,
          align: column.align ?? 'left',
        });
        x += column.width;
      }
      this.y += 16;
    };
    this.ensure(40);
    drawHead();
    rows.forEach((row, index) => {
      if (this.y + 14 > 800) {
        this.ensure(40);
        drawHead();
      }
      if (row.alert) this.pdf.rect(LEFT, this.y, RIGHT - LEFT, 14, { fill: [0.99, 0.93, 0.91] });
      else if (index % 2 === 1) this.pdf.rect(LEFT, this.y, RIGHT - LEFT, 14, { fill: PDF_COLORS.surface });
      let x = LEFT + 6;
      row.cells.forEach((cell, i) => {
        const column = columns[i]!;
        const text = this.pdf.fit(cell, column.width - 10, 7.8);
        this.pdf.text(column.align === 'right' ? x + column.width - 12 : x, this.y + 10, text, {
          size: 7.8,
          align: column.align ?? 'left',
          color: row.alert && i === columns.length - 1 ? PDF_COLORS.danger : PDF_COLORS.ink,
        });
        x += column.width;
      });
      this.y += 14;
    });
    this.y += 10;
  }
}

const zDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date invalide');

function ts(value: unknown): Date | null {
  return value && typeof (value as AdminTimestamp).toDate === 'function' ? (value as AdminTimestamp).toDate() : null;
}

function dayTime(value: unknown): string {
  const date = ts(value);
  return date ? `${formatShortDay(parisDay(date))} ${parisHourMinute(date)}` : '—';
}

export const exportHaccpRegister = callable(
  z.object({
    restaurantId: zId,
    /** Nouvel export sur une période… */
    from: zDay.optional(),
    to: zDay.optional(),
    /** …ou téléchargement d'un export existant. */
    exportId: zId.optional(),
  }),
  async (data, request) => {
    const actor = await requireRestaurantAccess(request, data.restaurantId, 'haccp.manage', 'restaurants.view');
    await assertFeatureAllowed(data.restaurantId, 'haccp');

    if (data.exportId) {
      const snap = await sub(data.restaurantId, 'haccpExports').doc(data.exportId).get();
      if (!snap.exists) throw fail.notFound('Export');
      const existing = snap.data() as HaccpExport;
      const [buffer] = await storage.bucket().file(existing.file.path).download();
      return { exportId: snap.id, fileName: existing.file.name ?? 'registre-haccp.pdf', base64: buffer.toString('base64') };
    }

    if (!data.from || !data.to) throw fail.invalid('Choisissez une période.');
    if (data.from > data.to) throw fail.invalid('La date de début doit précéder la date de fin.');
    if (addDays(data.from, 92) < data.to) throw fail.invalid('La période est limitée à trois mois.');
    const start = Timestamp.fromDate(parisDateAt(data.from, 0));
    const end = Timestamp.fromDate(parisDateAt(addDays(data.to, 1), 0));

    const [restaurantSnap, equipmentsSnap, logsSnap, receptionsSnap, cleaningTasksSnap, cleaningLogsSnap, ncSnap, pestSnap, auditSnap, directorySnap] =
      await Promise.all([
        db.collection('restaurants').doc(data.restaurantId).get(),
        sub(data.restaurantId, 'haccpEquipments').get(),
        sub(data.restaurantId, 'haccpTemperatureLogs').where('recordedAt', '>=', start).where('recordedAt', '<', end).orderBy('recordedAt').get(),
        sub(data.restaurantId, 'haccpReceptions').where('receivedAt', '>=', start).where('receivedAt', '<', end).orderBy('receivedAt').get(),
        sub(data.restaurantId, 'haccpCleaningTasks').get(),
        sub(data.restaurantId, 'haccpCleaningLogs').where('doneAt', '>=', start).where('doneAt', '<', end).orderBy('doneAt').get(),
        sub(data.restaurantId, 'haccpNonConformities').where('declaredAt', '>=', start).where('declaredAt', '<', end).orderBy('declaredAt').get(),
        sub(data.restaurantId, 'haccpPestVisits').where('visitDate', '>=', data.from).where('visitDate', '<=', data.to).get(),
        sub(data.restaurantId, 'haccpAudits').where('visitDate', '>=', data.from).where('visitDate', '<=', data.to).get(),
        sub(data.restaurantId, 'staffDirectory').get(),
      ]);

    const restaurant = restaurantSnap.data() as Restaurant | undefined;
    const names = new Map<string, string>();
    for (const doc of directorySnap.docs) {
      const entry = doc.data() as StaffDirectoryEntry;
      if (entry.uid) names.set(entry.uid, entry.displayName);
    }
    const who = (uid: string | null | undefined) => (uid ? (names.get(uid) ?? 'Membre de l’équipe') : '—');
    const equipments = new Map(equipmentsSnap.docs.map((doc) => [doc.id, doc.data() as HaccpEquipment]));
    const cleaningTasks = new Map(cleaningTasksSnap.docs.map((doc) => [doc.id, doc.data() as HaccpCleaningTask]));
    const logs = logsSnap.docs.map((doc) => doc.data() as HaccpTemperatureLog);
    const receptions = receptionsSnap.docs.map((doc) => doc.data() as HaccpReception);
    const cleaningLogs = cleaningLogsSnap.docs.map((doc) => doc.data() as HaccpCleaningLog);
    const ncs = ncSnap.docs.map((doc) => doc.data() as HaccpNonConformity);

    const period = `Du ${formatShortDay(data.from)} au ${formatShortDay(data.to)}`;
    const register = new Register(`Registre HACCP · ${restaurant?.name ?? ''} · ${period}`);
    const { pdf } = register;

    // Page de garde.
    pdf.text(LEFT, 96, 'REGISTRE DU PLAN DE MAÎTRISE SANITAIRE', { size: 9, bold: true, color: PDF_COLORS.brand });
    pdf.text(LEFT, 124, restaurant?.name ?? 'Établissement', { size: 22, bold: true });
    pdf.text(LEFT, 144, period, { size: 11, color: PDF_COLORS.muted });
    if (restaurant?.address) {
      pdf.text(LEFT, 160, `${restaurant.address.line1}, ${restaurant.address.postalCode} ${restaurant.address.city}`, { size: 9, color: PDF_COLORS.muted });
    }
    const conform = logs.filter((log) => log.inRange).length;
    const kpis: Array<[string, string]> = [
      ['Relevés de température', String(logs.length)],
      ['Taux de conformité', logs.length ? `${pdfNumber((conform / logs.length) * 100, 1)} %` : '—'],
      ['Réceptions contrôlées', String(receptions.length)],
      ['Nettoyages tracés', String(cleaningLogs.length)],
      ['Non-conformités', String(ncs.length)],
      ['Non-conformités ouvertes', String(ncs.filter((nc) => nc.status !== 'resolved').length)],
    ];
    kpis.forEach(([label, value], i) => {
      const x = LEFT + (i % 3) * 176;
      const y = 186 + Math.floor(i / 3) * 70;
      pdf.rect(x, y, 164, 58, { fill: PDF_COLORS.surface, stroke: PDF_COLORS.border, radius: 6 });
      pdf.text(x + 12, y + 20, label, { size: 8, color: PDF_COLORS.muted });
      pdf.text(x + 12, y + 44, value, { size: 18, bold: true });
    });
    pdf.text(LEFT, 346, `Document généré le ${formatShortDay(parisDay(new Date()))} à ${parisHourMinute(new Date())} par ${actor.caller.name}.`, {
      size: 8,
      color: PDF_COLORS.subtle,
    });
    register.y = 370;

    register.section('Relevés de températures', `${logs.length} relevé(s)`);
    if (logs.length === 0) register.empty('Aucun relevé sur la période.');
    else {
      register.table(
        [
          { label: 'Date', width: 82 },
          { label: 'Équipement', width: 120 },
          { label: 'Valeur', width: 50, align: 'right' },
          { label: 'Seuils', width: 62 },
          { label: 'Relevé par', width: 90 },
          { label: 'Action corrective', width: 119 },
        ],
        logs.map((log) => {
          const equipment = equipments.get(log.equipmentId);
          return {
            alert: !log.inRange,
            cells: [
              dayTime(log.recordedAt),
              equipment?.name ?? log.equipmentId,
              `${pdfNumber(log.value, 1)} °C`,
              equipment ? `${equipment.minTemp ?? '—'} / ${equipment.maxTemp ?? '—'} °C` : '—',
              who(log.recordedBy),
              log.inRange ? (log.verifiedBy ? 'Conforme, vérifié' : 'Conforme') : (log.correctiveAction ?? 'Hors seuil'),
            ],
          };
        }),
      );
    }

    register.section('Contrôles à réception', `${receptions.length} livraison(s)`);
    if (receptions.length === 0) register.empty('Aucune réception sur la période.');
    else {
      register.table(
        [
          { label: 'Date', width: 82 },
          { label: 'Fournisseur', width: 100 },
          { label: 'Produit', width: 120 },
          { label: 'Lot', width: 62 },
          { label: 'DLC', width: 56 },
          { label: 'T°', width: 36, align: 'right' },
          { label: 'Décision', width: 67 },
        ],
        receptions.map((reception) => ({
          alert: reception.status === 'refused',
          cells: [
            dayTime(reception.receivedAt),
            reception.supplierName,
            reception.productName,
            reception.lotNumber ?? '—',
            reception.useByDate ? formatShortDay(reception.useByDate) : '—',
            reception.temperature !== null && reception.temperature !== undefined ? `${pdfNumber(reception.temperature, 1)}` : '—',
            reception.status === 'accepted' ? 'Accepté' : reception.status === 'refused' ? 'Refusé' : 'En attente',
          ],
        })),
      );
    }

    register.section('Plan de nettoyage', `${cleaningLogs.length} réalisation(s)`);
    if (cleaningLogs.length === 0) register.empty('Aucun nettoyage tracé sur la période.');
    else {
      register.table(
        [
          { label: 'Date', width: 82 },
          { label: 'Zone', width: 90 },
          { label: 'Tâche', width: 170 },
          { label: 'Réalisé par', width: 100 },
          { label: 'Commentaire', width: 81 },
        ],
        cleaningLogs.map((log) => {
          const task = cleaningTasks.get(log.taskId);
          return { cells: [dayTime(log.doneAt), task?.area ?? '—', task?.name ?? log.taskId, who(log.doneBy), log.comment ?? ''] };
        }),
      );
    }

    register.section('Non-conformités', `${ncs.length} déclarée(s)`);
    if (ncs.length === 0) register.empty('Aucune non-conformité sur la période.');
    else {
      register.table(
        [
          { label: 'Date', width: 82 },
          { label: 'Intitulé', width: 170 },
          { label: 'Gravité', width: 56 },
          { label: 'Statut', width: 66 },
          { label: 'Dernière action', width: 149 },
        ],
        ncs.map((nc) => ({
          alert: nc.status !== 'resolved',
          cells: [
            dayTime(nc.declaredAt),
            nc.title,
            HACCP_SEVERITY_LABELS[nc.severity],
            HACCP_NC_STATUS_LABELS[nc.status],
            nc.correctiveActions[nc.correctiveActions.length - 1]?.text ?? '—',
          ],
        })),
      );
    }

    const visits = pestSnap.docs.map((doc) => doc.data() as HaccpPestVisit);
    const audits = auditSnap.docs.map((doc) => doc.data() as HaccpAudit);
    register.section('Nuisibles et audits');
    if (visits.length + audits.length === 0) register.empty('Aucun passage ni audit sur la période.');
    else {
      register.table(
        [
          { label: 'Date', width: 70 },
          { label: 'Type', width: 90 },
          { label: 'Intervenant / intitulé', width: 150 },
          { label: 'Observations', width: 213 },
        ],
        [
          ...visits.map((visit) => ({ cells: [formatShortDay(visit.visitDate), 'Passage nuisibles', visit.provider, visit.observations ?? '—'] })),
          ...audits.map((audit) => ({
            alert: audit.result === 'non_compliant',
            cells: [formatShortDay(audit.visitDate), audit.kind === 'official' ? 'Contrôle officiel' : 'Audit interne', audit.label, audit.notes ?? '—'],
          })),
        ],
      );
    }

    const buffer = pdf.toBuffer();
    const ref = sub(data.restaurantId, 'haccpExports').doc();
    const fileName = `registre-haccp-${data.from}-${data.to}.pdf`;
    const path = `restaurants/${data.restaurantId}/haccp-exports/${ref.id}.pdf`;
    await storage.bucket().file(path).save(buffer, { resumable: false, contentType: 'application/pdf', metadata: { cacheControl: 'private, max-age=0' } });
    const record: Omit<HaccpExport, 'generatedAt' | 'file'> & { generatedAt: FieldValue; file: HaccpExport['file'] } = {
      periodStart: data.from,
      periodEnd: data.to,
      file: { path, url: null, contentType: 'application/pdf', size: buffer.length, name: fileName, uploadedAt: Timestamp.now(), uploadedBy: actor.caller.uid },
      generatedBy: actor.caller.uid,
      generatedAt: FieldValue.serverTimestamp(),
    };
    await ref.set(record);
    await writeAudit({
      actor: actorFromCaller(actor.caller, actor.kind === 'admin' ? 'admin' : 'restaurant'),
      action: 'haccp.register_exported',
      target: { type: 'restaurant', id: data.restaurantId, label: period },
      request,
    });
    return { exportId: ref.id, fileName, base64: buffer.toString('base64') };
  },
  HR_CALLABLE,
);
