import { useMemo, useState } from 'react';
import { Gift, MoreHorizontal, Percent, Plus, ShoppingBag, Ticket } from 'lucide-react';
import {
  Button,
  Card,
  DataTable,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  EmptyState,
  IconButton,
  PageContainer,
  PageHeader,
  SegmentedControl,
  StatCard,
  StatusBadge,
  createColumnHelper,
  formatEUR,
  formatNumber,
} from '@golink/ui';
import { useDocumentTitle } from '@golink/web';
import { errorMessage } from '@/lib/firestore';
import { OfferMenuItems, useOfferActions } from './actions';
import { AnnonceForm } from './AnnonceForm';
import { KIND_SHORT_LABELS, STATUS_META, periodLabel, productOfferStatus, today, useRestaurantOffers, type OfferRow } from './lib';

const column = createColumnHelper<OfferRow>();

type Filter = 'all' | 'live' | 'scheduled' | 'paused' | 'ended';

const FILTERS: Record<Filter, (o: OfferRow) => boolean> = {
  all: () => true,
  live: (o) => productOfferStatus(o, today()) === 'live',
  scheduled: (o) => productOfferStatus(o, today()) === 'scheduled',
  paused: (o) => ['paused', 'disabled'].includes(productOfferStatus(o, today())),
  ended: (o) => productOfferStatus(o, today()) === 'ended',
};

function KindIcon({ offer }: { offer: OfferRow }) {
  return (
    <span className="tone-brand grid size-9 shrink-0 place-items-center rounded-lg bg-(--tone-bg) text-(--tone-fg) [&_svg]:size-4">
      {offer.kind === 'bogo' ? <Gift /> : <Percent />}
    </span>
  );
}

export function AnnoncesPage() {
  useDocumentTitle('Offres sur vos plats · Ciyou Eats Restaurant');
  const { data, loading, error } = useRestaurantOffers();
  const actions = useOfferActions();
  const [filter, setFilter] = useState<Filter>('all');
  const [editor, setEditor] = useState<{ open: boolean; offer: OfferRow | null }>({ open: false, offer: null });

  const stats = useMemo(() => {
    const live = data.filter((o) => productOfferStatus(o, today()) === 'live').length;
    const orders = data.reduce((s, o) => s + (o.ordersCount ?? 0), 0);
    const discount = data.reduce((s, o) => s + (o.discountTotalCents ?? 0), 0);
    return { live, orders, discount };
  }, [data]);

  const counts = useMemo(() => Object.fromEntries((Object.keys(FILTERS) as Filter[]).map((f) => [f, data.filter(FILTERS[f]).length])) as Record<Filter, number>, [data]);
  const rows = useMemo(() => data.filter(FILTERS[filter]), [data, filter]);

  const columns = useMemo(
    () => [
      column.accessor((o) => `${o.productName} ${o.title}`, {
        id: 'offre',
        header: 'Offre',
        cell: ({ row: { original: o } }) => (
          <div className="flex min-w-56 items-center gap-3">
            <KindIcon offer={o} />
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-fg">{o.productName}</p>
              <p className="truncate text-xs text-fg-muted">{o.title}</p>
            </div>
          </div>
        ),
      }),
      column.accessor((o) => KIND_SHORT_LABELS[o.kind], {
        id: 'type',
        header: 'Type',
        cell: ({ getValue }) => <span className="whitespace-nowrap text-sm text-fg">{getValue()}</span>,
      }),
      column.accessor((o) => o.startDay, {
        id: 'periode',
        header: 'Période',
        cell: ({ row: { original: o } }) => <span className="whitespace-nowrap text-sm text-fg-muted">{periodLabel(o)}</span>,
      }),
      column.accessor((o) => o.ordersCount ?? 0, {
        id: 'utilisations',
        header: 'Utilisations',
        meta: { align: 'right' },
        cell: ({ row: { original: o } }) => (
          <div className="text-right">
            <p className="font-mono text-sm text-fg num">{formatNumber(o.ordersCount ?? 0)}</p>
            <p className="font-mono text-2xs text-fg-subtle num">{(o.discountTotalCents ?? 0) > 0 ? `−${formatEUR(o.discountTotalCents ?? 0, { cents: true })}` : '—'}</p>
          </div>
        ),
      }),
      column.accessor((o) => productOfferStatus(o, today()), {
        id: 'statut',
        header: 'Statut',
        cell: ({ getValue }) => <StatusBadge status={getValue()} map={STATUS_META} />,
      }),
      column.display({
        id: 'actions',
        header: () => <span className="sr-only">Actions</span>,
        meta: { align: 'right', className: 'w-12' },
        cell: ({ row: { original: o } }) => (
          <div onClick={(e) => e.stopPropagation()}>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <IconButton label={`Actions pour ${o.title}`} size="sm">
                  <MoreHorizontal />
                </IconButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <OfferMenuItems offer={o} onEdit={() => setEditor({ open: true, offer: o })} actions={actions} />
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ),
      }),
    ],
    [actions],
  );

  const createButton = (
    <Button variant="primary" leftIcon={<Plus />} onClick={() => setEditor({ open: true, offer: null })}>
      Nouvelle offre
    </Button>
  );

  return (
    <PageContainer>
      <PageHeader
        eyebrow="Marketing"
        title="Offres sur vos plats"
        description="« 1 acheté, 1 offert » ou « le 2ᵉ à -50 % » sur un plat précis : appliquées automatiquement, à votre charge, sans code à saisir."
        breadcrumbs={[{ label: 'Marketing', href: '/marketing' }, { label: 'Offres sur vos plats' }]}
        actions={createButton}
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Offres en ligne" value={formatNumber(stats.live)} icon={<Ticket />} loading={loading} footer="Actives aujourd’hui." />
        <StatCard label="Commandes concernées" value={formatNumber(stats.orders)} icon={<ShoppingBag />} tone="info" loading={loading} footer="Depuis la création de chaque offre." />
        <StatCard label="Remises accordées" value={formatEUR(stats.discount, { cents: true })} icon={<Gift />} tone="amber" loading={loading} footer="Coût total, déduit de vos reversements." />
      </div>

      <div className="mt-6 space-y-4">
        <SegmentedControl
          aria-label="Filtrer les offres"
          value={filter}
          onValueChange={(v) => setFilter(v as Filter)}
          options={[
            { value: 'all', label: 'Toutes', count: counts.all },
            { value: 'live', label: 'En ligne', count: counts.live },
            { value: 'scheduled', label: 'Programmées', count: counts.scheduled },
            { value: 'paused', label: 'En pause', count: counts.paused },
            { value: 'ended', label: 'Terminées', count: counts.ended },
          ]}
        />
        {error ? (
          <Card>
            <EmptyState icon={<Ticket />} title="Impossible de charger vos offres" description={errorMessage(error)} />
          </Card>
        ) : (
          <DataTable
            data={rows}
            columns={columns}
            loading={loading}
            getRowId={(o) => o.id}
            onRowClick={(o) => setEditor({ open: true, offer: o })}
            searchPlaceholder="Rechercher un plat ou un titre…"
            itemLabel="offres"
            initialSorting={[]}
            emptyState={
              data.length === 0 ? (
                <EmptyState
                  icon={<Gift />}
                  title="Votre première offre commence ici"
                  description="Choisissez un plat, un type de remise et une période : l’offre s’applique automatiquement dans le panier du client."
                  action={createButton}
                />
              ) : (
                <EmptyState compact icon={<Ticket />} title="Aucune offre dans cette vue" description="Changez de filtre ou modifiez votre recherche." />
              )
            }
          />
        )}
      </div>

      <AnnonceForm open={editor.open} onOpenChange={(open) => setEditor((e) => ({ ...e, open }))} offer={editor.offer} />
      {actions.dialog}
    </PageContainer>
  );
}
