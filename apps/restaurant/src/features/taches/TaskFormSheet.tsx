import { useEffect, useState } from 'react';
import { addDoc, doc, updateDoc } from 'firebase/firestore';
import { ListPlus, Pencil } from 'lucide-react';
import {
  Button,
  Combobox,
  FormField,
  Input,
  Select,
  Sheet,
  SheetBody,
  SheetContent,
  SheetFooter,
  SheetHeader,
  Textarea,
} from '@golink/ui';
import { TASK_PRIORITIES, TASK_PRIORITY_LABELS, paths, type Task, type TaskPriority, type TaskTemplate, type WithId } from '@golink/shared';
import { useAuth } from '@golink/web';
import { useRestaurantAccess } from '@/auth/RestaurantAccess';
import { collectionAt, createdFields, updatedFields, useMutation } from '@/lib/firestore';
import { addDays, todayIso } from '../_rh/dates';
import type { StaffDirectory } from '../_rh/hooks';

type Recurrence = 'none' | 'daily' | 'weekly' | 'monthly';

export function TaskFormSheet({
  open,
  onOpenChange,
  task,
  templates,
  directory,
  initialTemplate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  task?: WithId<Task> | null;
  templates: WithId<TaskTemplate>[];
  directory: StaffDirectory;
  initialTemplate?: WithId<TaskTemplate> | null;
}) {
  const { restaurantId } = useRestaurantAccess();
  const { user } = useAuth();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<TaskPriority>('medium');
  const [dueDate, setDueDate] = useState('');
  const [assignees, setAssignees] = useState<string[]>([]);
  const [tags, setTags] = useState('');
  const [recurrence, setRecurrence] = useState<Recurrence>('none');
  const [templateId, setTemplateId] = useState<string | null>(null);

  function applyTemplate(template: WithId<TaskTemplate>) {
    setTitle(template.title);
    setDescription(template.description ?? '');
    setPriority(template.priority);
    setTags(template.tags.join(', '));
    setDueDate(template.dueOffsetDays !== null && template.dueOffsetDays !== undefined ? addDays(todayIso(), template.dueOffsetDays) : '');
    setTemplateId(template.id);
  }

  useEffect(() => {
    if (!open) return;
    setTitle(task?.title ?? '');
    setDescription(task?.description ?? '');
    setPriority(task?.priority ?? 'medium');
    setDueDate(task?.dueDate ?? '');
    setAssignees(task?.assigneeIds ?? []);
    setTags(task?.tags.join(', ') ?? '');
    setRecurrence(task?.recurrence?.frequency ?? 'none');
    setTemplateId(task?.templateId ?? null);
    if (!task && initialTemplate) applyTemplate(initialTemplate);
  }, [open, task, initialTemplate]);

  const people = directory.entries.filter((e) => e.uid && e.active);

  const save = useMutation(
    async () => {
      const tagList = [...new Set(tags.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean))].slice(0, 8);
      const base = {
        title: title.trim(),
        description: description.trim() || null,
        priority,
        dueDate: dueDate || null,
        tags: tagList,
        assigneeIds: assignees,
        recurrence: recurrence === 'none' ? null : { frequency: recurrence, until: null },
        templateId,
      };
      const collection = collectionAt(paths.restaurantSub(restaurantId, 'tasks'));
      if (task) {
        // Les nouveaux assignés démarrent au statut global de la tâche.
        const assigneeStatus = Object.fromEntries(assignees.map((uid) => [uid, task.assigneeStatus[uid] ?? task.status]));
        await updateDoc(doc(collection, task.id), { ...base, assigneeStatus, ...updatedFields(user!.uid) });
      } else {
        await addDoc(collection, {
          ...base,
          status: 'todo',
          assigneeStatus: Object.fromEntries(assignees.map((uid) => [uid, 'todo'])),
          ...createdFields(user!.uid),
        });
      }
      return true;
    },
    { success: task ? 'Tâche mise à jour' : 'Tâche créée' },
  );

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-lg">
        <SheetHeader icon={task ? <Pencil /> : <ListPlus />} title={task ? 'Modifier la tâche' : 'Nouvelle tâche'} description="Assignez, fixez une échéance et suivez l’avancement." />
        <SheetBody className="space-y-4">
          {!task && templates.length > 0 && (
            <FormField label="Partir d’un modèle">
              <Select
                value={templateId ?? ''}
                onValueChange={(id) => {
                  const template = templates.find((t) => t.id === id);
                  if (template) applyTemplate(template);
                }}
                placeholder="Choisir un modèle (facultatif)"
                options={templates.filter((t) => t.active).map((t) => ({ value: t.id, label: t.title }))}
              />
            </FormField>
          )}
          <FormField label="Intitulé" required>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} placeholder="Ex. inventaire de la chambre froide" />
          </FormField>
          <FormField label="Description">
            <Textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={2000} />
          </FormField>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Priorité">
              <Select value={priority} onValueChange={(v) => setPriority(v as TaskPriority)} options={TASK_PRIORITIES.map((p) => ({ value: p, label: TASK_PRIORITY_LABELS[p] }))} />
            </FormField>
            <FormField label="Échéance">
              <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </FormField>
          </div>
          <FormField label="Assignée à" hint="Seuls les membres disposant d’un compte Ciyou Eats peuvent être assignés.">
            <Combobox
              multiple
              value={assignees}
              onChange={setAssignees}
              options={people.map((p) => ({ value: p.uid!, label: p.displayName, description: p.position ?? undefined }))}
              placeholder="Choisir les personnes"
              searchPlaceholder="Rechercher…"
            />
          </FormField>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Étiquettes" hint="Séparées par des virgules.">
              <Input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="hygiène, stock" />
            </FormField>
            <FormField label="Récurrence">
              <Select
                value={recurrence}
                onValueChange={(v) => setRecurrence(v as Recurrence)}
                options={[
                  { value: 'none', label: 'Ponctuelle' },
                  { value: 'daily', label: 'Tous les jours' },
                  { value: 'weekly', label: 'Toutes les semaines' },
                  { value: 'monthly', label: 'Tous les mois' },
                ]}
              />
            </FormField>
          </div>
        </SheetBody>
        <SheetFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Annuler
          </Button>
          <Button
            variant="primary"
            loading={save.loading}
            disabled={title.trim().length < 2}
            onClick={async () => {
              if (await save.mutate()) onOpenChange(false);
            }}
          >
            {task ? 'Enregistrer' : 'Créer la tâche'}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
