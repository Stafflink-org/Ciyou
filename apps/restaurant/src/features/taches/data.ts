import { limit, orderBy, query, where } from 'firebase/firestore';
import { paths, type ChecklistRun, type ChecklistTemplate, type Task, type TaskStatus, type TaskTemplate } from '@golink/shared';
import { useRestaurantAccess } from '@/auth/RestaurantAccess';
import { collectionAt, useCollection } from '@/lib/firestore';

export const STATUS_ORDER: TaskStatus[] = ['todo', 'in_progress', 'review', 'done'];

export function useTasks() {
  const { restaurantId } = useRestaurantAccess();
  return useCollection<Task>(query(collectionAt(paths.restaurantSub(restaurantId, 'tasks')), orderBy('createdAt', 'desc'), limit(300)));
}

export function useTaskTemplates() {
  const { restaurantId } = useRestaurantAccess();
  return useCollection<TaskTemplate>(query(collectionAt(paths.restaurantSub(restaurantId, 'taskTemplates')), orderBy('title')));
}

export function useChecklistTemplates() {
  const { restaurantId } = useRestaurantAccess();
  return useCollection<ChecklistTemplate>(query(collectionAt(paths.restaurantSub(restaurantId, 'checklistTemplates')), orderBy('order')));
}

export function useChecklistRuns(from: string, to: string) {
  const { restaurantId } = useRestaurantAccess();
  return useCollection<ChecklistRun>(
    query(collectionAt(paths.restaurantSub(restaurantId, 'checklistRuns')), where('date', '>=', from), where('date', '<=', to)),
  );
}

/** Statut affiché : celui de l'assigné connecté pour un salarié, le statut global sinon. */
export function statusFor(task: Task, uid: string | undefined, manager: boolean): TaskStatus {
  if (!manager && uid && task.assigneeIds.includes(uid)) return task.assigneeStatus[uid] ?? task.status;
  return task.status;
}
