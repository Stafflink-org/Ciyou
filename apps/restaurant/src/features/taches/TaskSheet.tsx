import { useState } from 'react';
import { addDoc, deleteDoc, doc, orderBy, query, serverTimestamp, updateDoc } from 'firebase/firestore';
import { CalendarClock, MessageSquare, Pencil, Repeat, Send, Tag, Trash2 } from 'lucide-react';
import {
  Avatar,
  Badge,
  Button,
  ConfirmDialog,
  EmptyState,
  IconButton,
  SegmentedControl,
  Sheet,
  SheetBody,
  SheetContent,
  SheetFooter,
  SheetHeader,
  Skeleton,
  StatusBadge,
  Textarea,
  formatRelative,
} from '@golink/ui';
import { SUBCOLLECTIONS, TASK_PRIORITY_LABELS, TASK_STATUS_LABELS, paths, type Task, type TaskComment, type TaskStatus, type WithId } from '@golink/shared';
import { useAuth } from '@golink/web';
import { useRestaurantAccess } from '@/auth/RestaurantAccess';
import { collectionAt, toDate, updatedFields, useCollection, useMutation } from '@/lib/firestore';
import { formatFullDay, todayIso } from '../_rh/dates';
import type { StaffDirectory } from '../_rh/hooks';
import { TASK_PRIORITY_TONE, TASK_STATUS } from '../_rh/ui';
import { STATUS_ORDER, statusFor } from './data';

const RECURRENCE_LABELS = { daily: 'Tous les jours', weekly: 'Toutes les semaines', monthly: 'Tous les mois' } as const;

/** Changement de statut : global pour un responsable, individuel pour un assigné. */
export function useTaskStatusChange() {
  const { restaurantId } = useRestaurantAccess();
  const { user } = useAuth();
  return useMutation(
    async (task: WithId<Task>, status: TaskStatus, manager: boolean) => {
      const ref = doc(collectionAt(paths.restaurantSub(restaurantId, 'tasks')), task.id);
      if (manager) {
        const assigneeStatus = Object.fromEntries(task.assigneeIds.map((uid) => [uid, status]));
        await updateDoc(ref, { status, assigneeStatus, ...updatedFields(user!.uid) });
      } else {
        await updateDoc(ref, { [`assigneeStatus.${user!.uid}`]: status, ...updatedFields(user!.uid) });
      }
      return status;
    },
    { success: (status) => `Tâche passée à « ${TASK_STATUS_LABELS[status]} »` },
  );
}

export function TaskSheet({
  task,
  onClose,
  onEdit,
  directory,
  manager,
}: {
  task: WithId<Task> | null;
  onClose: () => void;
  onEdit: (task: WithId<Task>) => void;
  directory: StaffDirectory;
  manager: boolean;
}) {
  const { restaurantId, member } = useRestaurantAccess();
  const { user } = useAuth();
  const [body, setBody] = useState('');
  const [deleteOpen, setDeleteOpen] = useState(false);
  const changeStatus = useTaskStatusChange();
  const commentsPath = task ? `${paths.restaurantSub(restaurantId, 'tasks')}/${task.id}/${SUBCOLLECTIONS.tasks.comments}` : null;
  const comments = useCollection<TaskComment>(commentsPath ? query(collectionAt(commentsPath), orderBy('createdAt')) : null);

  const post = useMutation(
    async () => {
      if (!commentsPath || !user) return false;
      await addDoc(collectionAt(commentsPath), { authorId: user.uid, authorName: member.displayName || user.displayName || 'Membre', body: body.trim(), createdAt: serverTimestamp() });
      return true;
    },
    { success: 'Commentaire publié' },
  );
  const remove = useMutation(
    async () => {
      if (!task) return;
      await deleteDoc(doc(collectionAt(paths.restaurantSub(restaurantId, 'tasks')), task.id));
    },
    { success: 'Tâche supprimée' },
  );

  const isAssignee = Boolean(task && user && task.assigneeIds.includes(user.uid));
  const canChange = manager || isAssignee;
  const current = task ? statusFor(task, user?.uid, manager) : 'todo';
  const overdue = task?.dueDate && task.dueDate < todayIso() && task.status !== 'done';

  return (
    <Sheet open={task !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="sm:max-w-lg">
        {task && (
          <>
            <SheetHeader title={task.title} description={task.description ?? undefined} />
            <SheetBody className="space-y-5">
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge status={task.status} map={TASK_STATUS} />
                <Badge tone={TASK_PRIORITY_TONE[task.priority]}>Priorité {TASK_PRIORITY_LABELS[task.priority].toLowerCase()}</Badge>
                {task.recurrence && (
                  <Badge tone="neutral" icon={<Repeat />}>
                    {RECURRENCE_LABELS[task.recurrence.frequency]}
                  </Badge>
                )}
              </div>
              {task.dueDate && (
                <p className={overdue ? 'flex items-center gap-2 text-sm font-medium text-danger' : 'flex items-center gap-2 text-sm text-fg'}>
                  <CalendarClock className="size-4" /> Échéance : {formatFullDay(task.dueDate)}
                  {overdue && ' · en retard'}
                </p>
              )}
              {task.tags.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5">
                  <Tag className="size-3.5 text-fg-subtle" />
                  {task.tags.map((tag) => (
                    <Badge key={tag} tone="neutral" variant="outline" size="sm">
                      {tag}
                    </Badge>
                  ))}
                </div>
              )}

              {canChange && (
                <div>
                  <p className="eyebrow mb-2">{manager ? 'Statut de la tâche' : 'Mon avancement'}</p>
                  <SegmentedControl
                    aria-label="Statut"
                    value={current}
                    onValueChange={(v) => void changeStatus.mutate(task, v as TaskStatus, manager)}
                    options={STATUS_ORDER.map((s) => ({ value: s, label: TASK_STATUS_LABELS[s] }))}
                  />
                </div>
              )}

              <div>
                <p className="eyebrow mb-2">Assignés</p>
                {task.assigneeIds.length === 0 ? (
                  <p className="text-sm text-fg-subtle">Personne n’est assigné.</p>
                ) : (
                  <ul className="space-y-2">
                    {task.assigneeIds.map((uid) => (
                      <li key={uid} className="flex items-center justify-between gap-3">
                        <span className="flex items-center gap-2">
                          <Avatar name={directory.nameOfUid(uid)} size="xs" />
                          <span className="text-sm text-fg">{directory.nameOfUid(uid)}</span>
                        </span>
                        <StatusBadge status={task.assigneeStatus[uid] ?? task.status} map={TASK_STATUS} />
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div>
                <p className="eyebrow mb-2 flex items-center gap-1.5">
                  <MessageSquare className="size-3.5" /> Commentaires
                </p>
                {comments.loading ? (
                  <Skeleton className="h-12" />
                ) : comments.data.length === 0 ? (
                  <EmptyState compact title="Aucun commentaire" description="Signalez un avancement ou une difficulté à l’équipe." />
                ) : (
                  <ul className="space-y-3">
                    {comments.data.map((comment) => {
                      const at = toDate(comment.createdAt);
                      return (
                        <li key={comment.id} className="flex gap-2.5">
                          <Avatar name={comment.authorName} size="xs" className="mt-0.5" />
                          <div className="min-w-0 flex-1 rounded-xl bg-surface-2 px-3 py-2">
                            <p className="text-xs">
                              <span className="font-medium text-fg">{comment.authorName}</span>
                              {at && <span className="ml-2 text-fg-subtle">{formatRelative(at)}</span>}
                            </p>
                            <p className="mt-0.5 whitespace-pre-wrap text-sm text-fg">{comment.body}</p>
                          </div>
                          {(comment.authorId === user?.uid || manager) && (
                            <IconButton
                              label="Supprimer le commentaire"
                              size="xs"
                              variant="danger"
                              onClick={() => commentsPath && void deleteDoc(doc(collectionAt(commentsPath), comment.id))}
                            >
                              <Trash2 />
                            </IconButton>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
                <div className="mt-3 flex items-end gap-2">
                  <Textarea rows={2} value={body} onChange={(e) => setBody(e.target.value)} maxLength={2000} placeholder="Écrire un commentaire…" className="min-h-0" />
                  <IconButton
                    label="Publier le commentaire"
                    variant="primary"
                    disabled={body.trim().length === 0 || post.loading}
                    onClick={async () => {
                      if (await post.mutate()) setBody('');
                    }}
                  >
                    <Send />
                  </IconButton>
                </div>
              </div>
            </SheetBody>
            {manager && (
              <SheetFooter className="sm:justify-between">
                <Button variant="danger-soft" leftIcon={<Trash2 />} onClick={() => setDeleteOpen(true)}>
                  Supprimer
                </Button>
                <Button leftIcon={<Pencil />} onClick={() => onEdit(task)}>
                  Modifier
                </Button>
              </SheetFooter>
            )}
            <ConfirmDialog
              open={deleteOpen}
              onOpenChange={setDeleteOpen}
              title="Supprimer cette tâche ?"
              description="La tâche et ses commentaires disparaissent pour toute l’équipe."
              confirmLabel="Supprimer"
              destructive
              onConfirm={async () => {
                await remove.mutate();
                onClose();
              }}
            />
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
