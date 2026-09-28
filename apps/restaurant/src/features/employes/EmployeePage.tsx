import { useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router';
import { doc, limit, orderBy, query, updateDoc, where } from 'firebase/firestore';
import {
  ArrowLeft,
  BadgeEuro,
  CalendarClock,
  CalendarDays,
  Clock3,
  FileText,
  Mail,
  MoreHorizontal,
  Palmtree,
  Pencil,
  Phone,
  ReceiptText,
  UserRound,
  UserRoundCheck,
  UserRoundX,
} from 'lucide-react';
import {
  Avatar,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  ConfirmDialog,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  EmptyState,
  FormField,
  IconButton,
  Input,
  PageContainer,
  ProgressBar,
  Skeleton,
  StatusBadge,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  formatEUR,
} from '@golink/ui';
import {
  ABSENCE_TYPE_LABELS,
  CONTRACT_TYPE_LABELS,
  paths,
  type Absence,
  type Employee,
  type Payslip,
  type Shift,
  type TimeEntry,
  type WithId,
} from '@golink/shared';
import { useAuth, useDocumentTitle } from '@golink/web';
import { useCan, useRestaurantAccess } from '@/auth/RestaurantAccess';
import { collectionAt, docAt, toDate, updatedFields, useCollection, useDoc, useMutation } from '@/lib/firestore';
import {
  addDays,
  formatClock,
  formatDays,
  formatDayMonth,
  formatDuration,
  formatMonth,
  formatShortDay,
  formatWeekdayShort,
  mondayOf,
  shiftMinutes,
  todayIso,
} from '../_rh/dates';
import { useEmployees } from '../_rh/hooks';
import { DetailRow, EMPLOYEE_STATUS, ErrorCard, PAYSLIP_STATUS, REQUEST_STATUS, TIME_ENTRY_STATUS } from '../_rh/ui';
import { EmployeeDocuments } from './EmployeeDocuments';
import { EmployeeFormSheet } from './EmployeeFormSheet';
import { monthlyBaseCents } from './EmployeesPage';

const CATEGORY_LABELS: Record<Employee['socialCategory'], string> = { employee: 'Employé', supervisor: 'Agent de maîtrise', executive: 'Cadre' };

function seniority(hireDate: string): string {
  const [y = 0, m = 1] = hireDate.split('-').map(Number);
  const now = new Date();
  const months = (now.getFullYear() - y) * 12 + (now.getMonth() + 1 - m);
  if (months < 1) return 'moins d’un mois';
  if (months < 12) return `${months} mois`;
  const years = Math.floor(months / 12);
  return `${years} an${years > 1 ? 's' : ''}${months % 12 ? ` et ${months % 12} mois` : ''}`;
}

function ActivityCard({ icon, title, action, children }: { icon: ReactNode; title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <Card>
      <CardHeader icon={icon} title={title} actions={action} divided />
      {children}
    </Card>
  );
}

function ListSkeleton() {
  return (
    <div className="space-y-2 p-5">
      {[0, 1, 2].map((i) => (
        <Skeleton key={i} className="h-9" />
      ))}
    </div>
  );
}

function Activity({ employee }: { employee: WithId<Employee> }) {
  const { restaurantId } = useRestaurantAccess();
  const can = useCan();
  const monday = mondayOf(todayIso());
  const shifts = useCollection<Shift>(
    query(
      collectionAt(paths.restaurantSub(restaurantId, 'shifts')),
      where('employeeId', '==', employee.id),
      where('date', '>=', monday),
      where('date', '<=', addDays(monday, 13)),
      orderBy('date'),
    ),
  );
  const entries = useCollection<TimeEntry>(
    can('timeclock.manage')
      ? query(collectionAt(paths.restaurantSub(restaurantId, 'timeEntries')), where('employeeId', '==', employee.id), orderBy('date', 'desc'), limit(8))
      : null,
  );
  const absences = useCollection<Absence>(
    query(collectionAt(paths.restaurantSub(restaurantId, 'absences')), where('employeeId', '==', employee.id), orderBy('startDate', 'desc'), limit(6)),
  );
  const payslips = useCollection<Payslip>(
    can('payroll.view')
      ? query(collectionAt(paths.restaurantSub(restaurantId, 'payslips')), where('employeeId', '==', employee.id), orderBy('period', 'desc'), limit(6))
      : null,
  );
  const plannedMinutes = shifts.data.reduce((total, s) => total + shiftMinutes(s.startTime, s.endTime, s.breakMinutes), 0);

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <ActivityCard
        icon={<CalendarDays />}
        title="Planning des deux semaines"
        action={
          <Button size="xs" variant="ghost" asChild>
            <Link to="/equipe/planning">Ouvrir le planning</Link>
          </Button>
        }
      >
        {shifts.error ? (
          <div className="p-5"><ErrorCard error={shifts.error} /></div>
        ) : shifts.loading ? (
          <ListSkeleton />
        ) : shifts.data.length === 0 ? (
          <EmptyState compact icon={<CalendarDays />} title="Aucun créneau planifié" description="Aucun service prévu cette semaine ni la suivante." />
        ) : (
          <>
            <ul className="divide-y divide-border">
              {shifts.data.map((shift) => (
                <li key={shift.id} className="flex items-center justify-between gap-3 px-5 py-2.5 text-sm">
                  <span className="min-w-0">
                    <span className="font-medium first-letter:uppercase text-fg">{formatWeekdayShort(shift.date)} {formatDayMonth(shift.date)}</span>
                    {shift.position && <span className="ml-2 text-xs text-fg-subtle">{shift.position}</span>}
                  </span>
                  <span className="flex items-center gap-2">
                    {!shift.published && <Badge size="sm" tone="amber">Brouillon</Badge>}
                    <span className="font-mono text-xs text-fg-muted num">
                      {shift.startTime} – {shift.endTime}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
            <p className="border-t border-border px-5 py-2.5 text-xs text-fg-muted">
              Total planifié : <span className="font-medium text-fg num">{formatDuration(plannedMinutes)}</span> pour {employee.weeklyHours} h / semaine au contrat.
            </p>
          </>
        )}
      </ActivityCard>

      {can('timeclock.manage') && (
        <ActivityCard
          icon={<Clock3 />}
          title="Derniers pointages"
          action={
            <Button size="xs" variant="ghost" asChild>
              <Link to="/equipe/pointages">Tous les pointages</Link>
            </Button>
          }
        >
          {entries.error ? (
            <div className="p-5"><ErrorCard error={entries.error} /></div>
          ) : entries.loading ? (
            <ListSkeleton />
          ) : entries.data.length === 0 ? (
            <EmptyState compact icon={<Clock3 />} title="Aucun pointage" description="Les entrées et sorties apparaîtront ici." />
          ) : (
            <ul className="divide-y divide-border">
              {entries.data.map((entry) => (
                <li key={entry.id} className="flex items-center justify-between gap-3 px-5 py-2.5 text-sm">
                  <span className="min-w-0">
                    <span className="font-medium first-letter:uppercase text-fg">{formatWeekdayShort(entry.date)} {formatDayMonth(entry.date)}</span>
                    <span className="ml-2 font-mono text-xs text-fg-subtle num">
                      {formatClock(toDate(entry.clockIn?.at))} – {formatClock(toDate(entry.clockOut?.at))}
                    </span>
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="font-mono text-xs text-fg num">{formatDuration(entry.workedMinutes)}</span>
                    <StatusBadge status={entry.status} map={TIME_ENTRY_STATUS} />
                  </span>
                </li>
              ))}
            </ul>
          )}
        </ActivityCard>
      )}

      <ActivityCard
        icon={<Palmtree />}
        title="Absences"
        action={
          <Button size="xs" variant="ghost" asChild>
            <Link to="/equipe/absences">Gérer les absences</Link>
          </Button>
        }
      >
        {absences.error ? (
          <div className="p-5"><ErrorCard error={absences.error} /></div>
        ) : absences.loading ? (
          <ListSkeleton />
        ) : absences.data.length === 0 ? (
          <EmptyState compact icon={<Palmtree />} title="Aucune absence" description="Congés, arrêts et formations s’afficheront ici." />
        ) : (
          <ul className="divide-y divide-border">
            {absences.data.map((absence) => (
              <li key={absence.id} className="flex items-center justify-between gap-3 px-5 py-2.5 text-sm">
                <span className="min-w-0">
                  <span className="font-medium text-fg">{ABSENCE_TYPE_LABELS[absence.type]}</span>
                  <span className="ml-2 text-xs text-fg-subtle">
                    {absence.startDate === absence.endDate
                      ? formatShortDay(absence.startDate)
                      : `${formatShortDay(absence.startDate)} → ${formatShortDay(absence.endDate)}`}
                  </span>
                </span>
                <StatusBadge status={absence.status} map={REQUEST_STATUS} />
              </li>
            ))}
          </ul>
        )}
      </ActivityCard>

      {can('payroll.view') && (
        <ActivityCard
          icon={<ReceiptText />}
          title="Bulletins de paie"
          action={
            <Button size="xs" variant="ghost" asChild>
              <Link to="/equipe/paie">Ouvrir la paie</Link>
            </Button>
          }
        >
          {payslips.error ? (
            <div className="p-5"><ErrorCard error={payslips.error} /></div>
          ) : payslips.loading ? (
            <ListSkeleton />
          ) : payslips.data.length === 0 ? (
            <EmptyState compact icon={<ReceiptText />} title="Aucun bulletin" description="Les bulletins calculés apparaîtront ici." />
          ) : (
            <ul className="divide-y divide-border">
              {payslips.data.map((payslip) => (
                <li key={payslip.id} className="flex items-center justify-between gap-3 px-5 py-2.5 text-sm">
                  <span className="font-medium text-fg">{formatMonth(payslip.period)}</span>
                  <span className="flex items-center gap-3">
                    <span className="font-mono text-xs text-fg num">{formatEUR(payslip.netCents, { cents: true })} net</span>
                    <StatusBadge status={payslip.status} map={PAYSLIP_STATUS} />
                  </span>
                </li>
              ))}
            </ul>
          )}
        </ActivityCard>
      )}
    </div>
  );
}

export function EmployeePage() {
  const { employeeId = '' } = useParams();
  const { restaurantId } = useRestaurantAccess();
  const { user } = useAuth();
  const can = useCan();
  const canManage = can('team.manage');
  const state = useDoc<Employee>(docAt(`${paths.restaurantSub(restaurantId, 'employees')}/${employeeId}`));
  const employees = useEmployees();
  const [editOpen, setEditOpen] = useState(false);
  const [exitOpen, setExitOpen] = useState(false);
  const [exitDate, setExitDate] = useState(todayIso());
  const employee = state.data;
  useDocumentTitle(`${employee ? `${employee.firstName} ${employee.lastName}` : 'Salarié'} · Ciyou Eats Restaurant`);

  const setStatus = useMutation(
    async (patch: Partial<Employee>) => {
      await updateDoc(doc(collectionAt(paths.restaurantSub(restaurantId, 'employees')), employeeId), { ...patch, ...updatedFields(user!.uid) });
    },
    { success: 'Fiche mise à jour' },
  );

  const back = (
    <Link to="/equipe/employes" className="inline-flex items-center gap-1.5 text-sm text-fg-muted transition-colors hover:text-fg">
      <ArrowLeft className="size-4" /> Employés
    </Link>
  );

  if (state.loading) {
    return (
      <PageContainer>
        {back}
        <div className="mt-6 flex items-center gap-4">
          <Skeleton className="size-14 rounded-full" />
          <div className="space-y-2">
            <Skeleton className="h-6 w-56" />
            <Skeleton className="h-4 w-36" />
          </div>
        </div>
        <div className="mt-8 grid gap-4 lg:grid-cols-3">
          <Skeleton className="h-64 lg:col-span-2" />
          <Skeleton className="h-64" />
        </div>
      </PageContainer>
    );
  }

  if (state.error || !employee) {
    return (
      <PageContainer>
        {back}
        <Card className="mt-6">
          {state.error ? (
            <div className="p-5"><ErrorCard error={state.error} /></div>
          ) : (
            <EmptyState
              icon={<UserRound />}
              title="Salarié introuvable"
              description="Cette fiche n’existe pas dans l’établissement sélectionné."
              action={
                <Button asChild>
                  <Link to="/equipe/employes">Retour à l’équipe</Link>
                </Button>
              }
            />
          )}
        </Card>
      </PageContainer>
    );
  }

  const fullName = `${employee.firstName} ${employee.lastName}`;
  const terminated = employee.status === 'terminated';

  return (
    <PageContainer>
      {back}
      <header className="mt-5 mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-4">
          <Avatar name={fullName} size="xl" />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="font-display text-2xl font-semibold tracking-display text-fg">{fullName}</h1>
              <StatusBadge status={employee.status} map={EMPLOYEE_STATUS} />
            </div>
            <p className="mt-1 text-md text-fg-muted">
              {employee.position}
              {employee.department ? ` · ${employee.department}` : ''} · {CONTRACT_TYPE_LABELS[employee.contractType]} depuis {seniority(employee.hireDate)}
            </p>
          </div>
        </div>
        {canManage && (
          <div className="flex shrink-0 items-center gap-2">
            <Button leftIcon={<Pencil />} onClick={() => setEditOpen(true)}>
              Modifier
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <IconButton label="Plus d’actions" variant="secondary">
                  <MoreHorizontal />
                </IconButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                {terminated ? (
                  <DropdownMenuItem icon={<UserRoundCheck />} onSelect={() => void setStatus.mutate({ status: 'active', endDate: null })}>
                    Réintégrer dans l’équipe
                  </DropdownMenuItem>
                ) : (
                  <DropdownMenuItem icon={<UserRoundX />} destructive onSelect={() => setExitOpen(true)}>
                    Sortie des effectifs
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
      </header>

      <Tabs defaultValue="apercu">
        <TabsList>
          <TabsTrigger value="apercu" icon={<UserRound />}>Aperçu</TabsTrigger>
          <TabsTrigger value="documents" icon={<FileText />}>Documents</TabsTrigger>
          <TabsTrigger value="activite" icon={<CalendarClock />}>Activité</TabsTrigger>
        </TabsList>

        <TabsContent value="apercu" className="mt-5">
          <div className="grid gap-4 lg:grid-cols-3">
            <div className="space-y-4 lg:col-span-2">
              <Card>
                <CardHeader icon={<FileText />} title="Contrat" divided />
                <CardContent className="divide-y divide-border py-1">
                  <DetailRow label="Type de contrat">{CONTRACT_TYPE_LABELS[employee.contractType]}</DetailRow>
                  <DetailRow label="Date d’entrée">{formatShortDay(employee.hireDate)}</DetailRow>
                  <DetailRow label={employee.contractType === 'cdi' ? 'Date de sortie' : 'Fin de contrat'}>
                    {employee.endDate ? formatShortDay(employee.endDate) : '—'}
                  </DetailRow>
                  <DetailRow label="Durée hebdomadaire">{employee.weeklyHours} h</DetailRow>
                  <DetailRow label="Classification">{employee.classification ?? '—'}</DetailRow>
                  <DetailRow label="Catégorie">{CATEGORY_LABELS[employee.socialCategory]}</DetailRow>
                </CardContent>
              </Card>
              <Card>
                <CardHeader icon={<BadgeEuro />} title="Rémunération" divided />
                <CardContent className="divide-y divide-border py-1">
                  <DetailRow label="Taux horaire brut">
                    <span className="font-mono num">{formatEUR(employee.hourlyRateCents, { cents: true })}</span>
                  </DetailRow>
                  <DetailRow label="Salaire mensuel de base (estimé)">
                    <span className="font-mono num">{formatEUR(monthlyBaseCents(employee), { cents: true })}</span>
                  </DetailRow>
                  <DetailRow label="Prélèvement à la source">
                    {employee.withholdingTaxRateBps !== null && employee.withholdingTaxRateBps !== undefined
                      ? `${(employee.withholdingTaxRateBps / 100).toLocaleString('fr-FR')} % (taux personnalisé)`
                      : 'Taux neutre'}
                  </DetailRow>
                  <DetailRow label="Sécurité sociale">{employee.socialSecurityLast4 ? `•••• ${employee.socialSecurityLast4}` : '—'}</DetailRow>
                </CardContent>
              </Card>
            </div>
            <div className="space-y-4">
              <Card>
                <CardHeader icon={<Palmtree />} title="Soldes de congés" divided />
                <CardContent className="space-y-5">
                  <div>
                    <p className="text-xs font-medium text-fg-muted">Congés payés</p>
                    <p className={employee.paidLeaveBalanceDays < 0 ? 'num mt-1 font-display text-3xl font-semibold text-danger' : 'num mt-1 font-display text-3xl font-semibold text-fg'}>
                      {formatDays(employee.paidLeaveBalanceDays)}
                    </p>
                    <ProgressBar className="mt-2" value={Math.max(0, employee.paidLeaveBalanceDays)} max={30} tone="teal" size="sm" />
                  </div>
                  <div>
                    <p className="text-xs font-medium text-fg-muted">RTT</p>
                    <p className="num mt-1 font-display text-2xl font-semibold text-fg">{formatDays(employee.rttBalanceDays)}</p>
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader icon={<UserRound />} title="Coordonnées et accès" divided />
                <CardContent className="space-y-3 text-sm">
                  <p className="flex items-center gap-2 text-fg">
                    <Mail className="size-4 text-fg-subtle" />
                    {employee.email ? <a className="truncate hover:underline" href={`mailto:${employee.email}`}>{employee.email}</a> : <span className="text-fg-subtle">Non renseigné</span>}
                  </p>
                  <p className="flex items-center gap-2 text-fg">
                    <Phone className="size-4 text-fg-subtle" />
                    {employee.phone ? <a className="hover:underline" href={`tel:${employee.phone.replace(/\s/g, '')}`}>{employee.phone}</a> : <span className="text-fg-subtle">Non renseigné</span>}
                  </p>
                  <div className="rounded-lg border border-border bg-surface-2 p-3 text-xs text-fg-muted">
                    {employee.uid
                      ? 'Compte Ciyou Eats relié : le salarié consulte son planning, pointe et demande ses absences.'
                      : 'Aucun compte relié : invitez le salarié depuis la rubrique Équipe puis reliez son compte à cette fiche.'}
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="documents" className="mt-5">
          <EmployeeDocuments employee={employee} canManage={canManage} />
        </TabsContent>

        <TabsContent value="activite" className="mt-5">
          <Activity employee={employee} />
        </TabsContent>
      </Tabs>

      {canManage && (
        <>
          <EmployeeFormSheet open={editOpen} onOpenChange={setEditOpen} employee={employee} employees={employees.data} />
          <ConfirmDialog
            open={exitOpen}
            onOpenChange={setExitOpen}
            title={`Sortie des effectifs de ${employee.firstName}`}
            description="La fiche est conservée (historique, bulletins, documents) mais n’apparaît plus au planning."
            confirmLabel="Confirmer la sortie"
            destructive
            onConfirm={async () => {
              await setStatus.mutate({ status: 'terminated', endDate: exitDate });
            }}
          >
            <FormField label="Date de sortie">
              <Input type="date" value={exitDate} onChange={(e) => setExitDate(e.target.value)} />
            </FormField>
          </ConfirmDialog>
        </>
      )}
    </PageContainer>
  );
}
