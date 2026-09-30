// Fenêtres secondaires de la carte : suppression d'une section, déplacement de produits.
import { useEffect, useState } from 'react';
import { FolderInput, Trash2 } from 'lucide-react';
import { Button, Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, RadioGroup, Select } from '@golink/ui';
import type { Section } from '../menu/data';
import { plural } from '../menu/helpers';

export function DeleteSectionDialog({
  section,
  productCount,
  onOpenChange,
  onConfirm,
}: {
  section: Section | null;
  productCount: number;
  onOpenChange: (open: boolean) => void;
  onConfirm: (withProducts: boolean) => Promise<void>;
}) {
  const [mode, setMode] = useState<'keep' | 'delete'>('keep');
  const [pending, setPending] = useState(false);
  useEffect(() => setMode('keep'), [section]);

  async function confirm() {
    setPending(true);
    try {
      await onConfirm(mode === 'delete');
      onOpenChange(false);
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={Boolean(section)} onOpenChange={(open) => !pending && onOpenChange(open)}>
      <DialogContent size="sm">
        <DialogHeader
          icon={<Trash2 className="text-danger" />}
          title={`Supprimer « ${section?.name ?? ''} » ?`}
          description="La section part dans la corbeille : vous pourrez la restaurer pendant le délai réglé par la plateforme."
        />
        <DialogBody>
          {productCount > 0 ? (
            <RadioGroup
              variant="cards"
              value={mode}
              onValueChange={(value) => setMode(value as 'keep' | 'delete')}
              options={[
                {
                  value: 'keep',
                  label: 'Conserver les produits',
                  description: `${plural(productCount, 'produit')} ${productCount > 1 ? 'rejoindront' : 'rejoindra'} « Sans section », à ranger ensuite dans une autre section.`,
                },
                { value: 'delete', label: 'Supprimer aussi les produits', description: 'Ils partent dans la corbeille avec la section.' },
              ]}
            />
          ) : (
            <p className="text-sm text-fg-muted">Cette section ne contient aucun produit.</p>
          )}
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={pending}>
            Annuler
          </Button>
          <Button variant="danger" loading={pending} onClick={() => void confirm()}>
            Supprimer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function MoveProductsDialog({
  open,
  count,
  sections,
  onOpenChange,
  onConfirm,
}: {
  open: boolean;
  count: number;
  sections: Section[];
  onOpenChange: (open: boolean) => void;
  onConfirm: (sectionId: string | null) => Promise<void>;
}) {
  const [target, setTarget] = useState<string>('');
  const [pending, setPending] = useState(false);
  useEffect(() => {
    if (open) setTarget(sections[0]?.id ?? '__none');
  }, [open, sections]);

  async function confirm() {
    setPending(true);
    try {
      await onConfirm(target === '__none' ? null : target);
      onOpenChange(false);
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !pending && onOpenChange(next)}>
      <DialogContent size="sm">
        <DialogHeader icon={<FolderInput />} title="Changer de section" description={count > 1 ? `Les ${count} produits sélectionnés seront placés en fin de section.` : 'Le produit sélectionné sera placé en fin de section.'} />
        <DialogBody>
          <label className="mb-1.5 block text-sm font-medium text-fg" htmlFor="move-target">
            Section de destination
          </label>
          <Select
            id="move-target"
            value={target}
            onValueChange={setTarget}
            options={[...sections.map((s) => ({ value: s.id, label: s.name })), { value: '__none', label: 'Sans section' }]}
          />
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={pending}>
            Annuler
          </Button>
          <Button variant="primary" loading={pending} onClick={() => void confirm()}>
            Déplacer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
