import { useMemo, useState } from 'react';
import { collection, limit, orderBy, query } from 'firebase/firestore';
import { Landmark, Pencil, Plus } from 'lucide-react';
import { Badge, Button, Card, CardContent, CardHeader, Checkbox, EmptyState, FormField, Input, PageContainer, PageHeader, Skeleton, Switch, Textarea } from '@golink/ui';
import { COLLECTIONS, CURRENCY_CODES, CURRENCY_LABELS, type Country, type PaymentProvider, type PaymentProviderKind, type WithId } from '@golink/shared';
import { useDocumentTitle } from '@golink/web';
import { useCan } from '@/auth/AdminAccess';
import { useGeoScope } from '@/layout/GeoScope';
import { db } from '@/lib/firebase';
import { useCollection, useMutation } from '@/lib/firestore';
import { savePaymentProvider, setCountryProviders, type PaymentProviderInput } from '../argent-commun/api';
import { ActionDialog, Callout, ErrorPanel } from '../argent-commun/components';
import { PaiementsNav } from './nav';

const KIND_LABELS: Record<PaymentProviderKind, string> = { card: 'Carte', bank_transfer: 'Virement bancaire', mobile_wallet: 'Portefeuille mobile', cash: 'Espèces' };
const EMPTY: Omit<PaymentProviderInput, 'reason'> = { providerId: null, code: '', label: '', countryIds: [], currencies: ['EUR'], supports: { collect: true, payout: true }, kinds: ['card'], mode: 'manual', enabled: true, note: '' };

/** Prestataires de paiement par pays (décision client : Stripe n'est pas disponible partout, moyens locaux au Maghreb). */
export function ProvidersPage() {
  useDocumentTitle('Prestataires de paiement · Ciyou Eats Admin');
  const can = useCan();
  const geo = useGeoScope();
  const editable = can('payments.configure');
  const providersQuery = useMemo(() => query(collection(db, COLLECTIONS.paymentProviders), orderBy('label', 'asc'), limit(100)), []);
  const providers = useCollection<PaymentProvider>(providersQuery);
  const [form, setForm] = useState<Omit<PaymentProviderInput, 'reason'> | null>(null);
  const [assign, setAssign] = useState<WithId<Country> | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const save = useMutation(savePaymentProvider, { success: 'Prestataire enregistré' });
  const attach = useMutation(setCountryProviders, { success: 'Prestataires du pays enregistrés' });
  const countries = geo.countries as unknown as Array<WithId<Country>>;
  const invalid = !form || form.code.trim().length < 2 || form.label.trim().length < 2 || form.countryIds.length === 0 || form.currencies.length === 0 || form.kinds.length === 0;
  const set = <K extends keyof Omit<PaymentProviderInput, 'reason'>>(key: K, value: Omit<PaymentProviderInput, 'reason'>[K]) => setForm((f) => (f ? { ...f, [key]: value } : f));
  const toggle = <T,>(list: T[], value: T, on: boolean): T[] => (on ? [...list, value] : list.filter((v) => v !== value));

  return (
    <PageContainer wide>
      <PageHeader
        eyebrow={`Argent · ${geo.label}`}
        title="Prestataires de paiement"
        description="Stripe et prestataires locaux par pays : encaissement des commandes et reversements aux commerces et livreurs. Là où Stripe n’est pas disponible, les reversements se virent à la main avec une référence bancaire."
        actions={editable ? <Button variant="primary" leftIcon={<Plus />} onClick={() => setForm({ ...EMPTY })}>Nouveau prestataire</Button> : undefined}
      >
        <PaiementsNav />
      </PageHeader>
      <div className="space-y-6">
        <Callout tone="info" icon={<Landmark />} title="Devises et pays sans Stripe">
          Algérie (DZD), Maroc (MAD) et Tunisie (TND) : les montants sont conservés dans la devise du pays (millimes pour le dinar tunisien). Un pays « sans Stripe » reçoit ses reversements par virement manuel ; le compte du partenaire est vérifié avant le premier virement.
        </Callout>
        {providers.error ? (
          <ErrorPanel error={providers.error} />
        ) : providers.loading ? (
          <Skeleton className="h-40 w-full" />
        ) : providers.data.length === 0 ? (
          <EmptyState icon={<Landmark />} title="Aucun prestataire enregistré" description="Ajoutez Stripe et les prestataires locaux des pays ouverts." />
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {providers.data.map((p) => (
              <Card key={p.id}>
                <CardHeader
                  title={<span className="flex flex-wrap items-center gap-2">{p.label}<Badge tone={p.enabled ? 'success' : 'neutral'} size="sm">{p.enabled ? 'Actif' : 'Désactivé'}</Badge><Badge tone="neutral" size="sm">{p.mode === 'api' ? 'Automatique' : 'Suivi manuel'}</Badge></span>}
                  description={`${p.countryIds.join(' · ')} — ${p.currencies.join(', ')}`}
                  actions={editable ? <Button size="sm" variant="ghost" leftIcon={<Pencil />} onClick={() => setForm({ providerId: p.id, code: p.code, label: p.label, countryIds: p.countryIds, currencies: p.currencies, supports: p.supports, kinds: p.kinds, mode: p.mode, enabled: p.enabled, note: p.note ?? '' })}>Modifier</Button> : undefined}
                  divided
                />
                <CardContent className="space-y-1 text-sm text-fg-muted">
                  <p>{[p.supports.collect ? 'Encaissement' : null, p.supports.payout ? 'Reversements' : null].filter(Boolean).join(' et ') || 'Aucune fonction'}</p>
                  <p>{p.kinds.map((k) => KIND_LABELS[k]).join(' · ')}</p>
                  {p.note && <p className="text-xs text-fg-subtle">{p.note}</p>}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
        <Card>
          <CardHeader title="Prestataires par pays" description="Ce que proposent les apps dans chaque pays" divided />
          <CardContent className="divide-y divide-border p-0">
            {countries.map((c) => {
              const ids = c.paymentProviderIds ?? [];
              return (
                <div key={c.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
                  <div className="min-w-0">
                    <p className="font-medium text-fg">{c.name} <span className="text-xs text-fg-subtle">({c.currency})</span></p>
                    <p className="text-xs text-fg-subtle">
                      {c.stripeAvailable === false ? 'Sans Stripe : reversements manuels' : 'Stripe disponible'} · {ids.length ? ids.map((id) => providers.data.find((p) => p.id === id)?.label ?? id).join(', ') : 'aucun prestataire lié'}
                    </p>
                  </div>
                  {editable && <Button size="sm" variant="secondary" onClick={() => { setSelected(ids); setAssign(c); }}>Choisir</Button>}
                </div>
              );
            })}
          </CardContent>
        </Card>
      </div>

      <ActionDialog
        open={Boolean(form)}
        onOpenChange={(o) => !o && setForm(null)}
        icon={<Landmark />}
        title={form?.providerId ? 'Modifier le prestataire' : 'Nouveau prestataire'}
        confirmLabel="Enregistrer"
        size="md"
        disabled={invalid}
        onSubmit={async (reason) => {
          if (!form) return false;
          const ok = Boolean(await save.mutate({ ...form, note: form.note?.trim() || null, reason }));
          if (ok) setForm(null);
          return ok;
        }}
      >
        {form && (
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label="Nom affiché"><Input value={form.label} maxLength={60} onChange={(e) => set('label', e.target.value)} /></FormField>
              <FormField label="Code" hint="Minuscules, chiffres et _ (non modifiable ensuite)."><Input value={form.code} disabled={Boolean(form.providerId)} maxLength={30} onChange={(e) => set('code', e.target.value.toLowerCase())} /></FormField>
            </div>
            <FormField label="Pays desservis">
              <div className="flex flex-wrap gap-3">{countries.map((c) => <Checkbox key={c.id} label={c.name} checked={form.countryIds.includes(c.id)} onCheckedChange={(v) => set('countryIds', toggle(form.countryIds, c.id, Boolean(v)))} />)}</div>
            </FormField>
            <FormField label="Devises">
              <div className="flex flex-wrap gap-3">{CURRENCY_CODES.map((c) => <Checkbox key={c} label={`${c} · ${CURRENCY_LABELS[c]}`} checked={form.currencies.includes(c)} onCheckedChange={(v) => set('currencies', toggle(form.currencies, c, Boolean(v)))} />)}</div>
            </FormField>
            <FormField label="Moyens gérés">
              <div className="flex flex-wrap gap-3">{(Object.keys(KIND_LABELS) as PaymentProviderKind[]).map((k) => <Checkbox key={k} label={KIND_LABELS[k]} checked={form.kinds.includes(k)} onCheckedChange={(v) => set('kinds', toggle(form.kinds, k, Boolean(v)))} />)}</div>
            </FormField>
            <div className="grid gap-3 sm:grid-cols-2">
              <Switch checked={form.supports.collect} onCheckedChange={(v) => set('supports', { ...form.supports, collect: v })} label="Encaisse les commandes" />
              <Switch checked={form.supports.payout} onCheckedChange={(v) => set('supports', { ...form.supports, payout: v })} label="Verse aux partenaires" />
              <Switch checked={form.mode === 'api'} onCheckedChange={(v) => set('mode', v ? 'api' : 'manual')} label="Intégration automatique" />
              <Switch checked={form.enabled} onCheckedChange={(v) => set('enabled', v)} label="Actif" />
            </div>
            <FormField label="Note interne"><Textarea rows={2} maxLength={300} value={form.note ?? ''} onChange={(e) => set('note', e.target.value)} /></FormField>
          </div>
        )}
      </ActionDialog>

      <ActionDialog
        open={Boolean(assign)}
        onOpenChange={(o) => !o && setAssign(null)}
        icon={<Landmark />}
        title={assign ? `Prestataires — ${assign.name}` : 'Prestataires'}
        description="Seuls les prestataires qui desservent ce pays et sa devise sont acceptés."
        confirmLabel="Enregistrer"
        onSubmit={async (reason) => {
          if (!assign) return false;
          const ok = Boolean(await attach.mutate({ countryId: assign.id, providerIds: selected, reason }));
          if (ok) setAssign(null);
          return ok;
        }}
      >
        <div className="flex flex-col gap-2">
          {providers.data.filter((p) => assign && p.countryIds.includes(assign.id)).map((p) => (
            <Checkbox key={p.id} label={`${p.label} (${p.currencies.join(', ')})`} checked={selected.includes(p.id)} onCheckedChange={(v) => setSelected(toggle(selected, p.id, Boolean(v)))} />
          ))}
        </div>
      </ActionDialog>
    </PageContainer>
  );
}
