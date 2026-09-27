import { useEffect, useMemo, useState } from 'react';
import { addDoc, doc, orderBy, query, updateDoc } from 'firebase/firestore';
import { Archive, ArchiveRestore, FileImage, FileText, FolderOpen, MoreHorizontal, Pencil, Plus, Search, Upload, Users } from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  Checkbox,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  EmptyState,
  FileUpload,
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
  formatDate,
  toast,
} from '@golink/ui';
import {
  COMPANY_DOCUMENT_CATEGORIES,
  COMPANY_DOCUMENT_CATEGORY_LABELS,
  STAFF_ROLE_LABELS,
  paths,
  type CompanyDocument,
  type CompanyDocumentCategory,
  type StaffRole,
  type WithId,
} from '@golink/shared';
import { useAuth, useDocumentTitle } from '@golink/web';
import { useCan, useRestaurantAccess } from '@/auth/RestaurantAccess';
import { collectionAt, createdFields, toDate, updatedFields, useCollection, useMutation } from '@/lib/firestore';
import { TEAM_FILE_ACCEPT, TEAM_FILE_MAX_BYTES, formatBytes, openStoredFile, uploadTeamFile } from '../_rh/files';
import { ErrorCard } from '../_rh/ui';

const ROLES: StaffRole[] = ['manager', 'kitchen', 'service', 'accountant', 'employee'];

const CATEGORY_TONE: Record<CompanyDocumentCategory, 'brand' | 'info' | 'plum' | 'danger' | 'teal' | 'neutral'> = {
  rules: 'brand',
  procedure: 'info',
  training: 'plum',
  legal: 'danger',
  supplier: 'teal',
  other: 'neutral',
};

function DocumentDialog({ open, onClose, document }: { open: boolean; onClose: () => void; document: WithId<CompanyDocument> | null }) {
  const { restaurantId } = useRestaurantAccess();
  const { user } = useAuth();
  const [files, setFiles] = useState<File[]>([]);
  const [name, setName] = useState('');
  const [category, setCategory] = useState<CompanyDocumentCategory>('procedure');
  const [description, setDescription] = useState('');
  const [roles, setRoles] = useState<StaffRole[]>(ROLES);
  useEffect(() => {
    if (!open) return;
    setFiles([]);
    setName(document?.name ?? '');
    setCategory(document?.category ?? 'procedure');
    setDescription(document?.description ?? '');
    setRoles(document?.visibleToRoles.filter((r) => r !== 'owner') ?? ROLES);
  }, [open, document]);

  const save = useMutation(
    async () => {
      const file = files[0] ? await uploadTeamFile(restaurantId, 'documents', files[0], user!.uid) : null;
      const data = {
        name: name.trim(),
        category,
        description: description.trim() || null,
        visibleToRoles: ['owner', ...roles] as StaffRole[],
        ...(file ? { file } : {}),
      };
      const collection = collectionAt(paths.restaurantSub(restaurantId, 'documents'));
      if (document) await updateDoc(doc(collection, document.id), { ...data, ...updatedFields(user!.uid) });
      else await addDoc(collection, { ...data, archived: false, ...createdFields(user!.uid) });
      return true;
    },
    { success: document ? 'Document mis à jour' : 'Document publié pour l’équipe' },
  );
  const valid = name.trim().length >= 2 && (document || files.length > 0);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent size="md">
        <DialogHeader icon={document ? <Pencil /> : <Upload />} title={document ? 'Modifier le document' : 'Ajouter un document'} description="Règlement intérieur, procédures, fiches de formation, attestations…" />
        <DialogBody className="space-y-4">
          <FileUpload
            value={files}
            onChange={(next) => {
              setFiles(next);
              if (next[0] && !name) setName(next[0].name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' '));
            }}
            accept={TEAM_FILE_ACCEPT}
            maxSize={TEAM_FILE_MAX_BYTES}
            label={document ? 'Remplacer le fichier : glissez-déposez ou' : undefined}
            hint="PDF ou image, 15 Mo au maximum."
            onReject={(message) => toast.error(message)}
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Titre" required>
              <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
            </FormField>
            <FormField label="Catégorie">
              <Select value={category} onValueChange={(v) => setCategory(v as CompanyDocumentCategory)} options={COMPANY_DOCUMENT_CATEGORIES.map((c) => ({ value: c, label: COMPANY_DOCUMENT_CATEGORY_LABELS[c] }))} />
            </FormField>
          </div>
          <FormField label="Description">
            <Textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={300} />
          </FormField>
          <FormField label="Visible par" hint="Le propriétaire voit toujours tous les documents.">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {ROLES.map((role) => (
                <Checkbox
                  key={role}
                  label={STAFF_ROLE_LABELS[role]}
                  checked={roles.includes(role)}
                  onCheckedChange={(v) => setRoles((list) => (v ? [...list, role] : list.filter((r) => r !== role)))}
                />
              ))}
            </div>
          </FormField>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Annuler
          </Button>
          <Button
            variant="primary"
            loading={save.loading}
            disabled={!valid}
            onClick={async () => {
              if (await save.mutate()) onClose();
            }}
          >
            {document ? 'Enregistrer' : 'Publier'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function DocumentsPage() {
  useDocumentTitle('Documents · Ciyou Eats Restaurant');
  const can = useCan();
  const manage = can('documents.manage');
  const { restaurantId, member } = useRestaurantAccess();
  const { user } = useAuth();
  const docs = useCollection<CompanyDocument>(query(collectionAt(paths.restaurantSub(restaurantId, 'documents')), orderBy('createdAt', 'desc')));
  const [category, setCategory] = useState<CompanyDocumentCategory | 'all'>('all');
  const [search, setSearch] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [dialog, setDialog] = useState<WithId<CompanyDocument> | 'new' | null>(null);

  const archive = useMutation(
    async (document: WithId<CompanyDocument>, archived: boolean) => {
      await updateDoc(doc(collectionAt(paths.restaurantSub(restaurantId, 'documents')), document.id), { archived, ...updatedFields(user!.uid) });
      return archived;
    },
    { success: (archived) => (archived ? 'Document archivé' : 'Document restauré') },
  );

  const visible = useMemo(
    () =>
      docs.data.filter((d) => {
        if (!manage && member.role !== 'owner' && !d.visibleToRoles.includes(member.role)) return false;
        if (Boolean(d.archived) !== showArchived) return false;
        return true;
      }),
    [docs.data, manage, member.role, showArchived],
  );
  const filtered = visible.filter(
    (d) =>
      (category === 'all' || d.category === category) &&
      (!search || `${d.name} ${d.description ?? ''}`.toLowerCase().includes(search.trim().toLowerCase())),
  );
  const counts = new Map(COMPANY_DOCUMENT_CATEGORIES.map((c) => [c, visible.filter((d) => d.category === c).length]));

  return (
    <PageContainer>
      <PageHeader
        eyebrow="Équipe & RH"
        title="Documents de l’entreprise"
        description="Règlement, procédures et supports de formation, partagés avec l’équipe selon les rôles."
        actions={
          manage ? (
            <Button variant="primary" leftIcon={<Plus />} onClick={() => setDialog('new')}>
              Ajouter un document
            </Button>
          ) : undefined
        }
      />
      {docs.error && <ErrorCard error={docs.error} />}

      <div className="mb-5 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div data-scroll-ok className="-mx-4 flex gap-1.5 overflow-x-auto px-4 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:px-0">
          {(['all', ...COMPANY_DOCUMENT_CATEGORIES] as const).map((c) => {
            const count = c === 'all' ? visible.length : (counts.get(c) ?? 0);
            if (c !== 'all' && count === 0) return null;
            return (
              <button
                key={c}
                type="button"
                aria-pressed={category === c}
                onClick={() => setCategory(c)}
                className={cn(
                  'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-3 text-sm transition-colors',
                  category === c ? 'border-contrast bg-contrast text-contrast-fg' : 'border-border-strong bg-surface text-fg-muted hover:text-fg',
                )}
              >
                {c === 'all' ? 'Tous' : COMPANY_DOCUMENT_CATEGORY_LABELS[c]}
                <span className="font-mono text-2xs opacity-70 num">{count}</span>
              </button>
            );
          })}
        </div>
        <div className="flex items-center gap-3">
          <Input size="sm" leading={<Search />} placeholder="Rechercher un document…" value={search} onChange={(e) => setSearch(e.target.value)} className="w-full lg:w-64" aria-label="Rechercher un document" />
          {manage && <Switch size="sm" label="Archives" checked={showArchived} onCheckedChange={setShowArchived} className="shrink-0" />}
        </div>
      </div>

      {docs.loading ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-40 rounded-xl" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <Card>
          <EmptyState
            icon={<FolderOpen />}
            title={showArchived ? 'Aucun document archivé' : search || category !== 'all' ? 'Aucun document ne correspond' : 'Aucun document partagé'}
            description={manage ? 'Publiez le règlement intérieur et vos procédures pour les rendre accessibles à toute l’équipe.' : 'Votre responsable n’a encore partagé aucun document avec votre rôle.'}
            action={
              manage && !showArchived ? (
                <Button variant="primary" leftIcon={<Plus />} onClick={() => setDialog('new')}>
                  Ajouter un document
                </Button>
              ) : undefined
            }
          />
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map((d) => {
            const image = d.file.contentType.startsWith('image/');
            const created = toDate(d.createdAt);
            return (
              <Card key={d.id} interactive className="flex flex-col p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className={cn(`tone-${CATEGORY_TONE[d.category]}`, 'grid size-11 shrink-0 place-items-center rounded-xl bg-(--tone-bg) text-(--tone-fg)')}>
                    {image ? <FileImage className="size-5" /> : <FileText className="size-5" />}
                  </div>
                  {manage && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <IconButton label={`Actions pour ${d.name}`} size="sm">
                          <MoreHorizontal />
                        </IconButton>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent>
                        <DropdownMenuItem icon={<Pencil />} onSelect={() => setDialog(d)}>
                          Modifier
                        </DropdownMenuItem>
                        <DropdownMenuItem icon={d.archived ? <ArchiveRestore /> : <Archive />} onSelect={() => void archive.mutate(d, !d.archived)}>
                          {d.archived ? 'Restaurer' : 'Archiver'}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </div>
                <button type="button" onClick={() => void openStoredFile(d.file)} className="mt-4 flex-1 text-left">
                  <p className="font-display text-md font-semibold tracking-tight text-fg hover:underline">{d.name}</p>
                  {d.description && <p className="mt-1 line-clamp-2 text-sm text-fg-muted">{d.description}</p>}
                </button>
                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <Badge tone={CATEGORY_TONE[d.category]} size="sm">
                    {COMPANY_DOCUMENT_CATEGORY_LABELS[d.category]}
                  </Badge>
                  <span className="text-2xs text-fg-subtle">
                    {formatBytes(d.file.size)}
                    {created ? ` · ${formatDate(created)}` : ''}
                  </span>
                </div>
                {manage && (
                  <p className="mt-3 flex items-center gap-1.5 border-t border-border pt-3 text-2xs text-fg-subtle">
                    <Users className="size-3.5" />
                    {d.visibleToRoles.filter((r) => r !== 'owner').map((r) => STAFF_ROLE_LABELS[r]).join(', ') || 'Propriétaire uniquement'}
                  </p>
                )}
              </Card>
            );
          })}
        </div>
      )}
      <DocumentDialog open={dialog !== null} document={dialog === 'new' ? null : dialog} onClose={() => setDialog(null)} />
    </PageContainer>
  );
}
