import { useMemo, useState } from 'react';
import { collection, limit, orderBy, query, where, Timestamp } from 'firebase/firestore';
import { BadgeEuro, CheckCircle2, Clock, Flame, Inbox, Smile, Timer } from 'lucide-react';
import {
  AreaChart,
  BarChart,
  Card,
  DonutChart,
  PageContainer,
  PageHeader,
  SegmentedControl,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  formatPercent,
} from '@golink/ui';
import { COLLECTIONS, type SupportTicket } from '@golink/shared';
import { useDocumentTitle } from '@golink/web';
import { db } from '@/lib/firebase';
import { useCollection } from '@/lib/firestore';
import { euros, formatDuration, isoDay, millis, plural, shortDay } from '../_experience/format';
import { REQUESTER_LABELS } from '../_experience/labels';
import { useScopeFilter } from '../_experience/scope';
import { Kpi, LoadError, Panel } from '../_experience/ui';
import { SupportNav } from './components';
import { useSupportAgents, useTicketReasons } from './hooks';

const DAY = 86_400_000;
const avg = (list: number[]) => (list.length ? list.reduce((a, b) => a + b, 0) / list.length : null);

export function StatsPage() {
  useDocumentTitle('Statistiques · Support · GoLink Admin');
  const [days, setDays] = useState('30');
  const scope = useScopeFilter();
  const since = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.getTime() - (Number(days) - 1) * DAY;
  }, [days]);
  const q = useMemo(
    () => query(collection(db, COLLECTIONS.supportTickets), ...scope.constraints, where('createdAt', '>=', Timestamp.fromMillis(since)), orderBy('createdAt', 'asc'), limit(3000)),
    [scope.key, since],
  );
  const { data, loading, error } = useCollection<SupportTicket>(q);
  const reasons = useTicketReasons();
  const agents = useSupportAgents();

  const stats = useMemo(() => {
    const firstResponse: number[] = [];
    const resolution: number[] = [];
    let slaMet = 0;
    let slaTotal = 0;
    const byDay = new Map<string, { day: string; tickets: number; resolved: number }>();
    for (let t = since; t <= Date.now(); t += DAY) {
      const key = isoDay(new Date(t));
      byDay.set(key, { day: shortDay(t), tickets: 0, resolved: 0 });
    }
    const byReason = new Map<string, number>();
    const byType = new Map<string, number>();
    const byAgent = new Map<string, { handled: number; resolution: number[]; satisfaction: number[] }>();
    for (const t of data) {
      const created = millis(t.createdAt);
      const day = byDay.get(isoDay(new Date(created)));
      if (day) day.tickets += 1;
      if (t.resolvedAt) {
        const r = byDay.get(isoDay(new Date(millis(t.resolvedAt))));
        if (r) r.resolved += 1;
        resolution.push(millis(t.resolvedAt) - created);
      }
      if (t.firstResponseAt) {
        firstResponse.push(millis(t.firstResponseAt) - created);
        slaTotal += 1;
        if (millis(t.firstResponseAt) <= millis(t.firstResponseDueAt)) slaMet += 1;
      }
      byReason.set(t.reasonId, (byReason.get(t.reasonId) ?? 0) + 1);
      byType.set(t.requesterType, (byType.get(t.requesterType) ?? 0) + 1);
      if (t.assigneeId) {
        const a = byAgent.get(t.assigneeId) ?? { handled: 0, resolution: [], satisfaction: [] };
        a.handled += 1;
        if (t.resolvedAt) a.resolution.push(millis(t.resolvedAt) - created);
        if (t.satisfaction) a.satisfaction.push(t.satisfaction.score);
        byAgent.set(t.assigneeId, a);
      }
    }
    const satisfaction = data.filter((t) => t.satisfaction).map((t) => t.satisfaction!.score);
    return {
      total: data.length,
      open: data.filter((t) => ['open', 'in_progress', 'waiting_customer'].includes(t.status)).length,
      escalated: data.filter((t) => t.escalated).length,
      firstResponse: avg(firstResponse),
      resolution: avg(resolution),
      slaRate: slaTotal ? slaMet / slaTotal : null,
      satisfaction: avg(satisfaction),
      satisfactionCount: satisfaction.length,
      cost: data.reduce((s, t) => s + (t.compensationCents ?? 0), 0),
      costTickets: data.filter((t) => t.compensationCents > 0).length,
      series: [...byDay.values()],
      reasons: [...byReason.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8),
      types: [...byType.entries()],
      agents: [...byAgent.entries()].sort((a, b) => b[1].handled - a[1].handled),
    };
  }, [data, since]);

  return (
    <PageContainer wide>
      <PageHeader
        eyebrow="Opérations"
        title="Support et litiges"
        description={`Volume, délais, motifs et coût des gestes commerciaux · ${scope.label}.`}
        actions={
          <SegmentedControl
            value={days}
            onValueChange={setDays}
            options={[{ value: '7', label: '7 jours' }, { value: '30', label: '30 jours' }, { value: '90', label: '90 jours' }]}
            aria-label="Période"
          />
        }
      />
      <SupportNav />
      {error ? <Card><LoadError error={error} /></Card> : (
        <>
          <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <Kpi label="Tickets reçus" value={loading ? '…' : stats.total} icon={<Inbox />} tone="brand" hint={`${stats.open} encore ouverts`} />
            <Kpi label="1re réponse moyenne" value={stats.firstResponse === null ? '—' : formatDuration(stats.firstResponse)} icon={<Clock />} tone="info" />
            <Kpi label="Résolution moyenne" value={stats.resolution === null ? '—' : formatDuration(stats.resolution)} icon={<Timer />} tone="info" />
            <Kpi label="Délai respecté" value={stats.slaRate === null ? '—' : formatPercent(stats.slaRate)} icon={<CheckCircle2 />} tone={stats.slaRate !== null && stats.slaRate < 0.8 ? 'amber' : 'success'} hint="Première réponse dans le délai cible" />
            <Kpi label="Satisfaction" value={stats.satisfaction === null ? '—' : `${stats.satisfaction.toFixed(1).replace('.', ',')} / 5`} icon={<Smile />} tone="success" hint={plural(stats.satisfactionCount, 'évaluation', 'évaluations')} />
            <Kpi label="Coût des remboursements" value={euros(stats.cost)} icon={<BadgeEuro />} tone="danger" hint={`${stats.costTickets} tickets avec geste · ${stats.escalated} escalades`} />
          </div>

          <div className="grid gap-6 xl:grid-cols-3">
            <Panel title="Tickets reçus et résolus" className="xl:col-span-2">
              {loading ? <Skeleton className="h-64" /> : (
                <AreaChart data={stats.series} xKey="day" height={260} series={[{ key: 'tickets', label: 'Reçus' }, { key: 'resolved', label: 'Résolus' }]} />
              )}
            </Panel>
            <Panel title="Demandeurs">
              {loading ? <Skeleton className="h-64" /> : stats.types.length === 0 ? <p className="text-sm text-fg-muted">Aucun ticket sur la période.</p> : (
                <DonutChart
                  data={stats.types.map(([type, value]) => ({ label: REQUESTER_LABELS[type as keyof typeof REQUESTER_LABELS] ?? type, value }))}
                  centerValue={stats.total}
                  centerLabel="tickets"
                  height={220}
                />
              )}
            </Panel>
          </div>

          <div className="mt-6 grid gap-6 xl:grid-cols-2">
            <Panel title="Motifs principaux" description="Là où agir pour réduire les contacts (centre d’aide, qualité des restaurants).">
              {loading ? <Skeleton className="h-64" /> : stats.reasons.length === 0 ? <p className="text-sm text-fg-muted">Aucun ticket sur la période.</p> : (
                <BarChart
                  horizontal
                  data={stats.reasons.map(([id, value]) => ({ motif: reasons.labels.get(id) ?? id, tickets: value }))}
                  xKey="motif"
                  series={[{ key: 'tickets', label: 'Tickets' }]}
                  height={Math.max(180, stats.reasons.length * 36)}
                />
              )}
            </Panel>
            <Panel title="Équipe" bodyClassName="p-0">
              {stats.agents.length === 0 ? <p className="p-5 text-sm text-fg-muted">Aucun ticket attribué sur la période.</p> : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Agent</TableHead>
                        <TableHead className="text-right">Tickets</TableHead>
                        <TableHead className="text-right">Résolution moy.</TableHead>
                        <TableHead className="text-right">Satisfaction</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {stats.agents.map(([uid, a]) => (
                        <TableRow key={uid}>
                          <TableCell className="whitespace-nowrap">{agents.names.get(uid) ?? 'Ancien membre'}</TableCell>
                          <TableCell className="text-right font-mono num">{a.handled}</TableCell>
                          <TableCell className="text-right font-mono num">{a.resolution.length ? formatDuration(avg(a.resolution)!) : '—'}</TableCell>
                          <TableCell className="text-right font-mono num">{a.satisfaction.length ? `${avg(a.satisfaction)!.toFixed(1).replace('.', ',')} / 5` : '—'}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </Panel>
          </div>
          {stats.escalated > 0 && (
            <p className="mt-4 flex items-center gap-2 text-xs text-fg-subtle"><Flame className="size-3.5" />{stats.escalated} tickets escaladés sur la période ({formatPercent(stats.escalated / Math.max(1, stats.total))}).</p>
          )}
        </>
      )}
    </PageContainer>
  );
}
