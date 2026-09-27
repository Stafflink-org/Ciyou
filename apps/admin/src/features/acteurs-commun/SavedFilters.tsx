// Filtres enregistrés (« restaurants Pro à Metz ») : personnels ou partagés avec
// l'équipe, appliqués en un clic. Écriture directe autorisée par les règles.
import { useMemo, useState } from 'react';
import { addDoc, deleteDoc, limit, query, serverTimestamp, where } from 'firebase/firestore';
import { Bookmark, BookmarkPlus, Trash2, Users } from 'lucide-react';
import {
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  FormField,
  Input,
  Switch,
} from '@golink/ui';
import { COLLECTIONS, type SavedFilter, type WithId } from '@golink/shared';
import { useAuth } from '@golink/web';
import { collectionAt, docAt, useCollection, useMutation } from '@/lib/firestore';

type FilterValues = SavedFilter['filters'];

export function SavedFilters({
  entity,
  current,
  onApply,
  describe,
}: {
  entity: SavedFilter['entity'];
  current: FilterValues;
  onApply: (filters: FilterValues, name: string) => void;
  /** Résumé lisible du filtre courant (affiché dans la fenêtre d'enregistrement). */
  describe: string;
}) {
  const { user } = useAuth();
  const uid = user?.uid ?? '';
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [shared, setShared] = useState(false);
  const mineQuery = useMemo(
    () => (uid ? query(collectionAt(COLLECTIONS.savedFilters), where('entity', '==', entity), where('ownerId', '==', uid), limit(50)) : null),
    [entity, uid],
  );
  const sharedQuery = useMemo(() => query(collectionAt(COLLECTIONS.savedFilters), where('entity', '==', entity), where('shared', '==', true), limit(50)), [entity]);
  const mine = useCollection<SavedFilter>(mineQuery);
  const team = useCollection<SavedFilter>(sharedQuery);
  const all = useMemo(() => {
    const map = new Map<string, WithId<SavedFilter>>();
    [...mine.data, ...team.data].forEach((f) => map.set(f.id, f));
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  }, [mine.data, team.data]);

  const save = useMutation(
    async () =>
      addDoc(collectionAt(COLLECTIONS.savedFilters), { ownerId: uid, entity, name: name.trim(), filters: current, shared, createdAt: serverTimestamp() }),
    { success: 'Filtre enregistré' },
  );
  const remove = useMutation(async (id: string) => deleteDoc(docAt(`${COLLECTIONS.savedFilters}/${id}`)), { success: 'Filtre supprimé' });

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="secondary" size="sm" leftIcon={<Bookmark />}>
            <span className="hidden sm:inline">Filtres enregistrés</span>
            <span className="sm:hidden">Filtres</span>
            {all.length > 0 && <span className="font-mono text-2xs text-fg-subtle num">{all.length}</span>}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-72">
          <DropdownMenuLabel>Filtres enregistrés</DropdownMenuLabel>
          {all.length === 0 && <p className="px-2.5 py-2 text-sm text-fg-subtle">Aucun filtre pour le moment.</p>}
          {all.map((filter) => (
            <DropdownMenuItem key={filter.id} icon={filter.shared ? <Users /> : <Bookmark />} onSelect={() => onApply(filter.filters, filter.name)}>
              <span className="min-w-0 flex-1 truncate">{filter.name}</span>
              {filter.ownerId === uid && (
                <button
                  type="button"
                  aria-label={`Supprimer le filtre ${filter.name}`}
                  className="grid size-6 place-items-center rounded-md text-fg-subtle hover:bg-surface-3 hover:text-danger"
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    void remove.mutate(filter.id);
                  }}
                >
                  <Trash2 className="size-3.5" />
                </button>
              )}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem icon={<BookmarkPlus />} onSelect={() => setOpen(true)}>
            Enregistrer le filtre actuel…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent size="sm">
          <DialogHeader icon={<BookmarkPlus />} title="Enregistrer ce filtre" description={describe} />
          <DialogBody className="space-y-4">
            <FormField label="Nom du filtre" required>
              <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder="Restaurants Pro à Metz" autoFocus />
            </FormField>
            <label className="flex items-center justify-between gap-4 rounded-xl border border-border bg-surface-2 px-4 py-3">
              <span>
                <span className="block text-sm font-medium text-fg">Partager avec l’équipe</span>
                <span className="block text-xs text-fg-subtle">Visible par tous les administrateurs.</span>
              </span>
              <Switch checked={shared} onCheckedChange={setShared} aria-label="Partager le filtre" />
            </label>
          </DialogBody>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Annuler
            </Button>
            <Button
              variant="primary"
              loading={save.loading}
              disabled={name.trim().length < 2}
              onClick={() =>
                void save.mutate().then((ok) => {
                  if (ok) {
                    setOpen(false);
                    setName('');
                    setShared(false);
                  }
                })
              }
            >
              Enregistrer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
