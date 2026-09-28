import { useEffect, useState } from 'react';
import { addDoc, deleteDoc, doc, updateDoc, writeBatch } from 'firebase/firestore';
import { CalendarCog, CopyPlus, LayoutTemplate, Pencil, Plus, Trash2, X } from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  Checkbox,
  Combobox,
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
  Select,
  Sheet,
  SheetBody,
  SheetContent,
  SheetFooter,
  SheetHeader,
  TimeInput,
} from '@golink/ui';
import { paths, type Absence, type Shift, type ShiftTemplate, type StaffDirectoryEntry, type WithId } from '@golink/shared';
import { useAuth } from '@golink/web';
import { useRestaurantAccess } from '@/auth/RestaurantAccess';
import { db } from '@/lib/firebase';
import { collectionAt, createdFields, updatedFields, useMutation } from '@/lib/firestore';
import { formatDayMonth, formatWeekRange, formatWeekdayShort, weekDays } from '../_rh/dates';
import { POSITIONS, overlaps } from './data';

type Slot = ShiftTemplate['slots'][number];

const DAY_OPTIONS = [
  { value: 'all', label: 'Tous les jours' },
  ...['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'].map((label, i) => ({ value: String(i), label })),
];

function slotLabel(slot: Slot): string {
  const day = slot.dayOfWeek === null ? 'Tous les jours' : DAY_OPTIONS[slot.dayOfWeek + 1]?.label;
  return `${day} · ${slot.startTime}–${slot.endTime}${slot.position ? ` · ${slot.position}` : ''}`;
}

function TemplateEditor({ template, onDone }: { template: WithId<ShiftTemplate> | null; onDone: () => void }) {
  const { restaurantId } = useRestaurantAccess();
  const { user } = useAuth();
  const [name, setName] = useState(template?.name ?? '');
  const [description, setDescription] = useState(template?.description ?? '');
  const [slots, setSlots] = useState<Slot[]>(
    template?.slots ?? [
      { dayOfWeek: null, startTime: '10:30', endTime: '15:00', breakMinutes: 20, position: 'Cuisine' },
      { dayOfWeek: null, startTime: '17:30', endTime: '23:00', breakMinutes: 20, position: 'Cuisine' },
    ],
  );
  const update = (index: number, patch: Partial<Slot>) => setSlots((current) => current.map((slot, i) => (i === index ? { ...slot, ...patch } : slot)));

  const save = useMutation(
    async () => {
      const data = { name: name.trim(), description: description.trim() || null, active: true, slots };
      const collection = collectionAt(paths.restaurantSub(restaurantId, 'shiftTemplates'));
      if (template) await updateDoc(doc(collection, template.id), { ...data, ...updatedFields(user!.uid) });
      else await addDoc(collection, { ...data, ...createdFields(user!.uid) });
      return true;
    },
    { success: template ? 'Modèle mis à jour' : 'Modèle créé' },
  );
  const invalid = name.trim().length < 2 || slots.length === 0 || slots.some((s) => !s.startTime || !s.endTime || s.startTime === s.endTime);

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label="Nom du modèle" required>
          <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder="Semaine type, week-end renforcé…" />
        </FormField>
        <FormField label="Description">
          <Input value={description} onChange={(e) => setDescription(e.target.value)} maxLength={140} />
        </FormField>
      </div>
      <div className="space-y-2">
        <p className="eyebrow">Créneaux</p>
        {slots.map((slot, index) => (
          <div key={index} className="grid grid-cols-2 gap-2 rounded-xl border border-border bg-surface-2 p-3 sm:grid-cols-[1.3fr_1fr_1fr_0.8fr_1fr_auto] sm:items-end">
            <FormField label="Jour" className="col-span-2 sm:col-span-1">
              <Select
                value={slot.dayOfWeek === null ? 'all' : String(slot.dayOfWeek)}
                onValueChange={(v) => update(index, { dayOfWeek: v === 'all' ? null : Number(v) })}
                options={DAY_OPTIONS}
              />
            </FormField>
            <FormField label="Début">
              <TimeInput value={slot.startTime} onChange={(v) => update(index, { startTime: v })} aria-label="Début" />
            </FormField>
            <FormField label="Fin">
              <TimeInput value={slot.endTime} onChange={(v) => update(index, { endTime: v })} aria-label="Fin" />
            </FormField>
            <FormField label="Pause">
              <Input type="number" min={0} max={240} step={5} value={String(slot.breakMinutes)} onChange={(e) => update(index, { breakMinutes: Number(e.target.value) || 0 })} trailing="min" />
            </FormField>
            <FormField label="Poste">
              <Select value={slot.position ?? 'Cuisine'} onValueChange={(v) => update(index, { position: v })} options={POSITIONS.map((p) => ({ value: p, label: p }))} />
            </FormField>
            <IconButton label="Retirer ce créneau" variant="danger" size="md" onClick={() => setSlots((current) => current.filter((_, i) => i !== index))} className="justify-self-end">
              <X />
            </IconButton>
          </div>
        ))}
        <Button
          size="sm"
          variant="ghost"
          leftIcon={<Plus />}
          onClick={() => setSlots((current) => [...current, { dayOfWeek: null, startTime: '11:00', endTime: '14:30', breakMinutes: 0, position: 'Salle' }])}
        >
          Ajouter un créneau
        </Button>
      </div>
      <div className="flex justify-end gap-2 border-t border-border pt-4">
        <Button variant="ghost" onClick={onDone}>
          Annuler
        </Button>
        <Button
          variant="primary"
          loading={save.loading}
          disabled={invalid}
          onClick={async () => {
            if (await save.mutate()) onDone();
          }}
        >
          Enregistrer le modèle
        </Button>
      </div>
    </div>
  );
}

export function TemplatesSheet({ open, onOpenChange, templates }: { open: boolean; onOpenChange: (open: boolean) => void; templates: WithId<ShiftTemplate>[] }) {
  const { restaurantId } = useRestaurantAccess();
  const [editing, setEditing] = useState<WithId<ShiftTemplate> | 'new' | null>(null);
  const [toDelete, setToDelete] = useState<WithId<ShiftTemplate> | null>(null);
  useEffect(() => {
    if (!open) setEditing(null);
  }, [open]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-2xl">
        <SheetHeader icon={<LayoutTemplate />} title="Modèles de semaine" description="Enregistrez vos services types pour construire le planning en quelques clics." />
        <SheetBody className="space-y-3">
          {editing ? (
            <TemplateEditor template={editing === 'new' ? null : editing} onDone={() => setEditing(null)} />
          ) : templates.length === 0 ? (
            <EmptyState
              compact
              icon={<LayoutTemplate />}
              title="Aucun modèle"
              description="Créez une semaine type (services du midi et du soir) pour l’appliquer à votre équipe."
              action={
                <Button variant="primary" leftIcon={<Plus />} onClick={() => setEditing('new')}>
                  Créer un modèle
                </Button>
              }
            />
          ) : (
            templates.map((template) => (
              <Card key={template.id} className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-display text-md font-semibold text-fg">{template.name}</p>
                    {template.description && <p className="mt-0.5 text-sm text-fg-muted">{template.description}</p>}
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <IconButton label="Modifier le modèle" size="sm" onClick={() => setEditing(template)}>
                      <Pencil />
                    </IconButton>
                    <IconButton label="Supprimer le modèle" size="sm" variant="danger" onClick={() => setToDelete(template)}>
                      <Trash2 />
                    </IconButton>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {template.slots.map((slot, i) => (
                    <Badge key={i} tone="neutral" variant="outline">
                      {slotLabel(slot)}
                    </Badge>
                  ))}
                </div>
              </Card>
            ))
          )}
        </SheetBody>
        {!editing && templates.length > 0 && (
          <SheetFooter>
            <Button variant="primary" leftIcon={<Plus />} onClick={() => setEditing('new')}>
              Nouveau modèle
            </Button>
          </SheetFooter>
        )}
        <ConfirmDialog
          open={toDelete !== null}
          onOpenChange={(value) => !value && setToDelete(null)}
          title="Supprimer ce modèle ?"
          description="Les créneaux déjà créés à partir de ce modèle sont conservés."
          confirmLabel="Supprimer"
          destructive
          onConfirm={async () => {
            if (toDelete) await deleteDoc(doc(collectionAt(paths.restaurantSub(restaurantId, 'shiftTemplates')), toDelete.id));
          }}
        />
      </SheetContent>
    </Sheet>
  );
}

export function ApplyTemplateDialog({
  open,
  onOpenChange,
  monday,
  templates,
  employees,
  shifts,
  absences,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  monday: string;
  templates: WithId<ShiftTemplate>[];
  employees: WithId<StaffDirectoryEntry>[];
  shifts: WithId<Shift>[];
  absences: WithId<Absence>[];
}) {
  const { restaurantId } = useRestaurantAccess();
  const { user } = useAuth();
  const [templateId, setTemplateId] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [dayIndexes, setDayIndexes] = useState<number[]>([0, 1, 2, 3, 4, 5]);
  const days = weekDays(monday);

  useEffect(() => {
    if (open) {
      setTemplateId(templates[0]?.id ?? '');
      setSelected(employees.map((e) => e.employeeId ?? e.id));
    }
  }, [open, templates, employees]);

  const template = templates.find((t) => t.id === templateId);
  const plan = (() => {
    if (!template) return [] as Array<Omit<Shift, 'createdAt' | 'updatedAt'>>;
    const result: Array<Omit<Shift, 'createdAt' | 'updatedAt'>> = [];
    for (const employeeId of selected) {
      const entry = employees.find((e) => (e.employeeId ?? e.id) === employeeId);
      for (const dayIndex of dayIndexes) {
        const date = days[dayIndex]!;
        if (absences.some((a) => a.employeeId === employeeId && a.startDate <= date && a.endDate >= date)) continue;
        for (const slot of template.slots) {
          if (slot.dayOfWeek !== null && slot.dayOfWeek !== dayIndex) continue;
          const candidate = { startTime: slot.startTime, endTime: slot.endTime };
          const clash = shifts.some((s) => s.employeeId === employeeId && s.date === date && overlaps(s, candidate));
          if (clash) continue;
          result.push({
            employeeId,
            employeeUid: entry?.uid ?? null,
            date,
            startTime: slot.startTime,
            endTime: slot.endTime,
            breakMinutes: slot.breakMinutes,
            position: slot.position ?? null,
            notes: null,
            published: false,
            templateId: template.id,
          });
        }
      }
    }
    return result;
  })();

  const apply = useMutation(
    async () => {
      const collection = collectionAt(paths.restaurantSub(restaurantId, 'shifts'));
      for (let i = 0; i < plan.length; i += 400) {
        const batch = writeBatch(db);
        for (const shift of plan.slice(i, i + 400)) batch.set(doc(collection), { ...shift, ...createdFields(user!.uid) });
        await batch.commit();
      }
      return plan.length;
    },
    { success: (count) => `${count} créneau${count > 1 ? 'x' : ''} ajouté${count > 1 ? 's' : ''} en brouillon` },
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <DialogHeader icon={<CalendarCog />} title="Appliquer un modèle" description={`Semaine du ${formatWeekRange(monday)} · les créneaux sont créés en brouillon.`} />
        <DialogBody className="space-y-5">
          {templates.length === 0 ? (
            <EmptyState compact icon={<LayoutTemplate />} title="Aucun modèle" description="Créez d’abord un modèle de semaine." />
          ) : (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField label="Modèle">
                  <Select value={templateId} onValueChange={setTemplateId} options={templates.map((t) => ({ value: t.id, label: t.name, description: `${t.slots.length} créneau(x)` }))} />
                </FormField>
                <FormField label="Salariés">
                  <Combobox
                    multiple
                    value={selected}
                    onChange={setSelected}
                    options={employees.map((e) => ({ value: e.employeeId ?? e.id, label: e.displayName, description: e.position ?? undefined }))}
                    placeholder="Choisir les salariés"
                    searchPlaceholder="Rechercher un salarié…"
                  />
                </FormField>
              </div>
              <FormField label="Jours concernés">
                <div className="grid grid-cols-4 gap-2 sm:grid-cols-7">
                  {days.map((day, i) => (
                    <label
                      key={day}
                      className="flex cursor-pointer flex-col items-center gap-1.5 rounded-lg border border-border bg-surface px-2 py-2 text-xs has-data-[state=checked]:border-primary has-data-[state=checked]:bg-primary-soft/50"
                    >
                      <Checkbox
                        checked={dayIndexes.includes(i)}
                        onCheckedChange={(value) => setDayIndexes((current) => (value ? [...current, i].sort() : current.filter((d) => d !== i)))}
                        aria-label={`${formatWeekdayShort(day)} ${formatDayMonth(day)}`}
                      />
                      <span className="first-letter:uppercase text-fg">{formatWeekdayShort(day)}</span>
                      <span className="font-mono text-2xs text-fg-subtle num">{formatDayMonth(day)}</span>
                    </label>
                  ))}
                </div>
              </FormField>
              <div className="rounded-lg border border-border bg-surface-2 px-4 py-3 text-sm text-fg-muted">
                <span className="font-semibold text-fg num">{plan.length}</span> créneau{plan.length > 1 ? 'x' : ''} à créer. Les jours d’absence et les créneaux qui chevaucheraient un service déjà prévu sont ignorés.
              </div>
            </>
          )}
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Annuler
          </Button>
          <Button
            variant="primary"
            leftIcon={<CopyPlus />}
            disabled={plan.length === 0}
            loading={apply.loading}
            onClick={async () => {
              if ((await apply.mutate()) !== undefined) onOpenChange(false);
            }}
          >
            Créer les créneaux
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
