// Options & listes : options individuelles (suppléments, choix) et listes d'options
// rattachées aux produits, avec recherche, activation, actions groupées et corbeille.
import { useMemo, useState } from 'react';
import { ClipboardList, Copy, MoreHorizontal, Pencil, Plus, Search, SlidersHorizontal, ToggleLeft, ToggleRight, Trash2, X } from 'lucide-react';
import { ALLERGEN_LABELS, MENU_LIMITS, formatOptionPrice } from '@golink/shared';
import {
  Badge,
  Button,
  cn,
  ConfirmDialog,
  createColumnHelper,
  DataTable,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  EmptyState,
  IconButton,
  Input,
  PageContainer,
  PageHeader,
  Skeleton,
  Switch,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  toast,
  Tooltip,
} from '@golink/ui';
import { useAuth, useDocumentTitle, usePersistentState } from '@golink/web';
import { useCan, useRestaurantAccess } from '@/auth/RestaurantAccess';
import { errorMessage } from '@/lib/firestore';
import { TrashSheet } from '../produits/components/TrashSheet';
import {
  menuFunctions,
  saveGroup,
  setGroupEnabled,
  setOptionsEnabled,
  useOptionGroups,
  useOptions,
  useProducts,
  type Group,
  type Option,
} from '../produits/menu/data';
import { matches, plural } from '../produits/menu/helpers';
import { GroupDialog, ruleSummary } from './GroupDialog';
import { OptionDialog } from './OptionDialog';

const column = createColumnHelper<Option>();

export function OptionsPage() {
  useDocumentTitle('Options & listes · GoLink Restaurant');
  const { restaurantId, restaurant } = useRestaurantAccess();
  const { user } = useAuth();
  const uid = user?.uid ?? '';
  const canEdit = useCan()('menu.edit');

  const optionsState = useOptions(restaurantId);
  const groupsState = useOptionGroups(restaurantId);
  const productsState = useProducts(restaurantId);
  const options = optionsState.data;
  const groups = groupsState.data;
  const products = productsState.data;
  const loading = optionsState.loading || groupsState.loading;
  const error = optionsState.error ?? groupsState.error;

  const [tab, setTab] = usePersistentState<'groups' | 'options'>('golink:restaurant:carte-options-onglet', 'groups');
  const [search, setSearch] = useState('');
  const [optionDialog, setOptionDialog] = useState<{ open: boolean; option: Option | null }>({ open: false, option: null });
  const [groupDialog, setGroupDialog] = useState<{ open: boolean; group: Group | null }>({ open: false, group: null });
  const [deleting, setDeleting] = useState<{ kind: 'option' | 'optionGroup'; ids: string[]; label: string } | null>(null);
  const [trashOpen, setTrashOpen] = useState(false);

  const optionById = useMemo(() => new Map(options.map((o) => [o.id, o])), [options]);
  const groupsByOption = useMemo(() => {
    const map = new Map<string, Group[]>();
    for (const group of groups) for (const id of group.optionIds) map.set(id, [...(map.get(id) ?? []), group]);
    return map;
  }, [groups]);
  const productsByGroup = useMemo(() => {
    const map = new Map<string, number>();
    for (const product of products) for (const id of product.optionGroupIds) map.set(id, (map.get(id) ?? 0) + 1);
    return map;
  }, [products]);

  const visibleGroups = groups.filter((g) => matches(search, g.name, g.description, ...g.optionIds.map((id) => optionById.get(id)?.name)));
  const visibleOptions = options.filter((o) => matches(search, o.name));

  async function run(action: () => Promise<unknown>, success: string) {
    try {
      await action();
      toast.success(success);
    } catch (caught) {
      toast.error(errorMessage(caught));
    }
  }

  async function duplicateGroup(group: Group) {
    const taken = new Set(groups.map((g) => g.name.toLowerCase()));
    let name = `${group.name.slice(0, MENU_LIMITS.groupName - 9)} (copie)`;
    for (let i = 2; taken.has(name.toLowerCase()); i += 1) name = `${group.name.slice(0, MENU_LIMITS.groupName - 12)} (copie ${i})`;
    await run(
      () => saveGroup(restaurantId, uid, null, { name, description: group.description ?? null, optionIds: group.optionIds, multiple: group.multiple, min: group.min, max: group.max, allowQuantity: group.allowQuantity, enabled: false }),
      `« ${name} » créée, désactivée le temps de la relire`,
    );
  }

  const columns = useMemo(
    () => [
      column.accessor('name', {
        header: 'Option',
        cell: ({ row }) => (
          <div className="min-w-0">
            <p className={cn('truncate font-medium', row.original.enabled ? 'text-fg' : 'text-fg-muted')}>{row.original.name}</p>
            {row.original.allergens.length > 0 && <p className="truncate text-xs text-fg-subtle">Allergènes : {row.original.allergens.map((a) => ALLERGEN_LABELS[a]).join(', ')}</p>}
          </div>
        ),
        meta: { className: 'min-w-[200px]' },
      }),
      column.accessor('priceCents', {
        header: 'Supplément',
        cell: ({ getValue }) => <span className={cn('num font-mono text-sm', getValue() ? 'text-fg' : 'text-fg-muted')}>{formatOptionPrice(getValue())}</span>,
        meta: { align: 'right' },
      }),
      column.accessor((row) => (groupsByOption.get(row.id) ?? []).length, {
        id: 'groups',
        header: 'Listes',
        cell: ({ row }) => {
          const list = groupsByOption.get(row.original.id) ?? [];
          if (list.length === 0) return <span className="text-xs text-fg-subtle">Aucune</span>;
          return (
            <div className="flex max-w-xs flex-wrap gap-1">
              {list.slice(0, 2).map((g) => (
                <Badge key={g.id} size="sm">
                  {g.name}
                </Badge>
              ))}
              {list.length > 2 && <Badge size="sm">+{list.length - 2}</Badge>}
            </div>
          );
        },
      }),
      column.accessor('enabled', {
        header: 'Disponible',
        cell: ({ row }) => (
          <span onClick={(event) => event.stopPropagation()} className="inline-flex">
            <Switch
              size="sm"
              aria-label={row.original.enabled ? `Désactiver ${row.original.name}` : `Activer ${row.original.name}`}
              checked={row.original.enabled}
              disabled={!canEdit}
              onCheckedChange={(value) => void run(() => setOptionsEnabled(restaurantId, uid, [row.original.id], value), value ? 'Option disponible' : 'Option désactivée')}
            />
          </span>
        ),
      }),
      column.display({
        id: 'actions',
        header: () => <span className="sr-only">Actions</span>,
        cell: ({ row }) =>
          canEdit ? (
            <span onClick={(event) => event.stopPropagation()} className="inline-flex">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <IconButton label={`Actions pour ${row.original.name}`} variant="ghost" size="sm">
                    <MoreHorizontal />
                  </IconButton>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem icon={<Pencil />} onSelect={() => setOptionDialog({ open: true, option: row.original })}>
                    Modifier
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem icon={<Trash2 />} destructive onSelect={() => setDeleting({ kind: 'option', ids: [row.original.id], label: `« ${row.original.name} »` })}>
                    Supprimer
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </span>
          ) : null,
        meta: { align: 'right', className: 'w-12' },
      }),
    ],
    [groupsByOption, canEdit, restaurantId, uid],
  );

  const activeOptions = options.filter((o) => o.enabled).length;
  const activeGroups = groups.filter((g) => g.enabled).length;

  return (
    <PageContainer>
      <PageHeader
        eyebrow={`${restaurant.name} · Personnalisation`}
        title="Options & listes"
        description="Construisez les choix de votre carte : créez les options, rassemblez-les en listes, puis proposez ces listes sur vos produits."
        actions={
          canEdit && (
            <>
              <IconButton label="Corbeille des options" variant="secondary" onClick={() => setTrashOpen(true)}>
                <Trash2 />
              </IconButton>
              <Button variant="secondary" leftIcon={<Plus />} onClick={() => setOptionDialog({ open: true, option: null })}>
                Nouvelle option
              </Button>
              <Button variant="primary" leftIcon={<ClipboardList />} onClick={() => setGroupDialog({ open: true, group: null })}>
                Nouvelle liste
              </Button>
            </>
          )
        }
      />

      {error ? (
        <div className="rounded-xl border border-border bg-surface">
          <EmptyState icon={<SlidersHorizontal />} title="Impossible de charger les options" description={errorMessage(error)} />
        </div>
      ) : (
        <Tabs value={tab} onValueChange={(value) => setTab(value as 'groups' | 'options')}>
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <TabsList>
              <TabsTrigger value="groups" icon={<ClipboardList />} count={loading ? undefined : groups.length}>
                Listes d’options
              </TabsTrigger>
              <TabsTrigger value="options" icon={<SlidersHorizontal />} count={loading ? undefined : options.length}>
                Options
              </TabsTrigger>
            </TabsList>
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Rechercher une option ou une liste…"
              aria-label="Rechercher une option ou une liste"
              leading={<Search />}
              trailing={
                search ? (
                  <button type="button" aria-label="Effacer la recherche" onClick={() => setSearch('')} className="rounded p-0.5 hover:text-fg">
                    <X />
                  </button>
                ) : undefined
              }
              className="sm:w-80"
            />
          </div>

          <TabsContent value="groups">
            <p className="mb-3 text-sm text-fg-muted">
              {loading ? '…' : `${plural(groups.length, 'liste créée', 'listes créées')} · ${plural(activeGroups, 'active', 'actives')}`}
            </p>
            {loading ? (
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {Array.from({ length: 3 }, (_, i) => (
                  <Skeleton key={i} className="h-48 rounded-xl" />
                ))}
              </div>
            ) : visibleGroups.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border-strong bg-surface">
                <EmptyState
                  icon={<ClipboardList />}
                  title={search ? 'Aucune liste ne correspond' : 'Aucune liste d’options'}
                  description={search ? 'Essayez un autre nom de liste ou d’option.' : 'Regroupez vos options (« Sauces au choix », « Cuisson »…) pour les proposer avec vos produits.'}
                  action={
                    search ? (
                      <Button variant="secondary" onClick={() => setSearch('')}>
                        Effacer la recherche
                      </Button>
                    ) : canEdit ? (
                      <Button variant="primary" leftIcon={<Plus />} onClick={() => setGroupDialog({ open: true, group: null })}>
                        Créer une liste
                      </Button>
                    ) : undefined
                  }
                />
              </div>
            ) : (
              <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {visibleGroups.map((group) => {
                  const included = group.optionIds.map((id) => optionById.get(id)).filter((o): o is Option => Boolean(o));
                  const usage = productsByGroup.get(group.id) ?? 0;
                  return (
                    <li key={group.id} className={cn('flex min-w-0 flex-col rounded-xl border border-border bg-surface shadow-card', !group.enabled && 'bg-surface-2')}>
                      <div className="flex items-start gap-3 border-b border-border px-4 py-3">
                        <div className="min-w-0 flex-1">
                          <button
                            type="button"
                            disabled={!canEdit}
                            onClick={() => setGroupDialog({ open: true, group })}
                            className={cn('block max-w-full truncate text-left font-display text-md font-semibold tracking-tight', group.enabled ? 'text-fg' : 'text-fg-muted', canEdit && 'hover:text-primary-soft-fg')}
                          >
                            {group.name}
                          </button>
                          <div className="mt-1 flex flex-wrap items-center gap-1.5">
                            <Badge tone={group.min > 0 ? 'brand' : 'neutral'} size="sm">
                              {group.min > 0 ? 'Obligatoire' : 'Facultatif'}
                            </Badge>
                            <Badge tone="info" size="sm">
                              {ruleSummary(group)}
                            </Badge>
                            {group.allowQuantity && <Badge size="sm">Quantités</Badge>}
                          </div>
                        </div>
                        <Tooltip content={group.enabled ? 'Liste proposée aux clients' : 'Liste désactivée'} disabled={!canEdit}>
                          <span className="inline-flex">
                            <Switch
                              aria-label={group.enabled ? `Désactiver la liste ${group.name}` : `Activer la liste ${group.name}`}
                              checked={group.enabled}
                              disabled={!canEdit}
                              onCheckedChange={(value) => void run(() => setGroupEnabled(restaurantId, uid, group.id, value), value ? 'Liste activée' : 'Liste désactivée')}
                            />
                          </span>
                        </Tooltip>
                      </div>
                      <ul className="flex-1 space-y-1 px-4 py-3">
                        {included.slice(0, 4).map((option) => (
                          <li key={option.id} className="flex items-center justify-between gap-3 text-sm">
                            <span className={cn('truncate', option.enabled ? 'text-fg' : 'text-fg-subtle line-through')}>{option.name}</span>
                            <span className="num shrink-0 font-mono text-xs text-fg-muted">{formatOptionPrice(option.priceCents)}</span>
                          </li>
                        ))}
                        {included.length > 4 && <li className="text-xs text-fg-subtle">+ {plural(included.length - 4, 'autre option', 'autres options')}</li>}
                        {included.length === 0 && <li className="text-xs italic text-fg-subtle">Aucune option incluse</li>}
                      </ul>
                      <div className="flex items-center justify-between gap-2 border-t border-border px-4 py-2">
                        <span className="text-xs text-fg-subtle">{usage ? `Proposée sur ${plural(usage, 'produit')}` : 'Liée à aucun produit'}</span>
                        {canEdit && (
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <IconButton label={`Actions pour la liste ${group.name}`} variant="ghost" size="sm">
                                <MoreHorizontal />
                              </IconButton>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem icon={<Pencil />} onSelect={() => setGroupDialog({ open: true, group })}>
                                Modifier
                              </DropdownMenuItem>
                              <DropdownMenuItem icon={<Copy />} onSelect={() => void duplicateGroup(group)}>
                                Dupliquer
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem icon={<Trash2 />} destructive onSelect={() => setDeleting({ kind: 'optionGroup', ids: [group.id], label: `la liste « ${group.name} »` })}>
                                Supprimer
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </TabsContent>

          <TabsContent value="options">
            <p className="mb-3 text-sm text-fg-muted">
              {loading ? '…' : `${plural(options.length, 'option créée', 'options créées')} · ${plural(activeOptions, 'active', 'actives')}`}
            </p>
            <DataTable
              data={visibleOptions}
              columns={columns}
              getRowId={(row) => row.id}
              loading={loading}
              searchable={false}
              pageSize={25}
              itemLabel="options"
              onRowClick={canEdit ? (row) => setOptionDialog({ open: true, option: row }) : undefined}
              bulkActions={
                canEdit
                  ? [
                      { label: 'Activer', icon: <ToggleRight />, onClick: (rows, clear) => void run(() => setOptionsEnabled(restaurantId, uid, rows.map((r) => r.id), true), `${plural(rows.length, 'option activée', 'options activées')}`).then(clear) },
                      { label: 'Désactiver', icon: <ToggleLeft />, onClick: (rows, clear) => void run(() => setOptionsEnabled(restaurantId, uid, rows.map((r) => r.id), false), `${plural(rows.length, 'option désactivée', 'options désactivées')}`).then(clear) },
                      { label: 'Supprimer', icon: <Trash2 />, destructive: true, onClick: (rows, clear) => { setDeleting({ kind: 'option', ids: rows.map((r) => r.id), label: plural(rows.length, 'option', 'options') }); clear(); } },
                    ]
                  : undefined
              }
              emptyState={
                <EmptyState
                  compact
                  icon={<SlidersHorizontal />}
                  title={search ? 'Aucune option ne correspond' : 'Aucune option pour le moment'}
                  description={search ? 'Essayez un autre nom.' : 'Ajoutez votre premier choix : sauce, cuisson, supplément…'}
                  action={
                    canEdit && !search ? (
                      <Button variant="primary" leftIcon={<Plus />} onClick={() => setOptionDialog({ open: true, option: null })}>
                        Nouvelle option
                      </Button>
                    ) : undefined
                  }
                />
              }
            />
          </TabsContent>
        </Tabs>
      )}

      <OptionDialog open={optionDialog.open} onOpenChange={(open) => setOptionDialog((c) => ({ ...c, open }))} restaurantId={restaurantId} option={optionDialog.option} />
      <GroupDialog open={groupDialog.open} onOpenChange={(open) => setGroupDialog((c) => ({ ...c, open }))} restaurantId={restaurantId} group={groupDialog.group} options={options} products={products} />
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        destructive
        title={`Supprimer ${deleting?.label ?? ''} ?`}
        description={
          deleting?.kind === 'option'
            ? `Retirée des listes qui l’utilisent (bornes réajustées). Restaurable depuis la corbeille pendant ${MENU_LIMITS.trashDays} jours.`
            : `Retirée des produits qui la proposent ; les options restent disponibles. Restaurable depuis la corbeille pendant ${MENU_LIMITS.trashDays} jours.`
        }
        confirmLabel="Supprimer"
        onConfirm={async () => {
          if (!deleting) return;
          await run(() => menuFunctions.trashMenuItems({ restaurantId, kind: deleting.kind, ids: deleting.ids }), deleting.kind === 'option' ? 'Option placée dans la corbeille' : 'Liste placée dans la corbeille');
        }}
      />
      <TrashSheet open={trashOpen} onOpenChange={setTrashOpen} restaurantId={restaurantId} kinds={['option', 'optionGroup']} />
    </PageContainer>
  );
}
