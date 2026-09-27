// Activation des fonctionnalités (cahier §24) : valeur plateforme et surcharges par
// pays, ville, formule ou commerce. Les fonctionnalités verrouillées (ex. vente
// d'alcool) ne peuvent pas être activées ni surchargées.
import { useMemo, useState } from 'react';
import { Lock, Plus, Save, Trash2 } from 'lucide-react';
import { Badge, Button, Card, CardContent, CardHeader, EmptyState, FormField, IconButton, Input, PageContainer, PageHeader, Select, Skeleton, Switch, Textarea } from '@golink/ui';
import { FEATURE_KEYS, FEATURE_LABELS, FEATURE_SCOPE_LABELS, type FeatureFlag, type FeatureScope } from '@golink/shared';
import { useDocumentTitle } from '@golink/web';
import { useCan } from '@/auth/AdminAccess';
import { useMutation } from '@/lib/firestore';
import { setFeatureFlag } from './api';
import { Callout, ErrorPanel, RequirePermission } from './components';
import { useAllCities, useCountries, useFeatureFlags } from './hooks';
import { PlateformeNav } from './nav';

const SCOPES: Exclude<FeatureScope, 'platform'>[] = ['country', 'city', 'plan', 'restaurant'];

function FlagCard({ flag }: { flag: FeatureFlag & { id: string } }) {
  const can = useCan();
  const [enabled, setEnabled] = useState(flag.enabled);
  const [overrides, setOverrides] = useState(flag.overrides);
  const [reason, setReason] = useState('');
  const [draft, setDraft] = useState<{ scope: Exclude<FeatureScope, 'platform'>; scopeId: string }>({ scope: 'country', scopeId: '' });
  const countries = useCountries();
  const cities = useAllCities();
  // Portées proposées sous forme de liste (pays, villes, formules) ; identifiant libre pour un commerce.
  const scopeOptions = useMemo(() => {
    if (draft.scope === 'country') return countries.data.map((c) => ({ value: c.id, label: `${c.name} (${c.id})` }));
    if (draft.scope === 'city') return cities.data.map((c) => ({ value: c.id, label: `${c.name} (${c.countryId})` }));
    if (draft.scope === 'plan') return ['basic', 'pro', 'premium'].map((p) => ({ value: p, label: p }));
    return null;
  }, [draft.scope, countries.data, cities.data]);
  const dirty = enabled !== flag.enabled || JSON.stringify(overrides) !== JSON.stringify(flag.overrides);
  const save = useMutation(
    () => setFeatureFlag({ key: flag.id, enabled, overrides, reason }),
    { success: 'Fonctionnalité mise à jour.' },
  );

  return (
    <Card>
      <CardHeader
        title={FEATURE_LABELS[flag.key] ?? flag.key}
        description={flag.description}
        actions={flag.locked ? <Badge tone="amber" icon={<Lock />}>Verrouillée</Badge> : <Switch checked={enabled} onCheckedChange={setEnabled} disabled={!can('features.edit')} />}
      />
      <CardContent className="space-y-3">
        {flag.locked && <Callout tone="amber" title="Verrouillée par décision de la direction">Cette fonctionnalité ne peut pas être activée ni surchargée (voir décisions client).</Callout>}
        {!flag.locked && (
          <>
            <p className="text-xs font-medium text-fg-subtle">Surcharges (la plus spécifique l'emporte)</p>
            {overrides.length === 0 ? (
              <p className="text-sm text-fg-subtle">Aucune surcharge : la valeur plateforme s'applique partout.</p>
            ) : (
              <ul className="space-y-1.5">
                {overrides.map((o, i) => (
                  <li key={`${o.scope}-${o.scopeId}`} className="flex items-center justify-between gap-2 rounded-lg border border-border bg-surface-2 px-3 py-1.5 text-sm">
                    <span>
                      <Badge tone="neutral" className="mr-2">{FEATURE_SCOPE_LABELS[o.scope]}</Badge>
                      {o.scopeId}
                    </span>
                    <div className="flex items-center gap-2">
                      <Switch checked={o.enabled} onCheckedChange={(v) => setOverrides(overrides.map((x, j) => (j === i ? { ...x, enabled: v } : x)))} disabled={!can('features.edit')} />
                      <IconButton size="sm" variant="ghost" label="Retirer" onClick={() => setOverrides(overrides.filter((_, j) => j !== i))}><Trash2 /></IconButton>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {can('features.edit') && (
              <div className="flex flex-wrap items-end gap-2 border-t border-border pt-3">
                <FormField label="Portée" className="w-40"><Select value={draft.scope} onValueChange={(v) => setDraft({ scope: v as Exclude<FeatureScope, 'platform'>, scopeId: '' })} options={SCOPES.map((s) => ({ value: s, label: FEATURE_SCOPE_LABELS[s] }))} /></FormField>
                <FormField label={draft.scope === 'restaurant' ? 'Identifiant du commerce' : 'Choix'} className="w-56">
                  {scopeOptions ? (
                    <Select value={draft.scopeId} onValueChange={(v) => setDraft({ ...draft, scopeId: v })} options={scopeOptions} placeholder="Choisir" />
                  ) : (
                    <Input value={draft.scopeId} onChange={(e) => setDraft({ ...draft, scopeId: e.target.value })} placeholder="ex. casa-arepa" />
                  )}
                </FormField>
                <Button
                  size="sm"
                  variant="secondary"
                  leftIcon={<Plus />}
                  disabled={!draft.scopeId.trim()}
                  onClick={() => {
                    setOverrides([...overrides, { scope: draft.scope, scopeId: draft.scopeId.trim(), enabled: !enabled }]);
                    setDraft({ ...draft, scopeId: '' });
                  }}
                >
                  Ajouter
                </Button>
              </div>
            )}
          </>
        )}
        {dirty && can('features.edit') && (
          <div className="space-y-2 border-t border-border pt-3">
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} placeholder="Motif (conservé dans le journal d'audit)" maxLength={500} />
            <div className="flex justify-end">
              <Button size="sm" leftIcon={<Save />} loading={save.loading} disabled={reason.trim().length < 3} onClick={() => void save.mutate()}>
                Enregistrer
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function FonctionnalitesPage() {
  useDocumentTitle('Fonctionnalités · GoLink Admin');
  const flags = useFeatureFlags();
  const byKey = useMemo(() => new Map(flags.data.map((f) => [f.key, f])), [flags.data]);
  const missing = FEATURE_KEYS.filter((k) => !byKey.has(k));

  return (
    <PageContainer wide>
      <PageHeader eyebrow="Plateforme & sécurité" title="Activation des fonctionnalités" description="Interrupteurs à portée plateforme, pays, ville, formule ou commerce. La portée la plus spécifique l'emporte sur la valeur générale.">
        <PlateformeNav />
      </PageHeader>
      <RequirePermission permission="features.edit" title="Activation des fonctionnalités">
        {flags.error ? (
          <ErrorPanel error={flags.error} />
        ) : flags.loading ? (
          <div className="grid gap-4 lg:grid-cols-2">{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-56" />)}</div>
        ) : flags.data.length === 0 && missing.length === 0 ? (
          <EmptyState title="Aucune fonctionnalité définie" description="Les fonctionnalités sont créées automatiquement lors de leur première activation." />
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {flags.data.map((f) => (
              <FlagCard key={f.id} flag={f} />
            ))}
            {missing.map((key) => (
              // Jamais configurée : active par défaut (les modules lisent l'absence de réglage comme « activée »).
              <FlagCard key={key} flag={{ id: key, key, description: `${FEATURE_LABELS[key]} : jamais configurée, active par défaut. Enregistrez pour créer le réglage.`, enabled: true, overrides: [], locked: false } as unknown as FeatureFlag & { id: string }} />
            ))}
          </div>
        )}
      </RequirePermission>
    </PageContainer>
  );
}
