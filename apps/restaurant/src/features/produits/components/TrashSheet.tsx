// Corbeille de la carte : éléments supprimés, restaurables jusqu'à leur purge.
import { useState } from 'react';
import { ArchiveRestore, LayoutList, ListChecks, Package, SlidersHorizontal, Trash2 } from 'lucide-react';
import { Badge, Button, EmptyState, formatRelative, Sheet, SheetBody, SheetContent, SheetHeader, Skeleton, toast } from '@golink/ui';
import { errorMessage, toDate } from '@/lib/firestore';
import { menuFunctions, useMenuTrash, type MenuTrashItem } from '../menu/data';

const KIND_META = {
  section: { label: 'Section', icon: LayoutList },
  product: { label: 'Produit', icon: Package },
  option: { label: 'Option', icon: SlidersHorizontal },
  optionGroup: { label: 'Liste d’options', icon: ListChecks },
} as const;

function itemName(item: MenuTrashItem): string {
  const name = item.snapshot?.name;
  return typeof name === 'string' && name ? name : (item.entity.label ?? 'Élément');
}

export function TrashSheet({ open, onOpenChange, restaurantId, kinds }: { open: boolean; onOpenChange: (open: boolean) => void; restaurantId: string; kinds?: Array<keyof typeof KIND_META> }) {
  const trash = useMenuTrash(restaurantId, open);
  const [restoring, setRestoring] = useState<string | null>(null);
  const items = trash.data.filter((item) => !item.restoredAt && item.menuKind && (!kinds || kinds.includes(item.menuKind)));

  async function restore(item: MenuTrashItem) {
    setRestoring(item.id);
    try {
      const result = await menuFunctions.restoreMenuItem({ trashId: item.id });
      toast.success(`« ${result.name || itemName(item)} » est de retour sur la carte`);
    } catch (caught) {
      toast.error(errorMessage(caught));
    } finally {
      setRestoring(null);
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-lg">
        <SheetHeader icon={<Trash2 />} title="Corbeille de la carte" description="Les éléments supprimés sont conservés le délai réglé par la plateforme, puis effacés définitivement." />
        <SheetBody className="px-4 sm:px-6">
          {trash.loading ? (
            <div className="space-y-2">
              {Array.from({ length: 4 }, (_, i) => (
                <Skeleton key={i} className="h-16 w-full rounded-xl" />
              ))}
            </div>
          ) : trash.error ? (
            <p role="alert" className="tone-danger rounded-lg bg-(--tone-bg) px-3 py-2 text-sm text-(--tone-fg)">
              {errorMessage(trash.error)}
            </p>
          ) : items.length === 0 ? (
            <EmptyState compact icon={<Trash2 />} title="La corbeille est vide" description="Les sections, produits et options supprimés apparaîtront ici." />
          ) : (
            <ul className="space-y-2">
              {items.map((item) => {
                const meta = KIND_META[item.menuKind!];
                const Icon = meta.icon;
                const deletedAt = toDate(item.deletedAt);
                const purgeAt = toDate(item.purgeAt);
                const children = item.children?.length ?? 0;
                return (
                  <li key={item.id} className="flex items-center gap-3 rounded-xl border border-border bg-surface p-3">
                    <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-surface-3 text-fg-muted">
                      <Icon className="size-4" aria-hidden="true" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-fg">{itemName(item)}</p>
                      <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-fg-subtle">
                        <Badge size="sm">{meta.label}</Badge>
                        {children > 0 && <span>avec {children} produit{children > 1 ? 's' : ''}</span>}
                        {deletedAt && <span>supprimé {formatRelative(deletedAt)}</span>}
                        {purgeAt && <span>· purge {formatRelative(purgeAt)}</span>}
                      </p>
                      {item.reason && <p className="mt-1 truncate text-xs text-fg-muted">Motif : {item.reason}</p>}
                    </div>
                    <Button size="sm" variant="secondary" leftIcon={<ArchiveRestore />} loading={restoring === item.id} disabled={Boolean(restoring)} onClick={() => void restore(item)}>
                      Restaurer
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
        </SheetBody>
      </SheetContent>
    </Sheet>
  );
}
