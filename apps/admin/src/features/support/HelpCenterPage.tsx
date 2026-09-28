import { useMemo, useState } from 'react';
import { collection, doc, limit, orderBy, query, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import { Archive, BookOpenText, Eye, FileText, Plus, Search, ThumbsUp } from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  Checkbox,
  EmptyState,
  FormField,
  Input,
  PageContainer,
  PageHeader,
  SegmentedControl,
  Sheet,
  SheetBody,
  SheetContent,
  SheetFooter,
  SheetHeader,
  Skeleton,
  Switch,
  cn,
  formatNumber,
  formatPercent,
  formatRelative,
  toast,
} from '@golink/ui';
import { COLLECTIONS, richTextToPlain, type HelpArticle, type WithId } from '@golink/shared';
import { useDocumentTitle } from '@golink/web';
import { useAdminAccess } from '@/auth/AdminAccess';
import { db } from '@/lib/firebase';
import { createdFields, errorMessage, updatedFields, useCollection } from '@/lib/firestore';
import { millis } from '../_experience/format';
import { AUDIENCE_LABELS } from '../_experience/labels';
import { Kpi, LoadError, RichText, RichTextEditor } from '../_experience/ui';
import { SupportNav } from './components';

type Audience = HelpArticle['audience'][number];
const AUDIENCES: Audience[] = ['client', 'restaurant', 'driver'];

export function HelpCenterPage() {
  useDocumentTitle('Centre d’aide · Support · Ciyou Eats Admin');
  const { can } = useAdminAccess();
  const editable = can('support.configure');
  const q = useMemo(() => query(collection(db, COLLECTIONS.helpArticles), orderBy('order'), limit(500)), []);
  const { data, loading, error } = useCollection<HelpArticle>(q);
  const [audience, setAudience] = useState<'all' | Audience | 'archived'>('all');
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<WithId<HelpArticle> | 'new' | null>(null);

  const live = data.filter((a) => !a.archivedAt);
  const visible = (audience === 'archived' ? data.filter((a) => a.archivedAt) : live.filter((a) => audience === 'all' || a.audience.includes(audience)))
    .filter((a) => !search || `${a.title.fr} ${a.category} ${a.tags.join(' ')} ${a.body.fr}`.toLowerCase().includes(search.toLowerCase()));
  const groups = useMemo(() => {
    const map = new Map<string, WithId<HelpArticle>[]>();
    for (const a of visible) map.set(a.category, [...(map.get(a.category) ?? []), a]);
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0], 'fr'));
  }, [visible]);

  const views = live.reduce((s, a) => s + a.views, 0);
  const yes = live.reduce((s, a) => s + a.helpfulYes, 0);
  const no = live.reduce((s, a) => s + a.helpfulNo, 0);
  const categories = [...new Set(data.map((a) => a.category))].sort((a, b) => a.localeCompare(b, 'fr'));

  return (
    <PageContainer wide>
      <PageHeader
        eyebrow="Opérations"
        title="Support et litiges"
        description="Articles d’aide pour les clients, restaurants et livreurs : chaque réponse publiée ici évite un ticket."
        actions={editable ? <Button variant="primary" leftIcon={<Plus />} onClick={() => setEditing('new')}>Nouvel article</Button> : undefined}
      />
      <SupportNav />
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Articles publiés" value={loading ? '…' : live.filter((a) => a.published).length} icon={<BookOpenText />} tone="brand" hint={`${live.filter((a) => !a.published).length} brouillons`} />
        <Kpi label="Consultations" value={formatNumber(views)} icon={<Eye />} tone="info" />
        <Kpi label="Jugés utiles" value={yes + no ? formatPercent(yes / (yes + no)) : '—'} icon={<ThumbsUp />} tone="success" hint={`${formatNumber(yes + no)} votes`} />
        <Kpi label="Catégories" value={categories.length} icon={<FileText />} />
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="overflow-x-auto [scrollbar-width:none]">
          <SegmentedControl
            value={audience}
            onValueChange={(v) => setAudience(v as typeof audience)}
            options={[
              { value: 'all', label: 'Tous', count: live.length },
              ...AUDIENCES.map((a) => ({ value: a, label: AUDIENCE_LABELS[a]!, count: live.filter((x) => x.audience.includes(a)).length })),
              { value: 'archived', label: 'Archivés' },
            ]}
            aria-label="Public"
          />
        </div>
        <Input className="w-full sm:ml-auto sm:w-72" leading={<Search />} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Rechercher un article…" />
      </div>

      {error ? <Card><LoadError error={error} /></Card> : loading ? (
        <div className="grid gap-3 md:grid-cols-2"><Skeleton className="h-28" /><Skeleton className="h-28" /><Skeleton className="h-28" /></div>
      ) : groups.length === 0 ? (
        <Card><EmptyState icon={<BookOpenText />} title="Aucun article" description={search ? 'Aucun article ne correspond à la recherche.' : 'Rédigez les réponses aux questions les plus fréquentes.'} action={editable && !search ? <Button onClick={() => setEditing('new')}>Rédiger un article</Button> : undefined} /></Card>
      ) : (
        <div className="space-y-8">
          {groups.map(([category, articles]) => (
            <section key={category}>
              <h2 className="eyebrow mb-3">{category} · {articles.length}</h2>
              <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
                {articles.map((a) => {
                  const votes = a.helpfulYes + a.helpfulNo;
                  return (
                    <Card key={a.id} interactive className="flex flex-col p-4" role="button" tabIndex={0} onClick={() => setEditing(a)} onKeyDown={(e) => e.key === 'Enter' && setEditing(a)}>
                      <div className="flex items-start justify-between gap-3">
                        <h3 className="font-medium text-fg">{a.title.fr}</h3>
                        {a.archivedAt ? <Badge tone="neutral" size="sm">Archivé</Badge> : a.published ? <Badge tone="success" size="sm">Publié</Badge> : <Badge tone="amber" size="sm">Brouillon</Badge>}
                      </div>
                      <p className="mt-1 line-clamp-2 text-sm text-fg-muted" title={String(richTextToPlain(a.body.fr) ?? '')}>{richTextToPlain(a.body.fr)}</p>
                      <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 pt-3 text-xs text-fg-subtle">
                        <span className="flex min-w-0 max-w-full flex-wrap gap-1">{a.audience.map((x) => <Badge key={x} size="sm" tone="neutral" variant="outline">{AUDIENCE_LABELS[x]}</Badge>)}</span>
                        <span className="flex items-center gap-1"><Eye className="size-3" />{formatNumber(a.views)}</span>
                        <span className="flex items-center gap-1"><ThumbsUp className="size-3" />{votes ? formatPercent(a.helpfulYes / votes) : '—'}</span>
                        <span className="ml-auto">{formatRelative(millis(a.updatedAt))}</span>
                      </div>
                    </Card>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}
      <ArticleSheet article={editing} onClose={() => setEditing(null)} editable={editable} categories={categories} nextOrder={data.length} />
    </PageContainer>
  );
}

function ArticleSheet({ article, onClose, editable, categories, nextOrder }: { article: WithId<HelpArticle> | 'new' | null; onClose: () => void; editable: boolean; categories: string[]; nextOrder: number }) {
  const existing = article && article !== 'new' ? article : null;
  const key = article === 'new' ? 'new' : (existing?.id ?? '');
  return (
    <Sheet open={article !== null} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full sm:max-w-2xl">
        {article !== null && <ArticleForm key={key} existing={existing} onClose={onClose} editable={editable} categories={categories} nextOrder={nextOrder} />}
      </SheetContent>
    </Sheet>
  );
}

function ArticleForm({ existing, onClose, editable, categories, nextOrder }: { existing: WithId<HelpArticle> | null; onClose: () => void; editable: boolean; categories: string[]; nextOrder: number }) {
  const { admin } = useAdminAccess();
  const [title, setTitle] = useState(existing?.title.fr ?? '');
  const [category, setCategory] = useState(existing?.category ?? '');
  const [audience, setAudience] = useState<Audience[]>(existing?.audience ?? ['client']);
  const [tags, setTags] = useState(existing?.tags.join(', ') ?? '');
  const [body, setBody] = useState(existing?.body.fr ?? '');
  const [published, setPublished] = useState(existing?.published ?? false);
  const [saving, setSaving] = useState(false);
  const valid = title.trim().length >= 3 && category.trim() && audience.length > 0 && body.trim().length >= 10;

  async function save(extra: Record<string, unknown> = {}) {
    setSaving(true);
    try {
      const fields = {
        title: { fr: title.trim() },
        body: { fr: body.trim() },
        category: category.trim(),
        audience,
        tags: tags.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean),
        published,
        ...extra,
      };
      if (existing) {
        await updateDoc(doc(db, COLLECTIONS.helpArticles, existing.id), { ...fields, ...updatedFields(admin.uid) });
      } else {
        await setDoc(doc(collection(db, COLLECTIONS.helpArticles)), { ...fields, order: nextOrder, archivedAt: null, views: 0, helpfulYes: 0, helpfulNo: 0, ...createdFields(admin.uid) });
      }
      toast.success(extra.archivedAt ? 'Article archivé' : published ? 'Article publié' : 'Brouillon enregistré');
      onClose();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  if (!editable && existing) {
    return (
      <>
        <SheetHeader title={existing.title.fr} description={`${existing.category} · ${existing.audience.map((a) => AUDIENCE_LABELS[a]).join(', ')}`} />
        <SheetBody><RichText source={existing.body.fr} /></SheetBody>
      </>
    );
  }

  return (
    <>
      <SheetHeader title={existing ? 'Modifier l’article' : 'Nouvel article'} description="Texte enrichi : titres, listes, gras et liens, avec aperçu." />
      <SheetBody className="space-y-4">
        <FormField label="Titre" required>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} placeholder="Il manque un article dans ma commande" />
        </FormField>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="Catégorie" required>
            <Input list="aide-categories" value={category} onChange={(e) => setCategory(e.target.value)} maxLength={40} placeholder="Réclamations" />
          </FormField>
          <datalist id="aide-categories">{categories.map((c) => <option key={c} value={c} />)}</datalist>
          <FormField label="Mots-clés" hint="Séparés par des virgules.">
            <Input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="remboursement, oubli" />
          </FormField>
        </div>
        <FormField label="Public">
          <div className="flex flex-wrap gap-4">
            {AUDIENCES.map((a) => (
              <Checkbox key={a} label={AUDIENCE_LABELS[a]} checked={audience.includes(a)} onCheckedChange={(v) => setAudience((cur) => (v === true ? [...cur, a] : cur.filter((x) => x !== a)))} />
            ))}
          </div>
        </FormField>
        <FormField label="Contenu" required>
          <RichTextEditor value={body} onChange={setBody} minRows={14} aria-label="Contenu de l’article" />
        </FormField>
        <Switch checked={published} onCheckedChange={setPublished} label="Publié dans le centre d’aide" description="Visible immédiatement dans les applications du public choisi." />
      </SheetBody>
      <SheetFooter className={cn('flex-wrap', existing && 'justify-between')}>
        {existing && !existing.archivedAt && (
          <Button variant="ghost" leftIcon={<Archive />} disabled={saving} onClick={() => void save({ published: false, archivedAt: serverTimestamp() })}>Archiver</Button>
        )}
        {existing?.archivedAt && (
          <Button variant="ghost" disabled={saving} onClick={() => void save({ archivedAt: null })}>Restaurer</Button>
        )}
        <div className="flex gap-2">
          <Button variant="ghost" onClick={onClose}>Annuler</Button>
          <Button variant="primary" loading={saving} disabled={!valid} onClick={() => void save()}>Enregistrer</Button>
        </div>
      </SheetFooter>
    </>
  );
}
