import { useState } from 'react';
import { Link } from 'react-router';
import { AlertTriangle, CalendarClock, ChevronRight, ClipboardCheck, Plus, ShieldAlert, ShieldCheck, SprayCan, Thermometer, Truck } from 'lucide-react';
import {
  Button,
  Card,
  CardHeader,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  EmptyState,
  PageContainer,
  Skeleton,
  StatCard,
  StatusPill,
  cn,
  formatPercent,
} from '@golink/ui';
import { useDocumentTitle } from '@golink/web';
import { toDate } from '@/lib/firestore';
import { addDays, formatDayMonth, formatFullDay, todayIso } from '../_rh/dates';
import { ErrorCard } from '../_rh/ui';
import { EQUIPMENT_KIND_LABELS, cleaningDue, formatTemp, rangeLabel, useCleaningLogs, useCleaningTasks, useEquipments, useNonConformities, usePestReports, usePestVisits, useReceptions, useTemperatureLogs } from './data';
import { NonConformityDialog, ReadingDialog, ReceptionDialog } from './dialogs';
import { HaccpHeader } from './layout';

export function HaccpDashboardPage() {
  useDocumentTitle('HACCP · GoLink Restaurant');
  const equipments = useEquipments();
  const logs = useTemperatureLogs(30);
  const receptions = useReceptions(30);
  const cleaningTasks = useCleaningTasks();
  const cleaningLogs = useCleaningLogs(31);
  const ncs = useNonConformities();
  const pestReports = usePestReports();
  const pestVisits = usePestVisits();
  const [reading, setReading] = useState<{ equipmentId: string | null } | null>(null);
  const [receptionOpen, setReceptionOpen] = useState(false);
  const [ncOpen, setNcOpen] = useState(false);
  const today = todayIso();

  const loading = equipments.loading || logs.loading;
  const conform = logs.data.filter((l) => l.inRange).length;
  const compliance = logs.data.length ? conform / logs.data.length : null;
  const todayLogs = logs.data.filter((l) => {
    const at = toDate(l.recordedAt);
    return at && at.toDateString() === new Date().toDateString();
  });
  const activeEquipments = equipments.data.filter((e) => e.active);
  const expected = activeEquipments.reduce((t, e) => t + e.readingsPerDay, 0);
  const openNcs = ncs.data.filter((n) => n.status !== 'resolved');
  const unverified = logs.data.filter((l) => !l.inRange && !l.verifiedBy);
  const activeTasks = cleaningTasks.data.filter((t) => t.active);
  const lastDone = (taskId: string) => {
    const log = cleaningLogs.data.find((l) => l.taskId === taskId);
    return log ? toDate(log.doneAt) : null;
  };
  const cleaningLate = activeTasks.filter((t) => cleaningDue(t, lastDone(t.id)));
  const dlcSoon = receptions.data.filter((r) => r.status === 'accepted' && r.useByDate && r.useByDate >= today && r.useByDate <= addDays(today, 3));
  const openPest = pestReports.data.filter((r) => r.status === 'open');
  const nextVisit = pestVisits.data.find((v) => v.nextVisitDate && v.nextVisitDate >= today)?.nextVisitDate ?? null;

  const sensitive: Array<{ id: string; label: string; detail: string; to: string; tone: 'danger' | 'amber' }> = [
    ...openNcs.slice(0, 4).map((n) => ({ id: `nc-${n.id}`, label: n.title, detail: 'Non-conformité ouverte', to: '/equipe/haccp/non-conformites', tone: 'danger' as const })),
    ...unverified.slice(0, 3).map((l) => ({
      id: `t-${l.id}`,
      label: `${equipments.data.find((e) => e.id === l.equipmentId)?.name ?? 'Équipement'} : ${formatTemp(l.value)}`,
      detail: 'Relevé hors seuil à vérifier',
      to: '/equipe/haccp/temperatures',
      tone: 'danger' as const,
    })),
    ...cleaningLate.slice(0, 3).map((t) => ({ id: `c-${t.id}`, label: `${t.name} (${t.area})`, detail: 'Nettoyage à réaliser', to: '/equipe/haccp/nettoyage', tone: 'amber' as const })),
    ...dlcSoon.slice(0, 3).map((r) => ({ id: `d-${r.id}`, label: r.productName, detail: `DLC le ${formatDayMonth(r.useByDate!)}`, to: '/equipe/haccp/receptions', tone: 'amber' as const })),
    ...openPest.slice(0, 2).map((r) => ({ id: `p-${r.id}`, label: r.area, detail: 'Signalement nuisibles ouvert', to: '/equipe/haccp/nuisibles', tone: 'danger' as const })),
  ];

  const error = equipments.error ?? logs.error ?? ncs.error ?? cleaningTasks.error;

  return (
    <PageContainer wide>
      <HaccpHeader
        title="HACCP"
        description={`${formatFullDay(today)} · centralisez les contrôles, la traçabilité et les actions d’hygiène.`}
        actions={
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="primary" leftIcon={<Plus />}>
                Nouveau contrôle
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-60">
              <DropdownMenuItem icon={<Thermometer />} onSelect={() => setReading({ equipmentId: null })}>
                Relevé de température
              </DropdownMenuItem>
              <DropdownMenuItem icon={<Truck />} onSelect={() => setReceptionOpen(true)}>
                Contrôle à réception
              </DropdownMenuItem>
              <DropdownMenuItem icon={<ShieldAlert />} onSelect={() => setNcOpen(true)}>
                Non-conformité
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        }
      />
      {error && <ErrorCard error={error} />}

      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Conformité des températures"
          value={compliance === null ? '—' : formatPercent(compliance)}
          icon={<ShieldCheck />}
          tone={compliance === null || compliance >= 0.95 ? 'success' : 'amber'}
          loading={loading}
          footer={`${logs.data.length} relevés sur 30 jours`}
        />
        <StatCard
          label="Relevés du jour"
          value={`${todayLogs.length} / ${expected}`}
          icon={<Thermometer />}
          tone={todayLogs.length >= expected ? 'success' : 'info'}
          loading={loading}
          footer={todayLogs.length >= expected ? 'Tous les relevés prévus sont faits.' : `${Math.max(0, expected - todayLogs.length)} relevé(s) restant(s) aujourd’hui.`}
        />
        <StatCard
          label="Non-conformités ouvertes"
          value={String(openNcs.length)}
          icon={<ShieldAlert />}
          tone={openNcs.length ? 'danger' : 'success'}
          loading={ncs.loading}
          footer={`${ncs.data.filter((n) => n.status === 'resolved').length} résolue(s) au total`}
        />
        <StatCard
          label="Nettoyages à faire"
          value={String(cleaningLate.length)}
          icon={<SprayCan />}
          tone={cleaningLate.length ? 'amber' : 'success'}
          loading={cleaningTasks.loading || cleaningLogs.loading}
          footer={`${activeTasks.length} tâche(s) au plan de nettoyage`}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader
            icon={<ClipboardCheck />}
            title="Les contrôles du jour"
            description="Relevés attendus par enceinte ; cliquez pour saisir."
            actions={
              <Button size="xs" variant="ghost" asChild>
                <Link to="/equipe/haccp/temperatures">
                  Journal <ChevronRight className="size-3.5" />
                </Link>
              </Button>
            }
            divided
          />
          {loading ? (
            <div className="space-y-2 p-5">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-12" />
              ))}
            </div>
          ) : activeEquipments.length === 0 ? (
            <EmptyState
              compact
              icon={<Thermometer />}
              title="Aucun équipement suivi"
              description="Déclarez vos réfrigérateurs, congélateurs et bains-marie pour planifier les relevés."
              action={
                <Button asChild>
                  <Link to="/equipe/haccp/temperatures">Ajouter un équipement</Link>
                </Button>
              }
            />
          ) : (
            <ul className="divide-y divide-border">
              {activeEquipments.map((equipment) => {
                const own = todayLogs.filter((l) => l.equipmentId === equipment.id);
                const last = logs.data.find((l) => l.equipmentId === equipment.id);
                const done = own.length >= equipment.readingsPerDay;
                return (
                  <li key={equipment.id}>
                    <button type="button" onClick={() => setReading({ equipmentId: equipment.id })} className="flex w-full items-center gap-4 px-5 py-3 text-left transition-colors hover:bg-surface-2">
                      <div className={cn('grid size-10 shrink-0 place-items-center rounded-xl', last && !last.inRange ? 'tone-danger bg-(--tone-bg) text-(--tone-fg)' : 'tone-info bg-(--tone-bg) text-(--tone-fg)')}>
                        <Thermometer className="size-5" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-fg">{equipment.name}</p>
                        <p className="truncate text-xs text-fg-subtle">
                          {EQUIPMENT_KIND_LABELS[equipment.kind]} · {equipment.area} · {rangeLabel(equipment)}
                        </p>
                      </div>
                      <div className="hidden text-right sm:block">
                        <p className={cn('font-mono text-sm font-semibold num', last && !last.inRange ? 'text-danger' : 'text-fg')}>{last ? formatTemp(last.value) : '—'}</p>
                        <p className="text-2xs text-fg-subtle">dernier relevé</p>
                      </div>
                      <StatusPill tone={done ? 'success' : own.length > 0 ? 'amber' : 'neutral'}>
                        {own.length} / {equipment.readingsPerDay}
                      </StatusPill>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <div className="rounded-xl bg-sidebar p-5 text-sidebar-fg shadow-card">
          <p className="tone-amber flex items-center gap-1.5 text-xs font-semibold uppercase tracking-eyebrow text-(--tone-solid)">
            <AlertTriangle className="size-3.5" /> À surveiller
          </p>
          <h2 className="mt-1 font-display text-lg font-semibold">Les points sensibles</h2>
          {sensitive.length === 0 ? (
            <p className="mt-4 text-sm text-sidebar-muted">Rien à signaler : tous les contrôles sont à jour.</p>
          ) : (
            <ul className="mt-4 space-y-2">
              {sensitive.slice(0, 8).map((item) => (
                <li key={item.id}>
                  <Link to={item.to} className="flex items-start gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-sidebar-hover">
                    <span className={cn(`tone-${item.tone}`, 'mt-1.5 size-2 shrink-0 rounded-full bg-(--tone-solid)')} />
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">{item.label}</span>
                      <span className="block text-xs text-sidebar-muted">{item.detail}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-5 flex items-center gap-2 border-t border-sidebar-border pt-4 text-xs text-sidebar-muted">
            <CalendarClock className="size-4" />
            {nextVisit ? `Prochain passage nuisibles : ${formatDayMonth(nextVisit)}` : 'Aucun passage nuisibles planifié.'}
          </div>
        </div>
      </div>

      <ReadingDialog open={reading !== null} onClose={() => setReading(null)} equipments={equipments.data} equipmentId={reading?.equipmentId} />
      <ReceptionDialog open={receptionOpen} onClose={() => setReceptionOpen(false)} />
      <NonConformityDialog open={ncOpen} onClose={() => setNcOpen(false)} />
    </PageContainer>
  );
}
