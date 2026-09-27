import { useEffect, useMemo, useState } from 'react';
import { addDoc, deleteDoc, doc, updateDoc } from 'firebase/firestore';
import { AlertTriangle, CalendarPlus, CalendarRange, Trash2 } from 'lucide-react';
import {
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  FormField,
  Input,
  Select,
  Switch,
  Textarea,
  TimeInput,
  cn,
  toast,
} from '@golink/ui';
import { paths, type Absence, type Shift, type ShiftTemplate, type StaffDirectoryEntry, type WithId } from '@golink/shared';
import { useAuth } from '@golink/web';
import { useRestaurantAccess } from '@/auth/RestaurantAccess';
import { collectionAt, createdFields, updatedFields, useMutation } from '@/lib/firestore';
import { formatDuration, formatFullDay, shiftMinutes } from '../_rh/dates';
import { POSITIONS, overlaps } from './data';

export interface ShiftDraft {
  shift?: WithId<Shift> | null;
  employeeId?: string;
  date?: string;
}

export function ShiftDialog({
  draft,
  onClose,
  employees,
  shifts,
  absences,
  templates,
}: {
  draft: ShiftDraft | null;
  onClose: () => void;
  employees: WithId<StaffDirectoryEntry>[];
  shifts: WithId<Shift>[];
  absences: WithId<Absence>[];
  templates: WithId<ShiftTemplate>[];
}) {
  const { restaurantId } = useRestaurantAccess();
  const { user } = useAuth();
  const editing = draft?.shift ?? null;
  const [employeeId, setEmployeeId] = useState('');
  const [date, setDate] = useState('');
  const [startTime, setStartTime] = useState('10:30');
  const [endTime, setEndTime] = useState('15:00');
  const [breakMinutes, setBreakMinutes] = useState('20');
  const [position, setPosition] = useState('Cuisine');
  const [notes, setNotes] = useState('');
  const [published, setPublished] = useState(false);

  useEffect(() => {
    if (!draft) return;
    const s = draft.shift;
    const employee = employees.find((e) => (e.employeeId ?? e.id) === (s?.employeeId ?? draft.employeeId));
    setEmployeeId(s?.employeeId ?? draft.employeeId ?? employees[0]?.employeeId ?? '');
    setDate(s?.date ?? draft.date ?? '');
    setStartTime(s?.startTime ?? '10:30');
    setEndTime(s?.endTime ?? '15:00');
    setBreakMinutes(String(s?.breakMinutes ?? 20));
    setPosition(s?.position ?? (employee?.department === 'Salle' ? 'Salle' : 'Cuisine'));
    setNotes(s?.notes ?? '');
    setPublished(s?.published ?? false);
  }, [draft, employees]);

  const presets = useMemo(() => {
    const seen = new Set<string>();
    return templates
      .flatMap((t) => t.slots)
      .filter((slot) => {
        const key = `${slot.startTime}-${slot.endTime}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, 5);
  }, [templates]);

  const minutes = startTime && endTime && startTime !== endTime ? shiftMinutes(startTime, endTime, Number(breakMinutes) || 0) : 0;
  const conflict = shifts.find(
    (s) => s.id !== editing?.id && s.employeeId === employeeId && s.date === date && overlaps(s, { startTime, endTime }),
  );
  const absence = absences.find((a) => a.employeeId === employeeId && a.startDate <= date && a.endDate >= date);
  const invalid = !employeeId || !date || !startTime || !endTime || startTime === endTime || minutes <= 0;

  const save = useMutation(
    async () => {
      const entry = employees.find((e) => (e.employeeId ?? e.id) === employeeId);
      const data = {
        employeeId,
        employeeUid: entry?.uid ?? null,
        date,
        startTime,
        endTime,
        breakMinutes: Math.max(0, Math.min(240, Number(breakMinutes) || 0)),
        position: position || null,
        notes: notes.trim() || null,
        published,
      };
      const collection = collectionAt(paths.restaurantSub(restaurantId, 'shifts'));
      if (editing) await updateDoc(doc(collection, editing.id), { ...data, ...updatedFields(user!.uid) });
      else await addDoc(collection, { ...data, templateId: null, ...createdFields(user!.uid) });
      return true;
    },
    { success: editing ? 'Créneau mis à jour' : 'Créneau ajouté' },
  );

  const remove = useMutation(
    async () => {
      if (!editing) return false;
      await deleteDoc(doc(collectionAt(paths.restaurantSub(restaurantId, 'shifts')), editing.id));
      return true;
    },
    { success: 'Créneau supprimé' },
  );

  return (
    <Dialog open={draft !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent size="md">
        <DialogHeader
          icon={editing ? <CalendarRange /> : <CalendarPlus />}
          title={editing ? 'Modifier le créneau' : 'Nouveau créneau'}
          description={date ? formatFullDay(date) : 'Choisissez le salarié, le jour et les horaires.'}
        />
        <DialogBody className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Salarié" required>
              <Select
                value={employeeId}
                onValueChange={setEmployeeId}
                options={employees.map((e) => ({ value: e.employeeId ?? e.id, label: e.displayName, description: e.position ?? undefined }))}
              />
            </FormField>
            <FormField label="Jour" required>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </FormField>
          </div>

          {presets.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {presets.map((slot) => {
                const active = slot.startTime === startTime && slot.endTime === endTime;
                return (
                  <button
                    key={`${slot.startTime}-${slot.endTime}`}
                    type="button"
                    onClick={() => {
                      setStartTime(slot.startTime);
                      setEndTime(slot.endTime);
                      setBreakMinutes(String(slot.breakMinutes));
                      if (slot.position && POSITIONS.includes(slot.position)) setPosition(slot.position);
                    }}
                    className={cn(
                      'rounded-full border px-3 py-1 font-mono text-xs transition-colors num',
                      active ? 'border-primary bg-primary-soft text-primary-soft-fg' : 'border-border-strong text-fg-muted hover:bg-surface-3 hover:text-fg',
                    )}
                  >
                    {slot.position ? `${slot.position} · ` : ''}
                    {slot.startTime}–{slot.endTime}
                  </button>
                );
              })}
            </div>
          )}

          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <FormField label="Début" required>
              <TimeInput value={startTime} onChange={setStartTime} aria-label="Heure de début" />
            </FormField>
            <FormField label="Fin" required hint={endTime && startTime && endTime < startTime ? 'Se termine le lendemain.' : undefined}>
              <TimeInput value={endTime} onChange={setEndTime} aria-label="Heure de fin" />
            </FormField>
            <FormField label="Pause" className="col-span-2 sm:col-span-1">
              <Input type="number" min={0} max={240} step={5} value={breakMinutes} onChange={(e) => setBreakMinutes(e.target.value)} trailing="min" />
            </FormField>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Poste">
              <Select value={position} onValueChange={setPosition} options={POSITIONS.map((p) => ({ value: p, label: p }))} />
            </FormField>
            <div className="flex flex-col justify-end">
              <div className="rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm">
                <span className="text-fg-muted">Durée effective </span>
                <span className="font-mono font-medium text-fg num">{formatDuration(minutes)}</span>
              </div>
            </div>
          </div>

          <FormField label="Consigne" hint="Visible par le salarié sur son planning.">
            <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={300} placeholder="Ex. inventaire en fin de service" />
          </FormField>

          <Switch
            label="Publié"
            description="Visible par le salarié. Les brouillons restent masqués jusqu’à la publication de la semaine."
            checked={published}
            onCheckedChange={setPublished}
          />

          {(conflict || absence) && (
            <div className="tone-amber flex items-start gap-2.5 rounded-lg border border-(--tone-border) bg-(--tone-bg) px-3 py-2.5 text-sm text-(--tone-fg)">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              <div className="space-y-0.5">
                {conflict && (
                  <p>
                    Chevauche le créneau {conflict.startTime}–{conflict.endTime} déjà prévu ce jour-là.
                  </p>
                )}
                {absence && <p>Le salarié est absent ce jour-là (absence acceptée).</p>}
              </div>
            </div>
          )}
        </DialogBody>
        <DialogFooter className="sm:justify-between">
          {editing ? (
            <Button
              variant="danger-soft"
              leftIcon={<Trash2 />}
              loading={remove.loading}
              onClick={async () => {
                if (await remove.mutate()) onClose();
              }}
            >
              Supprimer
            </Button>
          ) : (
            <span />
          )}
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <Button variant="ghost" onClick={onClose}>
              Annuler
            </Button>
            <Button
              variant="primary"
              loading={save.loading}
              disabled={invalid}
              onClick={async () => {
                if (invalid) {
                  toast.error('Complétez le salarié, le jour et des horaires valides.');
                  return;
                }
                if (await save.mutate()) onClose();
              }}
            >
              {editing ? 'Enregistrer' : 'Ajouter le créneau'}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
