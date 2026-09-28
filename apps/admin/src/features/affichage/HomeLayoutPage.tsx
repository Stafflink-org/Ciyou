import { useMemo, useState } from 'react';
import { collection, doc, limit, orderBy, query, serverTimestamp, setDoc, updateDoc, where, writeBatch } from 'firebase/firestore';
import { Archive, ArrowDown, ArrowUp, CalendarRange, Eye, EyeOff, GripVertical, Pencil, Plus, Sparkles, Star } from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  Checkbox,
  Combobox,
  DatePicker,
  EmptyState,
  FormField,
  IconButton,
  Input,
  PageContainer,
  PageHeader,
  Select,
  Sheet,
  SheetBody,
  SheetContent,
  SheetFooter,
  SheetHeader,
  Skeleton,
  Switch,
  Tooltip,
  cn,
  toast,
} from '@golink/ui';
import {
  COLLECTIONS,
  SETTINGS_DOCS,
  paths,
  type Banner,
  type CuisineCategory,
  type DisplaySettings,
  type HomeSection,
  type HomeSectionType,
  type Promotion,
  type Restaurant,
  type WithId,
} from '@golink/shared';
import { useDocumentTitle } from '@golink/web';
import { useAdminAccess } from '@/auth/AdminAccess';
import { db } from '@/lib/firebase';
import { createdFields, docAt, errorMessage, toTimestamp, updatedFields, useCollection, useDoc } from '@/lib/firestore';
import { millis, shortDay } from '../_experience/format';
import { LoadError } from '../_experience/ui';
import { AffichageNav, CategoryIcon, PhoneFrame, useCityRestaurants, useWorkingCity } from './shared';

export const SECTION_LABELS: Record<HomeSectionType, { label: string; description: string }> = {
  welcome_message: { label: 'Message d’accueil', description: 'Titre et sous-titre en haut de l’accueil.' },
  banner_carousel: { label: 'Bannières', description: 'Carrousel des bannières actives de la ville.' },
  categories: { label: 'Catégories', description: 'Raccourcis vers les catégories de cuisine.' },
  featured_restaurants: { label: 'Restaurants mis en avant', description: 'Sélection éditoriale de restaurants.' },
  promotions: { label: 'Promotions', description: 'Offres en vitrine du moment.' },
  popular: { label: 'Populaires', description: 'Les plus commandés de la ville.' },
  new_restaurants: { label: 'Nouveautés', description: 'Restaurants arrivés récemment.' },
  reorder: { label: 'À recommander', description: 'Dernières commandes du client.' },
};

const active = (s: { active: boolean; archivedAt?: unknown; startsAt?: unknown; endsAt?: unknown }, now: number) =>
  s.active && !s.archivedAt && (!s.startsAt || millis(s.startsAt) <= now) && (!s.endsAt || millis(s.endsAt) >= now);

export function HomeLayoutPage() {
  useDocumentTitle('Page d’accueil · Affichage · Ciyou Eats Admin');
  const { admin } = useAdminAccess();
  const { cityId, city, selector } = useWorkingCity();
  const sectionsQ = useMemo(() => query(collection(db, COLLECTIONS.homeSections), orderBy('order'), limit(200)), []);
  const sections = useCollection<HomeSection>(sectionsQ);
  const [editing, setEditing] = useState<WithId<HomeSection> | 'new' | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const now = Date.now();

  const citySections = sections.data.filter((s) => !s.archivedAt && (s.cityIds === null || (cityId && s.cityIds.includes(cityId))));

  async function reorder(ids: string[]) {
    try {
      const batch = writeBatch(db);
      ids.forEach((id, index) => batch.update(doc(db, COLLECTIONS.homeSections, id), { order: index, ...updatedFields(admin.uid) }));
      await batch.commit();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  function move(index: number, delta: number) {
    const ids = citySections.map((s) => s.id);
    const target = index + delta;
    if (target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target]!, ids[index]!];
    void reorder(ids);
  }

  function drop(targetId: string) {
    if (!dragId || dragId === targetId) return;
    const ids = citySections.map((s) => s.id).filter((id) => id !== dragId);
    ids.splice(ids.indexOf(targetId), 0, dragId);
    setDragId(null);
    void reorder(ids);
  }

  async function toggle(section: WithId<HomeSection>) {
    try {
      await updateDoc(doc(db, COLLECTIONS.homeSections, section.id), { active: !section.active, ...updatedFields(admin.uid) });
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  return (
    <PageContainer wide>
      <PageHeader
        eyebrow="Opérations"
        title="Affichage app client"
        description="Ce que voit le client à l’ouverture de l’application, ville par ville, et dans quel ordre."
        actions={<div className="flex flex-wrap items-center gap-2">{selector}<Button variant="primary" leftIcon={<Plus />} onClick={() => setEditing('new')}>Ajouter une section</Button></div>}
      />
      <AffichageNav />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-w-0">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="font-display text-md font-semibold">Sections affichées à {city?.name ?? '…'}</h2>
            <span className="text-xs text-fg-muted">Glissez-déposez pour réordonner</span>
          </div>
          {sections.error ? <Card><LoadError error={sections.error} /></Card> : sections.loading ? (
            <div className="space-y-2">{Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className="h-16" />)}</div>
          ) : citySections.length === 0 ? (
            <Card><EmptyState icon={<Sparkles />} title="Accueil vide" description="Ajoutez un message d’accueil, des bannières et des sélections." action={<Button onClick={() => setEditing('new')}>Ajouter une section</Button>} /></Card>
          ) : (
            <ol className="space-y-2">
              {citySections.map((s, i) => {
                const live = active(s, now);
                return (
                  <li
                    key={s.id}
                    draggable
                    onDragStart={() => setDragId(s.id)}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={() => drop(s.id)}
                    className={cn('group flex items-center gap-3 rounded-xl border border-border bg-surface px-3 py-3 shadow-card transition', dragId === s.id && 'opacity-50', !live && 'bg-surface-2')}
                  >
                    <GripVertical className="size-4 shrink-0 cursor-grab text-fg-subtle" aria-hidden />
                    <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-surface-3 font-mono text-2xs text-fg-muted num">{i + 1}</span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={cn('font-medium', live ? 'text-fg' : 'text-fg-muted')}>{s.title?.fr || SECTION_LABELS[s.type].label}</span>
                        <Badge size="sm" tone="neutral" variant="outline">{SECTION_LABELS[s.type].label}</Badge>
                        {s.cityIds === null ? <Badge size="sm" tone="info">Toutes les villes</Badge> : <Badge size="sm" tone="brand">{s.cityIds.length === 1 ? 'Cette ville' : `${s.cityIds.length} villes`}</Badge>}
                        {(s.startsAt || s.endsAt) && <Badge size="sm" tone="amber" icon={<CalendarRange />}>{s.startsAt ? shortDay(millis(s.startsAt)) : '…'} → {s.endsAt ? shortDay(millis(s.endsAt)) : '…'}</Badge>}
                      </div>
                      <p className="mt-0.5 truncate text-xs text-fg-muted">
                        {s.type === 'featured_restaurants' ? `${s.restaurantIds?.length ?? 0} restaurants sélectionnés` : s.subtitle?.fr || SECTION_LABELS[s.type].description}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <IconButton size="sm" variant="ghost" label="Monter" disabled={i === 0} onClick={() => move(i, -1)} className="hidden sm:inline-flex"><ArrowUp /></IconButton>
                      <IconButton size="sm" variant="ghost" label="Descendre" disabled={i === citySections.length - 1} onClick={() => move(i, 1)} className="hidden sm:inline-flex"><ArrowDown /></IconButton>
                      <Tooltip content={s.active ? 'Masquer' : 'Afficher'}>
                        <IconButton size="sm" variant="ghost" label={s.active ? 'Masquer la section' : 'Afficher la section'} onClick={() => void toggle(s)}>{s.active ? <Eye /> : <EyeOff />}</IconButton>
                      </Tooltip>
                      <IconButton size="sm" variant="ghost" label="Modifier" onClick={() => setEditing(s)}><Pencil /></IconButton>
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </div>
        <div className="min-w-0">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-display text-md font-semibold">Aperçu</h2>
            <span className="text-xs text-fg-muted">App client · {city?.name ?? ''}</span>
          </div>
          <HomePreview cityId={cityId} sections={citySections.filter((s) => active(s, now))} />
        </div>
      </div>
      <SectionSheet key={editing === 'new' ? 'new' : (editing?.id ?? '')} section={editing} onClose={() => setEditing(null)} cityId={cityId} nextOrder={sections.data.length} />
    </PageContainer>
  );
}

// ------------------------------------------------------------------ Aperçu

function HomePreview({ cityId, sections }: { cityId: string | null; sections: WithId<HomeSection>[] }) {
  const restaurants = useCityRestaurants(cityId);
  const bannersQ = useMemo(() => query(collection(db, COLLECTIONS.banners), orderBy('order'), limit(50)), []);
  const banners = useCollection<Banner>(bannersQ).data.filter((b) => b.active && !b.archivedAt && (b.cityIds === null || (cityId && b.cityIds.includes(cityId))));
  const categoriesQ = useMemo(() => query(collection(db, COLLECTIONS.cuisineCategories), orderBy('order'), limit(60)), []);
  const categories = useCollection<CuisineCategory>(categoriesQ).data.filter((c) => c.active);
  const promosQ = useMemo(() => query(collection(db, COLLECTIONS.promotions), where('status', '==', 'active'), where('showcase', '==', true), limit(40)), []);
  const promos = useCollection<Promotion>(promosQ).data.filter((p) => p.status === 'active' && p.showcase && (p.cityIds.length === 0 || (cityId && p.cityIds.includes(cityId))));
  const display = useDoc<DisplaySettings>(docAt(paths.settings(SETTINGS_DOCS.display)));
  const label = display.data?.sponsoredLabel ?? 'Sponsorisé';

  const list = restaurants.data;
  const popular = [...list].sort((a, b) => b.ordersCount - a.ordersCount).slice(0, 6);
  const fresh = [...list].sort((a, b) => millis(b.createdAt) - millis(a.createdAt)).slice(0, 6);

  return (
    <PhoneFrame>
      <div className="space-y-5 px-4 pb-6">
        {sections.length === 0 && <p className="pt-20 text-center text-sm text-petrol-500">Aucune section active.</p>}
        {sections.map((s) => {
          switch (s.type) {
            case 'welcome_message':
              return (
                <div key={s.id}>
                  <p className="font-display text-xl font-semibold leading-tight tracking-tight">{s.title?.fr ?? 'Bonjour'}</p>
                  {s.subtitle?.fr && <p className="mt-1 text-xs text-petrol-600">{s.subtitle.fr}</p>}
                </div>
              );
            case 'banner_carousel':
              return banners.length ? (
                <div key={s.id} data-scroll-ok className="flex snap-x gap-2 overflow-x-auto [scrollbar-width:none]">
                  {banners.map((b) => (
                    <div key={b.id} className="relative h-28 w-[88%] shrink-0 snap-start overflow-hidden rounded-2xl bg-petrol-800">
                      {b.image?.url && <img src={b.image.url} alt={b.image.alt ?? ''} className="absolute inset-0 size-full object-cover opacity-80" loading="lazy" />}
                      <div className="absolute inset-0 bg-gradient-to-t from-black/70 to-transparent" />
                      <div className="absolute inset-x-3 bottom-2 text-white">
                        {b.sponsored && <span className="mb-1 inline-block rounded bg-white/85 px-1.5 text-[9px] font-medium uppercase tracking-wide text-petrol-900">{label}</span>}
                        <p className="text-sm font-semibold leading-tight">{b.title.fr}</p>
                      </div>
                    </div>
                  ))}
                </div>
              ) : null;
            case 'categories':
              return (
                <div key={s.id}>
                  {s.title?.fr && <p className="mb-2 text-sm font-semibold">{s.title.fr}</p>}
                  <div data-scroll-ok className="flex gap-3 overflow-x-auto [scrollbar-width:none]">
                    {categories.slice(0, 12).map((c) => (
                      <div key={c.id} className="flex w-14 shrink-0 flex-col items-center gap-1">
                        <span className="grid size-12 place-items-center rounded-2xl bg-white text-brand-600 shadow-sm"><CategoryIcon name={c.icon} className="size-5" /></span>
                        <span className="w-full truncate text-center text-[10px] text-petrol-700">{c.name.fr}</span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            case 'promotions':
              return promos.length ? (
                <PreviewRow key={s.id} title={s.title?.fr ?? 'Offres du moment'}>
                  {promos.map((p) => (
                    <div key={p.id} className="w-40 shrink-0 rounded-xl bg-brand-500 p-3 text-brand-950">
                      <p className="text-xs font-semibold leading-tight">{p.title.fr}</p>
                      {p.code && <p className="mt-1 font-mono text-[10px]">{p.code}</p>}
                    </div>
                  ))}
                </PreviewRow>
              ) : null;
            case 'featured_restaurants':
              return <RestaurantRow key={s.id} title={s.title?.fr ?? 'Sélection'} items={(s.restaurantIds ?? []).map((id) => restaurants.byId.get(id)).filter((r): r is WithId<Restaurant> => Boolean(r))} label={label} />;
            case 'popular':
              return <RestaurantRow key={s.id} title={s.title?.fr ?? 'Populaires'} items={popular} label={label} />;
            case 'new_restaurants':
              return <RestaurantRow key={s.id} title={s.title?.fr ?? 'Nouveautés'} items={fresh} label={label} />;
            case 'reorder':
              return (
                <PreviewRow key={s.id} title={s.title?.fr ?? 'À recommander'}>
                  <div className="w-full rounded-xl border border-dashed border-cream-300 p-3 text-center text-[11px] text-petrol-500">Personnalisé selon l’historique du client</div>
                </PreviewRow>
              );
          }
        })}
      </div>
    </PhoneFrame>
  );
}

function PreviewRow({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-2 text-sm font-semibold">{title}</p>
      <div data-scroll-ok className="flex gap-2.5 overflow-x-auto [scrollbar-width:none]">{children}</div>
    </div>
  );
}

function RestaurantRow({ title, items, label }: { title: string; items: WithId<Restaurant>[]; label: string }) {
  if (items.length === 0) return null;
  return (
    <PreviewRow title={title}>
      {items.map((r) => (
        <div key={r.id} className="w-40 shrink-0">
          <div className="relative h-24 overflow-hidden rounded-xl bg-cream-200">
            {r.cover?.url && <img src={r.cover.thumbUrl ?? r.cover.url} alt="" className="size-full object-cover" loading="lazy" />}
            {r.sponsored && <span className="absolute left-1.5 top-1.5 rounded bg-white/90 px-1.5 text-[9px] font-medium uppercase tracking-wide text-petrol-900">{label}</span>}
          </div>
          <p className="mt-1 truncate text-xs font-semibold">{r.name}</p>
          <p className="flex items-center gap-1 text-[10px] text-petrol-600">
            <Star className="size-2.5 fill-current" />{r.rating?.average ? r.rating.average.toFixed(1).replace('.', ',') : 'Nouveau'} · {r.etaMinutes?.min ?? 20}-{r.etaMinutes?.max ?? 35} min
          </p>
        </div>
      ))}
    </PreviewRow>
  );
}

// ------------------------------------------------------------------ Édition

function SectionSheet({ section, onClose, cityId, nextOrder }: { section: WithId<HomeSection> | 'new' | null; onClose: () => void; cityId: string | null; nextOrder: number }) {
  const { admin } = useAdminAccess();
  const { cities } = useWorkingCity();
  const existing = section && section !== 'new' ? section : null;
  const [type, setType] = useState<HomeSectionType>(existing?.type ?? 'featured_restaurants');
  const [title, setTitle] = useState(existing?.title?.fr ?? '');
  const [subtitle, setSubtitle] = useState(existing?.subtitle?.fr ?? '');
  const [allCities, setAllCities] = useState(existing ? existing.cityIds === null : false);
  const [cityIds, setCityIds] = useState<string[]>(existing?.cityIds ?? (cityId ? [cityId] : []));
  const [restaurantIds, setRestaurantIds] = useState<string[]>(existing?.restaurantIds ?? []);
  const [startsAt, setStartsAt] = useState<Date | undefined>(existing?.startsAt ? new Date(millis(existing.startsAt)) : undefined);
  const [endsAt, setEndsAt] = useState<Date | undefined>(existing?.endsAt ? new Date(millis(existing.endsAt)) : undefined);
  const [isActive, setIsActive] = useState(existing?.active ?? true);
  const [saving, setSaving] = useState(false);
  const pickerCity = allCities ? cityId : (cityIds[0] ?? cityId);
  const restaurants = useCityRestaurants(pickerCity);

  const valid = (allCities || cityIds.length > 0) && (type !== 'featured_restaurants' || restaurantIds.length > 0) && (type !== 'welcome_message' || title.trim().length > 1) && (!startsAt || !endsAt || startsAt <= endsAt);

  async function save(extra: Record<string, unknown> = {}) {
    setSaving(true);
    try {
      const fields = {
        type,
        title: title.trim() ? { fr: title.trim() } : null,
        subtitle: subtitle.trim() ? { fr: subtitle.trim() } : null,
        cityIds: allCities ? null : cityIds,
        countryId: allCities ? null : (cities.find((c) => c.id === cityIds[0])?.countryId ?? null),
        restaurantIds: type === 'featured_restaurants' ? restaurantIds : null,
        startsAt: startsAt ? toTimestamp(startsAt) : null,
        endsAt: endsAt ? toTimestamp(new Date(endsAt.getFullYear(), endsAt.getMonth(), endsAt.getDate(), 23, 59, 59)) : null,
        active: isActive,
        ...extra,
      };
      if (existing) await updateDoc(doc(db, COLLECTIONS.homeSections, existing.id), { ...fields, ...updatedFields(admin.uid) });
      else await setDoc(doc(collection(db, COLLECTIONS.homeSections)), { ...fields, order: nextOrder, archivedAt: null, ...createdFields(admin.uid) });
      toast.success(extra.archivedAt ? 'Section retirée' : 'Section enregistrée');
      onClose();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet open={section !== null} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full sm:max-w-xl">
        <SheetHeader title={existing ? 'Modifier la section' : 'Nouvelle section'} description="Composition de la page d’accueil de l’app client." />
        <SheetBody className="space-y-4">
          <FormField label="Type de section">
            <Select value={type} onValueChange={(v) => setType(v as HomeSectionType)} options={(Object.keys(SECTION_LABELS) as HomeSectionType[]).map((t) => ({ value: t, label: SECTION_LABELS[t].label, description: SECTION_LABELS[t].description }))} />
          </FormField>
          <FormField label={type === 'welcome_message' ? 'Message d’accueil' : 'Titre affiché'} required={type === 'welcome_message'}>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={60} placeholder={type === 'welcome_message' ? 'Qu’est-ce qui vous ferait plaisir ?' : 'La sélection de la semaine'} />
          </FormField>
          <FormField label="Sous-titre">
            <Input value={subtitle} onChange={(e) => setSubtitle(e.target.value)} maxLength={100} />
          </FormField>
          <FormField label="Villes">
            <div className="space-y-2">
              <Checkbox checked={allCities} onCheckedChange={(v) => setAllCities(v === true)} label="Toutes les villes" />
              {!allCities && (
                <Combobox multiple value={cityIds} onChange={setCityIds} options={cities.map((c) => ({ value: c.id, label: c.name }))} placeholder="Choisir les villes" />
              )}
            </div>
          </FormField>
          {type === 'featured_restaurants' && (
            <FormField label="Restaurants mis en avant" required hint={`Restaurants en ligne de ${cities.find((c) => c.id === pickerCity)?.name ?? 'la ville'}, dans l’ordre choisi.`}>
              <Combobox multiple value={restaurantIds} onChange={setRestaurantIds} options={restaurants.data.map((r) => ({ value: r.id, label: r.name, description: r.sponsored ? 'Sponsorisé' : undefined }))} placeholder="Choisir les restaurants" />
            </FormField>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Début" hint="Facultatif">
              <DatePicker value={startsAt} onChange={setStartsAt} placeholder="Dès maintenant" />
            </FormField>
            <FormField label="Fin" hint="Facultatif" error={startsAt && endsAt && startsAt > endsAt ? 'La fin précède le début.' : undefined}>
              <DatePicker value={endsAt} onChange={setEndsAt} placeholder="Sans fin" />
            </FormField>
          </div>
          <Switch checked={isActive} onCheckedChange={setIsActive} label="Section active" />
        </SheetBody>
        <SheetFooter className={cn('flex-wrap', existing && 'justify-between')}>
          {existing && <Button variant="ghost" leftIcon={<Archive />} disabled={saving} onClick={() => void save({ active: false, archivedAt: serverTimestamp() })}>Retirer</Button>}
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose}>Annuler</Button>
            <Button variant="primary" loading={saving} disabled={!valid} onClick={() => void save()}>Enregistrer</Button>
          </div>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
