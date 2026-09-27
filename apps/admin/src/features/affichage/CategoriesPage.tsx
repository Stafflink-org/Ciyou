import { useEffect, useMemo, useState } from 'react';
import { collection, count, doc, getAggregateFromServer, limit, orderBy, query, setDoc, updateDoc, where, writeBatch } from 'firebase/firestore';
import { ArrowDown, ArrowUp, GripVertical, Pencil, Plus, Tags } from 'lucide-react';
import {
  Button,
  Card,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  EmptyState,
  FormField,
  IconButton,
  Input,
  PageContainer,
  PageHeader,
  Skeleton,
  Switch,
  cn,
  toast,
} from '@golink/ui';
import { COLLECTIONS, slugify, type CuisineCategory, type WithId } from '@golink/shared';
import { useDocumentTitle } from '@golink/web';
import { useAdminAccess } from '@/auth/AdminAccess';
import { db } from '@/lib/firebase';
import { createdFields, errorMessage, updatedFields, useCollection } from '@/lib/firestore';
import { LoadError } from '../_experience/ui';
import { AffichageNav, CATEGORY_ICONS, CategoryIcon } from './shared';

export function CategoriesPage() {
  useDocumentTitle('Catégories · Affichage · GoLink Admin');
  const { admin } = useAdminAccess();
  const q = useMemo(() => query(collection(db, COLLECTIONS.cuisineCategories), orderBy('order'), limit(200)), []);
  const { data, loading, error } = useCollection<CuisineCategory>(q);
  const [editing, setEditing] = useState<WithId<CuisineCategory> | 'new' | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});

  // Commerces en ligne par catégorie (agrégations côté serveur).
  const ids = data.map((c) => c.id).join(',');
  useEffect(() => {
    if (!ids) return;
    let alive = true;
    void Promise.all(
      ids.split(',').map(async (id) => {
        try {
          const snap = await getAggregateFromServer(query(collection(db, COLLECTIONS.restaurants), where('cuisineIds', 'array-contains', id), where('status', '==', 'active')), { n: count() });
          return [id, snap.data().n] as const;
        } catch {
          return [id, -1] as const;
        }
      }),
    ).then((pairs) => alive && setCounts(Object.fromEntries(pairs)));
    return () => {
      alive = false;
    };
  }, [ids]);

  async function reorder(list: string[]) {
    try {
      const batch = writeBatch(db);
      list.forEach((id, index) => batch.update(doc(db, COLLECTIONS.cuisineCategories, id), { order: index, ...updatedFields(admin.uid) }));
      await batch.commit();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  function move(index: number, delta: number) {
    const list = data.map((c) => c.id);
    const target = index + delta;
    if (target < 0 || target >= list.length) return;
    [list[index], list[target]] = [list[target]!, list[index]!];
    void reorder(list);
  }

  function drop(targetId: string) {
    if (!dragId || dragId === targetId) return;
    const list = data.map((c) => c.id).filter((id) => id !== dragId);
    list.splice(list.indexOf(targetId), 0, dragId);
    setDragId(null);
    void reorder(list);
  }

  async function toggle(c: WithId<CuisineCategory>) {
    try {
      await updateDoc(doc(db, COLLECTIONS.cuisineCategories, c.id), { active: !c.active, ...updatedFields(admin.uid) });
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  return (
    <PageContainer wide>
      <PageHeader
        eyebrow="Opérations"
        title="Affichage app client"
        description="Catégories de cuisine et de commerce proposées aux clients, dans l’ordre d’affichage."
        actions={<Button variant="primary" leftIcon={<Plus />} onClick={() => setEditing('new')}>Nouvelle catégorie</Button>}
      />
      <AffichageNav />
      {error ? <Card><LoadError error={error} /></Card> : loading ? (
        <div className="grid gap-2 md:grid-cols-2">{Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="h-16" />)}</div>
      ) : data.length === 0 ? (
        <Card><EmptyState icon={<Tags />} title="Aucune catégorie" action={<Button onClick={() => setEditing('new')}>Créer une catégorie</Button>} /></Card>
      ) : (
        <ol className="grid gap-2 md:grid-cols-2">
          {data.map((c, i) => (
            <li
              key={c.id}
              draggable
              onDragStart={() => setDragId(c.id)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => drop(c.id)}
              className={cn('flex items-center gap-3 rounded-xl border border-border bg-surface px-3 py-2.5 shadow-card', dragId === c.id && 'opacity-50', !c.active && 'bg-surface-2')}
            >
              <GripVertical className="size-4 shrink-0 cursor-grab text-fg-subtle" aria-hidden />
              <span className="w-5 shrink-0 text-right font-mono text-2xs text-fg-subtle num">{i + 1}</span>
              <span className={cn('grid size-10 shrink-0 place-items-center rounded-xl', c.active ? 'bg-primary-soft text-primary-soft-fg' : 'bg-surface-3 text-fg-subtle')}>
                <CategoryIcon name={c.icon} className="size-5" />
              </span>
              <div className="min-w-0 flex-1">
                <div className={cn('truncate font-medium', c.active ? 'text-fg' : 'text-fg-muted')}>{c.name.fr}</div>
                <div className="text-xs text-fg-muted">
                  {counts[c.id] === undefined ? '…' : counts[c.id]! < 0 ? '—' : `${counts[c.id]} commerce${counts[c.id]! > 1 ? 's' : ''} en ligne`}
                  <span className="text-fg-subtle"> · /{c.slug}</span>
                </div>
              </div>
              <IconButton size="sm" variant="ghost" label="Monter" disabled={i === 0} onClick={() => move(i, -1)} className="hidden sm:inline-flex"><ArrowUp /></IconButton>
              <IconButton size="sm" variant="ghost" label="Descendre" disabled={i === data.length - 1} onClick={() => move(i, 1)} className="hidden sm:inline-flex"><ArrowDown /></IconButton>
              <Switch size="sm" checked={c.active} onCheckedChange={() => void toggle(c)} aria-label={c.active ? `Masquer ${c.name.fr}` : `Afficher ${c.name.fr}`} />
              <IconButton size="sm" variant="ghost" label="Modifier" onClick={() => setEditing(c)}><Pencil /></IconButton>
            </li>
          ))}
        </ol>
      )}
      <CategoryDialog key={editing === 'new' ? 'new' : (editing?.id ?? '')} category={editing} onClose={() => setEditing(null)} existingSlugs={data.map((c) => c.slug)} nextOrder={data.length} />
    </PageContainer>
  );
}

function CategoryDialog({ category, onClose, existingSlugs, nextOrder }: { category: WithId<CuisineCategory> | 'new' | null; onClose: () => void; existingSlugs: string[]; nextOrder: number }) {
  const { admin } = useAdminAccess();
  const existing = category && category !== 'new' ? category : null;
  const [name, setName] = useState(existing?.name.fr ?? '');
  const [slug, setSlug] = useState(existing?.slug ?? '');
  const [icon, setIcon] = useState(existing?.icon ?? 'utensils');
  const [saving, setSaving] = useState(false);
  const effectiveSlug = slug || slugify(name);
  const duplicate = !existing && existingSlugs.includes(effectiveSlug);

  async function save() {
    setSaving(true);
    try {
      const fields = { name: { fr: name.trim() }, slug: effectiveSlug, icon };
      if (existing) await updateDoc(doc(db, COLLECTIONS.cuisineCategories, existing.id), { ...fields, ...updatedFields(admin.uid) });
      else await setDoc(doc(db, COLLECTIONS.cuisineCategories, effectiveSlug), { ...fields, image: null, order: nextOrder, active: true, ...createdFields(admin.uid) });
      toast.success('Catégorie enregistrée');
      onClose();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={category !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader icon={<Tags />} title={existing ? 'Modifier la catégorie' : 'Nouvelle catégorie'} description="Les commerces choisissent leurs catégories dans leur back-office." />
        <DialogBody className="space-y-4">
          <FormField label="Nom" required>
            <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} placeholder="Boulangerie" />
          </FormField>
          <FormField label="Adresse" hint={existing ? 'Non modifiable : utilisée dans les liens.' : 'Générée à partir du nom.'} error={duplicate ? 'Cette adresse existe déjà.' : undefined}>
            <Input value={effectiveSlug} disabled={Boolean(existing)} onChange={(e) => setSlug(slugify(e.target.value))} leading="/" />
          </FormField>
          <FormField label="Icône">
            <div className="grid grid-cols-8 gap-1.5">
              {Object.entries(CATEGORY_ICONS).map(([key, node]) => (
                <button
                  key={key}
                  type="button"
                  aria-label={key}
                  aria-pressed={icon === key}
                  onClick={() => setIcon(key)}
                  className={cn('grid aspect-square place-items-center rounded-lg border [&_svg]:size-4', icon === key ? 'border-primary bg-primary-soft text-primary-soft-fg' : 'border-border text-fg-muted hover:bg-surface-2')}
                >
                  {node}
                </button>
              ))}
            </div>
          </FormField>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Annuler</Button>
          <Button variant="primary" loading={saving} disabled={name.trim().length < 2 || !effectiveSlug || duplicate} onClick={() => void save()}>Enregistrer</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
