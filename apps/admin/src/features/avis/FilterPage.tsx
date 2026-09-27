import { useMemo, useState } from 'react';
import { collection, deleteDoc, doc, limit, orderBy, query, setDoc, updateDoc } from 'firebase/firestore';
import { Ban, CheckCircle2, Flag, FlaskConical, Plus, ShieldCheck, Trash2 } from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  FormField,
  IconButton,
  Input,
  PageContainer,
  PageHeader,
  Select,
  Skeleton,
  Switch,
  Textarea,
  cn,
  toast,
} from '@golink/ui';
import {
  COLLECTIONS,
  DEFAULT_MODERATION_RULES,
  MODERATION_CATEGORY_LABELS,
  scanReviewText,
  type ModerationCategory,
  type ModerationTerm,
} from '@golink/shared';
import { useDocumentTitle } from '@golink/web';
import { useAdminAccess } from '@/auth/AdminAccess';
import { db } from '@/lib/firebase';
import { createdFields, errorMessage, updatedFields, useCollection } from '@/lib/firestore';
import { LoadError, Panel } from '../_experience/ui';
import { AvisNav } from './components';

const CATEGORIES = Object.keys(MODERATION_CATEGORY_LABELS) as ModerationCategory[];

export function FilterPage() {
  useDocumentTitle('Filtre automatique · Avis · Ciyou Eats Admin');
  const { admin, can } = useAdminAccess();
  const editable = can('reviews.moderate');
  const q = useMemo(() => query(collection(db, COLLECTIONS.moderationTerms), orderBy('term'), limit(500)), []);
  const terms = useCollection<ModerationTerm>(q);
  const [term, setTerm] = useState('');
  const [category, setCategory] = useState<ModerationCategory>('insult');
  const [action, setAction] = useState<'block' | 'flag'>('block');
  const [sample, setSample] = useState('Livraison rapide mais le livreur était vraiment un c0nnard, appelez-moi au 06 12 34 56 78.');
  const [saving, setSaving] = useState(false);

  const rules = useMemo(() => [...DEFAULT_MODERATION_RULES, ...terms.data.filter((t) => t.active).map((t) => ({ term: t.term, category: t.category, action: t.action }))], [terms.data]);
  const verdict = useMemo(() => scanReviewText(sample, rules), [sample, rules]);
  const defaults = useMemo(() => {
    const map = new Map<ModerationCategory, string[]>();
    for (const r of DEFAULT_MODERATION_RULES) map.set(r.category, [...(map.get(r.category) ?? []), r.term]);
    return [...map.entries()];
  }, []);

  async function add() {
    const value = term.trim().toLowerCase();
    if (value.length < 2) return;
    if (terms.data.some((t) => t.term === value) || DEFAULT_MODERATION_RULES.some((r) => r.term === value)) {
      toast.error('Ce terme est déjà surveillé.');
      return;
    }
    setSaving(true);
    try {
      await setDoc(doc(collection(db, COLLECTIONS.moderationTerms)), { term: value, category, action, active: true, hits: 0, ...createdFields(admin.uid) });
      setTerm('');
      toast.success('Terme ajouté au filtre');
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  async function update(t: ModerationTerm & { id: string }, fields: Partial<ModerationTerm>) {
    try {
      await updateDoc(doc(db, COLLECTIONS.moderationTerms, t.id), { term: t.term, action: t.action, ...fields, ...updatedFields(admin.uid) });
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  async function remove(id: string) {
    try {
      await deleteDoc(doc(db, COLLECTIONS.moderationTerms, id));
      toast.success('Terme retiré');
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  return (
    <PageContainer wide>
      <PageHeader
        eyebrow="Opérations"
        title="Avis et notes"
        description="Chaque nouvel avis est analysé avant publication : insultes, propos haineux, menaces et coordonnées personnelles bloquent la publication ; les autres termes signalent l’avis."
      />
      <AvisNav />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
        <div className="min-w-0 space-y-6">
          <Panel
            title="Termes ajoutés par l’équipe"
            description="Complètent la liste de base. « Bloquer » retient l’avis en modération ; « Signaler » le publie avec un indicateur."
            bodyClassName="p-0"
          >
            {editable && (
              <div className="grid gap-3 border-b border-border p-5 sm:grid-cols-[minmax(0,1fr)_170px_150px_auto] sm:items-end">
                <FormField label="Terme ou expression">
                  <Input value={term} onChange={(e) => setTerm(e.target.value)} maxLength={60} placeholder="ex. radin" onKeyDown={(e) => e.key === 'Enter' && void add()} />
                </FormField>
                <FormField label="Catégorie">
                  <Select value={category} onValueChange={(v) => setCategory(v as ModerationCategory)} options={CATEGORIES.map((c) => ({ value: c, label: MODERATION_CATEGORY_LABELS[c] }))} />
                </FormField>
                <FormField label="Action">
                  <Select value={action} onValueChange={(v) => setAction(v as 'block' | 'flag')} options={[{ value: 'block', label: 'Bloquer' }, { value: 'flag', label: 'Signaler' }]} />
                </FormField>
                <Button variant="primary" leftIcon={<Plus />} loading={saving} disabled={term.trim().length < 2} onClick={() => void add()}>Ajouter</Button>
              </div>
            )}
            {terms.error ? <LoadError error={terms.error} compact /> : terms.loading ? <div className="p-5"><Skeleton className="h-24" /></div> : terms.data.length === 0 ? (
              <EmptyState compact icon={<ShieldCheck />} title="Aucun terme ajouté" description="La liste de base s’applique. Ajoutez les termes propres à votre marché." />
            ) : (
              <ul className="divide-y divide-border">
                {terms.data.map((t) => (
                  <li key={t.id} className={cn('flex flex-wrap items-center gap-3 px-5 py-3', !t.active && 'opacity-60')}>
                    <span className="font-mono text-sm text-fg">{t.term}</span>
                    <Badge size="sm" tone="neutral" variant="outline">{MODERATION_CATEGORY_LABELS[t.category]}</Badge>
                    <Badge size="sm" tone={t.action === 'block' ? 'danger' : 'amber'} icon={t.action === 'block' ? <Ban /> : <Flag />}>{t.action === 'block' ? 'Bloque' : 'Signale'}</Badge>
                    <span className="text-xs text-fg-subtle">{t.hits} détection{t.hits > 1 ? 's' : ''}</span>
                    {editable && (
                      <div className="ml-auto flex items-center gap-2">
                        <Select size="sm" className="w-28" value={t.action} onValueChange={(v) => void update(t, { action: v as 'block' | 'flag' })} options={[{ value: 'block', label: 'Bloquer' }, { value: 'flag', label: 'Signaler' }]} aria-label="Action" />
                        <Switch size="sm" checked={t.active} onCheckedChange={(v) => void update(t, { active: v })} aria-label="Actif" />
                        <IconButton size="sm" variant="danger" label="Retirer" onClick={() => void remove(t.id)}><Trash2 /></IconButton>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel title="Liste de base" description="Maintenue par Ciyou Eats, appliquée à tous les marchés (déjoue les contournements courants : chiffres pour lettres, lettres répétées).">
            <div className="space-y-4">
              {defaults.map(([cat, list]) => (
                <div key={cat}>
                  <div className="mb-1.5 flex items-center gap-2 text-xs font-medium text-fg-muted">
                    {MODERATION_CATEGORY_LABELS[cat]}
                    <span className="text-fg-subtle">· {list.length}</span>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {list.map((t) => <span key={t} className="rounded-md bg-surface-3 px-1.5 py-0.5 font-mono text-2xs text-fg-muted blur-[3px] transition hover:blur-none">{t}</span>)}
                  </div>
                </div>
              ))}
              <p className="text-xs text-fg-subtle">Termes floutés : survolez pour les lire. Coordonnées (e-mail, téléphone) bloquées ; liens signalés.</p>
            </div>
          </Panel>
        </div>

        <Card className="h-fit p-5 xl:sticky xl:top-20">
          <div className="mb-3 flex items-center gap-2 font-display text-md font-semibold"><FlaskConical className="size-4 text-fg-muted" />Tester un avis</div>
          <Textarea rows={5} value={sample} onChange={(e) => setSample(e.target.value)} maxLength={1000} aria-label="Texte à tester" />
          <div className={cn('mt-4 rounded-xl border p-4', verdict.blocked ? 'tone-danger' : verdict.flagged ? 'tone-amber' : 'tone-success', 'border-(--tone-border) bg-(--tone-bg)')}>
            <div className="flex items-center gap-2 font-medium text-(--tone-fg)">
              {verdict.blocked ? <Ban className="size-4" /> : verdict.flagged ? <Flag className="size-4" /> : <CheckCircle2 className="size-4" />}
              {verdict.blocked ? 'Retenu en modération' : verdict.flagged ? 'Publié avec indicateur' : 'Publié'}
            </div>
            {verdict.matches.length > 0 && (
              <ul className="mt-2 space-y-1 text-sm text-fg">
                {verdict.matches.map((m) => <li key={m.term}>« {m.term} » · {MODERATION_CATEGORY_LABELS[m.category]} · {m.action === 'block' ? 'bloque' : 'signale'}</li>)}
              </ul>
            )}
          </div>
        </Card>
      </div>
    </PageContainer>
  );
}
