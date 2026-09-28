// Cartographie (Google Maps, tâche « maps-settings ») : le super admin renseigne ici les
// clés Google Maps — une clé « web » (chargée par les apps web) et une clé « mobile »
// (réservée aux futures apps Android/iOS). Comme pour la traduction automatique, les
// clés ne sont jamais relues par le navigateur — seuls l'état « configurée » et les
// 4 derniers caractères masqués reviennent du serveur. La clé web est malgré tout
// distribuée aux apps web par un canal dédié (getPublicRuntimeConfig, voir docs/CONTRATS_APPS_MOBILES.md),
// jamais par ce document ni par ce formulaire.
import { useEffect, useMemo, useState } from 'react';
import { limit, orderBy, query } from 'firebase/firestore';
import { CheckCircle2, MapPin, Save, XCircle } from 'lucide-react';
import { Badge, Button, Card, CardContent, CardFooter, CardHeader, EmptyState, FormField, Input, PageContainer, PageHeader, Skeleton, Textarea, formatDateTime } from '@golink/ui';
import { COLLECTIONS, type SettingsHistoryEntry } from '@golink/shared';
import { useDocumentTitle } from '@golink/web';
import { useCan } from '@/auth/AdminAccess';
import { collectionAt, toDate, useCollection, useMutation } from '@/lib/firestore';
import { saveMapsSettings, testMapsConnection } from './api';
import { ErrorPanel, RequirePermission } from './components';
import { useMapsSettings } from './hooks';
import { PlateformeNav } from './nav';

const STATUS_TONE: Record<string, 'success' | 'amber' | 'danger' | 'neutral'> = {
  configured: 'success',
  not_configured: 'neutral',
  error: 'danger',
};
const STATUS_LABEL: Record<string, string> = {
  configured: 'Configurée',
  not_configured: 'Non configurée',
  error: 'Erreur',
};

function linesOf(values: string[]): string {
  return values.join('\n');
}
function parseLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
}

export function CartographiePage() {
  useDocumentTitle('Cartographie · GoLink Admin');
  const can = useCan();
  const settings = useMapsSettings();
  const [reason, setReason] = useState('');
  const [webApiKey, setWebApiKey] = useState('');
  const [mobileApiKey, setMobileApiKey] = useState('');
  const [webReferrers, setWebReferrers] = useState('');
  const [mobileIdentifiers, setMobileIdentifiers] = useState('');
  const [webTestResult, setWebTestResult] = useState<{ ok: boolean; error: string | null } | null>(null);
  const [mobileTestResult, setMobileTestResult] = useState<{ ok: boolean; error: string | null } | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (settings.data && !loaded) {
      setWebReferrers(linesOf(settings.data.allowedWebReferrers ?? []));
      setMobileIdentifiers(linesOf(settings.data.allowedMobileIdentifiers ?? []));
      setLoaded(true);
    }
  }, [settings.data, loaded]);

  const save = useMutation(
    () =>
      saveMapsSettings({
        webApiKey,
        mobileApiKey,
        allowedWebReferrers: parseLines(webReferrers),
        allowedMobileIdentifiers: parseLines(mobileIdentifiers),
        reason,
      }),
    { success: 'Réglages de cartographie enregistrés.' },
  );
  const testWeb = useMutation(() => (webApiKey ? testMapsConnection({ which: 'web', apiKey: webApiKey }) : testMapsConnection({ which: 'web' })), {});
  const testMobile = useMutation(() => (mobileApiKey ? testMapsConnection({ which: 'mobile', apiKey: mobileApiKey }) : testMapsConnection({ which: 'mobile' })), {});

  const history = useCollection<SettingsHistoryEntry & { changedByName?: string }>(
    useMemo(() => query(collectionAt(COLLECTIONS.settingsHistory), orderBy('changedAt', 'desc'), limit(30)), []),
  );
  const historyRows = history.data.filter((h) => h.docPath.endsWith('/maps'));

  if (settings.error) return <ErrorPanel error={settings.error} />;

  const status = settings.data?.status ?? 'not_configured';

  return (
    <PageContainer wide>
      <PageHeader
        eyebrow="Plateforme & sécurité"
        title="Cartographie"
        description="Google Maps : clé web (apps web) et clé mobile (futures apps Android/iOS), réglables ici sans jamais rebuilder les applications."
      >
        <PlateformeNav />
      </PageHeader>
      <RequirePermission permission="settings.view" title="Cartographie">
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="space-y-4 lg:col-span-2">
            <Card>
              <CardHeader
                icon={<MapPin />}
                title="Clé web (Google Maps JavaScript)"
                description="Chargée par les apps web (admin, restaurant, bientôt client). Clé publique par nature : protégez-la côté Google Cloud par une restriction de référents HTTP, pas par le secret."
                actions={settings.loading ? null : <Badge tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</Badge>}
              />
              <CardContent className="space-y-4">
                {settings.loading || !loaded ? (
                  <Skeleton className="h-56" />
                ) : (
                  <>
                    <FormField label="Clé API web" hint={settings.data?.webKeyLast4 ? `Clé enregistrée, se terminant par ${settings.data.webKeyLast4}. Laissez vide pour la conserver.` : 'Aucune clé web enregistrée pour le moment.'}>
                      <Input
                        type="password"
                        value={webApiKey}
                        onChange={(e) => setWebApiKey(e.target.value)}
                        placeholder={settings.data?.configuredWeb ? '•••••••••••••••• (inchangée)' : 'Clé API Google Maps (web)'}
                        disabled={!can('settings.edit')}
                        autoComplete="off"
                      />
                    </FormField>
                    <FormField label="Référents HTTP autorisés" hint="Informatif : un par ligne, à configurer aussi côté Google Cloud Console (identifiants de la clé). Ex. https://admin.golink.example/*">
                      <Textarea rows={3} value={webReferrers} onChange={(e) => setWebReferrers(e.target.value)} disabled={!can('settings.edit')} />
                    </FormField>
                    {webTestResult && (
                      <div className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm ${webTestResult.ok ? 'border-success/30 bg-success/10 text-success' : 'border-danger/30 bg-danger/10 text-danger'}`}>
                        {webTestResult.ok ? <CheckCircle2 className="size-4 shrink-0" /> : <XCircle className="size-4 shrink-0" />}
                        <span>{webTestResult.ok ? 'Connexion réussie (API Geocoding).' : webTestResult.error}</span>
                      </div>
                    )}
                  </>
                )}
              </CardContent>
              {loaded && (
                <CardFooter className="justify-end gap-2">
                  <Button
                    variant="secondary"
                    loading={testWeb.loading}
                    disabled={!can('settings.edit') || (!webApiKey && !settings.data?.configuredWeb)}
                    onClick={() => void testWeb.mutate().then((r) => r && setWebTestResult({ ok: r.ok, error: r.error }))}
                  >
                    Tester la connexion
                  </Button>
                </CardFooter>
              )}
            </Card>

            <Card>
              <CardHeader
                icon={<MapPin />}
                title="Clé mobile (Android / iOS)"
                description="Réservée aux futures apps livreur et client mobiles. Ne quitte jamais le serveur : jamais renvoyée à une app web."
                actions={settings.loading ? null : <Badge tone={settings.data?.configuredMobile ? 'success' : 'neutral'}>{settings.data?.configuredMobile ? 'Configurée' : 'Non configurée'}</Badge>}
              />
              <CardContent className="space-y-4">
                {settings.loading || !loaded ? (
                  <Skeleton className="h-40" />
                ) : (
                  <>
                    <FormField label="Clé API mobile" hint={settings.data?.mobileKeyLast4 ? `Clé enregistrée, se terminant par ${settings.data.mobileKeyLast4}. Laissez vide pour la conserver.` : 'Aucune clé mobile enregistrée pour le moment.'}>
                      <Input
                        type="password"
                        value={mobileApiKey}
                        onChange={(e) => setMobileApiKey(e.target.value)}
                        placeholder={settings.data?.configuredMobile ? '•••••••••••••••• (inchangée)' : 'Clé API Google Maps (mobile)'}
                        disabled={!can('settings.edit')}
                        autoComplete="off"
                      />
                    </FormField>
                    <FormField label="Empreintes / identifiants d'app autorisés" hint="Informatif : un par ligne (empreinte SHA-1 du certificat Android, bundle ID iOS), à configurer côté Google Cloud Console.">
                      <Textarea rows={3} value={mobileIdentifiers} onChange={(e) => setMobileIdentifiers(e.target.value)} disabled={!can('settings.edit')} />
                    </FormField>
                    {mobileTestResult && (
                      <div className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm ${mobileTestResult.ok ? 'border-success/30 bg-success/10 text-success' : 'border-danger/30 bg-danger/10 text-danger'}`}>
                        {mobileTestResult.ok ? <CheckCircle2 className="size-4 shrink-0" /> : <XCircle className="size-4 shrink-0" />}
                        <span>{mobileTestResult.ok ? 'Connexion réussie (API Geocoding).' : mobileTestResult.error}</span>
                      </div>
                    )}
                  </>
                )}
              </CardContent>
              {loaded && (
                <CardFooter className="justify-end gap-2">
                  <Button
                    variant="secondary"
                    loading={testMobile.loading}
                    disabled={!can('settings.edit') || (!mobileApiKey && !settings.data?.configuredMobile)}
                    onClick={() => void testMobile.mutate().then((r) => r && setMobileTestResult({ ok: r.ok, error: r.error }))}
                  >
                    Tester la connexion
                  </Button>
                </CardFooter>
              )}
            </Card>

            {loaded && (
              <Card>
                <CardContent className="space-y-3 pt-4">
                  <FormField label="Motif de la modification" required hint="Conservé dans le journal d'audit.">
                    <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ex. : mise en service de la cartographie" maxLength={500} />
                  </FormField>
                </CardContent>
                <CardFooter className="justify-end gap-2">
                  <Button
                    leftIcon={<Save />}
                    loading={save.loading}
                    disabled={!can('settings.edit') || reason.trim().length < 3}
                    onClick={() => void save.mutate().then((r) => { if (r) { setWebApiKey(''); setMobileApiKey(''); setReason(''); setWebTestResult(null); setMobileTestResult(null); } })}
                  >
                    Enregistrer
                  </Button>
                </CardFooter>
              </Card>
            )}

            <Card>
              <CardHeader title="Historique des modifications" description="Qui a changé quoi, quand, avec quel motif — jamais les clés elles-mêmes." />
              <CardContent>
                {history.error ? (
                  <ErrorPanel error={history.error} compact />
                ) : history.loading ? (
                  <Skeleton className="h-32" />
                ) : historyRows.length === 0 ? (
                  <EmptyState compact title="Aucune modification enregistrée" />
                ) : (
                  <ul className="divide-y divide-border">
                    {historyRows.map((h) => {
                      const at = toDate(h.changedAt);
                      return (
                        <li key={h.id} className="space-y-1 py-3 text-sm">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-xs text-fg-subtle">{at ? formatDateTime(at) : ''} · {h.changedByName ?? h.changedBy}</span>
                          </div>
                          {h.reason && <p className="text-fg">« {h.reason} »</p>}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </CardContent>
            </Card>
          </div>

          <div className="space-y-4">
            <Card>
              <CardHeader title="Distribution aux clients" />
              <CardContent className="space-y-2 text-sm text-fg-muted">
                <p>La clé web est distribuée aux apps web au démarrage par un endpoint serveur dédié (getPublicRuntimeConfig), jamais copiée en clair dans le code des applications.</p>
                <p>Si la cartographie n'est pas configurée, les écrans affichent « Cartographie non configurée, contactez votre administrateur » au lieu d'un écran cassé.</p>
                <p>Les futures apps mobiles (client, livreur) suivront le même mécanisme pour leur clé propre — voir docs/CONTRATS_APPS_MOBILES.md.</p>
              </CardContent>
            </Card>
          </div>
        </div>
      </RequirePermission>
    </PageContainer>
  );
}
