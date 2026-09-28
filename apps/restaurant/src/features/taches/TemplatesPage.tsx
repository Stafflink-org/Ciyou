import { useEffect, useState } from 'react';
import { addDoc, deleteDoc, doc, updateDoc } from 'firebase/firestore';
import { ArrowDown, ArrowUp, ClipboardCheck, ListPlus, Pencil, Plus, ShieldAlert, Trash2, X } from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  Checkbox,
  ConfirmDialog,
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
  PageHeader,
  Select,
  Skeleton,
  Switch,
  Textarea,
  TimeInput,
  cn,
} from '@golink/ui';
import {
  CHECKLIST_KINDS,
  CHECKLIST_KIND_LABELS,
  TASK_PRIORITIES,
  TASK_PRIORITY_LABELS,
  paths,
  type ChecklistItem,
  type ChecklistKind,
  type ChecklistTemplate,
  type TaskPriority,
  type TaskTemplate,
  type WithId,
} from '@golink/shared';
import { useAuth, useDocumentTitle } from '@golink/web';
import { useCan, useRestaurantAccess } from '@/auth/RestaurantAccess';
import { collectionAt, createdFields, updatedFields, useMutation } from '@/lib/firestore';
import { useStaffDirectory } from '../_rh/hooks';
import { ErrorCard, SubNav, TASK_PRIORITY_TONE } from '../_rh/ui';
import { useChecklistTemplates, useTaskTemplates } from './data';
import { TASK_NAV } from './nav';
import { TaskFormSheet } from './TaskFormSheet';

const DAYS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];

function TaskTemplateDialog({ template, open, onClose }: { template: WithId<TaskTemplate> | null; open: boolean; onClose: () => void }) {
  const { restaurantId } = useRestaurantAccess();
  const { user } = useAuth();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<TaskPriority>('medium');
  const [tags, setTags] = useState('');
  const [offset, setOffset] = useState('');
  useEffect(() => {
    if (!open) return;
    setTitle(template?.title ?? '');
    setDescription(template?.description ?? '');
    setPriority(template?.priority ?? 'medium');
    setTags(template?.tags.join(', ') ?? '');
    setOffset(template?.dueOffsetDays !== null && template?.dueOffsetDays !== undefined ? String(template.dueOffsetDays) : '');
  }, [open, template]);
  const save = useMutation(
    async () => {
      const data = {
        title: title.trim(),
        description: description.trim() || null,
        priority,
        tags: [...new Set(tags.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean))].slice(0, 8),
        dueOffsetDays: offset === '' ? null : Math.max(0, Math.min(365, Number(offset) || 0)),
        active: true,
      };
      const collection = collectionAt(paths.restaurantSub(restaurantId, 'taskTemplates'));
      if (template) await updateDoc(doc(collection, template.id), { ...data, ...updatedFields(user!.uid) });
      else await addDoc(collection, { ...data, ...createdFields(user!.uid) });
      return true;
    },
    { success: 'Modèle de tâche enregistré' },
  );
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent size="md">
        <DialogHeader icon={<ListPlus />} title={template ? 'Modifier le modèle' : 'Nouveau modèle de tâche'} description="Pour créer en un clic les tâches qui reviennent souvent." />
        <DialogBody className="space-y-4">
          <FormField label="Intitulé" required>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} />
          </FormField>
          <FormField label="Description">
            <Textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={2000} />
          </FormField>
          <div className="grid gap-4 sm:grid-cols-3">
            <FormField label="Priorité">
              <Select value={priority} onValueChange={(v) => setPriority(v as TaskPriority)} options={TASK_PRIORITIES.map((p) => ({ value: p, label: TASK_PRIORITY_LABELS[p] }))} />
            </FormField>
            <FormField label="Échéance" hint="Jours après la création.">
              <Input type="number" min={0} max={365} value={offset} onChange={(e) => setOffset(e.target.value)} trailing="j" />
            </FormField>
            <FormField label="Étiquettes">
              <Input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="hygiène" />
            </FormField>
          </div>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Annuler
          </Button>
          <Button
            variant="primary"
            loading={save.loading}
            disabled={title.trim().length < 2}
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

function ChecklistDialog({ template, open, onClose, nextOrder }: { template: WithId<ChecklistTemplate> | null; open: boolean; onClose: () => void; nextOrder: number }) {
  const { restaurantId } = useRestaurantAccess();
  const { user } = useAuth();
  const [name, setName] = useState('');
  const [kind, setKind] = useState<ChecklistKind>('opening');
  const [description, setDescription] = useState('');
  const [dueTime, setDueTime] = useState('');
  const [days, setDays] = useState<number[]>([]);
  const [items, setItems] = useState<ChecklistItem[]>([]);
  const [active, setActive] = useState(true);
  useEffect(() => {
    if (!open) return;
    setName(template?.name ?? '');
    setKind(template?.kind ?? 'opening');
    setDescription(template?.description ?? '');
    setDueTime(template?.dueTime ?? '');
    setDays(template?.daysOfWeek ?? []);
    setItems(template?.items ?? [{ id: crypto.randomUUID().slice(0, 8), label: '', critical: false }]);
    setActive(template?.active ?? true);
  }, [open, template]);
  const move = (index: number, delta: number) =>
    setItems((list) => {
      const next = [...list];
      const [item] = next.splice(index, 1);
      if (item) next.splice(Math.max(0, Math.min(next.length, index + delta)), 0, item);
      return next;
    });
  const valid = name.trim().length >= 2 && items.length > 0 && items.every((i) => i.label.trim().length > 0);
  const save = useMutation(
    async () => {
      const data = {
        name: name.trim(),
        kind,
        description: description.trim() || null,
        items: items.map((i) => ({ id: i.id, label: i.label.trim(), critical: Boolean(i.critical) })),
        daysOfWeek: days,
        dueTime: dueTime || null,
        active,
        order: template?.order ?? nextOrder,
      };
      const collection = collectionAt(paths.restaurantSub(restaurantId, 'checklistTemplates'));
      if (template) await updateDoc(doc(collection, template.id), { ...data, ...updatedFields(user!.uid) });
      else await addDoc(collection, { ...data, ...createdFields(user!.uid) });
      return true;
    },
    { success: 'Checklist enregistrée' },
  );
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent size="lg">
        <DialogHeader icon={<ClipboardCheck />} title={template ? 'Modifier la checklist' : 'Nouvelle checklist'} description="Les points critiques sont signalés s’ils ne sont pas cochés à l’heure prévue." />
        <DialogBody className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <FormField label="Nom" required className="sm:col-span-2">
              <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} placeholder="Ouverture de la cuisine" />
            </FormField>
            <FormField label="Moment">
              <Select value={kind} onValueChange={(v) => setKind(v as ChecklistKind)} options={CHECKLIST_KINDS.map((k) => ({ value: k, label: CHECKLIST_KIND_LABELS[k] }))} />
            </FormField>
          </div>
          <FormField label="Description">
            <Input value={description} onChange={(e) => setDescription(e.target.value)} maxLength={200} />
          </FormField>
          <div className="grid gap-4 sm:grid-cols-[10rem_1fr]">
            <FormField label="À faire avant">
              <TimeInput value={dueTime} onChange={setDueTime} aria-label="Heure limite" />
            </FormField>
            <FormField label="Jours" hint="Aucun jour coché : tous les jours.">
              <div className="flex flex-wrap gap-1.5">
                {DAYS.map((label, i) => {
                  const on = days.includes(i);
                  return (
                    <button
                      key={label}
                      type="button"
                      aria-pressed={on}
                      onClick={() => setDays((d) => (on ? d.filter((x) => x !== i) : [...d, i].sort()))}
                      className={cn('h-9 w-11 rounded-lg border text-sm transition-colors', on ? 'border-primary bg-primary-soft text-primary-soft-fg' : 'border-border-strong text-fg-muted hover:bg-surface-3')}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </FormField>
          </div>
          <div className="space-y-2">
            <p className="text-sm font-medium text-fg">Points de contrôle</p>
            {items.map((item, index) => (
              <div key={item.id} className="flex items-center gap-2">
                <span className="w-5 text-right font-mono text-xs text-fg-subtle num">{index + 1}</span>
                <Input
                  aria-label={`Point ${index + 1}`}
                  value={item.label}
                  onChange={(e) => setItems((list) => list.map((i) => (i.id === item.id ? { ...i, label: e.target.value } : i)))}
                  maxLength={160}
                  className="flex-1"
                />
                <label className="flex shrink-0 items-center gap-1.5 text-xs text-fg-muted" title="Point critique">
                  <Checkbox checked={Boolean(item.critical)} onCheckedChange={(v) => setItems((list) => list.map((i) => (i.id === item.id ? { ...i, critical: v === true } : i)))} aria-label="Point critique" />
                  <ShieldAlert className="size-3.5" />
                </label>
                <IconButton label="Monter" size="sm" onClick={() => move(index, -1)} disabled={index === 0}>
                  <ArrowUp />
                </IconButton>
                <IconButton label="Descendre" size="sm" onClick={() => move(index, 1)} disabled={index === items.length - 1}>
                  <ArrowDown />
                </IconButton>
                <IconButton label="Retirer" size="sm" variant="danger" onClick={() => setItems((list) => list.filter((i) => i.id !== item.id))}>
                  <X />
                </IconButton>
              </div>
            ))}
            <Button size="sm" variant="ghost" leftIcon={<Plus />} onClick={() => setItems((list) => [...list, { id: crypto.randomUUID().slice(0, 8), label: '', critical: false }])} disabled={items.length >= 60}>
              Ajouter un point
            </Button>
          </div>
          <Switch label="Active" description="Une checklist inactive n’apparaît plus dans les checklists du jour." checked={active} onCheckedChange={setActive} />
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Annuler
          </Button>
          <Button
            variant="primary"
            loading={save.loading}
            disabled={!valid}
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

export function TemplatesPage() {
  useDocumentTitle('Modèles de tâches · Ciyou Eats Restaurant');
  const can = useCan();
  const manager = can('tasks.manage');
  const { restaurantId } = useRestaurantAccess();
  const directory = useStaffDirectory();
  const taskTemplates = useTaskTemplates();
  const checklists = useChecklistTemplates();
  const [taskDialog, setTaskDialog] = useState<WithId<TaskTemplate> | 'new' | null>(null);
  const [checklistDialog, setChecklistDialog] = useState<WithId<ChecklistTemplate> | 'new' | null>(null);
  const [toDelete, setToDelete] = useState<{ kind: 'task' | 'checklist'; id: string; name: string } | null>(null);
  const [fromTemplate, setFromTemplate] = useState<WithId<TaskTemplate> | null>(null);

  if (!manager) {
    return (
      <PageContainer>
        <PageHeader eyebrow="Équipe & RH" title="Modèles">
          <SubNav items={TASK_NAV.filter((item) => item.to !== '/equipe/taches/modeles')} />
        </PageHeader>
        <Card>
          <EmptyState icon={<ClipboardCheck />} title="Réservé aux responsables" description="Les modèles de tâches et de checklists sont gérés par les responsables de l’établissement." />
        </Card>
      </PageContainer>
    );
  }

  return (
    <PageContainer wide>
      <PageHeader eyebrow="Équipe & RH" title="Modèles" description="Tâches types et checklists d’ouverture, de service et de fermeture.">
        <SubNav items={TASK_NAV} />
      </PageHeader>
      {(taskTemplates.error || checklists.error) && <ErrorCard error={taskTemplates.error ?? checklists.error} />}

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader
            icon={<ClipboardCheck />}
            title="Checklists"
            description="Cochées chaque jour par l’équipe, avec l’heure et l’auteur."
            actions={
              <Button size="sm" leftIcon={<Plus />} onClick={() => setChecklistDialog('new')}>
                Nouvelle
              </Button>
            }
            divided
          />
          {checklists.loading ? (
            <Skeleton className="m-5 h-40" />
          ) : checklists.data.length === 0 ? (
            <EmptyState compact icon={<ClipboardCheck />} title="Aucune checklist" description="Créez la checklist d’ouverture de votre cuisine." />
          ) : (
            <ul className="divide-y divide-border">
              {checklists.data.map((c) => (
                <li key={c.id} className="flex items-start justify-between gap-3 px-5 py-3.5">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-fg">
                      {c.name}
                      {!c.active && (
                        <Badge tone="neutral" size="sm" className="ml-2">
                          Inactive
                        </Badge>
                      )}
                    </p>
                    <p className="mt-0.5 text-xs text-fg-subtle">
                      {CHECKLIST_KIND_LABELS[c.kind]} · {c.items.length} point{c.items.length > 1 ? 's' : ''}
                      {c.items.some((i) => i.critical) ? ` dont ${c.items.filter((i) => i.critical).length} critique(s)` : ''}
                      {c.dueTime ? ` · avant ${c.dueTime}` : ''} · {c.daysOfWeek.length ? c.daysOfWeek.map((d) => DAYS[d]).join(', ') : 'tous les jours'}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <IconButton label="Modifier" size="sm" onClick={() => setChecklistDialog(c)}>
                      <Pencil />
                    </IconButton>
                    <IconButton label="Supprimer" size="sm" variant="danger" onClick={() => setToDelete({ kind: 'checklist', id: c.id, name: c.name })}>
                      <Trash2 />
                    </IconButton>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader
            icon={<ListPlus />}
            title="Modèles de tâches"
            description="Tâches qui reviennent : inventaire, contrôle des DLC, commandes…"
            actions={
              <Button size="sm" leftIcon={<Plus />} onClick={() => setTaskDialog('new')}>
                Nouveau
              </Button>
            }
            divided
          />
          {taskTemplates.loading ? (
            <Skeleton className="m-5 h-40" />
          ) : taskTemplates.data.length === 0 ? (
            <EmptyState compact icon={<ListPlus />} title="Aucun modèle" description="Enregistrez vos tâches récurrentes pour les créer en un clic." />
          ) : (
            <ul className="divide-y divide-border">
              {taskTemplates.data.map((t) => (
                <li key={t.id} className="flex flex-wrap items-start justify-between gap-3 px-5 py-3.5">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-fg">{t.title}</p>
                    {t.description && <p className="mt-0.5 line-clamp-2 text-xs text-fg-subtle">{t.description}</p>}
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      <Badge tone={TASK_PRIORITY_TONE[t.priority]} size="sm">
                        {TASK_PRIORITY_LABELS[t.priority]}
                      </Badge>
                      {t.dueOffsetDays !== null && t.dueOffsetDays !== undefined && (
                        <span className="text-2xs text-fg-subtle">Échéance J+{t.dueOffsetDays}</span>
                      )}
                    </div>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <Button size="xs" onClick={() => setFromTemplate(t)}>
                      Créer la tâche
                    </Button>
                    <IconButton label="Modifier" size="sm" onClick={() => setTaskDialog(t)}>
                      <Pencil />
                    </IconButton>
                    <IconButton label="Supprimer" size="sm" variant="danger" onClick={() => setToDelete({ kind: 'task', id: t.id, name: t.title })}>
                      <Trash2 />
                    </IconButton>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <TaskTemplateDialog open={taskDialog !== null} template={taskDialog === 'new' ? null : taskDialog} onClose={() => setTaskDialog(null)} />
      <ChecklistDialog
        open={checklistDialog !== null}
        template={checklistDialog === 'new' ? null : checklistDialog}
        onClose={() => setChecklistDialog(null)}
        nextOrder={checklists.data.length}
      />
      <TaskFormSheet open={fromTemplate !== null} onOpenChange={(v) => !v && setFromTemplate(null)} templates={taskTemplates.data} directory={directory} initialTemplate={fromTemplate} />
      <ConfirmDialog
        open={toDelete !== null}
        onOpenChange={(v) => !v && setToDelete(null)}
        title={`Supprimer « ${toDelete?.name ?? ''} » ?`}
        description={toDelete?.kind === 'checklist' ? 'L’historique des réalisations est conservé.' : 'Les tâches déjà créées ne sont pas modifiées.'}
        confirmLabel="Supprimer"
        destructive
        onConfirm={async () => {
          if (!toDelete) return;
          const name = toDelete.kind === 'task' ? 'taskTemplates' : 'checklistTemplates';
          await deleteDoc(doc(collectionAt(paths.restaurantSub(restaurantId, name)), toDelete.id));
        }}
      />
    </PageContainer>
  );
}
