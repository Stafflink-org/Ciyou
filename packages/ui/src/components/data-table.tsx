import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  flexRender,
  getCoreRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  useReactTable,
  type ColumnDef,
  type RowSelectionState,
  type SortingState,
} from '@tanstack/react-table';
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, ChevronsUpDown, ListFilter, Search, X } from 'lucide-react';
import { cn } from '../lib/cn';
import { formatNumber } from '../lib/format';
import { Button, IconButton } from './button';
import { Checkbox } from './choice';
import { EmptyState, Skeleton } from './display';
import { Input } from './input';
import { Popover, PopoverContent, PopoverTrigger } from './overlays';
import { Select } from './select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './table';

/** Métadonnées de colonne reconnues par DataTable (via `meta` d'une ColumnDef). */
export interface DataTableColumnMeta {
  align?: 'left' | 'center' | 'right';
  /** Classes appliquées aux cellules et à l'en-tête de la colonne. */
  className?: string;
}

export interface DataTableFilter<T> {
  id: string;
  label: string;
  options: { value: string; label: string }[];
  /** Valeur de la ligne comparée aux options cochées. */
  getValue: (row: T) => string;
}

export interface DataTableBulkAction<T> {
  label: string;
  icon?: ReactNode;
  destructive?: boolean;
  onClick: (rows: T[], clearSelection: () => void) => void;
}

export interface DataTableProps<T> {
  data: T[];
  // Colonnes aux types de valeur hétérogènes : `any` est le type attendu par TanStack Table.
  columns: ColumnDef<T, any>[];
  getRowId?: (row: T) => string;
  loading?: boolean;
  /** Recherche plein texte sur les colonnes texte. */
  searchable?: boolean;
  searchPlaceholder?: string;
  filters?: DataTableFilter<T>[];
  /** Active la sélection multiple et la barre d'actions groupées. */
  bulkActions?: DataTableBulkAction<T>[];
  onRowClick?: (row: T) => void;
  pageSize?: number;
  initialSorting?: SortingState;
  /** Boutons additionnels à droite de la barre d'outils (export, création…). */
  toolbar?: ReactNode;
  emptyState?: ReactNode;
  /** Nom des éléments au pluriel pour les compteurs (« restaurants »). */
  itemLabel?: string;
  className?: string;
}

const alignClass = { left: 'text-start', center: 'text-center', right: 'text-end' } as const;

function metaOf(meta: unknown): DataTableColumnMeta {
  return (meta ?? {}) as DataTableColumnMeta;
}

/**
 * Tableau de données complet : tri, recherche, filtres à facettes,
 * sélection multiple avec actions groupées, pagination, squelettes et état vide.
 */
export function DataTable<T>({
  data,
  columns,
  getRowId,
  loading,
  searchable = true,
  searchPlaceholder = 'Rechercher…',
  filters = [],
  bulkActions,
  onRowClick,
  pageSize = 10,
  initialSorting = [],
  toolbar,
  emptyState,
  itemLabel = 'éléments',
  className,
}: DataTableProps<T>) {
  const [sorting, setSorting] = useState<SortingState>(initialSorting);
  const [globalFilter, setGlobalFilter] = useState('');
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [facets, setFacets] = useState<Record<string, string[]>>({});
  const selectable = Boolean(bulkActions?.length);

  const filteredData = useMemo(() => {
    const active = filters.filter((filter) => (facets[filter.id]?.length ?? 0) > 0);
    if (active.length === 0) return data;
    return data.filter((row) => active.every((filter) => facets[filter.id]?.includes(filter.getValue(row))));
  }, [data, filters, facets]);

  const allColumns = useMemo<ColumnDef<T, unknown>[]>(() => {
    if (!selectable) return columns;
    const selectColumn: ColumnDef<T, unknown> = {
      id: '__select',
      enableSorting: false,
      meta: { className: 'w-10 pe-0!' } satisfies DataTableColumnMeta,
      header: ({ table }) => (
        <Checkbox
          aria-label="Tout sélectionner"
          checked={table.getIsAllPageRowsSelected() ? true : table.getIsSomePageRowsSelected() ? 'indeterminate' : false}
          onCheckedChange={(value) => table.toggleAllPageRowsSelected(value === true)}
        />
      ),
      cell: ({ row }) => (
        <Checkbox
          aria-label="Sélectionner la ligne"
          checked={row.getIsSelected()}
          onCheckedChange={(value) => row.toggleSelected(value === true)}
          onClick={(event) => event.stopPropagation()}
        />
      ),
    };
    return [selectColumn, ...columns];
  }, [columns, selectable]);

  const table = useReactTable({
    data: filteredData,
    columns: allColumns,
    state: { sorting, globalFilter, rowSelection },
    getRowId: getRowId ? (row) => getRowId(row) : undefined,
    enableRowSelection: selectable,
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    onRowSelectionChange: setRowSelection,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize } },
    autoResetPageIndex: true,
  });

  const selectedRows = table.getSelectedRowModel().rows.map((row) => row.original);
  const filteredCount = table.getFilteredRowModel().rows.length;
  const { pageIndex, pageSize: currentPageSize } = table.getState().pagination;
  const hasActiveFilters = globalFilter.length > 0 || Object.values(facets).some((values) => values.length > 0);
  const visibleColumns = table.getVisibleLeafColumns().length;

  // Bascule automatique en cartes empilées dès que le tableau ne tient plus dans son conteneur
  // (largeur de fenêtre, colonnes nombreuses, valeurs longues) : jamais de défilement horizontal.
  const rootRef = useRef<HTMLDivElement>(null);
  const tableRef = useRef<HTMLTableElement>(null);
  const [stacked, setStacked] = useState(false);
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const check = () => {
      if (window.matchMedia('(max-width: 639px)').matches) return; // cartes natives sous sm
      const tbl = tableRef.current;
      // Le tableau reste mesurable (invisible, largeur naturelle) même en mode cartes.
      if (tbl) setStacked(tbl.scrollWidth > root.clientWidth + 1);
    };
    check();
    const observer = new ResizeObserver(check);
    observer.observe(root);
    return () => observer.disconnect();
  }, [stacked, filteredCount, visibleColumns, loading, pageIndex, currentPageSize]);

  function resetFilters() {
    setGlobalFilter('');
    setFacets({});
  }

  function toggleFacet(filterId: string, value: string) {
    setFacets((current) => {
      const values = current[filterId] ?? [];
      return {
        ...current,
        [filterId]: values.includes(value) ? values.filter((v) => v !== value) : [...values, value],
      };
    });
  }

  return (
    <div ref={rootRef} className={cn('min-w-0 overflow-hidden rounded-xl border border-border bg-surface shadow-card', className)}>
      {(searchable || filters.length > 0 || toolbar) && (
        <div className="flex flex-col gap-3 border-b border-border p-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
          <div className="flex flex-1 flex-wrap items-center gap-2">
            {searchable && (
              <Input
                value={globalFilter}
                onChange={(event) => setGlobalFilter(event.target.value)}
                placeholder={searchPlaceholder}
                leading={<Search />}
                trailing={
                  globalFilter ? (
                    <button type="button" aria-label="Effacer la recherche" onClick={() => setGlobalFilter('')} className="rounded p-0.5 hover:text-fg">
                      <X />
                    </button>
                  ) : undefined
                }
                size="sm"
                className="w-full sm:w-64"
                aria-label={searchPlaceholder}
              />
            )}
            {filters.map((filter) => {
              const selected = facets[filter.id] ?? [];
              return (
                <Popover key={filter.id}>
                  <PopoverTrigger asChild>
                    <Button
                      size="sm"
                      variant="secondary"
                      className={cn('border-dashed', selected.length > 0 && 'border-solid border-primary/50 bg-primary-soft/40')}
                      leftIcon={<ListFilter />}
                    >
                      {filter.label}
                      {selected.length > 0 && (
                        <span className="rounded bg-primary px-1.5 font-mono text-2xs text-primary-fg num">{selected.length}</span>
                      )}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-60 p-1.5">
                    <p className="eyebrow px-2 pb-1.5 pt-1">{filter.label}</p>
                    <div className="max-h-72 overflow-y-auto">
                      {filter.options.map((option) => {
                        const count = data.filter((row) => filter.getValue(row) === option.value).length;
                        const checked = selected.includes(option.value);
                        return (
                          <button
                            key={option.value}
                            type="button"
                            role="menuitemcheckbox"
                            aria-checked={checked}
                            onClick={() => toggleFacet(filter.id, option.value)}
                            className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-start text-sm outline-none hover:bg-surface-3 focus-visible:bg-surface-3"
                          >
                            <span
                              className={cn(
                                'grid size-4 shrink-0 place-items-center rounded border',
                                checked ? 'border-primary bg-primary text-primary-fg' : 'border-border-strong',
                              )}
                            >
                              {checked && <span className="size-1.5 rounded-sm bg-current" />}
                            </span>
                            <span className="flex-1 truncate">{option.label}</span>
                            <span className="font-mono text-2xs text-fg-subtle num">{count}</span>
                          </button>
                        );
                      })}
                    </div>
                    {selected.length > 0 && (
                      <button
                        type="button"
                        onClick={() => setFacets((current) => ({ ...current, [filter.id]: [] }))}
                        className="mt-1 w-full border-t border-border px-2 pt-2 pb-1 text-start text-xs font-medium text-fg-muted hover:text-fg"
                      >
                        Effacer ce filtre
                      </button>
                    )}
                  </PopoverContent>
                </Popover>
              );
            })}
            {hasActiveFilters && (
              <Button size="sm" variant="ghost" onClick={resetFilters} rightIcon={<X />}>
                Réinitialiser
              </Button>
            )}
          </div>
          {toolbar && <div className="flex max-w-full shrink-0 flex-wrap items-center gap-2">{toolbar}</div>}
        </div>
      )}

      {/* À partir de sm : tableau classique. En dessous : cartes empilées (une par ligne), pour éviter le défilement horizontal dans la carte. */}
      <Table ref={tableRef} stackable={false} aria-hidden={stacked || undefined} className={stacked ? 'pointer-events-none invisible fixed start-0 top-0 -z-10 h-0 w-max overflow-hidden' : 'hidden sm:table'}>
        <TableHeader>
          {table.getHeaderGroups().map((group) => (
            <TableRow key={group.id} className="hover:bg-transparent">
              {group.headers.map((header) => {
                const meta = metaOf(header.column.columnDef.meta);
                const sortable = header.column.getCanSort();
                const sorted = header.column.getIsSorted();
                const label = header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext());
                return (
                  <TableHead
                    key={header.id}
                    className={cn(alignClass[meta.align ?? 'left'], meta.className)}
                    aria-sort={sorted === 'asc' ? 'ascending' : sorted === 'desc' ? 'descending' : undefined}
                  >
                    {sortable ? (
                      <button
                        type="button"
                        onClick={header.column.getToggleSortingHandler()}
                        className={cn(
                          'group inline-flex items-center gap-1 uppercase tracking-eyebrow transition-colors hover:text-fg',
                          sorted && 'text-fg',
                          meta.align === 'right' && 'flex-row-reverse',
                        )}
                      >
                        {label}
                        {sorted === 'asc' ? (
                          <ArrowUp className="size-3" />
                        ) : sorted === 'desc' ? (
                          <ArrowDown className="size-3" />
                        ) : (
                          <ChevronsUpDown className="size-3 opacity-0 transition-opacity group-hover:opacity-60" />
                        )}
                      </button>
                    ) : (
                      label
                    )}
                  </TableHead>
                );
              })}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {loading ? (
            Array.from({ length: Math.min(currentPageSize, 6) }, (_, index) => (
              <TableRow key={index} className="hover:bg-transparent">
                {Array.from({ length: visibleColumns }, (_, cellIndex) => (
                  <TableCell key={cellIndex}>
                    <Skeleton className={cn('h-3.5', cellIndex === 0 ? 'w-4' : cellIndex === 1 ? 'w-40' : 'w-20')} />
                  </TableCell>
                ))}
              </TableRow>
            ))
          ) : table.getRowModel().rows.length === 0 ? (
            <TableRow className="hover:bg-transparent">
              <TableCell colSpan={visibleColumns} className="h-auto">
                {hasActiveFilters ? (
                  <EmptyState
                    compact
                    icon={<Search />}
                    title="Aucun résultat"
                    description="Aucun élément ne correspond à la recherche ou aux filtres appliqués."
                    action={
                      <Button size="sm" onClick={resetFilters}>
                        Effacer les filtres
                      </Button>
                    }
                  />
                ) : (
                  (emptyState ?? <EmptyState compact title="Rien à afficher pour le moment" />)
                )}
              </TableCell>
            </TableRow>
          ) : (
            table.getRowModel().rows.map((row) => (
              <TableRow
                key={row.id}
                data-state={row.getIsSelected() ? 'selected' : undefined}
                onClick={onRowClick ? () => onRowClick(row.original) : undefined}
                className={cn(onRowClick && 'cursor-pointer')}
              >
                {row.getVisibleCells().map((cell) => {
                  const meta = metaOf(cell.column.columnDef.meta);
                  return (
                    <TableCell key={cell.id} className={cn(alignClass[meta.align ?? 'left'], meta.className)}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  );
                })}
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>

      {/* Version cartes (< sm) : mêmes données, une carte par ligne, aucun défilement horizontal. */}
      <div className={cn('divide-y divide-border', !stacked && 'sm:hidden')}>
        {loading ? (
          Array.from({ length: Math.min(currentPageSize, 4) }, (_, index) => (
            <div key={index} className="space-y-2 p-4">
              <Skeleton className="h-3.5 w-32" />
              <Skeleton className="h-3.5 w-full" />
            </div>
          ))
        ) : table.getRowModel().rows.length === 0 ? (
          <div className="p-4">
            {hasActiveFilters ? (
              <EmptyState
                compact
                icon={<Search />}
                title="Aucun résultat"
                description="Aucun élément ne correspond à la recherche ou aux filtres appliqués."
                action={
                  <Button size="sm" onClick={resetFilters}>
                    Effacer les filtres
                  </Button>
                }
              />
            ) : (
              (emptyState ?? <EmptyState compact title="Rien à afficher pour le moment" />)
            )}
          </div>
        ) : (
          table.getRowModel().rows.map((row) => {
            const cells = row.getVisibleCells().filter((cell) => cell.column.id !== '__select');
            return (
              <div
                key={row.id}
                data-state={row.getIsSelected() ? 'selected' : undefined}
                onClick={onRowClick ? () => onRowClick(row.original) : undefined}
                className={cn(
                  'space-y-2.5 p-4 data-[state=selected]:bg-primary-soft/40',
                  onRowClick && 'cursor-pointer active:bg-surface-2',
                )}
              >
                {selectable && (
                  <div className="flex items-center justify-end" onClick={(event) => event.stopPropagation()}>
                    <Checkbox
                      aria-label="Sélectionner la ligne"
                      checked={row.getIsSelected()}
                      onCheckedChange={(value) => row.toggleSelected(value === true)}
                    />
                  </div>
                )}
                {cells.map((cell) => {
                  const columnDef = cell.column.columnDef;
                  const rawHeader = typeof columnDef.header === 'string' ? columnDef.header : undefined;
                  return (
                    <div key={cell.id} className="flex items-start justify-between gap-3 text-sm">
                      {rawHeader && (
                        <span className="min-w-0 max-w-[45%] [overflow-wrap:anywhere] font-mono text-3xs uppercase tracking-eyebrow text-fg-subtle">{rawHeader}</span>
                      )}
                      <span className="min-w-0 flex-1 text-end text-fg [&>*]:max-w-full [&>*]:min-w-0">{flexRender(columnDef.cell, cell.getContext())}</span>
                    </div>
                  );
                })}
              </div>
            );
          })
        )}
      </div>

      {!loading && filteredCount > 0 && (
        <div className="flex flex-col gap-3 border-t border-border px-5 py-3 text-sm text-fg-muted sm:flex-row sm:items-center sm:justify-between">
          <p className="num">
            <span className="font-medium text-fg">
              {formatNumber(pageIndex * currentPageSize + 1)}–{formatNumber(Math.min((pageIndex + 1) * currentPageSize, filteredCount))}
            </span>{' '}
            sur {formatNumber(filteredCount)} {itemLabel}
          </p>
          <div className="flex items-center gap-3">
            <div className="hidden items-center gap-2 sm:flex">
              <span className="text-xs">Lignes par page</span>
              <Select
                size="sm"
                className="w-[72px]"
                aria-label="Lignes par page"
                value={String(currentPageSize)}
                onValueChange={(value) => table.setPageSize(Number(value))}
                options={[...new Set([pageSize, 10, 25, 50, 100])]
                  .sort((a, b) => a - b)
                  .map((size) => ({ value: String(size), label: String(size) }))}
              />
            </div>
            <div className="flex items-center gap-1">
              <IconButton
                label="Page précédente"
                variant="secondary"
                size="sm"
                onClick={() => table.previousPage()}
                disabled={!table.getCanPreviousPage()}
              >
                <ChevronLeft className="rtl:-scale-x-100" />
              </IconButton>
              <span className="min-w-16 text-center font-mono text-xs num">
                {pageIndex + 1} / {table.getPageCount()}
              </span>
              <IconButton
                label="Page suivante"
                variant="secondary"
                size="sm"
                onClick={() => table.nextPage()}
                disabled={!table.getCanNextPage()}
              >
                <ChevronRight className="rtl:-scale-x-100" />
              </IconButton>
            </div>
          </div>
        </div>
      )}

      {selectable && selectedRows.length > 0 && (
        <div
          role="toolbar"
          aria-label="Actions groupées"
          className="fixed inset-x-3 bottom-4 z-40 mx-auto flex max-w-fit animate-rise items-center gap-1 rounded-xl border border-white/12 bg-petrol-950 p-1.5 ps-4 text-cream-100 shadow-xl ring-1 ring-black/20 sm:inset-x-0 dark:bg-ink-800"
        >
          <span className="me-2 whitespace-nowrap text-sm">
            <span className="font-mono font-medium num">{selectedRows.length}</span> sélectionné{selectedRows.length > 1 ? 's' : ''}
          </span>
          <span className="me-1 h-5 w-px bg-white/15" />
          <div className="flex items-center gap-1 overflow-x-auto">
            {bulkActions?.map((action) => (
              <button
                key={action.label}
                type="button"
                onClick={() => action.onClick(selectedRows, () => setRowSelection({}))}
                className={cn(
                  'inline-flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-2.5 text-sm font-medium transition-colors [&_svg]:size-4',
                  action.destructive ? 'text-ruby-300 hover:bg-ruby-500/20' : 'hover:bg-white/10',
                )}
              >
                {action.icon}
                {action.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            aria-label="Annuler la sélection"
            onClick={() => setRowSelection({})}
            className="ms-1 grid size-8 shrink-0 place-items-center rounded-lg text-cream-400 hover:bg-white/10 hover:text-white"
          >
            <X className="size-4" />
          </button>
        </div>
      )}
    </div>
  );
}
