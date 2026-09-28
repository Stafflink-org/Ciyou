import { Clock, Star } from 'lucide-react';
import { Badge, Card, cn } from '@golink/ui';
import { RESTAURANT_LABELS, type RestaurantLabelKey } from '@golink/shared';

/** Aperçu de la carte de l'établissement telle qu'elle apparaît dans l'app client. */
export function RestaurantPreview({
  name,
  description,
  cuisines,
  priceLevel,
  labels,
  logo,
  cover,
  mark,
  accent,
  rating,
  eta,
  className,
}: {
  name: string;
  description: string;
  cuisines: string[];
  priceLevel: number;
  labels: string[];
  logo: string | null;
  cover: string | null;
  mark: string;
  accent: string;
  rating: { average: number; count: number };
  eta: { min: number; max: number };
  className?: string;
}) {
  return (
    <Card className={cn('overflow-hidden', className)}>
      <div className="relative aspect-[16/9] bg-surface-3">
        {cover ? (
          <img src={cover} alt="" className="size-full object-cover" />
        ) : (
          <div className="grid size-full place-items-center text-xs text-fg-subtle">Photo de couverture</div>
        )}
        <div className="absolute -bottom-6 left-4 grid size-14 place-items-center overflow-hidden rounded-xl border-[3px] border-surface bg-surface shadow-md">
          {logo ? (
            <img src={logo} alt="" className="size-full object-cover" />
          ) : (
            <span className="grid size-full place-items-center font-display text-lg font-semibold text-white" style={{ backgroundColor: accent }}>
              {mark}
            </span>
          )}
        </div>
      </div>
      <div className="px-4 pb-4 pt-8">
        <div className="flex items-start justify-between gap-3">
          <p className="min-w-0 truncate font-display text-lg font-semibold tracking-tight text-fg">{name || 'Nom de l’établissement'}</p>
          {rating.count > 0 && (
            <span className="inline-flex shrink-0 items-center gap-1 text-sm font-medium text-fg">
              <Star className="size-3.5 fill-current text-amber-500" />
              {rating.average.toLocaleString('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}
            </span>
          )}
        </div>
        <p className="mt-0.5 truncate text-sm text-fg-muted">
          {[cuisines.join(' · ') || 'Cuisine', '€'.repeat(priceLevel)].join(' · ')}
        </p>
        <p className="mt-1 inline-flex items-center gap-1 text-xs text-fg-subtle">
          <Clock className="size-3" />
          {eta.min}–{eta.max} min
        </p>
        {description && <p className="mt-3 line-clamp-3 text-sm leading-5 text-fg-muted">{description}</p>}
        {labels.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {labels.map((key) => (
              <Badge key={key} tone="success" size="sm">
                {RESTAURANT_LABELS[key as RestaurantLabelKey] ?? key}
              </Badge>
            ))}
          </div>
        )}
      </div>
    </Card>
  );
}
