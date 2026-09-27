import { Avatar, EmptyState, Tooltip, cn } from '@golink/ui';
import { ABSENCE_TYPE_LABELS, type Absence, type StaffDirectoryEntry, type WithId } from '@golink/shared';
import { CalendarDays } from 'lucide-react';
import { daysBetween, formatShortDay, isHoliday, monthBounds, todayIso, weekdayIndex } from '../_rh/dates';
import { ABSENCE_TONE } from './shared';

/** Calendrier mensuel des absences : un salarié par ligne, un jour par colonne. */
export function AbsenceCalendar({
  period,
  employees,
  absences,
  onSelect,
}: {
  period: string;
  employees: WithId<StaffDirectoryEntry>[];
  absences: WithId<Absence>[];
  onSelect?: (absence: WithId<Absence>) => void;
}) {
  const { first, last } = monthBounds(period);
  const days = daysBetween(first, last);
  const today = todayIso();
  const visible = absences.filter((a) => a.status === 'approved' || a.status === 'pending');
  if (employees.length === 0) {
    return <EmptyState compact icon={<CalendarDays />} title="Aucun salarié" description="Le calendrier se remplit avec les fiches de l’équipe." />;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[980px] border-separate border-spacing-0 text-xs">
        <thead>
          <tr>
            <th className="sticky left-0 z-10 w-44 border-b border-r border-border bg-surface-2 px-3 py-2 text-left">
              <span className="eyebrow">Salarié</span>
            </th>
            {days.map((day) => {
              const weekend = weekdayIndex(day) >= 5;
              return (
                <th
                  key={day}
                  className={cn(
                    'border-b border-border px-0 py-1.5 text-center font-mono font-medium num',
                    weekend || isHoliday(day) ? 'bg-surface-3 text-fg-subtle' : 'bg-surface-2 text-fg-muted',
                    day === today && 'bg-primary-soft text-primary-soft-fg',
                  )}
                >
                  <span className="block text-3xs uppercase">{'LMMJVSD'[weekdayIndex(day)]}</span>
                  {Number(day.slice(8))}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {employees.map((employee) => {
            const id = employee.employeeId ?? employee.id;
            const own = visible.filter((a) => a.employeeId === id && a.endDate >= first && a.startDate <= last);
            return (
              <tr key={id}>
                <th scope="row" className="sticky left-0 z-10 border-b border-r border-border bg-surface px-3 py-2 text-left font-normal">
                  <span className="flex items-center gap-2">
                    <Avatar name={employee.displayName} size="xs" />
                    <span className="truncate text-sm text-fg">{employee.displayName}</span>
                  </span>
                </th>
                {days.map((day) => {
                  const absence = own.find((a) => a.startDate <= day && a.endDate >= day);
                  const weekend = weekdayIndex(day) >= 5;
                  const tone = absence ? ABSENCE_TONE[absence.type] : null;
                  const isStart = absence && (absence.startDate === day || day === first);
                  const isEnd = absence && (absence.endDate === day || day === last);
                  return (
                    <td key={day} className={cn('h-10 border-b border-border p-0', (weekend || isHoliday(day)) && 'bg-surface-2')}>
                      {absence && tone && (
                        <Tooltip
                          content={`${ABSENCE_TYPE_LABELS[absence.type]} · ${formatShortDay(absence.startDate)} → ${formatShortDay(absence.endDate)}${absence.status === 'pending' ? ' (en attente)' : ''}`}
                        >
                          <button
                            type="button"
                            onClick={() => onSelect?.(absence)}
                            aria-label={`${employee.displayName} : ${ABSENCE_TYPE_LABELS[absence.type]}`}
                            className={cn(
                              `tone-${tone}`,
                              'mx-auto block h-6 w-full border-y border-(--tone-border) bg-(--tone-bg)',
                              absence.status === 'pending' && 'border-dashed bg-[repeating-linear-gradient(135deg,var(--tone-bg)_0_5px,transparent_5px_9px)]',
                              isStart && 'ml-0.5 rounded-l-md border-l',
                              isEnd && 'mr-0.5 rounded-r-md border-r',
                            )}
                          />
                        </Tooltip>
                      )}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
