// Vignette d'un commerce : logo (ou monogramme sur sa couleur), nom, ville et type.
import { Star } from 'lucide-react';
import { cn } from '@golink/ui';
import { MERCHANT_TYPE_LABELS, type Restaurant } from '@golink/shared';

export function RestaurantMark({ restaurant, size = 36, className }: { restaurant: Pick<Restaurant, 'name' | 'logo' | 'accent' | 'mark'>; size?: number; className?: string }) {
  const logo = restaurant.logo?.url;
  return (
    <span
      className={cn('grid shrink-0 place-items-center overflow-hidden rounded-lg border border-border font-display font-semibold text-white', className)}
      style={{ width: size, height: size, background: logo ? undefined : restaurant.accent || 'var(--color-petrol-900)', fontSize: Math.round(size * 0.36) }}
      aria-hidden="true"
    >
      {logo ? <img src={logo} alt="" className="size-full object-cover" loading="lazy" /> : restaurant.mark || restaurant.name.slice(0, 2).toUpperCase()}
    </span>
  );
}

export function RestaurantIdentity({ restaurant, cityName, compact }: { restaurant: Restaurant; cityName?: string; compact?: boolean }) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <RestaurantMark restaurant={restaurant} size={compact ? 32 : 36} />
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-fg">{restaurant.name}</p>
        <p className="truncate text-xs text-fg-subtle">
          {cityName ?? restaurant.address?.city} · {MERCHANT_TYPE_LABELS[restaurant.merchantType ?? 'restaurant']}
        </p>
      </div>
    </div>
  );
}

export function RatingInline({ average, count }: { average: number; count: number }) {
  if (!count) return <span className="text-xs text-fg-subtle">Aucun avis</span>;
  return (
    <span className="inline-flex max-w-full items-center gap-1 text-sm num">
      <Star className="size-3.5 fill-current text-amber-500" aria-hidden="true" />
      <span className="font-medium text-fg">{average.toLocaleString('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}</span>
      <span className="truncate text-xs text-fg-subtle">({count})</span>
    </span>
  );
}
