import { useMemo, useState } from 'react';
import {
  CalendarDays,
  CalendarPlus,
  CalendarX2,
  Clock3,
  Copy,
  Flag,
  Pause,
  Play,
  Plus,
  Trash2,
  X,
} from 'lucide-react';
import {
  Badge,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  EmptyState,
  IconButton,
  PageContainer,
  PageHeader,
  Switch,
  TimeInput,
  cn,
  formatTime,
  toast,
} from '@golink/ui';
import {
  COLLECTIONS,
  MAX_SLOTS_PER_DAY,
  WEEKDAY_LABELS,
  minutesOfDay,
  publicHolidays,
  validateWeeklyHours,
  weeklyOpenMinutes,
  type City,
  type HoursIssue,
  type RestaurantHours,
  type TimeRange,
  type WeeklyHours,
} from '@golink/shared';
import { useCan, useRestaurantAccess } from '@/auth/RestaurantAccess';
import { docAt, errorMessage, toDate, useDoc, useMutation } from '@/lib/firestore';
import { updateRestaurantSettings } from '../parametres/kit/api';
import { useDraft, useRestaurantSettings, useUnsavedGuard } from '../parametres/kit/hooks';
import { LoadError, Notice, SaveBar, SettingsCard, SettingsSkeleton, SplitLayout, SummaryLine, SummaryPanel } from '../parametres/kit/ui';
import { ExceptionDialog, type ExceptionDraft } from './ExceptionDialog';
import { PauseDialog } from './PauseDialog';
import { formatMinute, scheduleState, slotsLabel, zonedNow } from './schedule';

type Draft = Pick<WeeklyHours, 'days' | 'exceptions' | 'timezone'>;
type Day = Draft['days'][number];

const dateLabel = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

function isoToDate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  return new Date(y, m - 1, d);
}

/** Horaires d'ouverture : créneaux par jour, fermetures exceptionnelles, jours fériés, pause temporaire. */
export function HorairesPage() {
  const { restaurant, restaurantId } = useRestaurantAccess();
  const can = useCan();
  const settings = useRestaurantSettings<RestaurantHours>('hours');
  const city = useDoc<City>(docAt(`${COLLECTIONS.cities}/${restaurant.cityId}`));
  const [exceptionDialog, setExceptionDialog] = useState<{ open: boolean; initial: ExceptionDraft | null; index: number | null }>({
    open: false,
    initial: null,
    index: null,
  });
  const [pauseOpen, setPauseOpen] = useState(false);

  const source = useMemo<Draft | null>(() => {
    if (settings.loading) return null;
    const base = settings.data ?? restaurant.hoursSummary;
    const days = WEEKDAY_LABELS.map((_, day) => {
      const found = base?.days?.find((d) => d.day === day);
      return { day: day as Day['day'], open: found?.open ?? false, slots: found?.slots ?? [] };
    });
    return { days, exceptions: base?.exceptions ?? [], timezone: base?.timezone ?? 'Europe/Paris' };
  }, [settings.data, settings.loading, restaurant.hoursSummary]);

  const { draft, setDraft, dirty, reset, markSaved } = useDraft<Draft>(source, restaurantId);
  useUnsavedGuard(dirty);
  const save = useMutation(updateRestaurantSettings, { success: 'Horaires enregistrés.' });
  const pause = useMutation(updateRestaurantSettings);

  const issues = useMemo<HoursIssue[]>(() => (draft ? validateWeeklyHours(draft) : []), [draft]);
  const today = zonedNow(draft?.timezone ?? 'Europe/Paris');

  if (settings.error) {
    return (
      <PageContainer>
        <Header />
        <LoadError message={errorMessage(settings.error)} />
      </PageContainer>
    );
  }
  if (!draft) {
    return (
      <PageContainer>
        <Header />
        <SettingsSkeleton />
      </PageContainer>
    );
  }

  const state = scheduleState(draft);
  const openDays = draft.days.filter((d) => d.open && d.slots.length > 0).length;
  const weeklyHours = Math.round((weeklyOpenMinutes(draft) / 60) * 10) / 10;
  const upcoming = draft.exceptions.filter((e) => e.date >= today.iso).sort((a, b) => a.date.localeCompare(b.date));
  const past = draft.exceptions.filter((e) => e.date < today.iso);
  const pausedUntil = toDate(restaurant.pausedUntil);
  const paused = !restaurant.isOpen;

  const setDay = (day: number, patch: Partial<Day>) =>
    setDraft((d) => ({ ...d, days: d.days.map((item) => (item.day === day ? { ...item, ...patch } : item)) }));
  const setSlot = (day: number, index: number, patch: Partial<TimeRange>) =>
    setDraft((d) => ({
      ...d,
      days: d.days.map((item) => (item.day === day ? { ...item, slots: item.slots.map((s, i) => (i === index ? { ...s, ...patch } : s)) } : item)),
    }));
  const addSlot = (day: number) => {
    const current = draft.days.find((d) => d.day === day);
    const slots = current?.slots ?? [];
    const lastEnd = slots.reduce((max, s) => Math.max(max, minutesOfDay(s.to, true) ?? 0), 0);
    let next: TimeRange;
    if (slots.length === 0) next = { from: '11:30', to: '14:30' };
    else if (lastEnd <= 17 * 60) next = { from: '18:30', to: '22:30' };
    else {
      const from = lastEnd + 30;
      if (from >= 23 * 60 + 45) {
        toast.info('La journée est déjà couverte jusqu’au soir : ajustez les créneaux existants.');
        return;
      }
      next = { from: formatMinute(from), to: from + 120 >= 24 * 60 ? '24:00' : formatMinute(from + 120) };
    }
    setDay(day, { open: true, slots: [...slots, next] });
  };
  const copyDay = (from: number, targets: number[]) => {
    const source = draft.days.find((d) => d.day === from);
    if (!source) return;
    setDraft((d) => ({
      ...d,
      days: d.days.map((item) => (targets.includes(item.day) ? { ...item, open: source.open, slots: source.slots.map((s) => ({ ...s })) } : item)),
    }));
    toast.success(`Horaires du ${WEEKDAY_LABELS[from]!.toLowerCase()} copiés.`);
  };

  const addHolidays = () => {
    const year = Number(today.iso.slice(0, 4));
    const list = [...publicHolidays(restaurant.countryId, year), ...publicHolidays(restaurant.countryId, year + 1)].filter(
      (h) => h.date >= today.iso && !draft.exceptions.some((e) => e.date === h.date),
    );
    const next = list.slice(0, 12);
    if (next.length === 0) {
      toast.info('Les prochains jours fériés sont déjà dans votre calendrier.');
      return;
    }
    setDraft((d) => ({
      ...d,
      exceptions: [...d.exceptions, ...next.map((h) => ({ date: h.date, closed: true, slots: [], label: h.label }))].sort((a, b) =>
        a.date.localeCompare(b.date),
      ),
    }));
    toast.success(`${next.length} jours fériés ajoutés comme fermés. Modifiez ceux où vous ouvrez.`);
  };

  const saveException = (value: ExceptionDraft) => {
    setDraft((d) => {
      const others = d.exceptions.filter((e, i) => i !== exceptionDialog.index && e.date !== value.date);
      return {
        ...d,
        exceptions: [...others, { date: value.date, closed: value.closed, slots: value.closed ? [] : value.slots, label: value.label || null }].sort((a, b) =>
          a.date.localeCompare(b.date),
        ),
      };
    });
    setExceptionDialog({ open: false, initial: null, index: null });
  };

  const onSave = async () => {
    const result = await save.mutate({
      restaurantId,
      section: 'hours',
      days: draft.days.map((d) => ({ day: d.day, open: d.open, slots: d.open ? d.slots : [] })),
      exceptions: draft.exceptions.map((e) => ({ date: e.date, closed: e.closed, slots: e.closed ? [] : (e.slots ?? []), label: e.label ?? null })),
    });
    if (result) markSaved();
  };

  const onPause = async (minutes: number | null, reason: string | null) => {
    const result = await pause.mutate({ restaurantId, section: 'pause', minutes, reason });
    if (result) toast.success(minutes === null ? 'Commandes rouvertes.' : 'Nouvelles commandes en pause.');
    return Boolean(result);
  };

  const dayIssues = (day: number) => issues.filter((i) => i.scope === day);
  const serviceHours = city.data?.serviceHours;
  const serviceToday = serviceHours?.days.find((d) => d.day === today.day);

  return (
    <PageContainer>
      <Header />
      <SplitLayout
        aside={
          <>
            <SummaryPanel
              eyebrow="Statut actuel"
              icon={<Clock3 />}
              title={paused ? 'Commandes en pause.' : state.open ? 'Prêt à servir.' : 'Fermé pour le moment.'}
            >
              <SummaryLine label="Horaires" value={state.label} />
              {paused && (
                <SummaryLine label="Pause" value={pausedUntil ? `jusqu’à ${formatTime(pausedUntil)}` : 'jusqu’à réouverture manuelle'} />
              )}
              <SummaryLine label="Jours ouverts" value={`${openDays} / 7`} />
              <SummaryLine label="Ouverture hebdomadaire" value={`${weeklyHours.toLocaleString('fr-FR')} h`} />
            </SummaryPanel>

            <div className="rounded-xl border border-border bg-surface p-5 shadow-card">
              <p className="text-sm font-medium text-fg">Pause temporaire</p>
              <p className="mt-1 text-xs leading-5 text-fg-subtle">
                Rush en cuisine, imprévu, rupture : suspendez les nouvelles commandes sans toucher à vos horaires. Les commandes en cours ne sont pas affectées.
              </p>
              {paused ? (
                <Button
                  className="mt-4 w-full"
                  variant="primary"
                  leftIcon={<Play />}
                  loading={pause.loading}
                  disabled={!can('orders.manage') || restaurant.status === 'suspended'}
                  onClick={() => void onPause(null, null)}
                >
                  Reprendre les commandes
                </Button>
              ) : (
                <Button
                  className="mt-4 w-full"
                  variant="secondary"
                  leftIcon={<Pause />}
                  disabled={!can('orders.manage') || restaurant.status === 'suspended'}
                  onClick={() => setPauseOpen(true)}
                >
                  Mettre en pause
                </Button>
              )}
              {!can('orders.manage') && <p className="mt-2 text-xs text-fg-subtle">Réservé aux membres qui gèrent les commandes.</p>}
            </div>

            {serviceToday && (
              <div className="rounded-xl border border-border bg-surface p-5 shadow-card">
                <p className="text-sm font-medium text-fg">Service Ciyou Eats à {city.data?.name}</p>
                <p className="mt-1 text-xs leading-5 text-fg-subtle">Les livreurs Ciyou Eats circulent sur ces plages. En dehors, seuls le retrait et vos propres livreurs restent possibles.</p>
                <p className="mt-3 font-mono text-sm text-fg num">{serviceToday.open ? slotsLabel(serviceToday.slots) : 'Pas de service aujourd’hui'}</p>
              </div>
            )}
          </>
        }
      >
        {restaurant.status === 'suspended' && (
          <Notice tone="danger" title="Établissement suspendu">
            Les commandes sont bloquées par Ciyou Eats, quels que soient vos horaires. Contactez le support.
          </Notice>
        )}

        <SettingsCard
          icon={<CalendarDays />}
          title="Semaine type"
          description={`Jusqu’à ${MAX_SLOTS_PER_DAY} créneaux par jour (service du midi, du soir…). Les heures sont celles de ${draft.timezone === 'Europe/Luxembourg' ? 'Luxembourg' : 'Paris'}.`}
        >
          <div className="divide-y divide-border">
            {draft.days.map((day) => {
              const problems = dayIssues(day.day);
              const isToday = day.day === today.day;
              return (
                <div key={day.day} className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0 md:flex-row md:items-start md:gap-6">
                  <div className="flex w-full flex-wrap items-center justify-between gap-y-2 gap-x-3 md:w-52 md:shrink-0 md:flex-nowrap md:justify-start md:pt-1.5">
                    <div className="flex items-center gap-3">
                      <Switch
                        checked={day.open}
                        aria-label={`Ouverture le ${WEEKDAY_LABELS[day.day]!.toLowerCase()}`}
                        onCheckedChange={(open) => setDay(day.day, { open, slots: open && day.slots.length === 0 ? [{ from: '11:30', to: '14:30' }] : day.slots })}
                      />
                      <span className="text-sm font-medium text-fg">{WEEKDAY_LABELS[day.day]}</span>
                      {isToday && <Badge tone="brand" size="sm">Aujourd’hui</Badge>}
                    </div>
                    <CopyMenu day={day.day} onCopy={copyDay} className="md:hidden" />
                  </div>
                  <div className="min-w-0 flex-1">
                    {day.open ? (
                      <div className="space-y-2">
                        {day.slots.map((slot, index) => {
                          const slotIssue = problems.find((p) => p.slotIndex === index);
                          return (
                            <div key={index}>
                              <div className="flex items-center gap-2">
                                <TimeInput
                                  className="min-w-0 flex-1 sm:w-32 sm:flex-none"
                                  value={slot.from}
                                  aria-label={`${WEEKDAY_LABELS[day.day]}, début du créneau ${index + 1}`}
                                  onChange={(from) => setSlot(day.day, index, { from })}
                                />
                                <span className="text-fg-subtle" aria-hidden>
                                  –
                                </span>
                                <TimeInput
                                  className="min-w-0 flex-1 sm:w-32 sm:flex-none"
                                  value={slot.to === '24:00' ? '00:00' : slot.to}
                                  aria-label={`${WEEKDAY_LABELS[day.day]}, fin du créneau ${index + 1}`}
                                  onChange={(to) => setSlot(day.day, index, { to: to === '00:00' ? '24:00' : to })}
                                />
                                <IconButton
                                  label={`Supprimer le créneau ${index + 1}`}
                                  variant="danger"
                                  size="sm"
                                  onClick={() => {
                                    const slots = day.slots.filter((_, i) => i !== index);
                                    setDay(day.day, { slots, open: slots.length > 0 });
                                  }}
                                >
                                  <X />
                                </IconButton>
                              </div>
                              {slotIssue && <p className="mt-1 text-xs text-danger-soft-fg">{slotIssue.message}</p>}
                            </div>
                          );
                        })}
                        {problems
                          .filter((p) => p.slotIndex === undefined)
                          .map((p) => (
                            <p key={p.message} className="text-xs text-danger-soft-fg">
                              {p.message}
                            </p>
                          ))}
                        {day.slots.length < MAX_SLOTS_PER_DAY && (
                          <Button variant="ghost" size="xs" leftIcon={<Plus />} onClick={() => addSlot(day.day)}>
                            Ajouter un créneau
                          </Button>
                        )}
                      </div>
                    ) : (
                      <p className="pt-1.5 text-sm text-fg-subtle">Fermé</p>
                    )}
                  </div>
                  <CopyMenu day={day.day} onCopy={copyDay} className="hidden md:inline-flex" />
                </div>
              );
            })}
          </div>
        </SettingsCard>

        <SettingsCard
          icon={<CalendarX2 />}
          title="Fermetures et horaires exceptionnels"
          description="Congés, jours fériés, événements : ces dates remplacent la semaine type."
          actions={
            <>
              <Button variant="secondary" size="sm" leftIcon={<Flag />} onClick={addHolidays}>
                Jours fériés
              </Button>
              <Button
                variant="secondary"
                size="sm"
                leftIcon={<CalendarPlus />}
                onClick={() => setExceptionDialog({ open: true, initial: null, index: null })}
              >
                Ajouter une date
              </Button>
            </>
          }
        >
          {upcoming.length === 0 ? (
            <EmptyState
              compact
              icon={<CalendarX2 />}
              title="Aucune date exceptionnelle à venir"
              description="Ajoutez vos congés ou les jours fériés où vous fermez : vos clients en seront informés."
            />
          ) : (
            <ul className="divide-y divide-border">
              {upcoming.map((exception) => {
                const index = draft.exceptions.indexOf(exception);
                const problem = issues.find((i) => i.scope === exception.date);
                return (
                  <li key={exception.date} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3 first:pt-0 last:pb-0">
                    <div className="grid size-11 shrink-0 place-items-center rounded-lg border border-border bg-surface-2 text-center leading-none">
                      <span className="font-display text-md font-semibold text-fg num">{exception.date.slice(8, 10)}</span>
                      <span className="font-mono text-3xs uppercase text-fg-subtle">
                        {isoToDate(exception.date).toLocaleDateString('fr-FR', { month: 'short' }).replace('.', '')}
                      </span>
                    </div>
                    <div className="min-w-[11rem] flex-1">
                      <p className="truncate text-sm font-medium text-fg first-letter:uppercase">{exception.label || dateLabel.format(isoToDate(exception.date))}</p>
                      <p className="text-xs text-fg-subtle first-letter:uppercase">
                        {exception.label ? `${dateLabel.format(isoToDate(exception.date))} · ` : ''}
                        {exception.closed ? 'Fermé toute la journée' : slotsLabel(exception.slots ?? [])}
                      </p>
                      {problem && <p className="mt-0.5 text-xs text-danger-soft-fg">{problem.message}</p>}
                    </div>
                    <div className="ml-auto flex items-center gap-1">
                      <Badge tone={exception.closed ? 'danger' : 'info'} className="mr-1">
                        {exception.closed ? 'Fermé' : 'Horaires spéciaux'}
                      </Badge>
                      <Button
                        variant="ghost"
                        size="xs"
                        onClick={() =>
                          setExceptionDialog({
                            open: true,
                            index,
                            initial: { date: exception.date, closed: exception.closed, slots: exception.slots ?? [], label: exception.label ?? '' },
                          })
                        }
                      >
                        Modifier
                      </Button>
                      <IconButton
                        label="Retirer cette date"
                        variant="danger"
                        size="sm"
                        onClick={() => setDraft((d) => ({ ...d, exceptions: d.exceptions.filter((_, i) => i !== index) }))}
                      >
                        <Trash2 />
                      </IconButton>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          {past.length > 0 && (
            <div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-surface-2 px-3 py-2 text-xs text-fg-muted">
              <span>
                {past.length} date{past.length > 1 ? 's' : ''} passée{past.length > 1 ? 's' : ''} conservée{past.length > 1 ? 's' : ''}.
              </span>
              <Button variant="link" size="xs" onClick={() => setDraft((d) => ({ ...d, exceptions: d.exceptions.filter((e) => e.date >= today.iso) }))}>
                Retirer les dates passées
              </Button>
            </div>
          )}
        </SettingsCard>
      </SplitLayout>

      <SaveBar
        dirty={dirty}
        saving={save.loading}
        disabled={issues.length > 0}
        message={issues.length > 0 ? `${issues.length} erreur${issues.length > 1 ? 's' : ''} à corriger` : 'Horaires modifiés'}
        onSave={() => void onSave()}
        onReset={reset}
      />

      <ExceptionDialog
        open={exceptionDialog.open}
        initial={exceptionDialog.initial}
        minDate={today.iso}
        takenDates={draft.exceptions.filter((_, i) => i !== exceptionDialog.index).map((e) => e.date)}
        onOpenChange={(open) => !open && setExceptionDialog({ open: false, initial: null, index: null })}
        onSubmit={saveException}
      />
      <PauseDialog open={pauseOpen} onOpenChange={setPauseOpen} onConfirm={onPause} loading={pause.loading} />
    </PageContainer>
  );
}

function Header() {
  return (
    <PageHeader
      eyebrow="Configuration"
      title="Horaires d’ouverture"
      description="Vos clients ne peuvent commander que pendant vos créneaux. Les changements s’appliquent immédiatement dans l’app."
    />
  );
}

function CopyMenu({ day, onCopy, className }: { day: number; onCopy: (from: number, targets: number[]) => void; className?: string }) {
  const others = [0, 1, 2, 3, 4, 5, 6].filter((d) => d !== day);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="xs" leftIcon={<Copy />} className={cn('shrink-0', className)}>
          Copier
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>Appliquer ces horaires à…</DropdownMenuLabel>
        <DropdownMenuItem onSelect={() => onCopy(day, [0, 1, 2, 3, 4].filter((d) => d !== day))}>Tous les jours de semaine</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onCopy(day, [5, 6].filter((d) => d !== day))}>Le week-end</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onCopy(day, others)}>Tous les autres jours</DropdownMenuItem>
        <DropdownMenuSeparator />
        {others.map((d) => (
          <DropdownMenuItem key={d} onSelect={() => onCopy(day, [d])}>
            {WEEKDAY_LABELS[d]}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
