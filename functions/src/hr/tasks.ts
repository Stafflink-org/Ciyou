// Tâches : statut global déduit de l'avancement de chaque assigné, et création
// de l'occurrence suivante quand une tâche récurrente est terminée.
import type { Task, TaskStatus } from '@golink/shared';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { FieldValue } from '../lib/admin';
import { HR_RUNTIME, sub } from './common';
import { addDays } from './time';

const RANK: Record<TaskStatus, number> = { todo: 0, in_progress: 1, review: 2, done: 3 };

export function globalStatus(task: Pick<Task, 'assigneeIds' | 'assigneeStatus' | 'status'>): TaskStatus {
  const statuses = task.assigneeIds.map((uid) => task.assigneeStatus?.[uid] ?? task.status);
  if (statuses.length === 0) return task.status;
  if (statuses.every((s) => s === 'done')) return 'done';
  if (statuses.every((s) => RANK[s] >= RANK.review)) return 'review';
  if (statuses.some((s) => RANK[s] > RANK.todo)) return 'in_progress';
  return 'todo';
}

function nextDueDate(due: string, frequency: 'daily' | 'weekly' | 'monthly'): string {
  if (frequency === 'daily') return addDays(due, 1);
  if (frequency === 'weekly') return addDays(due, 7);
  const [y = 1970, m = 1, d = 1] = due.split('-').map(Number);
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m, Math.min(d, last))).toISOString().slice(0, 10);
}

export const onTaskWrite = onDocumentWritten({ document: 'restaurants/{rid}/tasks/{taskId}', ...HR_RUNTIME }, async (event) => {
  const before = event.data?.before.exists ? (event.data.before.data() as Task) : null;
  const after = event.data?.after.exists ? (event.data.after.data() as Task) : null;
  if (!after || !event.data) return;
  const { rid, taskId } = event.params;

  // L'avancement individuel d'un assigné met à jour le statut global.
  const assigneesChanged = JSON.stringify(before?.assigneeStatus ?? {}) !== JSON.stringify(after.assigneeStatus ?? {});
  const computed = globalStatus(after);
  if (assigneesChanged && computed !== after.status) {
    await event.data.after.ref.update({ status: computed, updatedAt: FieldValue.serverTimestamp() });
    return;
  }

  // Tâche récurrente terminée : occurrence suivante (identifiant déterministe, sans doublon).
  if (before?.status !== 'done' && after.status === 'done' && after.recurrence) {
    const base = after.dueDate ?? new Date().toISOString().slice(0, 10);
    const due = nextDueDate(base, after.recurrence.frequency);
    if (after.recurrence.until && due > after.recurrence.until) return;
    const nextRef = sub(rid, 'tasks').doc(`${taskId.split('--')[0]}--${due}`);
    await nextRef
      .create({
        title: after.title,
        description: after.description ?? null,
        priority: after.priority,
        status: 'todo',
        dueDate: due,
        tags: after.tags,
        assigneeIds: after.assigneeIds,
        assigneeStatus: Object.fromEntries(after.assigneeIds.map((uid) => [uid, 'todo'])),
        templateId: after.templateId ?? null,
        recurrence: after.recurrence,
        createdAt: FieldValue.serverTimestamp(),
        createdBy: 'system',
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: 'system',
      })
      .catch(() => undefined);
  }
});
