import { useState } from 'react';
import { Link } from 'react-router';
import { Timestamp, doc, setDoc } from 'firebase/firestore';
import { AlertTriangle, CalendarDays, Check, ChevronLeft, ChevronRight, ClipboardCheck, Clock, MessageSquareText, ShieldAlert } from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  IconButton,
  PageContainer,
  PageHeader,
  ProgressBar,
  Skeleton,
  Textarea,
  Tooltip,
  cn,
} from '@golink/ui';
import { CHECKLIST_KIND_LABELS, paths, type ChecklistRun, type ChecklistTemplate, type WithId } from '@golink/shared';
import { useAuth, useDocumentTitle } from '@golink/web';
import { useCan, useRestaurantAccess } from '@/auth/RestaurantAccess';
import { collectionAt, toDate, updatedFields, useMutation } from '@/lib/firestore';
import { addDays, formatClock, formatFullDay, formatWeekdayShort, todayIso, weekdayIndex } from '../_rh/dates';
import { ErrorCard, SubNav } from '../_rh/ui';
import { useChecklistRuns, useChecklistTemplates } from './data';
import { TASK_NAV } from './nav';

type RunItem = ChecklistRun['items'][number];

function applies(template: ChecklistTemplate, day: string): boolean {
  return template.active && (template.daysOfWeek.length === 0 || template.daysOfWeek.includes(weekdayIndex(day)));
}

function ChecklistCard({ template, run, day, editable }: { template: WithId<ChecklistTemplate>; run?: WithId<ChecklistRun>; day: string; editable: boolean }) {
  const { restaurantId, member } = useRestaurantAccess();
  const { user } = useAuth();
  const [comment, setComment] = useState<string | null>(null);
  const items: RunItem[] = template.items.map((item) => {
    const done = run?.items.find((i) => i.id === item.id);
    return { ...item, done: done?.done ?? false, doneBy: done?.doneBy ?? null, doneByName: done?.doneByName ?? null, doneAt: done?.doneAt ?? null };
  });
  const doneCount = items.filter((i) => i.done).length;
  const complete = doneCount === items.length && items.length > 0;
  const missingCritical = items.filter((i) => i.critical && !i.done);
  const late = template.dueTime && day === todayIso() && !complete && new Date().toTimeString().slice(0, 5) > template.dueTime;

  const save = useMutation(async (nextItems: RunItem[], nextComment?: string | null) => {
    const allDone = nextItems.every((i) => i.done);
    const data: Omit<ChecklistRun, 'updatedAt' | 'updatedBy'> = {
      templateId: template.id,
      templateName: template.name,
      kind: template.kind,
      date: day,
      items: nextItems,
      completed: allDone,
      completedAt: allDone ? (run?.completedAt ?? Timestamp.now()) : null,
      completedBy: allDone ? (run?.completedBy ?? user!.uid) : null,
      comment: nextComment === undefined ? (run?.comment ?? null) : nextComment,
    };
    await setDoc(doc(collectionAt(paths.restaurantSub(restaurantId, 'checklistRuns')), `${template.id}_${day}`), { ...data, ...updatedFields(user!.uid) });
  });

  function toggle(id: string) {
    if (!editable) return;
    const next = items.map((item) =>
      item.id === id
        ? { ...item, done: !item.done, doneBy: item.done ? null : user!.uid, doneByName: item.done ? null : member.displayName || 'Membre', doneAt: item.done ? null : Timestamp.now() }
        : item,
    );
    void save.mutate(next);
  }

  return (
    <Card className={cn('flex flex-col', complete && 'border-(--tone-border) tone-success')}>
      <CardHeader
        icon={<ClipboardCheck />}
        eyebrow={CHECKLIST_KIND_LABELS[template.kind]}
        title={template.name}
        description={template.description ?? undefined}
        actions={
          complete ? (
            <Badge tone="success" icon={<Check />}>
              Terminée
            </Badge>
          ) : template.dueTime ? (
            <Badge tone={late ? 'danger' : 'neutral'} icon={<Clock />}>
              {late ? 'En retard · ' : 'Avant '}
              {template.dueTime}
            </Badge>
          ) : undefined
        }
      />
      <div className="px-5 pb-2 pt-2">
        <ProgressBar value={doneCount} max={Math.max(items.length, 1)} tone={complete ? 'success' : missingCritical.length && late ? 'danger' : 'brand'} size="sm" valueLabel={`${doneCount} / ${items.length}`} />
      </div>
      <ul className="flex-1 space-y-0.5 px-2.5 pb-2">
        {items.map((item) => (
          <li key={item.id}>
            <button
              type="button"
              role="checkbox"
              aria-checked={item.done}
              disabled={!editable}
              onClick={() => toggle(item.id)}
              className={cn(
                'flex w-full items-start gap-3 rounded-lg px-2.5 py-2 text-left transition-colors',
                editable && 'hover:bg-surface-3',
                'focus-visible:outline-2 focus-visible:outline-ring disabled:cursor-default',
              )}
            >
              <span
                className={cn(
                  'mt-px grid size-[18px] shrink-0 place-items-center rounded-[5px] border transition-colors',
                  item.done ? 'border-primary bg-primary text-primary-fg' : 'border-border-strong bg-surface',
                )}
              >
                {item.done && <Check className="size-3.5 stroke-3" />}
              </span>
              <span className="min-w-0 flex-1">
                <span className={cn('block text-sm', item.done ? 'text-fg-muted line-through decoration-fg-subtle' : 'text-fg')}>
                  {item.label}
                  {item.critical && !item.done && (
                    <Tooltip content="Point critique pour l’hygiène ou la sécurité">
                      <ShieldAlert className="ml-1.5 inline size-3.5 text-danger" aria-label="Point critique" />
                    </Tooltip>
                  )}
                </span>
                {item.done && item.doneByName && (
                  <span className="block text-2xs text-fg-subtle">
                    {item.doneByName} · {formatClock(toDate(item.doneAt))}
                  </span>
                )}
              </span>
            </button>
          </li>
        ))}
      </ul>
      <div className="border-t border-border px-5 py-3">
        {comment === null ? (
          <button type="button" onClick={() => editable && setComment(run?.comment ?? '')} className="flex w-full items-center gap-2 text-left text-xs text-fg-muted hover:text-fg" disabled={!editable}>
            <MessageSquareText className="size-3.5" />
            {run?.comment ? <span className="text-fg">« {run.comment} »</span> : editable ? 'Ajouter une remarque' : 'Aucune remarque'}
          </button>
        ) : (
          <div className="space-y-2">
            <Textarea rows={2} value={comment} onChange={(e) => setComment(e.target.value)} maxLength={500} placeholder="Remarque, anomalie constatée…" />
            <div className="flex justify-end gap-2">
              <Button size="xs" variant="ghost" onClick={() => setComment(null)}>
                Annuler
              </Button>
              <Button
                size="xs"
                variant="primary"
                loading={save.loading}
                onClick={async () => {
                  await save.mutate(items, comment.trim() || null);
                  setComment(null);
                }}
              >
                Enregistrer
              </Button>
            </div>
          </div>
        )}
      </div>
      {missingCritical.length > 0 && complete === false && late && (
        <p className="tone-danger flex items-center gap-2 rounded-b-xl bg-(--tone-bg) px-5 py-2 text-xs font-medium text-(--tone-fg)">
          <AlertTriangle className="size-3.5" /> {missingCritical.length} point{missingCritical.length > 1 ? 's' : ''} critique{missingCritical.length > 1 ? 's' : ''} non vérifié{missingCritical.length > 1 ? 's' : ''}
        </p>
      )}
    </Card>
  );
}

export function ChecklistsPage() {
  useDocumentTitle('Checklists · GoLink Restaurant');
  const can = useCan();
  const manager = can('tasks.manage');
  const today = todayIso();
  const [day, setDay] = useState(today);
  const templates = useChecklistTemplates();
  const runs = useChecklistRuns(addDays(today, -6), today);
  const dayTemplates = templates.data.filter((t) => applies(t, day));
  const runFor = (templateId: string, d: string) => runs.data.find((r) => r.templateId === templateId && r.date === d);
  const completedToday = dayTemplates.filter((t) => runFor(t.id, day)?.completed).length;
  const history = Array.from({ length: 7 }, (_, i) => addDays(today, i - 6));
  const editable = day === today || (manager && day >= addDays(today, -6));

  return (
    <PageContainer wide>
      <PageHeader eyebrow="Équipe & RH" title="Checklists du jour" description="Ouverture, service et fermeture : chaque point coché est horodaté et signé.">
        <SubNav items={TASK_NAV.filter((item) => manager || item.to !== '/equipe/taches/modeles')} />
      </PageHeader>
      {(templates.error || runs.error) && <ErrorCard error={templates.error ?? runs.error} />}

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1.5">
          <IconButton label="Jour précédent" variant="secondary" size="sm" onClick={() => setDay(addDays(day, -1))} disabled={day <= addDays(today, -6)}>
            <ChevronLeft />
          </IconButton>
          <div className="flex h-8 items-center gap-2 rounded-lg border border-border bg-surface px-3 text-sm font-medium text-fg shadow-xs">
            <CalendarDays className="size-4 text-fg-subtle" />
            {formatFullDay(day)}
          </div>
          <IconButton label="Jour suivant" variant="secondary" size="sm" onClick={() => setDay(addDays(day, 1))} disabled={day >= today}>
            <ChevronRight />
          </IconButton>
        </div>
        <p className="text-sm text-fg-muted">
          <span className="font-semibold text-fg num">{completedToday}</span> / {dayTemplates.length} checklist{dayTemplates.length > 1 ? 's' : ''} terminée{dayTemplates.length > 1 ? 's' : ''}
        </p>
      </div>

      {templates.loading || runs.loading ? (
        <div className="grid gap-4 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-80 rounded-xl" />
          ))}
        </div>
      ) : dayTemplates.length === 0 ? (
        <Card>
          <EmptyState
            icon={<ClipboardCheck />}
            title="Aucune checklist prévue ce jour"
            description="Créez vos checklists d’ouverture et de fermeture pour guider l’équipe à chaque service."
            action={
              manager ? (
                <Button variant="primary" asChild>
                  <Link to="/equipe/taches/modeles">Créer une checklist</Link>
                </Button>
              ) : undefined
            }
          />
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">
          {dayTemplates.map((template) => (
            <ChecklistCard key={template.id} template={template} run={runFor(template.id, day)} day={day} editable={editable} />
          ))}
        </div>
      )}

      {templates.data.length > 0 && (
        <Card className="mt-6">
          <CardHeader icon={<CalendarDays />} title="Sept derniers jours" description="Suivi de réalisation par checklist." divided />
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="bg-surface-2">
                  <th className="px-5 py-2 text-left eyebrow">Checklist</th>
                  {history.map((d) => (
                    <th key={d} className={cn('px-2 py-2 text-center font-mono text-2xs font-medium first-letter:uppercase', d === today ? 'text-primary-soft-fg' : 'text-fg-subtle')}>
                      {formatWeekdayShort(d)} {Number(d.slice(8))}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {templates.data.filter((t) => t.active).map((template) => (
                  <tr key={template.id}>
                    <td className="px-5 py-2.5 text-fg">{template.name}</td>
                    {history.map((d) => {
                      if (!applies(template, d)) return <td key={d} className="px-2 py-2.5 text-center text-fg-subtle">·</td>;
                      const run = runFor(template.id, d);
                      const ratio = run ? run.items.filter((i) => i.done).length / Math.max(run.items.length, 1) : 0;
                      return (
                        <td key={d} className="px-2 py-2.5 text-center">
                          <button type="button" onClick={() => setDay(d)} aria-label={`Voir le ${formatFullDay(d)}`} className="mx-auto block">
                            <span
                              className={cn(
                                'mx-auto grid size-6 place-items-center rounded-full border text-3xs font-semibold',
                                run?.completed ? 'tone-success border-(--tone-border) bg-(--tone-bg) text-(--tone-fg)' : ratio > 0 ? 'tone-amber border-(--tone-border) bg-(--tone-bg) text-(--tone-fg)' : d < today ? 'tone-danger border-(--tone-border) bg-(--tone-bg) text-(--tone-fg)' : 'border-border text-fg-subtle',
                              )}
                            >
                              {run?.completed ? <Check className="size-3" /> : ratio > 0 ? `${Math.round(ratio * 100)}` : ''}
                            </span>
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </PageContainer>
  );
}
