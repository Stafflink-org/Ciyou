import { useMemo, useState } from 'react';
import { Timestamp, arrayUnion, doc, serverTimestamp, updateDoc } from 'firebase/firestore';
import { CheckCircle2, CircleAlert, ListChecks, Plus, ShieldAlert, Wrench } from 'lucide-react';
import {
  Badge,
  Button,
  DataTable,
  EmptyState,
  PageContainer,
  Sheet,
  SheetBody,
  SheetContent,
  SheetFooter,
  SheetHeader,
  StatCard,
  StatusBadge,
  Textarea,
  Timeline,
  createColumnHelper,
  formatDateTime,
} from '@golink/ui';
import { HACCP_NC_STATUS_LABELS, HACCP_SEVERITY_LABELS, paths, type HaccpNonConformity, type WithId } from '@golink/shared';
import { useAuth, useDocumentTitle } from '@golink/web';
import { useCan, useRestaurantAccess } from '@/auth/RestaurantAccess';
import { collectionAt, toDate, useMutation } from '@/lib/firestore';
import { useStaffDirectory } from '../_rh/hooks';
import { ErrorCard, NC_STATUS, SEVERITY_TONE } from '../_rh/ui';
import { useNonConformities } from './data';
import { NonConformityDialog } from './dialogs';
import { HaccpHeader } from './layout';

const SOURCE_LABELS: Record<string, string> = {
  temperature: 'Température',
  reception: 'Réception',
  cleaning: 'Nettoyage',
  pest: 'Nuisibles',
  audit: 'Audit',
  other: 'Autre',
};
const column = createColumnHelper<WithId<HaccpNonConformity>>();

export function NonConformitiesPage() {
  useDocumentTitle('Non-conformités · HACCP · GoLink Restaurant');
  const can = useCan();
  const manage = can('haccp.manage');
  const { restaurantId } = useRestaurantAccess();
  const { user } = useAuth();
  const directory = useStaffDirectory();
  const ncs = useNonConformities();
  const [declareOpen, setDeclareOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [action, setAction] = useState('');
  const selected = ncs.data.find((n) => n.id === selectedId) ?? null;

  const addAction = useMutation(
    async (nc: WithId<HaccpNonConformity>, resolve: boolean) => {
      const ref = doc(collectionAt(paths.restaurantSub(restaurantId, 'haccpNonConformities')), nc.id);
      const patch: Record<string, unknown> = {};
      if (action.trim()) patch.correctiveActions = arrayUnion({ text: action.trim(), by: user!.uid, at: Timestamp.now() });
      if (resolve) {
        patch.status = 'resolved';
        patch.resolvedBy = user!.uid;
        patch.resolvedAt = serverTimestamp();
      } else if (nc.status === 'open') {
        patch.status = 'in_progress';
      }
      await updateDoc(ref, patch);
      return resolve;
    },
    { success: (resolved) => (resolved ? 'Non-conformité clôturée' : 'Action corrective enregistrée') },
  );

  const open = ncs.data.filter((n) => n.status === 'open');
  const inProgress = ncs.data.filter((n) => n.status === 'in_progress');
  const critical = ncs.data.filter((n) => n.status !== 'resolved' && n.severity === 'critical');

  const columns = useMemo(
    () => [
      column.accessor((n) => toDate(n.declaredAt)?.getTime() ?? 0, {
        id: 'at',
        header: 'Déclarée le',
        cell: (info) => <span className="font-mono text-xs num">{info.getValue() ? formatDateTime(info.getValue()) : '—'}</span>,
      }),
      column.accessor('title', {
        header: 'Non-conformité',
        cell: (info) => (
          <span className="min-w-0">
            <span className="block text-sm font-medium text-fg">{info.getValue()}</span>
            <span className="block text-2xs text-fg-subtle">
              {SOURCE_LABELS[info.row.original.source?.type ?? 'other']} · {directory.nameOfUid(info.row.original.declaredBy)}
            </span>
          </span>
        ),
      }),
      column.accessor('severity', { header: 'Gravité', cell: (info) => <Badge tone={SEVERITY_TONE[info.getValue()]}>{HACCP_SEVERITY_LABELS[info.getValue()]}</Badge> }),
      column.accessor((n) => n.correctiveActions.length, { id: 'actions', header: 'Actions', meta: { align: 'right' }, cell: (info) => <span className="font-mono text-sm num">{info.getValue()}</span> }),
      column.accessor('status', { header: 'Statut', cell: (info) => <StatusBadge status={info.getValue()} map={NC_STATUS} /> }),
    ],
    [directory],
  );

  return (
    <PageContainer wide>
      <HaccpHeader
        title="Non-conformités"
        description="Écarts constatés, actions correctives et clôture : le suivi exigé lors d’un contrôle sanitaire."
        actions={
          <Button variant="primary" leftIcon={<Plus />} onClick={() => setDeclareOpen(true)}>
            Déclarer
          </Button>
        }
      />
      {ncs.error && <ErrorCard error={ncs.error} />}
      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Ouvertes" value={String(open.length)} icon={<CircleAlert />} tone={open.length ? 'danger' : 'success'} loading={ncs.loading} />
        <StatCard label="En traitement" value={String(inProgress.length)} icon={<Wrench />} tone="amber" loading={ncs.loading} />
        <StatCard label="Critiques non résolues" value={String(critical.length)} icon={<ShieldAlert />} tone={critical.length ? 'danger' : 'success'} loading={ncs.loading} />
        <StatCard label="Résolues" value={String(ncs.data.length - open.length - inProgress.length)} icon={<CheckCircle2 />} tone="success" loading={ncs.loading} />
      </div>
      <DataTable
        data={ncs.data}
        columns={columns}
        getRowId={(n) => n.id}
        loading={ncs.loading}
        onRowClick={(n) => {
          setAction('');
          setSelectedId(n.id);
        }}
        itemLabel="non-conformités"
        initialSorting={[{ id: 'at', desc: true }]}
        filters={[
          { id: 'status', label: 'Statut', options: Object.entries(HACCP_NC_STATUS_LABELS).map(([value, label]) => ({ value, label })), getValue: (n) => n.status },
          { id: 'severity', label: 'Gravité', options: Object.entries(HACCP_SEVERITY_LABELS).map(([value, label]) => ({ value, label })), getValue: (n) => n.severity },
        ]}
        emptyState={<EmptyState compact icon={<ShieldAlert />} title="Aucune non-conformité" description="Tant mieux ! Déclarez tout écart constaté pour garder une trace." />}
      />

      <NonConformityDialog open={declareOpen} onClose={() => setDeclareOpen(false)} />
      <Sheet open={selected !== null} onOpenChange={(v) => !v && setSelectedId(null)}>
        <SheetContent className="sm:max-w-lg">
          {selected && (
            <>
              <SheetHeader icon={<ShieldAlert />} title={selected.title} description={selected.description ?? undefined} />
              <SheetBody className="space-y-5">
                <div className="flex flex-wrap gap-2">
                  <StatusBadge status={selected.status} map={NC_STATUS} />
                  <Badge tone={SEVERITY_TONE[selected.severity]}>Gravité {HACCP_SEVERITY_LABELS[selected.severity].toLowerCase()}</Badge>
                  <Badge tone="neutral" variant="outline">
                    {SOURCE_LABELS[selected.source?.type ?? 'other']}
                  </Badge>
                </div>
                <div>
                  <p className="eyebrow mb-3 flex items-center gap-1.5">
                    <ListChecks className="size-3.5" /> Historique
                  </p>
                  <Timeline
                    items={[
                      {
                        id: 'declared',
                        title: 'Déclarée',
                        description: directory.nameOfUid(selected.declaredBy),
                        time: toDate(selected.declaredAt) ? formatDateTime(toDate(selected.declaredAt)!) : undefined,
                        tone: 'danger',
                      },
                      ...selected.correctiveActions.map((a, i) => ({
                        id: `a${i}`,
                        title: a.text,
                        description: directory.nameOfUid(a.by),
                        time: toDate(a.at) ? formatDateTime(toDate(a.at)!) : undefined,
                        tone: 'amber' as const,
                        icon: <Wrench />,
                      })),
                      ...(selected.status === 'resolved'
                        ? [
                            {
                              id: 'resolved',
                              title: 'Clôturée',
                              description: directory.nameOfUid(selected.resolvedBy),
                              time: toDate(selected.resolvedAt) ? formatDateTime(toDate(selected.resolvedAt)!) : undefined,
                              tone: 'success' as const,
                              icon: <CheckCircle2 />,
                            },
                          ]
                        : []),
                    ]}
                  />
                </div>
                {manage && selected.status !== 'resolved' && (
                  <div className="space-y-2">
                    <p className="text-sm font-medium text-fg">Action corrective</p>
                    <Textarea rows={3} value={action} onChange={(e) => setAction(e.target.value)} maxLength={500} placeholder="Ce qui a été fait pour corriger et éviter que cela se reproduise." />
                  </div>
                )}
                {!manage && selected.status !== 'resolved' && <p className="text-sm text-fg-subtle">Le traitement est assuré par le responsable HACCP de l’établissement.</p>}
              </SheetBody>
              {manage && selected.status !== 'resolved' && (
                <SheetFooter>
                  <Button loading={addAction.loading} disabled={action.trim().length < 3} onClick={async () => { if ((await addAction.mutate(selected, false)) !== undefined) setAction(''); }}>
                    Ajouter l’action
                  </Button>
                  <Button variant="primary" leftIcon={<CheckCircle2 />} loading={addAction.loading} onClick={async () => { if ((await addAction.mutate(selected, true)) !== undefined) setAction(''); }}>
                    Clôturer
                  </Button>
                </SheetFooter>
              )}
            </>
          )}
        </SheetContent>
      </Sheet>
    </PageContainer>
  );
}
