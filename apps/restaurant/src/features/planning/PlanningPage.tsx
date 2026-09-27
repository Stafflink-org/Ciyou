import { useMemo, useState } from 'react';
import { addDoc, doc, getDocs, query, updateDoc, where, writeBatch } from 'firebase/firestore';
import {
  CalendarCog,
  CalendarDays,
  CalendarOff,
  Clock3,
  CopyPlus,
  Download,
  EyeOff,
  LayoutTemplate,
  MoreHorizontal,
  Repeat2,
  Send,
  Users,
} from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  EmptyState,
  IconButton,
  PageContainer,
  PageHeader,
  SegmentedControl,
  Skeleton,
  Switch,
  cn,
  formatEUR,
  toast,
} from '@golink/ui';
import { paths, type Shift, type WithId } from '@golink/shared';
import { useAuth, useDocumentTitle } from '@golink/web';
import { useCan, useRestaurantAccess } from '@/auth/RestaurantAccess';
import { db } from '@/lib/firebase';
import { collectionAt, createdFields, updatedFields, useMutation } from '@/lib/firestore';
import {
  addDays,
  formatDuration,
  formatFullDay,
  formatWeekRange,
  formatWeekdayShort,
  mondayOf,
  todayIso,
  weekDays,
} from '../_rh/dates';
import { downloadCsv } from '../_rh/export';
import { publishSchedule } from '../_rh/functions';
import { useEmployees, useMyEmployeeId, useStaffDirectory } from '../_rh/hooks';
import { ErrorCard, MiniStat, WeekSwitcher } from '../_rh/ui';
import { MyRequestsList, PendingRequestsPanel, RequestChangeDialog } from './ChangeRequests';
import { ShiftDialog, type ShiftDraft } from './ShiftDialog';
import { ApplyTemplateDialog, TemplatesSheet } from './Templates';
import { DayList, WeekGrid } from './WeekGrid';
import {
  overlaps,
  shiftDuration,
  useMyChangeRequests,
  usePendingChangeRequests,
  useShiftTemplates,
  useWeekAbsences,
  useWeekAvailabilities,
  useWeekShifts,
} from './data';

export function PlanningPage() {
  useDocumentTitle('Planning · Ciyou Eats Restaurant');
  const can = useCan();
  const canEdit = can('planning.manage');
  const { restaurantId, restaurant } = useRestaurantAccess();
  const { user } = useAuth();
  const today = todayIso();
  const [monday, setMonday] = useState(() => mondayOf(today));
  const [selectedDay, setSelectedDay] = useState(today);
  const directory = useStaffDirectory();
  const myEmployeeId = useMyEmployeeId(directory);
  const [view, setView] = useState<'team' | 'me'>('team');
  const personal = view === 'me' && Boolean(myEmployeeId);

  const shifts = useWeekShifts(monday);
  const absences = useWeekAbsences(monday);
  const availabilities = useWeekAvailabilities(monday, canEdit);
  const pending = usePendingChangeRequests(canEdit);
  const myRequests = useMyChangeRequests();
  const templates = useShiftTemplates();
  const employees = useEmployees();

  const [draft, setDraft] = useState<ShiftDraft | null>(null);
  const [changeShift, setChangeShift] = useState<WithId<Shift> | null>(null);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [applyOpen, setApplyOpen] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);
  const [unpublishOpen, setUnpublishOpen] = useState(false);
  const [notify, setNotify] = useState(true);

  const days = weekDays(monday);
  const activeDay = days.includes(selectedDay) ? selectedDay : days[0]!;
  const visibleShifts = useMemo(() => (canEdit ? shifts.data : shifts.data.filter((s) => s.published)), [canEdit, shifts.data]);
  const weekShiftEmployees = new Set(visibleShifts.map((s) => s.employeeId));
  const gridEmployees = directory.employees.filter((e) => e.active || weekShiftEmployees.has(e.employeeId ?? e.id));
  const drafts = shifts.data.filter((s) => !s.published);
  const publishedCount = shifts.data.length - drafts.length;
  const totalMinutes = visibleShifts.reduce((total, s) => total + shiftDuration(s), 0);
  const rates = new Map(employees.data.map((e) => [e.id, e.hourlyRateCents]));
  const costCents = employees.allowed
    ? Math.round(visibleShifts.reduce((total, s) => total + (shiftDuration(s) / 60) * (rates.get(s.employeeId) ?? 0), 0))
    : null;
  const myShifts = visibleShifts.filter((s) => s.employeeId === myEmployeeId).sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime));
  const myMinutes = myShifts.reduce((total, s) => total + shiftDuration(s), 0);

  const shiftsCollection = collectionAt(paths.restaurantSub(restaurantId, 'shifts'));

  const move = useMutation(
    async (shift: WithId<Shift>, employeeId: string, date: string, copy: boolean) => {
      const entry = directory.byEmployeeId.get(employeeId);
      const patch = { employeeId, employeeUid: entry?.uid ?? null, date, published: false };
      if (copy) {
        const { id: _id, createdAt: _c, updatedAt: _u, createdBy: _cb, updatedBy: _ub, ...rest } = shift;
        await addDoc(shiftsCollection, { ...rest, ...patch, ...createdFields(user!.uid) });
      } else {
        await updateDoc(doc(shiftsCollection, shift.id), { ...patch, ...updatedFields(user!.uid) });
      }
      return copy;
    },
    { success: (copy) => (copy ? 'Créneau dupliqué (brouillon)' : 'Créneau déplacé (brouillon à republier)') },
  );

  const copyPreviousWeek = useMutation(
    async () => {
      const previous = await getDocs(query(shiftsCollection, where('date', '>=', addDays(monday, -7)), where('date', '<=', addDays(monday, -1))));
      const batch = writeBatch(db);
      let count = 0;
      for (const snap of previous.docs) {
        const shift = snap.data() as Shift;
        const date = addDays(shift.date, 7);
        const clash = shifts.data.some((s) => s.employeeId === shift.employeeId && s.date === date && overlaps(s, shift));
        const absent = absences.data.some((a) => a.employeeId === shift.employeeId && a.startDate <= date && a.endDate >= date);
        if (clash || absent) continue;
        batch.set(doc(shiftsCollection), {
          employeeId: shift.employeeId,
          employeeUid: shift.employeeUid ?? null,
          date,
          startTime: shift.startTime,
          endTime: shift.endTime,
          breakMinutes: shift.breakMinutes,
          position: shift.position ?? null,
          notes: shift.notes ?? null,
          published: false,
          templateId: shift.templateId ?? null,
          ...createdFields(user!.uid),
        });
        count += 1;
        if (count >= 450) break;
      }
      if (count > 0) await batch.commit();
      return count;
    },
  );

  const publish = useMutation(publishSchedule, {
    success: (result) => `${result.updated} créneau${result.updated > 1 ? 'x' : ''} mis à jour`,
  });

  function exportWeek() {
    downloadCsv(
      `planning-${restaurant.slug}-${monday}`,
      [...visibleShifts]
        .sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime))
        .map((s) => ({
          Salarié: directory.byEmployeeId.get(s.employeeId)?.displayName ?? s.employeeId,
          Date: s.date,
          Jour: formatWeekdayShort(s.date),
          Début: s.startTime,
          Fin: s.endTime,
          'Pause (min)': s.breakMinutes,
          'Durée (h)': (shiftDuration(s) / 60).toFixed(2).replace('.', ','),
          Poste: s.position ?? '',
          Statut: s.published ? 'Publié' : 'Brouillon',
          Consigne: s.notes ?? '',
        })),
    );
  }

  const loading = shifts.loading || directory.loading;
  const error = shifts.error ?? directory.error ?? absences.error;

  return (
    <PageContainer wide>
      <PageHeader
        eyebrow="Équipe & RH"
        title="Planning"
        description={canEdit ? 'Construisez la semaine, ajustez les services par glisser-déposer et publiez-la à l’équipe.' : 'Vos services et ceux de l’équipe, tels que publiés par votre responsable.'}
        actions={
          canEdit ? (
            <>
              <Button leftIcon={<LayoutTemplate />} onClick={() => setTemplatesOpen(true)}>
                Modèles
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <IconButton label="Autres actions du planning" variant="secondary">
                    <MoreHorizontal />
                  </IconButton>
                </DropdownMenuTrigger>
                <DropdownMenuContent className="w-64">
                  <DropdownMenuItem icon={<CalendarCog />} onSelect={() => setApplyOpen(true)}>
                    Appliquer un modèle
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    icon={<CopyPlus />}
                    onSelect={async () => {
                      const count = await copyPreviousWeek.mutate();
                      if (count === 0) toast.info('Rien à recopier : la semaine précédente est vide ou déjà reprise.');
                      else if (count) toast.success(`${count} créneau${count > 1 ? 'x' : ''} recopié${count > 1 ? 's' : ''} en brouillon`);
                    }}
                  >
                    Recopier la semaine précédente
                  </DropdownMenuItem>
                  <DropdownMenuItem icon={<Download />} onSelect={exportWeek} disabled={visibleShifts.length === 0}>
                    Exporter la semaine (CSV)
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem icon={<EyeOff />} onSelect={() => setUnpublishOpen(true)} disabled={publishedCount === 0}>
                    Retirer la publication
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <Button variant="primary" leftIcon={<Send />} onClick={() => setPublishOpen(true)} disabled={drafts.length === 0}>
                Publier{drafts.length > 0 ? ` (${drafts.length})` : ''}
              </Button>
            </>
          ) : (
            <Button leftIcon={<Download />} onClick={exportWeek} disabled={visibleShifts.length === 0}>
              Exporter
            </Button>
          )
        }
      />

      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <WeekSwitcher monday={monday} onChange={setMonday} />
        {myEmployeeId && (
          <SegmentedControl
            aria-label="Vue du planning"
            value={view}
            onValueChange={(v) => setView(v as 'team' | 'me')}
            options={[
              { value: 'team', label: 'Équipe', icon: <Users /> },
              { value: 'me', label: 'Mon planning', icon: <CalendarDays /> },
            ]}
          />
        )}
      </div>

      {error && <ErrorCard error={error} />}

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {personal ? (
          <>
            <MiniStat label="Mes heures planifiées" value={formatDuration(myMinutes)} hint={`sur ${formatWeekRange(monday)}`} />
            <MiniStat label="Mes services" value={myShifts.length} />
            <MiniStat label="Demandes en attente" value={myRequests.data.filter((r) => r.status === 'pending').length} />
            <MiniStat label="Absences cette semaine" value={absences.data.filter((a) => a.employeeId === myEmployeeId).length} />
          </>
        ) : (
          <>
            <MiniStat label="Heures planifiées" value={loading ? '…' : formatDuration(totalMinutes)} hint={`${weekShiftEmployees.size} salarié(s) planifié(s)`} />
            <MiniStat label="Créneaux" value={loading ? '…' : visibleShifts.length} hint={canEdit ? `${publishedCount} publié(s)` : undefined} />
            {canEdit ? (
              <MiniStat
                label="Brouillons à publier"
                value={drafts.length}
                hint={drafts.length ? 'Invisibles pour l’équipe' : 'Tout est publié'}
                tone={drafts.length ? 'amber' : 'success'}
              />
            ) : (
              <MiniStat label="Mes heures planifiées" value={myEmployeeId ? formatDuration(myMinutes) : '—'} hint={myEmployeeId ? `${myShifts.length} service(s)` : undefined} />
            )}
            {costCents !== null ? (
              <MiniStat label="Coût salarial estimé" value={formatEUR(costCents, { cents: true })} hint="Brut, hors charges et majorations" />
            ) : (
              <MiniStat label="Absences acceptées" value={absences.data.length} />
            )}
          </>
        )}
      </div>

      {canEdit && !personal && <PendingRequestsPanel requests={pending.data} shifts={shifts.data} directory={directory} />}

      {personal ? (
        <>
          <Card>
            {myShifts.length === 0 ? (
              <EmptyState
                icon={<CalendarOff />}
                title="Aucun service publié pour vous cette semaine"
                description="Votre planning apparaît ici dès que votre responsable le publie."
              />
            ) : (
              <ul className="divide-y divide-border">
                {myShifts.map((shift) => (
                  <li key={shift.id} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center">
                    <div className={cn('grid size-12 shrink-0 place-items-center rounded-xl border text-center', shift.date === today ? 'border-primary bg-primary-soft' : 'border-border bg-surface-2')}>
                      <span className="text-2xs font-medium uppercase text-fg-muted">{formatWeekdayShort(shift.date)}</span>
                      <span className="-mt-1 font-display text-lg font-semibold text-fg num">{Number(shift.date.slice(8))}</span>
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="font-mono text-md font-semibold text-fg num">
                        {shift.startTime} – {shift.endTime}
                      </p>
                      <p className="text-sm text-fg-muted">
                        {shift.position ?? 'Service'} · {formatDuration(shiftDuration(shift))} effectives · pause {shift.breakMinutes} min
                      </p>
                      {shift.notes && <p className="mt-1 text-sm text-fg">« {shift.notes} »</p>}
                    </div>
                    {shift.date >= today && (
                      <Button size="sm" leftIcon={<Repeat2 />} onClick={() => setChangeShift(shift)}>
                        Demander une modification
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <MyRequestsList requests={myRequests.data} />
        </>
      ) : (
        <Card className="overflow-hidden">
          {loading ? (
            <div className="space-y-2 p-4">
              {Array.from({ length: 6 }, (_, i) => (
                <Skeleton key={i} className="h-16" />
              ))}
            </div>
          ) : (
            <>
              <div className="hidden md:block">
                <WeekGrid
                  monday={monday}
                  today={today}
                  employees={gridEmployees}
                  shifts={visibleShifts}
                  absences={absences.data}
                  availabilities={availabilities.data}
                  canEdit={canEdit}
                  highlightEmployeeId={myEmployeeId}
                  onCreate={(employeeId, date) => setDraft({ employeeId, date })}
                  onEdit={(shift) => (canEdit ? setDraft({ shift }) : shift.employeeId === myEmployeeId && shift.date >= today && setChangeShift(shift))}
                  onMove={(shift, employeeId, date, copy) => void move.mutate(shift, employeeId, date, copy)}
                />
              </div>
              <div className="md:hidden">
                <div data-scroll-ok className="flex gap-1.5 overflow-x-auto border-b border-border p-3 [scrollbar-width:none]">
                  {days.map((day) => {
                    const count = visibleShifts.filter((s) => s.date === day).length;
                    return (
                      <button
                        key={day}
                        type="button"
                        onClick={() => setSelectedDay(day)}
                        aria-pressed={day === activeDay}
                        className={cn(
                          'flex min-w-12 shrink-0 flex-col items-center rounded-xl border px-2.5 py-1.5 text-xs transition-colors',
                          day === activeDay ? 'border-primary bg-primary-soft text-primary-soft-fg' : 'border-border bg-surface text-fg-muted',
                        )}
                      >
                        <span className="first-letter:uppercase">{formatWeekdayShort(day)}</span>
                        <span className="font-display text-md font-semibold text-fg num">{Number(day.slice(8))}</span>
                        <span className="font-mono text-3xs num">{count}</span>
                      </button>
                    );
                  })}
                </div>
                <div className="flex items-center justify-between px-4 pt-3">
                  <p className="text-sm font-medium text-fg">{formatFullDay(activeDay)}</p>
                  {canEdit && gridEmployees[0] && (
                    <Button size="xs" variant="ghost" onClick={() => setDraft({ employeeId: gridEmployees[0]!.employeeId ?? gridEmployees[0]!.id, date: activeDay })}>
                      Ajouter
                    </Button>
                  )}
                </div>
                <DayList
                  day={activeDay}
                  employees={gridEmployees}
                  shifts={visibleShifts}
                  absences={absences.data}
                  canEdit={canEdit}
                  onCreate={(employeeId, date) => setDraft({ employeeId, date })}
                  onEdit={(shift) => (canEdit ? setDraft({ shift }) : shift.employeeId === myEmployeeId && shift.date >= today && setChangeShift(shift))}
                />
              </div>
            </>
          )}
        </Card>
      )}

      {canEdit && (
        <>
          <ShiftDialog
            draft={draft}
            onClose={() => setDraft(null)}
            employees={gridEmployees}
            shifts={shifts.data}
            absences={absences.data}
            templates={templates.data}
          />
          <TemplatesSheet open={templatesOpen} onOpenChange={setTemplatesOpen} templates={templates.data} />
          <ApplyTemplateDialog
            open={applyOpen}
            onOpenChange={setApplyOpen}
            monday={monday}
            templates={templates.data}
            employees={gridEmployees.filter((e) => e.active)}
            shifts={shifts.data}
            absences={absences.data}
          />
          <ConfirmDialog
            open={publishOpen}
            onOpenChange={setPublishOpen}
            title={`Publier la semaine du ${formatWeekRange(monday)}`}
            description={`${drafts.length} créneau${drafts.length > 1 ? 'x' : ''} en brouillon deviendront visibles par l’équipe.`}
            confirmLabel="Publier le planning"
            onConfirm={async () => {
              await publish.mutate({ restaurantId, weekStart: monday, action: 'publish', notify });
            }}
          >
            <Switch label="Prévenir les salariés" description="Chaque salarié reçoit une notification avec son volume horaire." checked={notify} onCheckedChange={setNotify} />
            <div className="flex flex-wrap gap-1.5">
              {[...new Set(drafts.map((s) => s.employeeId))].map((id) => (
                <Badge key={id} tone="neutral" variant="outline">
                  {directory.byEmployeeId.get(id)?.displayName ?? 'Salarié'}
                </Badge>
              ))}
            </div>
          </ConfirmDialog>
          <ConfirmDialog
            open={unpublishOpen}
            onOpenChange={setUnpublishOpen}
            title="Retirer la publication ?"
            description="Les créneaux de la semaine repassent en brouillon et disparaissent du planning des salariés."
            confirmLabel="Retirer la publication"
            destructive
            onConfirm={async () => {
              await publish.mutate({ restaurantId, weekStart: monday, action: 'unpublish', notify: false });
            }}
          />
        </>
      )}
      <RequestChangeDialog shift={changeShift} employeeId={myEmployeeId} onClose={() => setChangeShift(null)} />
      {!canEdit && !myEmployeeId && (
        <p className="mt-4 flex items-center gap-2 text-xs text-fg-subtle">
          <Clock3 className="size-3.5" /> Votre compte n’est relié à aucune fiche salarié : demandez à votre responsable de le relier pour voir « Mon planning ».
        </p>
      )}
    </PageContainer>
  );
}
