// Légal et RGPD (cahier §29) : versions des CGU/CGV/politique de confidentialité par
// public, avec ré-acceptation, et demandes d'exercice de droits (délai légal d'un mois).
import { useMemo, useState } from 'react';
import { collection, query as fsQuery, where } from 'firebase/firestore';
import { Download, FileCheck, Plus, ScaleIcon } from 'lucide-react';
import {
  Badge,
  Button,
  createColumnHelper,
  DataTable,
  DatePicker,
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
  Select,
  Switch,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
  formatDateTime,
  toast,
} from '@golink/ui';
import {
  COLLECTIONS,
  GDPR_REQUEST_STATUS_LABELS,
  GDPR_REQUEST_TYPE_LABELS,
  LEGAL_DOCUMENT_LABELS,
  type GdprRequest,
  type GdprRequestStatus,
  type GdprRequestType,
  type LegalAcceptance,
  type LegalDocument,
  type LegalDocumentType,
} from '@golink/shared';
import { useDocumentTitle } from '@golink/web';
import { useCan } from '@/auth/AdminAccess';
import { db } from '@/lib/firebase';
import { errorMessage, toDate, useCollection, useMutation } from '@/lib/firestore';
import { getGdprExportLink, handleGdprRequest, receiveGdprRequest, saveLegalDocument } from './api';
import { ErrorPanel, RequirePermission } from './components';
import { useGdprRequests, useLegalAcceptances, useLegalDocuments } from './hooks';
import { PlateformeNav } from './nav';

const STATUS_TONE: Record<GdprRequestStatus, 'info' | 'amber' | 'success' | 'danger'> = { received: 'info', identity_check: 'amber', in_progress: 'amber', completed: 'success', rejected: 'danger' };
const DOC_STATUS_TONE: Record<LegalDocument['status'], 'neutral' | 'success' | 'info'> = { draft: 'neutral', published: 'success', archived: 'info' };

/** Demandes RGPD en retard ou à traiter : pastille de la sous-navigation. */
export function useOpenGdprCount(): number | null {
  const can = useCan();
  const q = useMemo(() => (can('gdpr.handle') ? fsQuery(collection(db, COLLECTIONS.gdprRequests), where('status', 'in', ['received', 'identity_check', 'in_progress'])) : null), [can]);
  const { data } = useCollection<GdprRequest>(q);
  return data.length || null;
}

function LegalDocDialog({ doc, open, onOpenChange }: { doc: (LegalDocument & { id: string }) | null; open: boolean; onOpenChange: (v: boolean) => void }) {
  const [type, setType] = useState<LegalDocumentType>(doc?.type ?? 'terms_client');
  const [countryId, setCountryId] = useState(doc?.countryId ?? 'FR');
  const [version, setVersion] = useState(doc?.version ?? '1.0');
  const [title, setTitle] = useState(doc?.title?.fr ?? '');
  const [content, setContent] = useState(doc?.content?.fr ?? '');
  const [status, setStatus] = useState<LegalDocument['status']>(doc?.status ?? 'draft');
  const [requiresReacceptance, setRequiresReacceptance] = useState(doc?.requiresReacceptance ?? true);
  const [effectiveAt, setEffectiveAt] = useState<Date | undefined>(doc?.effectiveAt ? new Date(doc.effectiveAt.toMillis()) : undefined);
  const [changeSummary, setChangeSummary] = useState(doc?.changeSummary ?? '');
  const [reason, setReason] = useState('');
  const save = useMutation(
    () =>
      saveLegalDocument({
        documentId: doc?.id ?? null,
        type,
        countryId,
        version,
        title,
        content,
        status,
        effectiveAt: effectiveAt ? effectiveAt.getTime() : null,
        requiresReacceptance,
        changeSummary: changeSummary.trim() || null,
        reason,
      }),
    { success: 'Document enregistré.' },
  );
  const blocked = title.trim().length < 2 || content.trim().length < 20 || reason.trim().length < 3;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <DialogHeader icon={<ScaleIcon />} title={doc ? 'Modifier le document' : 'Nouveau document légal'} description="Une version publiée n'est plus modifiable : archivez-la pour la remplacer." />
        <DialogBody className="space-y-4 pt-2">
          <div className="grid gap-3 sm:grid-cols-3">
            <FormField label="Type" required><Select value={type} onValueChange={(v) => setType(v as LegalDocumentType)} options={Object.entries(LEGAL_DOCUMENT_LABELS).map(([v, label]) => ({ value: v, label }))} disabled={Boolean(doc)} /></FormField>
            <FormField label="Pays" required><Input value={countryId} onChange={(e) => setCountryId(e.target.value.toUpperCase())} maxLength={2} disabled={Boolean(doc)} /></FormField>
            <FormField label="Version" required><Input value={version} onChange={(e) => setVersion(e.target.value)} /></FormField>
          </div>
          <FormField label="Titre" required><Input value={title} onChange={(e) => setTitle(e.target.value)} /></FormField>
          <FormField label="Contenu" required hint="Texte intégral (mise en forme simple)."><Textarea value={content} onChange={(e) => setContent(e.target.value)} rows={10} /></FormField>
          <div className="grid gap-3 sm:grid-cols-2">
            <FormField label="Statut" required><Select value={status} onValueChange={(v) => setStatus(v as LegalDocument['status'])} options={[{ value: 'draft', label: 'Brouillon' }, { value: 'published', label: 'Publié' }, { value: 'archived', label: 'Archivé' }]} /></FormField>
            <FormField label="Exige une nouvelle acceptation"><div className="flex h-10 items-center"><Switch checked={requiresReacceptance} onCheckedChange={setRequiresReacceptance} /></div></FormField>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <FormField label="Date d'entrée en vigueur" hint="Laissez vide pour prendre la date de publication.">
              <DatePicker value={effectiveAt} onChange={setEffectiveAt} placeholder="Date de publication" />
            </FormField>
            <FormField label="Résumé du changement" hint="Affiché aux personnes concernées lors de la réacceptation.">
              <Input value={changeSummary} onChange={(e) => setChangeSummary(e.target.value)} maxLength={500} placeholder="Ex. clarification de la politique de remboursement" />
            </FormField>
          </div>
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} placeholder="Motif (conservé dans le journal d'audit)" maxLength={500} />
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Annuler</Button>
          <Button loading={save.loading} disabled={blocked} onClick={async () => { const res = await save.mutate(); if (res) onOpenChange(false); }}>Enregistrer</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function LegalDocsTab() {
  const can = useCan();
  const docs = useLegalDocuments();
  const [editing, setEditing] = useState<(LegalDocument & { id: string }) | null>(null);
  const [creating, setCreating] = useState(false);
  const columns = useMemo(() => {
    const helper = createColumnHelper<LegalDocument & { id: string }>();
    return [
      helper.accessor('type', { header: 'Document', cell: (c) => LEGAL_DOCUMENT_LABELS[c.getValue()] }),
      helper.accessor('countryId', { header: 'Pays' }),
      helper.accessor('version', { header: 'Version' }),
      helper.accessor('status', { header: 'Statut', cell: (c) => <Badge tone={DOC_STATUS_TONE[c.getValue()]}>{c.getValue() === 'draft' ? 'Brouillon' : c.getValue() === 'published' ? 'Publié' : 'Archivé'}</Badge> }),
    ];
  }, []);
  return (
    <div className="space-y-4">
      <div className="flex justify-end">{can('legal.edit') && <Button leftIcon={<Plus />} onClick={() => setCreating(true)}>Nouveau document</Button>}</div>
      {docs.error ? <ErrorPanel error={docs.error} /> : (
        <DataTable data={docs.data} columns={columns} loading={docs.loading} onRowClick={can('legal.edit') ? (row) => setEditing(row) : undefined} itemLabel="documents" emptyState={<EmptyState icon={<FileCheck />} title="Aucun document" />} />
      )}
      <LegalDocDialog doc={editing} open={Boolean(editing)} onOpenChange={(v) => !v && setEditing(null)} />
      <LegalDocDialog doc={null} open={creating} onOpenChange={setCreating} />
    </div>
  );
}

function GdprDialog({ request, onOpenChange }: { request: (GdprRequest & { id: string }) | null; onOpenChange: (v: boolean) => void }) {
  const [status, setStatus] = useState<GdprRequestStatus>('in_progress');
  const [note, setNote] = useState('');
  const [subjectId, setSubjectId] = useState('');
  const handle = useMutation(
    () => handleGdprRequest({ requestId: request!.id, status, note: note || null, subjectId: subjectId.trim() || null }),
    { success: 'Demande mise à jour.' },
  );
  if (!request) return null;
  const needsAction = request.type === 'access' || request.type === 'portability' || request.type === 'erasure';
  const missingSubject = needsAction && !request.subjectId;
  const blockedOnSubject = status === 'completed' && missingSubject && !subjectId.trim();
  return (
    <Dialog open={Boolean(request)} onOpenChange={onOpenChange}>
      <DialogContent size="sm">
        <DialogHeader title={request.email} description={`${GDPR_REQUEST_TYPE_LABELS[request.type]} · échéance ${formatDateTime(toDate(request.dueAt) ?? new Date())}`} />
        <DialogBody className="space-y-4 pt-2">
          <FormField label="Statut" required><Select value={status} onValueChange={(v) => setStatus(v as GdprRequestStatus)} options={(['identity_check', 'in_progress', 'completed', 'rejected'] as const).map((s) => ({ value: s, label: GDPR_REQUEST_STATUS_LABELS[s] }))} /></FormField>
          {missingSubject ? (
            <FormField
              label={`Identifiant du compte ${request.subjectType === 'client' ? 'client' : request.subjectType === 'restaurant' ? 'restaurant' : 'livreur'}`}
              hint="Demande enregistrée sans compte identifié : requis pour exporter ou effacer les données avant de clôturer."
              required={status === 'completed'}
            >
              <Input value={subjectId} onChange={(e) => setSubjectId(e.target.value.trim())} placeholder="Identifiant du document Firestore" />
            </FormField>
          ) : null}
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} placeholder="Note (visible dans la fiche de la demande)" maxLength={1000} />
          {status === 'completed' && request.type === 'erasure' && <p className="text-xs text-fg-subtle">Anonymise le profil et désactive le compte, en conservant les données requises par la loi (factures, litiges).</p>}
          {request.export ? <GdprExportDownload requestId={request.id} /> : null}
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Annuler</Button>
          <Button loading={handle.loading} disabled={blockedOnSubject} onClick={async () => { const res = await handle.mutate(); if (res) onOpenChange(false); }}>Enregistrer</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Lien signé vers l'export déjà déposé (vérification ou renvoi assisté, jamais un fichier public). */
function GdprExportDownload({ requestId }: { requestId: string }) {
  const [loading, setLoading] = useState(false);
  const download = async () => {
    setLoading(true);
    try {
      const result = await getGdprExportLink({ requestId });
      window.open(result.url, '_blank', 'noopener,noreferrer');
    } catch (error) {
      toast.error(errorMessage(error, 'Le lien de téléchargement n’a pas pu être généré.'));
    } finally {
      setLoading(false);
    }
  };
  return (
    <Button variant="secondary" size="sm" leftIcon={<Download className="size-4" />} loading={loading} onClick={() => void download()}>
      Télécharger l’export
    </Button>
  );
}

function NewGdprDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const [type, setType] = useState<GdprRequestType>('access');
  const [subjectType, setSubjectType] = useState<'client' | 'restaurant' | 'driver'>('client');
  const [email, setEmail] = useState('');
  const [subjectId, setSubjectId] = useState('');
  const receive = useMutation(() => receiveGdprRequest({ type, subjectType, subjectId: subjectId || null, email, notes: null }), { success: 'Demande enregistrée.' });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm">
        <DialogHeader title="Nouvelle demande RGPD" description="Délai légal d'un mois à compter de la réception." />
        <DialogBody className="space-y-4 pt-2">
          <FormField label="Type" required><Select value={type} onValueChange={(v) => setType(v as GdprRequestType)} options={Object.entries(GDPR_REQUEST_TYPE_LABELS).map(([v, label]) => ({ value: v, label }))} /></FormField>
          <FormField label="Public" required><Select value={subjectType} onValueChange={(v) => setSubjectType(v as any)} options={[{ value: 'client', label: 'Client' }, { value: 'restaurant', label: 'Commerce' }, { value: 'driver', label: 'Livreur' }]} /></FormField>
          <FormField label="E-mail" required><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></FormField>
          <FormField label="Identifiant du compte (si connu)"><Input value={subjectId} onChange={(e) => setSubjectId(e.target.value)} /></FormField>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Annuler</Button>
          <Button loading={receive.loading} disabled={!email.includes('@')} onClick={async () => { const res = await receive.mutate(); if (res) onOpenChange(false); }}>Enregistrer</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function GdprTab() {
  const can = useCan();
  const requests = useGdprRequests();
  const [editing, setEditing] = useState<(GdprRequest & { id: string }) | null>(null);
  const [creating, setCreating] = useState(false);
  const columns = useMemo(() => {
    const helper = createColumnHelper<GdprRequest & { id: string }>();
    return [
      helper.accessor('email', { header: 'Personne' }),
      helper.accessor('type', { header: 'Type', cell: (c) => GDPR_REQUEST_TYPE_LABELS[c.getValue()] }),
      helper.accessor('dueAt', { header: 'Échéance', cell: (c) => formatDateTime(toDate(c.getValue()) ?? new Date()) }),
      helper.accessor('status', { header: 'Statut', cell: (c) => <Badge tone={STATUS_TONE[c.getValue()]}>{GDPR_REQUEST_STATUS_LABELS[c.getValue()]}</Badge> }),
    ];
  }, []);
  return (
    <div className="space-y-4">
      <div className="flex justify-end">{can('gdpr.handle') && <Button leftIcon={<Plus />} onClick={() => setCreating(true)}>Nouvelle demande</Button>}</div>
      {requests.error ? <ErrorPanel error={requests.error} /> : (
        <DataTable data={requests.data} columns={columns} loading={requests.loading} onRowClick={can('gdpr.handle') ? (row) => setEditing(row) : undefined} itemLabel="demandes" emptyState={<EmptyState title="Aucune demande" />} />
      )}
      <GdprDialog request={editing} onOpenChange={(v) => !v && setEditing(null)} />
      <NewGdprDialog open={creating} onOpenChange={setCreating} />
    </div>
  );
}

const USER_TYPE_LABELS: Record<LegalAcceptance['userType'], string> = { client: 'Client', restaurant: 'Commerce', driver: 'Livreur' };

/**
 * « Qui a accepté quoi » (§29, manque signalé par l'audit) : les 300 dernières
 * preuves d'acceptation (`legalAcceptances`, non modifiables), avec recherche par
 * identifiant/e-mail et filtre par document. Filtrage côté client (volume limité) :
 * aucun index composite supplémentaire nécessaire.
 */
function AcceptancesTab() {
  const acceptances = useLegalAcceptances();
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<LegalDocumentType | 'all'>('all');
  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return acceptances.data.filter((a) => {
      if (typeFilter !== 'all' && a.documentType !== typeFilter) return false;
      if (!term) return true;
      return a.userId.toLowerCase().includes(term) || a.signatureName?.toLowerCase().includes(term) || a.version.toLowerCase().includes(term);
    });
  }, [acceptances.data, search, typeFilter]);
  const columns = useMemo(() => {
    const helper = createColumnHelper<LegalAcceptance & { id: string }>();
    return [
      helper.accessor('userId', { header: 'Compte', cell: (c) => <span className="font-mono text-xs">{c.getValue()}</span> }),
      helper.accessor('userType', { header: 'Public', cell: (c) => <Badge tone="neutral">{USER_TYPE_LABELS[c.getValue()]}</Badge> }),
      helper.accessor('documentType', { header: 'Document', cell: (c) => LEGAL_DOCUMENT_LABELS[c.getValue()] }),
      helper.accessor('version', { header: 'Version' }),
      helper.accessor('acceptedAt', { header: 'Accepté le', cell: (c) => formatDateTime(toDate(c.getValue()) ?? new Date()) }),
    ];
  }, []);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Rechercher un compte, une version…" className="max-w-xs" />
        <Select
          value={typeFilter}
          onValueChange={(v) => setTypeFilter(v as LegalDocumentType | 'all')}
          options={[{ value: 'all', label: 'Tous les documents' }, ...Object.entries(LEGAL_DOCUMENT_LABELS).map(([v, label]) => ({ value: v, label }))]}
        />
        <span className="text-xs text-fg-subtle">{filtered.length} sur {acceptances.data.length} (300 plus récentes)</span>
      </div>
      {acceptances.error ? (
        <ErrorPanel error={acceptances.error} />
      ) : (
        <DataTable data={filtered} columns={columns} loading={acceptances.loading} itemLabel="acceptations" emptyState={<EmptyState icon={<FileCheck />} title="Aucune acceptation" />} />
      )}
    </div>
  );
}

export function LegalRgprPage() {
  useDocumentTitle('Légal & RGPD · Ciyou Eats Admin');
  const can = useCan();
  const canGdpr = can('gdpr.handle');
  const canLegal = can('legal.edit');
  const defaultTab = canGdpr ? 'requests' : 'documents';
  return (
    <PageContainer wide>
      <PageHeader eyebrow="Plateforme & sécurité" title="Légal et RGPD" description="Versions des documents contractuels par public et pays, et demandes d'exercice de droits (délai légal d'un mois).">
        <PlateformeNav />
      </PageHeader>
      <RequirePermission permission={['legal.edit', 'gdpr.handle']} title="Légal et RGPD">
        <Tabs defaultValue={defaultTab}>
          <TabsList>
            {canGdpr && <TabsTrigger value="requests">Demandes RGPD</TabsTrigger>}
            {canLegal && <TabsTrigger value="documents">Documents légaux</TabsTrigger>}
            {canLegal && <TabsTrigger value="acceptances">Acceptations</TabsTrigger>}
          </TabsList>
          {canGdpr && <TabsContent value="requests" className="pt-4"><GdprTab /></TabsContent>}
          {canLegal && <TabsContent value="documents" className="pt-4"><LegalDocsTab /></TabsContent>}
          {canLegal && <TabsContent value="acceptances" className="pt-4"><AcceptancesTab /></TabsContent>}
        </Tabs>
      </RequirePermission>
    </PageContainer>
  );
}
