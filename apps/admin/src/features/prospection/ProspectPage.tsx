import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router';
import { collection, orderBy, query } from 'firebase/firestore';
import { ArrowLeft, ArrowRightLeft, CalendarPlus, Mail, MapPin, MessageSquareText, Pencil, Phone, Presentation, Send, StickyNote, Store, Target, UserRound } from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  EmptyState,
  FormField,
  PageContainer,
  PageHeader,
  SegmentedControl,
  Sheet,
  Skeleton,
  StatusPill,
  Textarea,
  cn,
  formatDateTime,
  formatNumber,
  formatRelative,
} from '@golink/ui';
import { COLLECTIONS, PROSPECT_STAGES, PROSPECT_STAGE_LABELS, SUBCOLLECTIONS, type Prospect, type ProspectActivity, type ProspectStage } from '@golink/shared';
import { useDocumentTitle } from '@golink/web';
import { useAdminAccess } from '@/auth/AdminAccess';
import { db } from '@/lib/firebase';
import { docAt, toMillis, useCollection, useDoc, useMutation } from '@/lib/firestore';
import { logProspectActivity } from '../_croissance/api';
import { useGeoNames, useNow, useRestaurantOptions, useSalesTeam } from '../_croissance/hooks';
import { ACTIVITY_LABELS, SOURCE_LABELS, STAGE_TONES } from '../_croissance/labels';
import { DateTimeField, InfoRow, LoadError } from '../_croissance/ui';
import { ProspectFormSheet, StageDialog } from './components';
import { OPEN_STAGES, isOverdue } from './lib';

type ActivityType = 'call' | 'email' | 'visit' | 'demo' | 'note';
const ACTIVITY_ICONS = { call: <Phone />, email: <Mail />, visit: <MapPin />, demo: <Presentation />, note: <StickyNote />, stage_change: <ArrowRightLeft /> } as const;

/** Étapes du parcours (hors « perdu », affiché à part). */
const FLOW: ProspectStage[] = ['to_contact', 'contacted', 'demo', 'negotiation', 'signed_up'];

function StageTrack({ stage }: { stage: ProspectStage }) {
  const index = FLOW.indexOf(stage);
  return (
    <ol className="flex w-full items-center gap-1.5" aria-label="Avancement">
      {FLOW.map((s, i) => {
        const done = stage !== 'lost' && i <= index;
        return (
          <li key={s} className="min-w-0 flex-1">
            <div className={cn('h-1.5 rounded-full', done ? (s === 'signed_up' ? 'tone-success bg-(--tone-solid)' : 'bg-primary') : 'bg-surface-3')} />
            <p className={cn('mt-1.5 hidden truncate text-2xs sm:block', i === index ? 'font-medium text-fg' : 'text-fg-subtle')}>{PROSPECT_STAGE_LABELS[s]}</p>
          </li>
        );
      })}
    </ol>
  );
}

export function ProspectPage() {
  const { prospectId = '' } = useParams();
  const { can } = useAdminAccess();
  const canEdit = can('crm.edit');
  const now = useNow();
  const names = useGeoNames();
  const restaurants = useRestaurantOptions();
  const team = useSalesTeam();
  const state = useDoc<Prospect>(docAt(`${COLLECTIONS.prospects}/${prospectId}`));
  const activitiesQuery = useMemo(
    () => query(collection(db, COLLECTIONS.prospects, prospectId, SUBCOLLECTIONS.prospects.activities), orderBy('at', 'desc')),
    [prospectId],
  );
  const activities = useCollection<ProspectActivity>(activitiesQuery);
  const [editing, setEditing] = useState(false);
  const [moveTo, setMoveTo] = useState<ProspectStage | null>(null);
  const [type, setType] = useState<ActivityType>('call');
  const [summary, setSummary] = useState('');
  const [followUp, setFollowUp] = useState<number | null>(null);
  const log = useMutation(logProspectActivity, { success: 'Échange enregistré' });
  const p = state.data;
  useDocumentTitle(`${p?.name ?? 'Prospect'} · Prospection · GoLink Admin`);

  if (state.loading) {
    return (
      <PageContainer wide>
        <Skeleton className="h-8 w-72" />
        <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
          <Skeleton className="h-96" />
          <Skeleton className="h-80" />
        </div>
      </PageContainer>
    );
  }
  if (state.error || state.missing || !p) {
    return (
      <PageContainer>
        <Card>
          {state.error ? (
            <LoadError error={state.error} />
          ) : (
            <EmptyState
              icon={<Target />}
              title="Prospect introuvable"
              description="Le lien est peut-être incorrect."
              action={
                <Button asChild size="sm">
                  <Link to="/prospection">Retour à la prospection</Link>
                </Button>
              }
            />
          )}
        </Card>
      </PageContainer>
    );
  }

  const row = { ...p, id: prospectId };
  const restaurant = p.restaurantId ? restaurants.byId.get(p.restaurantId) : null;
  const author = (uid: string) => team.byId.get(uid)?.displayName ?? (uid === p.ownerId ? p.ownerName : null) ?? 'Équipe GoLink';
  const open = OPEN_STAGES.includes(p.stage);

  return (
    <PageContainer wide>
      <PageHeader
        eyebrow={`Prospect · ${names.city(p.cityId)}`}
        title={p.name}
        description={[p.cuisine, SOURCE_LABELS[p.source]].filter(Boolean).join(' · ')}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="ghost" size="sm" leftIcon={<ArrowLeft />}>
              <Link to="/prospection">Pipeline</Link>
            </Button>
            {canEdit && (
              <>
                <Button size="sm" leftIcon={<Pencil />} onClick={() => setEditing(true)}>
                  Modifier
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button size="sm" variant="primary" leftIcon={<ArrowRightLeft />}>
                      Changer d’étape
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {PROSPECT_STAGES.filter((s) => s !== p.stage).map((s) => (
                      <DropdownMenuItem key={s} onSelect={() => setMoveTo(s)} destructive={s === 'lost'}>
                        {PROSPECT_STAGE_LABELS[s]}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              </>
            )}
          </div>
        }
      >
        <div className="flex flex-wrap items-center gap-2">
          <StatusPill tone={STAGE_TONES[p.stage]}>{PROSPECT_STAGE_LABELS[p.stage]}</StatusPill>
          {isOverdue(p, now) && <Badge tone="danger">Relance en retard</Badge>}
          {p.stage === 'lost' && p.lostReason && <span className="text-sm text-fg-muted">{p.lostReason}</span>}
        </div>
      </PageHeader>

      {p.stage !== 'lost' && (
        <Card className="mb-6 px-5 py-4">
          <StageTrack stage={p.stage} />
        </Card>
      )}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="min-w-0 space-y-6">
          {canEdit && (
            <Card>
              <CardHeader title="Noter un échange" description="Appel, e-mail, visite ou démonstration." divided />
              <div className="space-y-4 px-5 py-4">
                <div className="-mx-1 overflow-x-auto px-1 [scrollbar-width:none]">
                  <SegmentedControl
                    aria-label="Type d’échange"
                    size="sm"
                    className="min-w-max"
                    value={type}
                    onValueChange={(v) => setType(v as ActivityType)}
                    options={(['call', 'email', 'visit', 'demo', 'note'] as const).map((t) => ({ value: t, label: ACTIVITY_LABELS[t], icon: ACTIVITY_ICONS[t] }))}
                  />
                </div>
                <Textarea rows={3} value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="Ce qui a été dit, les objections, les prochaines étapes…" aria-label="Compte rendu" />
                <div className="grid items-end gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
                  <FormField label={open ? 'Prochaine relance' : 'Relance'} hint={open ? 'Facultatif' : 'Prospect clos : aucune relance.'}>
                    <DateTimeField value={followUp} onChange={setFollowUp} placeholder="Aucune" minDate={new Date()} />
                  </FormField>
                  <Button
                    variant="primary"
                    leftIcon={<Send />}
                    loading={log.loading}
                    disabled={summary.trim().length < 3}
                    onClick={async () => {
                      const ok = await log.mutate({ prospectId, type, summary: summary.trim(), nextFollowUpAt: open ? followUp : null });
                      if (ok) {
                        setSummary('');
                        setFollowUp(null);
                      }
                    }}
                  >
                    Enregistrer
                  </Button>
                </div>
              </div>
            </Card>
          )}

          <Card>
            <CardHeader title="Historique" description="Toutes les actions, de la plus récente à la plus ancienne." divided />
            {activities.error ? (
              <LoadError error={activities.error} compact />
            ) : activities.loading ? (
              <div className="space-y-3 p-5">
                {[0, 1, 2].map((i) => (
                  <Skeleton key={i} className="h-12" />
                ))}
              </div>
            ) : activities.data.length === 0 ? (
              <EmptyState compact icon={<MessageSquareText />} title="Aucun échange" description="Notez chaque appel, visite ou démonstration pour garder le fil." />
            ) : (
              <ol className="relative px-5 py-4">
                {activities.data.map((a, i) => (
                  <li key={a.id} className="relative flex gap-3 pb-5 last:pb-0">
                    {i < activities.data.length - 1 && <span className="absolute left-[15px] top-8 h-[calc(100%-1.5rem)] w-px bg-border" aria-hidden />}
                    <span
                      className={cn(
                        'grid size-8 shrink-0 place-items-center rounded-full border border-border bg-surface-2 text-fg-muted [&_svg]:size-3.5',
                        a.type === 'stage_change' && a.toStage && `tone-${STAGE_TONES[a.toStage]} border-(--tone-border) bg-(--tone-bg) text-(--tone-fg)`,
                      )}
                    >
                      {ACTIVITY_ICONS[a.type]}
                    </span>
                    <div className="min-w-0 flex-1 pt-1">
                      <p className="text-sm text-fg">
                        <span className="font-medium">{ACTIVITY_LABELS[a.type]}</span>
                        {a.type === 'stage_change' && a.fromStage && a.toStage && (
                          <span className="text-fg-muted">
                            {' '}
                            · {PROSPECT_STAGE_LABELS[a.fromStage]} → {PROSPECT_STAGE_LABELS[a.toStage]}
                          </span>
                        )}
                      </p>
                      <p className="mt-0.5 whitespace-pre-line text-sm text-fg-muted">{a.summary}</p>
                      <p className="mt-1 text-2xs text-fg-subtle">
                        {author(a.by)} · {toMillis(a.at) ? `${formatDateTime(toMillis(a.at) ?? 0)} (${formatRelative(toMillis(a.at) ?? 0, now)})` : ''}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </Card>
        </div>

        <div className="min-w-0 space-y-6">
          <Card>
            <CardHeader title="Contact" icon={<UserRound />} divided />
            <div className="space-y-3 px-5 py-4 text-sm">
              <p className="font-medium text-fg">{p.contactName ?? 'Contact non renseigné'}</p>
              {p.contactPhone && (
                <a href={`tel:${p.contactPhone.replace(/\s/g, '')}`} className="flex items-center gap-2 text-fg-muted hover:text-fg">
                  <Phone className="size-4" /> {p.contactPhone}
                </a>
              )}
              {p.contactEmail && (
                <a href={`mailto:${p.contactEmail}`} className="flex items-center gap-2 break-all text-fg-muted hover:text-fg">
                  <Mail className="size-4 shrink-0" /> {p.contactEmail}
                </a>
              )}
            </div>
          </Card>
          <Card>
            <CardHeader title="Suivi" divided />
            <dl className="divide-y divide-border px-5 py-1">
              <InfoRow label="Commercial">{p.ownerName ?? team.byId.get(p.ownerId)?.displayName ?? '—'}</InfoRow>
              <InfoRow label="Ville">{names.city(p.cityId)}</InfoRow>
              <InfoRow label="Origine">{SOURCE_LABELS[p.source]}</InfoRow>
              <InfoRow label="Potentiel">{p.estimatedMonthlyOrders ? `${formatNumber(p.estimatedMonthlyOrders)} cmd/mois` : '—'}</InfoRow>
              <InfoRow label="Prochaine relance">
                {open && toMillis(p.nextFollowUpAt) ? (
                  <span className={cn(isOverdue(p, now) && 'tone-danger text-(--tone-fg)')}>{formatDateTime(toMillis(p.nextFollowUpAt) ?? 0)}</span>
                ) : (
                  '—'
                )}
              </InfoRow>
              <InfoRow label="Créé">{toMillis(p.createdAt) ? formatDateTime(toMillis(p.createdAt) ?? 0) : '—'}</InfoRow>
              {p.stage === 'signed_up' && (
                <InfoRow label="Restaurant">
                  {restaurant ? (
                    <Link to={`/restaurants/${restaurant.id}`} className="inline-flex items-center gap-1 text-primary-soft-fg hover:underline">
                      <Store className="size-3.5" /> {restaurant.name}
                    </Link>
                  ) : (
                    'Non relié'
                  )}
                </InfoRow>
              )}
            </dl>
            {canEdit && open && !p.nextFollowUpAt && (
              <div className="border-t border-border px-5 py-3">
                <Button size="sm" variant="ghost" leftIcon={<CalendarPlus />} onClick={() => setEditing(true)}>
                  Planifier une relance
                </Button>
              </div>
            )}
          </Card>
          {p.notes && (
            <Card>
              <CardHeader title="Notes" divided />
              <p className="whitespace-pre-line px-5 py-4 text-sm text-fg-muted">{p.notes}</p>
            </Card>
          )}
        </div>
      </div>

      <Sheet open={editing} onOpenChange={setEditing}>
        {editing && <ProspectFormSheet prospect={row} onDone={() => setEditing(false)} />}
      </Sheet>
      {moveTo && <StageDialog prospect={row} to={moveTo} onClose={() => setMoveTo(null)} />}
    </PageContainer>
  );
}
