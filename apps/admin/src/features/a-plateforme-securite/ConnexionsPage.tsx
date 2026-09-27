// Connexions externes (cahier §25) : état des services connectés (Stripe, Brevo,
// Google Maps…) et logiciels de caisse. La configuration des secrets se fait dans
// l'environnement sécurisé des fonctions ; ici, seuls les réglages publics.
import { useState } from 'react';
import { Plug, RefreshCw, XCircle } from 'lucide-react';
import { Badge, Button, Card, CardContent, CardHeader, EmptyState, FormField, Input, PageContainer, PageHeader, Select, Skeleton, Switch, toast } from '@golink/ui';
import { INTEGRATION_CATEGORY_LABELS, SERVICE_HEALTH_LABELS, type PlatformIntegration } from '@golink/shared';
import { useDocumentTitle } from '@golink/web';
import { useCan } from '@/auth/AdminAccess';
import { toDate, useMutation } from '@/lib/firestore';
import { runHealthCheck, updateIntegration } from './api';
import { ErrorPanel, RequirePermission } from './components';
import { useIntegrations } from './hooks';
import { PlateformeNav } from './nav';
import { PosConnectionsCard } from './PosConnections';

const HEALTH_TONE: Record<string, 'success' | 'amber' | 'danger' | 'neutral'> = {
  operational: 'success',
  degraded: 'amber',
  partial_outage: 'amber',
  major_outage: 'danger',
  maintenance: 'neutral',
};

function IntegrationCard({ integration }: { integration: PlatformIntegration & { id: string } }) {
  const can = useCan();
  const [config, setConfig] = useState(integration.publicConfig);
  const [enabled, setEnabled] = useState(integration.enabled);
  const [mode, setMode] = useState(integration.mode);
  const dirty = enabled !== integration.enabled || mode !== integration.mode || JSON.stringify(config) !== JSON.stringify(integration.publicConfig);
  const save = useMutation(
    () => updateIntegration({ key: integration.id, enabled, mode, publicConfig: config }),
    { success: 'Connexion mise à jour.' },
  );

  return (
    <Card>
      <CardHeader
        icon={<Plug />}
        title={integration.name}
        description={INTEGRATION_CATEGORY_LABELS[integration.category]}
        actions={
          <div className="flex items-center gap-2">
            <Badge tone={HEALTH_TONE[integration.status] ?? 'neutral'}>{SERVICE_HEALTH_LABELS[integration.status]}</Badge>
            <Switch checked={enabled} onCheckedChange={setEnabled} disabled={!can('integrations.edit')} />
          </div>
        }
      />
      <CardContent className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField label="Mode">
            <Select value={mode} onValueChange={(v) => setMode(v as 'test' | 'live')} options={[{ value: 'test', label: 'Test' }, { value: 'live', label: 'Production' }]} disabled={!can('integrations.edit')} />
          </FormField>
          {integration.lastError && <FormField label="Dernière erreur"><p className="truncate text-sm text-danger">{integration.lastError}</p></FormField>}
        </div>
        {Object.entries(config).length > 0 && (
          <div className="grid gap-3 sm:grid-cols-2">
            {Object.entries(config).map(([key, value]) => (
              <FormField key={key} label={key}>
                <Input
                  value={String(value)}
                  onChange={(e) => setConfig({ ...config, [key]: typeof value === 'number' ? Number(e.target.value) : e.target.value })}
                  disabled={!can('integrations.edit')}
                />
              </FormField>
            ))}
          </div>
        )}
        <p className="text-xs text-fg-subtle">Vérifiée {integration.lastCheckAt ? toDate(integration.lastCheckAt)?.toLocaleString('fr-FR') : 'jamais'}. Les clés secrètes se configurent dans l'environnement sécurisé des fonctions, jamais ici.</p>
        {dirty && can('integrations.edit') && (
          <div className="flex justify-end">
            <Button size="sm" loading={save.loading} onClick={() => void save.mutate()}>Enregistrer</Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function ConnexionsPage() {
  useDocumentTitle('Connexions · GoLink Admin');
  const can = useCan();
  const integrations = useIntegrations();
  const check = useMutation(() => runHealthCheck(), {});

  return (
    <PageContainer wide>
      <PageHeader
        eyebrow="Plateforme & sécurité"
        title="Connexions externes"
        description="État des services connectés (paiement, e-mails, cartographie, logiciels de caisse…). Les clés secrètes restent dans l'environnement sécurisé des fonctions."
        actions={can('system.view') && <Button variant="secondary" leftIcon={<RefreshCw className={check.loading ? 'animate-spin' : ''} />} loading={check.loading} onClick={() => void check.mutate().then((r) => r && toast.success('Sondes relancées.'))}>Relancer les sondes</Button>}
      >
        <PlateformeNav />
      </PageHeader>
      <RequirePermission permission="integrations.view" title="Connexions externes">
        {integrations.error ? (
          <ErrorPanel error={integrations.error} />
        ) : integrations.loading ? (
          <div className="grid gap-4 lg:grid-cols-2">{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-48" />)}</div>
        ) : integrations.data.length === 0 ? (
          <EmptyState icon={<XCircle />} title="Aucune connexion enregistrée" description="Les connexions apparaissent après la première vérification automatique (toutes les 10 minutes)." />
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {integrations.data.filter((i) => i.id !== 'pos').map((i) => (
              <IntegrationCard key={i.id} integration={i} />
            ))}
          </div>
        )}
        <div className="mt-4"><PosConnectionsCard /></div>
      </RequirePermission>
    </PageContainer>
  );
}
