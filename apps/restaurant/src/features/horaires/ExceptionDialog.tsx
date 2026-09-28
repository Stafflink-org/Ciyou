import { useEffect, useState } from 'react';
import { CalendarPlus, Plus, X } from 'lucide-react';
import {
  Button,
  DatePicker,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  FormField,
  IconButton,
  Input,
  RadioGroup,
  TimeInput,
} from '@golink/ui';
import { MAX_SLOTS_PER_DAY, validateSlots, type TimeRange } from '@golink/shared';

export interface ExceptionDraft {
  date: string;
  closed: boolean;
  slots: TimeRange[];
  label: string;
}

function toIso(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function fromIso(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  return new Date(y, m - 1, d);
}

const EMPTY: ExceptionDraft = { date: '', closed: true, slots: [{ from: '11:30', to: '14:30' }], label: '' };

/** Ajout ou modification d'une date exceptionnelle (fermeture ou horaires spéciaux). */
export function ExceptionDialog({
  open,
  initial,
  minDate,
  takenDates,
  onOpenChange,
  onSubmit,
}: {
  open: boolean;
  initial: ExceptionDraft | null;
  minDate: string;
  takenDates: string[];
  onOpenChange: (open: boolean) => void;
  onSubmit: (value: ExceptionDraft) => void;
}) {
  const [value, setValue] = useState<ExceptionDraft>(initial ?? EMPTY);
  useEffect(() => {
    if (open) setValue(initial ? { ...initial, slots: initial.slots.length ? initial.slots : EMPTY.slots } : EMPTY);
  }, [open, initial]);

  const slotIssues = value.closed ? [] : validateSlots(value.slots, value.date || 'date');
  const taken = value.date !== '' && takenDates.includes(value.date);
  const invalid = !value.date || taken || (!value.closed && (value.slots.length === 0 || slotIssues.length > 0));

  const setSlot = (index: number, patch: Partial<TimeRange>) =>
    setValue((v) => ({ ...v, slots: v.slots.map((s, i) => (i === index ? { ...s, ...patch } : s)) }));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm">
        <DialogHeader
          icon={<CalendarPlus />}
          title={initial ? 'Modifier la date' : 'Ajouter une date exceptionnelle'}
          description="Cette journée remplacera vos horaires habituels."
        />
        <DialogBody className="space-y-5">
          <FormField label="Date" required error={taken ? 'Cette date est déjà renseignée.' : undefined}>
            <DatePicker
              value={value.date ? fromIso(value.date) : undefined}
              onChange={(date) => setValue((v) => ({ ...v, date: date ? toIso(date) : '' }))}
              disabledDays={{ before: fromIso(minDate) }}
              placeholder="Choisir une date"
            />
          </FormField>
          <FormField label="Libellé" hint="Visible par vos clients (ex. « Congés annuels », « Soirée privée »).">
            <Input value={value.label} maxLength={60} onChange={(e) => setValue((v) => ({ ...v, label: e.target.value }))} />
          </FormField>
          <RadioGroup
            variant="cards"
            value={value.closed ? 'closed' : 'special'}
            onValueChange={(v) => setValue((current) => ({ ...current, closed: v === 'closed' }))}
            options={[
              { value: 'closed', label: 'Fermé', description: 'Aucune commande ce jour-là.' },
              { value: 'special', label: 'Horaires spéciaux', description: 'Ouverture sur des créneaux dédiés.' },
            ]}
          />
          {!value.closed && (
            <div className="space-y-2">
              {value.slots.map((slot, index) => (
                <div key={index} className="flex items-center gap-2">
                  <TimeInput className="min-w-0 flex-1" value={slot.from} aria-label={`Début du créneau ${index + 1}`} onChange={(from) => setSlot(index, { from })} />
                  <span className="text-fg-subtle" aria-hidden>
                    –
                  </span>
                  <TimeInput
                    className="min-w-0 flex-1"
                    value={slot.to === '24:00' ? '00:00' : slot.to}
                    aria-label={`Fin du créneau ${index + 1}`}
                    onChange={(to) => setSlot(index, { to: to === '00:00' ? '24:00' : to })}
                  />
                  <IconButton
                    label={`Supprimer le créneau ${index + 1}`}
                    variant="danger"
                    size="sm"
                    disabled={value.slots.length === 1}
                    onClick={() => setValue((v) => ({ ...v, slots: v.slots.filter((_, i) => i !== index) }))}
                  >
                    <X />
                  </IconButton>
                </div>
              ))}
              {slotIssues.map((issue) => (
                <p key={`${issue.slotIndex}-${issue.message}`} className="text-xs text-danger-soft-fg">
                  {issue.slotIndex !== undefined ? `Créneau ${issue.slotIndex + 1} : ` : ''}
                  {issue.message}
                </p>
              ))}
              {value.slots.length < MAX_SLOTS_PER_DAY && (
                <Button
                  variant="ghost"
                  size="xs"
                  leftIcon={<Plus />}
                  onClick={() => setValue((v) => ({ ...v, slots: [...v.slots, { from: '18:30', to: '22:30' }] }))}
                >
                  Ajouter un créneau
                </Button>
              )}
            </div>
          )}
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Annuler
          </Button>
          <Button variant="primary" disabled={invalid} onClick={() => onSubmit({ ...value, label: value.label.trim() })}>
            {initial ? 'Mettre à jour' : 'Ajouter'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
