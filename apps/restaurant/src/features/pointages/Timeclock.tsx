import { useEffect, useState } from 'react';
import { Coffee, LogIn, LogOut, MapPin, Play, TimerReset } from 'lucide-react';
import { Button, Card, StatusPill, Timeline, cn, type TimelineItem } from '@golink/ui';
import type { Shift, TimeEntry, WithId } from '@golink/shared';
import { useRestaurantAccess } from '@/auth/RestaurantAccess';
import { toDate, useMutation } from '@/lib/firestore';
import { formatClock, formatDuration, formatFullDay, todayIso } from '../_rh/dates';
import { clockEvent, type ClockAction } from '../_rh/functions';
import { clockState, liveWorkedMinutes } from './data';

const clockFormat = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

/** Position approximative, facultative (refus ou délai : pointage sans position). */
function currentPosition(): Promise<{ latitude: number; longitude: number; accuracy?: number } | undefined> {
  if (!('geolocation' in navigator)) return Promise.resolve(undefined);
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (position) => resolve({ latitude: position.coords.latitude, longitude: position.coords.longitude, accuracy: Math.round(position.coords.accuracy) }),
      () => resolve(undefined),
      { enableHighAccuracy: false, timeout: 4000, maximumAge: 120_000 },
    );
  });
}

const SUCCESS: Record<ClockAction, string> = {
  in: 'Arrivée enregistrée, bon service !',
  out: 'Sortie enregistrée. À bientôt !',
  break_start: 'Pause commencée',
  break_end: 'Reprise du service enregistrée',
};

export function Timeclock({ entry, todayShifts, firstName }: { entry: WithId<TimeEntry> | null; todayShifts: WithId<Shift>[]; firstName: string }) {
  const { restaurantId, restaurant } = useRestaurantAccess();
  const [now, setNow] = useState(() => Date.now());
  const [geo, setGeo] = useState(true);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const [pending, setPending] = useState<ClockAction | null>(null);
  const clock = useMutation(
    async (action: ClockAction) => {
      const location = geo ? await currentPosition() : undefined;
      return clockEvent({ restaurantId, action, location, source: window.innerWidth < 768 ? 'mobile' : 'tablet' });
    },
    { success: (result) => (result.state === 'off' ? SUCCESS.out : result.state === 'on_break' ? SUCCESS.break_start : SUCCESS.in) },
  );
  async function run(action: ClockAction) {
    setPending(action);
    await clock.mutate(action);
    setPending(null);
  }

  const state = clockState(entry);
  const worked = entry ? liveWorkedMinutes(entry, now) : 0;
  const planned = todayShifts.map((s) => `${s.startTime}–${s.endTime}`).join(' · ');

  const events: TimelineItem[] = [];
  if (entry?.clockIn) events.push({ id: 'in', title: 'Arrivée', time: formatClock(toDate(entry.clockIn.at)), tone: 'success', icon: <LogIn /> });
  entry?.breaks.forEach((pause, i) =>
    events.push({
      id: `b${i}`,
      title: pause.end ? 'Pause' : 'Pause en cours',
      time: `${formatClock(toDate(pause.start))}${pause.end ? ` – ${formatClock(toDate(pause.end))}` : ''}`,
      tone: 'amber',
      icon: <Coffee />,
    }),
  );
  if (entry?.clockOut) events.push({ id: 'out', title: 'Sortie', time: formatClock(toDate(entry.clockOut.at)), tone: 'neutral', icon: <LogOut /> });

  return (
    <Card className="overflow-hidden">
      <div className="grid lg:grid-cols-[1.25fr_1fr]">
        <div className="relative flex flex-col justify-between gap-6 bg-sidebar p-6 text-sidebar-fg sm:p-7">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="eyebrow text-sidebar-muted">{formatFullDay(todayIso())}</p>
              <p className="mt-1 font-display text-lg font-semibold">Bonjour {firstName}</p>
            </div>
            {state === 'working' && <StatusPill tone="success" pulse>En service</StatusPill>}
            {state === 'on_break' && <StatusPill tone="amber" pulse>En pause</StatusPill>}
            {state === 'done' && <StatusPill tone="neutral">Service terminé</StatusPill>}
            {state === 'off' && <StatusPill tone="neutral">Hors service</StatusPill>}
          </div>
          <div>
            <p className="num font-display text-5xl font-semibold tracking-display sm:text-6xl" aria-live="off">
              {clockFormat.format(now)}
            </p>
            <p className="mt-2 text-sm text-sidebar-muted">
              {planned ? `Prévu aujourd’hui : ${planned}` : 'Aucun service planifié aujourd’hui.'}
              {' · '}
              {restaurant.name}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {state === 'off' && (
              <Button size="lg" variant="primary" leftIcon={<LogIn />} loading={pending === 'in'} onClick={() => void run('in')}>
                Pointer mon arrivée
              </Button>
            )}
            {state === 'working' && (
              <>
                <Button size="lg" variant="primary" leftIcon={<LogOut />} loading={pending === 'out'} onClick={() => void run('out')}>
                  Pointer ma sortie
                </Button>
                <Button
                  size="lg"
                  variant="ghost"
                  className="text-sidebar-fg hover:bg-sidebar-hover hover:text-sidebar-fg"
                  leftIcon={<Coffee />}
                  loading={pending === 'break_start'}
                  onClick={() => void run('break_start')}
                >
                  Commencer une pause
                </Button>
              </>
            )}
            {state === 'on_break' && (
              <>
                <Button size="lg" variant="primary" leftIcon={<Play />} loading={pending === 'break_end'} onClick={() => void run('break_end')}>
                  Reprendre le service
                </Button>
                <Button
                  size="lg"
                  variant="ghost"
                  className="text-sidebar-fg hover:bg-sidebar-hover hover:text-sidebar-fg"
                  leftIcon={<LogOut />}
                  loading={pending === 'out'}
                  onClick={() => void run('out')}
                >
                  Pointer ma sortie
                </Button>
              </>
            )}
            {state === 'done' && (
              <Button
                size="lg"
                variant="ghost"
                className="border border-sidebar-border text-sidebar-fg hover:bg-sidebar-hover hover:text-sidebar-fg"
                leftIcon={<TimerReset />}
                loading={pending === 'in'}
                onClick={() => void run('in')}
              >
                Reprendre après une coupure
              </Button>
            )}
          </div>
          <label className="flex cursor-pointer items-center gap-2 text-xs text-sidebar-muted">
            <input type="checkbox" checked={geo} onChange={(e) => setGeo(e.target.checked)} className="size-3.5 accent-(--color-primary)" />
            <MapPin className="size-3.5" /> Joindre ma position pour attester la présence sur place
          </label>
        </div>
        <div className="flex flex-col gap-5 p-6 sm:p-7">
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-xl border border-border bg-surface-2 p-4">
              <p className="text-xs font-medium text-fg-muted">Temps travaillé</p>
              <p className={cn('num mt-1 font-display text-2xl font-semibold', state === 'working' ? 'text-fg' : 'text-fg')}>{formatDuration(worked)}</p>
            </div>
            <div className="rounded-xl border border-border bg-surface-2 p-4">
              <p className="text-xs font-medium text-fg-muted">Pauses</p>
              <p className="num mt-1 font-display text-2xl font-semibold text-fg">{entry?.breaks.length ?? 0}</p>
            </div>
          </div>
          <div>
            <p className="eyebrow mb-3">Journée</p>
            {events.length === 0 ? (
              <p className="text-sm text-fg-subtle">Pointez votre arrivée au début de votre service : vos heures sont calculées automatiquement.</p>
            ) : (
              <Timeline items={events} />
            )}
          </div>
        </div>
      </div>
    </Card>
  );
}
