// Photos d'un produit : principale + galerie, ajout avec recadrage, ordre, retrait.
import { useRef, useState, type DragEvent } from 'react';
import { ArrowLeft, ArrowRight, ImagePlus, Star, Trash2 } from 'lucide-react';
import { MENU_LIMITS, type ImageRef } from '@golink/shared';
import { cn, IconButton, Spinner, toast } from '@golink/ui';
import { errorMessage } from '@/lib/firestore';
import { ImageCropDialog } from './ImageCropDialog';
import { ACCEPTED_IMAGE_TYPES, loadImage, uploadMenuImage, validateImageFile, type CropArea } from './images';

export function PhotoManager({
  photos,
  onChange,
  restaurantId,
  folder,
  alt,
  disabled,
}: {
  photos: ImageRef[];
  onChange: (photos: ImageRef[]) => void;
  restaurantId: string;
  folder: string;
  alt: string;
  disabled?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [queue, setQueue] = useState<File[]>([]);
  const [crop, setCrop] = useState<{ url: string; image: HTMLImageElement } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [over, setOver] = useState(false);
  const full = photos.length >= MENU_LIMITS.photos;

  async function openNext(files: File[]) {
    const [file, ...rest] = files;
    setQueue(rest);
    if (!file) return;
    const invalid = validateImageFile(file);
    if (invalid) {
      toast.error(invalid);
      return openNext(rest);
    }
    const url = URL.createObjectURL(file);
    try {
      setCrop({ url, image: await loadImage(url) });
    } catch (caught) {
      URL.revokeObjectURL(url);
      toast.error(errorMessage(caught));
      void openNext(rest);
    }
  }

  function pick(files: FileList | File[] | null) {
    if (!files || disabled) return;
    const list = [...files].slice(0, MENU_LIMITS.photos - photos.length);
    if (list.length === 0) {
      toast.error(`${MENU_LIMITS.photos} photos au maximum par produit.`);
      return;
    }
    void openNext(list);
  }

  async function confirm(area: CropArea) {
    if (!crop) return;
    setUploading(true);
    try {
      const ref = await uploadMenuImage(restaurantId, folder, crop.image, area, alt);
      onChange([...photos, ref]);
      URL.revokeObjectURL(crop.url);
      setCrop(null);
      void openNext(queue);
    } catch (caught) {
      toast.error(errorMessage(caught, 'L’envoi de la photo a échoué. Réessayez.'));
    } finally {
      setUploading(false);
    }
  }

  function move(index: number, to: number) {
    const next = [...photos];
    const [item] = next.splice(index, 1);
    next.splice(to, 0, item!);
    onChange(next);
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setOver(false);
    pick(event.dataTransfer.files);
  }

  return (
    <div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {photos.map((photo, index) => (
          <figure key={photo.url} className={cn('group relative overflow-hidden rounded-xl border bg-surface-3', index === 0 ? 'border-primary/60 col-span-2 row-span-2 sm:col-span-2' : 'border-border')}>
            <img src={index === 0 ? photo.url : photo.thumbUrl || photo.url} alt={index === 0 ? `Photo principale de ${alt}` : `Photo ${index + 1} de ${alt}`} className="aspect-[4/3] size-full object-cover" />
            {index === 0 && (
              <figcaption className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-full bg-black/60 px-2 py-0.5 text-2xs font-medium text-white">
                <Star className="size-3 fill-current" aria-hidden="true" /> Principale
              </figcaption>
            )}
            {!disabled && (
              <div className="absolute inset-x-2 bottom-2 flex justify-end gap-1 opacity-100 transition-opacity sm:opacity-0 sm:group-focus-within:opacity-100 sm:group-hover:opacity-100">
                {index > 0 && (
                  <IconButton label="Définir comme photo principale" size="xs" className="bg-elevated/95 shadow-sm" onClick={() => move(index, 0)}>
                    <Star />
                  </IconButton>
                )}
                {index > 1 && (
                  <IconButton label="Déplacer vers la gauche" size="xs" className="bg-elevated/95 shadow-sm" onClick={() => move(index, index - 1)}>
                    <ArrowLeft />
                  </IconButton>
                )}
                {index > 0 && index < photos.length - 1 && (
                  <IconButton label="Déplacer vers la droite" size="xs" className="bg-elevated/95 shadow-sm" onClick={() => move(index, index + 1)}>
                    <ArrowRight />
                  </IconButton>
                )}
                <IconButton label="Retirer la photo" size="xs" variant="danger" className="bg-elevated/95 shadow-sm" onClick={() => onChange(photos.filter((_, i) => i !== index))}>
                  <Trash2 />
                </IconButton>
              </div>
            )}
          </figure>
        ))}
        {!full && !disabled && (
          <div
            onDragOver={(event) => {
              event.preventDefault();
              setOver(true);
            }}
            onDragLeave={() => setOver(false)}
            onDrop={onDrop}
            className={cn(
              'relative flex aspect-[4/3] flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed text-center transition-colors',
              photos.length === 0 && 'col-span-2 row-span-2 sm:col-span-3 sm:aspect-[16/7]',
              over ? 'border-primary bg-primary-soft/60' : 'border-border-strong bg-surface-2 hover:border-fg-subtle',
            )}
          >
            {uploading ? (
              <Spinner />
            ) : (
              <button
                type="button"
                onClick={() => input.current?.click()}
                className="flex size-full flex-col items-center justify-center gap-1.5 rounded-xl px-3 text-sm text-fg-muted focus-visible:outline-2 focus-visible:outline-ring"
              >
                <ImagePlus className="size-5 text-fg-subtle" aria-hidden="true" />
                <span className="font-medium text-fg">{photos.length === 0 ? 'Ajoutez une première photo' : 'Ajouter'}</span>
                {photos.length === 0 && <span className="text-xs text-fg-subtle">Glissez-déposez ou parcourez · JPG, PNG, WebP</span>}
              </button>
            )}
          </div>
        )}
      </div>
      <input
        ref={input}
        type="file"
        multiple
        accept={ACCEPTED_IMAGE_TYPES}
        className="sr-only"
        aria-label="Ajouter des photos"
        onChange={(event) => {
          pick(event.target.files);
          event.target.value = '';
        }}
      />
      <p className="mt-2 text-xs text-fg-subtle">
        {photos.length}/{MENU_LIMITS.photos} photos · recadrées en 4:3 et compressées avant l’envoi. La première est affichée sur la carte.
      </p>
      <ImageCropDialog
        source={crop}
        onCancel={() => {
          if (crop) URL.revokeObjectURL(crop.url);
          setCrop(null);
          void openNext(queue);
        }}
        onConfirm={confirm}
      />
    </div>
  );
}
