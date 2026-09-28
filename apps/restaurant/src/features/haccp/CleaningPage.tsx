import { useEffect, useMemo, useState } from 'react';
import { addDoc, doc, serverTimestamp, updateDoc } from 'firebase/firestore';
import { Check, History, Pencil, Plus, SprayCan } from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  EmptyState,
  FormField,
  IconButton,
  Input,
  PageContainer,
  Select,
  Skeleton,
  StatCard,
  Switch,
  Textarea,
  cn,
  formatDateTime,
  formatRelative,
} from '@golink/ui';
import { HACCP_CLEANING_FREQUENCIES, HACCP_FREQUENCY_LABELS, paths, type HaccpCleaningFrequency, type HaccpCleaningTask, type WithId } from '@golink/shared';
import { useAuth, useDocumentTitle } from '@golink/web';
import { useCan, useRestaurantAccess } from '@/auth/RestaurantAccess';
import { collectionAt, createdFields, toDate, updatedFields, useMutation } from '@/lib/firestore';
import { useStaffDirectory } from '../_rh/hooks';
import { ErrorCard } from '../_rh/ui';
import { cleaningDue, useCleaningLogs, useCleaningTasks } from './data';
import { HaccpHeader } from './layout';

function TaskDialog({ open, onClose, task, employees }: { open: boolean; onClose: () => void; task: WithId<HaccpCleaningTask> | null; employees: Array<{ id: string; name: string }> }) {
  const { restaurantId } = useRestaurantAccess();
  const { user } = useAuth();
  const [name, setName] = useState('');
  const [area, setArea] = useState('Cuisine');
  const [frequency, setFrequency] = useState<HaccpCleaningFrequency>('daily');
  const [product, setProduct] = useState('');
  const [method, setMethod] = useState('');
  const [assigned, setAssigned] = useState('none');
  const [active, setActive] = useState(true);
  useEffect(() => {
    if (!open) return;
    setName(task?.name ?? '');
    setArea(task?.area ?? 'Cuisine');
    setFrequency(task?.frequency ?? 'daily');
    setProduct(task?.product ?? '');
    setMethod(task?.method ?? '');
    setAssigned(task?.assignedEmployeeId ?? 'none');
    setActive(task?.active ?? true);
  }, [open, task]);
  const save = useMutation(
    async () => {
      const data = {
        name: name.trim(),
        area: area.trim() || 'Cuisine',
        frequency,
        product: product.trim() || null,
        method: method.trim() || null,
        assignedEmployeeId: assigned === 'none' ? null : assigned,
        active,
      };
      const collection = collectionAt(paths.restaurantSub(restaurantId, 'haccpCleaningTasks'));
      if (task) await updateDoc(doc(collection, task.id), { ...data, ...updatedFields(user!.uid) });
      else await addDoc(collection, { ...data, ...createdFields(user!.uid) });
      return true;
    },
    { success: 'Plan de nettoyage mis à jour' },
  );
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent size="md">
        <DialogHeader icon={<SprayCan />} title={task ? 'Modifier la tâche de nettoyage' : 'Nouvelle tâche de nettoyage'} description="Zone, fréquence, produit et méthode à appliquer." />
        <DialogBody className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Élément à nettoyer" required>
              <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder="Plans de travail" />
            </FormField>
            <FormField label="Zone">
              <Input value={area} onChange={(e) => setArea(e.target.value)} maxLength={40} />
            </FormField>
            <FormField label="Fréquence">
              <Select value={frequency} onValueChange={(v) => setFrequency(v as HaccpCleaningFrequency)} options={HACCP_CLEANING_FREQUENCIES.map((f) => ({ value: f, label: HACCP_FREQUENCY_LABELS[f] }))} />
            </FormField>
            <FormField label="Responsable">
              <Select value={assigned} onValueChange={setAssigned} options={[{ value: 'none', label: 'Toute l’équipe' }, ...employees.map((e) => ({ value: e.id, label: e.name }))]} />
            </FormField>
          </div>
          <FormField label="Produit">
            <Input value={product} onChange={(e) => setProduct(e.target.value)} maxLength={80} placeholder="Détergent désinfectant alimentaire" />
          </FormField>
          <FormField label="Méthode">
            <Textarea rows={2} value={method} onChange={(e) => setMethod(e.target.value)} maxLength={300} placeholder="Nettoyer, rincer, désinfecter, laisser sécher." />
          </FormField>
          <Switch label="Active" checked={active} onCheckedChange={setActive} />
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Annuler
          </Button>
          <Button
            variant="primary"
            loading={save.loading}
            disabled={name.trim().length < 2}
            onClick={async () => {
              if (await save.mutate()) onClose();
            }}
          >
            Enregistrer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function CleaningPage() {
  useDocumentTitle('Nettoyage · HACCP · Ciyou Eats Restaurant');
  const can = useCan();
  const manage = can('haccp.manage');
  const { restaurantId } = useRestaurantAccess();
  const { user } = useAuth();
  const directory = useStaffDirectory();
  const tasks = useCleaningTasks();
  const logs = useCleaningLogs(31);
  const [editing, setEditing] = useState<WithId<HaccpCleaningTask> | 'new' | null>(null);
  const [showInactive, setShowInactive] = useState(false);

  const done = useMutation(
    async (task: WithId<HaccpCleaningTask>) => {
      await addDoc(collectionAt(paths.restaurantSub(restaurantId, 'haccpCleaningLogs')), { taskId: task.id, doneBy: user!.uid, doneAt: serverTimestamp(), comment: null });
      return task.name;
    },
    { success: (name) => `« ${name} » tracé au registre` },
  );

  const lastDone = (taskId: string) => {
    const log = logs.data.find((l) => l.taskId === taskId);
    return log ? { at: toDate(log.doneAt), by: log.doneBy } : null;
  };
  const visible = tasks.data.filter((t) => showInactive || t.active);
  const areas = useMemo(() => [...new Set(visible.map((t) => t.area))], [visible]);
  const due = tasks.data.filter((t) => t.active && cleaningDue(t, lastDone(t.id)?.at ?? null));
  const todayCount = logs.data.filter((l) => toDate(l.doneAt)?.toDateString() === new Date().toDateString()).length;
  const employees = directory.employees.filter((e) => e.active).map((e) => ({ id: e.employeeId ?? e.id, name: e.displayName }));

  return (
    <PageContainer wide>
      <HaccpHeader
        title="Plan de nettoyage"
        description="Ce qui doit être nettoyé, à quelle fréquence, avec quel produit. Chaque réalisation est tracée."
        actions={
          manage ? (
            <Button variant="primary" leftIcon={<Plus />} onClick={() => setEditing('new')}>
              Nouvelle tâche
            </Button>
          ) : undefined
        }
      />
      {(tasks.error || logs.error) && <ErrorCard error={tasks.error ?? logs.error} />}
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <StatCard label="À réaliser maintenant" value={String(due.length)} icon={<SprayCan />} tone={due.length ? 'amber' : 'success'} loading={tasks.loading || logs.loading} />
        <StatCard label="Réalisés aujourd’hui" value={String(todayCount)} icon={<Check />} tone="success" loading={logs.loading} />
        <StatCard label="Tâches au plan" value={String(tasks.data.filter((t) => t.active).length)} icon={<History />} tone="info" loading={tasks.loading} />
      </div>

      {manage && tasks.data.some((t) => !t.active) && (
        <div className="mb-4 flex justify-end">
          <Switch size="sm" label="Afficher les tâches inactives" checked={showInactive} onCheckedChange={setShowInactive} />
        </div>
      )}

      {tasks.loading || logs.loading ? (
        <Skeleton className="h-64 rounded-xl" />
      ) : visible.length === 0 ? (
        <Card>
          <EmptyState
            icon={<SprayCan />}
            title="Aucune tâche au plan de nettoyage"
            description="Listez les surfaces et équipements à nettoyer avec leur fréquence."
            action={
              manage ? (
                <Button variant="primary" leftIcon={<Plus />} onClick={() => setEditing('new')}>
                  Nouvelle tâche
                </Button>
              ) : undefined
            }
          />
        </Card>
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          {areas.map((area) => (
            <Card key={area}>
              <CardHeader icon={<SprayCan />} title={area} description={`${visible.filter((t) => t.area === area).length} tâche(s)`} divided />
              <ul className="divide-y divide-border">
                {visible
                  .filter((t) => t.area === area)
                  .map((task) => {
                    const last = lastDone(task.id);
                    const isDue = task.active && cleaningDue(task, last?.at ?? null);
                    const owner = task.assignedEmployeeId ? directory.byEmployeeId.get(task.assignedEmployeeId)?.displayName : null;
                    return (
                      <li key={task.id} className="flex flex-col gap-3 px-5 py-3.5 sm:flex-row sm:items-center">
                        <div className="min-w-0 flex-1">
                          <p className={cn('text-sm font-medium', task.active ? 'text-fg' : 'text-fg-subtle line-through')}>{task.name}</p>
                          <p className="mt-0.5 text-xs text-fg-subtle">
                            {HACCP_FREQUENCY_LABELS[task.frequency]}
                            {task.product ? ` · ${task.product}` : ''}
                            {owner ? ` · ${owner}` : ''}
                          </p>
                          <p className="mt-1 text-2xs text-fg-subtle" title={last?.at ? formatDateTime(last.at) : undefined}>
                            {last?.at ? `Dernier : ${formatRelative(last.at)} par ${directory.nameOfUid(last.by)}` : 'Jamais réalisé'}
                          </p>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          {task.active && <Badge tone={isDue ? 'amber' : 'success'}>{isDue ? 'À faire' : 'À jour'}</Badge>}
                          {task.active && (
                            <Button size="sm" variant={isDue ? 'primary' : 'secondary'} leftIcon={<Check />} loading={done.loading} onClick={() => void done.mutate(task)}>
                              Fait
                            </Button>
                          )}
                          {manage && (
                            <IconButton label={`Modifier ${task.name}`} size="sm" onClick={() => setEditing(task)}>
                              <Pencil />
                            </IconButton>
                          )}
                        </div>
                      </li>
                    );
                  })}
              </ul>
            </Card>
          ))}
        </div>
      )}

      {logs.data.length > 0 && (
        <Card className="mt-6">
          <CardHeader icon={<History />} title="Traçabilité récente" description="Dernières réalisations enregistrées." divided />
          <ul className="divide-y divide-border">
            {logs.data.slice(0, 12).map((log) => {
              const task = tasks.data.find((t) => t.id === log.taskId);
              const at = toDate(log.doneAt);
              return (
                <li key={log.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-2.5 text-sm">
                  <span className="text-fg">
                    {task?.name ?? 'Tâche'} <span className="text-fg-subtle">· {task?.area}</span>
                  </span>
                  <span className="text-xs text-fg-muted">
                    {directory.nameOfUid(log.doneBy)} · {at ? formatDateTime(at) : '—'}
                  </span>
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      {manage && <TaskDialog open={editing !== null} task={editing === 'new' ? null : editing} onClose={() => setEditing(null)} employees={employees} />}
    </PageContainer>
  );
}
