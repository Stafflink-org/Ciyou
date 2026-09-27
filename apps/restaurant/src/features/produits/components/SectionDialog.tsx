// Création et modification d'une section : nom (unique), description, visuel,
// visibilité, masquage des noms, créneaux de disponibilité.
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ImagePlus, LayoutList, Trash2 } from 'lucide-react';
import { MENU_LIMITS, type ImageRef, type MenuSchedule } from '@golink/shared';
import { Button, Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, FormField, Input, Switch, Textarea, toast } from '@golink/ui';
import { useAuth } from '@golink/web';
import { errorMessage } from '@/lib/firestore';
import { createSection, updateSection, type Section } from '../menu/data';
import { sectionNameTaken } from '../menu/helpers';
import { ImageCropDialog } from '../menu/ImageCropDialog';
import { loadImage, uploadMenuImage, validateImageFile, ACCEPTED_IMAGE_TYPES, type CropArea } from '../menu/images';
import { ScheduleEditor } from '../menu/ui';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  restaurantId: string;
  sections: Section[];
  /** Section modifiée ; null = création. */
  section: Section | null;
}

export function SectionDialog({ open, onOpenChange, restaurantId, sections, section }: Props) {
  const { user } = useAuth();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [hideNames, setHideNames] = useState(false);
  const [schedule, setSchedule] = useState<MenuSchedule | null>(null);
  const [image, setImage] = useState<ImageRef | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [crop, setCrop] = useState<{ url: string; image: HTMLImageElement } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setName(section?.name ?? '');
    setDescription(section?.description ?? '');
    setEnabled(section?.enabled ?? true);
    setHideNames(section?.hideProductNames ?? false);
    setSchedule(section?.availability ?? null);
    setImage(section?.image ?? null);
    setError(null);
  }, [open, section]);

  async function pickFile(file: File | undefined) {
    if (!file) return;
    const invalid = validateImageFile(file);
    if (invalid) {
      toast.error(invalid);
      return;
    }
    const url = URL.createObjectURL(file);
    try {
      setCrop({ url, image: await loadImage(url) });
    } catch (caught) {
      URL.revokeObjectURL(url);
      toast.error(errorMessage(caught));
    }
  }

  async function confirmCrop(area: CropArea) {
    if (!crop) return;
    try {
      const ref = await uploadMenuImage(restaurantId, `sections/${section?.id ?? 'nouvelles'}`, crop.image, area, name || 'Section');
      setImage(ref);
      URL.revokeObjectURL(crop.url);
      setCrop(null);
    } catch (caught) {
      toast.error(errorMessage(caught, 'L’envoi de la photo a échoué. Réessayez.'));
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return setError('Donnez un nom à la section.');
    if (sectionNameTaken(trimmed, sections, section?.id)) return setError('Une section porte déjà ce nom.');
    if (schedule && (schedule.days.length === 0 || schedule.from >= schedule.to))
      return setError('Choisissez au moins un jour et une heure de fin postérieure à l’heure de début.');
    if (!user) return;
    setSaving(true);
    try {
      const input = {
        name: trimmed,
        description: description.trim() || null,
        image,
        enabled,
        hideProductNames: hideNames,
        availability: schedule,
      };
      if (section) {
        await updateSection(restaurantId, user.uid, section.id, input);
        toast.success('Section enregistrée');
      } else {
        const order = sections.reduce((max, s) => Math.max(max, s.order), -1) + 1;
        await createSection(restaurantId, user.uid, input, order);
        toast.success('Section créée');
      }
      onOpenChange(false);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={(next) => !saving && onOpenChange(next)}>
        <DialogContent size="lg">
          <form onSubmit={(event) => void submit(event)} className="flex min-h-0 flex-1 flex-col">
            <DialogHeader
              icon={<LayoutList />}
              title={section ? 'Modifier la section' : 'Nouvelle section'}
              description="Les sections organisent la carte que voient vos clients dans l’app GoLink."
            />
            <DialogBody className="space-y-5">
              <div className="flex flex-col gap-5 sm:flex-row">
                <div className="shrink-0 sm:w-44">
                  <p className="mb-1.5 text-sm font-medium text-fg">Visuel</p>
                  <div className="relative aspect-[4/3] w-full overflow-hidden rounded-xl border border-dashed border-border-strong bg-surface-2">
                    {image ? (
                      <img src={image.thumbUrl || image.url} alt="Visuel de la section" className="size-full object-cover" />
                    ) : (
                      <button
                        type="button"
                        onClick={() => fileInput.current?.click()}
                        className="flex size-full flex-col items-center justify-center gap-1.5 text-xs text-fg-subtle hover:text-fg focus-visible:outline-2 focus-visible:outline-ring"
                      >
                        <ImagePlus className="size-5" aria-hidden="true" />
                        Ajouter un visuel
                      </button>
                    )}
                  </div>
                  <div className="mt-2 flex gap-1.5">
                    <Button type="button" size="xs" variant="secondary" onClick={() => fileInput.current?.click()}>
                      {image ? 'Changer' : 'Choisir…'}
                    </Button>
                    {image && (
                      <Button type="button" size="xs" variant="ghost" leftIcon={<Trash2 />} onClick={() => setImage(null)}>
                        Retirer
                      </Button>
                    )}
                  </div>
                  <input
                    ref={fileInput}
                    type="file"
                    accept={ACCEPTED_IMAGE_TYPES}
                    className="sr-only"
                    aria-label="Choisir le visuel de la section"
                    onChange={(event) => {
                      void pickFile(event.target.files?.[0]);
                      event.target.value = '';
                    }}
                  />
                </div>
                <div className="min-w-0 flex-1 space-y-4">
                  <FormField label="Nom de la section" required aside={<span className="num text-2xs text-fg-subtle">{name.length}/{MENU_LIMITS.sectionName}</span>}>
                    <Input
                      autoFocus
                      value={name}
                      maxLength={MENU_LIMITS.sectionName}
                      onChange={(event) => {
                        setName(event.target.value);
                        setError(null);
                      }}
                      placeholder="Ex. Nos incontournables"
                    />
                  </FormField>
                  <FormField label="Description" hint="Affichée sous le titre de la section dans l’app client.">
                    <Textarea
                      rows={3}
                      value={description}
                      maxLength={MENU_LIMITS.sectionDescription}
                      onChange={(event) => setDescription(event.target.value)}
                      placeholder="Quelques mots pour présenter cette section…"
                    />
                  </FormField>
                </div>
              </div>

              <div className="space-y-4 rounded-xl border border-border p-4">
                <Switch label="Section visible" description="Désactivée, la section et ses produits sont masqués aux clients." checked={enabled} onCheckedChange={setEnabled} />
                <div className="h-px bg-border" />
                <Switch
                  label="Masquer les noms des produits"
                  description="Les photos et les prix restent visibles (utile pour une vitrine de desserts, par exemple)."
                  checked={hideNames}
                  onCheckedChange={setHideNames}
                />
              </div>

              <div>
                <p className="mb-2 text-sm font-medium text-fg">Disponibilité</p>
                <ScheduleEditor value={schedule} onChange={setSchedule} />
              </div>

              {error && (
                <p role="alert" className="tone-danger rounded-lg bg-(--tone-bg) px-3 py-2 text-sm text-(--tone-fg)">
                  {error}
                </p>
              )}
            </DialogBody>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>
                Annuler
              </Button>
              <Button type="submit" variant="primary" loading={saving}>
                {section ? 'Enregistrer' : 'Créer la section'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <ImageCropDialog
        source={crop}
        onCancel={() => {
          if (crop) URL.revokeObjectURL(crop.url);
          setCrop(null);
        }}
        onConfirm={confirmCrop}
        title="Recadrer le visuel de la section"
      />
    </>
  );
}
