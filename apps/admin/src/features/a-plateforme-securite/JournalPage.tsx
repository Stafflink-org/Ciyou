// Journal d'audit (cahier §27) : consultation transversale, non modifiable. Filtres par
// période, auteur, type de cible, action, actions sensibles et recherche libre ; détail
// « avant / après » et motif de chaque entrée ; export CSV du périmètre filtré (lui-même tracé).
import { useMemo, useState } from 'react';
import { limit, orderBy, query, where, Timestamp } from 'firebase/firestore';
import { Download, Eye, ShieldAlert } from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  Checkbox,
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
  Skeleton,
  formatDateTime,
  toast,
  Table,
} from '@golink/ui';
import { COLLECTIONS, type AuditLog, type WithId } from '@golink/shared';
import { useDocumentTitle } from '@golink/web';
import { collectionAt, toDate, useCollection, useMutation } from '@/lib/firestore';
import { auditActionLabel, auditFieldLabel, formatAuditField } from '../acteurs-commun/audit-labels';
import { exportAuditLogs } from './api';
import { ErrorPanel, RequirePermission } from './components';
import { useAdmins } from './hooks';
import { PlateformeNav } from './nav';

const TARGET_TYPES = ['restaurant', 'client', 'driver', 'admin', 'order', 'payout', 'refund', 'ticket', 'promotion', 'setting', 'restaurant_group', 'other'];
const STEPS = [200, 500, 1000];
const ALL = 'all';

function day(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function DetailDialog({ log, onClose }: { log: WithId<AuditLog> | null; onClose: () => void }) {
  if (!log) return null;
  const keys = [...new Set([...Object.keys(log.before ?? {}), ...Object.keys(log.after ?? {})])];
  const meta = auditActionLabel(log.action);
  const at = toDate(log.at);
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent size="md">
        <DialogHeader title={meta.label} description={`${log.action}${at ? ` · ${formatDateTime(at)}` : ''}`} />
        <DialogBody className="space-y-3 pt-2 text-sm">
          <dl className="grid grid-cols-[8rem_1fr] gap-x-3 gap-y-1.5">
            <dt className="text-fg-subtle">Auteur</dt>
            <dd>{log.actor.type === 'system' ? 'Automatique' : `${log.actor.name}${log.actor.role ? ` (${log.actor.role})` : ''}`}</dd>
            <dt className="text-fg-subtle">Cible</dt>
            <dd className="break-all">{log.target.label ?? log.target.id} <span className="text-fg-subtle">({log.target.type})</span></dd>
            <dt className="text-fg-subtle">Motif</dt>
            <dd>{log.reason ? `« ${log.reason} »` : <span className="text-fg-subtle">Aucun motif enregistré</span>}</dd>
            {(log.cityId || log.countryId) && (
              <>
                <dt className="text-fg-subtle">Périmètre</dt>
                <dd>{[log.countryId, log.cityId].filter(Boolean).join(' · ')}</dd>
              </>
            )}
            <dt className="text-fg-subtle">Appareil</dt>
            <dd className="break-words text-xs text-fg-muted">{log.userAgent ?? '—'}</dd>
          </dl>
          {keys.length > 0 && (
            <div className="space-y-1 rounded-lg border border-border bg-surface-2 px-3 py-2 text-xs">
              {keys.map((key) => (
                <div key={key} className="grid grid-cols-[minmax(0,8rem)_1fr] gap-2">
                  <span className="truncate text-fg-subtle">{auditFieldLabel(key)}</span>
                  <span className="min-w-0 break-words text-fg-muted">
                    {log.before && key in log.before && (
                      <>
                        <span className="line-through decoration-fg-subtle/60">{formatAuditField(key, log.before[key])}</span>
                        <span className="mx-1.5 text-fg-subtle">→</span>
                      </>
                    )}
                    <span className="text-fg">{formatAuditField(key, log.after?.[key])}</span>
                  </span>
                </div>
              ))}
            </div>
          )}
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Fermer</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function JournalTable() {
  const admins = useAdmins();
  const [from, setFrom] = useState(() => day(Date.now() - 7 * 86_400_000));
  const [to, setTo] = useState(() => day(Date.now()));
  const [actor, setActor] = useState(ALL);
  const [targetType, setTargetType] = useState(ALL);
  const [prefix, setPrefix] = useState('');
  const [search, setSearch] = useState('');
  const [sensitiveOnly, setSensitiveOnly] = useState(false);
  const [max, setMax] = useState(STEPS[0]!);
  const [detail, setDetail] = useState<WithId<AuditLog> | null>(null);

  const fromMs = new Date(from).getTime();
  const toMs = new Date(to).getTime() + 86_400_000 - 1;
  const logsQuery = useMemo(() => {
    if (!Number.isFinite(fromMs) || !Number.isFinite(toMs)) return null;
    const range = [where('at', '>=', Timestamp.fromMillis(fromMs)), where('at', '<=', Timestamp.fromMillis(toMs)), orderBy('at', 'desc'), limit(max)];
    return actor === ALL ? query(collectionAt(COLLECTIONS.auditLogs), ...range) : query(collectionAt(COLLECTIONS.auditLogs), where('actor.uid', '==', actor), ...range);
  }, [fromMs, toMs, actor, max]);
  const logs = useCollection<AuditLog>(logsQuery);

  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return logs.data
      .filter((l) => !prefix.trim() || l.action.startsWith(prefix.trim()))
      .filter((l) => targetType === ALL || l.target?.type === targetType)
      .filter((l) => !sensitiveOnly || l.sensitive)
      .filter((l) => !needle || `${l.action} ${l.actor?.name ?? ''} ${l.target?.label ?? ''} ${l.target?.id ?? ''} ${l.reason ?? ''}`.toLowerCase().includes(needle));
  }, [logs.data, prefix, targetType, sensitiveOnly, search]);

  const exportLogs = useMutation(
    () =>
      exportAuditLogs({
        from: fromMs,
        to: toMs,
        actionPrefix: prefix.trim() || null,
        actorUid: actor === ALL ? null : actor,
        targetType: targetType === ALL ? null : targetType,
        sensitiveOnly,
        search: search.trim() || null,
      }),
    {},
  );

  return (
    <Card>
      <CardHeader icon={<ShieldAlert />} title="Journal d’audit" description="Qui, quoi, quand, pourquoi : chaque action sensible de l’équipe, non modifiable." />
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <FormField label="Du"><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></FormField>
          <FormField label="Au"><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></FormField>
          <FormField label="Auteur">
            <Select value={actor} onValueChange={setActor} options={[{ value: ALL, label: 'Tous' }, ...admins.data.map((a) => ({ value: a.id, label: a.displayName }))]} />
          </FormField>
          <FormField label="Type de cible">
            <Select value={targetType} onValueChange={setTargetType} options={[{ value: ALL, label: 'Toutes' }, ...TARGET_TYPES.map((t) => ({ value: t, label: t }))]} />
          </FormField>
          <FormField label="Action commence par"><Input value={prefix} onChange={(e) => setPrefix(e.target.value)} placeholder="ex. refund., settings." /></FormField>
          <FormField label="Recherche"><Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="auteur, cible, motif…" /></FormField>
          <FormField label="Actions sensibles"><div className="flex h-10 items-center"><Checkbox checked={sensitiveOnly} onCheckedChange={(v) => setSensitiveOnly(v === true)} label="Seulement les sensibles" /></div></FormField>
          <div className="flex items-end">
            <Button
              variant="secondary"
              leftIcon={<Download />}
              loading={exportLogs.loading}
              onClick={async () => {
                const res = await exportLogs.mutate();
                if (!res) return;
                const link = document.createElement('a');
                link.href = `data:${res.mimeType};base64,${res.contentBase64}`;
                link.download = res.fileName;
                link.click();
                toast.success(`${res.rowCount} ligne(s) exportée(s).`);
              }}
            >
              Exporter ce périmètre
            </Button>
          </div>
        </div>

        {logs.error ? (
          <ErrorPanel error={logs.error} compact />
        ) : logs.loading ? (
          <Skeleton className="h-64" />
        ) : rows.length === 0 ? (
          <EmptyState compact title="Aucune entrée" description="Aucune entrée du journal ne correspond à ces filtres sur la période." />
        ) : (
          <div className="overflow-x-auto rounded-xl border border-border">
            <Table className="text-left text-sm">
              <thead className="bg-surface-2 text-xs uppercase tracking-wide text-fg-subtle">
                <tr>
                  <th className="px-3 py-2 font-medium">Date</th>
                  <th className="px-3 py-2 font-medium">Auteur</th>
                  <th className="px-3 py-2 font-medium">Action</th>
                  <th className="px-3 py-2 font-medium">Cible</th>
                  <th className="px-3 py-2 font-medium">Motif</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((log) => {
                  const meta = auditActionLabel(log.action);
                  const at = toDate(log.at);
                  return (
                    <tr key={log.id} className="align-top hover:bg-surface-2/60">
                      <td className="whitespace-nowrap px-3 py-2 text-fg-muted">{at ? formatDateTime(at) : '—'}</td>
                      <td className="px-3 py-2">{log.actor.type === 'system' ? <span className="text-fg-subtle">Automatique</span> : log.actor.name}</td>
                      <td className="px-3 py-2">
                        <span className="text-fg">{meta.label}</span>
                        <span className="block text-2xs text-fg-subtle">{log.action}</span>
                        {log.sensitive && <Badge size="sm" tone="amber" className="mt-1">Sensible</Badge>}
                      </td>
                      <td className="max-w-56 truncate px-3 py-2 text-fg-muted" title={log.target?.label ?? log.target?.id}>{log.target?.label ?? log.target?.id}</td>
                      <td className="max-w-64 truncate px-3 py-2 text-fg-muted" title={log.reason ?? ''}>{log.reason ?? '—'}</td>
                      <td className="px-3 py-2 text-right"><Button size="xs" variant="ghost" leftIcon={<Eye />} onClick={() => setDetail(log)}>Détail</Button></td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          </div>
        )}
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-fg-subtle">
          <span>{rows.length} entrée(s) affichée(s) sur {logs.data.length} chargée(s).</span>
          {logs.data.length >= max && max < STEPS[STEPS.length - 1]! && (
            <Button size="sm" variant="ghost" onClick={() => setMax(STEPS[STEPS.indexOf(max) + 1] ?? max)}>Charger plus</Button>
          )}
        </div>
      </CardContent>
      <DetailDialog log={detail} onClose={() => setDetail(null)} />
    </Card>
  );
}

export function JournalPage() {
  useDocumentTitle('Journal d’audit · GoLink Admin');
  return (
    <PageContainer wide>
      <PageHeader eyebrow="Plateforme & sécurité" title="Journal d’audit" description="Consultation transversale du journal non modifiable : filtres, détail avant/après, motif et export.">
        <PlateformeNav />
      </PageHeader>
      <RequirePermission permission="audit.view" title="Journal d’audit">
        <JournalTable />
      </RequirePermission>
    </PageContainer>
  );
}
