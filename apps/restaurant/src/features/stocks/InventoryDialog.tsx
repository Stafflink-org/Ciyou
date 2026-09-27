// Inventaire : saisie des quantités comptées pour tous les produits suivis, écarts
// calculés en direct, validation en une fois (mouvements « Inventaire » historisés).
import { useEffect, useMemo, useState } from 'react';
import { ClipboardCheck, Search } from 'lucide-react';
import { Button, cn, Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, Input, toast } from '@golink/ui';
import { errorMessage } from '@/lib/firestore';
import { menuFunctions, type MenuProduct } from '../produits/menu/data';
import { matches, plural } from '../produits/menu/helpers';

export function InventoryDialog({ open, onOpenChange, restaurantId, products }: { open: boolean; onOpenChange: (open: boolean) => void; restaurantId: string; products: MenuProduct[] }) {
  const tracked = useMemo(() => products.filter((p) => p.stock !== null), [products]);
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [search, setSearch] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setCounts({});
      setSearch('');
      setNote('');
    }
  }, [open]);

  const changes = tracked
    .map((p) => ({ product: p, value: counts[p.id] }))
    .filter((c): c is { product: MenuProduct; value: string } => c.value !== undefined && c.value !== '' && Number(c.value) !== c.product.stock);
  const counted = tracked.filter((p) => counts[p.id] !== undefined && counts[p.id] !== '').length;
  const visible = tracked.filter((p) => matches(search, p.name));

  async function submit() {
    if (changes.length === 0) {
      onOpenChange(false);
      return;
    }
    setSaving(true);
    try {
      for (let i = 0; i < changes.length; i += 200) {
        await menuFunctions.adjustStock({
          restaurantId,
          reason: 'inventory',
          note: note.trim() || 'Inventaire',
          items: changes.slice(i, i + 200).map((c) => ({ productId: c.product.id, mode: 'set', quantity: Number(c.value) })),
        });
      }
      toast.success(`Inventaire validé : ${plural(changes.length, 'stock corrigé', 'stocks corrigés')}`);
      onOpenChange(false);
    } catch (caught) {
      toast.error(errorMessage(caught));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !saving && onOpenChange(next)}>
      <DialogContent size="lg">
        <DialogHeader
          icon={<ClipboardCheck />}
          title="Faire l’inventaire"
          description="Saisissez les quantités comptées ; laissez vide ce que vous n’avez pas compté. Seuls les écarts sont enregistrés."
        />
        <DialogBody className="space-y-3">
          <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Rechercher un produit…" leading={<Search />} aria-label="Rechercher un produit" />
          {tracked.length === 0 ? (
            <p className="rounded-lg bg-surface-2 px-3 py-6 text-center text-sm text-fg-muted">Aucun produit n’a de stock suivi. Activez le suivi depuis la fiche produit ou la liste des stocks.</p>
          ) : (
            <div className="overflow-hidden rounded-xl border border-border">
              <div className="grid grid-cols-[1fr_4.5rem_5.5rem_4rem] items-center gap-2 border-b border-border bg-surface-2 px-3 py-2 font-mono text-3xs uppercase tracking-eyebrow text-fg-subtle">
                <span>Produit</span>
                <span className="text-right">Théorique</span>
                <span className="text-right">Compté</span>
                <span className="text-right">Écart</span>
              </div>
              <ul className="max-h-[50dvh] divide-y divide-border overflow-y-auto">
                {visible.map((product) => {
                  const value = counts[product.id] ?? '';
                  const diff = value === '' ? null : Number(value) - (product.stock ?? 0);
                  return (
                    <li key={product.id} className="grid grid-cols-[1fr_4.5rem_5.5rem_4rem] items-center gap-2 px-3 py-1.5">
                      <span className="truncate text-sm text-fg">{product.name}</span>
                      <span className="num text-right font-mono text-sm text-fg-muted">{product.stock}</span>
                      <Input
                        size="sm"
                        inputMode="numeric"
                        aria-label={`Quantité comptée de ${product.name}`}
                        value={value}
                        onChange={(event) => setCounts((current) => ({ ...current, [product.id]: event.target.value.replace(/[^\d]/g, '').slice(0, 5) }))}
                        className="text-right"
                        placeholder="—"
                      />
                      <span className={cn('num text-right font-mono text-sm', diff === null || diff === 0 ? 'text-fg-subtle' : diff > 0 ? 'text-success' : 'text-danger')}>
                        {diff === null ? '' : diff > 0 ? `+${diff}` : diff === 0 ? '=' : `−${Math.abs(diff)}`}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
          <Input value={note} onChange={(event) => setNote(event.target.value)} maxLength={240} placeholder="Note (facultatif) : ex. inventaire de fin de mois" aria-label="Note d’inventaire" />
        </DialogBody>
        <DialogFooter className="sm:justify-between">
          <p className="text-sm text-fg-muted">
            {counted} / {tracked.length} comptés · {plural(changes.length, 'écart', 'écarts')}
          </p>
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>
              Annuler
            </Button>
            <Button variant="primary" loading={saving} onClick={() => void submit()} disabled={counted === 0}>
              Valider l’inventaire
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
