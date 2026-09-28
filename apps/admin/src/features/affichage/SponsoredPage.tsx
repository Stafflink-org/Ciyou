import { useMemo, useState } from 'react';
import { collection, limit, orderBy, query } from 'firebase/firestore';
import { BadgeEuro, CalendarClock, Megaphone, MousePointerClick, Pencil, Plus, ShoppingBag, XCircle } from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  Checkbox,
  Combobox,
  ConfirmDialog,
  DataTable,
  DatePicker,
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
  RadioGroup,
  Select,
  Skeleton,
  StatusBadge,
  Switch,
  Textarea,
  createColumnHelper,
  formatNumber,
  formatPercent,
  toast,
} from '@golink/ui';
import {
  COLLECTIONS,
  type BookSponsoredPlacementInput,
  type CuisineCategory,
  type SponsoredOffer,
  type SponsoredPlacement,
  type SponsoredSlot,
  type WithId,
} from '@golink/shared';
import { useDocumentTitle } from '@golink/web';
import { db } from '@/lib/firebase';
import { callFunction, errorMessage, useCollection, useMutation } from '@/lib/firestore';
import { euros, isoDay, longDate, millis, parseEuros, shortDay } from '../_experience/format';
import { BILLING_LABELS, PLACEMENT_STATUS_META, SLOT_LABELS } from '../_experience/labels';
import { useScopeFilter } from '../_experience/scope';
import { Kpi, LoadError, Panel } from '../_experience/ui';
import { AffichageNav, useCityRestaurants, useWorkingCity } from './shared';

const book = callFunction<BookSponsoredPlacementInput, { placementId: string; status: string; priceHtCents: number }>('bookSponsoredPlacement');
const saveOffer = callFunction<{ offerId: string | null; label: string; description: string | null; slot: SponsoredSlot; priceHtCents: number; durationDays: number; maxConcurrent: number; cityIds: string[] | null; active: boolean; reason: string }, { offerId: string }>('saveSponsoredOffer');
const cancel = callFunction<{ placementId: string; reason: string; refundAdCredit: boolean }, { ok: boolean }>('cancelSponsoredPlacement');
const col = createColumnHelper<WithId<SponsoredPlacement>>();
const SLOTS = Object.keys(SLOT_LABELS) as SponsoredSlot[];

export function SponsoredPage() {
  useDocumentTitle('Mise en avant payante · Affichage · GoLink Admin');
  const scope = useScopeFilter();
  const offersQ = useMemo(() => query(collection(db, COLLECTIONS.sponsoredOffers), orderBy('order'), limit(100)), []);
  const offers = useCollection<SponsoredOffer>(offersQ);
  const placementsQ = useMemo(() => query(collection(db, COLLECTIONS.sponsoredPlacements), ...scope.constraints, orderBy('startsAt', 'desc'), limit(300)), [scope.key]);
  const placements = useCollection<SponsoredPlacement>(placementsQ);
  const [editingOffer, setEditingOffer] = useState<WithId<SponsoredOffer> | 'new' | null>(null);
  const [selling, setSelling] = useState(false);
  const [cancelling, setCancelling] = useState<WithId<SponsoredPlacement> | null>(null);
  const cancelMutation = useMutation(cancel, { success: 'Emplacement annulé' });

  const now = Date.now();
  const running = placements.data.filter((p) => p.status === 'active');
  const upcoming = placements.data.filter((p) => p.status === 'scheduled');
  const last30 = placements.data.filter((p) => p.status !== 'cancelled' && millis(p.startsAt) >= now - 30 * 86_400_000);
  const revenue = last30.reduce((s, p) => s + p.priceHtCents, 0);
  const impressions = placements.data.reduce((s, p) => s + p.impressions, 0);
  const clicks = placements.data.reduce((s, p) => s + p.clicks, 0);
  const orders = placements.data.reduce((s, p) => s + p.orders, 0);

  const columns = useMemo(
    () => [
      col.accessor((p) => p.restaurantName ?? p.restaurantId, { id: 'restaurant', header: 'Commerce', cell: ({ row }) => <div><div className="font-medium text-fg">{row.original.restaurantName ?? row.original.restaurantId}</div><div className="text-xs text-fg-muted">{scope.cityNames.get(row.original.cityId) ?? row.original.cityId}</div></div> }),
      col.accessor('slot', { header: 'Emplacement', cell: (i) => <span className="whitespace-nowrap text-sm">{SLOT_LABELS[i.getValue()]}</span> }),
      col.accessor((p) => millis(p.startsAt), { id: 'period', header: 'Période', cell: ({ row }) => <span className="whitespace-nowrap font-mono text-xs num">{shortDay(millis(row.original.startsAt))} → {shortDay(millis(row.original.endsAt) - 1)}</span> }),
      col.accessor('priceHtCents', { header: 'Prix HT', meta: { align: 'right' }, cell: ({ row }) => <div className="text-right"><div className="font-mono num">{euros(row.original.priceHtCents)}</div>{row.original.billing && row.original.billing !== 'invoice' && <div className="text-2xs text-fg-subtle">{BILLING_LABELS[row.original.billing]}</div>}</div> }),
      col.accessor('impressions', { header: 'Vues', meta: { align: 'right' }, cell: (i) => <span className="font-mono num">{formatNumber(i.getValue())}</span> }),
      col.accessor('clicks', { header: 'Clics', meta: { align: 'right' }, cell: ({ row }) => <span className="font-mono num">{formatNumber(row.original.clicks)}{row.original.impressions ? <span className="text-fg-subtle"> · {formatPercent(row.original.clicks / row.original.impressions)}</span> : null}</span> }),
      col.accessor('orders', { header: 'Commandes', meta: { align: 'right' }, cell: (i) => <span className="font-mono num">{formatNumber(i.getValue())}</span> }),
      col.accessor('status', { header: 'Statut', cell: (i) => <StatusBadge status={i.getValue()} map={PLACEMENT_STATUS_META} /> }),
      col.display({
        id: 'actions',
        cell: ({ row }) => (row.original.status === 'scheduled' || row.original.status === 'active') && !row.original.invoiceId
          ? <Button size="xs" variant="ghost" leftIcon={<XCircle />} onClick={(e) => { e.stopPropagation(); setCancelling(row.original); }}>Annuler</Button>
          : null,
      }),
    ],
    [scope.cityNames],
  );

  return (
    <PageContainer wide>
      <PageHeader
        eyebrow="Opérations"
        title="Affichage app client"
        description="Visibilité vendue aux commerces : emplacements, durée et prix. Chaque emplacement porte la mention « Sponsorisé »."
        actions={<Button variant="primary" leftIcon={<Plus />} onClick={() => setSelling(true)} disabled={offers.data.filter((o) => o.active).length === 0}>Vendre un emplacement</Button>}
      />
      <AffichageNav />
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="En cours" value={placements.loading ? '…' : running.length} icon={<Megaphone />} tone="success" hint={`${upcoming.length} programmés`} />
        <Kpi label="Ventes HT (30 j)" value={euros(revenue)} icon={<BadgeEuro />} tone="brand" hint={`${last30.length} emplacements`} />
        <Kpi label="Taux de clic" value={impressions ? formatPercent(clicks / impressions) : '—'} icon={<MousePointerClick />} tone="info" hint={`${formatNumber(impressions)} vues`} />
        <Kpi label="Commandes générées" value={formatNumber(orders)} icon={<ShoppingBag />} />
      </div>

      <Panel
        title="Catalogue des offres"
        description="Prix HT par période ; la capacité limite le nombre de commerces mis en avant en même temps par ville."
        actions={<Button size="sm" leftIcon={<Plus />} onClick={() => setEditingOffer('new')}>Nouvelle offre</Button>}
        className="mb-6"
      >
        {offers.error ? <LoadError error={offers.error} compact /> : offers.loading ? <Skeleton className="h-28" /> : offers.data.length === 0 ? (
          <EmptyState compact icon={<Megaphone />} title="Aucune offre" description="Créez les emplacements vendus aux commerces." />
        ) : (
          <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-4">
            {offers.data.map((o) => {
              const used = running.filter((p) => p.offerId === o.id).length;
              return (
                <button key={o.id} type="button" onClick={() => setEditingOffer(o)} className="group rounded-xl border border-border bg-surface-2 p-4 text-left transition-colors hover:border-border-strong">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate font-medium text-fg">{o.label}</div>
                      <div className="text-xs text-fg-muted">{SLOT_LABELS[o.slot]}</div>
                    </div>
                    {o.active ? <Badge size="sm" tone="success">Proposée</Badge> : <Badge size="sm" tone="neutral">Suspendue</Badge>}
                  </div>
                  <div className="mt-3 font-display text-2xl font-semibold tracking-display num">{euros(o.priceHtCents)}<span className="text-sm font-normal text-fg-muted"> HT / {o.durationDays} j</span></div>
                  <div className="mt-2 flex items-center justify-between text-xs text-fg-muted">
                    <span>{o.cityIds ? `${o.cityIds.length} ville${o.cityIds.length > 1 ? 's' : ''}` : 'Toutes les villes'}</span>
                    <span className="flex items-center gap-1"><Pencil className="size-3 opacity-0 transition group-hover:opacity-100" />{used} en cours · max {o.maxConcurrent}/ville</span>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </Panel>

      <h2 className="mb-3 font-display text-md font-semibold">Emplacements vendus</h2>
      {placements.error ? <Card><LoadError error={placements.error} /></Card> : (
        <DataTable
          data={placements.data}
          columns={columns}
          loading={placements.loading}
          getRowId={(p) => p.id}
          itemLabel="emplacements"
          filters={[
            { id: 'status', label: 'Statut', options: Object.entries(PLACEMENT_STATUS_META).map(([value, m]) => ({ value, label: m.label })), getValue: (p) => p.status },
            { id: 'slot', label: 'Emplacement', options: SLOTS.map((s) => ({ value: s, label: SLOT_LABELS[s] })), getValue: (p) => p.slot },
          ]}
          emptyState={<EmptyState compact icon={<CalendarClock />} title="Aucun emplacement vendu" description="Vendez un premier emplacement à un commerce." />}
        />
      )}

      <OfferDialog key={editingOffer === 'new' ? 'new' : (editingOffer?.id ?? '')} offer={editingOffer} onClose={() => setEditingOffer(null)} />
      <SellDialog open={selling} onOpenChange={setSelling} offers={offers.data.filter((o) => o.active)} />
      <ConfirmDialog
        open={cancelling !== null}
        onOpenChange={(o) => !o && setCancelling(null)}
        title={`Annuler l’emplacement de ${cancelling?.restaurantName ?? ''} ?`}
        description={cancelling?.adCreditUsedCents ? `Le crédit publicitaire utilisé (${euros(cancelling.adCreditUsedCents)}) est rendu au commerce.` : 'L’emplacement est retiré immédiatement et ne sera pas facturé.'}
        destructive
        confirmLabel="Annuler l’emplacement"
        requireReason
        onConfirm={async (reason) => {
          if (cancelling) await cancelMutation.mutate({ placementId: cancelling.id, reason: reason ?? '', refundAdCredit: true });
        }}
      />
    </PageContainer>
  );
}

function OfferDialog({ offer, onClose }: { offer: WithId<SponsoredOffer> | 'new' | null; onClose: () => void }) {
  const { cities } = useWorkingCity();
  const existing = offer && offer !== 'new' ? offer : null;
  const [label, setLabel] = useState(existing?.label ?? '');
  const [description, setDescription] = useState(existing?.description ?? '');
  const [slot, setSlot] = useState<SponsoredSlot>(existing?.slot ?? 'home_featured');
  const [price, setPrice] = useState(existing ? (existing.priceHtCents / 100).toFixed(2).replace('.', ',') : '');
  const [duration, setDuration] = useState(String(existing?.durationDays ?? 7));
  const [capacity, setCapacity] = useState(String(existing?.maxConcurrent ?? 3));
  const [allCities, setAllCities] = useState(existing ? existing.cityIds === null : true);
  const [cityIds, setCityIds] = useState<string[]>(existing?.cityIds ?? []);
  const [active, setActive] = useState(existing?.active ?? true);
  const [saving, setSaving] = useState(false);
  const [reason, setReason] = useState('');
  const cents = parseEuros(price);
  const days = Number(duration);
  const max = Number(capacity);
  const valid = label.trim().length >= 3 && cents !== null && Number.isInteger(days) && days >= 1 && days <= 365 && Number.isInteger(max) && max >= 1 && (allCities || cityIds.length > 0) && reason.trim().length >= 3;

  async function save() {
    if (cents === null) return;
    setSaving(true);
    try {
      await saveOffer({ offerId: existing?.id ?? null, label: label.trim(), description: description.trim() || null, slot, priceHtCents: cents, durationDays: days, maxConcurrent: max, cityIds: allCities ? null : cityIds, active, reason: reason.trim() });
      toast.success('Offre enregistrée');
      onClose();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={offer !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="lg">
        <DialogHeader icon={<Megaphone />} title={existing ? 'Modifier l’offre' : 'Nouvelle offre'} description="Les emplacements déjà vendus conservent leur prix." />
        <DialogBody className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Nom de l’offre" required><Input value={label} onChange={(e) => setLabel(e.target.value)} maxLength={80} placeholder="Sélection de l’accueil · 7 jours" /></FormField>
            <FormField label="Emplacement"><Select value={slot} onValueChange={(v) => setSlot(v as SponsoredSlot)} options={SLOTS.map((s) => ({ value: s, label: SLOT_LABELS[s] }))} /></FormField>
          </div>
          <FormField label="Description"><Textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={300} /></FormField>
          <div className="grid gap-4 sm:grid-cols-3">
            <FormField label="Prix HT" required><Input inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} trailing="€" /></FormField>
            <FormField label="Durée" required><Input inputMode="numeric" value={duration} onChange={(e) => setDuration(e.target.value.replace(/\D/g, ''))} trailing="jours" /></FormField>
            <FormField label="Capacité par ville" required><Input inputMode="numeric" value={capacity} onChange={(e) => setCapacity(e.target.value.replace(/\D/g, ''))} trailing="commerces" /></FormField>
          </div>
          <FormField label="Villes">
            <div className="space-y-2">
              <Checkbox checked={allCities} onCheckedChange={(v) => setAllCities(v === true)} label="Toutes les villes" />
              {!allCities && <Combobox multiple value={cityIds} onChange={setCityIds} options={cities.map((c) => ({ value: c.id, label: c.name }))} placeholder="Choisir les villes" />}
            </div>
          </FormField>
          <Switch checked={active} onCheckedChange={setActive} label="Proposée à la vente" />
          <FormField label="Motif" required hint="Le prix est de l’argent : le motif est conservé dans le journal d’audit."><Input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} placeholder="Ex. nouvelle grille tarifaire de septembre" /></FormField>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Annuler</Button>
          <Button variant="primary" loading={saving} disabled={!valid} onClick={() => void save()}>Enregistrer</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SellDialog({ open, onOpenChange, offers }: { open: boolean; onOpenChange: (o: boolean) => void; offers: WithId<SponsoredOffer>[] }) {
  const { cityId: defaultCity, cities } = useWorkingCity();
  const [cityId, setCityId] = useState<string | null>(null);
  const city = cityId ?? defaultCity;
  const restaurants = useCityRestaurants(city);
  const categoriesQ = useMemo(() => query(collection(db, COLLECTIONS.cuisineCategories), orderBy('order'), limit(100)), []);
  const categories = useCollection<CuisineCategory>(categoriesQ);
  const [restaurantId, setRestaurantId] = useState<string | undefined>();
  const [offerId, setOfferId] = useState('');
  const [start, setStart] = useState<Date | undefined>(() => new Date());
  const [periods, setPeriods] = useState('1');
  const [billing, setBilling] = useState<BookSponsoredPlacementInput['billing']>('invoice');
  const [categoryId, setCategoryId] = useState('');
  const [note, setNote] = useState('');
  const { mutate, loading } = useMutation(book, { success: (r) => (r.status === 'active' ? 'Emplacement en ligne' : 'Emplacement programmé') });
  const available = offers.filter((o) => !o.cityIds || (city && o.cityIds.includes(city)));
  const offer = available.find((o) => o.id === offerId);
  const n = Math.max(1, Number(periods) || 1);
  const end = start && offer ? new Date(start.getTime() + offer.durationDays * n * 86_400_000 - 86_400_000) : null;
  const valid = restaurantId && offer && start && (offer.slot !== 'category_top' || categoryId) && note.trim().length >= 3;

  async function submit() {
    if (!restaurantId || !offer || !start) return;
    const r = await mutate({ restaurantId, offerId: offer.id, startDay: isoDay(start), periods: n, billing, categoryId: categoryId || null, note: note.trim() });
    if (r) {
      onOpenChange(false);
      setRestaurantId(undefined);
      setNote('');
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <DialogHeader icon={<Megaphone />} title="Vendre un emplacement" description="Le prix est celui du catalogue ; il est facturé avec les commissions du mois." />
        <DialogBody className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Ville">
              <Select value={city ?? ''} onValueChange={(v) => { setCityId(v); setRestaurantId(undefined); setOfferId(''); }} options={cities.map((c) => ({ value: c.id, label: c.name }))} />
            </FormField>
            <FormField label="Commerce" required>
              <Combobox value={restaurantId} onChange={setRestaurantId} options={restaurants.data.map((r) => ({ value: r.id, label: r.name, description: r.sponsored ? 'Déjà sponsorisé' : undefined }))} placeholder="Choisir un commerce en ligne" />
            </FormField>
          </div>
          <FormField label="Offre" required>
            <Select value={offerId} onValueChange={setOfferId} options={available.map((o) => ({ value: o.id, label: `${o.label} · ${euros(o.priceHtCents)} HT / ${o.durationDays} j` }))} placeholder={available.length ? 'Choisir une offre' : 'Aucune offre dans cette ville'} />
          </FormField>
          {offer?.slot === 'category_top' && (
            <FormField label="Catégorie" required>
              <Select value={categoryId} onValueChange={setCategoryId} options={categories.data.filter((c) => c.active).map((c) => ({ value: c.id, label: c.name.fr }))} placeholder="Choisir" />
            </FormField>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Début" required><DatePicker value={start} onChange={setStart} disabledDays={{ before: new Date() }} /></FormField>
            <FormField label="Nombre de périodes" hint={offer ? `${offer.durationDays * n} jours${end ? `, jusqu’au ${longDate(end.getTime())}` : ''}` : undefined}>
              <Input inputMode="numeric" value={periods} onChange={(e) => setPeriods(e.target.value.replace(/\D/g, '').slice(0, 2))} />
            </FormField>
          </div>
          <FormField label="Règlement">
            <RadioGroup
              variant="cards"
              value={billing}
              onValueChange={(v) => setBilling(v as BookSponsoredPlacementInput['billing'])}
              options={[
                { value: 'invoice', label: 'Facturé', description: 'Ajouté à la facture mensuelle du commerce.' },
                { value: 'ad_credit', label: 'Crédit publicitaire', description: 'Déduit du crédit (parrainage).' },
                { value: 'offered', label: 'Offert', description: 'Geste commercial, non facturé.' },
              ]}
            />
          </FormField>
          <FormField label="Motif de la vente" required hint="Conservé dans le journal d’audit."><Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder="Négocié lors du rendez-vous du 12/09" /></FormField>
          {offer && (
            <div className="flex items-center justify-between rounded-xl border border-border bg-surface-2 px-4 py-3">
              <span className="text-sm text-fg-muted">Montant {billing === 'invoice' ? 'facturé' : billing === 'ad_credit' ? 'prélevé sur le crédit' : 'offert'}</span>
              <span className="font-display text-xl font-semibold num">{euros(offer.priceHtCents * n)} HT</span>
            </div>
          )}
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Annuler</Button>
          <Button variant="primary" loading={loading} disabled={!valid} onClick={() => void submit()}>Confirmer la vente</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
