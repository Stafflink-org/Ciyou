import { useMemo, useState } from 'react';
import { AlertTriangle, Clock3, Download, Hourglass, ListChecks, Timer } from 'lucide-react';
import { Button, PageContainer, PageHeader, StatCard } from '@golink/ui';
import { TIME_ENTRY_STATUS_LABELS } from '@golink/shared';
import { useAuth, useDocumentTitle } from '@golink/web';
import { useCan, useRestaurantAccess } from '@/auth/RestaurantAccess';
import { toDate } from '@/lib/firestore';
import { addDays, formatClock, formatDuration, mondayOf, shiftMinutes, todayIso, weekDays } from '../_rh/dates';
import { downloadCsv } from '../_rh/export';
import { useMyEmployeeId, useStaffDirectory } from '../_rh/hooks';
import { ErrorCard, WeekSwitcher } from '../_rh/ui';
import { useWeekShifts } from '../planning/data';
import { MyWeek } from './MyWeek';
import { OnDutyStrip, TeamWeekTable, type EmployeeWeekRow } from './TeamWeek';
import { Timeclock } from './Timeclock';
import { entriesByEmployee, liveWorkedMinutes, useMyEntries, useMyWeekValidations, useTeamWeekEntries, useWeekValidations } from './data';

const LEGAL_WEEK_MINUTES = 35 * 60;

export function PointagesPage() {
  useDocumentTitle('Pointages · GoLink Restaurant');
  const can = useCan();
  const manage = can('timeclock.manage');
  const { member, restaurant } = useRestaurantAccess();
  const { user } = useAuth();
  const today = todayIso();
  const [monday, setMonday] = useState(() => mondayOf(today));
  const directory = useStaffDirectory();
  const myEmployeeId = useMyEmployeeId(directory);

  const team = useTeamWeekEntries(monday, manage);
  const validations = useWeekValidations(monday, manage);
  const shifts = useWeekShifts(monday);
  const mine = useMyEntries(mondayOf(today) === monday ? monday : mondayOf(today), Boolean(myEmployeeId));
  const myWeekEntries = useMyEntries(monday, Boolean(myEmployeeId) && !manage);
  const myValidations = useMyWeekValidations(Boolean(myEmployeeId) && !manage);

  const myToday = mine.data.find((e) => e.date === today) ?? mine.data.find((e) => e.date === addDays(today, -1) && e.clockIn && !e.clockOut) ?? null;
  const myTodayShifts = shifts.data.filter((s) => s.employeeId === myEmployeeId && s.date === today);

  const rows = useMemo<EmployeeWeekRow[]>(() => {
    if (!manage) return [];
    const byEmployee = entriesByEmployee(team.data);
    const validationBy = new Map(validations.data.map((v) => [v.employeeId, v]));
    const days = weekDays(monday);
    const now = Date.now();
    return directory.employees
      .filter((e) => e.active || byEmployee.has(e.employeeId ?? e.id))
      .map((entry) => {
        const id = entry.employeeId ?? entry.id;
        const list = byEmployee.get(id) ?? [];
        const dayMap = Object.fromEntries(list.map((e) => [e.date, e]));
        const plannedByDay: EmployeeWeekRow['plannedByDay'] = {};
        for (const shift of shifts.data.filter((s) => s.employeeId === id)) (plannedByDay[shift.date] ??= []).push(shift);
        const planned = Object.values(plannedByDay)
          .flat()
          .reduce((t, s) => t + shiftMinutes(s.startTime, s.endTime, s.breakMinutes), 0);
        const anomalies = days.filter((day) => {
          const e = dayMap[day];
          if (day >= today) return false;
          return (e?.clockIn && !e.clockOut) || (!e && (plannedByDay[day]?.length ?? 0) > 0);
        }).length;
        return {
          id,
          entry,
          days: dayMap,
          worked: list.reduce((t, e) => t + liveWorkedMinutes(e, now), 0),
          planned,
          plannedByDay,
          validation: validationBy.get(id),
          anomalies,
        };
      });
  }, [manage, team.data, validations.data, shifts.data, directory.employees, monday, today]);

  const totalWorked = rows.reduce((t, r) => t + r.worked, 0);
  const overtime = rows.reduce((t, r) => t + Math.max(0, r.worked - LEGAL_WEEK_MINUTES), 0);
  const toValidate = team.data.filter((e) => e.clockOut && (e.status === 'pending' || e.status === 'corrected')).length;
  const anomalies = rows.reduce((t, r) => t + r.anomalies, 0);

  function exportCsv() {
    downloadCsv(
      `pointages-${restaurant.slug}-${monday}`,
      [...team.data]
        .sort((a, b) => a.date.localeCompare(b.date))
        .map((e) => ({
          Salarié: directory.byEmployeeId.get(e.employeeId)?.displayName ?? e.employeeId,
          Date: e.date,
          Arrivée: formatClock(toDate(e.clockIn?.at)),
          Sortie: formatClock(toDate(e.clockOut?.at)),
          'Travaillé (h)': (e.workedMinutes / 60).toFixed(2).replace('.', ','),
          'Nuit (h)': (e.nightMinutes / 60).toFixed(2).replace('.', ','),
          'Dépassement (h)': (e.overtimeMinutes / 60).toFixed(2).replace('.', ','),
          Statut: TIME_ENTRY_STATUS_LABELS[e.status],
          Note: e.notes ?? '',
        })),
    );
  }

  const firstName = (member.displayName || user?.displayName || '').split(' ')[0] ?? '';
  const error = team.error ?? shifts.error ?? mine.error ?? validations.error;

  return (
    <PageContainer wide>
      <PageHeader
        eyebrow="Équipe & RH"
        title="Pointages"
        description={
          manage
            ? 'Arrivées, pauses et sorties de l’équipe, corrections tracées et validation hebdomadaire avant la paie.'
            : 'Pointez vos arrivées, pauses et sorties, et confirmez vos heures chaque semaine.'
        }
        actions={
          manage ? (
            <Button leftIcon={<Download />} onClick={exportCsv} disabled={team.data.length === 0}>
              Exporter la semaine
            </Button>
          ) : undefined
        }
      />

      {error && <ErrorCard error={error} />}

      {myEmployeeId && can('timeclock.self') && (
        <div className="mb-6">
          <Timeclock entry={myToday} todayShifts={myTodayShifts} firstName={firstName} />
        </div>
      )}

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <WeekSwitcher monday={monday} onChange={setMonday} />
      </div>

      {manage ? (
        <>
          <div className="mb-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard label="Heures pointées" value={formatDuration(totalWorked)} icon={<Clock3 />} tone="brand" loading={team.loading} footer="Toute l’équipe, semaine affichée." />
            <StatCard label="Heures au-delà de 35 h" value={formatDuration(overtime)} icon={<Timer />} tone="info" loading={team.loading} footer="Majorées en paie selon la convention." />
            <StatCard label="Pointages à valider" value={String(toValidate)} icon={<ListChecks />} tone={toValidate ? 'amber' : 'success'} loading={team.loading} footer="Clôturés, en attente de validation." />
            <StatCard label="Anomalies" value={String(anomalies)} icon={anomalies ? <AlertTriangle /> : <Hourglass />} tone={anomalies ? 'danger' : 'success'} loading={team.loading} footer="Sorties manquantes, services prévus non pointés." />
          </div>
          <OnDutyStrip rows={rows} />
          <TeamWeekTable monday={monday} rows={rows} loading={team.loading || directory.loading} />
        </>
      ) : myEmployeeId ? (
        <MyWeek
          monday={monday}
          employeeId={myEmployeeId}
          entries={myWeekEntries.data}
          validation={myValidations.data.find((v) => v.weekStart === monday)}
          loading={myWeekEntries.loading}
        />
      ) : (
        <ErrorCard
          title="Aucune fiche salarié reliée à votre compte"
          message="Demandez à votre responsable de relier votre compte à votre fiche dans la rubrique Employés pour pouvoir pointer."
        />
      )}
    </PageContainer>
  );
}
