import { useState } from 'react';
import { addDoc, deleteDoc, doc, orderBy, query, where } from 'firebase/firestore';
import { deleteObject, ref } from 'firebase/storage';
import { Eye, EyeOff, FileText, Plus, Trash2, Upload } from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  ConfirmDialog,
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
  Select,
  Skeleton,
  Switch,
  toast,
} from '@golink/ui';
import {
  EMPLOYEE_DOCUMENT_TYPES,
  EMPLOYEE_DOCUMENT_TYPE_LABELS,
  paths,
  type Employee,
  type EmployeeDocument,
  type EmployeeDocumentType,
  type WithId,
} from '@golink/shared';
import { useAuth } from '@golink/web';
import { useRestaurantAccess } from '@/auth/RestaurantAccess';
import { storage } from '@/lib/firebase';
import { collectionAt, createdFields, useCollection, useMutation } from '@/lib/firestore';
import { formatShortDay, todayIso, addDays } from '../_rh/dates';
import { TEAM_FILE_ACCEPT, TEAM_FILE_MAX_BYTES, formatBytes, openStoredFile, uploadTeamFile } from '../_rh/files';
import { ErrorCard } from '../_rh/ui';

function expiryBadge(expiresAt: string | null | undefined) {
  if (!expiresAt) return null;
  const today = todayIso();
  if (expiresAt < today) return <Badge tone="danger" size="sm">Expiré le {formatShortDay(expiresAt)}</Badge>;
  if (expiresAt <= addDays(today, 30)) return <Badge tone="amber" size="sm">Expire le {formatShortDay(expiresAt)}</Badge>;
  return <span className="text-xs text-fg-subtle">Valable jusqu’au {formatShortDay(expiresAt)}</span>;
}

export function EmployeeDocuments({ employee, canManage }: { employee: WithId<Employee>; canManage: boolean }) {
  const { restaurantId } = useRestaurantAccess();
  const { user } = useAuth();
  const docs = useCollection<EmployeeDocument>(
    query(collectionAt(paths.restaurantSub(restaurantId, 'employeeDocuments')), where('employeeId', '==', employee.id), orderBy('createdAt', 'desc')),
  );
  const [uploadOpen, setUploadOpen] = useState(false);
  const [toDelete, setToDelete] = useState<WithId<EmployeeDocument> | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [name, setName] = useState('');
  const [type, setType] = useState<EmployeeDocumentType>('contract');
  const [expiresAt, setExpiresAt] = useState('');
  const [visible, setVisible] = useState(true);

  const upload = useMutation(
    async () => {
      const file = files[0];
      if (!file || !user) throw new Error('Aucun fichier sélectionné.');
      const stored = await uploadTeamFile(restaurantId, `employees/${employee.id}`, file, user.uid);
      const data: Omit<EmployeeDocument, 'createdAt' | 'updatedAt' | 'createdBy' | 'updatedBy'> = {
        employeeId: employee.id,
        employeeUid: employee.uid ?? null,
        name: name.trim() || EMPLOYEE_DOCUMENT_TYPE_LABELS[type],
        type,
        file: stored,
        expiresAt: expiresAt || null,
        visibleToEmployee: visible,
      };
      await addDoc(collectionAt(paths.restaurantSub(restaurantId, 'employeeDocuments')), { ...data, ...createdFields(user.uid) });
      return true;
    },
    { success: 'Document ajouté au dossier' },
  );

  async function submit() {
    if (await upload.mutate()) {
      setUploadOpen(false);
      setFiles([]);
      setName('');
      setExpiresAt('');
    }
  }

  async function remove(document: WithId<EmployeeDocument>) {
    await deleteDoc(doc(collectionAt(paths.restaurantSub(restaurantId, 'employeeDocuments')), document.id));
    await deleteObject(ref(storage, document.file.path)).catch(() => undefined);
    toast.success('Document supprimé');
  }

  return (
    <Card>
      <CardHeader
        icon={<FileText />}
        title="Dossier du salarié"
        description="Contrat, avenants, pièces et attestations. Les documents marqués visibles sont consultables par le salarié."
        actions={
          canManage ? (
            <Button size="sm" leftIcon={<Plus />} onClick={() => setUploadOpen(true)}>
              Ajouter
            </Button>
          ) : undefined
        }
        divided
      />
      {docs.error ? (
        <div className="p-5">
          <ErrorCard error={docs.error} />
        </div>
      ) : docs.loading ? (
        <div className="space-y-3 p-5">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-12" />
          ))}
        </div>
      ) : docs.data.length === 0 ? (
        <EmptyState compact icon={<FileText />} title="Aucun document" description="Déposez le contrat de travail et les pièces utiles pour constituer le dossier." />
      ) : (
        <ul className="divide-y divide-border">
          {docs.data.map((document) => (
            <li key={document.id} className="flex items-center gap-3 px-5 py-3">
              <div className="grid size-9 shrink-0 place-items-center rounded-lg border border-border bg-surface-2 text-fg-muted">
                <FileText className="size-4" />
              </div>
              <button type="button" onClick={() => void openStoredFile(document.file)} className="min-w-0 flex-1 text-left">
                <p className="truncate text-sm font-medium text-fg hover:underline">{document.name}</p>
                <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-fg-subtle">
                  <span>{EMPLOYEE_DOCUMENT_TYPE_LABELS[document.type]}</span>
                  <span aria-hidden>·</span>
                  <span>{formatBytes(document.file.size)}</span>
                  {expiryBadge(document.expiresAt)}
                </div>
              </button>
              <span className="hidden text-fg-subtle sm:inline" title={document.visibleToEmployee ? 'Visible par le salarié' : 'Réservé aux responsables'}>
                {document.visibleToEmployee ? <Eye className="size-4" aria-label="Visible par le salarié" /> : <EyeOff className="size-4" aria-label="Réservé aux responsables" />}
              </span>
              {canManage && (
                <IconButton label={`Supprimer ${document.name}`} variant="danger" size="sm" onClick={() => setToDelete(document)}>
                  <Trash2 />
                </IconButton>
              )}
            </li>
          ))}
        </ul>
      )}

      <Dialog open={uploadOpen} onOpenChange={setUploadOpen}>
        <DialogContent size="md">
          <DialogHeader icon={<Upload />} title="Ajouter un document" description={`Dossier de ${employee.firstName} ${employee.lastName}`} />
          <DialogBody className="space-y-4">
            <FileUpload
              value={files}
              onChange={(next) => {
                setFiles(next);
                if (next[0] && !name) setName(next[0].name.replace(/\.[^.]+$/, ''));
              }}
              accept={TEAM_FILE_ACCEPT}
              maxSize={TEAM_FILE_MAX_BYTES}
              hint="PDF ou image, 15 Mo au maximum."
              onReject={(message) => toast.error(message)}
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label="Type">
                <Select value={type} onValueChange={(v) => setType(v as EmployeeDocumentType)} options={EMPLOYEE_DOCUMENT_TYPES.map((t) => ({ value: t, label: EMPLOYEE_DOCUMENT_TYPE_LABELS[t] }))} />
              </FormField>
              <FormField label="Date d’expiration" hint="Pour être alerté du renouvellement.">
                <Input type="date" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} />
              </FormField>
            </div>
            <FormField label="Intitulé">
              <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
            </FormField>
            <Switch label="Visible par le salarié" description="Le salarié le retrouve dans son espace." checked={visible} onCheckedChange={setVisible} />
          </DialogBody>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setUploadOpen(false)}>
              Annuler
            </Button>
            <Button variant="primary" loading={upload.loading} disabled={files.length === 0} onClick={() => void submit()}>
              Déposer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={toDelete !== null}
        onOpenChange={(open) => !open && setToDelete(null)}
        title="Supprimer ce document ?"
        description={toDelete ? `« ${toDelete.name} » sera définitivement retiré du dossier.` : undefined}
        confirmLabel="Supprimer"
        destructive
        onConfirm={async () => {
          if (toDelete) await remove(toDelete);
        }}
      />
    </Card>
  );
}
