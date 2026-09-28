import { useRef, useState, type ReactNode } from 'react';
import { updateDoc } from 'firebase/firestore';
import { ImageIcon, ImagePlus, Images, Trash2, Upload } from 'lucide-react';
import { Button, ConfirmDialog, IconButton, ProgressBar, cn, toast } from '@golink/ui';
import { paths, type ImageRef } from '@golink/shared';
import { useAuth } from '@golink/web';
import { useRestaurantAccess } from '@/auth/RestaurantAccess';
import { docAt, errorMessage, updatedFields } from '@/lib/firestore';
import { deletePublicImage, IMAGE_MAX_BYTES, readImageSize, uploadPublicImage } from '../parametres/kit/storage';
import { SettingsCard } from '../parametres/kit/ui';

const ACCEPT = 'image/jpeg,image/png,image/webp,image/avif';
const MAX_PHOTOS = 8;

type Slot = 'logo' | 'cover' | 'gallery';

const RULES: Record<Slot, { minWidth: number; minHeight: number; label: string }> = {
  logo: { minWidth: 256, minHeight: 256, label: 'Carré, 512 × 512 px conseillé' },
  cover: { minWidth: 1200, minHeight: 600, label: 'Paysage 16:9, 1600 × 900 px conseillé' },
  gallery: { minWidth: 800, minHeight: 600, label: '1200 px de large conseillé' },
};

/** Logo, photo de couverture et galerie : dépôt dans Storage puis mise à jour de la fiche. */
export function VisualsTab() {
  const { user } = useAuth();
  const { restaurant, restaurantId } = useRestaurantAccess();
  const [progress, setProgress] = useState<{ slot: Slot; ratio: number } | null>(null);
  const [removing, setRemoving] = useState<{ slot: Slot; image: ImageRef } | null>(null);

  const write = (fields: Partial<Pick<typeof restaurant, 'logo' | 'cover' | 'photos'>>) =>
    updateDoc(docAt(paths.restaurant(restaurantId)), { ...fields, ...updatedFields(user?.uid ?? '') });

  async function handleFile(slot: Slot, file: File) {
    if (!ACCEPT.split(',').includes(file.type)) {
      toast.error('Format non accepté : JPG, PNG, WEBP ou AVIF.');
      return;
    }
    if (file.size > IMAGE_MAX_BYTES) {
      toast.error('Image trop lourde : 5 Mo au plus.');
      return;
    }
    const { width, height } = await readImageSize(file);
    const rule = RULES[slot];
    if (width && (width < rule.minWidth || height < rule.minHeight)) {
      toast.error(`Image trop petite (${width} × ${height} px) : ${rule.minWidth} × ${rule.minHeight} px au minimum.`);
      return;
    }
    if (slot === 'logo' && width && Math.abs(width / height - 1) > 0.15) {
      toast.warning('Le logo sera recadré en carré : une image carrée donnera un meilleur rendu.');
    }
    setProgress({ slot, ratio: 0 });
    try {
      const image = await uploadPublicImage(restaurantId, slot, file, slot === 'logo' ? `Logo ${restaurant.name}` : restaurant.name, (ratio) =>
        setProgress({ slot, ratio }),
      );
      if (slot === 'gallery') {
        await write({ photos: [...(restaurant.photos ?? []), image].slice(0, MAX_PHOTOS) });
        toast.success('Photo ajoutée à la galerie.');
      } else {
        const previous = slot === 'logo' ? restaurant.logo : restaurant.cover;
        await write(slot === 'logo' ? { logo: image } : { cover: image });
        await deletePublicImage(restaurantId, previous);
        toast.success(slot === 'logo' ? 'Logo mis à jour.' : 'Photo de couverture mise à jour.');
      }
    } catch (error) {
      toast.error(errorMessage(error, 'Le dépôt de l’image a échoué. Réessayez.'));
    } finally {
      setProgress(null);
    }
  }

  async function confirmRemove() {
    if (!removing) return;
    const { slot, image } = removing;
    try {
      if (slot === 'gallery') await write({ photos: (restaurant.photos ?? []).filter((p) => p.url !== image.url) });
      else await write(slot === 'logo' ? { logo: null } : { cover: null });
      await deletePublicImage(restaurantId, image);
      toast.success('Image retirée.');
    } catch (error) {
      toast.error(errorMessage(error));
    }
  }

  const photos = restaurant.photos ?? [];

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]">
      <SettingsCard icon={<ImageIcon />} title="Logo" description={RULES.logo.label}>
        <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-center">
          <div className="grid size-28 shrink-0 place-items-center overflow-hidden rounded-2xl border border-border bg-surface-2 shadow-xs">
            {restaurant.logo ? (
              <img src={restaurant.logo.url} alt={restaurant.logo.alt ?? ''} className="size-full object-cover" />
            ) : (
              <span className="grid size-full place-items-center font-display text-2xl font-semibold text-white" style={{ backgroundColor: restaurant.accent }}>
                {restaurant.mark}
              </span>
            )}
          </div>
          <div className="flex w-full flex-col gap-2 sm:w-auto">
            <FilePick label={restaurant.logo ? 'Remplacer le logo' : 'Ajouter un logo'} onFile={(f) => void handleFile('logo', f)} busy={progress?.slot === 'logo'} />
            {restaurant.logo && (
              <Button variant="ghost" size="sm" leftIcon={<Trash2 />} onClick={() => setRemoving({ slot: 'logo', image: restaurant.logo! })}>
                Retirer
              </Button>
            )}
            <p className="text-xs text-fg-subtle">Sans logo, votre monogramme « {restaurant.mark} » est affiché.</p>
          </div>
        </div>
        {progress?.slot === 'logo' && <ProgressBar className="mt-4" value={progress.ratio * 100} label="Envoi en cours" valueLabel={`${Math.round(progress.ratio * 100)} %`} />}
      </SettingsCard>

      <SettingsCard icon={<ImageIcon />} title="Photo de couverture" description={RULES.cover.label}>
        <div className="relative aspect-[16/9] overflow-hidden rounded-xl border border-border bg-surface-2">
          {restaurant.cover ? (
            <img src={restaurant.cover.url} alt={restaurant.cover.alt ?? ''} className="size-full object-cover" />
          ) : (
            <div className="grid size-full place-items-center text-center text-sm text-fg-subtle">
              <span className="flex flex-col items-center gap-2">
                <ImagePlus className="size-6" />
                Aucune photo de couverture
              </span>
            </div>
          )}
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <FilePick label={restaurant.cover ? 'Remplacer la photo' : 'Ajouter une photo'} onFile={(f) => void handleFile('cover', f)} busy={progress?.slot === 'cover'} />
          {restaurant.cover && (
            <Button variant="ghost" size="sm" leftIcon={<Trash2 />} onClick={() => setRemoving({ slot: 'cover', image: restaurant.cover! })}>
              Retirer
            </Button>
          )}
        </div>
        {progress?.slot === 'cover' && <ProgressBar className="mt-4" value={progress.ratio * 100} label="Envoi en cours" valueLabel={`${Math.round(progress.ratio * 100)} %`} />}
      </SettingsCard>

      <SettingsCard
        className="lg:col-span-2"
        icon={<Images />}
        title="Galerie"
        description={`Jusqu’à ${MAX_PHOTOS} photos de vos plats et de votre salle. ${RULES.gallery.label}.`}
        actions={<span className="font-mono text-xs text-fg-subtle num">{photos.length} / {MAX_PHOTOS}</span>}
      >
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {photos.map((photo) => (
            <div key={photo.url} className="group relative aspect-[4/3] overflow-hidden rounded-xl border border-border bg-surface-2">
              <img src={photo.thumbUrl ?? photo.url} alt={photo.alt ?? ''} className="size-full object-cover" loading="lazy" />
              <IconButton
                label="Retirer cette photo"
                variant="secondary"
                size="sm"
                className="absolute right-2 top-2 opacity-100 shadow-md transition-opacity sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100"
                onClick={() => setRemoving({ slot: 'gallery', image: photo })}
              >
                <Trash2 />
              </IconButton>
            </div>
          ))}
          {photos.length < MAX_PHOTOS && (
            <FileTile onFile={(f) => void handleFile('gallery', f)} busy={progress?.slot === 'gallery'} ratio={progress?.slot === 'gallery' ? progress.ratio : 0} />
          )}
        </div>
      </SettingsCard>

      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => !open && setRemoving(null)}
        title={removing?.slot === 'logo' ? 'Retirer le logo ?' : removing?.slot === 'cover' ? 'Retirer la photo de couverture ?' : 'Retirer cette photo ?'}
        description="L’image disparaîtra de votre fiche dans l’app client."
        confirmLabel="Retirer"
        destructive
        onConfirm={confirmRemove}
      />
    </div>
  );
}

function FilePick({ label, onFile, busy }: { label: string; onFile: (file: File) => void; busy?: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={input}
        type="file"
        accept={ACCEPT}
        className="sr-only"
        tabIndex={-1}
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) onFile(file);
        }}
      />
      <Button variant="secondary" size="sm" leftIcon={<Upload />} loading={busy} onClick={() => input.current?.click()}>
        {label}
      </Button>
    </>
  );
}

function FileTile({ onFile, busy, ratio }: { onFile: (file: File) => void; busy?: boolean; ratio: number }): ReactNode {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={input}
        type="file"
        accept={ACCEPT}
        className="sr-only"
        tabIndex={-1}
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) onFile(file);
        }}
      />
      <button
        type="button"
        disabled={busy}
        onClick={() => input.current?.click()}
        className={cn(
          'flex aspect-[4/3] flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border-strong bg-surface-2 text-sm text-fg-muted transition-colors',
          'hover:border-primary/60 hover:bg-primary-soft/30 hover:text-fg focus-visible:outline-2 focus-visible:outline-ring',
        )}
      >
        <ImagePlus className="size-5" />
        {busy ? <span className="font-mono text-xs num">{Math.round(ratio * 100)} %</span> : 'Ajouter une photo'}
      </button>
    </>
  );
}
