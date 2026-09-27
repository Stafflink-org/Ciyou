// Santé et maintenance (cahier §30) : état des services, mode maintenance par
// application, versions minimales des applications mobiles, incidents.
import { useState } from 'react';
import { Activity, AlertOctagon, Plus } from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
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
  Switch,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
  Timeline,
  formatDateTime,
} from '@golink/ui';
import { APPS, APP_LABELS, INCIDENT_STATUS_LABELS, SERVICE_HEALTH_LABELS, SERVICE_KEYS, SERVICE_KEY_LABELS, type AppKey, type Incident, type ServiceHealth, type ServiceKey } from '@golink/shared';
import { useDocumentTitle } from '@golink/web';
import { useCan } from '@/auth/AdminAccess';
import { toDate, useMutation } from '@/lib/firestore';
import { saveIncident, setMaintenanceMode, updateAppVersion } from './api';
import { Callout, ErrorPanel, RequirePermission } from './components';
import { useAppVersions, useIncidents, useServiceStatuses } from './hooks';
import { PlateformeNav } from './nav';

const HEALTH_TONE: Record<ServiceHealth, 'success' | 'amber' | 'danger' | 'neutral'> = { operational: 'success', degraded: 'amber', partial_outage: 'amber', major_outage: 'danger', maintenance: 'neutral' };

function ServicesGrid() {
  const statuses = useServiceStatuses();
  if (statuses.error) return <ErrorPanel error={statuses.error} />;
  if (statuses.loading) return <div className="grid gap-3 sm:grid-cols-3">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-20" />)}</div>;
  const byKey = new Map(statuses.data.map((s) => [s.key ?? s.id, s]));
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {SERVICE_KEYS.map((key: ServiceKey) => {
        const s = byKey.get(key);
        const status: ServiceHealth = s?.status ?? 'operational';
        return (
          <Card key={key}>
            <CardContent className="flex items-center justify-between py-4">
              <div>
                <p className="text-sm font-medium text-fg">{SERVICE_KEY_LABELS[key]}</p>
                {s?.message && <p className="text-xs text-fg-subtle">{s.message}</p>}
                {s?.latencyMs != null && <p className="text-xs text-fg-subtle">{s.latencyMs} ms</p>}
              </div>
              <Badge tone={HEALTH_TONE[status] ?? 'neutral'}>{SERVICE_HEALTH_LABELS[status]}</Badge>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

function MaintenanceRow({ app }: { app: AppKey }) {
  const can = useCan();
  const [open, setOpen] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [message, setMessage] = useState('');
  const [reason, setReason] = useState('');
  const save = useMutation(() => setMaintenanceMode({ app, enabled, message: enabled ? message : null, until: null, reason }), { success: 'Mode maintenance mis à jour.' });
  return (
    <>
      <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-surface-2 px-4 py-3">
        <span className="text-sm font-medium text-fg">{APP_LABELS[app]}</span>
        {can('system.manage') && <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>Configurer</Button>}
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent size="sm">
          <DialogHeader title={`Maintenance · ${APP_LABELS[app]}`} />
          <DialogBody className="space-y-4 pt-2">
            <FormField label="Mode maintenance actif"><div className="flex h-10 items-center"><Switch checked={enabled} onCheckedChange={setEnabled} /></div></FormField>
            {enabled && <FormField label="Message affiché" required><Textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={2} maxLength={400} /></FormField>}
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} placeholder="Motif (conservé dans le journal d'audit)" maxLength={500} />
          </DialogBody>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>Annuler</Button>
            <Button loading={save.loading} disabled={reason.trim().length < 3 || (enabled && message.trim().length < 3)} onClick={async () => { const res = await save.mutate(); if (res) setOpen(false); }}>Enregistrer</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function VersionRow({ app }: { app: AppKey }) {
  const can = useCan();
  const versions = useAppVersions();
  const current = versions.data.find((v: any) => v.id === app) as any;
  const [open, setOpen] = useState(false);
  const [latest, setLatest] = useState(current?.latestVersion ?? '1.0.0');
  const [min, setMin] = useState(current?.minimumVersion ?? '1.0.0');
  const [force, setForce] = useState(Boolean(current?.forceUpdate));
  const [reason, setReason] = useState('');
  const save = useMutation(() => updateAppVersion({ app, latestVersion: latest, minimumVersion: min, forceUpdate: force, message: null, storeUrls: null, reason }), { success: 'Version enregistrée.' });
  return (
    <>
      <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-surface-2 px-4 py-3">
        <div>
          <p className="text-sm font-medium text-fg">{APP_LABELS[app]}</p>
          <p className="text-xs text-fg-subtle">Dernière {current?.latestVersion ?? '—'} · minimale {current?.minimumVersion ?? '—'}</p>
        </div>
        {can('system.manage') && <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>Modifier</Button>}
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent size="sm">
          <DialogHeader title={`Versions · ${APP_LABELS[app]}`} />
          <DialogBody className="space-y-4 pt-2">
            <div className="grid grid-cols-2 gap-3">
              <FormField label="Dernière version" required><Input value={latest} onChange={(e) => setLatest(e.target.value)} placeholder="1.2.3" /></FormField>
              <FormField label="Version minimale" required><Input value={min} onChange={(e) => setMin(e.target.value)} placeholder="1.2.0" /></FormField>
            </div>
            <FormField label="Mise à jour forcée"><div className="flex h-10 items-center"><Switch checked={force} onCheckedChange={setForce} /></div></FormField>
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} placeholder="Motif" maxLength={500} />
          </DialogBody>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>Annuler</Button>
            <Button loading={save.loading} disabled={reason.trim().length < 3} onClick={async () => { const res = await save.mutate(); if (res) setOpen(false); }}>Enregistrer</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function IncidentDialog({ open, onOpenChange, incident }: { open: boolean; onOpenChange: (v: boolean) => void; incident: (Incident & { id: string }) | null }) {
  const [title, setTitle] = useState(incident?.title ?? '');
  const [severity, setSeverity] = useState<Incident['severity']>(incident?.severity ?? 'warning');
  const [status, setStatus] = useState<Incident['status']>(incident?.status ?? 'investigating');
  const [services, setServices] = useState<ServiceKey[]>(incident?.services ?? []);
  const [update, setUpdate] = useState('');
  const save = useMutation(
    () => saveIncident({ incidentId: incident?.id ?? null, title, services, severity, status, update, publicMessage: null, postMortem: null }),
    { success: 'Incident enregistré.' },
  );
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <DialogHeader icon={<AlertOctagon />} title={incident ? 'Mettre à jour l’incident' : 'Ouvrir un incident'} />
        <DialogBody className="space-y-4 pt-2">
          <FormField label="Titre" required><Input value={title} onChange={(e) => setTitle(e.target.value)} disabled={Boolean(incident)} /></FormField>
          <div className="grid gap-3 sm:grid-cols-2">
            <FormField label="Gravité" required><Select value={severity} onValueChange={(v) => setSeverity(v as Incident['severity'])} options={[{ value: 'info', label: 'Information' }, { value: 'warning', label: 'Attention' }, { value: 'critical', label: 'Critique' }]} /></FormField>
            <FormField label="Statut" required><Select value={status} onValueChange={(v) => setStatus(v as Incident['status'])} options={(['investigating', 'identified', 'monitoring', 'resolved'] as const).map((s) => ({ value: s, label: INCIDENT_STATUS_LABELS[s] }))} /></FormField>
          </div>
          <FormField label="Services concernés" required>
            <div className="flex flex-wrap gap-2">
              {SERVICE_KEYS.map((k) => (
                <label key={k} className="flex items-center gap-1.5 rounded-lg border border-border bg-surface-2 px-2 py-1 text-xs">
                  <Switch checked={services.includes(k)} onCheckedChange={(v) => setServices(v ? [...services, k] : services.filter((x) => x !== k))} />
                  {SERVICE_KEY_LABELS[k]}
                </label>
              ))}
            </div>
          </FormField>
          <FormField label="Point d'étape" required><Textarea value={update} onChange={(e) => setUpdate(e.target.value)} rows={3} maxLength={1000} /></FormField>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Annuler</Button>
          <Button loading={save.loading} disabled={title.trim().length < 4 || services.length === 0 || update.trim().length < 3} onClick={async () => { const res = await save.mutate(); if (res) onOpenChange(false); }}>Enregistrer</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function IncidentsTab() {
  const can = useCan();
  const incidents = useIncidents();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<(Incident & { id: string }) | null>(null);
  return (
    <div className="space-y-4">
      <div className="flex justify-end">{can('system.manage') && <Button leftIcon={<Plus />} onClick={() => { setEditing(null); setOpen(true); }}>Ouvrir un incident</Button>}</div>
      {incidents.error ? (
        <ErrorPanel error={incidents.error} />
      ) : incidents.data.length === 0 ? (
        <EmptyState icon={<Activity />} title="Aucun incident" description="La plateforme fonctionne normalement." />
      ) : (
        <div className="space-y-3">
          {incidents.data.map((incident) => (
            <Card key={incident.id} interactive onClick={() => can('system.manage') && (setEditing(incident), setOpen(true))}>
              <CardHeader
                title={incident.title}
                description={`${incident.services.map((s) => SERVICE_KEY_LABELS[s]).join(', ')} · ouvert ${formatDateTime(toDate(incident.startedAt) ?? new Date())}`}
                actions={<Badge tone={incident.status === 'resolved' ? 'success' : incident.severity === 'critical' ? 'danger' : 'amber'}>{INCIDENT_STATUS_LABELS[incident.status]}</Badge>}
              />
              <CardContent>
                <Timeline items={incident.updates.slice(-3).map((u, i) => ({ id: String(i), title: INCIDENT_STATUS_LABELS[u.status], time: formatDateTime(toDate(u.at) ?? new Date()), description: u.message }))} />
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      <IncidentDialog open={open} onOpenChange={setOpen} incident={editing} />
    </div>
  );
}

export function SanteMaintenancePage() {
  useDocumentTitle('Santé · GoLink Admin');
  return (
    <PageContainer wide>
      <PageHeader eyebrow="Plateforme & sécurité" title="Santé et maintenance" description="État des services, mode maintenance par application, versions minimales, incidents.">
        <PlateformeNav />
      </PageHeader>
      <RequirePermission permission="system.view" title="Santé et maintenance">
        <Tabs defaultValue="services">
          <TabsList>
            <TabsTrigger value="services">Services</TabsTrigger>
            <TabsTrigger value="maintenance">Maintenance</TabsTrigger>
            <TabsTrigger value="versions">Versions</TabsTrigger>
            <TabsTrigger value="incidents">Incidents</TabsTrigger>
          </TabsList>
          <TabsContent value="services" className="pt-4"><ServicesGrid /></TabsContent>
          <TabsContent value="maintenance" className="space-y-3 pt-4">
            <Callout tone="amber" title="Mode maintenance">Bloque l'accès à l'application concernée avec un message affiché aux utilisateurs.</Callout>
            {APPS.map((app) => <MaintenanceRow key={app} app={app} />)}
          </TabsContent>
          <TabsContent value="versions" className="space-y-3 pt-4">
            {APPS.filter((a) => a !== 'admin').map((app) => <VersionRow key={app} app={app} />)}
          </TabsContent>
          <TabsContent value="incidents" className="pt-4"><IncidentsTab /></TabsContent>
        </Tabs>
      </RequirePermission>
    </PageContainer>
  );
}
