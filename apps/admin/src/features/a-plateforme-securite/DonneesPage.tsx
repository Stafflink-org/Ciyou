// Données et sauvegardes (cahier §31) : export Firestore planifié vers un bucket de
// sauvegarde, historique des opérations, et corbeille avec restauration documentée.
import { useState } from 'react';
import { Archive, DatabaseBackup, RotateCcw, Trash2 } from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  CardContent,
  EmptyState,
  PageContainer,
  PageHeader,
  Skeleton,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  formatDateTime,
} from '@golink/ui';
import type { Backup, TrashItem } from '@golink/shared';
import { useDocumentTitle } from '@golink/web';
import { useCan } from '@/auth/AdminAccess';
import { toDate, useMutation } from '@/lib/firestore';
import { checkBackupStatus, purgeTrashItem, restoreFromTrash, runManualBackup } from './api';
import { ActionDialog, Callout, ErrorPanel, RequirePermission } from './components';
import { useBackups, useTrash } from './hooks';
import { PlateformeNav } from './nav';

const BACKUP_STATUS_TONE: Record<Backup['status'], 'info' | 'success' | 'danger'> = { running: 'info', completed: 'success', failed: 'danger' };

function BackupsTab() {
  const can = useCan();
  const backups = useBackups();
  const run = useMutation(() => runManualBackup({ collections: null }), { success: 'Sauvegarde lancée.' });
  const refresh = useMutation((id: string) => checkBackupStatus({ backupId: id }), {});

  return (
    <div className="space-y-4">
      <Callout
        tone="info"
        title="Sauvegarde planifiée chaque nuit à 2 h"
        action={can('backups.manage') && <Button size="sm" leftIcon={<DatabaseBackup />} loading={run.loading} onClick={() => void run.mutate()}>Lancer maintenant</Button>}
      >
        Export complet de Firestore vers le bucket de sauvegarde de la plateforme (API d'export gérée Google Cloud), en dehors du bucket public de stockage.
      </Callout>
      {backups.error ? (
        <ErrorPanel error={backups.error} />
      ) : backups.loading ? (
        <Skeleton className="h-48" />
      ) : backups.data.length === 0 ? (
        <EmptyState icon={<Archive />} title="Aucune sauvegarde effectuée" />
      ) : (
        <Card>
          <CardContent className="p-0">
            <ul className="divide-y divide-border">
              {backups.data.map((b) => (
                <li key={b.id} className="flex items-center justify-between gap-3 px-5 py-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-fg">{b.kind === 'scheduled' ? 'Sauvegarde planifiée' : 'Sauvegarde manuelle'}</p>
                    <p className="truncate text-xs text-fg-subtle">{formatDateTime(toDate(b.startedAt) ?? new Date())}{b.error ? ` · ${b.error}` : ''}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge tone={BACKUP_STATUS_TONE[b.status]}>{b.status === 'running' ? 'En cours' : b.status === 'completed' ? 'Terminée' : 'Échouée'}</Badge>
                    {b.status === 'running' && can('backups.manage') && <Button size="sm" variant="ghost" onClick={() => void refresh.mutate(b.id)}>Actualiser</Button>}
                  </div>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function TrashTab() {
  const can = useCan();
  const trash = useTrash();
  const [restoring, setRestoring] = useState<(TrashItem & { id: string }) | null>(null);
  const [purging, setPurging] = useState<(TrashItem & { id: string }) | null>(null);
  const restore = useMutation((reason: string) => restoreFromTrash({ trashId: restoring!.id, reason }), { success: 'Élément restauré.' });
  const purge = useMutation((reason: string) => purgeTrashItem({ trashId: purging!.id, reason }), { success: 'Élément purgé définitivement.' });

  return (
    <div className="space-y-4">
      <Callout tone="info" title="Purge automatique">Chaque nuit à 4 h, la corbeille est purgée selon la durée de conservation configurée dans les paramètres.</Callout>
      {trash.error ? (
        <ErrorPanel error={trash.error} />
      ) : trash.loading ? (
        <Skeleton className="h-48" />
      ) : trash.data.length === 0 ? (
        <EmptyState icon={<Trash2 />} title="Corbeille vide" />
      ) : (
        <Card>
          <CardContent className="p-0">
            <ul className="divide-y divide-border">
              {trash.data.map((item) => (
                <li key={item.id} className="flex items-center justify-between gap-3 px-5 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-fg">{item.entity.label}</p>
                    <p className="truncate text-xs text-fg-subtle">{item.path} · supprimé le {formatDateTime(toDate(item.deletedAt) ?? new Date())}{item.reason ? ` · ${item.reason}` : ''}</p>
                  </div>
                  {can('trash.restore') && (
                    <div className="flex shrink-0 gap-1.5">
                      <Button size="sm" variant="secondary" leftIcon={<RotateCcw />} onClick={() => setRestoring(item)}>Restaurer</Button>
                      <Button size="sm" variant="ghost" leftIcon={<Trash2 />} onClick={() => setPurging(item)}>Purger</Button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
      <ActionDialog open={Boolean(restoring)} onOpenChange={(v) => !v && setRestoring(null)} title="Restaurer l'élément" description={restoring?.entity.label} onSubmit={async (r) => Boolean(await restore.mutate(r))} />
      <ActionDialog open={Boolean(purging)} onOpenChange={(v) => !v && setPurging(null)} title="Purger définitivement" description="Cette action est irréversible." destructive onSubmit={async (r) => Boolean(await purge.mutate(r))} />
    </div>
  );
}

export function DonneesPage() {
  useDocumentTitle('Données & sauvegardes · GoLink Admin');
  const can = useCan();
  const canBackups = can('backups.manage');
  const canTrash = can('trash.view');
  return (
    <PageContainer wide>
      <PageHeader eyebrow="Plateforme & sécurité" title="Données et sauvegardes" description="Sauvegardes Firestore planifiées et corbeille avec restauration documentée.">
        <PlateformeNav />
      </PageHeader>
      <RequirePermission permission={['backups.manage', 'trash.view']} title="Données et sauvegardes">
        <Tabs defaultValue={canBackups ? 'backups' : 'trash'}>
          <TabsList>
            {canBackups && <TabsTrigger value="backups">Sauvegardes</TabsTrigger>}
            {canTrash && <TabsTrigger value="trash">Corbeille</TabsTrigger>}
          </TabsList>
          {canBackups && <TabsContent value="backups" className="pt-4"><BackupsTab /></TabsContent>}
          {canTrash && <TabsContent value="trash" className="pt-4"><TrashTab /></TabsContent>}
        </Tabs>
      </RequirePermission>
    </PageContainer>
  );
}
