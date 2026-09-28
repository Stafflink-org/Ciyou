import { useMemo, useState } from 'react';
import { doc, serverTimestamp, updateDoc } from 'firebase/firestore';
import { CalendarClock, Check, PackageCheck, PackageX, Truck, X } from 'lucide-react';
import {
  Badge,
  Button,
  ConfirmDialog,
  DataTable,
  EmptyState,
  PageContainer,
  Sheet,
  SheetBody,
  SheetContent,
  SheetFooter,
  SheetHeader,
  StatCard,
  StatusPill,
  createColumnHelper,
  formatDateTime,
} from '@golink/ui';
import { paths, type HaccpReception, type WithId } from '@golink/shared';
import { useAuth, useDocumentTitle } from '@golink/web';
import { useCan, useRestaurantAccess } from '@/auth/RestaurantAccess';
import { collectionAt, toDate, useMutation } from '@/lib/firestore';
import { addDays, formatShortDay, todayIso } from '../_rh/dates';
import { useStaffDirectory } from '../_rh/hooks';
import { DetailRow, ErrorCard } from '../_rh/ui';
import { formatTemp, useReceptions } from './data';
import { ReceptionDialog } from './dialogs';
import { HaccpHeader } from './layout';

const column = createColumnHelper<WithId<HaccpReception>>();
const STATUS = {
  pending: { label: 'En attente', tone: 'amber' as const },
  accepted: { label: 'Acceptée', tone: 'success' as const },
  refused: { label: 'Refusée', tone: 'danger' as const },
};
const CHECK_LABELS: Record<keyof HaccpReception['checks'], string> = {
  supplierIdentified: 'Fournisseur identifié',
  labelingConform: 'Étiquetage conforme',
  packagingIntact: 'Emballage intact',
  useByChecked: 'DLC / DDM vérifiée',
  temperatureConform: 'Température conforme',
  quantityChecked: 'Quantité contrôlée',
};

export function ReceptionsPage() {
  useDocumentTitle('Réceptions · HACCP · Ciyou Eats Restaurant');
  const can = useCan();
  const manage = can('haccp.manage');
  const { restaurantId } = useRestaurantAccess();
  const { user } = useAuth();
  const directory = useStaffDirectory();
  const receptions = useReceptions(90);
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<WithId<HaccpReception> | null>(null);
  const [refusing, setRefusing] = useState(false);
  const today = todayIso();

  const decide = useMutation(
    async (reception: WithId<HaccpReception>, status: 'accepted' | 'refused', notes?: string) => {
      await updateDoc(doc(collectionAt(paths.restaurantSub(restaurantId, 'haccpReceptions')), reception.id), {
        status,
        decidedBy: user!.uid,
        decidedAt: serverTimestamp(),
        notes: notes ?? reception.notes ?? null,
      });
      return status;
    },
    { success: (s) => (s === 'accepted' ? 'Livraison acceptée' : 'Livraison refusée') },
  );

  const pending = receptions.data.filter((r) => r.status === 'pending');
  const refused = receptions.data.filter((r) => r.status === 'refused');
  const dlcSoon = receptions.data.filter((r) => r.status === 'accepted' && r.useByDate && r.useByDate >= today && r.useByDate <= addDays(today, 3));

  const columns = useMemo(
    () => [
      column.accessor((r) => toDate(r.receivedAt)?.getTime() ?? 0, {
        id: 'at',
        header: 'Reçue le',
        cell: (info) => <span className="font-mono text-xs num">{info.getValue() ? formatDateTime(info.getValue()) : '—'}</span>,
      }),
      column.accessor('supplierName', { header: 'Fournisseur' }),
      column.accessor('productName', {
        header: 'Produit',
        cell: (info) => (
          <span className="min-w-0">
            <span className="block text-sm text-fg">{info.getValue()}</span>
            <span className="block text-2xs text-fg-subtle">{[info.row.original.category, info.row.original.lotNumber && `lot ${info.row.original.lotNumber}`].filter(Boolean).join(' · ')}</span>
          </span>
        ),
      }),
      column.accessor((r) => r.useByDate ?? '', {
        id: 'dlc',
        header: 'DLC',
        cell: (info) => {
          const v = info.getValue();
          if (!v) return <span className="text-xs text-fg-subtle">—</span>;
          const soon = v <= addDays(today, 3);
          return <span className={soon ? 'text-xs font-semibold text-danger' : 'text-xs text-fg'}>{formatShortDay(v)}</span>;
        },
      }),
      column.accessor((r) => r.temperature ?? null, {
        id: 'temp',
        header: 'T°',
        meta: { align: 'right' },
        cell: (info) => <span className="font-mono text-xs num">{info.getValue() === null ? '—' : formatTemp(info.getValue()!)}</span>,
      }),
      column.accessor((r) => Object.values(r.checks).filter((v) => !v).length, {
        id: 'checks',
        header: 'Contrôles',
        cell: (info) => (info.getValue() === 0 ? <Badge tone="success" size="sm">6 / 6</Badge> : <Badge tone="danger" size="sm">{6 - info.getValue()} / 6</Badge>),
      }),
      column.accessor('status', { header: 'Décision', cell: (info) => <StatusPill tone={STATUS[info.getValue()].tone}>{STATUS[info.getValue()].label}</StatusPill> }),
    ],
    [today],
  );

  return (
    <PageContainer wide>
      <HaccpHeader
        title="Contrôles à réception"
        description="Chaque livraison est vérifiée (température, étiquetage, DLC) avant d’être acceptée ou refusée."
        actions={
          <Button variant="primary" leftIcon={<Truck />} onClick={() => setOpen(true)}>
            Nouvelle réception
          </Button>
        }
      />
      {receptions.error && <ErrorCard error={receptions.error} />}
      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Réceptions sur 90 jours" value={String(receptions.data.length)} icon={<Truck />} tone="info" loading={receptions.loading} />
        <StatCard label="En attente de décision" value={String(pending.length)} icon={<CalendarClock />} tone={pending.length ? 'amber' : 'success'} loading={receptions.loading} />
        <StatCard label="Livraisons refusées" value={String(refused.length)} icon={<PackageX />} tone={refused.length ? 'danger' : 'success'} loading={receptions.loading} />
        <StatCard label="DLC dans 3 jours" value={String(dlcSoon.length)} icon={<PackageCheck />} tone={dlcSoon.length ? 'amber' : 'success'} loading={receptions.loading} footer={dlcSoon.map((r) => r.productName).slice(0, 2).join(', ') || 'Aucun produit à écouler en urgence.'} />
      </div>
      <DataTable
        data={receptions.data}
        columns={columns}
        getRowId={(r) => r.id}
        loading={receptions.loading}
        onRowClick={setSelected}
        itemLabel="réceptions"
        initialSorting={[{ id: 'at', desc: true }]}
        searchPlaceholder="Rechercher un fournisseur, un produit, un lot…"
        filters={[{ id: 'status', label: 'Décision', options: Object.entries(STATUS).map(([value, s]) => ({ value, label: s.label })), getValue: (r) => r.status }]}
        emptyState={
          <EmptyState
            compact
            icon={<Truck />}
            title="Aucune réception enregistrée"
            description="Enregistrez vos livraisons pour assurer la traçabilité des lots."
            action={
              <Button variant="primary" leftIcon={<Truck />} onClick={() => setOpen(true)}>
                Nouvelle réception
              </Button>
            }
          />
        }
      />
      <ReceptionDialog open={open} onClose={() => setOpen(false)} />
      <Sheet open={selected !== null} onOpenChange={(v) => !v && setSelected(null)}>
        <SheetContent>
          {selected && (
            <>
              <SheetHeader icon={<Truck />} title={selected.productName} description={`${selected.supplierName} · ${formatDateTime(toDate(selected.receivedAt) ?? new Date())}`} />
              <SheetBody className="space-y-5">
                <StatusPill tone={STATUS[selected.status].tone}>{STATUS[selected.status].label}</StatusPill>
                <div className="divide-y divide-border rounded-xl border border-border px-4">
                  <DetailRow label="Catégorie">{selected.category ?? '—'}</DetailRow>
                  <DetailRow label="Lot">{selected.lotNumber ?? '—'}</DetailRow>
                  <DetailRow label="DLC / DDM">{selected.useByDate ? formatShortDay(selected.useByDate) : '—'}</DetailRow>
                  <DetailRow label="Quantité">{selected.quantityLabel ?? '—'}</DetailRow>
                  <DetailRow label="Température">{selected.temperature !== null && selected.temperature !== undefined ? formatTemp(selected.temperature) : '—'}</DetailRow>
                  <DetailRow label="Réceptionnée par">{directory.nameOfUid(selected.receivedBy)}</DetailRow>
                  {selected.decidedBy && <DetailRow label="Décision par">{directory.nameOfUid(selected.decidedBy)}</DetailRow>}
                </div>
                <ul className="grid gap-2 sm:grid-cols-2">
                  {(Object.keys(CHECK_LABELS) as Array<keyof HaccpReception['checks']>).map((key) => (
                    <li key={key} className="flex items-center gap-2 text-sm">
                      {selected.checks[key] ? <Check className="size-4 text-success" /> : <X className="size-4 text-danger" />}
                      <span className={selected.checks[key] ? 'text-fg' : 'font-medium text-danger'}>{CHECK_LABELS[key]}</span>
                    </li>
                  ))}
                </ul>
                {selected.notes && <p className="rounded-lg bg-surface-2 px-3 py-2 text-sm text-fg-muted">{selected.notes}</p>}
              </SheetBody>
              {manage && selected.status === 'pending' && (
                <SheetFooter>
                  <Button variant="ghost" leftIcon={<PackageX />} onClick={() => setRefusing(true)}>
                    Refuser
                  </Button>
                  <Button
                    variant="primary"
                    leftIcon={<PackageCheck />}
                    loading={decide.loading}
                    onClick={async () => {
                      if (await decide.mutate(selected, 'accepted')) setSelected(null);
                    }}
                  >
                    Accepter la livraison
                  </Button>
                </SheetFooter>
              )}
              <ConfirmDialog
                open={refusing}
                onOpenChange={setRefusing}
                title="Refuser la livraison"
                description="Le produit est retourné au fournisseur ; le motif est conservé au registre."
                confirmLabel="Refuser"
                destructive
                requireReason
                reasonLabel="Motif du refus"
                onConfirm={async (reason) => {
                  if (await decide.mutate(selected, 'refused', reason)) setSelected(null);
                }}
              />
            </>
          )}
        </SheetContent>
      </Sheet>
    </PageContainer>
  );
}
