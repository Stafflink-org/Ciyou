import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { collection, doc, getDoc, limit, orderBy, query, serverTimestamp, setDoc, where } from 'firebase/firestore';
import { FilePlus2, FileText, HelpCircle, Lock, Plus, Scale } from 'lucide-react';
import {
  Badge,
  Button,
  Checkbox,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  EmptyState,
  FormField,
  Input,
  PageContainer,
  PageHeader,
  RadioGroup,
  Skeleton,
  Tooltip,
  formatRelative,
  toast,
} from '@golink/ui';
import {
  COLLECTIONS,
  LEGAL_DOCUMENT_LABELS,
  LEGAL_DOCUMENT_TYPES,
  slugify,
  type ContentPage,
  type ContentPageKind,
  type LegalDocument,
  type WithId,
} from '@golink/shared';
import { useDocumentTitle } from '@golink/web';
import { useAdminAccess } from '@/auth/AdminAccess';
import { db } from '@/lib/firebase';
import { createdFields, errorMessage, useCollection } from '@/lib/firestore';
import { longDate, millis } from '../_experience/format';
import { AUDIENCE_LABELS } from '../_experience/labels';
import { LoadError, Panel } from '../_experience/ui';
import { AffichageNav } from './shared';

type Audience = ContentPage['audience'][number];
const AUDIENCES: Audience[] = ['public', 'client', 'restaurant', 'driver'];

export function pageState(p: ContentPage): { label: string; tone: 'success' | 'amber' | 'neutral' | 'info' } {
  if (p.archivedAt) return { label: 'Archivée', tone: 'neutral' };
  if (!p.published) return { label: 'Brouillon', tone: 'amber' };
  if (p.draft) return { label: 'Modifications non publiées', tone: 'info' };
  return { label: `Publiée${p.version ? ` · v${p.version}` : ''}`, tone: 'success' };
}

export function PagesPage() {
  useDocumentTitle('Pages d’information · Affichage · GoLink Admin');
  const navigate = useNavigate();
  const { admin, can } = useAdminAccess();
  const canLegal = can('legal.edit');
  const pagesQ = useMemo(() => query(collection(db, COLLECTIONS.pages), orderBy('order'), limit(200)), []);
  const pages = useCollection<ContentPage>(pagesQ);
  const legalQ = useMemo(
    () => query(collection(db, COLLECTIONS.legalDocuments), ...(canLegal ? [] : [where('status', '==', 'published')]), limit(300)),
    [canLegal],
  );
  const legal = useCollection<LegalDocument>(legalQ);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const legalGroups = useMemo(() => {
    const map = new Map<string, WithId<LegalDocument>[]>();
    for (const d of legal.data) {
      if (d.status === 'archived') continue;
      const key = `${d.type}|${d.countryId}`;
      map.set(key, [...(map.get(key) ?? []), d]);
    }
    return LEGAL_DOCUMENT_TYPES.flatMap((type) =>
      [...map.entries()].filter(([k]) => k.startsWith(`${type}|`)).map(([k, docs]) => ({
        type,
        countryId: k.split('|')[1]!,
        published: docs.find((d) => d.status === 'published') ?? null,
        draft: docs.find((d) => d.status === 'draft') ?? null,
      })),
    );
  }, [legal.data]);

  async function newVersion(group: (typeof legalGroups)[number]) {
    if (group.draft) {
      navigate(`/affichage/legal/${group.draft.id}`);
      return;
    }
    const base = group.published;
    const version = new Date().toISOString().slice(0, 10);
    const id = `${group.type}-${group.countryId.toLowerCase()}-${version}`;
    setBusy(id);
    try {
      const existing = await getDoc(doc(db, COLLECTIONS.legalDocuments, id));
      if (!existing.exists()) {
        await setDoc(doc(db, COLLECTIONS.legalDocuments, id), {
          type: group.type,
          countryId: group.countryId,
          version,
          title: base?.title ?? { fr: LEGAL_DOCUMENT_LABELS[group.type] },
          content: base?.content ?? { fr: '' },
          pdf: null,
          status: 'draft',
          publishedAt: null,
          effectiveAt: null,
          requiresReacceptance: false,
          changeSummary: null,
          ...createdFields(admin.uid),
        });
      }
      navigate(`/affichage/legal/${id}`);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <PageContainer wide>
      <PageHeader
        eyebrow="Opérations"
        title="Affichage app client"
        description="FAQ, pages d’information et documents légaux, modifiables sans développeur. Chaque publication est versionnée."
        actions={<Button variant="primary" leftIcon={<Plus />} onClick={() => setCreating(true)}>Nouvelle page</Button>}
      />
      <AffichageNav />
      <div className="grid gap-6 xl:grid-cols-2">
        <Panel title="Pages et FAQ" description="Affichées dans l’aide et les menus des applications." bodyClassName="p-0">
          {pages.error ? <LoadError error={pages.error} compact /> : pages.loading ? <div className="p-5"><Skeleton className="h-40" /></div> : pages.data.length === 0 ? (
            <EmptyState compact icon={<FileText />} title="Aucune page" action={<Button size="sm" onClick={() => setCreating(true)}>Créer la FAQ</Button>} />
          ) : (
            <ul className="divide-y divide-border">
              {pages.data.map((p) => {
                const state = pageState(p);
                return (
                  <li key={p.id}>
                    <button type="button" onClick={() => navigate(`/affichage/pages/${p.id}`)} className="flex w-full items-center gap-3 px-5 py-3.5 text-left transition-colors hover:bg-surface-2">
                      <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-surface-3 text-fg-muted [&_svg]:size-4">{p.kind === 'faq' ? <HelpCircle /> : <FileText />}</span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="truncate font-medium text-fg">{(p.draft?.title ?? p.title).fr}</span>
                          <Badge size="sm" tone={state.tone}>{state.label}</Badge>
                        </div>
                        <div className="mt-0.5 truncate text-xs text-fg-muted">/{p.slug} · {p.audience.map((a) => AUDIENCE_LABELS[a]).join(', ')} · modifiée {formatRelative(millis(p.updatedAt))}</div>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>

        <Panel
          title="Documents légaux"
          description="CGU, CGV, confidentialité, mentions légales, par pays. Une version publiée n’est plus modifiable : on en publie une nouvelle."
          actions={!canLegal ? <Tooltip content="Réservé aux membres habilités « Légal et conformité »"><span className="inline-flex items-center gap-1 text-xs text-fg-muted"><Lock className="size-3.5" />Consultation</span></Tooltip> : undefined}
          bodyClassName="p-0"
        >
          {legal.error ? <LoadError error={legal.error} compact /> : legal.loading ? <div className="p-5"><Skeleton className="h-40" /></div> : legalGroups.length === 0 ? (
            <EmptyState compact icon={<Scale />} title="Aucun document légal" />
          ) : (
            <ul className="divide-y divide-border">
              {legalGroups.map((g) => (
                <li key={`${g.type}-${g.countryId}`} className="flex items-center gap-3 px-5 py-3">
                  <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-surface-3 font-mono text-2xs text-fg-muted">{g.countryId}</span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium text-fg">{LEGAL_DOCUMENT_LABELS[g.type]}</div>
                    <div className="text-xs text-fg-muted">
                      {g.published ? `Version ${g.published.version} · en vigueur depuis le ${longDate(millis(g.published.publishedAt))}` : 'Jamais publié'}
                      {g.draft && <span className="text-(--tone-fg) tone-amber"> · brouillon {g.draft.version} en cours</span>}
                    </div>
                  </div>
                  {canLegal ? (
                    <Button size="sm" variant={g.draft ? 'secondary' : 'ghost'} leftIcon={<FilePlus2 />} loading={busy === `${g.type}-${g.countryId.toLowerCase()}-${new Date().toISOString().slice(0, 10)}`} onClick={() => void newVersion(g)}>
                      {g.draft ? 'Reprendre' : 'Nouvelle version'}
                    </Button>
                  ) : g.published ? (
                    <Button size="sm" variant="ghost" onClick={() => navigate(`/affichage/legal/${g.published!.id}`)}>Lire</Button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
      <NewPageDialog open={creating} onOpenChange={setCreating} existing={pages.data.map((p) => p.id)} nextOrder={pages.data.length} />
    </PageContainer>
  );
}

function NewPageDialog({ open, onOpenChange, existing, nextOrder }: { open: boolean; onOpenChange: (o: boolean) => void; existing: string[]; nextOrder: number }) {
  const navigate = useNavigate();
  const { admin } = useAdminAccess();
  const [title, setTitle] = useState('');
  const [slug, setSlug] = useState('');
  const [kind, setKind] = useState<ContentPageKind>('page');
  const [audience, setAudience] = useState<Audience[]>(['public', 'client']);
  const [saving, setSaving] = useState(false);
  const effectiveSlug = slug || slugify(title);
  const duplicate = existing.includes(effectiveSlug);

  async function create() {
    setSaving(true);
    try {
      await setDoc(doc(db, COLLECTIONS.pages, effectiveSlug), {
        slug: effectiveSlug,
        kind,
        title: { fr: title.trim() },
        body: { fr: '' },
        faqItems: kind === 'faq' ? [] : null,
        audience,
        published: false,
        order: nextOrder,
        version: 0,
        publishedAt: null,
        publishedBy: null,
        archivedAt: null,
        draft: { title: { fr: title.trim() }, body: { fr: '' }, faqItems: kind === 'faq' ? [] : null, audience, updatedAt: serverTimestamp(), updatedBy: admin.uid },
        ...createdFields(admin.uid),
      });
      onOpenChange(false);
      navigate(`/affichage/pages/${effectiveSlug}`);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader icon={<FilePlus2 />} title="Nouvelle page" description="Créée en brouillon : rien n’est visible avant publication." />
        <DialogBody className="space-y-4">
          <FormField label="Type">
            <RadioGroup variant="cards" value={kind} onValueChange={(v) => setKind(v as ContentPageKind)} options={[{ value: 'page', label: 'Page', description: 'Texte libre mis en forme.' }, { value: 'faq', label: 'FAQ', description: 'Questions et réponses.' }]} />
          </FormField>
          <FormField label="Titre" required><Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} placeholder="Questions fréquentes" /></FormField>
          <FormField label="Adresse" error={duplicate ? 'Une page utilise déjà cette adresse.' : undefined}>
            <Input value={effectiveSlug} onChange={(e) => setSlug(slugify(e.target.value))} leading="/" />
          </FormField>
          <FormField label="Public">
            <div className="flex flex-wrap gap-4">
              {AUDIENCES.map((a) => <Checkbox key={a} label={AUDIENCE_LABELS[a]} checked={audience.includes(a)} onCheckedChange={(v) => setAudience((cur) => (v === true ? [...cur, a] : cur.filter((x) => x !== a)))} />)}
            </div>
          </FormField>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Annuler</Button>
          <Button variant="primary" loading={saving} disabled={title.trim().length < 3 || !effectiveSlug || duplicate || audience.length === 0} onClick={() => void create()}>Créer et rédiger</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

