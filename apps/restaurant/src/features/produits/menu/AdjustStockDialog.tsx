// Ajustement de stock d'un produit : réception, perte, inventaire ou correction,
// avec motif et note (historisés par la Cloud Function adjustStock).
import { useEffect, useState, type FormEvent } from 'react';
import { ArrowRight, PackagePlus } from 'lucide-react';
import { MANUAL_STOCK_REASONS, STOCK_MOVEMENT_REASON_LABELS, type ManualStockReason } from '@golink/shared';
import { Button, cn, Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, FormField, Input, SegmentedControl, Select, toast } from '@golink/ui';
import { errorMessage } from '@/lib/firestore';
import { menuFunctions, type MenuProduct } from './data';

type Mode = 'add' | 'remove' | 'set';

const DEFAULT_REASON: Record<Mode, ManualStockReason> = { add: 'reception', remove: 'waste', set: 'inventory' };

export function AdjustStockDialog({
  product,
  restaurantId,
  onOpenChange,
  initialMode = 'add',
}: {
  product: MenuProduct | null;
  restaurantId: string;
  onOpenChange: (open: boolean) => void;
  initialMode?: Mode;
}) {
  const [mode, setMode] = useState<Mode>(initialMode);
  const [quantity, setQuantity] = useState('');
  const [reason, setReason] = useState<ManualStockReason>(DEFAULT_REASON[initialMode]);
  const [note, setNote] = useState('');
  const [threshold, setThreshold] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!product) return;
    setMode(initialMode);
    setReason(DEFAULT_REASON[initialMode]);
    setQuantity('');
    setNote('');
    setThreshold(String(product.lowStockThreshold ?? 5));
    setError(null);
  }, [product, initialMode]);

  const tracked = product?.stock !== null && product?.stock !== undefined;
  const current = product?.stock ?? 0;
  const value = /^\d+$/.test(quantity) ? Number(quantity) : null;
  const next = value === null ? null : mode === 'add' ? current + value : mode === 'remove' ? current - value : value;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!product) return;
    if (value === null || (mode !== 'set' && value === 0)) return setError('Indiquez une quantité (nombre entier).');
    if (next !== null && next < 0) return setError(`Impossible de retirer plus que le stock actuel (${current}).`);
    const lowStockThreshold = /^\d+$/.test(threshold) ? Number(threshold) : undefined;
    setSaving(true);
    try {
      await menuFunctions.adjustStock({
        restaurantId,
        reason,
        note: note.trim() || undefined,
        items: [{ productId: product.id, mode: tracked ? mode : 'set', quantity: value, lowStockThreshold }],
      });
      toast.success(`Stock de « ${product.name} » : ${next}`);
      onOpenChange(false);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={Boolean(product)} onOpenChange={(open) => !saving && onOpenChange(open)}>
      <DialogContent size="sm">
        <form onSubmit={(event) => void submit(event)} className="flex min-h-0 flex-1 flex-col">
          <DialogHeader icon={<PackagePlus />} title="Ajuster le stock" description={product?.name} />
          <DialogBody className="space-y-4">
            {tracked ? (
              <SegmentedControl
                aria-label="Type d’ajustement"
                value={mode}
                onValueChange={(v) => {
                  setMode(v as Mode);
                  setReason(DEFAULT_REASON[v as Mode]);
                  setError(null);
                }}
                options={[
                  { value: 'add', label: 'Ajouter' },
                  { value: 'remove', label: 'Retirer' },
                  { value: 'set', label: 'Compter' },
                ]}
                className="w-full"
              />
            ) : (
              <p className="rounded-lg bg-surface-2 px-3 py-2 text-sm text-fg-muted">
                Le stock de ce produit n’est pas encore suivi : indiquez la quantité disponible pour activer le suivi.
              </p>
            )}
            <div className="grid grid-cols-2 gap-3">
              <FormField label={mode === 'set' || !tracked ? 'Quantité comptée' : 'Quantité'} required>
                <Input
                  autoFocus
                  inputMode="numeric"
                  value={quantity}
                  onChange={(event) => {
                    setQuantity(event.target.value.replace(/[^\d]/g, '').slice(0, 5));
                    setError(null);
                  }}
                  placeholder="0"
                />
              </FormField>
              <FormField label="Motif">
                <Select value={reason} onValueChange={(v) => setReason(v as ManualStockReason)} options={MANUAL_STOCK_REASONS.map((r) => ({ value: r, label: STOCK_MOVEMENT_REASON_LABELS[r] }))} />
              </FormField>
            </div>
            <div className="flex items-center justify-between rounded-xl border border-border bg-surface-2 px-4 py-3">
              <div>
                <p className="text-xs text-fg-muted">Stock actuel</p>
                <p className="num font-display text-xl font-semibold text-fg">{tracked ? current : '—'}</p>
              </div>
              <ArrowRight className="size-4 text-fg-subtle" aria-hidden="true" />
              <div className="text-right">
                <p className="text-xs text-fg-muted">Après ajustement</p>
                <p className={cn('num font-display text-xl font-semibold', next !== null && next < 0 ? 'text-danger' : 'text-fg')}>{next ?? '—'}</p>
              </div>
            </div>
            <div className="grid grid-cols-[1fr_7rem] gap-3">
              <FormField label="Note" hint="Visible dans l’historique des mouvements.">
                <Input value={note} maxLength={240} onChange={(event) => setNote(event.target.value)} placeholder="Ex. livraison Metro, bon n° 4521" />
              </FormField>
              <FormField label="Seuil d’alerte">
                <Input inputMode="numeric" value={threshold} onChange={(event) => setThreshold(event.target.value.replace(/[^\d]/g, '').slice(0, 4))} />
              </FormField>
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
              Enregistrer l’ajustement
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
