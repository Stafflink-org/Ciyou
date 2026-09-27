import { useMemo, useState, type DragEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { AlarmClock, BellRing, CalendarCheck, Columns3, List, MoreHorizontal, Plus, Store, Target, TrendingUp, UserRound } from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  DataTable,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
  EmptyState,
  IconButton,
  SegmentedControl,
  Select,
  Sheet,
  Skeleton,
  StatCard,
  StatusPill,
  cn,
  createColumnHelper,
  formatDate,
  formatNumber,
  formatRelative,
} from '@golink/ui';
import { PROSPECT_STAGES, PROSPECT_STAGE_LABELS, type ProspectStage } from '@golink/shared';
import { useAuth, useDocumentTitle } from '@golink/web';
import { useAdminAccess } from '@/auth/AdminAccess';
import { toMillis } from '@/lib/firestore';
import { useGeoNames, useNow, useSalesTeam } from '../_croissance/hooks';
import { SOURCE_LABELS, STAGE_TONES } from '../_croissance/labels';
import { LoadError } from '../_croissance/ui';
import { ProspectFormSheet, StageDialog } from './components';
import { CrmLayout, OPEN_STAGES, isDueToday, isOverdue, useProspects, type ProspectRow } from './lib';

type View = 'kanban' | 'liste' | 'relances';
const col = createColumnHelper<ProspectRow>();

function FollowUp({ p, now }: { p: ProspectRow; now: number }) {
  const at = toMillis(p.nextFollowUpAt);
  if (!at || !OPEN_STAGES.includes(p.stage)) return null;
  const overdue = at < now;
  return (
    <span className={cn('inline-flex items-center gap-1 text-xs', overdue ? 'tone-danger text-(--tone-fg)' : 'text-fg-muted')}>
      <AlarmClock className="size-3.5" />
      {overdue ? `Relance en retard (${formatRelative(at, now)})` : `Relance ${formatRelative(at, now)}`}
    </span>
  );
}

function ProspectCard({
  p,
  now,
  city,
  canEdit,
  onMove,
  onOpen,
}: {
  p: ProspectRow;
  now: number;
  city: string;
  canEdit: boolean;
  onMove: (to: ProspectStage) => void;
  onOpen: () => void;
}) {
  return (
    <div
      draggable={canEdit}
      onDragStart={(e) => {
        e.dataTransfer.setData('text/prospect', p.id);
        e.dataTransfer.effectAllowed = 'move';
      }}
      className={cn(
        'group rounded-xl border border-border bg-surface p-3 shadow-xs transition-[border-color,box-shadow] hover:border-border-strong hover:shadow-md',
        canEdit && 'cursor-grab active:cursor-grabbing',
        isOverdue(p, now) && 'border-l-2 border-l-danger',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <button type="button" onClick={onOpen} className="min-w-0 text-left">
          <p className="truncate font-medium text-fg hover:underline">{p.name}</p>
          <p className="truncate text-xs text-fg-muted">
            {city}
            {p.cuisine ? ` · ${p.cuisine}` : ''}
          </p>
        </button>
        {canEdit && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <IconButton label={`Déplacer ${p.name}`} variant="ghost" size="sm" className="-mr-1 -mt-1 opacity-70 group-hover:opacity-100">
                <MoreHorizontal />
              </IconButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>Déplacer vers</DropdownMenuLabel>
              {PROSPECT_STAGES.filter((s) => s !== p.stage).map((s) => (
                <DropdownMenuItem key={s} onSelect={() => onMove(s)}>
                  {PROSPECT_STAGE_LABELS[s]}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1">
        <FollowUp p={p} now={now} />
        {p.estimatedMonthlyOrders ? <span className="num text-xs text-fg-subtle">~{formatNumber(p.estimatedMonthlyOrders)} cmd/mois</span> : null}
      </div>
      <div className="mt-2 flex items-center justify-between gap-2 border-t border-border pt-2 text-2xs text-fg-subtle">
        <span className="inline-flex min-w-0 items-center gap-1 truncate">
          <UserRound className="size-3" />
          {p.ownerName ?? 'Commercial'}
        </span>
        <span>{toMillis(p.lastActivityAt ?? p.updatedAt) ? formatRelative(toMillis(p.lastActivityAt ?? p.updatedAt) ?? 0, now) : ''}</span>
      </div>
    </div>
  );
}

export function PipelinePage() {
  useDocumentTitle('Prospection · GoLink Admin');
  const navigate = useNavigate();
  const { user } = useAuth();
  const { can } = useAdminAccess();
  const canEdit = can('crm.edit');
  const now = useNow();
  const names = useGeoNames();
  const team = useSalesTeam();
  const { data, loading, error } = useProspects();
  const [params, setParams] = useSearchParams();
  const view = (['kanban', 'liste', 'relances'].includes(params.get('vue') ?? '') ? params.get('vue') : 'kanban') as View;
  const [owner, setOwner] = useState<string>('all');
  const [mobileStage, setMobileStage] = useState<ProspectStage>('to_contact');
  const [creating, setCreating] = useState(false);
  const [moving, setMoving] = useState<{ p: ProspectRow; to: ProspectStage } | null>(null);
  const [dragOver, setDragOver] = useState<ProspectStage | null>(null);

  const rows = useMemo(() => (owner === 'all' ? data : data.filter((p) => p.ownerId === owner)), [data, owner]);
  const byStage = useMemo(() => {
    const m = new Map<ProspectStage, ProspectRow[]>(PROSPECT_STAGES.map((s) => [s, []]));
    for (const p of rows) m.get(p.stage)?.push(p);
    return m;
  }, [rows]);

  const kpis = useMemo(() => {
    const monthStart = new Date(now);
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);
    const open = rows.filter((p) => OPEN_STAGES.includes(p.stage)).length;
    const signed = rows.filter((p) => p.stage === 'signed_up').length;
    const lost = rows.filter((p) => p.stage === 'lost').length;
    const signedMonth = rows.filter((p) => p.stage === 'signed_up' && (toMillis(p.signedUpAt) ?? 0) >= monthStart.getTime()).length;
    const overdue = rows.filter((p) => isOverdue(p, now)).length;
    return { open, signed, lost, signedMonth, overdue, rate: signed + lost ? signed / (signed + lost) : null };
  }, [rows, now]);

  const followUps = useMemo(
    () => rows.filter((p) => OPEN_STAGES.includes(p.stage) && toMillis(p.nextFollowUpAt) !== null).sort((a, b) => (toMillis(a.nextFollowUpAt) ?? 0) - (toMillis(b.nextFollowUpAt) ?? 0)),
    [rows],
  );

  function drop(stage: ProspectStage, e: DragEvent) {
    e.preventDefault();
    setDragOver(null);
    const id = e.dataTransfer.getData('text/prospect');
    const p = data.find((x) => x.id === id);
    if (p && p.stage !== stage) setMoving({ p, to: stage });
  }

  const columns = useMemo(
    () => [
      col.accessor('name', {
        header: 'Établissement',
        cell: ({ row }) => (
          <div className="min-w-[12rem]">
            <p className="font-medium text-fg">{row.original.name}</p>
            <p className="text-xs text-fg-muted">
              {names.city(row.original.cityId)}
              {row.original.cuisine ? ` · ${row.original.cuisine}` : ''}
            </p>
          </div>
        ),
      }),
      col.accessor((p) => PROSPECT_STAGE_LABELS[p.stage], {
        id: 'etape',
        header: 'Étape',
        cell: ({ row, getValue }) => <StatusPill tone={STAGE_TONES[row.original.stage]}>{getValue()}</StatusPill>,
      }),
      col.accessor((p) => p.contactName ?? '', {
        id: 'contact',
        header: 'Contact',
        cell: ({ row }) => (
          <div className="min-w-[9rem] text-sm">
            <p className="text-fg">{row.original.contactName ?? '—'}</p>
            <p className="text-xs text-fg-muted">{row.original.contactPhone ?? row.original.contactEmail ?? ''}</p>
          </div>
        ),
      }),
      col.accessor((p) => p.ownerName ?? '', { id: 'commercial', header: 'Commercial', cell: ({ getValue }) => <span className="whitespace-nowrap text-sm">{getValue() || '—'}</span> }),
      col.accessor((p) => SOURCE_LABELS[p.source], { id: 'origine', header: 'Origine', cell: ({ getValue }) => <span className="whitespace-nowrap text-sm text-fg-muted">{getValue()}</span> }),
      col.accessor((p) => toMillis(p.nextFollowUpAt) ?? Number.MAX_SAFE_INTEGER, {
        id: 'relance',
        header: 'Relance',
        cell: ({ row }) => <FollowUp p={row.original} now={now} />,
      }),
      col.accessor((p) => toMillis(p.updatedAt) ?? 0, {
        id: 'maj',
        header: 'Mis à jour',
        cell: ({ getValue }) => <span className="whitespace-nowrap text-xs text-fg-muted">{getValue() ? formatDate(getValue()) : '—'}</span>,
      }),
    ],
    [names, now],
  );

  return (
    <CrmLayout
      actions={
        canEdit ? (
          <Button variant="primary" leftIcon={<Plus />} onClick={() => setCreating(true)}>
            Nouveau prospect
          </Button>
        ) : undefined
      }
    >
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Prospects en cours" value={formatNumber(kpis.open)} icon={<Target />} tone="brand" loading={loading} />
        <StatCard
          label="Taux de conversion"
          value={kpis.rate === null ? '—' : `${Math.round(kpis.rate * 100)} %`}
          icon={<TrendingUp />}
          tone="success"
          loading={loading}
          footer={`${kpis.signed} inscrits · ${kpis.lost} perdus`}
        />
        <StatCard label="Inscrits ce mois" value={formatNumber(kpis.signedMonth)} icon={<Store />} tone="teal" loading={loading} />
        <StatCard
          label="Relances en retard"
          value={formatNumber(kpis.overdue)}
          icon={<BellRing />}
          tone={kpis.overdue ? 'danger' : 'neutral'}
          loading={loading}
          onClick={() => setParams({ vue: 'relances' })}
        />
      </div>

      <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
        <SegmentedControl
          aria-label="Affichage"
          size="sm"
          value={view}
          onValueChange={(v) => setParams(v === 'kanban' ? {} : { vue: v })}
          options={[
            { value: 'kanban', label: 'Pipeline', icon: <Columns3 /> },
            { value: 'liste', label: 'Liste', icon: <List /> },
            { value: 'relances', label: 'Relances', icon: <CalendarCheck />, count: kpis.overdue || undefined },
          ]}
        />
        <Select
          size="sm"
          className="w-full sm:w-56"
          aria-label="Commercial"
          value={owner}
          onValueChange={setOwner}
          options={[
            { value: 'all', label: 'Tous les commerciaux' },
            ...(user ? [{ value: user.uid, label: 'Mes prospects' }] : []),
            ...team.reps.filter((r) => r.uid !== user?.uid).map((r) => ({ value: r.uid, label: r.displayName })),
          ]}
        />
      </div>

      <div className="mt-4">
        {error ? (
          <Card>
            <LoadError error={error} />
          </Card>
        ) : loading ? (
          <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
            {PROSPECT_STAGES.map((s) => (
              <Skeleton key={s} className="h-72" />
            ))}
          </div>
        ) : data.length === 0 ? (
          <Card>
            <EmptyState
              icon={<Target />}
              title="Aucun prospect"
              description="Ajoutez les restaurants démarchés pour suivre les démonstrations, les relances et les inscriptions."
              action={
                canEdit ? (
                  <Button size="sm" variant="primary" leftIcon={<Plus />} onClick={() => setCreating(true)}>
                    Nouveau prospect
                  </Button>
                ) : undefined
              }
            />
          </Card>
        ) : view === 'kanban' ? (
          <>
            <div data-scroll-ok className="-mx-4 mb-3 overflow-x-auto px-4 [scrollbar-width:none] md:hidden">
              <SegmentedControl
                aria-label="Étape affichée"
                size="sm"
                className="min-w-max"
                value={mobileStage}
                onValueChange={(v) => setMobileStage(v as ProspectStage)}
                options={PROSPECT_STAGES.map((s) => ({ value: s, label: PROSPECT_STAGE_LABELS[s], count: byStage.get(s)?.length || undefined }))}
              />
            </div>
            <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
              {PROSPECT_STAGES.map((stage) => {
                const items = byStage.get(stage) ?? [];
                return (
                  <section
                    key={stage}
                    aria-label={PROSPECT_STAGE_LABELS[stage]}
                    onDragOver={(e) => {
                      if (!canEdit) return;
                      e.preventDefault();
                      setDragOver(stage);
                    }}
                    onDragLeave={() => setDragOver((s) => (s === stage ? null : s))}
                    onDrop={(e) => drop(stage, e)}
                    className={cn(
                      'min-w-0 flex-col rounded-2xl border border-border bg-surface-2 p-2 transition-colors',
                      stage === mobileStage ? 'flex' : 'hidden md:flex',
                      dragOver === stage && 'border-primary bg-primary-soft/40',
                    )}
                  >
                    <header className="flex items-center justify-between px-1.5 pb-2 pt-1">
                      <span className="flex items-center gap-2">
                        <span className={cn(`tone-${STAGE_TONES[stage]}`, 'size-2 rounded-full bg-(--tone-solid)')} />
                        <span className="text-sm font-semibold text-fg">{PROSPECT_STAGE_LABELS[stage]}</span>
                      </span>
                      <Badge size="sm">{items.length}</Badge>
                    </header>
                    <div className="flex min-h-24 flex-col gap-2">
                      {items.map((p) => (
                        <ProspectCard
                          key={p.id}
                          p={p}
                          now={now}
                          city={names.city(p.cityId)}
                          canEdit={canEdit}
                          onMove={(to) => setMoving({ p, to })}
                          onOpen={() => void navigate(`/prospection/${p.id}`)}
                        />
                      ))}
                      {items.length === 0 && <p className="px-2 py-6 text-center text-xs text-fg-subtle">{canEdit ? 'Glissez un prospect ici' : 'Aucun prospect'}</p>}
                    </div>
                  </section>
                );
              })}
            </div>
          </>
        ) : view === 'liste' ? (
          <DataTable
            data={rows}
            columns={columns}
            getRowId={(p) => p.id}
            searchable
            searchPlaceholder="Rechercher un établissement, un contact…"
            itemLabel="prospects"
            onRowClick={(p) => void navigate(`/prospection/${p.id}`)}
            filters={[
              { id: 'stage', label: 'Étape', options: PROSPECT_STAGES.map((s) => ({ value: s, label: PROSPECT_STAGE_LABELS[s] })), getValue: (p) => p.stage },
              { id: 'city', label: 'Ville', options: [...new Set(rows.map((p) => p.cityId))].map((c) => ({ value: c, label: names.city(c) })), getValue: (p) => p.cityId },
              { id: 'source', label: 'Origine', options: Object.entries(SOURCE_LABELS).map(([value, label]) => ({ value, label })), getValue: (p) => p.source },
            ]}
          />
        ) : followUps.length === 0 ? (
          <Card>
            <EmptyState icon={<CalendarCheck />} title="Aucune relance prévue" description="Planifiez une relance depuis la fiche d’un prospect." />
          </Card>
        ) : (
          <Card>
            <ul className="divide-y divide-border">
              {followUps.map((p) => {
                const overdue = isOverdue(p, now);
                return (
                  <li key={p.id} className="flex flex-col gap-2 px-5 py-3.5 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <Link to={`/prospection/${p.id}`} className="font-medium text-fg hover:underline">
                        {p.name}
                      </Link>
                      <p className="text-sm text-fg-muted">
                        {names.city(p.cityId)} · {p.contactName ?? 'contact non renseigné'}
                        {p.contactPhone ? ` · ${p.contactPhone}` : ''}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusPill tone={STAGE_TONES[p.stage]}>{PROSPECT_STAGE_LABELS[p.stage]}</StatusPill>
                      <Badge tone={overdue ? 'danger' : isDueToday(p, now) ? 'amber' : 'neutral'}>
                        {overdue ? 'En retard' : isDueToday(p, now) ? 'Aujourd’hui' : formatDate(toMillis(p.nextFollowUpAt) ?? 0)}
                      </Badge>
                      <span className="text-xs text-fg-subtle">{p.ownerName}</span>
                    </div>
                  </li>
                );
              })}
            </ul>
          </Card>
        )}
      </div>

      <Sheet open={creating} onOpenChange={setCreating}>
        {creating && <ProspectFormSheet prospect={null} onDone={() => setCreating(false)} />}
      </Sheet>
      {moving && <StageDialog prospect={moving.p} to={moving.to} onClose={() => setMoving(null)} />}
    </CrmLayout>
  );
}
