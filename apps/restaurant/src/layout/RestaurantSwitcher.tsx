import { useState } from 'react';
import { Check, ChevronsUpDown, Search } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger, cn } from '@golink/ui';
import { STAFF_ROLE_LABELS, type Restaurant, type WithId } from '@golink/shared';
import { useRestaurantAccess } from '@/auth/RestaurantAccess';

/** Logo de l'établissement, ou monogramme sur sa couleur de marque. */
export function RestaurantMark({ restaurant, size = 36, className }: { restaurant: Restaurant; size?: number; className?: string }) {
  const logo = restaurant.logo?.thumbUrl ?? restaurant.logo?.url;
  return (
    <span
      className={cn(
        'grid shrink-0 place-items-center overflow-hidden rounded-[10px] font-display font-semibold text-white shadow-[inset_0_0_0_1px_rgb(255_255_255/0.14)]',
        className,
      )}
      // Couleur de marque saisie par le restaurant (donnée, pas un jeton de thème).
      style={{ width: size, height: size, fontSize: Math.round(size * 0.4), backgroundColor: logo ? undefined : restaurant.accent }}
    >
      {logo ? <img src={logo} alt="" className="size-full object-cover" /> : (restaurant.mark || restaurant.name.slice(0, 1)).slice(0, 2)}
    </span>
  );
}

function matches(restaurant: WithId<Restaurant>, needle: string): boolean {
  const haystack = `${restaurant.name} ${restaurant.address.city}`.toLocaleLowerCase('fr');
  return haystack.includes(needle);
}

/** Sélecteur d'établissement, en tête de sidebar. */
export function RestaurantSwitcher() {
  const { restaurants, restaurant, roles, setRestaurantId } = useRestaurantAccess();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const multiple = restaurants.length > 1;
  const needle = query.trim().toLocaleLowerCase('fr');
  const shown = needle ? restaurants.filter((item) => matches(item, needle)) : restaurants;
  const role = roles[restaurant.id];

  const trigger = (
    <button
      type="button"
      disabled={!multiple}
      className={cn(
        'group flex w-full items-center gap-3 rounded-xl border border-sidebar-border bg-white/[0.035] p-2 text-left transition-colors',
        multiple && 'hover:border-white/15 hover:bg-sidebar-hover',
        'disabled:cursor-default',
      )}
    >
      <RestaurantMark restaurant={restaurant} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-sidebar-fg">{restaurant.name}</span>
        <span className="block truncate text-2xs text-sidebar-muted">
          {restaurant.address.city}
          {role ? ` · ${STAFF_ROLE_LABELS[role]}` : ''}
        </span>
      </span>
      {multiple && <ChevronsUpDown className="size-4 shrink-0 text-sidebar-muted transition-colors group-hover:text-sidebar-fg" />}
    </button>
  );

  if (!multiple) return trigger;

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setQuery('');
      }}
    >
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent align="start" sideOffset={8} className="w-[min(300px,calc(100vw-2rem))] p-0">
        <div className="border-b border-border px-3 py-2.5">
          <p className="eyebrow">Vos établissements · {restaurants.length}</p>
        </div>
        {restaurants.length > 5 && (
          <label className="flex items-center gap-2 border-b border-border px-3">
            <Search className="size-4 text-fg-subtle" />
            <input
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Rechercher un établissement"
              aria-label="Rechercher un établissement"
              className="h-10 w-full bg-transparent text-sm outline-none placeholder:text-fg-subtle"
            />
          </label>
        )}
        <ul className="max-h-80 overflow-y-auto p-1.5">
          {shown.map((item) => {
            const active = item.id === restaurant.id;
            const itemRole = roles[item.id];
            return (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => {
                    setRestaurantId(item.id);
                    setOpen(false);
                  }}
                  className={cn(
                    'flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors hover:bg-surface-3',
                    active && 'bg-surface-2',
                  )}
                >
                  <RestaurantMark restaurant={item} size={32} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-fg">{item.name}</span>
                    <span className="block truncate text-xs text-fg-subtle">
                      {item.address.city}
                      {itemRole ? ` · ${STAFF_ROLE_LABELS[itemRole]}` : ''}
                    </span>
                  </span>
                  {active && <Check className="size-4 shrink-0 text-primary" />}
                </button>
              </li>
            );
          })}
          {shown.length === 0 && <li className="px-3 py-6 text-center text-sm text-fg-subtle">Aucun établissement.</li>}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
