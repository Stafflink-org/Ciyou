import { useMemo, useState } from 'react';
import { collection, limit, query } from 'firebase/firestore';
import { CalendarClock, Eye, FileText, Mail, MoreHorizontal, Pencil, Plus, Send, Trash2 } from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  EmptyState,
  IconButton,
  Skeleton,
  Spinner,
  Switch,
  Tooltip,
  formatRelative,
} from '@golink/ui';
import {
  COLLECTIONS,
  EXPORT_FORMAT_LABELS,
  REPORT_FREQUENCY_LABELS,
  REPORT_KIND_LABELS,
  type RunReportNowInput,
  type RunReportNowResult,
  type SaveScheduledReportInput,
  type ScheduledReport,
  type WithId,
} from '@golink/shared';
import { useDocumentTitle } from '@golink/web';
import { useAdminAccess } from '@/auth/AdminAccess';
import { useGeoScope } from '@/layout/GeoScope';
import { db } from '@/lib/firebase';
import { callFunction, toMillis, useCollection, useMutation } from '@/lib/firestore';
import { callFunctionWithReason } from '@/lib/reason';
import { LoadError } from '../pilotage-commun/components';
import { rangeLabel } from '../pilotage-commun/period';
import { ReportFormDialog } from './ReportFormDialog';
import { ReportsLayout } from './ReportsLayout';

const runReport = callFunctionWithReason<RunReportNowInput, RunReportNowResult>('runReportNow', { title: 'Envoyer ce rapport maintenant', confirmLabel: 'Envoyer' }, (input) => input.dryRun);
const deleteReport = callFunction<{ id: string; reason: string }, { ok: true }>('deleteScheduledReport');
const saveReport = callFunctionWithReason<SaveScheduledReportInput, { id: string; nextRunAt: string }>('saveScheduledReport', { title: 'Modifier ce rapport programmé' });

/** Heures d'envoi exprimées à l'heure de Paris, quel que soit le fuseau du poste. */
const parisDateTime = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' });

const STATUS: Record<NonNullable<ScheduledReport['lastRunStatus']>, { label: string; tone: 'success' | 'amber' | 'danger' }> = {
  sent: { label: 'Envoyé', tone: 'success' },
  partial: { label: 'Envoi partiel', tone: 'amber' },
  failed: { label: 'Échec', tone: 'danger' },
  skipped: { label: 'Aucun envoi réel (destinataires de test)', tone: 'amber' },
};

function toInput(report: WithId<ScheduledReport>, patch: Partial<SaveScheduledReportInput>): SaveScheduledReportInput {
  const f = report.filters ?? {};
  return {
    id: report.id,
    name: report.name,
    report: report.report,
    frequency: report.frequency,
    recipients: report.recipients,
    format: report.format,
    hour: report.hour ?? 7,
    countryId: typeof f.countryId === 'string' ? f.countryId : null,
    cityIds: Array.isArray(f.cityIds) ? f.cityIds : null,
    active: report.active,
    ...patch,
  };
}

/** Rapports envoyés automatiquement par e-mail chaque jour, semaine ou mois (cahier §4). */
export function ScheduledReportsPage() {
  useDocumentTitle('Rapports programmés · GoLink Admin');
  const { can } = useAdminAccess();
  const geo = useGeoScope();
  const canView = can('reports.view');
  const canEdit = can('reports.schedule');
  const reportsQuery = useMemo(() => (canView ? query(collection(db, COLLECTIONS.scheduledReports), limit(100)) : null), [canView]);
  const { data, loading, error } = useCollection<ScheduledReport>(reportsQuery);
  const reports = useMemo(() => [...data].sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name, 'fr')), [data]);
  const cityNames = useMemo(() => new Map(geo.cities.map((c) => [c.id, c.name])), [geo.cities]);
  const countryNames = useMemo(() => new Map(geo.countries.map((c) => [c.id, c.name])), [geo.countries]);

  const [editing, setEditing] = useState<WithId<ScheduledReport> | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [preview, setPreview] = useState<{ report: WithId<ScheduledReport>; result: RunReportNowResult | null } | null>(null);
  const [sending, setSending] = useState<WithId<ScheduledReport> | null>(null);
  const [deleting, setDeleting] = useState<WithId<ScheduledReport> | null>(null);

  const previewMutation = useMutation(runReport);
  const sendMutation = useMutation(runReport, {
    success: (r) =>
      r.failed
        ? `${r.sent} envoi${r.sent > 1 ? 's' : ''} réussi${r.sent > 1 ? 's' : ''}, ${r.failed} en échec`
        : `Rapport envoyé à ${r.sent} destinataire${r.sent > 1 ? 's' : ''}`,
  });
  const deleteMutation = useMutation(deleteReport, { success: 'Rapport supprimé' });
  const toggleMutation = useMutation(saveReport);

  async function openPreview(report: WithId<ScheduledReport>) {
    setPreview({ report, result: null });
    const result = await previewMutation.mutate({ id: report.id, dryRun: true });
    if (result) setPreview({ report, result });
    else setPreview(null);
  }

  function scopeLabel(report: WithId<ScheduledReport>): string {
    const f = report.filters ?? {};
    const cities = Array.isArray(f.cityIds) ? f.cityIds : [];
    if (cities.length) return cities.map((id) => cityNames.get(id) ?? id).join(', ');
    if (typeof f.countryId === 'string' && f.countryId) return countryNames.get(f.countryId) ?? f.countryId;
    return 'Tous les marchés';
  }

  return (
    <ReportsLayout
      actions={
        canEdit && (
          <Button
            variant="primary"
            leftIcon={<Plus />}
            onClick={() => {
              setEditing(null);
              setFormOpen(true);
            }}
          >
            Programmer un rapport
          </Button>
        )
      }
    >
      {error ? (
        <Card>
          <LoadError error={error} className="py-12" />
        </Card>
      ) : loading ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-48 rounded-xl" />
          ))}
        </div>
      ) : reports.length === 0 ? (
        <Card>
          <EmptyState
            icon={<CalendarClock />}
            title="Aucun rapport programmé"
            description="Envoyez automatiquement une synthèse d’activité, un point financier ou un classement aux personnes concernées."
            action={
              canEdit && (
                <Button variant="primary" leftIcon={<Plus />} onClick={() => setFormOpen(true)}>
                  Programmer un rapport
                </Button>
              )
            }
          />
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {reports.map((report) => {
            const last = toMillis(report.lastRunAt);
            const next = toMillis(report.nextRunAt);
            const status = report.lastRunStatus ? STATUS[report.lastRunStatus] : null;
            return (
              <Card key={report.id} className="flex min-w-0 flex-col">
                <div className="flex items-start gap-3 p-5">
                  <span className="grid size-10 shrink-0 place-items-center rounded-xl border border-border bg-surface-2 text-fg-muted [&_svg]:size-5">
                    <FileText />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="truncate text-base font-semibold text-fg">{report.name}</h3>
                      {!report.active && <Badge size="sm">En pause</Badge>}
                    </div>
                    <p className="mt-0.5 text-xs text-fg-muted">
                      {REPORT_KIND_LABELS[report.report]} · {REPORT_FREQUENCY_LABELS[report.frequency]} à {String(report.hour ?? 7).padStart(2, '0')} h ·{' '}
                      {EXPORT_FORMAT_LABELS[report.format]}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    {canEdit && (
                      <Tooltip content={report.active ? 'Suspendre l’envoi automatique' : 'Réactiver l’envoi automatique'}>
                        <span>
                          <Switch
                            checked={report.active}
                            disabled={toggleMutation.loading}
                            aria-label={`Envoi automatique de « ${report.name} »`}
                            onCheckedChange={(active) => void toggleMutation.mutate(toInput(report, { active }))}
                          />
                        </span>
                      </Tooltip>
                    )}
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <IconButton label={`Actions sur « ${report.name} »`} size="sm">
                          <MoreHorizontal />
                        </IconButton>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent className="w-52">
                        <DropdownMenuItem icon={<Eye />} onSelect={() => void openPreview(report)}>
                          Aperçu
                        </DropdownMenuItem>
                        {canEdit && (
                          <>
                            <DropdownMenuItem icon={<Send />} onSelect={() => setSending(report)}>
                              Envoyer maintenant
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              icon={<Pencil />}
                              onSelect={() => {
                                setEditing(report);
                                setFormOpen(true);
                              }}
                            >
                              Modifier
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem icon={<Trash2 />} destructive onSelect={() => setDeleting(report)}>
                              Supprimer…
                            </DropdownMenuItem>
                          </>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
                <dl className="grid flex-1 grid-cols-1 gap-x-4 gap-y-3 border-t border-border px-5 py-4 text-sm sm:grid-cols-2">
                  <div className="min-w-0">
                    <dt className="text-xs text-fg-subtle">Destinataires</dt>
                    <dd className="mt-1 flex flex-wrap gap-1">
                      {report.recipients.slice(0, 3).map((r) => (
                        <span key={r} className="inline-flex max-w-full items-center gap-1 truncate rounded-md bg-surface-3 px-1.5 py-0.5 text-xs text-fg">
                          <Mail className="size-3 shrink-0 text-fg-subtle" />
                          <span className="truncate">{r}</span>
                        </span>
                      ))}
                      {report.recipients.length > 3 && <span className="text-xs text-fg-subtle">+{report.recipients.length - 3}</span>}
                    </dd>
                  </div>
                  <div className="min-w-0">
                    <dt className="text-xs text-fg-subtle">Périmètre</dt>
                    <dd className="mt-1 truncate text-fg">{scopeLabel(report)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-fg-subtle">Dernier envoi</dt>
                    <dd className="mt-1 flex flex-wrap items-center gap-2 text-fg">
                      {last ? formatRelative(last) : 'Jamais'}
                      {status && (
                        <Tooltip content={report.lastRunError || status.label} disabled={!report.lastRunError}>
                          <span>
                            <Badge size="sm" tone={status.tone}>
                              {status.label}
                            </Badge>
                          </span>
                        </Tooltip>
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-fg-subtle">Prochain envoi</dt>
                    <dd className="mt-1 text-fg">{report.active && next ? parisDateTime.format(next) : '—'}</dd>
                  </div>
                </dl>
              </Card>
            );
          })}
        </div>
      )}

      {canEdit && <ReportFormDialog open={formOpen} report={editing} onClose={() => setFormOpen(false)} />}

      <Dialog open={Boolean(preview)} onOpenChange={(open) => !open && setPreview(null)}>
        <DialogContent size="xl">
          <DialogHeader
            title={preview?.result?.subject ?? `Aperçu : ${preview?.report.name ?? ''}`}
            description={
              preview?.result
                ? `Période ${rangeLabel(preview.result.period)} · pièce jointe ${preview.result.attachmentName} · aucun e-mail envoyé.`
                : 'Préparation de l’aperçu…'
            }
            icon={<Eye />}
          />
          <DialogBody className="pt-2">
            {preview?.result ? (
              <iframe
                title="Aperçu de l’e-mail"
                srcDoc={preview.result.html}
                sandbox=""
                className="h-[60dvh] w-full rounded-lg border border-border bg-white"
              />
            ) : (
              <div className="grid h-[40dvh] place-items-center">
                <Spinner />
              </div>
            )}
          </DialogBody>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setPreview(null)}>
              Fermer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={Boolean(sending)}
        onOpenChange={(open) => !open && setSending(null)}
        title="Envoyer ce rapport maintenant ?"
        description={sending ? `Le rapport de la dernière période sera envoyé à ${sending.recipients.join(', ')}.` : undefined}
        confirmLabel="Envoyer"
        onConfirm={async () => {
          if (sending) await sendMutation.mutate({ id: sending.id, dryRun: false });
        }}
      />

      <ConfirmDialog
        open={Boolean(deleting)}
        onOpenChange={(open) => !open && setDeleting(null)}
        title="Supprimer ce rapport programmé ?"
        description={deleting ? `« ${deleting.name} » ne sera plus envoyé. Cette action est tracée dans le journal d’audit.` : undefined}
        confirmLabel="Supprimer"
        destructive
        requireReason
        onConfirm={async (reason) => {
          if (deleting) await deleteMutation.mutate({ id: deleting.id, reason: reason ?? '' });
        }}
      />
    </ReportsLayout>
  );
}
