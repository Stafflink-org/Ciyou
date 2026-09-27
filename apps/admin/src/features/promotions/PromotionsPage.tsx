import { useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { BadgeEuro, CheckCircle2, Gift, Plus, ShoppingBag, TicketPercent, Users } from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  DataTable,
  EmptyState,
  PageContainer,
  PageHeader,
  SegmentedControl,
  Sheet,
  StatCard,
  StatusPill,
  createColumnHelper,
  formatEUR,
  formatNumber,
} from '@golink/ui';
import { PROMOTION_FUNDING_LABELS, PROMOTION_KIND_LABELS, PROMOTION_STATUS_LABELS } from '@golink/shared';
import { useDocumentTitle } from '@golink/web';
import { useAdminAccess } from '@/auth/AdminAccess';
import { useGeoScope } from '@/layout/GeoScope';
import { useGeoNames, useNow, useRestaurantOptions } from '../_croissance/hooks';
import { PROMOTION_STATUS_TONES, SCOPE_LABELS, TARGET_LABELS, promotionValueLabel } from '../_croissance/labels';
import { LoadError, RouteTabs } from '../_croissance/ui';
import { PromotionFormSheet } from './PromotionForm';
import { isLive, periodLabel, promotionCost, timingHint, usePromotionCovers, usePromotions, type PromotionRow } from './lib';

/** En-tête commun de la rubrique Promotions. */
export function PromotionsLayout({ actions, children, pending }: { actions?: ReactNode; children: ReactNode; pending?: number }) {
  const geo = useGeoScope();
  return (
    <PageContainer wide>
      <PageHeader
        eyebrow={`Croissance · ${geo.label}`}
        title="Promotions"
        description="Offres GoLink et des restaurants : portée, conditions, financement, ciblage et résultats."
        actions={actions}
      >
        <RouteTabs
          tabs={[
            { to: '/promotions', label: 'Offres', end: true, count: pending },
            { to: '/promotions/regles', label: 'Règles des restaurants' },
          ]}
        />
      </PageHeader>
      {children}
    </PageContainer>
  );
}

type View = 'all' | 'live' | 'review' | 'platform' | 'restaurant' | 'closed';

const col = createColumnHelper<PromotionRow>();

export function PromotionsPage() {
  useDocumentTitle('Promotions · GoLink Admin');
  const navigate = useNavigate();
  const { can } = useAdminAccess();
  const canEdit = can('promotions.edit');
  const now = useNow();
  const names = useGeoNames();
  const restaurants = useRestaurantOptions();
  const { data, loading, error } = usePromotions();
  const covers = usePromotionCovers();
  const [view, setView] = useState<View>('all');
  const [creating, setCreating] = useState(false);

  const scoped = useMemo(() => data.filter(covers), [data, covers]);
  const pending = scoped.filter((p) => p.status === 'pending_review');
  const rows = useMemo(() => {
    switch (view) {
      case 'live':
        return scoped.filter((p) => p.status === 'active');
      case 'review':
        return scoped.filter((p) => p.status === 'pending_review');
      case 'platform':
        return scoped.filter((p) => p.scope !== 'restaurant');
      case 'restaurant':
        return scoped.filter((p) => p.scope === 'restaurant');
      case 'closed':
        return scoped.filter((p) => p.status === 'ended' || p.status === 'rejected');
      default:
        return scoped;
    }
  }, [scoped, view]);

  const kpis = useMemo(() => {
    let live = 0;
    let redemptions = 0;
    let platformCost = 0;
    let restaurantCost = 0;
    let revenue = 0;
    let newCustomers = 0;
    for (const p of scoped) {
      if (isLive(p, now)) live += 1;
      redemptions += p.stats?.redemptions ?? 0;
      const cost = promotionCost(p);
      platformCost += cost.platform;
      restaurantCost += cost.restaurant;
      revenue += p.stats?.ordersSubtotalCents ?? 0;
      newCustomers += p.stats?.newCustomers ?? 0;
    }
    return { live, redemptions, platformCost, restaurantCost, revenue, newCustomers };
  }, [scoped, now]);

  const columns = useMemo(
    () => [
      col.accessor((p) => `${p.title.fr} ${p.code ?? ''}`, {
        id: 'offre',
        header: 'Offre',
        cell: ({ row }) => {
          const p = row.original;
          const hint = timingHint(p, now);
          return (
            <div className="min-w-[14rem] max-w-[22rem]">
              <p className="truncate font-medium text-fg">{p.title.fr}</p>
              <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-fg-muted">
                {p.code ? <span className="rounded bg-surface-3 px-1.5 py-px font-mono text-2xs text-fg">{p.code}</span> : <span>Automatique</span>}
                <span>· {periodLabel(p)}</span>
                {hint && <span className="text-(--tone-fg) tone-amber">· {hint}</span>}
              </p>
            </div>
          );
        },
      }),
      col.accessor((p) => (p.scope === 'restaurant' ? (restaurants.byId.get(p.restaurantId ?? '')?.name ?? 'Restaurant') : SCOPE_LABELS[p.scope]), {
        id: 'portee',
        header: 'Portée',
        cell: ({ row, getValue }) => {
          const p = row.original;
          const detail =
            p.scope === 'country' ? names.country(p.countryId) : p.scope === 'city' || p.scope === 'restaurant' ? (p.cityIds ?? []).map((c) => names.city(c)).join(', ') : 'Tous les marchés';
          return (
            <div className="min-w-[9rem]">
              <p className="truncate text-sm text-fg">{getValue()}</p>
              <p className="truncate text-xs text-fg-muted">{detail}</p>
            </div>
          );
        },
      }),
      col.accessor((p) => promotionValueLabel(p), {
        id: 'remise',
        header: 'Remise',
        cell: ({ row, getValue }) => (
          <div className="whitespace-nowrap">
            <p className="font-medium text-fg">{getValue()}</p>
            <p className="text-xs text-fg-muted">{TARGET_LABELS[row.original.target]}</p>
          </div>
        ),
      }),
      col.accessor((p) => PROMOTION_FUNDING_LABELS[p.funding], {
        id: 'financement',
        header: 'Financement',
        cell: ({ row, getValue }) => (
          <Badge tone={row.original.funding === 'platform' ? 'brand' : row.original.funding === 'restaurant' ? 'teal' : 'plum'}>
            {getValue()}
            {row.original.funding === 'shared' && row.original.restaurantShareBps ? ` ${100 - row.original.restaurantShareBps / 100}/${row.original.restaurantShareBps / 100}` : ''}
          </Badge>
        ),
      }),
      col.accessor((p) => p.stats?.redemptions ?? 0, {
        id: 'utilisations',
        header: 'Utilisations',
        meta: { align: 'right' },
        cell: ({ row, getValue }) => (
          <span className="num font-mono text-sm">
            {formatNumber(getValue())}
            {row.original.totalUsageLimit ? <span className="text-fg-subtle"> / {formatNumber(row.original.totalUsageLimit)}</span> : null}
          </span>
        ),
      }),
      col.accessor((p) => promotionCost(p).total, {
        id: 'cout',
        header: 'Coût',
        meta: { align: 'right' },
        cell: ({ row, getValue }) => {
          const c = promotionCost(row.original);
          return (
            <div className="whitespace-nowrap text-right">
              <p className="num font-mono text-sm text-fg">{formatEUR(getValue(), { cents: true })}</p>
              {c.platform > 0 && <p className="num text-2xs text-fg-muted">GoLink {formatEUR(c.platform, { cents: true })}</p>}
            </div>
          );
        },
      }),
      col.accessor((p) => PROMOTION_STATUS_LABELS[p.status], {
        id: 'statut',
        header: 'Statut',
        cell: ({ row, getValue }) => <StatusPill tone={PROMOTION_STATUS_TONES[row.original.status]}>{getValue()}</StatusPill>,
      }),
    ],
    [now, names, restaurants.byId],
  );

  const views = [
    { value: 'all', label: 'Toutes', count: scoped.length },
    { value: 'live', label: 'Actives' },
    { value: 'review', label: 'À valider', count: pending.length || undefined },
    { value: 'platform', label: 'GoLink' },
    { value: 'restaurant', label: 'Restaurants' },
    { value: 'closed', label: 'Terminées' },
  ];

  return (
    <PromotionsLayout
      pending={pending.length}
      actions={
        canEdit ? (
          <Button variant="primary" leftIcon={<Plus />} onClick={() => setCreating(true)}>
            Nouvelle offre
          </Button>
        ) : undefined
      }
    >
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Offres en ligne" value={formatNumber(kpis.live)} icon={<TicketPercent />} tone="brand" loading={loading} footer={`${pending.length} en attente de validation`} />
        <StatCard label="Utilisations" value={formatNumber(kpis.redemptions)} icon={<ShoppingBag />} tone="info" loading={loading} footer={`${formatNumber(kpis.newCustomers)} nouveaux clients recrutés`} />
        <StatCard
          label="Coût des remises pour GoLink"
          value={formatEUR(kpis.platformCost, { cents: true })}
          icon={<BadgeEuro />}
          tone="amber"
          loading={loading}
          footer={`${formatEUR(kpis.restaurantCost, { cents: true })} financés par les restaurants`}
        />
        <StatCard
          label="Ventes générées"
          value={formatEUR(kpis.revenue, { cents: true, compact: kpis.revenue > 10_000_000 })}
          icon={<Users />}
          tone="success"
          loading={loading}
          footer={kpis.platformCost + kpis.restaurantCost > 0 ? `${(kpis.revenue / (kpis.platformCost + kpis.restaurantCost)).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} € de ventes par euro de remise` : 'Aucune remise accordée'}
        />
      </div>

      {pending.length > 0 && canEdit && view !== 'review' && (
        <Card className="tone-amber mt-6 flex flex-col gap-3 border-(--tone-border) bg-(--tone-bg) p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-(--tone-fg)" />
            <div>
              <p className="font-medium text-fg">
                {pending.length} offre{pending.length > 1 ? 's' : ''} de restaurant{pending.length > 1 ? 's' : ''} à valider
              </p>
              <p className="text-sm text-fg-muted">Elles restent invisibles des clients tant qu’elles ne sont pas validées.</p>
            </div>
          </div>
          <Button size="sm" onClick={() => setView('review')}>
            Voir la file
          </Button>
        </Card>
      )}

      <div className="mt-6 space-y-4">
        <div data-scroll-ok className="-mx-4 overflow-x-auto px-4 [scrollbar-width:none] sm:mx-0 sm:px-0">
          <SegmentedControl aria-label="Filtrer les offres" value={view} onValueChange={(v) => setView(v as View)} options={views} size="sm" className="min-w-max" />
        </div>
        {error ? (
          <Card>
            <LoadError error={error} />
          </Card>
        ) : (
          <DataTable
            data={rows}
            columns={columns}
            getRowId={(p) => p.id}
            loading={loading}
            searchable
            searchPlaceholder="Rechercher une offre ou un code…"
            itemLabel="offres"
            onRowClick={(p) => void navigate(`/promotions/${p.id}`)}
            initialSorting={[{ id: 'utilisations', desc: true }]}
            filters={[
              { id: 'kind', label: 'Type', options: Object.entries(PROMOTION_KIND_LABELS).map(([value, label]) => ({ value, label })), getValue: (p) => p.kind },
              { id: 'funding', label: 'Financement', options: Object.entries(PROMOTION_FUNDING_LABELS).map(([value, label]) => ({ value, label })), getValue: (p) => p.funding },
              { id: 'target', label: 'Cible', options: Object.entries(TARGET_LABELS).map(([value, label]) => ({ value, label })), getValue: (p) => p.target },
            ]}
            emptyState={
              <EmptyState
                compact
                icon={<Gift />}
                title={view === 'review' ? 'Aucune offre à valider' : 'Aucune offre'}
                description={view === 'review' ? 'Les offres soumises par les restaurants apparaîtront ici.' : 'Créez une offre pour attirer de nouveaux clients ou faire revenir les inactifs.'}
                action={
                  canEdit && view !== 'review' ? (
                    <Button size="sm" variant="primary" leftIcon={<Plus />} onClick={() => setCreating(true)}>
                      Nouvelle offre
                    </Button>
                  ) : undefined
                }
              />
            }
          />
        )}
      </div>

      <Sheet open={creating} onOpenChange={setCreating}>
        {creating && <PromotionFormSheet onDone={() => setCreating(false)} />}
      </Sheet>
    </PromotionsLayout>
  );
}
