import { useEffect, useState } from 'react';
import { addDoc, deleteDoc, doc, serverTimestamp } from 'firebase/firestore';
import { deleteObject, ref } from 'firebase/storage';
import { ClipboardCheck, Download, FileArchive, FileText, Plus, Trash2, Upload } from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  ConfirmDialog,
  DateRangePicker,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  EmptyState,
  FileUpload,
  FormField,
  IconButton,
  Input,
  PageContainer,
  Select,
  Skeleton,
  Textarea,
  formatDateTime,
  toast,
  type DateRange,
} from '@golink/ui';
import { paths, type HaccpAudit, type HaccpDocument, type WithId } from '@golink/shared';
import { useAuth, useDocumentTitle } from '@golink/web';
import { useCan, useRestaurantAccess } from '@/auth/RestaurantAccess';
import { storage } from '@/lib/firebase';
import { collectionAt, toDate, useMutation } from '@/lib/firestore';
import { addDays, formatShortDay, isoDay, todayIso } from '../_rh/dates';
import { TEAM_FILE_ACCEPT, TEAM_FILE_MAX_BYTES, formatBytes, openStoredFile, uploadTeamFile } from '../_rh/files';
import { downloadBase64, exportHaccpRegister } from '../_rh/functions';
import { useStaffDirectory } from '../_rh/hooks';
import { ErrorCard } from '../_rh/ui';
import { useAudits, useExports, useHaccpDocuments } from './data';
import { HaccpHeader } from './layout';

const DOC_CATEGORIES: Record<HaccpDocument['category'], string> = {
  sanitary_plan: 'Plan de maîtrise sanitaire',
  control_sheet: 'Fiche de contrôle',
  training: 'Formation',
  supplier: 'Fournisseur',
  other: 'Autre',
};
const RESULT: Record<HaccpAudit['result'], { label: string; tone: 'success' | 'danger' | 'amber' }> = {
  compliant: { label: 'Conforme', tone: 'success' },
  to_improve: { label: 'À améliorer', tone: 'amber' },
  non_compliant: { label: 'Non conforme', tone: 'danger' },
};

function AuditDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { restaurantId } = useRestaurantAccess();
  const { user } = useAuth();
  const [label, setLabel] = useState('');
  const [date, setDate] = useState(todayIso());
  const [kind, setKind] = useState<HaccpAudit['kind']>('internal');
  const [result, setResult] = useState<HaccpAudit['result']>('compliant');
  const [notes, setNotes] = useState('');
  useEffect(() => {
    if (open) {
      setLabel('');
      setDate(todayIso());
      setKind('internal');
      setResult('compliant');
      setNotes('');
    }
  }, [open]);
  const save = useMutation(
    async () => {
      await addDoc(collectionAt(paths.restaurantSub(restaurantId, 'haccpAudits')), {
        visitDate: date,
        label: label.trim(),
        kind,
        result,
        notes: notes.trim() || null,
        report: null,
        performedBy: user!.uid,
        createdAt: serverTimestamp(),
      });
      return true;
    },
    { success: 'Audit enregistré' },
  );
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent size="md">
        <DialogHeader icon={<ClipboardCheck />} title="Audit ou contrôle officiel" description="Consignez le résultat et les points d’amélioration." />
        <DialogBody className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Intitulé" required>
              <Input value={label} onChange={(e) => setLabel(e.target.value)} maxLength={100} placeholder="Audit interne trimestriel" />
            </FormField>
            <FormField label="Date">
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </FormField>
            <FormField label="Type">
              <Select
                value={kind}
                onValueChange={(v) => setKind(v as HaccpAudit['kind'])}
                options={[
                  { value: 'internal', label: 'Audit interne' },
                  { value: 'official', label: 'Contrôle officiel (DDPP)' },
                ]}
              />
            </FormField>
            <FormField label="Résultat">
              <Select value={result} onValueChange={(v) => setResult(v as HaccpAudit['result'])} options={Object.entries(RESULT).map(([value, r]) => ({ value, label: r.label }))} />
            </FormField>
          </div>
          <FormField label="Observations">
            <Textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={1000} />
          </FormField>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Annuler
          </Button>
          <Button variant="primary" loading={save.loading} disabled={label.trim().length < 3} onClick={async () => { if (await save.mutate()) onClose(); }}>
            Enregistrer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DocumentDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { restaurantId } = useRestaurantAccess();
  const { user } = useAuth();
  const [files, setFiles] = useState<File[]>([]);
  const [name, setName] = useState('');
  const [category, setCategory] = useState<HaccpDocument['category']>('sanitary_plan');
  useEffect(() => {
    if (open) {
      setFiles([]);
      setName('');
      setCategory('sanitary_plan');
    }
  }, [open]);
  const save = useMutation(
    async () => {
      const file = await uploadTeamFile(restaurantId, 'haccp', files[0]!, user!.uid);
      await addDoc(collectionAt(paths.restaurantSub(restaurantId, 'haccpDocuments')), {
        category,
        name: name.trim(),
        file,
        uploadedBy: user!.uid,
        uploadedAt: serverTimestamp(),
      });
      return true;
    },
    { success: 'Document ajouté au plan de maîtrise sanitaire' },
  );
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent size="md">
        <DialogHeader icon={<Upload />} title="Ajouter un document HACCP" description="Plan de maîtrise sanitaire, attestations de formation, fiches techniques." />
        <DialogBody className="space-y-4">
          <FileUpload
            value={files}
            onChange={(next) => {
              setFiles(next);
              if (next[0] && !name) setName(next[0].name.replace(/\.[^.]+$/, ''));
            }}
            accept={TEAM_FILE_ACCEPT}
            maxSize={TEAM_FILE_MAX_BYTES}
            onReject={(message) => toast.error(message)}
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Titre" required>
              <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
            </FormField>
            <FormField label="Catégorie">
              <Select value={category} onValueChange={(v) => setCategory(v as HaccpDocument['category'])} options={Object.entries(DOC_CATEGORIES).map(([value, label]) => ({ value, label }))} />
            </FormField>
          </div>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Annuler
          </Button>
          <Button variant="primary" loading={save.loading} disabled={files.length === 0 || name.trim().length < 2} onClick={async () => { if (await save.mutate()) onClose(); }}>
            Déposer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function RegisterPage() {
  useDocumentTitle('Registre HACCP · Ciyou Eats Restaurant');
  const can = useCan();
  const manage = can('haccp.manage');
  const { restaurantId } = useRestaurantAccess();
  const directory = useStaffDirectory();
  const exports = useExports();
  const audits = useAudits();
  const documents = useHaccpDocuments();
  const [range, setRange] = useState<DateRange | undefined>(() => {
    const to = new Date();
    const from = new Date();
    from.setDate(from.getDate() - 29);
    return { from, to };
  });
  const [auditOpen, setAuditOpen] = useState(false);
  const [docOpen, setDocOpen] = useState(false);
  const [toDelete, setToDelete] = useState<WithId<HaccpDocument> | null>(null);

  const generate = useMutation(
    async () => {
      if (!range?.from) throw new Error('Période manquante');
      const from = isoDay(range.from);
      const to = isoDay(range.to ?? range.from);
      const file = await exportHaccpRegister({ restaurantId, from, to });
      downloadBase64(file.base64, file.fileName);
      return true;
    },
    { success: 'Registre généré et téléchargé' },
  );
  const redownload = useMutation(
    async (exportId: string) => {
      const file = await exportHaccpRegister({ restaurantId, exportId });
      downloadBase64(file.base64, file.fileName);
    },
    { success: 'Registre téléchargé' },
  );
  const tooLong = range?.from && range.to && addDays(isoDay(range.from), 92) < isoDay(range.to);

  return (
    <PageContainer wide>
      <HaccpHeader
        title="Registre et documents"
        description="Exports PDF du registre sanitaire, audits et documents du plan de maîtrise sanitaire, prêts pour un contrôle."
        actions={
          manage ? (
            <>
              <Button leftIcon={<Upload />} onClick={() => setDocOpen(true)}>
                Document
              </Button>
              <Button leftIcon={<Plus />} onClick={() => setAuditOpen(true)}>
                Audit
              </Button>
            </>
          ) : undefined
        }
      />
      {(audits.error || documents.error || exports.error) && <ErrorCard error={audits.error ?? documents.error ?? exports.error} />}

      {manage && (
        <Card className="mb-6 overflow-hidden">
          <div className="grid lg:grid-cols-[1.2fr_1fr]">
            <div className="bg-sidebar p-6 text-sidebar-fg">
              <p className="eyebrow text-sidebar-muted">Registre sanitaire</p>
              <h2 className="mt-1 font-display text-xl font-semibold">Exporter le registre en PDF</h2>
              <p className="mt-2 max-w-md text-sm text-sidebar-muted">
                Températures, réceptions, nettoyages, non-conformités, nuisibles et audits de la période, dans un document unique à présenter aux services vétérinaires.
              </p>
              <div className="mt-5 flex flex-wrap items-center gap-2">
                <DateRangePicker value={range} onChange={setRange} className="bg-surface text-fg" />
                <Button variant="primary" leftIcon={<Download />} loading={generate.loading} disabled={!range?.from || Boolean(tooLong)} onClick={() => void generate.mutate()}>
                  Générer le PDF
                </Button>
              </div>
              {tooLong && <p className="mt-2 text-xs text-sidebar-muted">La période est limitée à trois mois.</p>}
            </div>
            <div className="min-w-0">
              <p className="eyebrow px-5 pb-2 pt-5">Derniers exports</p>
              {exports.loading ? (
                <Skeleton className="mx-5 mb-5 h-24" />
              ) : exports.data.length === 0 ? (
                <p className="px-5 pb-5 text-sm text-fg-subtle">Aucun export pour le moment.</p>
              ) : (
                <ul className="divide-y divide-border">
                  {exports.data.slice(0, 5).map((item) => {
                    const at = toDate(item.generatedAt);
                    return (
                      <li key={item.id} className="flex items-center justify-between gap-3 px-5 py-2.5">
                        <div className="min-w-0">
                          <p className="truncate text-sm text-fg">
                            {formatShortDay(item.periodStart)} → {formatShortDay(item.periodEnd)}
                          </p>
                          <p className="text-2xs text-fg-subtle">
                            {directory.nameOfUid(item.generatedBy)} · {at ? formatDateTime(at) : '—'} · {formatBytes(item.file.size)}
                          </p>
                        </div>
                        <IconButton label="Télécharger" size="sm" onClick={() => void redownload.mutate(item.id)} loading={redownload.loading}>
                          <Download />
                        </IconButton>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        </Card>
      )}

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader icon={<ClipboardCheck />} title="Audits et contrôles" divided />
          {audits.loading ? (
            <Skeleton className="m-5 h-32" />
          ) : audits.data.length === 0 ? (
            <EmptyState compact icon={<ClipboardCheck />} title="Aucun audit enregistré" />
          ) : (
            <ul className="divide-y divide-border">
              {audits.data.map((audit) => (
                <li key={audit.id} className="px-5 py-3.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-medium text-fg">{audit.label}</p>
                    <Badge tone={RESULT[audit.result].tone}>{RESULT[audit.result].label}</Badge>
                  </div>
                  <p className="mt-0.5 text-xs text-fg-subtle">
                    {audit.kind === 'official' ? 'Contrôle officiel' : 'Audit interne'} · {formatShortDay(audit.visitDate)} · {directory.nameOfUid(audit.performedBy)}
                  </p>
                  {audit.notes && <p className="mt-1 text-sm text-fg-muted">{audit.notes}</p>}
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <CardHeader icon={<FileArchive />} title="Plan de maîtrise sanitaire" description="Documents de référence de l’établissement." divided />
          {documents.loading ? (
            <Skeleton className="m-5 h-32" />
          ) : documents.data.length === 0 ? (
            <EmptyState compact icon={<FileText />} title="Aucun document" description="Déposez votre plan de maîtrise sanitaire et les attestations de formation." />
          ) : (
            <ul className="divide-y divide-border">
              {documents.data.map((d) => (
                <li key={d.id} className="flex items-center gap-3 px-5 py-3">
                  <FileText className="size-4 shrink-0 text-fg-subtle" />
                  <button type="button" onClick={() => void openStoredFile(d.file)} className="min-w-0 flex-1 text-left">
                    <p className="truncate text-sm font-medium text-fg hover:underline">{d.name}</p>
                    <p className="text-2xs text-fg-subtle">
                      {DOC_CATEGORIES[d.category]} · {formatBytes(d.file.size)}
                    </p>
                  </button>
                  {manage && (
                    <IconButton label={`Supprimer ${d.name}`} size="sm" variant="danger" onClick={() => setToDelete(d)}>
                      <Trash2 />
                    </IconButton>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {manage && (
        <>
          <AuditDialog open={auditOpen} onClose={() => setAuditOpen(false)} />
          <DocumentDialog open={docOpen} onClose={() => setDocOpen(false)} />
          <ConfirmDialog
            open={toDelete !== null}
            onOpenChange={(v) => !v && setToDelete(null)}
            title="Supprimer ce document ?"
            description={toDelete ? `« ${toDelete.name} » sera retiré du plan de maîtrise sanitaire.` : undefined}
            confirmLabel="Supprimer"
            destructive
            onConfirm={async () => {
              if (!toDelete) return;
              await deleteDoc(doc(collectionAt(paths.restaurantSub(restaurantId, 'haccpDocuments')), toDelete.id));
              await deleteObject(ref(storage, toDelete.file.path)).catch(() => undefined);
              toast.success('Document supprimé');
            }}
          />
        </>
      )}
    </PageContainer>
  );
}
