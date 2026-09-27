// Traduction automatique (Azure Translator, cahier « translation-azure ») : le client
// renseigne lui-même sa clé Azure ici. La clé n'est jamais relue par le navigateur — seul
// l'état « configurée » et ses 4 derniers caractères masqués reviennent du serveur.
import { useEffect, useMemo, useState } from 'react';
import { limit, orderBy, query } from 'firebase/firestore';
import { CheckCircle2, Languages, Save, XCircle } from 'lucide-react';
import { Badge, Button, Card, CardContent, CardFooter, CardHeader, EmptyState, FormField, Input, PageContainer, PageHeader, Skeleton, Switch, formatDateTime } from '@golink/ui';
import { APP_LOCALES, COLLECTIONS, LOCALE_LABELS, type SettingsHistoryEntry } from '@golink/shared';
import { useDocumentTitle } from '@golink/web';
import { useCan } from '@/auth/AdminAccess';
import { collectionAt, toDate, useCollection, useMutation } from '@/lib/firestore';
import { saveTranslatorSettings, testTranslatorConnection } from './api';
import { ErrorPanel, RequirePermission } from './components';
import { useTranslatorSettings } from './hooks';
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

export function TraductionPage() {
  useDocumentTitle('Traduction · GoLink Admin');
  const can = useCan();
  const settings = useTranslatorSettings();
  const [reason, setReason] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [region, setRegion] = useState('');
  const [endpoint, setEndpoint] = useState('https://api.cognitive.microsofttranslator.com');
  const [enabled, setEnabled] = useState(false);
  const [activeLocales, setActiveLocales] = useState<string[]>(['fr', 'en', 'ar']);
  const [cap, setCap] = useState(0);
  const [testResult, setTestResult] = useState<{ ok: boolean; error: string | null } | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (settings.data && !loaded) {
      setRegion(settings.data.region ?? '');
      setEndpoint(settings.data.endpoint || 'https://api.cognitive.microsofttranslator.com');
      setEnabled(settings.data.enabled ?? false);
      setActiveLocales(settings.data.activeLocales ?? ['fr', 'en', 'ar']);
      setCap(settings.data.monthlyCharacterCap ?? 0);
      setLoaded(true);
    }
  }, [settings.data, loaded]);

  const save = useMutation(
    () => saveTranslatorSettings({ apiKey, region, endpoint, enabled, activeLocales, monthlyCharacterCap: cap, reason }),
    { success: 'Réglages de traduction enregistrés.' },
  );
  const test = useMutation(() => (apiKey ? testTranslatorConnection({ apiKey, region, endpoint }) : testTranslatorConnection({})), {});

  const history = useCollection<SettingsHistoryEntry & { changedByName?: string }>(
    useMemo(() => query(collectionAt(COLLECTIONS.settingsHistory), orderBy('changedAt', 'desc'), limit(30)), []),
  );
  const historyRows = history.data.filter((h) => h.docPath.endsWith('/translator'));

  if (settings.error) return <ErrorPanel error={settings.error} />;

  const status = settings.data?.status ?? 'not_configured';
  const capPercent = settings.data && settings.data.monthlyCharacterCap > 0 ? Math.round((100 * settings.data.charactersThisMonth) / settings.data.monthlyCharacterCap) : null;

  return (
    <PageContainer wide>
      <PageHeader
        eyebrow="Plateforme & sécurité"
        title="Traduction automatique"
        description="Azure Translator (même principe que StaffLink) : la clé d'abonnement se règle ici, une seule fois. Elle n'est jamais renvoyée au navigateur."
      >
        <PlateformeNav />
      </PageHeader>
      <RequirePermission permission="settings.view" title="Traduction automatique">
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="space-y-4 lg:col-span-2">
            <Card>
              <CardHeader
                icon={<Languages />}
                title="Connexion Azure Translator"
                description="Créez une ressource « Traducteur » dans le portail Azure pour obtenir la clé et la région (voir docs/I18N.md)."
                actions={settings.loading ? null : <Badge tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</Badge>}
              />
              <CardContent className="space-y-4">
                {settings.loading || !loaded ? (
                  <Skeleton className="h-64" />
                ) : (
                  <>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <FormField label="Clé d'abonnement" hint={settings.data?.keyLast4 ? `Clé enregistrée, se terminant par ${settings.data.keyLast4}. Laissez vide pour la conserver.` : 'Aucune clé enregistrée pour le moment.'}>
                        <Input
                          type="password"
                          value={apiKey}
                          onChange={(e) => setApiKey(e.target.value)}
                          placeholder={settings.data?.configured ? '•••••••••••••••• (inchangée)' : 'Clé d’abonnement Azure'}
                          disabled={!can('settings.edit')}
                          autoComplete="off"
                        />
                      </FormField>
                      <FormField label="Région Azure" required hint="Ex. : francecentral, westeurope.">
                        <Input value={region} onChange={(e) => setRegion(e.target.value)} disabled={!can('settings.edit')} />
                      </FormField>
                      <div className="sm:col-span-2">
                        <FormField label="Endpoint" hint="Valeur par défaut correcte pour la quasi-totalité des ressources Azure.">
                          <Input value={endpoint} onChange={(e) => setEndpoint(e.target.value)} disabled={!can('settings.edit')} />
                        </FormField>
                      </div>
                    </div>
                    <FormField label="Langues actives">
                      <div className="flex flex-wrap gap-3 pt-1">
                        {APP_LOCALES.map((l) => {
                          const checked = activeLocales.includes(l);
                          return (
                            <label key={l} className="flex items-center gap-2 rounded-lg border border-border bg-surface-2 px-3 py-1.5 text-sm">
                              <Switch checked={checked} onCheckedChange={(v) => setActiveLocales(v ? [...activeLocales, l] : activeLocales.filter((x) => x !== l))} disabled={!can('settings.edit') || l === 'fr'} />
                              {LOCALE_LABELS[l]}
                            </label>
                          );
                        })}
                      </div>
                    </FormField>
                    <div className="flex items-center justify-between rounded-lg border border-border bg-surface-2 px-3 py-2">
                      <div>
                        <p className="text-sm font-medium text-fg">Activée</p>
                        <p className="text-xs text-fg-subtle">Désactivez pour couper la traduction automatique sans perdre la clé enregistrée.</p>
                      </div>
                      <Switch checked={enabled} onCheckedChange={setEnabled} disabled={!can('settings.edit')} />
                    </div>
                    <FormField label="Plafond mensuel de caractères" hint="0 = illimité. Maîtrise le coût Azure (facturé au caractère).">
                      <Input type="number" min={0} value={cap} onChange={(e) => setCap(Number(e.target.value) || 0)} disabled={!can('settings.edit')} />
                    </FormField>
                    <FormField label="Motif de la modification" required hint="Conservé dans le journal d'audit.">
                      <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ex. : mise en service de la traduction automatique" maxLength={500} />
                    </FormField>
                    {testResult && (
                      <div className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm ${testResult.ok ? 'border-success/30 bg-success/10 text-success' : 'border-danger/30 bg-danger/10 text-danger'}`}>
                        {testResult.ok ? <CheckCircle2 className="size-4 shrink-0" /> : <XCircle className="size-4 shrink-0" />}
                        <span>{testResult.ok ? 'Connexion réussie : « Bonjour » → « Hello ».' : testResult.error}</span>
                      </div>
                    )}
                  </>
                )}
              </CardContent>
              {loaded && (
                <CardFooter className="justify-end gap-2">
                  <Button
                    variant="secondary"
                    loading={test.loading}
                    disabled={!can('settings.edit') || (!apiKey && !settings.data?.configured) || (!!apiKey && !region.trim())}
                    onClick={() => void test.mutate().then((r) => r && setTestResult({ ok: r.ok, error: r.error }))}
                  >
                    Tester la connexion
                  </Button>
                  <Button
                    leftIcon={<Save />}
                    loading={save.loading}
                    disabled={!can('settings.edit') || reason.trim().length < 3 || !region.trim() || activeLocales.length === 0}
                    onClick={() => void save.mutate().then((r) => { if (r) { setApiKey(''); setReason(''); } })}
                  >
                    Enregistrer
                  </Button>
                </CardFooter>
              )}
            </Card>

            <Card>
              <CardHeader title="Historique des modifications" description="Qui a changé quoi, quand, avec quel motif — jamais la clé elle-même." />
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
              <CardHeader title="Usage" description="Caractères traduits ce mois-ci." />
              <CardContent className="space-y-2">
                {settings.loading ? (
                  <Skeleton className="h-24" />
                ) : (
                  <>
                    <p className="text-2xl font-semibold text-fg">{(settings.data?.charactersThisMonth ?? 0).toLocaleString('fr-FR')}</p>
                    <p className="text-xs text-fg-subtle">
                      {settings.data?.monthlyCharacterCap ? `sur ${settings.data.monthlyCharacterCap.toLocaleString('fr-FR')} caractères (${capPercent}%)` : 'plafond illimité'}
                    </p>
                  </>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader title="Comportement" />
              <CardContent className="space-y-2 text-sm text-fg-muted">
                <p>Les traductions déjà faites ne sont jamais refaites (cache serveur).</p>
                <p>Si la traduction n'est pas configurée ou indisponible, les écrans affichent toujours le texte d'origine.</p>
                <p>Bouton « Traduire automatiquement » disponible sur les fiches produits, pages d'information, articles d'aide et gabarits de messages.</p>
              </CardContent>
            </Card>
          </div>
        </div>
      </RequirePermission>
    </PageContainer>
  );
}
