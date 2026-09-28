// Paramètres plateforme (cahier §22) : identité et réglages régionaux, politique de
// sécurité (double authentification, sessions, seuils d'alerte) et durées de
// conservation. Chaque enregistrement est historisé (ancienne et nouvelle valeur).
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { limit, orderBy, query } from 'firebase/firestore';
import { ImageUp, Palette, Save, ShieldCheck, Timer, Trash2 } from 'lucide-react';
import { Badge, Button, Card, CardContent, CardFooter, CardHeader, EmptyState, FormField, Input, PageContainer, PageHeader, Select, Skeleton, Switch, Tabs, TabsContent, TabsList, TabsTrigger, formatDateTime, toast } from '@golink/ui';
import { COLLECTIONS, CURRENCY_CODES, CURRENCY_LABELS, LOCALES, LOCALE_LABELS, SETTINGS_DOCS, type CurrencyCode, type SettingsHistoryEntry } from '@golink/shared';
import { useDocumentTitle } from '@golink/web';
import { useCan } from '@/auth/AdminAccess';
import { collectionAt, docAt, errorMessage, toDate, useCollection, useDoc, useMutation } from '@/lib/firestore';
import { updatePlatformSettings } from './api';
import { ErrorPanel, RequirePermission } from './components';
import { useGeneralSettings, useRetentionSettings, useSecurityPolicy } from './hooks';
import { PlateformeNav } from './nav';
import { auditFieldLabel, formatAuditField } from '../acteurs-commun/audit-labels';
import { uploadPublicImage } from '../affichage/shared';

function ReasonField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <FormField label="Motif de la modification" required hint="Conservé dans le journal d'audit.">
      <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder="Ex. : mise à jour réglementaire, décision de la direction…" maxLength={500} />
    </FormField>
  );
}

function GeneralForm() {
  const can = useCan();
  const settings = useGeneralSettings();
  const [reason, setReason] = useState('');
  const [form, setForm] = useState<Record<string, unknown> | null>(null);
  useEffect(() => {
    if (settings.data && !form) setForm(settings.data as unknown as Record<string, unknown>);
  }, [settings.data, form]);
  const save = useMutation((data: Record<string, unknown>) => updatePlatformSettings({ doc: 'general', reason, data: data as any }), { success: 'Réglages enregistrés.' });

  if (settings.error) return <ErrorPanel error={settings.error} />;
  if (!form) return <Skeleton className="h-96" />;
  const set = (k: string, v: unknown) => setForm((f) => ({ ...(f ?? {}), [k]: v }));

  return (
    <Card>
      <CardHeader title="Identité et régional" description="Nom affiché, coordonnées de support, langue, devise et fuseau par défaut." />
      <CardContent className="grid gap-4 sm:grid-cols-2">
        <FormField label="Nom de la plateforme" required>
          <Input value={String(form.platformName ?? '')} onChange={(e) => set('platformName', e.target.value)} maxLength={40} />
        </FormField>
        <FormField label="Raison sociale" required>
          <Input value={String(form.legalEntityName ?? '')} onChange={(e) => set('legalEntityName', e.target.value)} maxLength={120} />
        </FormField>
        <FormField label="E-mail support" required>
          <Input type="email" value={String(form.supportEmail ?? '')} onChange={(e) => set('supportEmail', e.target.value)} />
        </FormField>
        <FormField label="Téléphone support">
          <Input value={String(form.supportPhone ?? '')} onChange={(e) => set('supportPhone', e.target.value || null)} />
        </FormField>
        <FormField label="Pays par défaut" required hint="Code ISO à 2 lettres (ex. FR).">
          <Input value={String(form.defaultCountryId ?? '')} onChange={(e) => set('defaultCountryId', e.target.value.toUpperCase())} maxLength={2} />
        </FormField>
        <FormField label="Devise par défaut" required>
          <Select value={String(form.currency ?? 'EUR')} onValueChange={(v) => set('currency', v)} options={CURRENCY_CODES.map((c) => ({ value: c, label: CURRENCY_LABELS[c as CurrencyCode] }))} />
        </FormField>
        <FormField label="Langue par défaut" required>
          <Select value={String(form.defaultLocale ?? 'fr')} onValueChange={(v) => set('defaultLocale', v)} options={LOCALES.map((l) => ({ value: l, label: LOCALE_LABELS[l] }))} />
        </FormField>
        <FormField label="Fuseau horaire par défaut" required>
          <Input value={String(form.defaultTimezone ?? '')} onChange={(e) => set('defaultTimezone', e.target.value)} placeholder="Europe/Paris" />
        </FormField>
        <div className="sm:col-span-2">
          <FormField label="Langues proposées dans les applications" required hint="Doit inclure la langue par défaut.">
            <div className="flex flex-wrap gap-3 pt-1">
              {LOCALES.map((l) => {
                const list = (form.supportedLocales as string[] | undefined) ?? [];
                const checked = list.includes(l);
                return (
                  <label key={l} className="flex items-center gap-2 rounded-lg border border-border bg-surface-2 px-3 py-1.5 text-sm">
                    <Switch checked={checked} onCheckedChange={(v) => set('supportedLocales', v ? [...list, l] : list.filter((x) => x !== l))} />
                    {LOCALE_LABELS[l]}
                  </label>
                );
              })}
            </div>
          </FormField>
        </div>
        <div className="sm:col-span-2">
          <ReasonField value={reason} onChange={setReason} />
        </div>
      </CardContent>
      <CardFooter className="justify-end">
        <Button
          leftIcon={<Save />}
          loading={save.loading}
          disabled={!can('settings.edit') || reason.trim().length < 3}
          onClick={() =>
            void save.mutate({
              platformName: form.platformName,
              legalEntityName: form.legalEntityName,
              supportEmail: form.supportEmail,
              supportPhone: form.supportPhone ?? null,
              defaultCountryId: form.defaultCountryId,
              defaultLocale: form.defaultLocale,
              defaultTimezone: form.defaultTimezone,
              currency: form.currency,
              supportedLocales: form.supportedLocales ?? ['fr'],
            })
          }
        >
          Enregistrer
        </Button>
      </CardFooter>
    </Card>
  );
}

function SecurityForm() {
  const can = useCan();
  const policy = useSecurityPolicy();
  const [reason, setReason] = useState('');
  const [form, setForm] = useState<Record<string, any> | null>(null);
  useEffect(() => {
    if (policy.data && !form) setForm(policy.data as unknown as Record<string, any>);
  }, [policy.data, form]);
  const save = useMutation((data: Record<string, unknown>) => updatePlatformSettings({ doc: 'security', reason, data: data as any }), { success: 'Politique de sécurité enregistrée.' });

  if (policy.error) return <ErrorPanel error={policy.error} />;
  if (!form) return <Skeleton className="h-96" />;
  const set = (k: string, v: unknown) => setForm((f) => ({ ...(f ?? {}), [k]: v }));
  const alerts = form.alerts ?? { massExportRows: 5000, refundsPerAgentPerHour: 15, failedLoginsPerHour: 8 };
  const unusual = form.unusualLoginHours ?? { fromHour: 0, toHour: 5 };

  return (
    <Card>
      <CardHeader
        icon={<ShieldCheck />}
        title="Politique de sécurité"
        description="Double authentification des administrateurs, durée de session et seuils déclenchant une alerte de sécurité."
      />
      <CardContent className="grid gap-4 sm:grid-cols-2">
        <FormField label="Double authentification obligatoire" hint={policy.data?.requireMfaForAdmins ? 'Obligatoire pour tous les administrateurs : ne peut plus être désactivée.' : 'Obligatoire pour tous les administrateurs (cahier §27).'}>
          <div className="flex h-10 items-center"><Switch checked={Boolean(form.requireMfaForAdmins)} disabled={Boolean(policy.data?.requireMfaForAdmins)} onCheckedChange={(v) => set('requireMfaForAdmins', v)} /></div>
        </FormField>
        <FormField label="Alerte sur nouvel appareil">
          <div className="flex h-10 items-center"><Switch checked={Boolean(form.alertOnNewDevice)} onCheckedChange={(v) => set('alertOnNewDevice', v)} /></div>
        </FormField>
        <FormField label="Durée maximale d'une session (heures)" required>
          <Input type="number" min={1} max={168} value={form.adminSessionMaxHours ?? 12} onChange={(e) => set('adminSessionMaxHours', Number(e.target.value))} />
        </FormField>
        <FormField label="Essais de code avant verrouillage" required>
          <Input type="number" min={3} max={10} value={form.mfaMaxAttempts ?? 5} onChange={(e) => set('mfaMaxAttempts', Number(e.target.value))} />
        </FormField>
        <FormField label="Durée du verrouillage (minutes)" required>
          <Input type="number" min={1} max={1440} value={form.mfaLockMinutes ?? 15} onChange={(e) => set('mfaLockMinutes', Number(e.target.value))} />
        </FormField>
        <FormField label="Seuil « export massif » (lignes)" required>
          <Input type="number" min={100} value={alerts.massExportRows} onChange={(e) => set('alerts', { ...alerts, massExportRows: Number(e.target.value) })} />
        </FormField>
        <FormField label="Remboursements/agent/heure avant alerte" required>
          <Input type="number" min={1} value={alerts.refundsPerAgentPerHour} onChange={(e) => set('alerts', { ...alerts, refundsPerAgentPerHour: Number(e.target.value) })} />
        </FormField>
        <FormField label="Échecs de connexion/heure avant alerte" required>
          <Input type="number" min={1} value={alerts.failedLoginsPerHour} onChange={(e) => set('alerts', { ...alerts, failedLoginsPerHour: Number(e.target.value) })} />
        </FormField>
        <FormField label="Connexion inhabituelle : de (heure)" hint="Heure de Paris. Identique à « à » : désactivée.">
          <Input type="number" min={0} max={23} value={unusual.fromHour} onChange={(e) => set('unusualLoginHours', { ...unusual, fromHour: Number(e.target.value) })} />
        </FormField>
        <FormField label="Connexion inhabituelle : à (heure)">
          <Input type="number" min={0} max={24} value={unusual.toHour} onChange={(e) => set('unusualLoginHours', { ...unusual, toHour: Number(e.target.value) })} />
        </FormField>
        <div className="sm:col-span-2">
          <ReasonField value={reason} onChange={setReason} />
        </div>
      </CardContent>
      <CardFooter className="justify-end">
        <Button
          leftIcon={<Save />}
          loading={save.loading}
          disabled={!can('security.manage') || reason.trim().length < 3}
          onClick={() =>
            void save.mutate({
              requireMfaForAdmins: Boolean(form.requireMfaForAdmins),
              mfaEnforcedFrom: typeof form.mfaEnforcedFrom?.toMillis === 'function' ? (form.mfaEnforcedFrom.toMillis() as number) : null,
              adminSessionMaxHours: Number(form.adminSessionMaxHours ?? 12),
              mfaMaxAttempts: Number(form.mfaMaxAttempts ?? 5),
              mfaLockMinutes: Number(form.mfaLockMinutes ?? 15),
              alertOnNewDevice: Boolean(form.alertOnNewDevice),
              unusualLoginHours: { fromHour: Number(unusual.fromHour), toHour: Number(unusual.toHour) },
              alerts,
            })
          }
        >
          Enregistrer
        </Button>
      </CardFooter>
    </Card>
  );
}

function RetentionForm() {
  const can = useCan();
  const retention = useRetentionSettings();
  const [reason, setReason] = useState('');
  const [form, setForm] = useState<Record<string, any> | null>(null);
  useEffect(() => {
    if (retention.data && !form) setForm(retention.data as unknown as Record<string, any>);
  }, [retention.data, form]);
  const save = useMutation((data: Record<string, unknown>) => updatePlatformSettings({ doc: 'retention', reason, data: data as any }), { success: 'Durées de conservation enregistrées.' });

  if (retention.error) return <ErrorPanel error={retention.error} />;
  if (!form) return <Skeleton className="h-96" />;
  const set = (k: string, v: unknown) => setForm((f) => ({ ...(f ?? {}), [k]: v }));

  return (
    <Card>
      <CardHeader icon={<Timer />} title="Conservation des données" description="Durées légales de conservation et anonymisation automatique planifiée (RGPD)." />
      <CardContent className="grid gap-4 sm:grid-cols-2">
        <FormField label="Compte client inactif (mois)" required><Input type="number" value={form.inactiveAccountMonths ?? 24} onChange={(e) => set('inactiveAccountMonths', Number(e.target.value))} /></FormField>
        <FormField label="Anonymiser les commandes après (mois)" required><Input type="number" value={form.anonymizeOrdersAfterMonths ?? 36} onChange={(e) => set('anonymizeOrdersAfterMonths', Number(e.target.value))} /></FormField>
        <FormField label="Conserver les factures (années)" required><Input type="number" value={form.keepInvoicesYears ?? 10} onChange={(e) => set('keepInvoicesYears', Number(e.target.value))} /></FormField>
        <FormField label="Conserver le journal d'audit (années)" required><Input type="number" value={form.keepAuditLogsYears ?? 5} onChange={(e) => set('keepAuditLogsYears', Number(e.target.value))} /></FormField>
        <FormField label="Positions livreur (jours)" required><Input type="number" value={form.deleteDriverLocationsAfterDays ?? 30} onChange={(e) => set('deleteDriverLocationsAfterDays', Number(e.target.value))} /></FormField>
        <FormField label="Corbeille (jours)" required><Input type="number" value={form.trashRetentionDays ?? 30} onChange={(e) => set('trashRetentionDays', Number(e.target.value))} /></FormField>
        <FormField label="Anonymisation automatique planifiée" hint="Nuit à 4 h : applique ces durées sans intervention.">
          <div className="flex h-10 items-center"><Switch checked={Boolean(form.autoAnonymize)} onCheckedChange={(v) => set('autoAnonymize', v)} /></div>
        </FormField>
        <div className="sm:col-span-2">
          <ReasonField value={reason} onChange={setReason} />
        </div>
      </CardContent>
      <CardFooter className="justify-end">
        <Button
          leftIcon={<Save />}
          loading={save.loading}
          disabled={!can('settings.edit') || reason.trim().length < 3}
          onClick={() =>
            void save.mutate({
              inactiveAccountMonths: Number(form.inactiveAccountMonths ?? 24),
              anonymizeOrdersAfterMonths: Number(form.anonymizeOrdersAfterMonths ?? 36),
              keepInvoicesYears: Number(form.keepInvoicesYears ?? 10),
              keepAuditLogsYears: Number(form.keepAuditLogsYears ?? 5),
              deleteDriverLocationsAfterDays: Number(form.deleteDriverLocationsAfterDays ?? 30),
              trashRetentionDays: Number(form.trashRetentionDays ?? 30),
              autoAnonymize: Boolean(form.autoAnonymize),
            })
          }
        >
          Enregistrer
        </Button>
      </CardFooter>
    </Card>
  );
}


interface BrandingDoc {
  logo: { url: string; path?: string | null } | null;
  logoDark: { url: string; path?: string | null } | null;
  favicon: { url: string; path?: string | null } | null;
  colors: { primary: string; secondary: string; accent: string; background: string };
}
const DEFAULT_COLORS = { primary: '#e8784b', secondary: '#19343b', accent: '#f7f2e8', background: '#f7f2e8' };

function ColorField({ label, value, onChange, hint }: { label: string; value: string; onChange: (v: string) => void; hint?: string }) {
  const valid = /^#[0-9a-fA-F]{6}$/.test(value);
  return (
    <FormField label={label} hint={hint} error={valid ? undefined : 'Couleur hexadécimale attendue (#RRGGBB)'}>
      <div className="flex items-center gap-2">
        <input type="color" aria-label={label} value={valid ? value : '#000000'} onChange={(e) => onChange(e.target.value)} className="h-10 w-12 shrink-0 cursor-pointer rounded-lg border border-border bg-surface-2 p-1" />
        <Input value={value} onChange={(e) => onChange(e.target.value)} maxLength={7} className="font-mono" />
      </div>
    </FormField>
  );
}

function BrandingForm() {
  const can = useCan();
  const doc = useDoc<BrandingDoc>(docAt(`${COLLECTIONS.settings}/${SETTINGS_DOCS.branding}`));
  const [reason, setReason] = useState('');
  const [form, setForm] = useState<BrandingDoc | null>(null);
  const [uploading, setUploading] = useState<string | null>(null);
  useEffect(() => {
    if (!form && !doc.loading) setForm({ logo: doc.data?.logo ?? null, logoDark: doc.data?.logoDark ?? null, favicon: doc.data?.favicon ?? null, colors: { ...DEFAULT_COLORS, ...(doc.data?.colors ?? {}) } });
  }, [doc.data, doc.loading, form]);
  const save = useMutation((data: BrandingDoc) => updatePlatformSettings({ doc: 'branding', reason, data: data as never }), { success: 'Marque enregistrée : appliquée aux back-offices.' });

  if (doc.error) return <ErrorPanel error={doc.error} />;
  if (!form) return <Skeleton className="h-96" />;
  const colorsOk = Object.values(form.colors).every((c) => /^#[0-9a-fA-F]{6}$/.test(c));
  const upload = async (key: 'logo' | 'logoDark' | 'favicon', file: File | undefined) => {
    if (!file) return;
    setUploading(key);
    try {
      const { url, path } = await uploadPublicImage('branding', file);
      setForm((f) => (f ? { ...f, [key]: { url, path } } : f));
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setUploading(null);
    }
  };
  const slots: Array<{ key: 'logo' | 'logoDark' | 'favicon'; label: string; hint: string }> = [
    { key: 'logo', label: 'Logo', hint: 'Affiché dans le menu des back-offices.' },
    { key: 'logoDark', label: 'Logo (fond sombre)', hint: 'Variante pour les fonds sombres.' },
    { key: 'favicon', label: 'Icône', hint: 'Petit carré (onglet du navigateur).' },
  ];

  return (
    <Card>
      <CardHeader icon={<Palette />} title="Marque" description="Logo et couleurs de la plateforme. La couleur principale et le logo sont appliqués aux back-offices ; les autres couleurs sont transmises aux applications client et livreur." />
      <CardContent className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-3">
          {slots.map(({ key, label, hint }) => (
            <FormField key={key} label={label} hint={hint}>
              <div className="space-y-2">
                <div className="grid h-24 place-items-center rounded-xl border border-dashed border-border bg-surface-2">
                  {form[key]?.url ? <img src={form[key]!.url} alt={label} className="max-h-20 max-w-full object-contain" /> : <span className="text-xs text-fg-subtle">Aucun fichier</span>}
                </div>
                <div className="flex gap-2">
                  <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-border bg-surface-2 px-3 py-1.5 text-xs font-medium hover:bg-surface-3">
                    <ImageUp className="size-3.5" />
                    {uploading === key ? 'Envoi…' : 'Choisir'}
                    <input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" className="sr-only" disabled={!can('settings.edit') || uploading !== null} onChange={(e) => void upload(key, e.target.files?.[0])} />
                  </label>
                  {form[key] && <Button size="xs" variant="ghost" leftIcon={<Trash2 />} onClick={() => setForm({ ...form, [key]: null })}>Retirer</Button>}
                </div>
              </div>
            </FormField>
          ))}
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <ColorField label="Couleur principale" hint="Boutons, liens, accents." value={form.colors.primary} onChange={(v) => setForm({ ...form, colors: { ...form.colors, primary: v } })} />
          <ColorField label="Couleur secondaire" value={form.colors.secondary} onChange={(v) => setForm({ ...form, colors: { ...form.colors, secondary: v } })} />
          <ColorField label="Couleur d’accent" value={form.colors.accent} onChange={(v) => setForm({ ...form, colors: { ...form.colors, accent: v } })} />
          <ColorField label="Arrière-plan" value={form.colors.background} onChange={(v) => setForm({ ...form, colors: { ...form.colors, background: v } })} />
        </div>
        <ReasonField value={reason} onChange={setReason} />
      </CardContent>
      <CardFooter className="justify-end gap-2">
        <Button variant="ghost" onClick={() => setForm({ ...form, colors: { ...DEFAULT_COLORS } })}>Couleurs d’origine</Button>
        <Button leftIcon={<Save />} loading={save.loading} disabled={!can('settings.edit') || reason.trim().length < 3 || !colorsOk} onClick={() => void save.mutate(form)}>
          Enregistrer
        </Button>
      </CardFooter>
    </Card>
  );
}

/** Historique de tous les réglages de la plateforme (général, marque, sécurité, conservation, fonctionnalités, marchés). */
function SettingsHistory() {
  const q = useMemo(() => query(collectionAt(COLLECTIONS.settingsHistory), orderBy('changedAt', 'desc'), limit(150)), []);
  const history = useCollection<SettingsHistoryEntry & { changedByName?: string }>(q);
  const [all, setAll] = useState(false);
  const rows = history.data.filter((h) => all || h.docPath.startsWith('settings/') || h.docPath.startsWith('featureFlags/') || h.docPath.startsWith('countries/') || h.docPath.startsWith('adminRoles/'));
  return (
    <Card>
      <CardHeader
        title="Historique des modifications"
        description="Tous les réglages de la plateforme : qui, quoi, quand, ancienne et nouvelle valeur, motif."
        actions={<Button size="sm" variant="ghost" onClick={() => setAll((v) => !v)}>{all ? 'Réglages de la plateforme' : 'Tous les réglages (villes, formules…)'}</Button>}
      />
      <CardContent>
        {history.error ? (
          <ErrorPanel error={history.error} compact />
        ) : history.loading ? (
          <Skeleton className="h-48" />
        ) : rows.length === 0 ? (
          <EmptyState compact title="Aucune modification enregistrée" />
        ) : (
          <ul className="divide-y divide-border">
            {rows.map((h) => {
              const at = toDate(h.changedAt);
              return (
                <li key={h.id} className="space-y-1 py-3">
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <Badge tone="neutral" size="sm">{h.docPath}</Badge>
                    <span className="text-xs text-fg-subtle">{at ? formatDateTime(at) : ''} · {h.changedByName ?? h.changedBy}</span>
                  </div>
                  {h.reason && <p className="text-sm text-fg">« {h.reason} »</p>}
                  <div className="space-y-0.5 rounded-lg border border-border bg-surface-2 px-3 py-2 text-xs">
                    {h.changedFields.slice(0, 8).map((key) => (
                      <div key={key} className="grid grid-cols-[minmax(0,8rem)_1fr] gap-2">
                        <span className="truncate text-fg-subtle">{auditFieldLabel(key)}</span>
                        <span className="min-w-0 break-words text-fg-muted">
                          <span className="line-through decoration-fg-subtle/60">{formatAuditField(key, h.before?.[key])}</span>
                          <span className="mx-1.5 text-fg-subtle">→</span>
                          <span className="text-fg">{formatAuditField(key, h.after?.[key])}</span>
                        </span>
                      </div>
                    ))}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

export function ParametresPage() {
  useDocumentTitle('Paramètres · GoLink Admin');
  return (
    <PageContainer wide>
      <PageHeader eyebrow="Plateforme & sécurité" title="Paramètres plateforme" description="Identité, réglages régionaux, politique de sécurité et durées de conservation. Chaque changement est historisé avec l'ancienne valeur, la nouvelle et le motif.">
        <PlateformeNav />
      </PageHeader>
      <RequirePermission permission="settings.view" title="Paramètres plateforme">
        <Tabs defaultValue="general">
          <TabsList>
            <TabsTrigger value="general">Identité et régional</TabsTrigger>
            <TabsTrigger value="rules">Règles globales</TabsTrigger>
            <TabsTrigger value="branding">Marque</TabsTrigger>
            <TabsTrigger value="security">Sécurité</TabsTrigger>
            <TabsTrigger value="retention">Conservation</TabsTrigger>
            <TabsTrigger value="history">Historique</TabsTrigger>
          </TabsList>
          <TabsContent value="general" className="pt-4"><GeneralForm /></TabsContent>
          <TabsContent value="rules" className="pt-4">
            <Card>
              <CardHeader title="Règles globales de la plateforme" description="Commissions, livraison, annulations, remboursements, fidélité, promotions et TVA se règlent dans leur rubrique (avec leur propre historique) : accès direct." />
              <CardContent className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {[
                  { to: '/abonnements/commissions', label: 'Commissions et frais par défaut', hint: 'Abonnements > Commissions' },
                  { to: '/plateforme/marches', label: 'Frais clients et livraison par pays', hint: 'Multi-pays' },
                  { to: '/regles-commandes', label: 'Annulations et règles automatiques', hint: 'Règles des commandes' },
                  { to: '/livreurs/attribution', label: 'Attribution des livreurs', hint: 'Livreurs > Attribution' },
                  { to: '/paiements/regles', label: 'Remboursements et plafond de validation', hint: 'Paiements > Frais et remboursements' },
                  { to: '/fidelite', label: 'Fidélité et parrainage', hint: 'Croissance > Fidélité' },
                  { to: '/promotions/regles', label: 'Promotions', hint: 'Promotions > Règles' },
                  { to: '/facturation/tva', label: 'TVA par pays', hint: 'Facturation > TVA' },
                ].map((l) => (
                  <Link key={l.to} to={l.to} className="rounded-xl border border-border px-4 py-3 text-sm hover:bg-surface-2">
                    <span className="block font-medium text-fg">{l.label}</span>
                    <span className="text-xs text-fg-subtle">{l.hint}</span>
                  </Link>
                ))}
              </CardContent>
            </Card>
          </TabsContent>
          <TabsContent value="branding" className="pt-4"><BrandingForm /></TabsContent>
          <TabsContent value="security" className="pt-4"><SecurityForm /></TabsContent>
          <TabsContent value="retention" className="pt-4"><RetentionForm /></TabsContent>
          <TabsContent value="history" className="pt-4"><SettingsHistory /></TabsContent>
        </Tabs>
      </RequirePermission>
    </PageContainer>
  );
}
