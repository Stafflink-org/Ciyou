// Bloc d'une section de la carte : en-tête (poignée, visuel, nom, état, actions)
// et liste de ses produits, réordonnables par glisser-déposer.
import { useCallback, useId, useState } from 'react';
import { useNavigate } from 'react-router';
import { ArrowDown, ArrowUp, ChevronDown, Clock, Copy, CopyPlus, EyeOff, MoreHorizontal, Pencil, Plus, Trash2 } from 'lucide-react';
import {
  Badge,
  Button,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  IconButton,
  Switch,
  Tooltip,
} from '@golink/ui';
import type { MenuProduct, Section } from '../menu/data';
import { plural, scheduleSummary } from '../menu/helpers';
import { DragHandle, useSortable, type SortableApi } from '../menu/sortable';
import { Thumb } from '../menu/ui';
import { ProductRow, type ProductRowActions } from './ProductRow';

export interface SectionActions {
  onEdit: (section: Section) => void;
  onToggle: (section: Section, enabled: boolean) => void;
  onDuplicate: (section: Section, withProducts: boolean) => void;
  onDelete: (section: Section) => void;
  onMove: (section: Section, direction: -1 | 1) => void;
  onReorderProducts: (sectionId: string | null, ids: string[]) => Promise<unknown>;
}

interface Props {
  /** null = produits sans section. */
  section: Section | null;
  products: MenuProduct[];
  totalCount: number;
  index: number;
  sectionsCount: number;
  canEdit: boolean;
  canStock: boolean;
  /** Réordonnancement permis (pas de recherche ni de filtre actifs). */
  reorderable: boolean;
  selection: Set<string>;
  onSelect: (product: MenuProduct, selected: boolean) => void;
  onSelectMany: (products: MenuProduct[], selected: boolean) => void;
  sectionSortable?: SortableApi;
  sectionActions: SectionActions;
  productActions: ProductRowActions;
  groupsById: Map<string, unknown>;
}

export function SectionCard({
  section,
  products,
  totalCount,
  index,
  sectionsCount,
  canEdit,
  canStock,
  reorderable,
  selection,
  onSelect,
  onSelectMany,
  sectionSortable,
  sectionActions,
  productActions,
  groupsById,
}: Props) {
  const [open, setOpen] = useState(true);
  const navigate = useNavigate();
  const listId = useId();
  const name = section?.name ?? 'Sans section';
  const schedule = scheduleSummary(section?.availability ? { ...section.availability } : null);
  const hidden = section ? !section.enabled : false;

  const reorder = useCallback((ids: string[]) => sectionActions.onReorderProducts(section?.id ?? null, ids), [section?.id, sectionActions]);
  const productSortable = useSortable(
    products.map((p) => p.id),
    reorder,
    !canEdit || !reorderable,
  );
  const byId = new Map(products.map((p) => [p.id, p]));
  const ordered = productSortable.order.map((id) => byId.get(id)).filter((p): p is MenuProduct => Boolean(p));
  const allSelected = products.length > 0 && products.every((p) => selection.has(p.id));
  const addHref = `/produits/nouveau${section ? `?section=${section.id}` : ''}`;

  return (
    <li
      {...(sectionSortable && section ? sectionSortable.itemProps(section.id) : {})}
      className={cn(
        sectionSortable && section ? sectionSortable.itemProps(section.id).className : undefined,
        'list-none overflow-hidden rounded-xl border border-border bg-surface shadow-card',
      )}
      aria-label={`Section ${name}`}
    >
      <div className={cn('flex flex-wrap items-center gap-x-3 gap-y-2 bg-surface-2/60 px-3 py-3 sm:flex-nowrap sm:px-4', hidden && 'bg-surface-3/40')}>
        {section && sectionSortable && canEdit && (
          <DragHandle {...sectionSortable.handleProps(section.id, `Déplacer la section ${name}`)} disabled={!reorderable} />
        )}
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          aria-controls={listId}
          className="flex min-w-0 flex-1 items-center gap-3 rounded-lg text-left focus-visible:outline-2 focus-visible:outline-ring"
        >
          <Thumb image={section?.image} alt={name} size="md" className={cn('hidden sm:block', hidden && 'opacity-60')} />
          <span className="min-w-0 flex-1">
            <span className="flex min-w-0 flex-wrap items-center gap-2">
              <span className={cn('truncate font-display text-md font-semibold tracking-tight text-fg', hidden && 'text-fg-muted')}>{name}</span>
              {hidden && (
                <Badge tone="neutral" size="sm" icon={<EyeOff />}>
                  Masquée
                </Badge>
              )}
              {!section && (
                <Badge tone="amber" size="sm">
                  À ranger
                </Badge>
              )}
              {section?.hideProductNames && (
                <Badge tone="neutral" size="sm">
                  Noms masqués
                </Badge>
              )}
              {schedule && (
                <Badge tone="info" size="sm" icon={<Clock />}>
                  {schedule}
                </Badge>
              )}
            </span>
            <span className="mt-0.5 block truncate text-xs text-fg-subtle">
              {plural(totalCount, 'produit')}
              {section?.description ? ` · ${section.description}` : !section ? ' · rattachez-les à une section pour les afficher' : ''}
            </span>
          </span>
          <ChevronDown className={cn('size-4 shrink-0 text-fg-subtle transition-transform', open && 'rotate-180')} aria-hidden="true" />
        </button>

        {section && (
          <div className="flex shrink-0 items-center gap-1 sm:gap-2">
            <Tooltip content={section.enabled ? 'Section visible par les clients' : 'Section masquée aux clients'} disabled={!canEdit}>
              <span className="inline-flex">
                <Switch
                  aria-label={section.enabled ? `Masquer la section ${name}` : `Afficher la section ${name}`}
                  checked={section.enabled}
                  disabled={!canEdit}
                  onCheckedChange={(value) => sectionActions.onToggle(section, value)}
                />
              </span>
            </Tooltip>
            {canEdit && (
              <>
                <IconButton label={`Ajouter un produit à ${name}`} variant="ghost" size="sm" onClick={() => navigate(addHref)}>
                  <Plus />
                </IconButton>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <IconButton label={`Actions pour la section ${name}`} variant="ghost" size="sm">
                      <MoreHorizontal />
                    </IconButton>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-60">
                    <DropdownMenuItem icon={<Pencil />} onSelect={() => sectionActions.onEdit(section)}>
                      Modifier la section
                    </DropdownMenuItem>
                    <DropdownMenuItem icon={<CopyPlus />} onSelect={() => sectionActions.onDuplicate(section, true)}>
                      Dupliquer avec ses produits
                    </DropdownMenuItem>
                    <DropdownMenuItem icon={<Copy />} onSelect={() => sectionActions.onDuplicate(section, false)}>
                      Dupliquer sans les produits
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem icon={<ArrowUp />} disabled={index === 0 || !reorderable} onSelect={() => sectionActions.onMove(section, -1)}>
                      Monter
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      icon={<ArrowDown />}
                      disabled={index >= sectionsCount - 1 || !reorderable}
                      onSelect={() => sectionActions.onMove(section, 1)}
                    >
                      Descendre
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem icon={<Trash2 />} destructive onSelect={() => sectionActions.onDelete(section)}>
                      Supprimer la section
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </>
            )}
          </div>
        )}
      </div>

      <div id={listId} hidden={!open}>
        {products.length > 0 ? (
          <>
            {canEdit && (
              <div className="flex items-center justify-between gap-3 border-t border-border px-3 py-1.5 text-2xs text-fg-subtle sm:px-4">
                <button
                  type="button"
                  className="rounded font-medium hover:text-fg focus-visible:outline-2 focus-visible:outline-ring"
                  onClick={() => onSelectMany(products, !allSelected)}
                >
                  {allSelected ? 'Tout désélectionner' : 'Tout sélectionner'}
                </button>
                <span className="hidden font-mono uppercase tracking-eyebrow md:inline">Stock · Prix · En vente</span>
              </div>
            )}
            <ul className="border-t border-border">
              {ordered.map((product) => (
                <ProductRow
                  key={product.id}
                  product={product}
                  hideName={section?.hideProductNames ?? false}
                  canEdit={canEdit}
                  canStock={canStock}
                  selected={selection.has(product.id)}
                  onSelect={onSelect}
                  sortable={reorderable ? productSortable : undefined}
                  groupsCount={product.optionGroupIds.filter((id) => groupsById.has(id)).length}
                  {...productActions}
                />
              ))}
            </ul>
          </>
        ) : (
          <div className="border-t border-border px-4 py-6 text-center text-sm text-fg-muted">
            {totalCount > 0 ? 'Aucun produit de cette section ne correspond à la recherche.' : 'Cette section est vide pour l’instant.'}
          </div>
        )}
        {canEdit && section && (
          <div className="border-t border-border px-3 py-2 sm:px-4">
            <Button variant="ghost" size="sm" leftIcon={<Plus />} onClick={() => navigate(addHref)}>
              Ajouter un produit
            </Button>
          </div>
        )}
      </div>
    </li>
  );
}
