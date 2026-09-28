import { useMemo, useState } from 'react';
import { doc, limit, orderBy, query, updateDoc, where } from 'firebase/firestore';
import { CalendarDays, CalendarPlus, Check, Inbox, List, Palmtree, Paperclip, Plane, Scale, UserX, X } from 'lucide-react';
import {
  Avatar,
  Badge,
  Button,
  Card,
  CardHeader,
  ConfirmDialog,
  DataTable,
  EmptyState,
  PageContainer,
  PageHeader,
  Sheet,
  SheetBody,
  SheetContent,
  SheetFooter,
  SheetHeader,
  Skeleton,
  StatCard,
  StatusBadge,
  Switch,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  createColumnHelper,
  formatRelative,
} from '@golink/ui';
import { ABSENCE_TYPES, ABSENCE_TYPE_LABELS, REQUEST_STATUS_LABELS, paths, type Absence, type Employee, type WithId } from '@golink/shared';
import { useAuth, useDocumentTitle } from '@golink/web';
import { useCan, useRestaurantAccess } from '@/auth/RestaurantAccess';
import { collectionAt, docAt, toDate, updatedFields, useCollection, useDoc, useMutation } from '@/lib/firestore';
import { addDays, currentPeriod, formatDays, formatShortDay, monthBounds, todayIso } from '../_rh/dates';
import { openStoredFile } from '../_rh/files';
import { reviewAbsence } from '../_rh/functions';
import { useEmployees, useMyEmployeeId, useStaffDirectory } from '../_rh/hooks';
import { DetailRow, ErrorCard, MonthSwitcher, REQUEST_STATUS } from '../_rh/ui';
import { AbsenceCalendar } from './AbsenceCalendar';
import { AbsenceRequestDialog } from './AbsenceRequestDialog';
import { ABSENCE_TONE, BALANCE_OF } from './shared';

const column = createColumnHelper<WithId<Absence>>();

function periodLabel(a: Pick<Absence, 'startDate' | 'endDate' | 'halfDayStart' | 'halfDayEnd'>): string {
  const range = a.startDate === a.endDate ? formatShortDay(a.startDate) : `${formatShortDay(a.startDate)} → ${formatShortDay(a.endDate)}`;
  const half = [a.halfDayStart && 'début l’après-midi', a.halfDayEnd && 'fin le matin'].filter(Boolean).join(', ');
  return half ? `${range} (${half})` : range;
}

export function AbsencesPage() {
  useDocumentTitle('Absences · Ciyou Eats Restaurant');
  const can = useCan();
  const manage = can('absences.manage');
  const { restaurantId } = useRestaurantAccess();
  const { user } = useAuth();
  const directory = useStaffDirectory();
  const myEmployeeId = useMyEmployeeId(directory);
  const employees = useEmployees();
  const [period, setPeriod] = useState(currentPeriod());
  const [requestMode, setRequestMode] = useState<'self' | 'manager' | null>(null);
  const [selected, setSelected] = useState<WithId<Absence> | null>(null);
  const [tab, setTab] = useState(manage ? 'a-traiter' : 'mes-absences');

  const absencesCol = collectionAt(paths.restaurantSub(restaurantId, 'absences'));
  const all = useCollection<Absence>(manage || can('planning.view') ? query(absencesCol, orderBy('startDate', 'desc'), limit(300)) : null);
  const mine = useCollection<Absence>(user && myEmployeeId ? query(absencesCol, where('employeeUid', '==', user.uid), orderBy('startDate', 'desc')) : null);
  const myRecord = useDoc<Employee>(myEmployeeId ? docAt(`${paths.restaurantSub(restaurantId, 'employees')}/${myEmployeeId}`) : null);

  const pending = all.data.filter((a) => a.status === 'pending').sort((a, b) => a.startDate.localeCompare(b.startDate));
  const today = todayIso();
  const absentToday = all.data.filter((a) => a.status === 'approved' && a.startDate <= today && a.endDate >= today);
  const weekEnd = addDays(today, 6);
  const upcoming = all.data.filter((a) => a.status === 'approved' && a.startDate > today && a.startDate <= addDays(today, 30));
  const { first, last } = monthBounds(currentPeriod());
  const daysThisMonth = all.data
    .filter((a) => a.status === 'approved' && a.endDate >= first && a.startDate <= last)
    .reduce((t, a) => t + a.durationDays, 0);

  const balances = useMemo(
    () => new Map(employees.data.map((e) => [e.id, { paid: e.paidLeaveBalanceDays, rtt: e.rttBalanceDays }])),
    [employees.data],
  );
  const myBalances = useMemo(() => {
    const map = new Map<string, { paid: number; rtt: number }>();
    if (myEmployeeId && myRecord.data) map.set(myEmployeeId, { paid: myRecord.data.paidLeaveBalanceDays, rtt: myRecord.data.rttBalanceDays });
    return map;
  }, [myEmployeeId, myRecord.data]);

  const name = (employeeId: string) => directory.byEmployeeId.get(employeeId)?.displayName ?? 'Salarié';

  const columns = useMemo(
    () => [
      column.accessor((a) => directory.byEmployeeId.get(a.employeeId)?.displayName ?? 'Salarié', {
        id: 'employee',
        header: 'Salarié',
        cell: (info) => (
          <span className="flex items-center gap-2.5">
            <Avatar name={info.getValue()} size="sm" />
            <span className="text-sm font-medium text-fg">{info.getValue()}</span>
          </span>
        ),
      }),
      column.accessor('type', {
        header: 'Type',
        cell: (info) => <Badge tone={ABSENCE_TONE[info.getValue()]}>{ABSENCE_TYPE_LABELS[info.getValue()]}</Badge>,
      }),
      column.accessor('startDate', { header: 'Période', cell: (info) => <span className="text-sm text-fg">{periodLabel(info.row.original)}</span> }),
      column.accessor('durationDays', {
        header: 'Durée',
        meta: { align: 'right' },
        cell: (info) => <span className="font-mono text-sm num">{formatDays(info.getValue())}</span>,
      }),
      column.accessor('status', { header: 'Statut', cell: (info) => <StatusBadge status={info.getValue()} map={REQUEST_STATUS} /> }),
    ],
    [directory.byEmployeeId],
  );

  const error = all.error ?? mine.error ?? directory.error;
  const canRequest = can('absences.self') && Boolean(myEmployeeId);

  return (
    <PageContainer>
      <PageHeader
        eyebrow="Équipe & RH"
        title="Absences"
        description={manage ? 'Congés, arrêts et formations : validez les demandes, suivez les soldes et anticipez le planning.' : 'Demandez vos congés et suivez vos soldes.'}
        actions={
          <>
            {manage && (
              <Button leftIcon={<CalendarPlus />} onClick={() => setRequestMode('manager')}>
                Saisir une absence
              </Button>
            )}
            {canRequest && (
              <Button variant="primary" leftIcon={<Plane />} onClick={() => setRequestMode('self')}>
                Demander une absence
              </Button>
            )}
          </>
        }
      />

      {error && <ErrorCard error={error} />}

      {manage ? (
        <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard label="Demandes à traiter" value={String(pending.length)} icon={<Inbox />} tone={pending.length ? 'amber' : 'success'} loading={all.loading} footer="En attente de votre décision." />
          <StatCard label="Absents aujourd’hui" value={String(absentToday.length)} icon={<UserX />} tone="danger" loading={all.loading} footer={absentToday.map((a) => name(a.employeeId).split(' ')[0]).join(', ') || 'Toute l’équipe est présente.'} />
          <StatCard label="Départs dans 30 jours" value={String(upcoming.length)} icon={<Plane />} tone="info" loading={all.loading} footer={`Dont ${upcoming.filter((a) => a.startDate <= weekEnd).length} cette semaine.`} />
          <StatCard label="Jours d’absence ce mois" value={formatDays(daysThisMonth)} icon={<CalendarDays />} tone="teal" loading={all.loading} footer="Absences acceptées, jours décomptés." />
        </div>
      ) : (
        myRecord.data && (
          <div className="mb-6 grid gap-4 sm:grid-cols-3">
            <StatCard label="Congés payés disponibles" value={formatDays(myRecord.data.paidLeaveBalanceDays)} icon={<Palmtree />} tone="teal" />
            <StatCard label="RTT disponibles" value={formatDays(myRecord.data.rttBalanceDays)} icon={<Scale />} tone="info" />
            <StatCard label="Demandes en attente" value={String(mine.data.filter((a) => a.status === 'pending').length)} icon={<Inbox />} tone="amber" />
          </div>
        )
      )}

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          {manage && (
            <TabsTrigger value="a-traiter" icon={<Inbox />} count={pending.length}>
              À traiter
            </TabsTrigger>
          )}
          {myEmployeeId && (
            <TabsTrigger value="mes-absences" icon={<Plane />}>
              Mes absences
            </TabsTrigger>
          )}
          <TabsTrigger value="calendrier" icon={<CalendarDays />}>
            Calendrier
          </TabsTrigger>
          {manage && (
            <TabsTrigger value="toutes" icon={<List />}>
              Toutes les absences
            </TabsTrigger>
          )}
          {employees.allowed && (
            <TabsTrigger value="soldes" icon={<Scale />}>
              Soldes
            </TabsTrigger>
          )}
        </TabsList>

        {manage && (
          <TabsContent value="a-traiter" className="mt-5">
            {all.loading ? (
              <div className="space-y-3">
                {[0, 1].map((i) => (
                  <Skeleton key={i} className="h-24" />
                ))}
              </div>
            ) : pending.length === 0 ? (
              <Card>
                <EmptyState icon={<Inbox />} title="Aucune demande en attente" description="Les nouvelles demandes de l’équipe apparaîtront ici, avec le solde restant." />
              </Card>
            ) : (
              <div className="space-y-3">
                {pending.map((absence) => (
                  <PendingCard key={absence.id} absence={absence} name={name(absence.employeeId)} balance={balances.get(absence.employeeId)} onOpen={() => setSelected(absence)} />
                ))}
              </div>
            )}
          </TabsContent>
        )}

        {myEmployeeId && (
          <TabsContent value="mes-absences" className="mt-5">
            <Card>
              {mine.loading ? (
                <div className="space-y-2 p-5">
                  {[0, 1, 2].map((i) => (
                    <Skeleton key={i} className="h-10" />
                  ))}
                </div>
              ) : mine.data.length === 0 ? (
                <EmptyState
                  icon={<Plane />}
                  title="Aucune absence"
                  description="Vos demandes de congés et leurs réponses s’afficheront ici."
                  action={
                    canRequest ? (
                      <Button variant="primary" leftIcon={<Plane />} onClick={() => setRequestMode('self')}>
                        Demander une absence
                      </Button>
                    ) : undefined
                  }
                />
              ) : (
                <ul className="divide-y divide-border">
                  {mine.data.map((absence) => (
                    <li key={absence.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <Badge tone={ABSENCE_TONE[absence.type]}>{ABSENCE_TYPE_LABELS[absence.type]}</Badge>
                          <span className="font-mono text-xs text-fg-muted num">{formatDays(absence.durationDays)}</span>
                        </div>
                        <p className="mt-1 text-sm text-fg">{periodLabel(absence)}</p>
                        {absence.rejectionReason && <p className="mt-0.5 text-xs text-fg-subtle">Motif : {absence.rejectionReason}</p>}
                      </div>
                      <div className="flex items-center gap-2">
                        <StatusBadge status={absence.status} map={REQUEST_STATUS} />
                        {absence.status === 'pending' && <CancelMine absence={absence} />}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </TabsContent>
        )}

        <TabsContent value="calendrier" className="mt-5">
          <Card className="overflow-hidden">
            <CardHeader
              icon={<CalendarDays />}
              title="Calendrier de l’équipe"
              description="Absences acceptées en plein, demandes en attente hachurées."
              actions={<MonthSwitcher period={period} onChange={setPeriod} />}
              divided
            />
            {all.loading || directory.loading ? (
              <Skeleton className="m-5 h-64" />
            ) : (
              <AbsenceCalendar period={period} employees={directory.employees.filter((e) => e.active)} absences={all.data} onSelect={manage ? setSelected : undefined} />
            )}
            <div className="flex flex-wrap gap-2 border-t border-border px-5 py-3">
              {ABSENCE_TYPES.map((type) => (
                <Badge key={type} tone={ABSENCE_TONE[type]} size="sm">
                  {ABSENCE_TYPE_LABELS[type]}
                </Badge>
              ))}
            </div>
          </Card>
        </TabsContent>

        {manage && (
          <TabsContent value="toutes" className="mt-5">
            <DataTable
              data={all.data}
              columns={columns}
              getRowId={(a) => a.id}
              loading={all.loading}
              onRowClick={setSelected}
              searchPlaceholder="Rechercher un salarié…"
              itemLabel="absences"
              filters={[
                { id: 'status', label: 'Statut', options: Object.entries(REQUEST_STATUS_LABELS).map(([value, label]) => ({ value, label })), getValue: (a) => a.status },
                { id: 'type', label: 'Type', options: ABSENCE_TYPES.map((t) => ({ value: t, label: ABSENCE_TYPE_LABELS[t] })), getValue: (a) => a.type },
              ]}
              emptyState={<EmptyState compact icon={<Palmtree />} title="Aucune absence enregistrée" />}
            />
          </TabsContent>
        )}

        {employees.allowed && (
          <TabsContent value="soldes" className="mt-5">
            <BalancesTable employees={employees.data} absences={all.data} loading={employees.loading} />
          </TabsContent>
        )}
      </Tabs>

      {requestMode && (
        <AbsenceRequestDialog
          open
          onOpenChange={(open) => !open && setRequestMode(null)}
          mode={requestMode}
          employees={directory.employees.filter((e) => e.active)}
          myEmployeeId={myEmployeeId}
          balances={requestMode === 'manager' ? balances : myBalances}
        />
      )}
      {manage && <AbsenceSheet absence={selected} name={selected ? name(selected.employeeId) : ''} balance={selected ? balances.get(selected.employeeId) : undefined} onClose={() => setSelected(null)} />}
    </PageContainer>
  );
}

function CancelMine({ absence }: { absence: WithId<Absence> }) {
  const { restaurantId } = useRestaurantAccess();
  const { user } = useAuth();
  const cancel = useMutation(
    async () => {
      await updateDoc(doc(collectionAt(paths.restaurantSub(restaurantId, 'absences')), absence.id), { status: 'cancelled', ...updatedFields(user!.uid) });
    },
    { success: 'Demande annulée' },
  );
  return (
    <Button size="xs" variant="ghost" loading={cancel.loading} onClick={() => void cancel.mutate()}>
      Annuler
    </Button>
  );
}

function PendingCard({ absence, name, balance, onOpen }: { absence: WithId<Absence>; name: string; balance?: { paid: number; rtt: number }; onOpen: () => void }) {
  const { restaurantId } = useRestaurantAccess();
  const [rejectOpen, setRejectOpen] = useState(false);
  const review = useMutation(reviewAbsence, { success: (r) => `Absence acceptée${r.removedShifts ? ` · ${r.removedShifts} créneau(x) retiré(s) du planning` : ''}` });
  const reject = useMutation(reviewAbsence, { success: 'Demande refusée' });
  const field = BALANCE_OF[absence.type];
  const current = field === 'paidLeaveBalanceDays' ? balance?.paid : field === 'rttBalanceDays' ? balance?.rtt : undefined;
  const created = toDate(absence.createdAt);
  return (
    <Card className="p-4 sm:p-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center">
        <button type="button" onClick={onOpen} className="flex min-w-0 flex-1 items-start gap-3 text-left">
          <Avatar name={name} size="md" />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-fg">
              {name}
              {created && <span className="ml-2 text-xs font-normal text-fg-subtle">{formatRelative(created)}</span>}
            </p>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <Badge tone={ABSENCE_TONE[absence.type]}>{ABSENCE_TYPE_LABELS[absence.type]}</Badge>
              <span className="text-sm text-fg">
                {periodLabel(absence)} <span className="whitespace-nowrap font-mono text-xs text-fg-muted num">· {formatDays(absence.durationDays)}</span>
              </span>
            </div>
            {absence.reason && <p className="mt-1.5 text-sm text-fg-muted">« {absence.reason} »</p>}
            {current !== undefined && (
              <p className={current - absence.durationDays < 0 ? 'mt-1.5 text-xs font-medium text-danger' : 'mt-1.5 text-xs text-fg-subtle'}>
                Solde actuel {formatDays(current)} → après acceptation {formatDays(current - absence.durationDays)}
              </p>
            )}
          </div>
        </button>
        <div className="flex shrink-0 gap-2 pl-12 lg:pl-0">
          {absence.attachment && (
            <Button size="sm" variant="ghost" leftIcon={<Paperclip />} onClick={() => void openStoredFile(absence.attachment!)}>
              Justificatif
            </Button>
          )}
          <Button size="sm" variant="ghost" leftIcon={<X />} onClick={() => setRejectOpen(true)}>
            Refuser
          </Button>
          <Button
            size="sm"
            variant="contrast"
            leftIcon={<Check />}
            loading={review.loading}
            onClick={() => void review.mutate({ restaurantId, absenceId: absence.id, decision: 'approve', allowNegativeBalance: false, removeShifts: true })}
          >
            Accepter
          </Button>
        </div>
      </div>
      <ConfirmDialog
        open={rejectOpen}
        onOpenChange={setRejectOpen}
        title={`Refuser la demande de ${name.split(' ')[0]}`}
        description="Le motif est transmis au salarié."
        confirmLabel="Refuser la demande"
        destructive
        requireReason
        reasonLabel="Motif communiqué au salarié"
        onConfirm={async (reason) => {
          await reject.mutate({ restaurantId, absenceId: absence.id, decision: 'reject', reason });
        }}
      />
    </Card>
  );
}

function AbsenceSheet({ absence, name, balance, onClose }: { absence: WithId<Absence> | null; name: string; balance?: { paid: number; rtt: number }; onClose: () => void }) {
  const { restaurantId } = useRestaurantAccess();
  const [allowNegative, setAllowNegative] = useState(false);
  const [removeShifts, setRemoveShifts] = useState(true);
  const [decision, setDecision] = useState<'reject' | 'revoke' | null>(null);
  const review = useMutation(reviewAbsence, { success: 'Décision enregistrée' });
  const field = absence ? BALANCE_OF[absence.type] : undefined;
  const current = field === 'paidLeaveBalanceDays' ? balance?.paid : field === 'rttBalanceDays' ? balance?.rtt : undefined;
  return (
    <Sheet open={absence !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent>
        {absence && (
          <>
            <SheetHeader icon={<Palmtree />} title={`${ABSENCE_TYPE_LABELS[absence.type]} · ${name}`} description={periodLabel(absence)} />
            <SheetBody className="space-y-5">
              <div className="divide-y divide-border rounded-xl border border-border px-4">
                <DetailRow label="Statut">
                  <StatusBadge status={absence.status} map={REQUEST_STATUS} />
                </DetailRow>
                <DetailRow label="Durée décomptée">{formatDays(absence.durationDays)}</DetailRow>
                {current !== undefined && <DetailRow label="Solde actuel">{formatDays(current)}</DetailRow>}
                {absence.reason && <DetailRow label="Précision">{absence.reason}</DetailRow>}
                {absence.rejectionReason && <DetailRow label="Motif">{absence.rejectionReason}</DetailRow>}
              </div>
              {absence.attachment && (
                <Button block leftIcon={<Paperclip />} onClick={() => void openStoredFile(absence.attachment!)}>
                  Ouvrir le justificatif
                </Button>
              )}
              {absence.status === 'pending' && (
                <div className="space-y-3">
                  {current !== undefined && current < absence.durationDays && (
                    <Switch label="Autoriser un solde négatif" description="Le solde est insuffisant pour cette absence." checked={allowNegative} onCheckedChange={setAllowNegative} />
                  )}
                  <Switch label="Retirer les créneaux du planning" description="Les services prévus pendant l’absence sont supprimés." checked={removeShifts} onCheckedChange={setRemoveShifts} />
                </div>
              )}
            </SheetBody>
            <SheetFooter>
              {absence.status === 'pending' && (
                <>
                  <Button variant="ghost" onClick={() => setDecision('reject')}>
                    Refuser
                  </Button>
                  <Button
                    variant="primary"
                    leftIcon={<Check />}
                    loading={review.loading}
                    onClick={async () => {
                      const result = await review.mutate({ restaurantId, absenceId: absence.id, decision: 'approve', allowNegativeBalance: allowNegative, removeShifts });
                      if (result) onClose();
                    }}
                  >
                    Accepter
                  </Button>
                </>
              )}
              {absence.status === 'approved' && (
                <Button variant="danger-soft" onClick={() => setDecision('revoke')}>
                  Annuler l’absence
                </Button>
              )}
            </SheetFooter>
            <ConfirmDialog
              open={decision !== null}
              onOpenChange={(open) => !open && setDecision(null)}
              title={decision === 'revoke' ? 'Annuler cette absence acceptée ?' : 'Refuser la demande'}
              description={decision === 'revoke' ? 'Le solde est recrédité. Pensez à replanifier le salarié.' : 'Le motif est transmis au salarié.'}
              confirmLabel={decision === 'revoke' ? 'Annuler l’absence' : 'Refuser'}
              destructive
              requireReason
              onConfirm={async (reason) => {
                if (!decision) return;
                const result = await review.mutate({ restaurantId, absenceId: absence.id, decision, reason });
                if (result) onClose();
              }}
            />
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function BalancesTable({ employees, absences, loading }: { employees: WithId<Employee>[]; absences: WithId<Absence>[]; loading: boolean }) {
  const year = todayIso().slice(0, 4);
  const today = todayIso();
  const rows = employees
    .filter((e) => e.status !== 'terminated')
    .map((e) => {
      const own = absences.filter((a) => a.employeeId === e.id && a.status === 'approved');
      const taken = own.filter((a) => a.type === 'paid_leave' && a.startDate.startsWith(year) && a.startDate <= today).reduce((t, a) => t + a.durationDays, 0);
      const planned = own.filter((a) => a.type === 'paid_leave' && a.startDate > today).reduce((t, a) => t + a.durationDays, 0);
      const sick = own.filter((a) => a.type === 'sick' && a.startDate.startsWith(year)).reduce((t, a) => t + a.durationDays, 0);
      return { e, taken, planned, sick };
    });
  if (loading) return <Skeleton className="h-64" />;
  return (
    <Card className="overflow-hidden">
      <div data-scroll-ok className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="bg-surface-2">
            <tr className="text-left">
              {['Salarié', 'Congés payés', 'RTT', `Congés pris en ${year}`, 'Congés à venir', `Maladie ${year}`].map((label, i) => (
                <th key={label} className={i === 0 ? 'px-5 py-2.5 eyebrow' : 'px-5 py-2.5 text-right eyebrow'}>
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map(({ e, taken, planned, sick }) => (
              <tr key={e.id}>
                <td className="px-5 py-3">
                  <span className="flex items-center gap-2.5">
                    <Avatar name={`${e.firstName} ${e.lastName}`} size="sm" />
                    <span className="font-medium text-fg">
                      {e.firstName} {e.lastName}
                    </span>
                  </span>
                </td>
                <td className={e.paidLeaveBalanceDays < 0 ? 'px-5 py-3 text-right font-mono font-semibold text-danger num' : 'px-5 py-3 text-right font-mono font-semibold text-fg num'}>
                  {formatDays(e.paidLeaveBalanceDays)}
                </td>
                <td className="px-5 py-3 text-right font-mono text-fg num">{formatDays(e.rttBalanceDays)}</td>
                <td className="px-5 py-3 text-right font-mono text-fg-muted num">{formatDays(taken)}</td>
                <td className="px-5 py-3 text-right font-mono text-fg-muted num">{formatDays(planned)}</td>
                <td className="px-5 py-3 text-right font-mono text-fg-muted num">{formatDays(sick)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="border-t border-border px-5 py-3 text-xs text-fg-subtle">
        Les soldes sont débités à l’acceptation d’une absence et recrédités en cas d’annulation. Ajustez-les depuis la fiche du salarié.
      </p>
    </Card>
  );
}
