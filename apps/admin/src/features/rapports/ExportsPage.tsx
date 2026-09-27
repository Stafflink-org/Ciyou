import { useMemo, useState } from 'react';
import { collection, limit, orderBy, query, where } from 'firebase/firestore';
import { ArrowRight, History, Lock, RotateCw } from 'lucide-react';
import { Badge, Button, Card, CardHeader, EmptyState, Skeleton, Tooltip, cn, formatDateTime, formatNumber } from '@golink/ui';
import {
  COLLECTIONS,
  EXPORT_ENTITY_DESCRIPTIONS,
  EXPORT_ENTITY_LABELS,
  EXPORT_ENTITY_PERMISSIONS,
  EXPORT_FORMAT_LABELS,
  type BulkJob,
  type ExportEntity,
  type ExportFormat,
  type PlanCode,
} from '@golink/shared';
import { useAuth, useDocumentTitle } from '@golink/web';
import { useAdminAccess } from '@/auth/AdminAccess';
import { db } from '@/lib/firebase';
import { toMillis, useCollection } from '@/lib/firestore';
import { LoadError } from '../pilotage-commun/components';
import { rangeLabel } from '../pilotage-commun/period';
import { ENTITY_CONFIG, ENTITY_ORDER } from './config';
import { ExportDialog, type ExportPreset } from './ExportDialog';
import { ReportsLayout } from './ReportsLayout';

type ExportJob = BulkJob & { fileName?: string; truncated?: boolean };

/** Exports CSV, Excel ou PDF filtrés de toutes les entités (cahier §4). */
export function ExportsPage() {
  useDocumentTitle('Exports · GoLink Admin');
  const { user } = useAuth();
  const { can } = useAdminAccess();
  const [preset, setPreset] = useState<ExportPreset | null>(null);
  const canExport = can('exports.run');

  const historyQuery = useMemo(
    () =>
      user && canExport
        ? query(
            collection(db, COLLECTIONS.bulkJobs),
            where('createdBy', '==', user.uid),
            where('type', '==', 'export'),
            orderBy('createdAt', 'desc'),
            limit(15),
          )
        : null,
    [user, canExport],
  );
  const history = useCollection<ExportJob>(historyQuery);

  return (
    <ReportsLayout>
      {!canExport ? (
        <Card>
          <EmptyState
            icon={<Lock />}
            title="Exports non autorisés"
            description="Votre rôle permet de consulter les rapports programmés, pas de générer des exports. Demandez l’accès à un super admin."
          />
        </Card>
      ) : (
        <div className="grid gap-6 xl:grid-cols-3">
          <div className="min-w-0 xl:col-span-2">
            <div className="grid gap-3 sm:grid-cols-2">
              {ENTITY_ORDER.map((entity) => {
                const allowed = can(EXPORT_ENTITY_PERMISSIONS[entity]);
                const config = ENTITY_CONFIG[entity];
                const card = (
                  <button
                    type="button"
                    disabled={!allowed}
                    onClick={() => setPreset({ entity })}
                    className={cn(
                      'group flex w-full items-start gap-3.5 rounded-xl border border-border bg-surface p-4 text-left shadow-card transition-[border-color,box-shadow]',
                      'hover:border-border-strong hover:shadow-md focus-visible:outline-2 focus-visible:outline-ring',
                      'disabled:cursor-not-allowed disabled:opacity-55 disabled:hover:border-border disabled:hover:shadow-card',
                    )}
                  >
                    <span className="grid size-10 shrink-0 place-items-center rounded-xl border border-border bg-surface-2 text-fg-muted transition-colors group-hover:text-primary [&_svg]:size-5">
                      {allowed ? config.icon : <Lock />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-fg">{EXPORT_ENTITY_LABELS[entity]}</span>
                        {config.personal && (
                          <Badge size="sm" tone="amber">
                            Données personnelles
                          </Badge>
                        )}
                      </span>
                      <span className="mt-0.5 block text-xs text-fg-muted">{EXPORT_ENTITY_DESCRIPTIONS[entity]}</span>
                      <span className="mt-2 flex flex-wrap gap-1.5 text-2xs text-fg-subtle">
                        {config.dateField ? <span>Par période</span> : <span>Instantané</span>}
                        {config.statuses && <span>· par statut</span>}
                        {config.plan && <span>· par formule</span>}
                      </span>
                    </span>
                    {allowed && <ArrowRight className="mt-1 size-4 shrink-0 text-fg-subtle transition-transform group-hover:translate-x-0.5" />}
                  </button>
                );
                return allowed ? (
                  <div key={entity}>{card}</div>
                ) : (
                  <Tooltip key={entity} content="Votre rôle n’a pas accès à ces données.">
                    <div>{card}</div>
                  </Tooltip>
                );
              })}
            </div>
          </div>

          <Card className="flex min-w-0 flex-col self-start">
            <CardHeader title="Mes derniers exports" description="Relancez un export avec les mêmes filtres." icon={<History />} divided />
            {history.error ? (
              <LoadError error={history.error} compact className="py-8" />
            ) : history.loading ? (
              <div className="space-y-3 p-5">
                {Array.from({ length: 4 }, (_, i) => (
                  <Skeleton key={i} className="h-10 w-full" />
                ))}
              </div>
            ) : history.data.length === 0 ? (
              <EmptyState compact className="py-10" icon={<History />} title="Aucun export" description="Vos exports apparaîtront ici avec leurs filtres." />
            ) : (
              <ul className="divide-y divide-border">
                {history.data.map((job) => {
                  const entity = job.entity as ExportEntity;
                  const params = job.params as {
                    from?: string | null;
                    to?: string | null;
                    status?: string | null;
                    planCode?: PlanCode | null;
                    format?: ExportFormat;
                  };
                  const at = toMillis(job.createdAt);
                  return (
                    <li key={job.id} className="flex items-center gap-3 px-5 py-3">
                      <span className="grid size-8 shrink-0 place-items-center rounded-lg border border-border bg-surface-2 text-fg-muted [&_svg]:size-4">
                        {ENTITY_CONFIG[entity]?.icon}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2">
                          <span className="truncate text-sm font-medium text-fg">{EXPORT_ENTITY_LABELS[entity] ?? entity}</span>
                          <Badge size="sm">{EXPORT_FORMAT_LABELS[(job.format ?? params.format ?? 'csv') as ExportFormat]}</Badge>
                        </span>
                        <span className="block truncate text-2xs text-fg-subtle">
                          {formatNumber(job.total)} ligne{job.total > 1 ? 's' : ''}
                          {job.truncated ? ' (tronqué)' : ''}
                          {params.from && params.to ? ` · ${rangeLabel({ from: params.from, to: params.to })}` : ''}
                          {at ? ` · ${formatDateTime(at)}` : ''}
                        </span>
                      </span>
                      {EXPORT_ENTITY_LABELS[entity] && can(EXPORT_ENTITY_PERMISSIONS[entity]) && (
                        <Tooltip content="Relancer avec les mêmes filtres">
                          <Button
                            variant="ghost"
                            size="xs"
                            aria-label="Relancer cet export"
                            onClick={() =>
                              setPreset({
                                entity,
                                format: (job.format ?? params.format ?? 'xlsx') as ExportFormat,
                                from: params.from ?? null,
                                to: params.to ?? null,
                                status: params.status ?? null,
                                planCode: params.planCode ?? null,
                              })
                            }
                          >
                            <RotateCw />
                          </Button>
                        </Tooltip>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        </div>
      )}
      <ExportDialog preset={preset} onClose={() => setPreset(null)} />
    </ReportsLayout>
  );
}
