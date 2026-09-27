import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { limit, orderBy, query } from 'firebase/firestore';
import { Ban, Download, HeartHandshake, ShieldCheck, Sparkles, UserMinus, Users } from 'lucide-react';
import {
  Avatar,
  Badge,
  ConfirmDialog,
  DataTable,
  EmptyState,
  PageContainer,
  PageHeader,
  SegmentedControl,
  Sheet,
  SheetBody,
  SheetContent,
  SheetHeader,
  Skeleton,
  StatCard,
  StatusPill,
  createColumnHelper,
  formatNumber,
  formatRelative,
} from '@golink/ui';
import { useDocumentTitle } from '@golink/web';
import { paths, type RestaurantCustomer, type WithId } from '@golink/shared';
import { useRestaurantAccess } from '@/auth/RestaurantAccess';
import { collectionAt, toDate, useCollection, useMutation } from '@/lib/firestore';
import { ErrorPanel } from '../finances/components/States';
import { downloadCsv } from '../finances/lib/export';
import { eur, plural } from '../finances/lib/format';
import { CustomerSheet, setCustomerBlocked } from './CustomerSheet';
import { INACTIVE_DAYS, LOYAL_ORDERS, NEW_DAYS, SEGMENTS, customerSegments, type Segment } from './segments';

type Row = WithId<RestaurantCustomer> & { segments: Segment[] };
const column = createColumnHelper<Row>();

/** CRM : clients du restaurant, segments, fiche détaillée, blocage. */
const PROFILE_BADGES = [
  { segment: 'new', label: 'Nouveau', tone: 'info' },
  { segment: 'loyal', label: 'Fidèle', tone: 'success' },
  { segment: 'inactive', label: 'Inactif', tone: 'amber' },
] as const;

export function ClientsPage() {
  useDocumentTitle('Clients · GoLink Restaurant');
  const navigate = useNavigate();
  const { customerId } = useParams();
  const { restaurant, restaurantId, can } = useRestaurantAccess();
  const canManage = can('customers.manage');
  const [segment, setSegment] = useState<Segment>('all');
  const [pendingBlock, setPendingBlock] = useState<Row[] | null>(null);

  const customers = useCollection<RestaurantCustomer>(
    query(collectionAt(paths.restaurantSub(restaurantId, 'customers')), orderBy('lastOrderAt', 'desc'), limit(2000)),
  );
  const rows = useMemo<Row[]>(() => {
    const now = Date.now();
    return customers.data.map((c) => ({ ...c, tags: c.tags ?? [], segments: customerSegments(c, now) }));
  }, [customers.data]);
  const counts = useMemo(() => {
    const result: Record<Segment, number> = { all: 0, new: 0, loyal: 0, inactive: 0, blocked: 0 };
    for (const row of rows) for (const s of row.segments) result[s] += 1;
    return result;
  }, [rows]);
  const visible = rows.filter((row) => row.segments.includes(segment));
  const selected = rows.find((row) => row.id === customerId) ?? null;
  const repeatRate = counts.all ? rows.filter((r) => r.ordersCount >= 2).length / counts.all : 0;
  const totalSpent = rows.reduce((s, r) => s + r.totalSpentCents, 0);

  const bulk = useMutation(
    (input: { ids: string[]; blocked: boolean; reason?: string }) => setCustomerBlocked({ restaurantId, customerIds: input.ids, blocked: input.blocked, ...(input.reason ? { reason: input.reason } : {}) }),
    { success: (r) => `${plural(r.updated, 'client mis à jour', 'clients mis à jour')}.` },
  );

  const columns = useMemo(
    () => [
      column.accessor('displayName', {
        header: 'Client',
        cell: (info) => (
          <div className="flex min-w-0 items-center gap-3">
            <Avatar name={info.getValue()} size="sm" />
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-fg">{info.getValue()}</p>
              <p className="truncate text-xs text-fg-subtle">{info.row.original.phoneMasked ?? 'Téléphone masqué'}</p>
            </div>
          </div>
        ),
      }),
      column.accessor('ordersCount', { header: 'Commandes', meta: { align: 'right' }, cell: (info) => <span className="font-mono text-sm num">{formatNumber(info.getValue())}</span> }),
      column.accessor('totalSpentCents', { header: 'Dépenses', meta: { align: 'right' }, cell: (info) => <span className="font-mono text-sm font-medium num">{eur(info.getValue())}</span> }),
      column.accessor('averageBasketCents', {
        header: 'Panier moyen',
        meta: { align: 'right', className: 'hidden lg:table-cell' },
        cell: (info) => <span className="font-mono text-sm text-fg-muted num">{eur(info.getValue())}</span>,
      }),
      column.accessor((row) => toDate(row.lastOrderAt)?.getTime() ?? 0, {
        id: 'last',
        header: 'Dernière commande',
        meta: { className: 'hidden md:table-cell' },
        cell: (info) => <span className="text-sm text-fg-muted">{info.getValue() ? formatRelative(info.getValue()) : '—'}</span>,
      }),
      column.accessor((row) => row.tags.join(' '), {
        id: 'tags',
        header: 'Profil',
        enableSorting: false,
        meta: { className: 'hidden xl:table-cell' },
        cell: (info) => {
          const row = info.row.original;
          const auto = PROFILE_BADGES.filter((b) => row.segments.includes(b.segment));
          const manual = row.tags.filter((t) => !auto.some((b) => b.label === t));
          const shown = [...auto.map((b) => ({ key: b.segment, label: b.label, tone: b.tone })), ...manual.map((t) => ({ key: t, label: t, tone: 'neutral' as const }))];
          if (!shown.length) return <span className="text-xs text-fg-subtle">—</span>;
          return (
            <div className="flex max-w-56 flex-wrap gap-1">
              {shown.slice(0, 3).map((b) => (
                <Badge key={b.key} size="sm" tone={b.tone}>
                  {b.label}
                </Badge>
              ))}
              {shown.length > 3 && <span className="text-xs text-fg-subtle">+{shown.length - 3}</span>}
            </div>
          );
        },
      }),
      column.accessor('blocked', {
        header: 'Statut',
        cell: (info) => <StatusPill tone={info.getValue() ? 'danger' : 'success'}>{info.getValue() ? 'Bloqué' : 'Actif'}</StatusPill>,
      }),
    ],
    [],
  );

  function exportRows(list: Row[]) {
    downloadCsv(
      {
        name: 'Clients',
        columns: [
          { header: 'Client' },
          { header: 'Téléphone (masqué)' },
          { header: 'Commandes', kind: 'number' },
          { header: 'Dépenses', kind: 'money' },
          { header: 'Panier moyen', kind: 'money' },
          { header: 'Première commande' },
          { header: 'Dernière commande' },
          { header: 'Étiquettes' },
          { header: 'Statut' },
        ],
        rows: list.map((r) => [
          r.displayName,
          r.phoneMasked ?? '',
          r.ordersCount,
          r.totalSpentCents,
          r.averageBasketCents,
          toDate(r.firstOrderAt)?.toLocaleDateString('fr-FR') ?? '',
          toDate(r.lastOrderAt)?.toLocaleDateString('fr-FR') ?? '',
          r.tags.join(', '),
          r.blocked ? 'Bloqué' : 'Actif',
        ]),
      },
      `clients-${restaurantId}-${new Date().toISOString().slice(0, 10)}`,
    );
  }

  return (
    <PageContainer>
      <PageHeader
        eyebrow="Clients & livreurs"
        title="Clients"
        description={`Les personnes qui commandent chez ${restaurant.name} : fidélité, historique, notes de l’équipe.`}
      >
        <SegmentedControl
          aria-label="Segment de clients"
          value={segment}
          onValueChange={(v) => setSegment(v as Segment)}
          options={SEGMENTS.map((s) => ({ value: s.value, label: s.label, count: counts[s.value] }))}
        />
      </PageHeader>

      {customers.error ? (
        <ErrorPanel error={customers.error} />
      ) : (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
            <StatCard label="Clients" value={formatNumber(counts.all)} icon={<Users />} loading={customers.loading} footer={`${eur(totalSpent)} dépensés au total`} />
            <StatCard
              label="Nouveaux"
              value={formatNumber(counts.new)}
              icon={<Sparkles />}
              tone="info"
              loading={customers.loading}
              footer={`Première commande depuis ${NEW_DAYS} jours`}
              onClick={() => setSegment('new')}
            />
            <StatCard
              label="Fidèles"
              value={formatNumber(counts.loyal)}
              icon={<HeartHandshake />}
              tone="success"
              loading={customers.loading}
              footer={`${LOYAL_ORDERS} commandes et plus · ${Math.round(repeatRate * 100)} % recommandent`}
              onClick={() => setSegment('loyal')}
            />
            <StatCard
              label="Inactifs"
              value={formatNumber(counts.inactive)}
              icon={<UserMinus />}
              tone="amber"
              loading={customers.loading}
              footer={`Sans commande depuis ${INACTIVE_DAYS} jours : à relancer`}
              onClick={() => setSegment('inactive')}
            />
          </div>

          <DataTable
            data={visible}
            columns={columns}
            getRowId={(row) => row.id}
            loading={customers.loading}
            searchPlaceholder="Rechercher un client…"
            itemLabel="clients"
            pageSize={15}
            initialSorting={[{ id: 'last', desc: true }]}
            onRowClick={(row) => navigate(`/clients/${row.id}`)}
            bulkActions={[
              { label: 'Exporter (CSV)', icon: <Download />, onClick: (list) => exportRows(list) },
              ...(canManage
                ? [
                    { label: 'Bloquer', icon: <Ban />, destructive: true, onClick: (list: Row[]) => setPendingBlock(list.filter((r) => !r.blocked)) },
                    {
                      label: 'Débloquer',
                      icon: <ShieldCheck />,
                      onClick: (list: Row[], clear: () => void) => {
                        const ids = list.filter((r) => r.blocked).map((r) => r.id);
                        if (ids.length) void bulk.mutate({ ids, blocked: false }).then((r) => r && clear());
                      },
                    },
                  ]
                : []),
            ]}
            toolbar={
              <button type="button" className="text-sm font-medium text-primary-soft-fg hover:underline disabled:opacity-50" disabled={!visible.length} onClick={() => exportRows(visible)}>
                Exporter la liste
              </button>
            }
            emptyState={
              segment === 'all' ? (
                <EmptyState compact icon={<Users />} title="Pas encore de clients" description="Chaque client ayant commandé chez vous apparaîtra ici automatiquement." />
              ) : (
                <EmptyState compact icon={<Users />} title="Aucun client dans ce segment" description={SEGMENTS.find((s) => s.value === segment)?.hint} />
              )
            }
          />
          <p className="text-xs text-fg-subtle">
            Par respect de la vie privée, GoLink ne communique ni l’e-mail ni le téléphone complet de vos clients. Pour les recontacter, utilisez la messagerie de la commande ou une campagne.
          </p>
        </div>
      )}

      <Sheet open={Boolean(customerId)} onOpenChange={(open) => !open && navigate('/clients')}>
        <SheetContent className="sm:max-w-xl">
          {selected ? (
            <CustomerSheet key={selected.id} customer={selected} />
          ) : (
            <>
              <SheetHeader title="Fiche client" />
              <SheetBody>{customers.loading ? <Skeleton className="h-40 w-full" /> : <EmptyState compact title="Client introuvable" description="Ce client n’a jamais commandé dans cet établissement." />}</SheetBody>
            </>
          )}
        </SheetContent>
      </Sheet>

      <ConfirmDialog
        open={Boolean(pendingBlock)}
        onOpenChange={(open) => !open && setPendingBlock(null)}
        destructive
        requireReason
        reasonLabel="Motif du blocage (conservé dans le journal d’audit)"
        title={`Bloquer ${plural(pendingBlock?.length ?? 0, 'client')} ?`}
        description="Les clients sélectionnés ne pourront plus commander dans votre établissement. Les clients déjà bloqués sont ignorés."
        confirmLabel="Bloquer"
        onConfirm={async (reason) => {
          const ids = (pendingBlock ?? []).map((r) => r.id);
          if (ids.length) await bulk.mutate({ ids, blocked: true, reason });
          setPendingBlock(null);
        }}
      />
    </PageContainer>
  );
}
