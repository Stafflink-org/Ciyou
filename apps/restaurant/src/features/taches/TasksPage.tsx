import { useMemo, useState, type DragEvent } from 'react';
import { AlarmClock, CheckCircle2, CircleDashed, ListChecks, Plus, Repeat, Timer } from 'lucide-react';
import {
  AvatarGroup,
  Badge,
  Button,
  EmptyState,
  PageContainer,
  PageHeader,
  SegmentedControl,
  Skeleton,
  StatCard,
  StatusPill,
  cn,
} from '@golink/ui';
import { TASK_PRIORITY_LABELS, TASK_STATUS_LABELS, type Task, type TaskStatus, type WithId } from '@golink/shared';
import { useAuth, useDocumentTitle } from '@golink/web';
import { useCan } from '@/auth/RestaurantAccess';
import { addDays, formatDayMonth, mondayOf, todayIso } from '../_rh/dates';
import { useStaffDirectory } from '../_rh/hooks';
import { ErrorCard, SubNav, TASK_PRIORITY_TONE, TASK_STATUS } from '../_rh/ui';
import { STATUS_ORDER, statusFor, useTaskTemplates, useTasks } from './data';
import { TASK_NAV } from './nav';
import { TaskFormSheet } from './TaskFormSheet';
import { TaskSheet, useTaskStatusChange } from './TaskSheet';

const PRIORITY_RANK = { urgent: 0, high: 1, medium: 2, low: 3 } as const;

function TaskCard({ task, status, onOpen, draggable, names }: { task: WithId<Task>; status: TaskStatus; onOpen: () => void; draggable: boolean; names: string[] }) {
  const today = todayIso();
  const overdue = task.dueDate && task.dueDate < today && status !== 'done';
  return (
    <button
      type="button"
      draggable={draggable}
      onDragStart={(event: DragEvent) => event.dataTransfer.setData('text/golink-task', task.id)}
      onClick={onOpen}
      className={cn(
        'w-full rounded-xl border border-border bg-surface p-3.5 text-left shadow-xs transition-[box-shadow,border-color] hover:border-border-strong hover:shadow-md',
        'focus-visible:outline-2 focus-visible:outline-ring',
        draggable && 'cursor-grab active:cursor-grabbing',
        status === 'done' && 'opacity-75',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <p className={cn('text-sm font-medium text-fg', status === 'done' && 'line-through decoration-fg-subtle')}>{task.title}</p>
        {task.recurrence && <Repeat className="mt-0.5 size-3.5 shrink-0 text-fg-subtle" aria-label="Tâche récurrente" />}
      </div>
      {task.tags.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {task.tags.slice(0, 3).map((tag) => (
            <Badge key={tag} tone="neutral" variant="outline" size="sm">
              {tag}
            </Badge>
          ))}
        </div>
      )}
      <div className="mt-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <Badge tone={TASK_PRIORITY_TONE[task.priority]} size="sm">
            {TASK_PRIORITY_LABELS[task.priority]}
          </Badge>
          {task.dueDate && (
            <span className={cn('inline-flex items-center gap-1 text-2xs font-medium', overdue ? 'text-danger' : 'text-fg-subtle')}>
              <AlarmClock className="size-3" />
              {task.dueDate === today ? 'Aujourd’hui' : formatDayMonth(task.dueDate)}
            </span>
          )}
        </div>
        {names.length > 0 && <AvatarGroup names={names} size="xs" max={3} />}
      </div>
    </button>
  );
}

export function TasksPage() {
  useDocumentTitle('Tâches · Ciyou Eats Restaurant');
  const can = useCan();
  const manager = can('tasks.manage');
  const { user } = useAuth();
  const directory = useStaffDirectory();
  const tasks = useTasks();
  const templates = useTaskTemplates();
  const changeStatus = useTaskStatusChange();
  const [scope, setScope] = useState<'all' | 'mine'>(manager ? 'all' : 'mine');
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<WithId<Task> | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [dropColumn, setDropColumn] = useState<TaskStatus | null>(null);
  const today = todayIso();

  const visible = useMemo(
    () => tasks.data.filter((t) => scope === 'all' || (user && t.assigneeIds.includes(user.uid))),
    [tasks.data, scope, user],
  );
  const columns = STATUS_ORDER.map((status) => ({
    status,
    items: visible
      .filter((t) => statusFor(t, user?.uid, manager) === status)
      .sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999')),
  }));
  const overdue = visible.filter((t) => t.dueDate && t.dueDate < today && t.status !== 'done').length;
  const weekStart = mondayOf(today);
  const doneThisWeek = visible.filter((t) => t.status === 'done' && (t.dueDate ?? '') >= weekStart && (t.dueDate ?? '') <= addDays(weekStart, 6)).length;
  const selected = tasks.data.find((t) => t.id === openId) ?? null;

  function drop(event: DragEvent, status: TaskStatus) {
    event.preventDefault();
    setDropColumn(null);
    const task = tasks.data.find((t) => t.id === event.dataTransfer.getData('text/golink-task'));
    if (!task) return;
    const allowed = manager || (user && task.assigneeIds.includes(user.uid));
    if (allowed && statusFor(task, user?.uid, manager) !== status) void changeStatus.mutate(task, status, manager);
  }

  return (
    <PageContainer wide>
      <PageHeader
        eyebrow="Équipe & RH"
        title="Tâches"
        description="Répartissez le travail de l’équipe, suivez l’avancement et échangez sur chaque tâche."
        actions={
          manager ? (
            <Button
              variant="primary"
              leftIcon={<Plus />}
              onClick={() => {
                setEditing(null);
                setFormOpen(true);
              }}
            >
              Nouvelle tâche
            </Button>
          ) : undefined
        }
      >
        <SubNav items={TASK_NAV.filter((item) => manager || item.to !== '/equipe/taches/modeles')} />
      </PageHeader>

      {tasks.error && <ErrorCard error={tasks.error} />}

      <div className="mb-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="À faire" value={String(columns[0]?.items.length ?? 0)} icon={<CircleDashed />} tone="neutral" loading={tasks.loading} />
        <StatCard label="En cours" value={String((columns[1]?.items.length ?? 0) + (columns[2]?.items.length ?? 0))} icon={<Timer />} tone="info" loading={tasks.loading} footer={`Dont ${columns[2]?.items.length ?? 0} à vérifier`} />
        <StatCard label="En retard" value={String(overdue)} icon={<AlarmClock />} tone={overdue ? 'danger' : 'success'} loading={tasks.loading} footer="Échéance dépassée, non terminées." />
        <StatCard label="Terminées cette semaine" value={String(doneThisWeek)} icon={<CheckCircle2 />} tone="success" loading={tasks.loading} />
      </div>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <SegmentedControl
          aria-label="Tâches affichées"
          value={scope}
          onValueChange={(v) => setScope(v as 'all' | 'mine')}
          options={[
            { value: 'all', label: 'Toute l’équipe', count: tasks.data.length },
            { value: 'mine', label: 'Mes tâches', count: user ? tasks.data.filter((t) => t.assigneeIds.includes(user.uid)).length : 0 },
          ]}
        />
        <p className="hidden text-xs text-fg-subtle sm:block">Glissez une carte d’une colonne à l’autre pour changer son statut.</p>
      </div>

      {tasks.loading ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {STATUS_ORDER.map((s) => (
            <Skeleton key={s} className="h-72 rounded-xl" />
          ))}
        </div>
      ) : visible.length === 0 ? (
        <div className="rounded-xl border border-border bg-surface shadow-card">
          <EmptyState
            icon={<ListChecks />}
            title={scope === 'mine' ? 'Aucune tâche ne vous est assignée' : 'Aucune tâche pour le moment'}
            description="Créez des tâches ponctuelles ou récurrentes et assignez-les aux membres de l’équipe."
            action={
              manager ? (
                <Button variant="primary" leftIcon={<Plus />} onClick={() => setFormOpen(true)}>
                  Créer une tâche
                </Button>
              ) : undefined
            }
          />
        </div>
      ) : (
        <div className="-mx-4 flex snap-x gap-4 overflow-x-auto px-4 pb-2 sm:mx-0 sm:px-0 xl:grid xl:grid-cols-4 xl:overflow-visible">
          {columns.map(({ status, items }) => (
            <section
              key={status}
              aria-label={TASK_STATUS_LABELS[status]}
              onDragOver={(event) => {
                event.preventDefault();
                setDropColumn(status);
              }}
              onDragLeave={() => setDropColumn((c) => (c === status ? null : c))}
              onDrop={(event) => drop(event, status)}
              className={cn(
                'flex w-[82vw] max-w-[320px] shrink-0 snap-start flex-col rounded-xl border border-border bg-surface-2 sm:w-[300px] xl:w-auto xl:max-w-none',
                dropColumn === status && 'border-primary/50 bg-primary-soft/40',
              )}
            >
              <header className="flex items-center justify-between px-3.5 py-3">
                <StatusPill tone={TASK_STATUS[status].tone}>{TASK_STATUS_LABELS[status]}</StatusPill>
                <span className="font-mono text-xs text-fg-subtle num">{items.length}</span>
              </header>
              <div className="flex min-h-24 flex-1 flex-col gap-2.5 px-2.5 pb-3">
                {items.map((task) => (
                  <TaskCard
                    key={task.id}
                    task={task}
                    status={status}
                    draggable={manager || Boolean(user && task.assigneeIds.includes(user.uid))}
                    names={task.assigneeIds.map((uid) => directory.nameOfUid(uid))}
                    onOpen={() => setOpenId(task.id)}
                  />
                ))}
                {items.length === 0 && <p className="px-2 py-6 text-center text-xs text-fg-subtle">Aucune tâche</p>}
              </div>
            </section>
          ))}
        </div>
      )}

      <TaskSheet
        task={selected}
        onClose={() => setOpenId(null)}
        onEdit={(task) => {
          setOpenId(null);
          setEditing(task);
          setFormOpen(true);
        }}
        directory={directory}
        manager={manager}
      />
      {manager && <TaskFormSheet open={formOpen} onOpenChange={setFormOpen} task={editing} templates={templates.data} directory={directory} />}
    </PageContainer>
  );
}
