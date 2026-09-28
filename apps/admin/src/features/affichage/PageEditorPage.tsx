import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router';
import { collection, doc, limit, orderBy, query, serverTimestamp, updateDoc } from 'firebase/firestore';
import { ArrowDown, ArrowUp, EyeOff, FileText, History, Plus, RotateCcw, Save, Send, Trash2 } from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  Checkbox,
  ConfirmDialog,
  EmptyState,
  FormField,
  IconButton,
  Input,
  PageContainer,
  PageHeader,
  Skeleton,
  Switch,
  formatDateTime,
  formatRelative,
  toast,
} from '@golink/ui';
import { COLLECTIONS, SUBCOLLECTIONS, type ContentPage, type ContentPageVersion, type FaqItem, type PublishPageInput } from '@golink/shared';
import { useDocumentTitle } from '@golink/web';
import { useAdminAccess } from '@/auth/AdminAccess';
import { db } from '@/lib/firebase';
import { docAt, errorMessage, updatedFields, useCollection, useDoc, useMutation } from '@/lib/firestore';
import { callFunctionWithReasonIn } from '@/lib/reason';
import { millis } from '../_experience/format';
import { AUDIENCE_LABELS } from '../_experience/labels';
import { LoadError, Panel, RichText, RichTextEditor } from '../_experience/ui';
import { pageState } from './PagesPage';
import { PhoneFrame } from './shared';

type Audience = ContentPage['audience'][number];
const AUDIENCES: Audience[] = ['public', 'client', 'restaurant', 'driver'];
const publish = callFunctionWithReasonIn<PublishPageInput, { version: number | string }>('publishPage', 'changeSummary', { title: 'Publier cette version', description: 'Résumé du changement : conservé dans le journal d’audit et l’historique des versions.', confirmLabel: 'Publier' });
const newId = () => Math.random().toString(36).slice(2, 10);

export function PageEditorPage() {
  const { slug = '' } = useParams();
  const { admin } = useAdminAccess();
  const page = useDoc<ContentPage>(docAt(`${COLLECTIONS.pages}/${slug}`));
  const versionsQ = useMemo(() => query(collection(db, COLLECTIONS.pages, slug, SUBCOLLECTIONS.pages.versions), orderBy('version', 'desc'), limit(30)), [slug]);
  const versions = useCollection<ContentPageVersion>(versionsQ);
  useDocumentTitle(`${page.data?.title.fr ?? 'Page'} · Affichage · GoLink Admin`);

  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [faq, setFaq] = useState<FaqItem[]>([]);
  const [audience, setAudience] = useState<Audience[]>([]);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirm, setConfirm] = useState<'publish' | 'unpublish' | 'archive' | null>(null);
  const publishMutation = useMutation(publish, { success: (r) => `Version ${r.version} publiée` });

  // Chargement initial du brouillon (ou de la version publiée).
  useEffect(() => {
    if (!page.data || loadedFor === slug) return;
    const src = page.data.draft ?? page.data;
    setTitle(src.title.fr ?? '');
    setBody(src.body.fr ?? '');
    setFaq(src.faqItems ?? []);
    setAudience(src.audience);
    setLoadedFor(slug);
  }, [page.data, slug, loadedFor]);

  if (page.loading) return <PageContainer wide><Skeleton className="mb-6 h-10 w-1/2" /><Skeleton className="h-[520px]" /></PageContainer>;
  if (page.error || page.missing || !page.data) {
    return (
      <PageContainer>
        <Card>{page.error ? <LoadError error={page.error} /> : <EmptyState icon={<FileText />} title="Page introuvable" action={<Button asChild><Link to="/affichage/pages">Retour aux pages</Link></Button>} />}</Card>
      </PageContainer>
    );
  }

  const data = page.data;
  const isFaq = (data.kind ?? 'page') === 'faq';
  const draftSource = data.draft ?? data;
  const dirty = title !== (draftSource.title.fr ?? '') || body !== (draftSource.body.fr ?? '') || JSON.stringify(faq) !== JSON.stringify(draftSource.faqItems ?? []) || JSON.stringify(audience) !== JSON.stringify(draftSource.audience);
  const hasDraft = Boolean(data.draft) || dirty;
  const state = pageState(data);
  const valid = title.trim().length >= 3 && audience.length > 0 && (isFaq ? faq.length > 0 && faq.every((f) => f.question.trim() && f.answer.trim()) : body.trim().length >= 10);

  async function saveDraft(silent = false): Promise<boolean> {
    setSaving(true);
    try {
      await updateDoc(doc(db, COLLECTIONS.pages, slug), {
        draft: { title: { fr: title.trim() }, body: { fr: body.trim() }, faqItems: isFaq ? faq.map((f) => ({ ...f, question: f.question.trim(), answer: f.answer.trim() })) : null, audience, updatedAt: serverTimestamp(), updatedBy: admin.uid },
        ...updatedFields(admin.uid),
      });
      if (!silent) toast.success('Brouillon enregistré');
      return true;
    } catch (e) {
      toast.error(errorMessage(e));
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function simpleUpdate(fields: Record<string, unknown>, message: string) {
    try {
      await updateDoc(doc(db, COLLECTIONS.pages, slug), { ...fields, ...updatedFields(admin.uid) });
      toast.success(message);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  function restore(v: ContentPageVersion) {
    setTitle(v.title.fr ?? '');
    setBody(v.body.fr ?? '');
    setFaq(v.faqItems ?? []);
    setAudience(v.audience);
    toast.info(`Version ${v.version} chargée dans l’éditeur : enregistrez ou publiez pour l’appliquer.`);
  }

  const updateFaq = (id: string, patch: Partial<FaqItem>) => setFaq((list) => list.map((f) => (f.id === id ? { ...f, ...patch } : f)));
  const moveFaq = (index: number, delta: number) => setFaq((list) => {
    const next = [...list];
    const target = index + delta;
    if (target < 0 || target >= next.length) return list;
    [next[index], next[target]] = [next[target]!, next[index]!];
    return next;
  });

  return (
    <PageContainer wide>
      <PageHeader
        breadcrumbs={[{ label: 'Pages d’information', href: '/affichage/pages' }, { label: data.title.fr }]}
        eyebrow={<span className="flex items-center gap-2">/{data.slug} · {isFaq ? 'FAQ' : 'Page'}</span>}
        title={title || 'Sans titre'}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button leftIcon={<Save />} loading={saving} disabled={!dirty} onClick={() => void saveDraft()}>Enregistrer le brouillon</Button>
            <Button variant="primary" leftIcon={<Send />} disabled={!valid || (!hasDraft && data.published)} onClick={() => setConfirm('publish')}>Publier</Button>
          </div>
        }
      >
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Badge tone={state.tone}>{state.label}</Badge>
          {data.publishedAt && <span className="text-xs text-fg-muted">Dernière publication {formatRelative(millis(data.publishedAt))}</span>}
          {dirty && <Badge tone="amber" variant="outline">Modifications non enregistrées</Badge>}
        </div>
      </PageHeader>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 space-y-6">
          <Panel title="Contenu">
            <div className="space-y-4">
              <FormField label="Titre" required><Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} /></FormField>
              <FormField label="Public">
                <div className="flex flex-wrap gap-4">
                  {AUDIENCES.map((a) => <Checkbox key={a} label={AUDIENCE_LABELS[a]} checked={audience.includes(a)} onCheckedChange={(v) => setAudience((cur) => (v === true ? [...cur, a] : cur.filter((x) => x !== a)))} />)}
                </div>
              </FormField>
              {!isFaq && (
                <FormField label="Texte" required>
                  <RichTextEditor value={body} onChange={setBody} minRows={18} aria-label="Texte de la page" />
                </FormField>
              )}
            </div>
          </Panel>
          {isFaq && (
            <Panel title={`Questions · ${faq.length}`} actions={<Button size="sm" leftIcon={<Plus />} onClick={() => setFaq((l) => [...l, { id: newId(), question: '', answer: '', category: null }])}>Ajouter une question</Button>}>
              {faq.length === 0 ? <EmptyState compact icon={<FileText />} title="Aucune question" description="Commencez par les questions les plus posées au support." /> : (
                <ol className="space-y-4">
                  {faq.map((f, i) => (
                    <li key={f.id} className="rounded-xl border border-border bg-surface-2 p-4">
                      <div className="mb-3 flex items-center gap-2">
                        <span className="font-mono text-2xs text-fg-subtle num">Q{i + 1}</span>
                        <Input value={f.category ?? ''} onChange={(e) => updateFaq(f.id, { category: e.target.value || null })} placeholder="Rubrique (facultatif)" size="sm" className="w-44" maxLength={40} />
                        <div className="ml-auto flex">
                          <IconButton size="sm" variant="ghost" label="Monter" disabled={i === 0} onClick={() => moveFaq(i, -1)}><ArrowUp /></IconButton>
                          <IconButton size="sm" variant="ghost" label="Descendre" disabled={i === faq.length - 1} onClick={() => moveFaq(i, 1)}><ArrowDown /></IconButton>
                          <IconButton size="sm" variant="danger" label="Supprimer la question" onClick={() => setFaq((l) => l.filter((x) => x.id !== f.id))}><Trash2 /></IconButton>
                        </div>
                      </div>
                      <FormField label="Question"><Input value={f.question} onChange={(e) => updateFaq(f.id, { question: e.target.value })} maxLength={160} /></FormField>
                      <FormField label="Réponse" className="mt-3"><RichTextEditor value={f.answer} onChange={(v) => updateFaq(f.id, { answer: v })} minRows={5} aria-label={`Réponse ${i + 1}`} /></FormField>
                    </li>
                  ))}
                </ol>
              )}
            </Panel>
          )}
        </div>

        <aside className="min-w-0 space-y-6">
          <div>
            <h2 className="mb-3 font-display text-md font-semibold">Aperçu</h2>
            <PhoneFrame>
              <div className="px-5 pb-8">
                <p className="font-display text-xl font-semibold leading-tight tracking-tight">{title || 'Sans titre'}</p>
                {isFaq ? (
                  <div className="mt-4 divide-y divide-cream-200">
                    {faq.map((f) => (
                      <details key={f.id} className="py-3" open={faq.length <= 2}>
                        <summary className="cursor-pointer text-sm font-semibold">{f.question || 'Question'}</summary>
                        <RichText source={f.answer} className="mt-2 text-xs text-petrol-700" />
                      </details>
                    ))}
                  </div>
                ) : <RichText source={body} className="mt-4 text-xs text-petrol-700" />}
              </div>
            </PhoneFrame>
          </div>

          <Panel title="Historique des versions" bodyClassName="p-0">
            {versions.loading ? <div className="p-5"><Skeleton className="h-20" /></div> : versions.data.length === 0 ? (
              <p className="px-5 py-4 text-sm text-fg-muted">Aucune version publiée pour l’instant.</p>
            ) : (
              <ul className="divide-y divide-border">
                {versions.data.map((v) => (
                  <li key={v.id} className="flex items-center gap-3 px-5 py-3">
                    <History className="size-4 shrink-0 text-fg-subtle" />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium text-fg">Version {v.version}</div>
                      <div className="truncate text-xs text-fg-muted">{formatDateTime(millis(v.publishedAt))} · {v.publishedByName}{v.changeSummary ? ` · ${v.changeSummary}` : ''}</div>
                    </div>
                    <IconButton size="sm" variant="ghost" label="Charger cette version" onClick={() => restore(v)}><RotateCcw /></IconButton>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel title="Visibilité">
            <div className="space-y-3">
              <Switch
                checked={data.published}
                disabled={!data.version}
                onCheckedChange={(v) => (v ? void simpleUpdate({ published: true }, 'Page de nouveau visible') : setConfirm('unpublish'))}
                label="Visible dans les applications"
                description={data.version ? 'Dépublier retire la page sans perdre son contenu.' : 'Publiez une première version pour l’afficher.'}
              />
              {!data.archivedAt && <Button size="sm" variant="ghost" leftIcon={<EyeOff />} onClick={() => setConfirm('archive')}>Archiver la page</Button>}
            </div>
          </Panel>
        </aside>
      </div>

      <ConfirmDialog
        open={confirm === 'publish'}
        onOpenChange={(o) => !o && setConfirm(null)}
        title="Publier cette version ?"
        description="Elle remplace immédiatement la version en ligne ; l’ancienne reste dans l’historique."
        confirmLabel="Publier"
        requireReason
        reasonLabel="Résumé des modifications (historique et journal d’audit)"
        onConfirm={async (reason) => {
          if (dirty && !(await saveDraft(true))) return;
          const r = await publishMutation.mutate({ kind: 'page', id: slug, changeSummary: reason ?? null });
          if (r) setLoadedFor(null);
        }}
      />
      <ConfirmDialog
        open={confirm === 'unpublish'}
        onOpenChange={(o) => !o && setConfirm(null)}
        title="Retirer cette page des applications ?"
        destructive
        confirmLabel="Dépublier"
        onConfirm={() => simpleUpdate({ published: false }, 'Page retirée des applications')}
      />
      <ConfirmDialog
        open={confirm === 'archive'}
        onOpenChange={(o) => !o && setConfirm(null)}
        title="Archiver cette page ?"
        description="Elle est retirée des applications et de la liste ; l’historique est conservé."
        destructive
        confirmLabel="Archiver"
        onConfirm={() => simpleUpdate({ published: false, archivedAt: serverTimestamp() }, 'Page archivée')}
      />
    </PageContainer>
  );
}
