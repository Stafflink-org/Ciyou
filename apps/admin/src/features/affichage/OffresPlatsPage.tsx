// Offres sur un plat créées par les commerces (« 1 acheté, 1 offert », « le 2e à -50 % ») : liste
// transverse (toutes les fiches restaurants/{rid}/productOffers, en collectionGroup) pour le super
// admin, avec désactivation motivée (§H1 du plan). Lecture au minimum : c'est ici l'essentiel.
import { useMemo, useState } from 'react';
import { collectionGroup, limit, orderBy, query } from 'firebase/firestore';
import { Gift, Percent, ShieldOff, ShoppingBag, Ticket } from 'lucide-react';
import { PRODUCT_OFFER_STATUSES, productOfferStatus, SUBCOLLECTIONS, type ProductOffer, type ProductOfferStatus, type WithId } from '@golink/shared';
import {
  Button,
  Card,
  DataTable,
  EmptyState,
  PageContainer,
  PageHeader,
  Select,
  StatCard,
  StatusBadge,
  createColumnHelper,
  formatEUR,
  formatNumber,
  toast,
} from '@golink/ui';
import { useDocumentTitle } from '@golink/web';
import { useAdminAccess } from '@/auth/AdminAccess';
import { errorMessage, useCollection, useMutation } from '@/lib/firestore';
import { db } from '@/lib/firebase';
import { callFunctionWithReasonIn } from '@/lib/reason';
import { AffichageNav } from './shared';

type OfferRow = WithId<ProductOffer>;

const column = createColumnHelper<OfferRow>();

const STATUS_META: Record<ProductOfferStatus, { label: string; tone: 'success' | 'teal' | 'amber' | 'neutral' | 'danger' }> = {
  live: { label: 'En ligne', tone: 'success' },
  scheduled: { label: 'Programmée', tone: 'teal' },
  paused: { label: 'En pause', tone: 'amber' },
  ended: { label: 'Terminée', tone: 'neutral' },
  disabled: { label: 'Désactivée', tone: 'danger' },
};

const disableProductOffer = callFunctionWithReasonIn<{ restaurantId: string; offerId: string; disabled: boolean }, { offerId: string; disabled: boolean }>(
  'disableProductOffer',
  'reason',
  { title: 'Désactiver cette offre ?', description: 'Le commerce ne pourra plus la modifier ni la relancer. Le motif est conservé dans le journal d’audit.', confirmLabel: 'Désactiver' },
);
const reenableProductOffer = callFunctionWithReasonIn<{ restaurantId: string; offerId: string; disabled: boolean }, { offerId: string; disabled: boolean }>(
  'disableProductOffer',
  'reason',
  { title: 'Réactiver cette offre ?', description: 'Le commerce pourra de nouveau la modifier et la mettre en pause ou la relancer.', confirmLabel: 'Réactiver' },
);

function useProductOffers() {
  const q = query(collectionGroup(db, SUBCOLLECTIONS.restaurants.productOffers), orderBy('createdAt', 'desc'), limit(500));
  return useCollection<ProductOffer>(q);
}

export function OffresPlatsPage() {
  useDocumentTitle('Offres sur les plats · Ciyou Eats Admin');
  const { admin, can } = useAdminAccess();
  const { data: allOffers, loading, error } = useProductOffers();
  const canModerate = can('display.edit');
  const [status, setStatus] = useState<'all' | ProductOfferStatus>('all');
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);

  // Périmètre géographique de l'admin (liste vide = toutes villes) — même règle que côté serveur.
  const scoped = useMemo(
    () => (admin.cityIds.length === 0 ? allOffers : allOffers.filter((o) => admin.cityIds.includes(o.cityId))),
    [allOffers, admin.cityIds],
  );
  const withStatus = useMemo(() => scoped.map((o) => ({ offer: o, status: productOfferStatus(o, today) })), [scoped, today]);
  const rows = useMemo(() => (status === 'all' ? withStatus : withStatus.filter((r) => r.status === status)).map((r) => r.offer), [withStatus, status]);

  const stats = useMemo(() => {
    const live = withStatus.filter((r) => r.status === 'live').length;
    const orders = scoped.reduce((s, o) => s + (o.ordersCount ?? 0), 0);
    const discount = scoped.reduce((s, o) => s + (o.discountTotalCents ?? 0), 0);
    return { live, orders, discount };
  }, [withStatus, scoped]);

  const toggle = useMutation(
    async (offer: OfferRow) => {
      const disable = productOfferStatus(offer, today) !== 'disabled';
      return disable ? disableProductOffer({ restaurantId: offer.restaurantId, offerId: offer.id, disabled: true }) : reenableProductOffer({ restaurantId: offer.restaurantId, offerId: offer.id, disabled: false });
    },
    { success: (r) => (r.disabled ? 'Offre désactivée.' : 'Offre réactivée.') },
  );

  const columns = useMemo(
    () => [
      column.accessor((o) => `${o.restaurantName} ${o.productName} ${o.title}`, {
        id: 'offre',
        header: 'Offre',
        cell: ({ row: { original: o } }) => (
          <div className="flex min-w-64 items-center gap-3">
            <span className="tone-brand grid size-9 shrink-0 place-items-center rounded-lg bg-(--tone-bg) text-(--tone-fg) [&_svg]:size-4">
              {o.kind === 'bogo' ? <Gift /> : <Percent />}
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-fg">{o.restaurantName}</p>
              <p className="truncate text-xs text-fg-muted">{o.productName} · {o.title}</p>
            </div>
          </div>
        ),
      }),
      column.accessor((o) => (o.kind === 'bogo' ? 'Offert' : '-50 % le 2ᵉ'), { id: 'type', header: 'Type' }),
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
      column.accessor((o) => productOfferStatus(o, today), {
        id: 'statut',
        header: 'Statut',
        cell: ({ getValue }) => <StatusBadge status={getValue()} map={STATUS_META} />,
      }),
      column.display({
        id: 'actions',
        header: () => <span className="sr-only">Actions</span>,
        meta: { align: 'right' },
        cell: ({ row: { original: o } }) =>
          canModerate ? (
            <div onClick={(e) => e.stopPropagation()}>
              <Button
                variant="ghost"
                size="sm"
                leftIcon={<ShieldOff />}
                loading={toggle.loading}
                onClick={() =>
                  void toggle.mutate(o).catch((caught: unknown) => {
                    if (String(caught).includes('ReasonCancelledError')) return;
                    toast.error(errorMessage(caught));
                  })
                }
              >
                {productOfferStatus(o, today) === 'disabled' ? 'Réactiver' : 'Désactiver'}
              </Button>
            </div>
          ) : null,
      }),
    ],
    [canModerate, today, toggle],
  );

  return (
    <PageContainer wide>
      <PageHeader
        eyebrow="Affichage app client"
        title="Offres sur les plats"
        description="« 1 acheté, 1 offert » et « le 2ᵉ à -50 % » créées par les commerces sur un plat précis, financées par eux. Désactivez en cas d’abus."
      />
      <AffichageNav />

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Offres en ligne" value={formatNumber(stats.live)} icon={<Ticket />} loading={loading} />
        <StatCard label="Commandes concernées" value={formatNumber(stats.orders)} icon={<ShoppingBag />} tone="info" loading={loading} />
        <StatCard label="Remises accordées (commerces)" value={formatEUR(stats.discount, { cents: true })} icon={<Gift />} tone="amber" loading={loading} />
      </div>

      <Card className="mt-6 p-4">
        <div className="flex flex-wrap items-center gap-3">
          <Select
            className="w-56"
            value={status}
            onValueChange={(v) => setStatus(v as typeof status)}
            options={[{ value: 'all', label: 'Tous les statuts' }, ...PRODUCT_OFFER_STATUSES.map((s) => ({ value: s, label: STATUS_META[s].label }))]}
          />
          {admin.cityIds.length > 0 && <p className="text-xs text-fg-subtle">Limité à votre périmètre de villes.</p>}
        </div>
      </Card>

      <div className="mt-4">
        {error ? (
          <Card>
            <EmptyState icon={<Ticket />} title="Impossible de charger les offres" description={errorMessage(error)} />
          </Card>
        ) : (
          <DataTable
            data={rows}
            columns={columns}
            loading={loading}
            getRowId={(o) => o.id}
            searchPlaceholder="Rechercher un commerce, un plat ou un titre…"
            itemLabel="offres"
            initialSorting={[]}
            emptyState={<EmptyState compact icon={<Gift />} title="Aucune offre" description="Aucun commerce n’a encore créé d’offre sur un plat dans ce périmètre." />}
          />
        )}
      </div>
    </PageContainer>
  );
}

