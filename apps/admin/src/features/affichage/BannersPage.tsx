import { useMemo, useState } from 'react';
import { collection, doc, limit, orderBy, query, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import { Archive, CalendarRange, Image as ImageIcon, Megaphone, Plus } from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  Checkbox,
  Combobox,
  DatePicker,
  EmptyState,
  FileUpload,
  FormField,
  Input,
  PageContainer,
  PageHeader,
  SegmentedControl,
  Select,
  Sheet,
  SheetBody,
  SheetContent,
  SheetFooter,
  SheetHeader,
  Skeleton,
  Switch,
  Textarea,
  cn,
  toast,
} from '@golink/ui';
import { COLLECTIONS, SETTINGS_DOCS, paths, type Banner, type DisplaySettings, type WithId } from '@golink/shared';
import { useDocumentTitle } from '@golink/web';
import { useAdminAccess } from '@/auth/AdminAccess';
import { db } from '@/lib/firebase';
import { createdFields, docAt, errorMessage, toTimestamp, updatedFields, useCollection, useDoc } from '@/lib/firestore';
import { millis, shortDay } from '../_experience/format';
import { LoadError } from '../_experience/ui';
import { AffichageNav, uploadPublicImage, useCityRestaurants, useWorkingCity } from './shared';

type LinkType = NonNullable<Banner['link']>['type'];
const LINK_LABELS: Record<LinkType, string> = { restaurant: 'Restaurant', promotion: 'Promotion', page: 'Page d’information', url: 'Adresse web' };

export function BannersPage() {
  useDocumentTitle('Bannières · Affichage · Ciyou Eats Admin');
  const { cities } = useWorkingCity();
  const q = useMemo(() => query(collection(db, COLLECTIONS.banners), orderBy('order'), limit(200)), []);
  const { data, loading, error } = useCollection<Banner>(q);
  const display = useDoc<DisplaySettings>(docAt(paths.settings(SETTINGS_DOCS.display)));
  const [view, setView] = useState<'live' | 'archived'>('live');
  const [editing, setEditing] = useState<WithId<Banner> | 'new' | null>(null);
  const cityName = (id: string) => cities.find((c) => c.id === id)?.name ?? id;
  const now = Date.now();
  const rows = data.filter((b) => (view === 'archived' ? b.archivedAt : !b.archivedAt));

  return (
    <PageContainer wide>
      <PageHeader
        eyebrow="Opérations"
        title="Affichage app client"
        description="Bannières du carrousel d’accueil, par ville et par période. Une bannière payée par un commerce porte la mention obligatoire."
        actions={<Button variant="primary" leftIcon={<Plus />} onClick={() => setEditing('new')}>Nouvelle bannière</Button>}
      />
      <AffichageNav />
      <div className="mb-4">
        <SegmentedControl value={view} onValueChange={(v) => setView(v as 'live' | 'archived')} options={[{ value: 'live', label: 'Bannières', count: data.filter((b) => !b.archivedAt).length }, { value: 'archived', label: 'Retirées' }]} aria-label="Bannières" />
      </div>
      {error ? <Card><LoadError error={error} /></Card> : loading ? (
        <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">{Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-64" />)}</div>
      ) : rows.length === 0 ? (
        <Card><EmptyState icon={<ImageIcon />} title={view === 'archived' ? 'Aucune bannière retirée' : 'Aucune bannière'} action={view === 'live' ? <Button onClick={() => setEditing('new')}>Créer une bannière</Button> : undefined} /></Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
          {rows.map((b) => {
            const expired = b.endsAt && millis(b.endsAt) < now;
            const upcoming = b.startsAt && millis(b.startsAt) > now;
            return (
              <Card key={b.id} interactive className="overflow-hidden" role="button" tabIndex={0} onClick={() => setEditing(b)} onKeyDown={(e) => e.key === 'Enter' && setEditing(b)}>
                <div className="relative aspect-[16/7] bg-surface-3">
                  {b.image?.url ? <img src={b.image.url} alt={b.image.alt ?? ''} className="size-full object-cover" loading="lazy" /> : <div className="grid size-full place-items-center text-fg-subtle"><ImageIcon className="size-8" /></div>}
                  <div className="absolute left-3 top-3 flex gap-1.5">
                    {b.sponsored && <span className="rounded bg-white/90 px-1.5 py-0.5 text-2xs font-medium uppercase tracking-wide text-petrol-900">{display.data?.sponsoredLabel ?? 'Sponsorisé'}</span>}
                  </div>
                </div>
                <div className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <h3 className="font-medium text-fg">{b.title.fr}</h3>
                    {b.archivedAt ? <Badge size="sm" tone="neutral">Retirée</Badge> : !b.active ? <Badge size="sm" tone="neutral">Inactive</Badge> : expired ? <Badge size="sm" tone="neutral">Terminée</Badge> : upcoming ? <Badge size="sm" tone="info">Programmée</Badge> : <Badge size="sm" tone="success">En ligne</Badge>}
                  </div>
                  {b.body?.fr && <p className="mt-1 line-clamp-2 text-sm text-fg-muted" title={String(b.body.fr ?? '')}>{b.body.fr}</p>}
                  <div className="mt-3 flex flex-wrap items-center gap-1.5 text-xs text-fg-muted">
                    <Badge size="sm" tone={b.cityIds === null ? 'info' : 'brand'}>{b.cityIds === null ? 'Toutes les villes' : b.cityIds.map(cityName).join(', ')}</Badge>
                    {(b.startsAt || b.endsAt) && <Badge size="sm" tone="neutral" variant="outline" icon={<CalendarRange />}>{b.startsAt ? shortDay(millis(b.startsAt)) : '…'} → {b.endsAt ? shortDay(millis(b.endsAt)) : '…'}</Badge>}
                    {b.link && <span className="truncate">→ {LINK_LABELS[b.link.type]}</span>}
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}
      <BannerSheet key={editing === 'new' ? 'new' : (editing?.id ?? '')} banner={editing} onClose={() => setEditing(null)} nextOrder={data.length} />
    </PageContainer>
  );
}

function BannerSheet({ banner, onClose, nextOrder }: { banner: WithId<Banner> | 'new' | null; onClose: () => void; nextOrder: number }) {
  const { admin } = useAdminAccess();
  const { cities, cityId } = useWorkingCity();
  const existing = banner && banner !== 'new' ? banner : null;
  const [title, setTitle] = useState(existing?.title.fr ?? '');
  const [body, setBody] = useState(existing?.body?.fr ?? '');
  const [files, setFiles] = useState<File[]>([]);
  const [imageUrl, setImageUrl] = useState(existing?.image?.url ?? '');
  const [alt, setAlt] = useState(existing?.image?.alt ?? '');
  const [allCities, setAllCities] = useState(existing ? existing.cityIds === null : false);
  const [cityIds, setCityIds] = useState<string[]>(existing?.cityIds ?? (cityId ? [cityId] : []));
  const [linkType, setLinkType] = useState<LinkType | 'none'>(existing?.link?.type ?? 'none');
  const [linkTarget, setLinkTarget] = useState(existing?.link?.target ?? '');
  const [startsAt, setStartsAt] = useState<Date | undefined>(existing?.startsAt ? new Date(millis(existing.startsAt)) : undefined);
  const [endsAt, setEndsAt] = useState<Date | undefined>(existing?.endsAt ? new Date(millis(existing.endsAt)) : undefined);
  const [sponsored, setSponsored] = useState(existing?.sponsored ?? false);
  const [restaurantId, setRestaurantId] = useState(existing?.restaurantId ?? '');
  const [isActive, setIsActive] = useState(existing?.active ?? true);
  const [saving, setSaving] = useState(false);
  const restaurants = useCityRestaurants(allCities ? cityId : (cityIds[0] ?? cityId));
  const preview = useMemo(() => (files[0] ? URL.createObjectURL(files[0]) : imageUrl), [files, imageUrl]);

  const valid = title.trim().length >= 3 && (files.length > 0 || imageUrl) && (allCities || cityIds.length > 0) && (!sponsored || restaurantId) && (linkType === 'none' || linkTarget.trim()) && (linkType !== 'url' || /^https:\/\//.test(linkTarget.trim()));

  async function save(extra: Record<string, unknown> = {}) {
    setSaving(true);
    try {
      let image = existing?.image ?? null;
      if (files[0]) {
        const uploaded = await uploadPublicImage('banners', files[0]);
        image = { path: uploaded.path, url: uploaded.url, alt: alt.trim() || title.trim() };
      } else if (imageUrl && (!image || image.url !== imageUrl)) {
        image = { path: '', url: imageUrl, alt: alt.trim() || title.trim() };
      } else if (image) {
        image = { ...image, alt: alt.trim() || title.trim() };
      }
      const fields = {
        title: { fr: title.trim() },
        body: body.trim() ? { fr: body.trim() } : null,
        image,
        link: linkType === 'none' ? null : { type: linkType, target: linkTarget.trim() },
        cityIds: allCities ? null : cityIds,
        startsAt: startsAt ? toTimestamp(startsAt) : null,
        endsAt: endsAt ? toTimestamp(new Date(endsAt.getFullYear(), endsAt.getMonth(), endsAt.getDate(), 23, 59, 59)) : null,
        sponsored,
        restaurantId: sponsored ? restaurantId : null,
        active: isActive,
        ...extra,
      };
      if (existing) await updateDoc(doc(db, COLLECTIONS.banners, existing.id), { ...fields, ...updatedFields(admin.uid) });
      else await setDoc(doc(collection(db, COLLECTIONS.banners)), { ...fields, order: nextOrder, archivedAt: null, ...createdFields(admin.uid) });
      toast.success(extra.archivedAt ? 'Bannière retirée' : 'Bannière enregistrée');
      onClose();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet open={banner !== null} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full sm:max-w-xl">
        <SheetHeader title={existing ? 'Modifier la bannière' : 'Nouvelle bannière'} description="Format conseillé : 1600 × 700 px, texte lisible sur fond sombre." />
        <SheetBody className="space-y-4">
          {preview && (
            <div className="relative aspect-[16/7] overflow-hidden rounded-xl bg-surface-3">
              <img src={preview} alt="" className="size-full object-cover" />
              <div className="absolute inset-0 bg-gradient-to-t from-black/70 to-transparent" />
              <div className="absolute inset-x-4 bottom-3 text-white">
                {sponsored && <span className="mb-1 inline-block rounded bg-white/90 px-1.5 text-2xs font-medium uppercase text-petrol-900">Sponsorisé</span>}
                <p className="font-display text-lg font-semibold leading-tight">{title || 'Titre de la bannière'}</p>
                {body && <p className="text-xs text-white/80">{body}</p>}
              </div>
            </div>
          )}
          <FormField label="Image" hint="JPEG, PNG ou WebP, 5 Mo au maximum.">
            <FileUpload value={files} onChange={setFiles} accept="image/jpeg,image/png,image/webp" maxSize={5 * 1024 * 1024} maxFiles={1} onReject={(m) => toast.error(m)} />
          </FormField>
          {!files.length && (
            <FormField label="Ou adresse d’une image existante">
              <Input value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} placeholder="https://…" />
            </FormField>
          )}
          <FormField label="Texte alternatif" hint="Décrit l’image pour les lecteurs d’écran.">
            <Input value={alt} onChange={(e) => setAlt(e.target.value)} maxLength={120} />
          </FormField>
          <FormField label="Titre" required>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={60} />
          </FormField>
          <FormField label="Texte">
            <Textarea rows={2} value={body} onChange={(e) => setBody(e.target.value)} maxLength={120} />
          </FormField>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Lien">
              <Select value={linkType} onValueChange={(v) => setLinkType(v as LinkType | 'none')} options={[{ value: 'none', label: 'Aucun' }, ...(Object.keys(LINK_LABELS) as LinkType[]).map((t) => ({ value: t, label: LINK_LABELS[t] }))]} />
            </FormField>
            {linkType === 'restaurant' ? (
              <FormField label="Restaurant">
                <Select value={linkTarget} onValueChange={setLinkTarget} options={restaurants.data.map((r) => ({ value: r.id, label: r.name }))} placeholder="Choisir" />
              </FormField>
            ) : linkType !== 'none' ? (
              <FormField label={linkType === 'url' ? 'Adresse (https)' : linkType === 'page' ? 'Page (identifiant)' : 'Promotion (identifiant)'}>
                <Input value={linkTarget} onChange={(e) => setLinkTarget(e.target.value)} placeholder={linkType === 'url' ? 'https://' : ''} />
              </FormField>
            ) : null}
          </div>
          <FormField label="Villes">
            <div className="space-y-2">
              <Checkbox checked={allCities} onCheckedChange={(v) => setAllCities(v === true)} label="Toutes les villes" />
              {!allCities && <Combobox multiple value={cityIds} onChange={setCityIds} options={cities.map((c) => ({ value: c.id, label: c.name }))} placeholder="Choisir les villes" />}
            </div>
          </FormField>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Début"><DatePicker value={startsAt} onChange={setStartsAt} placeholder="Dès maintenant" /></FormField>
            <FormField label="Fin"><DatePicker value={endsAt} onChange={setEndsAt} placeholder="Sans fin" /></FormField>
          </div>
          <div className={cn('rounded-xl border border-border p-4', sponsored && 'tone-brand border-(--tone-border) bg-(--tone-bg)')}>
            <Switch checked={sponsored} onCheckedChange={setSponsored} label={<span className="flex items-center gap-2"><Megaphone className="size-4" />Bannière sponsorisée</span>} description="Payée par un commerce : la mention « Sponsorisé » est affichée (obligation légale)." />
            {sponsored && (
              <FormField label="Commerce annonceur" className="mt-3">
                <Select value={restaurantId} onValueChange={setRestaurantId} options={restaurants.data.map((r) => ({ value: r.id, label: r.name }))} placeholder="Choisir le commerce" />
              </FormField>
            )}
          </div>
          <Switch checked={isActive} onCheckedChange={setIsActive} label="Bannière active" />
        </SheetBody>
        <SheetFooter className={cn('flex-wrap', existing && 'justify-between')}>
          {existing && !existing.archivedAt && <Button variant="ghost" leftIcon={<Archive />} disabled={saving} onClick={() => void save({ active: false, archivedAt: serverTimestamp() })}>Retirer</Button>}
          {existing?.archivedAt && <Button variant="ghost" disabled={saving} onClick={() => void save({ archivedAt: null })}>Restaurer</Button>}
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose}>Annuler</Button>
            <Button variant="primary" loading={saving} disabled={!valid} onClick={() => void save()}>Enregistrer</Button>
          </div>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
