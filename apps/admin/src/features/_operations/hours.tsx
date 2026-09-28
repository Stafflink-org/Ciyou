// Éditeur d'horaires hebdomadaires (service de livraison d'une ville ou d'une zone,
// créneaux d'une majoration planifiée) avec contrôles de cohérence.
import { Copy, Plus, X } from 'lucide-react';
import { Button, IconButton, Switch, TimeInput, cn } from '@golink/ui';
import { WEEKDAY_LABELS, validateWeeklyHours, type WeeklyHours } from '@golink/shared';

export function defaultWeeklyHours(timezone: string): WeeklyHours {
  return {
    days: ([0, 1, 2, 3, 4, 5, 6] as const).map((day) => ({ day, open: true, slots: [{ from: '11:00', to: '14:30' }, { from: '18:00', to: '23:00' }] })),
    exceptions: [],
    timezone,
  };
}

export function hoursIssues(hours: WeeklyHours): string[] {
  return validateWeeklyHours(hours).map((i) => (typeof i.scope === 'number' && i.scope >= 0 ? `${WEEKDAY_LABELS[i.scope]} : ${i.message}` : i.message));
}

export function WeeklyHoursEditor({ value, onChange, disabled }: { value: WeeklyHours; onChange: (value: WeeklyHours) => void; disabled?: boolean }) {
  const days = [...value.days].sort((a, b) => a.day - b.day);
  const issues = validateWeeklyHours(value);
  const update = (day: number, patch: Partial<WeeklyHours['days'][number]>) => onChange({ ...value, days: value.days.map((d) => (d.day === day ? { ...d, ...patch } : d)) });
  return (
    <div className="space-y-2">
      <ul className="divide-y divide-border rounded-xl border border-border">
        {days.map((d) => {
          const dayIssues = issues.filter((i) => i.scope === d.day);
          return (
            <li key={d.day} className="flex flex-col gap-2 px-4 py-3 md:flex-row md:items-start">
              <div className="flex w-40 shrink-0 items-center gap-3 pt-1.5">
                <Switch size="sm" checked={d.open} onCheckedChange={(open) => update(d.day, { open, slots: open && d.slots.length === 0 ? [{ from: '11:00', to: '14:30' }] : d.slots })} disabled={disabled} aria-label={`Ouvert le ${WEEKDAY_LABELS[d.day]}`} />
                <span className={cn('text-sm font-medium', d.open ? 'text-fg' : 'text-fg-subtle')}>{WEEKDAY_LABELS[d.day]}</span>
              </div>
              <div className="min-w-0 flex-1 space-y-2">
                {!d.open ? (
                  <p className="pt-1.5 text-sm text-fg-subtle">Pas de livraison</p>
                ) : (
                  d.slots.map((slot, i) => (
                    <div key={i} className="flex flex-wrap items-center gap-2">
                      <TimeInput value={slot.from} onChange={(from) => update(d.day, { slots: d.slots.map((s, j) => (j === i ? { ...s, from } : s)) })} disabled={disabled} className="w-32" aria-label="Début" />
                      <span className="text-fg-subtle">→</span>
                      <TimeInput value={slot.to} onChange={(to) => update(d.day, { slots: d.slots.map((s, j) => (j === i ? { ...s, to } : s)) })} disabled={disabled} className="w-32" aria-label="Fin" />
                      {d.slots.length > 1 && (
                        <IconButton label="Supprimer le créneau" size="sm" variant="ghost" disabled={disabled} onClick={() => update(d.day, { slots: d.slots.filter((_, j) => j !== i) })}>
                          <X />
                        </IconButton>
                      )}
                    </div>
                  ))
                )}
                {dayIssues.map((issue, i) => (
                  <p key={i} className="text-xs text-danger">{issue.message}</p>
                ))}
              </div>
              {d.open && !disabled && (
                <div className="flex gap-1 md:pt-0.5">
                  {d.slots.length < 4 && (
                    <Button size="xs" variant="ghost" leftIcon={<Plus />} onClick={() => update(d.day, { slots: [...d.slots, { from: '18:00', to: '22:00' }] })}>
                      Créneau
                    </Button>
                  )}
                  <Button size="xs" variant="ghost" leftIcon={<Copy />} onClick={() => onChange({ ...value, days: value.days.map((x) => ({ ...x, open: d.open, slots: d.slots.map((s) => ({ ...s })) })) })}>
                    Appliquer à tous
                  </Button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
