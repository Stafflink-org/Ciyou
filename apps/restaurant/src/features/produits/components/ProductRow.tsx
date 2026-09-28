// Ligne produit dans une section : vignette, nom, pastilles, prix, stock, disponibilité, actions.
import { Link, useNavigate } from 'react-router';
import { AlertTriangle, Clock, Copy, ListChecks, MoreHorizontal, Pencil, Star, StarOff, Trash2 } from 'lucide-react';
import { MENU_ISSUE_LABELS, PRODUCT_BADGE_LABELS } from '@golink/shared';
import {
  Badge,
  Checkbox,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  formatEUR,
  IconButton,
  Switch,
  Tooltip,
} from '@golink/ui';
import type { MenuProduct } from '../menu/data';
import { productIssues, saleState, scheduleSummary } from '../menu/helpers';
import { DragHandle, type SortableApi } from '../menu/sortable';
import { Price, StockPill, Thumb } from '../menu/ui';

export interface ProductRowActions {
  onToggleAvailable: (product: MenuProduct, available: boolean) => void;
  onDuplicate: (product: MenuProduct) => void;
  onToggleFeatured: (product: MenuProduct) => void;
  onDelete: (product: MenuProduct) => void;
}

interface Props extends ProductRowActions {
  product: MenuProduct;
  hideName: boolean;
  canEdit: boolean;
  canStock: boolean;
  selected: boolean;
  onSelect: (product: MenuProduct, selected: boolean) => void;
  sortable?: SortableApi;
  groupsCount: number;
}

export function ProductRow({ product, hideName, canEdit, canStock, selected, onSelect, sortable, groupsCount, ...actions }: Props) {
  const issues = productIssues(product);
  const state = saleState(product);
  const soldOut = product.stock === 0;
  const schedule = scheduleSummary(product.schedule);
  const href = `/produits/${product.id}`;
  const navigate = useNavigate();

  return (
    <li
      {...(sortable?.itemProps(product.id) ?? {})}
      className={cn(
        sortable?.itemProps(product.id).className,
        'group/row flex items-center gap-2 border-t border-border bg-surface px-2 py-2 transition-colors first:border-t-0 hover:bg-surface-2 sm:gap-3 sm:px-3',
        selected && 'bg-primary-soft/50 hover:bg-primary-soft/60',
      )}
    >
      {canEdit && (
        <Checkbox
          aria-label={`Sélectionner ${product.name}`}
          checked={selected}
          onCheckedChange={(value) => onSelect(product, value === true)}
          className="shrink-0"
        />
      )}
      {sortable && canEdit && <DragHandle {...sortable.handleProps(product.id, `Déplacer ${product.name}`)} className="hidden sm:grid" />}

      <Link to={href} className="flex min-w-0 flex-1 items-center gap-3 rounded-lg focus-visible:outline-2 focus-visible:outline-ring">
        <Thumb image={product.image} alt={product.name} className={cn(!product.available && 'opacity-60')} />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <span className={cn('line-clamp-2 text-sm font-medium text-fg sm:truncate', !product.available && 'text-fg-muted')}>{product.name}</span>
            {product.featured && (
              <Tooltip content="En vitrine dans l’app client">
                <Star className="size-3.5 shrink-0 fill-current text-primary" aria-label="En vitrine" />
              </Tooltip>
            )}
          </div>
          <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-fg-subtle">
            <span className="num font-mono font-medium text-fg sm:hidden">{formatEUR(product.priceCents, { cents: true })}</span>
            {state.label !== 'En ligne' && (
              <Badge tone={state.tone} size="sm">
                {state.label}
              </Badge>
            )}
            {product.badge && (
              <Badge tone="brand" size="sm">
                {PRODUCT_BADGE_LABELS[product.badge]}
              </Badge>
            )}
            {hideName && <span>Nom masqué</span>}
            {groupsCount > 0 && (
              <span className="inline-flex items-center gap-1">
                <ListChecks className="size-3" aria-hidden="true" />
                {groupsCount} liste{groupsCount > 1 ? 's' : ''}
              </span>
            )}
            {schedule && (
              <span className="inline-flex items-center gap-1">
                <Clock className="size-3" aria-hidden="true" />
                {schedule}
              </span>
            )}
            {issues.length > 0 && (
              <Tooltip content={issues.map((issue) => MENU_ISSUE_LABELS[issue]).join(' · ')}>
                <span className="tone-amber inline-flex items-center gap-1 text-(--tone-fg)">
                  <AlertTriangle className="size-3" aria-hidden="true" />
                  {issues.length === 1 ? MENU_ISSUE_LABELS[issues[0]!] : `${issues.length} points à compléter`}
                </span>
              </Tooltip>
            )}
          </div>
        </div>
      </Link>

      <div className="hidden w-16 justify-end md:flex">
        <StockPill product={product} />
      </div>
      <div className="hidden w-[4.5rem] text-right sm:block">
        <Price cents={product.priceCents} className={cn(!product.available && 'text-fg-muted')} />
        {product.compareAtPriceCents ? (
          <span className="num block font-mono text-2xs text-fg-subtle line-through">{formatEUR(product.compareAtPriceCents, { cents: true })}</span>
        ) : null}
      </div>
      <Tooltip
        content={soldOut ? 'En rupture : réapprovisionnez pour remettre en vente' : product.available ? 'Rendre indisponible' : 'Remettre en vente'}
        disabled={!canStock}
      >
        <span className="inline-flex">
          <Switch
            size="sm"
            aria-label={product.available ? `Rendre ${product.name} indisponible` : `Remettre ${product.name} en vente`}
            checked={product.available && !soldOut}
            disabled={!canStock || soldOut}
            onCheckedChange={(value) => actions.onToggleAvailable(product, value)}
          />
        </span>
      </Tooltip>
      {canEdit ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <IconButton label={`Actions pour ${product.name}`} variant="ghost" size="sm">
              <MoreHorizontal />
            </IconButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuItem icon={<Pencil />} onSelect={() => navigate(href)}>
              Modifier
            </DropdownMenuItem>
            <DropdownMenuItem icon={<Copy />} onSelect={() => actions.onDuplicate(product)}>
              Dupliquer
            </DropdownMenuItem>
            <DropdownMenuItem icon={product.featured ? <StarOff /> : <Star />} onSelect={() => actions.onToggleFeatured(product)}>
              {product.featured ? 'Retirer de la vitrine' : 'Mettre en vitrine'}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem icon={<Trash2 />} destructive onSelect={() => actions.onDelete(product)}>
              Supprimer
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : (
        <span className="w-8 shrink-0" aria-hidden="true" />
      )}
    </li>
  );
}
