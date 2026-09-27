import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { doc, updateDoc } from 'firebase/firestore';
import { Lock, Save, Scale, Send } from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  FormField,
  Input,
  PageContainer,
  PageHeader,
  Skeleton,
  Switch,
  toast,
} from '@golink/ui';
import { COLLECTIONS, LEGAL_DOCUMENT_LABELS, type LegalDocument, type PublishPageInput } from '@golink/shared';
import { useDocumentTitle } from '@golink/web';
import { useAdminAccess } from '@/auth/AdminAccess';
import { db } from '@/lib/firebase';
import { docAt, errorMessage, updatedFields, useDoc, useMutation } from '@/lib/firestore';
import { callFunctionWithReasonIn } from '@/lib/reason';
import { longDate, millis } from '../_experience/format';
import { LoadError, Panel, RichText, RichTextEditor } from '../_experience/ui';

const publish = callFunctionWithReasonIn<PublishPageInput, { version: string }>('publishPage', 'changeSummary', { title: 'Publier cette version', description: 'Résumé du changement : conservé dans le journal d’audit et l’historique des versions.', confirmLabel: 'Publier' });

export function LegalEditorPage() {
  const { documentId = '' } = useParams();
  const navigate = useNavigate();
  const { admin, can } = useAdminAccess();
  const legal = useDoc<LegalDocument>(docAt(`${COLLECTIONS.legalDocuments}/${documentId}`));
  useDocumentTitle(`${legal.data ? LEGAL_DOCUMENT_LABELS[legal.data.type] : 'Document légal'} · GoLink Admin`);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [summary, setSummary] = useState('');
  const [reaccept, setReaccept] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const { mutate } = useMutation(publish, { success: (r) => `Version ${r.version} publiée` });

  useEffect(() => {
    if (!legal.data || loaded) return;
    setTitle(legal.data.title.fr ?? '');
    setContent(legal.data.content.fr ?? '');
    setSummary(legal.data.changeSummary ?? '');
    setReaccept(legal.data.requiresReacceptance);
    setLoaded(true);
  }, [legal.data, loaded]);

  if (legal.loading) return <PageContainer><Skeleton className="h-[480px]" /></PageContainer>;
  if (legal.error || legal.missing || !legal.data) {
    return <PageContainer><Card>{legal.error ? <LoadError error={legal.error} /> : <EmptyState icon={<Scale />} title="Document introuvable" action={<Button asChild><Link to="/affichage/pages">Retour</Link></Button>} />}</Card></PageContainer>;
  }
  const d = legal.data;
  const editable = can('legal.edit') && d.status === 'draft';
  const dirty = title !== (d.title.fr ?? '') || content !== (d.content.fr ?? '') || summary !== (d.changeSummary ?? '') || reaccept !== d.requiresReacceptance;

  async function save(silent = false) {
    setSaving(true);
    try {
      await updateDoc(doc(db, COLLECTIONS.legalDocuments, documentId), { title: { fr: title.trim() }, content: { fr: content.trim() }, changeSummary: summary.trim() || null, requiresReacceptance: reaccept, ...updatedFields(admin.uid) });
      if (!silent) toast.success('Brouillon enregistré');
      return true;
    } catch (e) {
      toast.error(errorMessage(e));
      return false;
    } finally {
      setSaving(false);
    }
  }

  return (
    <PageContainer wide>
      <PageHeader
        breadcrumbs={[{ label: 'Pages d’information', href: '/affichage/pages' }, { label: LEGAL_DOCUMENT_LABELS[d.type] }]}
        eyebrow={`${d.countryId} · version ${d.version}`}
        title={LEGAL_DOCUMENT_LABELS[d.type]}
        actions={editable ? (
          <div className="flex flex-wrap gap-2">
            <Button leftIcon={<Save />} loading={saving} disabled={!dirty} onClick={() => void save()}>Enregistrer</Button>
            <Button variant="primary" leftIcon={<Send />} disabled={content.trim().length < 50} onClick={() => setConfirm(true)}>Publier</Button>
          </div>
        ) : undefined}
      >
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Badge tone={d.status === 'published' ? 'success' : d.status === 'draft' ? 'amber' : 'neutral'}>{d.status === 'published' ? 'En vigueur' : d.status === 'draft' ? 'Brouillon' : 'Archivée'}</Badge>
          {d.publishedAt && <span className="text-xs text-fg-muted">Publiée le {longDate(millis(d.publishedAt))}</span>}
          {!editable && <span className="inline-flex items-center gap-1 text-xs text-fg-muted"><Lock className="size-3" />{d.status !== 'draft' ? 'Une version publiée n’est plus modifiable.' : 'Consultation seule.'}</span>}
        </div>
      </PageHeader>
      {editable ? (
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
          <Panel title="Texte">
            <div className="space-y-4">
              <FormField label="Titre"><Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} /></FormField>
              <RichTextEditor value={content} onChange={setContent} minRows={24} aria-label="Texte du document" />
            </div>
          </Panel>
          <Panel title="Publication">
            <div className="space-y-4">
              <FormField label="Résumé des changements" hint="Présenté aux utilisateurs si une nouvelle acceptation est demandée.">
                <Input value={summary} onChange={(e) => setSummary(e.target.value)} maxLength={300} placeholder="Ajout des conditions de remboursement" />
              </FormField>
              <Switch checked={reaccept} onCheckedChange={setReaccept} label="Exiger une nouvelle acceptation" description="À la prochaine ouverture de l’application, avant toute commande." />
              <p className="text-xs text-fg-subtle">La publication archive la version en vigueur pour ce pays ; les preuves d’acceptation restent attachées à leur version.</p>
            </div>
          </Panel>
        </div>
      ) : (
        <Card className="p-6 lg:p-8"><RichText source={d.content.fr} className="max-w-3xl" /></Card>
      )}
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title={`Publier la version ${d.version} ?`}
        description={reaccept ? 'Tous les utilisateurs concernés devront l’accepter à leur prochaine connexion.' : 'Elle entre en vigueur immédiatement.'}
        confirmLabel="Publier"
        onConfirm={async () => {
          if (dirty && !(await save(true))) return;
          if (await mutate({ kind: 'legal', id: documentId, changeSummary: summary.trim() || null, requiresReacceptance: reaccept })) navigate('/affichage/pages');
        }}
      />
    </PageContainer>
  );
}
