// Section « Visibilité » de la fiche produit (§B6) : offres automatiques (§annonces) portant sur ce plat.
import { Link } from 'react-router';
import { Gift, Plus } from 'lucide-react';
import { Badge, Button, Skeleton, StatusBadge } from '@golink/ui';
import { KIND_LABELS, STATUS_META, periodLabel, productOfferStatus, today, useOffersForProduct } from './lib';

export function ProductOffersPanel({ restaurantId, productId }: { restaurantId: string; productId: string }) {
  const { data, loading } = useOffersForProduct(restaurantId, productId);

  if (loading) return <Skeleton className="h-16 rounded-lg" />;

  if (data.length === 0) {
    return (
      <div className="flex flex-col items-start gap-3 rounded-xl border border-dashed border-border-strong px-4 py-5 text-sm text-fg-muted">
        <p>Aucune offre automatique sur ce plat pour l’instant (« 1 acheté, 1 offert », « le 2ᵉ à -50 % »).</p>
        <Button asChild variant="secondary" size="sm" leftIcon={<Plus />}>
          <Link to="/annonces">Créer une offre</Link>
        </Button>
      </div>
    );
  }

  return (
    <ul className="divide-y divide-border rounded-xl border border-border">
      {data.map((offer) => {
        const status = productOfferStatus(offer, today());
        return (
          <li key={offer.id} className="flex flex-wrap items-center justify-between gap-2 px-3.5 py-3">
            <div className="min-w-0">
              <p className="flex items-center gap-2 text-sm font-medium text-fg">
                <Gift className="size-3.5 text-fg-subtle" aria-hidden="true" />
                {offer.title}
              </p>
              <p className="mt-0.5 text-xs text-fg-subtle">
                {KIND_LABELS[offer.kind]} · {periodLabel(offer)}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {offer.disabledByPlatform && (
                <Badge tone="danger" size="sm">
                  Désactivée par Ciyou Eats
                </Badge>
              )}
              <StatusBadge status={status} map={STATUS_META} />
            </div>
          </li>
        );
      })}
      <li className="px-3.5 py-2.5">
        <Button asChild variant="ghost" size="sm" leftIcon={<Plus />}>
          <Link to="/annonces">Gérer les offres</Link>
        </Button>
      </li>
    </ul>
  );
}
