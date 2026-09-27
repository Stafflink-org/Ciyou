// Historique des mouvements de stock (tous les produits ou un seul).
import { ArrowDownRight, ArrowUpRight, History, ShoppingBag } from 'lucide-react';
import { STOCK_MOVEMENT_REASON_LABELS } from '@golink/shared';
import { Badge, cn, EmptyState, formatDateTime, Sheet, SheetBody, SheetContent, SheetHeader, Skeleton } from '@golink/ui';
import { errorMessage, toDate } from '@/lib/firestore';
import { useStockMovements, type MenuProduct } from './data';

export function StockHistorySheet({
  open,
  onOpenChange,
  restaurantId,
  product,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  restaurantId: string;
  product: MenuProduct | null;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-lg">
        <SheetHeader
          icon={<History />}
          title={product ? `Mouvements · ${product.name}` : 'Mouvements de stock'}
          description="Réceptions, pertes, inventaires, corrections et ventes : chaque variation est tracée."
        />
        <SheetBody className="px-4 sm:px-6">{open && <MovementList restaurantId={restaurantId} productId={product?.id ?? null} showProduct={!product} />}</SheetBody>
      </SheetContent>
    </Sheet>
  );
}

function MovementList({ restaurantId, productId, showProduct }: { restaurantId: string; productId: string | null; showProduct: boolean }) {
  const movements = useStockMovements(restaurantId, productId, 80);
  if (movements.loading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-14 rounded-xl" />
        ))}
      </div>
    );
  }
  if (movements.error) {
    return (
      <p role="alert" className="tone-danger rounded-lg bg-(--tone-bg) px-3 py-2 text-sm text-(--tone-fg)">
        {errorMessage(movements.error)}
      </p>
    );
  }
  if (movements.data.length === 0) {
    return <EmptyState compact icon={<History />} title="Aucun mouvement" description="Les ajustements et les ventes apparaîtront ici." />;
  }
  return (
    <ol className="relative space-y-1 before:absolute before:bottom-3 before:left-[17px] before:top-3 before:w-px before:bg-border">
      {movements.data.map((movement) => {
        const positive = movement.delta > 0;
        const Icon = movement.reason === 'order' ? ShoppingBag : positive ? ArrowUpRight : ArrowDownRight;
        const at = toDate(movement.createdAt);
        return (
          <li key={movement.id} className="relative flex items-start gap-3 rounded-xl px-1 py-2">
            <span
              className={cn(
                positive ? 'tone-success' : movement.delta < 0 ? 'tone-danger' : 'tone-neutral',
                'relative z-10 grid size-[34px] shrink-0 place-items-center rounded-full border border-(--tone-border) bg-surface text-(--tone-fg)',
              )}
            >
              <Icon className="size-4" aria-hidden="true" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-3">
                <p className="truncate text-sm font-medium text-fg">{showProduct ? movement.productName : STOCK_MOVEMENT_REASON_LABELS[movement.reason]}</p>
                <span className={cn('num shrink-0 font-mono text-sm font-medium', positive ? 'text-success' : movement.delta < 0 ? 'text-danger' : 'text-fg-muted')}>
                  {movement.delta > 0 ? '+' : movement.delta < 0 ? '−' : '±'}
                  {Math.abs(movement.delta)}
                </span>
              </div>
              <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-fg-subtle">
                {showProduct && <Badge size="sm">{STOCK_MOVEMENT_REASON_LABELS[movement.reason]}</Badge>}
                <span>Stock après : {movement.stockAfter}</span>
                {at && <span>· {formatDateTime(at)}</span>}
              </p>
              {movement.note && <p className="mt-1 text-xs text-fg-muted">« {movement.note} »</p>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
