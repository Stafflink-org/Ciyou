import { useState, type DragEvent } from 'react';
import { Palmtree, Plus } from 'lucide-react';
import { Avatar, Badge, EmptyState, Tooltip, cn } from '@golink/ui';
import {
  ABSENCE_TYPE_LABELS,
  type Absence,
  type EmployeeAvailability,
  type Shift,
  type StaffDirectoryEntry,
  type WithId,
} from '@golink/shared';
import { formatDayMonth, formatDuration, formatWeekdayShort, weekDays } from '../_rh/dates';
import { groupShifts, shiftDuration } from './data';

export interface GridProps {
  monday: string;
  today: string;
  employees: WithId<StaffDirectoryEntry>[];
  shifts: WithId<Shift>[];
  absences: WithId<Absence>[];
  availabilities: WithId<EmployeeAvailability>[];
  canEdit: boolean;
  highlightEmployeeId?: string | null;
  onCreate: (employeeId: string, date: string) => void;
  onEdit: (shift: WithId<Shift>) => void;
  onMove: (shift: WithId<Shift>, employeeId: string, date: string, copy: boolean) => void;
}

const employeeKey = (e: StaffDirectoryEntry & { id: string }) => e.employeeId ?? e.id;

function loadTone(planned: number, contract: number | null | undefined): 'success' | 'amber' | 'danger' | 'neutral' {
  if (!contract) return 'neutral';
  const ratio = planned / (contract * 60);
  if (ratio > 1.2) return 'danger';
  if (ratio > 1.05 || ratio < 0.6) return 'amber';
  return 'success';
}

function availabilityLabel(a: EmployeeAvailability): string {
  const parts = [a.morning && 'matin', a.afternoon && 'après-midi', a.evening && 'soir'].filter(Boolean);
  return parts.length ? `Disponible : ${parts.join(', ')}` : 'Indisponible';
}

export function ShiftChip({
  shift,
  color,
  canEdit,
  onEdit,
  compact,
}: {
  shift: WithId<Shift>;
  color: string;
  canEdit: boolean;
  onEdit: (shift: WithId<Shift>) => void;
  compact?: boolean;
}) {
  const minutes = shiftDuration(shift);
  return (
    <button
      type="button"
      draggable={canEdit}
      onDragStart={(event) => {
        event.dataTransfer.setData('text/golink-shift', shift.id);
        event.dataTransfer.effectAllowed = 'copyMove';
      }}
      onClick={(event) => {
        event.stopPropagation();
        onEdit(shift);
      }}
      title={shift.notes ?? undefined}
      className={cn(
        'group/chip relative w-full overflow-hidden rounded-lg border bg-surface py-1.5 pl-3 pr-2 text-left shadow-xs transition-[box-shadow,transform,border-color]',
        'hover:border-border-strong hover:shadow-sm focus-visible:outline-2 focus-visible:outline-ring',
        canEdit && 'cursor-grab active:cursor-grabbing',
        shift.published ? 'border-border' : 'border-dashed border-border-strong bg-surface-2',
      )}
    >
      <span aria-hidden className="absolute inset-y-0 left-0 w-[3px]" style={{ backgroundColor: color }} />
      <span className="block font-mono text-xs font-medium text-fg num">
        {shift.startTime}–{shift.endTime}
      </span>
      {!compact && (
        <span className="mt-0.5 flex items-center justify-between gap-1 text-2xs text-fg-subtle">
          <span className="truncate">{shift.position ?? 'Service'}</span>
          <span className="shrink-0 font-mono num">{formatDuration(minutes, { compact: true })}</span>
        </span>
      )}
      {!shift.published && <span className="mt-0.5 block tone-amber text-3xs font-medium uppercase tracking-eyebrow text-(--tone-fg)">Brouillon</span>}
    </button>
  );
}

/** Grille hebdomadaire : salariés en lignes, jours en colonnes, glisser-déposer des créneaux. */
export function WeekGrid({ monday, today, employees, shifts, absences, availabilities, canEdit, highlightEmployeeId, onCreate, onEdit, onMove }: GridProps) {
  const days = weekDays(monday);
  const grouped = groupShifts(shifts);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const byId = new Map(shifts.map((s) => [s.id, s]));

  function handleDrop(event: DragEvent, employeeId: string, date: string) {
    event.preventDefault();
    setDropTarget(null);
    const id = event.dataTransfer.getData('text/golink-shift');
    const shift = byId.get(id);
    if (!shift || (shift.employeeId === employeeId && shift.date === date)) return;
    onMove(shift, employeeId, date, event.altKey || event.ctrlKey || event.metaKey);
  }

  if (employees.length === 0) {
    return (
      <EmptyState
        icon={<Palmtree />}
        title="Aucun salarié à planifier"
        description="Ajoutez les fiches de votre équipe dans la rubrique Employés pour construire le planning."
      />
    );
  }

  const dayTotals = days.map((day) => shifts.filter((s) => s.date === day).reduce((total, s) => total + shiftDuration(s), 0));

  return (
    <div data-scroll-ok className="overflow-x-auto">
      <div className="grid min-w-[1060px] grid-cols-[216px_repeat(7,minmax(118px,1fr))]" role="grid" aria-label="Planning de la semaine">
        {/* En-têtes */}
        <div className="sticky left-0 z-20 border-b border-r border-border bg-surface-2 px-4 py-2.5" role="columnheader">
          <span className="eyebrow">Équipe</span>
        </div>
        {days.map((day, i) => (
          <div
            key={day}
            role="columnheader"
            className={cn('border-b border-border bg-surface-2 px-3 py-2', i < 6 && 'border-r', day === today && 'bg-primary-soft/60')}
          >
            <p className={cn('text-xs font-semibold first-letter:uppercase', day === today ? 'text-primary-soft-fg' : 'text-fg')}>
              {formatWeekdayShort(day)} {formatDayMonth(day)}
            </p>
            <p className="font-mono text-2xs text-fg-subtle num">{dayTotals[i] ? formatDuration(dayTotals[i]!) : '—'}</p>
          </div>
        ))}

        {/* Lignes salariés */}
        {employees.map((employee) => {
          const id = employeeKey(employee);
          const byDay = grouped.get(id);
          const planned = [...(byDay?.values() ?? [])].flat().reduce((total, s) => total + shiftDuration(s), 0);
          const tone = loadTone(planned, employee.weeklyHours);
          const highlighted = highlightEmployeeId === id;
          return (
            <div key={id} role="row" className="contents">
              <div
                role="rowheader"
                className={cn(
                  'sticky left-0 z-10 flex items-center gap-2.5 border-b border-r border-border bg-surface px-4 py-2.5',
                  highlighted && 'bg-primary-soft/40',
                )}
              >
                <span aria-hidden className="h-8 w-[3px] shrink-0 rounded-full" style={{ backgroundColor: employee.color }} />
                <Avatar name={employee.displayName} size="sm" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-fg">{employee.displayName}</p>
                  <p className="flex items-center gap-1.5 text-2xs text-fg-subtle">
                    <span className={cn(`tone-${tone}`, 'font-mono font-medium text-(--tone-fg) num')}>{formatDuration(planned, { compact: true })}</span>
                    {employee.weeklyHours ? <span className="num">/ {employee.weeklyHours} h</span> : null}
                  </p>
                </div>
              </div>
              {days.map((day, i) => {
                const cellShifts = byDay?.get(day) ?? [];
                const absence = absences.find((a) => a.employeeId === id && a.startDate <= day && a.endDate >= day);
                const availability = availabilities.find((a) => a.employeeId === id && a.date === day);
                const key = `${id}_${day}`;
                return (
                  <div
                    key={day}
                    role="gridcell"
                    onDragOver={(event) => {
                      if (!canEdit) return;
                      event.preventDefault();
                      event.dataTransfer.dropEffect = event.altKey || event.ctrlKey ? 'copy' : 'move';
                      setDropTarget(key);
                    }}
                    onDragLeave={() => setDropTarget((current) => (current === key ? null : current))}
                    onDrop={(event) => canEdit && handleDrop(event, id, day)}
                    className={cn(
                      'group/cell relative min-h-[76px] space-y-1 border-b border-border p-1.5 transition-colors',
                      i < 6 && 'border-r',
                      day === today && 'bg-primary-soft/20',
                      highlighted && 'bg-primary-soft/25',
                      dropTarget === key && 'bg-primary-soft/60 ring-2 ring-inset ring-primary/40',
                    )}
                  >
                    {absence && (
                      <div className="tone-amber flex items-center gap-1 rounded-md border border-dashed border-(--tone-border) bg-(--tone-bg) px-2 py-1 text-2xs font-medium text-(--tone-fg)">
                        <Palmtree className="size-3 shrink-0" />
                        <span className="truncate">{ABSENCE_TYPE_LABELS[absence.type]}</span>
                      </div>
                    )}
                    {cellShifts.map((shift) => (
                      <ShiftChip key={shift.id} shift={shift} color={employee.color} canEdit={canEdit} onEdit={onEdit} />
                    ))}
                    {availability && canEdit && cellShifts.length === 0 && !absence && (
                      <Tooltip content={availabilityLabel(availability)}>
                        <span className="absolute right-1.5 top-1.5 flex gap-0.5" aria-label={availabilityLabel(availability)}>
                          {[availability.morning, availability.afternoon, availability.evening].map((ok, index) => (
                            <span key={index} className={cn('size-1.5 rounded-full', ok ? 'bg-success' : 'bg-border-strong')} />
                          ))}
                        </span>
                      </Tooltip>
                    )}
                    {canEdit && (
                      <button
                        type="button"
                        onClick={() => onCreate(id, day)}
                        aria-label={`Ajouter un créneau pour ${employee.displayName} le ${formatDayMonth(day)}`}
                        className={cn(
                          'flex w-full items-center justify-center rounded-md border border-dashed border-transparent text-fg-subtle transition-all',
                          'hover:border-border-strong hover:bg-surface-2 hover:text-fg focus-visible:border-border-strong focus-visible:opacity-100',
                          cellShifts.length === 0 && !absence ? 'h-[62px] opacity-0 group-hover/cell:opacity-100' : 'h-6 opacity-0 group-hover/cell:opacity-100',
                        )}
                      >
                        <Plus className="size-4" />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
      {canEdit && (
        <p className="border-t border-border px-4 py-2.5 text-xs text-fg-subtle">
          Glissez un créneau pour le déplacer ; maintenez <kbd className="rounded border border-border-strong px-1 font-mono text-3xs">Alt</kbd> pour le dupliquer.
          Les créneaux en pointillés sont des brouillons, invisibles pour l’équipe.
        </p>
      )}
    </div>
  );
}

/** Vue mobile : un jour à la fois. */
export function DayList({
  day,
  employees,
  shifts,
  absences,
  canEdit,
  onCreate,
  onEdit,
}: {
  day: string;
  employees: WithId<StaffDirectoryEntry>[];
  shifts: WithId<Shift>[];
  absences: WithId<Absence>[];
  canEdit: boolean;
  onCreate: (employeeId: string, date: string) => void;
  onEdit: (shift: WithId<Shift>) => void;
}) {
  const dayShifts = shifts.filter((s) => s.date === day).sort((a, b) => a.startTime.localeCompare(b.startTime));
  const dayAbsences = absences.filter((a) => a.startDate <= day && a.endDate >= day);
  const byKey = new Map(employees.map((e) => [employeeKey(e), e]));
  if (dayShifts.length === 0 && dayAbsences.length === 0) {
    return (
      <EmptyState
        compact
        icon={<Palmtree />}
        title="Aucun créneau ce jour-là"
        description={canEdit ? 'Ajoutez un créneau pour un membre de l’équipe.' : 'Personne n’est planifié ce jour-là.'}
        action={
          canEdit && employees[0] ? (
            <button type="button" onClick={() => onCreate(employeeKey(employees[0]!), day)} className="text-sm font-medium text-primary-soft-fg hover:underline">
              Ajouter un créneau
            </button>
          ) : undefined
        }
      />
    );
  }
  return (
    <ul className="divide-y divide-border">
      {dayShifts.map((shift) => {
        const employee = byKey.get(shift.employeeId);
        return (
          <li key={shift.id}>
            <button type="button" onClick={() => onEdit(shift)} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-surface-2">
              <span aria-hidden className="h-9 w-[3px] shrink-0 rounded-full" style={{ backgroundColor: employee?.color }} />
              <Avatar name={employee?.displayName ?? 'Salarié'} size="sm" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-fg">{employee?.displayName ?? 'Salarié'}</span>
                <span className="block truncate text-xs text-fg-subtle">
                  {shift.position ?? 'Service'} · {formatDuration(shiftDuration(shift))}
                </span>
              </span>
              <span className="flex flex-col items-end gap-1">
                <span className="font-mono text-sm font-medium text-fg num">
                  {shift.startTime}–{shift.endTime}
                </span>
                {!shift.published && (
                  <Badge tone="amber" size="sm">
                    Brouillon
                  </Badge>
                )}
              </span>
            </button>
          </li>
        );
      })}
      {dayAbsences.map((absence) => (
        <li key={absence.id} className="flex items-center gap-3 px-4 py-3">
          <Palmtree className="tone-amber size-4 text-(--tone-fg)" />
          <span className="min-w-0 flex-1 truncate text-sm text-fg">{byKey.get(absence.employeeId)?.displayName ?? 'Salarié'}</span>
          <Badge tone="amber" size="sm">
            {ABSENCE_TYPE_LABELS[absence.type]}
          </Badge>
        </li>
      ))}
    </ul>
  );
}
