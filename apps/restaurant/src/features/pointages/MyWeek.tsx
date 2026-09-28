import { useState } from 'react';
import { CheckCheck, Clock3 } from 'lucide-react';
import { Button, Card, CardHeader, EmptyState, FormField, Skeleton, StatusBadge, Textarea, cn } from '@golink/ui';
import type { TimeEntry, WeekValidation, WithId } from '@golink/shared';
import { useRestaurantAccess } from '@/auth/RestaurantAccess';
import { toDate, useMutation } from '@/lib/firestore';
import { addDays, formatClock, formatDayMonth, formatDuration, formatWeekRange, formatWeekdayShort, todayIso, weekDays } from '../_rh/dates';
import { validateWeek } from '../_rh/functions';
import { TIME_ENTRY_STATUS, WEEK_STATUS } from '../_rh/ui';
import { breakMinutes, liveWorkedMinutes } from './data';

export function MyWeek({
  monday,
  employeeId,
  entries,
  validation,
  loading,
}: {
  monday: string;
  employeeId: string;
  entries: WithId<TimeEntry>[];
  validation: WithId<WeekValidation> | undefined;
  loading: boolean;
}) {
  const { restaurantId } = useRestaurantAccess();
  const [comment, setComment] = useState('');
  const validate = useMutation(validateWeek, { success: 'Semaine validée, votre responsable est informé' });
  const now = Date.now();
  const inWeek = entries.filter((e) => e.date >= monday && e.date <= addDays(monday, 6));
  const total = inWeek.reduce((sum, e) => sum + liveWorkedMinutes(e, now), 0);
  const weekOver = addDays(monday, 6) < todayIso();
  const status = validation?.status ?? 'pending';
  const hasOpen = inWeek.some((e) => e.clockIn && !e.clockOut);

  return (
    <Card>
      <CardHeader
        icon={<Clock3 />}
        title="Mes pointages"
        description={`Semaine du ${formatWeekRange(monday)} · ${formatDuration(total)} au total`}
        actions={<StatusBadge status={status} map={WEEK_STATUS} />}
        divided
      />
      {loading ? (
        <div className="space-y-2 p-5">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-10" />
          ))}
        </div>
      ) : inWeek.length === 0 ? (
        <EmptyState compact icon={<Clock3 />} title="Aucun pointage cette semaine" description="Vos arrivées et sorties s’afficheront ici." />
      ) : (
        <ul className="divide-y divide-border">
          {weekDays(monday).map((day) => {
            const entry = inWeek.find((e) => e.date === day);
            if (!entry) return null;
            return (
              <li key={day} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
                <div className="min-w-0">
                  <p className={cn('text-sm font-medium first-letter:uppercase', day === todayIso() ? 'text-primary-soft-fg' : 'text-fg')}>
                    {formatWeekdayShort(day)} {formatDayMonth(day)}
                  </p>
                  <p className="font-mono text-xs text-fg-subtle num">
                    {formatClock(toDate(entry.clockIn?.at))} – {formatClock(toDate(entry.clockOut?.at))} · pauses {breakMinutes(entry, now)} min
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="font-mono text-sm font-semibold text-fg num">{formatDuration(liveWorkedMinutes(entry, now))}</span>
                  <StatusBadge status={entry.status} map={TIME_ENTRY_STATUS} />
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {weekOver && inWeek.length > 0 && status === 'pending' && (
        <div className="space-y-3 border-t border-border px-5 py-4">
          <FormField label="Commentaire pour votre responsable (facultatif)">
            <Textarea rows={2} value={comment} onChange={(e) => setComment(e.target.value)} maxLength={500} />
          </FormField>
          <div className="flex justify-end">
            <Button
              variant="primary"
              leftIcon={<CheckCheck />}
              loading={validate.loading}
              disabled={hasOpen}
              onClick={() => void validate.mutate({ restaurantId, weekStart: monday, employeeIds: [employeeId], action: 'employee_validate', comment: comment.trim() || undefined })}
            >
              Je confirme mes heures
            </Button>
          </div>
        </div>
      )}
      {validation?.managerComment && (
        <p className="border-t border-border px-5 py-3 text-sm text-fg-muted">Votre responsable : « {validation.managerComment} »</p>
      )}
    </Card>
  );
}
