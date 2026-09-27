import { useMemo, useState } from 'react';
import { AlertTriangle, CheckCheck, ChevronDown, History, LogIn, LogOut, MapPin, Pencil, RotateCcw, ShieldCheck, TimerOff, X } from 'lucide-react';
import {
  Avatar,
  Badge,
  Button,
  ConfirmDialog,
  DataTable,
  EmptyState,
  Sheet,
  SheetBody,
  SheetContent,
  SheetFooter,
  SheetHeader,
  StatusBadge,
  Tooltip,
  cn,
  createColumnHelper,
} from '@golink/ui';
import type { Shift, StaffDirectoryEntry, TimeEntry, WeekValidation, WithId } from '@golink/shared';
import { useRestaurantAccess } from '@/auth/RestaurantAccess';
import { toDate, useMutation } from '@/lib/firestore';
import { formatClock, formatDayMonth, formatDuration, formatWeekRange, formatWeekdayShort, shiftMinutes, todayIso, weekDays } from '../_rh/dates';
import { clockEvent, validateWeek } from '../_rh/functions';
import { TIME_ENTRY_STATUS, WEEK_STATUS } from '../_rh/ui';
import { CorrectionDialog, EntryHistory, type CorrectionTarget } from './Correction';
import { breakMinutes, liveWorkedMinutes } from './data';

export interface EmployeeWeekRow {
  id: string;
  entry: WithId<StaffDirectoryEntry>;
  days: Record<string, WithId<TimeEntry> | undefined>;
  worked: number;
  planned: number;
  plannedByDay: Record<string, Shift[]>;
  validation?: WithId<WeekValidation>;
  anomalies: number;
}

const LEGAL_WEEK_MINUTES = 35 * 60;
const column = createColumnHelper<EmployeeWeekRow>();

function DayCell({ entry, planned, day, now }: { entry?: WithId<TimeEntry>; planned: Shift[]; day: string; now: number }) {
  const plannedMinutes = planned.reduce((t, s) => t + shiftMinutes(s.startTime, s.endTime, s.breakMinutes), 0);
  if (!entry?.clockIn) {
    if (plannedMinutes > 0 && day < todayIso()) {
      return (
        <Tooltip content={`Prévu ${planned.map((s) => `${s.startTime}–${s.endTime}`).join(', ')} · aucun pointage`}>
          <span className="tone-danger inline-flex items-center gap-1 rounded-md bg-(--tone-bg) px-1.5 py-0.5 text-2xs font-medium text-(--tone-fg)">
            <TimerOff className="size-3" /> Absent
          </span>
        </Tooltip>
      );
    }
    return <span className="text-xs text-fg-subtle">{plannedMinutes ? `prévu ${formatDuration(plannedMinutes, { compact: true })}` : '—'}</span>;
  }
  const open = !entry.clockOut;
  const worked = liveWorkedMinutes(entry, now);
  const stale = open && day < todayIso();
  const diff = plannedMinutes ? worked - plannedMinutes : 0;
  return (
    <div className="flex flex-col items-start gap-0.5">
      <span className={cn('font-mono text-sm font-medium num', stale ? 'text-danger' : 'text-fg')}>{formatDuration(worked, { compact: true })}</span>
      <span className="flex items-center gap-1">
        {open ? (
          <span className={cn('text-2xs font-medium', stale ? 'text-danger' : 'text-fg-subtle')}>{stale ? 'Sortie manquante' : 'En service'}</span>
        ) : entry.status === 'corrected' ? (
          <span className="text-2xs font-medium text-fg-subtle">Corrigé</span>
        ) : diff > 15 ? (
          <span className="text-2xs font-medium text-fg-subtle num">+{formatDuration(diff, { compact: true })}</span>
        ) : null}
      </span>
    </div>
  );
}

export function TeamWeekTable({ monday, rows, loading }: { monday: string; rows: EmployeeWeekRow[]; loading: boolean }) {
  const { restaurantId } = useRestaurantAccess();
  const days = weekDays(monday);
  const [detail, setDetail] = useState<EmployeeWeekRow | null>(null);
  const [rejecting, setRejecting] = useState<string[] | null>(null);
  const now = Date.now();
  const validate = useMutation(validateWeek, { success: (r) => `${r.updated} semaine${r.updated > 1 ? 's' : ''} mise${r.updated > 1 ? 's' : ''} à jour` });

  const columns = useMemo(
    () => [
      column.accessor((row) => row.entry.displayName, {
        id: 'name',
        header: 'Salarié',
        cell: (info) => (
          <div className="flex min-w-40 items-center gap-2.5">
            <Avatar name={info.getValue()} size="sm" />
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-fg">{info.getValue()}</p>
              {info.row.original.anomalies > 0 ? (
                <p className="flex items-center gap-1 text-2xs font-medium text-danger">
                  <AlertTriangle className="size-3" /> {info.row.original.anomalies} anomalie{info.row.original.anomalies > 1 ? 's' : ''}
                </p>
              ) : (
                <p className="truncate text-2xs text-fg-subtle">{info.row.original.entry.position ?? '—'}</p>
              )}
            </div>
          </div>
        ),
      }),
      ...days.map((day) =>
        column.display({
          id: day,
          header: () => (
            <span className={cn('first-letter:uppercase', day === todayIso() && 'text-primary-soft-fg')}>
              {formatWeekdayShort(day)} {Number(day.slice(8))}
            </span>
          ),
          cell: (info) => <DayCell entry={info.row.original.days[day]} planned={info.row.original.plannedByDay[day] ?? []} day={day} now={now} />,
        }),
      ),
      column.accessor('worked', {
        header: 'Total',
        meta: { align: 'right' },
        cell: (info) => {
          const overtime = info.getValue() - LEGAL_WEEK_MINUTES;
          return (
            <div className="flex flex-col items-end">
              <span className="font-mono text-sm font-semibold text-fg num">{formatDuration(info.getValue(), { compact: true })}</span>
              {overtime > 0 && <span className="font-mono text-2xs text-fg-subtle num">dont {formatDuration(overtime, { compact: true })} sup.</span>}
            </div>
          );
        },
      }),
      column.accessor((row) => row.worked - row.planned, {
        id: 'gap',
        header: 'Écart',
        meta: { align: 'right' },
        cell: (info) => {
          const gap = info.getValue();
          if (!info.row.original.planned) return <span className="text-xs text-fg-subtle">—</span>;
          return (
            <span className={cn('font-mono text-xs num', Math.abs(gap) < 30 ? 'text-fg-subtle' : gap > 0 ? 'text-fg' : 'text-danger')}>
              {gap > 0 ? '+' : ''}
              {formatDuration(gap, { compact: true })}
            </span>
          );
        },
      }),
      column.accessor((row) => row.validation?.status ?? 'pending', {
        id: 'status',
        header: 'Semaine',
        cell: (info) => <StatusBadge status={info.getValue()} map={WEEK_STATUS} />,
      }),
    ],
    [days, now],
  );

  return (
    <>
      <DataTable
        data={rows}
        columns={columns}
        getRowId={(row) => row.id}
        loading={loading}
        searchPlaceholder="Rechercher un salarié…"
        itemLabel="salariés"
        pageSize={25}
        onRowClick={setDetail}
        filters={[
          {
            id: 'status',
            label: 'Statut de la semaine',
            options: Object.entries(WEEK_STATUS).map(([value, meta]) => ({ value, label: meta.label })),
            getValue: (row) => row.validation?.status ?? 'pending',
          },
          {
            id: 'anomalies',
            label: 'Anomalies',
            options: [
              { value: 'yes', label: 'Avec anomalie' },
              { value: 'no', label: 'Sans anomalie' },
            ],
            getValue: (row) => (row.anomalies > 0 ? 'yes' : 'no'),
          },
        ]}
        bulkActions={[
          {
            label: 'Valider la semaine',
            icon: <CheckCheck />,
            onClick: (selected, clear) => {
              void validate.mutate({ restaurantId, weekStart: monday, employeeIds: selected.map((r) => r.id), action: 'validate' }).then((ok) => ok && clear());
            },
          },
          {
            label: 'Rouvrir',
            icon: <RotateCcw />,
            onClick: (selected, clear) => {
              void validate.mutate({ restaurantId, weekStart: monday, employeeIds: selected.map((r) => r.id), action: 'reopen' }).then((ok) => ok && clear());
            },
          },
          { label: 'Refuser', icon: <X />, destructive: true, onClick: (selected) => setRejecting(selected.map((r) => r.id)) },
        ]}
        emptyState={<EmptyState compact icon={<TimerOff />} title="Aucun salarié" description="Les pointages de l’équipe apparaîtront ici." />}
      />
      <WeekDetailSheet row={detail} monday={monday} onClose={() => setDetail(null)} />
      <ConfirmDialog
        open={rejecting !== null}
        onOpenChange={(open) => !open && setRejecting(null)}
        title="Refuser la semaine"
        description="Le salarié devra revoir ses pointages ; le motif est conservé dans le journal."
        confirmLabel="Refuser"
        destructive
        requireReason
        onConfirm={async (reason) => {
          if (rejecting) await validate.mutate({ restaurantId, weekStart: monday, employeeIds: rejecting, action: 'reject', comment: reason });
        }}
      />
    </>
  );
}

function WeekDetailSheet({ row, monday, onClose }: { row: EmployeeWeekRow | null; monday: string; onClose: () => void }) {
  const { restaurantId } = useRestaurantAccess();
  const [correction, setCorrection] = useState<CorrectionTarget | null>(null);
  const [historyOf, setHistoryOf] = useState<string | null>(null);
  const validate = useMutation(validateWeek, { success: 'Semaine mise à jour' });
  const onBehalf = useMutation(clockEvent, { success: 'Pointage enregistré pour le salarié' });
  const now = Date.now();
  const today = todayIso();
  const status = row?.validation?.status ?? 'pending';

  return (
    <Sheet open={row !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="sm:max-w-xl">
        {row && (
          <>
            <SheetHeader
              icon={<Avatar name={row.entry.displayName} size="md" />}
              title={row.entry.displayName}
              description={`Semaine du ${formatWeekRange(monday)} · ${formatDuration(row.worked)} pointées pour ${formatDuration(row.planned)} prévues`}
            />
            <SheetBody className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge status={status} map={WEEK_STATUS} />
                {row.validation?.managerComment && <span className="text-xs text-fg-muted">« {row.validation.managerComment} »</span>}
                {row.validation?.employeeComment && <span className="text-xs text-fg-muted">Salarié : « {row.validation.employeeComment} »</span>}
              </div>
              {weekDays(monday).map((day) => {
                const entry = row.days[day];
                const planned = row.plannedByDay[day] ?? [];
                const open = entry?.clockIn && !entry.clockOut;
                const distance = entry?.clockIn?.distanceMeters ?? null;
                return (
                  <div key={day} className="rounded-xl border border-border bg-surface p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold first-letter:uppercase text-fg">
                          {formatWeekdayShort(day)} {formatDayMonth(day)}
                        </p>
                        <p className="text-xs text-fg-subtle">
                          {planned.length ? `Prévu ${planned.map((s) => `${s.startTime}–${s.endTime}`).join(', ')}` : 'Aucun service prévu'}
                        </p>
                      </div>
                      {entry && <StatusBadge status={entry.status} map={TIME_ENTRY_STATUS} />}
                    </div>
                    {entry?.clockIn ? (
                      <div className="mt-3 grid grid-cols-3 gap-2 text-sm">
                        <div>
                          <p className="text-2xs text-fg-subtle">Arrivée</p>
                          <p className="font-mono font-medium text-fg num">{formatClock(toDate(entry.clockIn.at))}</p>
                        </div>
                        <div>
                          <p className="text-2xs text-fg-subtle">Sortie</p>
                          <p className={cn('font-mono font-medium num', open ? 'text-fg-subtle' : 'text-fg')}>{formatClock(toDate(entry.clockOut?.at))}</p>
                        </div>
                        <div className="text-right">
                          <p className="text-2xs text-fg-subtle">Travaillé</p>
                          <p className="font-mono font-semibold text-fg num">{formatDuration(liveWorkedMinutes(entry, now))}</p>
                        </div>
                        <p className="col-span-3 text-xs text-fg-subtle">
                          Pauses : {breakMinutes(entry, now)} min
                          {entry.nightMinutes ? ` · nuit : ${formatDuration(entry.nightMinutes)}` : ''}
                          {distance !== null && (
                            <span className="ml-1 inline-flex items-center gap-0.5">
                              · <MapPin className="size-3" /> {distance < 1000 ? `${distance} m` : `${(distance / 1000).toFixed(1)} km`}
                            </span>
                          )}
                        </p>
                        {entry.notes && <p className="col-span-3 text-xs text-fg-muted">{entry.notes}</p>}
                      </div>
                    ) : (
                      <p className="mt-3 text-sm text-fg-subtle">Aucun pointage.</p>
                    )}
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      <Button
                        size="xs"
                        leftIcon={<Pencil />}
                        disabled={status === 'manager_validated'}
                        onClick={() => setCorrection({ employeeId: row.id, employeeName: row.entry.displayName, date: day, entry: entry ?? null, planned: planned[0] ?? null })}
                      >
                        {entry ? 'Corriger' : 'Saisir'}
                      </Button>
                      {entry && (
                        <Button size="xs" variant="ghost" leftIcon={<History />} rightIcon={<ChevronDown className={cn('transition-transform', historyOf === entry.id && 'rotate-180')} />} onClick={() => setHistoryOf(historyOf === entry.id ? null : entry.id)}>
                          Historique
                        </Button>
                      )}
                      {day === today && (!entry?.clockIn || entry.clockOut) && (
                        <Button size="xs" variant="ghost" leftIcon={<LogIn />} loading={onBehalf.loading} onClick={() => void onBehalf.mutate({ restaurantId, action: 'in', employeeId: row.id, source: 'backoffice' })}>
                          Pointer l’arrivée
                        </Button>
                      )}
                      {day === today && open && (
                        <Button size="xs" variant="ghost" leftIcon={<LogOut />} loading={onBehalf.loading} onClick={() => void onBehalf.mutate({ restaurantId, action: 'out', employeeId: row.id, source: 'backoffice' })}>
                          Pointer la sortie
                        </Button>
                      )}
                    </div>
                    {entry && historyOf === entry.id && (
                      <div className="mt-3 border-t border-border pt-3">
                        <EntryHistory entryId={entry.id} />
                      </div>
                    )}
                  </div>
                );
              })}
            </SheetBody>
            <SheetFooter>
              {status === 'manager_validated' ? (
                <Button leftIcon={<RotateCcw />} loading={validate.loading} onClick={() => void validate.mutate({ restaurantId, weekStart: monday, employeeIds: [row.id], action: 'reopen' })}>
                  Rouvrir la semaine
                </Button>
              ) : (
                <Button variant="primary" leftIcon={<ShieldCheck />} loading={validate.loading} onClick={() => void validate.mutate({ restaurantId, weekStart: monday, employeeIds: [row.id], action: 'validate' })}>
                  Valider la semaine
                </Button>
              )}
            </SheetFooter>
          </>
        )}
        <CorrectionDialog target={correction} onClose={() => setCorrection(null)} />
      </SheetContent>
    </Sheet>
  );
}

export function OnDutyStrip({ rows }: { rows: EmployeeWeekRow[] }) {
  const today = todayIso();
  const now = Date.now();
  const onDuty = rows
    .map((row) => ({ row, entry: row.days[today] }))
    .filter(({ entry }) => entry?.clockIn && !entry.clockOut);
  if (onDuty.length === 0) return null;
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-border bg-surface px-4 py-3 shadow-card">
      <span className="tone-success mr-1 inline-flex items-center gap-1.5 text-sm font-semibold text-fg">
        <span className="relative flex size-2">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-(--tone-solid) opacity-60" />
          <span className="relative inline-flex size-2 rounded-full bg-(--tone-solid)" />
        </span>
        En service maintenant
      </span>
      {onDuty.map(({ row, entry }) => {
        const onBreak = entry!.breaks.some((b) => !b.end);
        return (
          <Badge key={row.id} tone={onBreak ? 'amber' : 'success'} variant="outline" className="h-7 gap-1.5 pl-1 pr-2.5">
            <Avatar name={row.entry.displayName} size="xs" />
            {row.entry.firstName}
            <span className="font-mono num opacity-80">{onBreak ? 'pause' : formatDuration(liveWorkedMinutes(entry!, now), { compact: true })}</span>
          </Badge>
        );
      })}
    </div>
  );
}
