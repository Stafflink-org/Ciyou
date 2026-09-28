import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { BadgePercent, Euro, MoreHorizontal, Plus, ShieldCheck, ShoppingBag, Tag, Ticket, Truck, Zap } from 'lucide-react';
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
  formatDate,
  formatEUR,
  formatNumber,
  toast,
} from '@golink/ui';
import { errorMessage, toDate } from '@/lib/firestore';
import { PromotionMenuItems, usePromotionActions } from './actions';
import {
  DISPLAY_STATUS,
  TARGET_LABELS,
  conditionsLabel,
  discountLabel,
  displayStatus,
  modesLabel,
  promotionRulesText,
  usePromotionSettings,
  useRestaurantPromotions,
  type PromotionRow,
} from './lib';
import { PromotionForm } from './PromotionForm';

const column = createColumnHelper<PromotionRow>();

type Filter = 'all' | 'live' | 'review' | 'draft' | 'past';

const FILTERS: Record<Filter, (p: PromotionRow) => boolean> = {
  all: () => true,
  live: (p) => ['active', 'scheduled', 'paused'].includes(displayStatus(p)),
  review: (p) => p.status === 'pending_review' || p.status === 'rejected',
  draft: (p) => p.status === 'draft',
  past: (p) => ['ended', 'expired'].includes(displayStatus(p)),
};

function KindIcon({ promotion }: { promotion: PromotionRow }) {
  const icon = promotion.kind === 'free_delivery' ? <Truck /> : promotion.kind === 'percentage' ? <BadgePercent /> : <Tag />;
  return <span className="tone-brand grid size-9 shrink-0 place-items-center rounded-lg bg-(--tone-bg) text-(--tone-fg) [&_svg]:size-4">{icon}</span>;
}

function period(p: PromotionRow): string {
  const start = toDate(p.startsAt);
  const end = toDate(p.endsAt);
  if (!start) return '—';
  return end ? `${formatDate(start)} → ${formatDate(end)}` : `Depuis le ${formatDate(start)}`;
}

export function PromotionsPage() {
  const navigate = useNavigate();
  const { data, loading, error } = useRestaurantPromotions();
  const limits = usePromotionSettings();
  const actions = usePromotionActions();
  const [filter, setFilter] = useState<Filter>('all');
  const [editor, setEditor] = useState<{ promotion: PromotionRow | null; template: PromotionRow | null } | null>(null);
  const submitLabel = limits.restaurantRequiresReview ? 'Soumettre à GoLink' : 'Mettre en ligne';

  const stats = useMemo(() => {
    const live = data.filter((p) => p.status === 'active' || p.status === 'pending_review').length;
    const redemptions = data.reduce((s, p) => s + p.stats.redemptions, 0);
    const discount = data.reduce((s, p) => s + p.stats.discountCents, 0);
    const revenue = data.reduce((s, p) => s + p.stats.ordersSubtotalCents, 0);
    const newCustomers = data.reduce((s, p) => s + p.stats.newCustomers, 0);
    return { live, redemptions, discount, revenue, newCustomers };
  }, [data]);

  const counts = useMemo(
    () => Object.fromEntries((Object.keys(FILTERS) as Filter[]).map((f) => [f, data.filter(FILTERS[f]).length])) as Record<Filter, number>,
    [data],
  );
  const rows = useMemo(() => data.filter(FILTERS[filter]), [data, filter]);

  const columns = useMemo(
    () => [
      column.accessor((p) => `${p.code ?? ''} ${p.title.fr}`, {
        id: 'offre',
        header: 'Offre',
        cell: ({ row: { original: p } }) => (
          <div className="flex min-w-56 items-center gap-3">
            <KindIcon promotion={p} />
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                {p.code ? (
                  <span className="font-mono text-sm font-semibold tracking-wide text-fg">{p.code}</span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-sm font-semibold text-fg">
                    <Zap className="size-3.5 text-primary" /> Automatique
                  </span>
                )}
              </div>
              <p className="truncate text-xs text-fg-muted">{p.title.fr}</p>
            </div>
          </div>
        ),
      }),
      column.accessor((p) => p.value, {
        id: 'remise',
        header: 'Remise',
        cell: ({ row: { original: p } }) => (
          <div className="min-w-36">
            <p className="whitespace-nowrap font-medium text-fg">{discountLabel(p)}</p>
            <p className="text-xs text-fg-subtle">{conditionsLabel(p)}</p>
          </div>
        ),
      }),
      column.accessor((p) => TARGET_LABELS[p.target], {
        id: 'cible',
        header: 'Pour qui',
        cell: ({ row: { original: p } }) => (
          <div className="whitespace-nowrap">
            <p className="text-sm text-fg">{TARGET_LABELS[p.target]}</p>
            <p className="text-xs text-fg-subtle">{modesLabel(p.modes)}</p>
          </div>
        ),
      }),
      column.accessor((p) => toDate(p.startsAt)?.getTime() ?? 0, {
        id: 'periode',
        header: 'Période',
        cell: ({ row: { original: p } }) => <span className="whitespace-nowrap text-sm text-fg-muted">{period(p)}</span>,
      }),
      column.accessor((p) => p.stats.redemptions, {
        id: 'utilisations',
        header: 'Utilisations',
        meta: { align: 'right' },
        cell: ({ row: { original: p } }) => (
          <div className="text-right">
            <p className="font-mono text-sm text-fg num">{formatNumber(p.stats.redemptions)}</p>
            <p className="font-mono text-2xs text-fg-subtle num">{p.stats.discountCents > 0 ? `−${formatEUR(p.stats.discountCents, { cents: true })}` : '—'}</p>
          </div>
        ),
      }),
      column.accessor((p) => displayStatus(p), {
        id: 'statut',
        header: 'Statut',
        cell: ({ getValue }) => <StatusBadge status={getValue()} map={DISPLAY_STATUS} />,
      }),
      column.display({
        id: 'actions',
        header: () => <span className="sr-only">Actions</span>,
        meta: { align: 'right', className: 'w-12' },
        cell: ({ row: { original: p } }) => (
          <div onClick={(e) => e.stopPropagation()}>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <IconButton label={`Actions pour ${p.code ?? p.title.fr}`} size="sm">
                  <MoreHorizontal />
                </IconButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <PromotionMenuItems
                  promotion={p}
                  submitLabel={submitLabel}
                  onEdit={() => setEditor({ promotion: p, template: null })}
                  onDuplicate={() => setEditor({ promotion: null, template: p })}
                  onAction={(action) => actions.trigger(action, [p])}
                />
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ),
      }),
    ],
    [actions, submitLabel],
  );

  const createButton = (
    <Button variant="primary" leftIcon={<Plus />} onClick={() => setEditor({ promotion: null, template: null })}>
      Nouvelle offre
    </Button>
  );

  return (
    <PageContainer>
      <PageHeader
        eyebrow="Marketing"
        title="Codes promo et offres"
        description="Des remises bien pensées pour attirer de nouveaux clients et faire revenir les habitués, dans les règles fixées par GoLink."
        actions={createButton}
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Offres en ligne"
          value={limits.capsEnabled ? `${stats.live} / ${limits.maxActivePerRestaurant}` : formatNumber(stats.live)}
          icon={<Ticket />}
          loading={loading}
          footer="Offres actives ou en validation."
        />
        <StatCard label="Utilisations" value={formatNumber(stats.redemptions)} icon={<ShoppingBag />} tone="info" loading={loading} footer="Commandes avec une de vos offres." />
        <StatCard label="Remises accordées" value={formatEUR(stats.discount, { cents: true })} icon={<Euro />} tone="amber" loading={loading} footer="Coût total, déduit de vos reversements." />
        <StatCard
          label="Ventes générées"
          value={formatEUR(stats.revenue, { cents: true, compact: stats.revenue > 1_000_000 })}
          icon={<BadgePercent />}
          tone="success"
          loading={loading}
          footer={stats.discount > 0 ? `${formatNumber(stats.revenue / stats.discount, { decimals: true })} € de ventes pour 1 € de remise · ${formatNumber(stats.newCustomers)} nouveaux clients` : 'Montant des articles commandés avec une offre.'}
        />
      </div>

      <Card className="mt-6 flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
        <span className="tone-teal grid size-9 shrink-0 place-items-center rounded-lg bg-(--tone-bg) text-(--tone-fg)">
          <ShieldCheck className="size-4" />
        </span>
        <p className="text-sm text-fg-muted">
          <span className="font-medium text-fg">Règles GoLink pour vos offres :</span> {promotionRulesText(limits).charAt(0).toLowerCase()}
          {promotionRulesText(limits).slice(1)}
        </p>
      </Card>

      <div className="mt-6 space-y-4">
        <SegmentedControl
          aria-label="Filtrer les offres"
          value={filter}
          onValueChange={(v) => setFilter(v as Filter)}
          options={[
            { value: 'all', label: 'Toutes', count: counts.all },
            { value: 'live', label: 'En cours', count: counts.live },
            { value: 'review', label: 'Validation', count: counts.review },
            { value: 'draft', label: 'Brouillons', count: counts.draft },
            { value: 'past', label: 'Terminées', count: counts.past },
          ]}
        />
        {error ? (
          <Card>
            <EmptyState icon={<Tag />} title="Impossible de charger vos offres" description={errorMessage(error)} />
          </Card>
        ) : (
          <DataTable
            data={rows}
            columns={columns}
            loading={loading}
            getRowId={(p) => p.id}
            onRowClick={(p) => navigate(`/promotions/${p.id}`)}
            searchPlaceholder="Rechercher un code ou un titre…"
            itemLabel="offres"
            initialSorting={[]}
            bulkActions={[
              {
                label: 'Mettre en pause',
                onClick: (selected, clear) => {
                  const eligible = selected.filter((p) => p.status === 'active');
                  if (eligible.length === 0) return void toast.info('Aucune offre en ligne dans la sélection.');
                  actions.trigger('pause', eligible);
                  clear();
                },
              },
              {
                label: 'Terminer',
                destructive: true,
                onClick: (selected, clear) => {
                  const eligible = selected.filter((p) => ['active', 'paused', 'pending_review'].includes(p.status));
                  if (eligible.length === 0) return void toast.info('Aucune offre en cours dans la sélection.');
                  actions.trigger('end', eligible);
                  clear();
                },
              },
            ]}
            emptyState={
              data.length === 0 ? (
                <EmptyState
                  icon={<Ticket />}
                  title="Votre première offre commence ici"
                  description="Créez un code à partager ou une offre automatique, puis choisissez précisément à qui et quand elle s’applique."
                  action={createButton}
                />
              ) : (
                <EmptyState compact icon={<Tag />} title="Aucune offre dans cette vue" description="Changez de filtre ou modifiez votre recherche." />
              )
            }
          />
        )}
      </div>

      <PromotionForm
        open={editor !== null}
        onOpenChange={(open) => !open && setEditor(null)}
        promotion={editor?.promotion ?? null}
        template={editor?.template ?? null}
      />
      {actions.dialog}
    </PageContainer>
  );
}
