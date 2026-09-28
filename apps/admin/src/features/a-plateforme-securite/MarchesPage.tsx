// Multi-pays (cahier §23) : identité du marché, entité de facturation, obligations
// légales locales, frais clients et bornes de livraison, par pays. Les commissions
// détaillées des formules vivent dans Argent ; les villes et zones dans Opérations.
import { useEffect, useState } from 'react';
import { Ban, CheckCircle2, ExternalLink, Globe2, Plus, Save } from 'lucide-react';
import { Link } from 'react-router';
import {
  Badge,
  Button,
  Card,
  CardContent,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  CardFooter,
  CardHeader,
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
} from '@golink/ui';
import { CURRENCY_CODES, CURRENCY_LABELS, LOCALES, LOCALE_LABELS, type CurrencyCode, type Locale } from '@golink/shared';
import { useDocumentTitle } from '@golink/web';
import { useCan } from '@/auth/AdminAccess';
import { useMutation } from '@/lib/firestore';
import { askReason } from '@/lib/reason';
import { createCountry, setCountryActive, updateCountry } from './api';
import { ActionDialog, Callout, DetailRow, ErrorPanel, RequirePermission } from './components';
import { useCitiesOf, useCountries } from './hooks';
import { PlateformeNav } from './nav';
import { HistoryPanel } from '../acteurs-commun/HistoryPanel';

function NewCountryDialog({ open, onOpenChange, templates, onCreated }: { open: boolean; onOpenChange: (open: boolean) => void; templates: { id: string; name: string }[]; onCreated: (id: string) => void }) {
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [currency, setCurrency] = useState<CurrencyCode>('EUR');
  const [locale, setLocale] = useState<Locale>('fr');
  const [timezone, setTimezone] = useState('Europe/Paris');
  const [prefix, setPrefix] = useState('+');
  const [stripe, setStripe] = useState(true);
  const [template, setTemplate] = useState(templates[0]?.id ?? 'FR');
  const [reason, setReason] = useState('');
  const create = useMutation(
    () => createCountry({ countryId: code.trim().toUpperCase(), name: name.trim(), currency, locales: [locale], defaultLocale: locale, timezone: timezone.trim(), phonePrefix: prefix.trim(), stripeAvailable: stripe, templateCountryId: template, reason }),
    { success: 'Marché créé (fermé) : complétez ses réglages puis ouvrez-le.' },
  );
  const valid = /^[A-Za-z]{2}$/.test(code.trim()) && name.trim().length >= 2 && /^\+\d{1,4}$/.test(prefix.trim()) && timezone.trim().length >= 3 && reason.trim().length >= 3;
  return (
    <Dialog open={open} onOpenChange={(o) => !create.loading && onOpenChange(o)}>
      <DialogContent size="md">
        <DialogHeader icon={<Globe2 />} title="Nouveau marché" description="Le pays est créé fermé, avec les tarifs et moyens de paiement du marché modèle. Vous complétez ensuite ses réglages avant de l’ouvrir." />
        <DialogBody className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Code pays (ISO, 2 lettres)" required><Input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} maxLength={2} placeholder="ES" /></FormField>
            <FormField label="Nom" required><Input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder="Espagne" /></FormField>
            <FormField label="Devise" required><Select value={currency} onValueChange={(v) => setCurrency(v as CurrencyCode)} options={CURRENCY_CODES.map((c) => ({ value: c, label: CURRENCY_LABELS[c as CurrencyCode] }))} /></FormField>
            <FormField label="Langue principale" required><Select value={locale} onValueChange={(v) => setLocale(v as Locale)} options={LOCALES.map((l) => ({ value: l, label: LOCALE_LABELS[l] }))} /></FormField>
            <FormField label="Fuseau horaire" required><Input value={timezone} onChange={(e) => setTimezone(e.target.value)} /></FormField>
            <FormField label="Indicatif téléphonique" required><Input value={prefix} onChange={(e) => setPrefix(e.target.value)} placeholder="+34" /></FormField>
            <FormField label="Marché modèle (tarifs, paiements)"><Select value={template} onValueChange={setTemplate} options={templates.map((t) => ({ value: t.id, label: t.name }))} /></FormField>
            <FormField label="Stripe disponible"><div className="flex h-10 items-center"><Switch checked={stripe} onCheckedChange={setStripe} /></div></FormField>
          </div>
          <ReasonField value={reason} onChange={setReason} />
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={create.loading}>Annuler</Button>
          <Button
            leftIcon={<Plus />}
            loading={create.loading}
            disabled={!valid}
            onClick={async () => {
              const res = await create.mutate();
              if (res) {
                onCreated(res.countryId);
                onOpenChange(false);
              }
            }}
          >
            Créer le marché
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ReasonField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <FormField label="Motif" required hint="Conservé dans le journal d'audit.">
      <Input value={value} onChange={(e) => onChange(e.target.value)} maxLength={500} placeholder="Ex. : évolution réglementaire, ouverture du marché…" />
    </FormField>
  );
}

export function MarchesPage() {
  useDocumentTitle('Multi-pays · GoLink Admin');
  const can = useCan();
  const countries = useCountries();
  const [countryId, setCountryId] = useState<string | null>(null);
  useEffect(() => {
    if (!countryId && countries.data.length > 0) setCountryId(countries.data[0]!.id);
  }, [countries.data, countryId]);
  const country = countries.data.find((c) => c.id === countryId) ?? null;
  const cities = useCitiesOf(countryId);
  const [closeOpen, setCloseOpen] = useState(false);
  const [newOpen, setNewOpen] = useState(false);

  const [reason, setReason] = useState('');
  const [form, setForm] = useState<Record<string, any> | null>(null);
  useEffect(() => setForm(country as unknown as Record<string, any> | null), [country?.id]);
  const save = useMutation(
    (section: string, data: Record<string, unknown>) => updateCountry({ countryId: countryId!, reason, section, data }),
    { success: 'Marché mis à jour.' },
  );
  const toggleActive = useMutation((active: boolean, r: string) => setCountryActive({ countryId: countryId!, active, reason: r }), { success: (o) => (o.active ? 'Marché ouvert.' : 'Marché fermé.') });

  if (countries.error) return <ErrorPanel error={countries.error} />;

  return (
    <PageContainer wide>
      <PageHeader
        eyebrow="Plateforme & sécurité"
        title="Multi-pays"
        description="Un marché par pays : langues, devise, TVA et obligations locales, moyens de paiement, frais clients et bornes de livraison, commissions."
      >
        <PlateformeNav />
      </PageHeader>

      <RequirePermission permission="markets.edit" title="Multi-pays">
      {countries.loading ? (
        <Skeleton className="h-96" />
      ) : countries.data.length === 0 ? (
        <Callout tone="info" title="Aucun marché configuré" />
      ) : (
        <>
          <Card>
            <CardHeader
              icon={<Globe2 />}
              title={country?.name ?? '—'}
              description={`${cities.data.length} ville${cities.data.length > 1 ? 's' : ''} rattachée${cities.data.length > 1 ? 's' : ''} · devise ${country ? CURRENCY_LABELS[country.currency as CurrencyCode] : ''}`}
              actions={
                <div className="flex items-center gap-2">
                  <Select value={countryId ?? ''} onValueChange={setCountryId} options={countries.data.map((c) => ({ value: c.id, label: `${c.name} (${c.code})` }))} />
                  <Badge tone={country?.active ? 'success' : 'neutral'}>{country?.active ? 'Ouvert' : 'Fermé'}</Badge>
                  <Button size="sm" variant="secondary" leftIcon={<Plus />} onClick={() => setNewOpen(true)}>Nouveau marché</Button>
                  {can('markets.edit') && country && (
                    <Button
                      size="sm"
                      variant={country.active ? 'secondary' : 'primary'}
                      leftIcon={country.active ? <Ban /> : <CheckCircle2 />}
                      onClick={() => (country.active ? setCloseOpen(true) : void askReason({ title: `Rouvrir le marché ${country.name}`, confirmLabel: 'Rouvrir' }).then((r) => toggleActive.mutate(true, r)).catch(() => undefined))}
                    >
                      {country.active ? 'Fermer' : 'Ouvrir'}
                    </Button>
                  )}
                </div>
              }
            />
          </Card>

          {!form ? (
            <Skeleton className="mt-4 h-96" />
          ) : (
            <Tabs defaultValue="identity" className="mt-4">
              <TabsList>
                <TabsTrigger value="identity">Identité</TabsTrigger>
                <TabsTrigger value="billing">Facturation</TabsTrigger>
                <TabsTrigger value="legal">Légal</TabsTrigger>
                <TabsTrigger value="fees">Frais</TabsTrigger>
                <TabsTrigger value="delivery">Livraison</TabsTrigger>
                <TabsTrigger value="more">TVA, paiements, commissions</TabsTrigger>
                <TabsTrigger value="history">Historique</TabsTrigger>
              </TabsList>

              <TabsContent value="identity" className="pt-4">
                <Card>
                  <CardContent className="grid gap-4 pt-4 sm:grid-cols-2">
                    <FormField label="Nom du marché" required><Input value={form.name ?? ''} onChange={(e) => setForm({ ...form, name: e.target.value })} /></FormField>
                    <FormField label="Devise" required><Select value={form.currency ?? 'EUR'} onValueChange={(v) => setForm({ ...form, currency: v })} options={CURRENCY_CODES.map((c) => ({ value: c, label: CURRENCY_LABELS[c as CurrencyCode] }))} /></FormField>
                    <FormField label="Fuseau horaire" required><Input value={form.timezone ?? ''} onChange={(e) => setForm({ ...form, timezone: e.target.value })} /></FormField>
                    <FormField label="Indicatif téléphonique" required><Input value={form.phonePrefix ?? ''} onChange={(e) => setForm({ ...form, phonePrefix: e.target.value })} placeholder="+33" /></FormField>
                    <FormField label="Langue par défaut" required><Select value={form.defaultLocale ?? 'fr'} onValueChange={(v) => setForm({ ...form, defaultLocale: v })} options={(form.locales as Locale[] | undefined ?? LOCALES).map((l) => ({ value: l, label: LOCALE_LABELS[l] }))} /></FormField>
                    <FormField label="Stripe disponible">
                      <div className="flex h-10 items-center"><Switch checked={Boolean(form.stripeAvailable)} onCheckedChange={(v) => setForm({ ...form, stripeAvailable: v })} /></div>
                    </FormField>
                    <div className="sm:col-span-2">
                      <FormField label="Langues du marché" required>
                        <div className="flex flex-wrap gap-3">
                          {LOCALES.map((l) => {
                            const list = (form.locales as Locale[] | undefined) ?? [];
                            const checked = list.includes(l);
                            return (
                              <label key={l} className="flex items-center gap-2 rounded-lg border border-border bg-surface-2 px-3 py-1.5 text-sm">
                                <Switch checked={checked} onCheckedChange={(v) => setForm({ ...form, locales: v ? [...list, l] : list.filter((x) => x !== l) })} />
                                {LOCALE_LABELS[l]}
                              </label>
                            );
                          })}
                        </div>
                      </FormField>
                    </div>
                    <div className="sm:col-span-2"><ReasonField value={reason} onChange={setReason} /></div>
                  </CardContent>
                  <CardFooter className="justify-end">
                    <Button leftIcon={<Save />} loading={save.loading} disabled={!can('markets.edit') || reason.trim().length < 3} onClick={() => void save.mutate('identity', { name: form.name, currency: form.currency, locales: form.locales, defaultLocale: form.defaultLocale, timezone: form.timezone, phonePrefix: form.phonePrefix, stripeAvailable: Boolean(form.stripeAvailable) })}>
                      Enregistrer
                    </Button>
                  </CardFooter>
                </Card>
              </TabsContent>

              <TabsContent value="billing" className="pt-4">
                <Card>
                  <CardContent className="grid gap-4 pt-4 sm:grid-cols-2">
                    <FormField label="Raison sociale" required><Input value={form.billingEntity?.legalName ?? ''} onChange={(e) => setForm({ ...form, billingEntity: { ...form.billingEntity, legalName: e.target.value } })} /></FormField>
                    <FormField label="N° TVA intracommunautaire"><Input value={form.billingEntity?.vatNumber ?? ''} onChange={(e) => setForm({ ...form, billingEntity: { ...form.billingEntity, vatNumber: e.target.value } })} /></FormField>
                    <FormField label="N° d'immatriculation"><Input value={form.billingEntity?.registrationNumber ?? ''} onChange={(e) => setForm({ ...form, billingEntity: { ...form.billingEntity, registrationNumber: e.target.value } })} /></FormField>
                    <FormField label="Préfixe des factures" required><Input value={form.billingEntity?.invoicePrefix ?? ''} onChange={(e) => setForm({ ...form, billingEntity: { ...form.billingEntity, invoicePrefix: e.target.value.toUpperCase() } })} /></FormField>
                    <div className="sm:col-span-2"><FormField label="Adresse" required><Input value={form.billingEntity?.address ?? ''} onChange={(e) => setForm({ ...form, billingEntity: { ...form.billingEntity, address: e.target.value } })} /></FormField></div>
                    <div className="sm:col-span-2"><ReasonField value={reason} onChange={setReason} /></div>
                  </CardContent>
                  <CardFooter className="justify-end">
                    <Button leftIcon={<Save />} loading={save.loading} disabled={!can('markets.edit') || reason.trim().length < 3} onClick={() => void save.mutate('billingEntity', form.billingEntity)}>
                      Enregistrer
                    </Button>
                  </CardFooter>
                </Card>
              </TabsContent>

              <TabsContent value="legal" className="pt-4">
                <Card>
                  <CardContent className="grid gap-4 pt-4 sm:grid-cols-2">
                    <FormField label="Autorité fiscale (DAC7)" required><Input value={form.legal?.dac7Authority ?? ''} onChange={(e) => setForm({ ...form, legal: { ...form.legal, dac7Authority: e.target.value } })} /></FormField>
                    <FormField label="Âge minimum vente d'alcool" required><Input type="number" min={16} max={25} value={form.legal?.alcoholMinimumAge ?? 18} onChange={(e) => setForm({ ...form, legal: { ...form.legal, alcoholMinimumAge: Number(e.target.value) } })} /></FormField>
                    <FormField label="URSSAF obligatoire livreurs">
                      <div className="flex h-10 items-center"><Switch checked={Boolean(form.legal?.requiresDriverUrssaf)} onCheckedChange={(v) => setForm({ ...form, legal: { ...form.legal, requiresDriverUrssaf: v } })} /></div>
                    </FormField>
                    <FormField label="Note TVA (validation expert-comptable)"><Input value={form.vatNote ?? ''} onChange={(e) => setForm({ ...form, vatNote: e.target.value || null })} /></FormField>
                    <div className="sm:col-span-2"><ReasonField value={reason} onChange={setReason} /></div>
                  </CardContent>
                  <CardFooter className="justify-end">
                    <Button leftIcon={<Save />} loading={save.loading} disabled={!can('markets.edit') || reason.trim().length < 3} onClick={() => void save.mutate('legal', { dac7Authority: form.legal?.dac7Authority, requiresDriverUrssaf: Boolean(form.legal?.requiresDriverUrssaf), alcoholMinimumAge: Number(form.legal?.alcoholMinimumAge ?? 18), vatNote: form.vatNote ?? null })}>
                      Enregistrer
                    </Button>
                  </CardFooter>
                </Card>
              </TabsContent>

              <TabsContent value="fees" className="pt-4">
                <Card>
                  <CardContent className="space-y-4 pt-4">
                    <Callout tone="info" title="Frais clients" >Frais de service et petite commande, en points de base (1 % = 100 points) ou montants en centimes.</Callout>
                    <div className="grid gap-4 sm:grid-cols-3">
                      <FormField label="Frais de service actifs"><div className="flex h-10 items-center"><Switch checked={Boolean(form.pricing?.serviceFee?.enabled)} onCheckedChange={(v) => setForm({ ...form, pricing: { ...form.pricing, serviceFee: { ...form.pricing.serviceFee, enabled: v } } })} /></div></FormField>
                      <FormField label="Taux (points de base)"><Input type="number" value={form.pricing?.serviceFee?.rateBps ?? 0} onChange={(e) => setForm({ ...form, pricing: { ...form.pricing, serviceFee: { ...form.pricing.serviceFee, rateBps: Number(e.target.value) } } })} /></FormField>
                      <FormField label="Plafond (centimes)"><Input type="number" value={form.pricing?.serviceFee?.maxCents ?? 0} onChange={(e) => setForm({ ...form, pricing: { ...form.pricing, serviceFee: { ...form.pricing.serviceFee, maxCents: Number(e.target.value) } } })} /></FormField>
                    </div>
                    <div className="grid gap-4 sm:grid-cols-3">
                      <FormField label="Frais petite commande actifs"><div className="flex h-10 items-center"><Switch checked={Boolean(form.pricing?.smallOrderFee?.enabled)} onCheckedChange={(v) => setForm({ ...form, pricing: { ...form.pricing, smallOrderFee: { ...form.pricing.smallOrderFee, enabled: v } } })} /></div></FormField>
                      <FormField label="Seuil (centimes)"><Input type="number" value={form.pricing?.smallOrderFee?.thresholdCents ?? 0} onChange={(e) => setForm({ ...form, pricing: { ...form.pricing, smallOrderFee: { ...form.pricing.smallOrderFee, thresholdCents: Number(e.target.value) } } })} /></FormField>
                      <FormField label="Montant fixe (centimes)"><Input type="number" value={form.pricing?.smallOrderFee?.flatCents ?? 0} onChange={(e) => setForm({ ...form, pricing: { ...form.pricing, smallOrderFee: { ...form.pricing.smallOrderFee, flatCents: Number(e.target.value) } } })} /></FormField>
                    </div>
                    <div className="grid gap-4 sm:grid-cols-3">
                      <FormField label="Frais bancaires (%, points de base)"><Input type="number" value={form.pricing?.payment?.percentBps ?? 0} onChange={(e) => setForm({ ...form, pricing: { ...form.pricing, payment: { ...form.pricing.payment, percentBps: Number(e.target.value) } } })} /></FormField>
                      <FormField label="Frais bancaires fixes (centimes)"><Input type="number" value={form.pricing?.payment?.fixedCents ?? 0} onChange={(e) => setForm({ ...form, pricing: { ...form.pricing, payment: { ...form.pricing.payment, fixedCents: Number(e.target.value) } } })} /></FormField>
                      <FormField label="Payeur des frais bancaires">
                        <Select value={form.pricing?.payment?.payer ?? 'platform'} onValueChange={(v) => setForm({ ...form, pricing: { ...form.pricing, payment: { ...form.pricing.payment, payer: v } } })} options={[{ value: 'platform', label: 'Plateforme' }, { value: 'restaurant', label: 'Commerce' }]} />
                      </FormField>
                    </div>
                    <ReasonField value={reason} onChange={setReason} />
                  </CardContent>
                  <CardFooter className="justify-end">
                    <Button
                      leftIcon={<Save />}
                      loading={save.loading}
                      disabled={!can('markets.edit') || reason.trim().length < 3}
                      onClick={() =>
                        void save.mutate('fees', {
                          serviceFee: { enabled: Boolean(form.pricing?.serviceFee?.enabled), rateBps: Number(form.pricing?.serviceFee?.rateBps ?? 0), minCents: Number(form.pricing?.serviceFee?.minCents ?? 0), maxCents: Number(form.pricing?.serviceFee?.maxCents ?? 0), appliesTo: form.pricing?.serviceFee?.appliesTo ?? ['delivery'] },
                          smallOrderFee: { enabled: Boolean(form.pricing?.smallOrderFee?.enabled), thresholdCents: Number(form.pricing?.smallOrderFee?.thresholdCents ?? 0), mode: form.pricing?.smallOrderFee?.mode ?? 'flat', flatCents: Number(form.pricing?.smallOrderFee?.flatCents ?? 0), maxCents: Number(form.pricing?.smallOrderFee?.maxCents ?? 0), appliesTo: form.pricing?.smallOrderFee?.appliesTo ?? ['delivery'] },
                          payment: { percentBps: Number(form.pricing?.payment?.percentBps ?? 0), fixedCents: Number(form.pricing?.payment?.fixedCents ?? 0), connectPercentBps: Number(form.pricing?.payment?.connectPercentBps ?? 0), payer: form.pricing?.payment?.payer ?? 'platform' },
                        })
                      }
                    >
                      Enregistrer
                    </Button>
                  </CardFooter>
                </Card>
              </TabsContent>

              <TabsContent value="delivery" className="pt-4">
                <Card>
                  <CardContent className="grid gap-4 pt-4 sm:grid-cols-2">
                    <FormField label="Distance maximale de livraison (m)" required><Input type="number" value={form.pricing?.delivery?.maxDistanceMeters ?? 8000} onChange={(e) => setForm({ ...form, pricing: { ...form.pricing, delivery: { ...form.pricing.delivery, maxDistanceMeters: Number(e.target.value) } } })} /></FormField>
                    <FormField label="Multiplicateur de surtarification max. (bps)" required><Input type="number" value={form.pricing?.delivery?.maxSurgeMultiplierBps ?? 20000} onChange={(e) => setForm({ ...form, pricing: { ...form.pricing, delivery: { ...form.pricing.delivery, maxSurgeMultiplierBps: Number(e.target.value) } } })} /></FormField>
                    <FormField label="Frais de livraison commerce min. (centimes)"><Input type="number" value={form.pricing?.merchantDelivery?.minFeeCents ?? ''} onChange={(e) => setForm({ ...form, pricing: { ...form.pricing, merchantDelivery: { ...form.pricing.merchantDelivery, minFeeCents: e.target.value === '' ? null : Number(e.target.value) } } })} /></FormField>
                    <FormField label="Frais de livraison commerce max. (centimes)"><Input type="number" value={form.pricing?.merchantDelivery?.maxFeeCents ?? ''} onChange={(e) => setForm({ ...form, pricing: { ...form.pricing, merchantDelivery: { ...form.pricing.merchantDelivery, maxFeeCents: e.target.value === '' ? null : Number(e.target.value) } } })} /></FormField>
                    <div className="sm:col-span-2"><ReasonField value={reason} onChange={setReason} /></div>
                  </CardContent>
                  <CardFooter className="justify-end">
                    <Button
                      leftIcon={<Save />}
                      loading={save.loading}
                      disabled={!can('markets.edit') || reason.trim().length < 3}
                      onClick={() =>
                        void save.mutate('delivery', {
                          maxDistanceMeters: Number(form.pricing?.delivery?.maxDistanceMeters ?? 8000),
                          maxSurgeMultiplierBps: Number(form.pricing?.delivery?.maxSurgeMultiplierBps ?? 20000),
                          merchantDelivery: {
                            minFeeCents: form.pricing?.merchantDelivery?.minFeeCents ?? null,
                            maxFeeCents: form.pricing?.merchantDelivery?.maxFeeCents ?? null,
                            minOrderFloorCents: form.pricing?.merchantDelivery?.minOrderFloorCents ?? null,
                            minOrderCeilingCents: form.pricing?.merchantDelivery?.minOrderCeilingCents ?? null,
                            maxRadiusMeters: form.pricing?.merchantDelivery?.maxRadiusMeters ?? null,
                          },
                        })
                      }
                    >
                      Enregistrer
                    </Button>
                  </CardFooter>
                </Card>
              </TabsContent>

              <TabsContent value="more" className="pt-4">
                <Card>
                  <CardHeader title={`Autres réglages du marché ${country?.name ?? ''}`} description="Ces réglages vivent dans leur rubrique, avec leur propre historique : accès direct depuis ici." />
                  <CardContent className="grid gap-2 sm:grid-cols-2">
                    {[
                      { to: '/facturation/tva', label: 'Taux de TVA du pays', hint: 'Facturation > TVA' },
                      { to: '/paiements/moyens', label: 'Moyens de paiement du pays', hint: 'Paiements > Moyens' },
                      { to: '/paiements/prestataires', label: 'Prestataires de paiement', hint: 'Paiements > Prestataires' },
                      { to: '/abonnements/commissions', label: 'Commissions et barèmes', hint: 'Abonnements > Commissions' },
                      { to: '/livreurs/remuneration', label: 'Rémunération des livreurs', hint: 'Livreurs > Rémunération' },
                      { to: '/regles-commandes', label: 'Règles automatiques des commandes', hint: 'Règles des commandes' },
                      { to: '/zones', label: 'Villes et zones de livraison', hint: 'Zones' },
                    ].map((l) => (
                      <Link key={l.to} to={l.to} className="flex items-center justify-between gap-3 rounded-xl border border-border px-4 py-3 text-sm hover:bg-surface-2">
                        <span><span className="block font-medium text-fg">{l.label}</span><span className="text-xs text-fg-subtle">{l.hint}</span></span>
                        <ExternalLink className="size-4 shrink-0 text-fg-subtle" />
                      </Link>
                    ))}
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="history" className="pt-4">
                <Card>
                  <CardContent className="pt-4">{countryId && <HistoryPanel target={{ type: 'country', id: `countries/${countryId}`, label: country?.name ?? countryId }} />}</CardContent>
                </Card>
              </TabsContent>
            </Tabs>
          )}
        </>
      )}
      </RequirePermission>

      <NewCountryDialog open={newOpen} onOpenChange={setNewOpen} templates={countries.data.map((c) => ({ id: c.id, name: `${c.name} (${c.code})` }))} onCreated={setCountryId} />
      {country && (
        <ActionDialog
          open={closeOpen}
          onOpenChange={setCloseOpen}
          title={`Fermer le marché ${country.name}`}
          description="Fermez d'abord toutes les villes actives de ce pays. Les commandes en cours ne sont pas affectées."
          destructive
          onSubmit={async (r) => {
            const res = await toggleActive.mutate(false, r);
            return Boolean(res);
          }}
        >
          <DetailRow label="Villes actives" value={cities.data.filter((c: any) => c.active).length} />
        </ActionDialog>
      )}
    </PageContainer>
  );
}
