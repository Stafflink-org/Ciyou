import type { ReactNode } from 'react';
import { Command } from 'cmdk';
import { Dialog as DialogPrimitive } from 'radix-ui';
import { CornerDownLeft, Search } from 'lucide-react';
import { cn } from '../lib/cn';
import { Kbd } from './display';

export interface CommandItem {
  id: string;
  label: string;
  description?: string;
  icon?: ReactNode;
  shortcut?: string;
  keywords?: string[];
  onSelect: () => void;
}

export interface CommandGroup {
  heading: string;
  items: CommandItem[];
}

export interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  groups: CommandGroup[];
  placeholder?: string;
  /** Texte quand aucune entrée ne correspond. */
  emptyLabel?: string;
  /** Recherche contrôlée (pour interroger un index distant en plus des commandes). */
  search?: string;
  onSearchChange?: (value: string) => void;
  /** Résultats supplémentaires rendus sous les groupes (recherche globale). */
  children?: ReactNode;
  /**
   * Place `children` avant les groupes statiques (rubriques) : à activer dès
   * qu'une recherche est en cours, pour que les vrais résultats (commandes,
   * commerces, clients…) passent devant les rubriques qui matchent la même
   * saisie par simple filtrage de texte.
   */
  resultsFirst?: boolean;
}

/** Palette de commandes et recherche globale (navigation, actions rapides). */
export function CommandPalette({
  open,
  onOpenChange,
  groups,
  placeholder = 'Rechercher une page, un restaurant, une commande…',
  emptyLabel = 'Aucun résultat.',
  search,
  onSearchChange,
  children,
  resultsFirst = false,
}: CommandPaletteProps) {
  const staticGroups = (
    <>
      {groups.map((group) => (
        <Command.Group
          key={group.heading}
          heading={group.heading}
          className="[&_[cmdk-group-heading]]:eyebrow [&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:pb-1.5 [&_[cmdk-group-heading]]:pt-3"
        >
          {group.items.map((item) => (
            <Command.Item
              key={item.id}
              value={`${group.heading} ${item.label}`}
              keywords={item.keywords}
              onSelect={() => {
                item.onSelect();
                onOpenChange(false);
              }}
              className={cn(
                'group flex cursor-default items-center gap-3 rounded-lg px-2.5 py-2 text-sm outline-none',
                'data-[selected=true]:bg-surface-3',
              )}
            >
              {item.icon && (
                <span className="grid size-7 shrink-0 place-items-center rounded-md border border-border bg-surface text-fg-muted group-data-[selected=true]:text-primary [&_svg]:size-4">
                  {item.icon}
                </span>
              )}
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{item.label}</span>
                {item.description && <span className="block truncate text-xs text-fg-subtle">{item.description}</span>}
              </span>
              {item.shortcut ? (
                <Kbd>{item.shortcut}</Kbd>
              ) : (
                <CornerDownLeft className="size-3.5 text-fg-subtle opacity-0 group-data-[selected=true]:opacity-100" />
              )}
            </Command.Item>
          ))}
        </Command.Group>
      ))}
    </>
  );
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-overlay backdrop-blur-[2px] data-[state=open]:animate-fade-in data-[state=closed]:animate-fade-out" />
        <DialogPrimitive.Content
          className={cn(
            'fixed left-1/2 top-[12vh] z-50 w-[calc(100vw-1.5rem)] max-w-xl -translate-x-1/2 overflow-hidden',
            'rounded-2xl border border-border bg-elevated text-fg shadow-xl outline-none',
            'data-[state=open]:animate-dialog-in data-[state=closed]:animate-dialog-out',
          )}
        >
          <DialogPrimitive.Title className="sr-only">Recherche globale</DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">
            Tapez pour rechercher, flèches pour naviguer, Entrée pour ouvrir.
          </DialogPrimitive.Description>
          <Command loop className="flex flex-col">
            <div className="flex items-center gap-3 border-b border-border px-4">
              <Search className="size-[18px] shrink-0 text-fg-subtle" />
              <Command.Input
                value={search}
                onValueChange={onSearchChange}
                placeholder={placeholder}
                className="h-14 w-full bg-transparent text-md text-fg outline-none placeholder:text-fg-subtle"
              />
              <Kbd>Échap</Kbd>
            </div>
            <Command.List className="max-h-[min(60vh,420px)] overflow-y-auto overscroll-contain p-2">
              <Command.Empty className="px-4 py-10 text-center text-sm text-fg-subtle">{emptyLabel}</Command.Empty>
              {resultsFirst ? (
                <>
                  {children}
                  {staticGroups}
                </>
              ) : (
                <>
                  {staticGroups}
                  {children}
                </>
              )}
            </Command.List>
            <div className="flex items-center gap-4 border-t border-border bg-surface-2 px-4 py-2.5 text-2xs text-fg-subtle">
              <span className="flex items-center gap-1.5">
                <Kbd>↑</Kbd>
                <Kbd>↓</Kbd> naviguer
              </span>
              <span className="flex items-center gap-1.5">
                <Kbd>↵</Kbd> ouvrir
              </span>
            </div>
          </Command>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
