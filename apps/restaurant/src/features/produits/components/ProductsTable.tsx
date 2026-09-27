// Vue « liste » de la carte : tableau triable, filtres à facettes et actions groupées.
import { useMemo } from 'react';
import { useNavigate } from 'react-router';
import { Eye, EyeOff, FolderInput, Star, Trash2 } from 'lucide-react';
import { MENU_ISSUE_LABELS } from '@golink/shared';
import { createColumnHelper, DataTable, formatNumber, Tooltip, type DataTableBulkAction } from '@golink/ui';
import type { MenuProduct, Section } from '../menu/data';
import { productIssues, saleState } from '../menu/helpers';
import { Dot, Price, StockPill, Thumb } from '../menu/ui';

const column = createColumnHelper<MenuProduct>();

export function ProductsTable({
  products,
  sections,
  loading,
  canEdit,
  onBulk,
}: {
  products: MenuProduct[];
  sections: Section[];
  loading: boolean;
  canEdit: boolean;
  onBulk: (action: 'available' | 'unavailable' | 'move' | 'feature' | 'delete', rows: MenuProduct[], clear: () => void) => void;
}) {
  const navigate = useNavigate();
  const sectionName = useMemo(() => new Map(sections.map((s) => [s.id, s.name])), [sections]);

  const columns = useMemo(
    () => [
      column.accessor('name', {
        header: 'Produit',
        cell: ({ row }) => (
          <div className="flex min-w-0 items-center gap-3">
            <Thumb image={row.original.image} alt={row.original.name} size="sm" />
            <div className="min-w-0">
              <p className="truncate font-medium text-fg">{row.original.name}</p>
              <p className="truncate text-xs text-fg-subtle">{row.original.sectionId ? (sectionName.get(row.original.sectionId) ?? 'Sans section') : 'Sans section'}</p>
            </div>
          </div>
        ),
        meta: { className: 'min-w-[240px]' },
      }),
      column.accessor('priceCents', {
        header: 'Prix',
        cell: ({ getValue }) => <Price cents={getValue()} />,
        meta: { align: 'right' },
      }),
      column.accessor((row) => row.stock ?? -1, {
        id: 'stock',
        header: 'Stock',
        cell: ({ row }) => <StockPill product={row.original} />,
        meta: { align: 'right' },
      }),
      column.accessor('salesCount', {
        header: 'Ventes',
        cell: ({ getValue }) => <span className="num font-mono text-sm text-fg-muted">{formatNumber(getValue() ?? 0)}</span>,
        meta: { align: 'right' },
      }),
      column.accessor((row) => saleState(row).label, {
        id: 'state',
        header: 'En vente',
        cell: ({ row }) => {
          const state = saleState(row.original);
          return <Dot tone={state.tone}>{state.label}</Dot>;
        },
      }),
      column.accessor((row) => productIssues(row).length, {
        id: 'quality',
        header: 'Qualité',
        cell: ({ row }) => {
          const issues = productIssues(row.original);
          if (issues.length === 0) return <Dot tone="success">Complet</Dot>;
          return (
            <Tooltip content={issues.map((i) => MENU_ISSUE_LABELS[i]).join(' · ')}>
              <span>
                <Dot tone="amber">{issues.length === 1 ? MENU_ISSUE_LABELS[issues[0]!] : `${issues.length} points`}</Dot>
              </span>
            </Tooltip>
          );
        },
      }),
    ],
    [sectionName],
  );

  const bulkActions: DataTableBulkAction<MenuProduct>[] | undefined = canEdit
    ? [
        { label: 'Mettre en vente', icon: <Eye />, onClick: (rows, clear) => onBulk('available', rows, clear) },
        { label: 'Rendre indisponible', icon: <EyeOff />, onClick: (rows, clear) => onBulk('unavailable', rows, clear) },
        { label: 'Changer de section', icon: <FolderInput />, onClick: (rows, clear) => onBulk('move', rows, clear) },
        { label: 'Mettre en vitrine', icon: <Star />, onClick: (rows, clear) => onBulk('feature', rows, clear) },
        { label: 'Supprimer', icon: <Trash2 />, destructive: true, onClick: (rows, clear) => onBulk('delete', rows, clear) },
      ]
    : undefined;

  return (
    <DataTable
      data={products}
      columns={columns}
      getRowId={(row) => row.id}
      loading={loading}
      searchable={false}
      bulkActions={bulkActions}
      onRowClick={(row) => navigate(`/produits/${row.id}`)}
      pageSize={25}
      itemLabel="produits"
      filters={[
        {
          id: 'section',
          label: 'Section',
          options: [...sections.map((s) => ({ value: s.id, label: s.name })), { value: '', label: 'Sans section' }],
          getValue: (row) => (row.sectionId && sectionName.has(row.sectionId) ? row.sectionId : ''),
        },
      ]}
    />
  );
}
