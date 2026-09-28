// Ajustement d'un article vendu au poids ou à prix variable, à la préparation (cahier
// weight-based-pricing) : le commerce entre le poids réellement pesé (article `weight`) ou fixe
// le prix final (article `variable`, plafonné au prix maximal indiqué à la commande). Le client
// ne paie jamais plus que le montant autorisé : un écart à la baisse est remboursé automatiquement.
// Fonction : adjustOrderItemWeight.
import { useState } from 'react';
import { Scale } from 'lucide-react';
import { Badge, Button, Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, Input, formatEUR, toast } from '@golink/ui';
import type { OrderItem } from '@golink/shared';
import { useCan } from '@/auth/RestaurantAccess';
import { callFunction, errorMessage } from '@/lib/firestore';
import type { OrderRow } from '../lib';

interface AdjustInput {
  orderId: string;
  lineId: string;
  actualWeightGrams?: number;
  actualPriceCents?: number;
}
interface AdjustResult {
  finalTotalCents: number;
  refundCents: number;
}

const adjustOrderItemWeight = callFunction<AdjustInput, AdjustResult>('adjustOrderItemWeight');
const eur = (cents: number) => formatEUR(cents);

/** Article déjà pesé ou dont le prix final a été fixé : pastille informative. */
export function WeightAdjustmentBadge({ item }: { item: OrderItem }) {
  if (item.finalTotalCents == null) return null;
  if (item.saleUnit === 'weight' && item.actualWeightGrams != null) {
    return (
      <Badge tone="teal" size="sm">
        Pesé : {item.actualWeightGrams} g · {eur(item.finalTotalCents)}
      </Badge>
    );
  }
  return (
    <Badge tone="teal" size="sm">
      Prix final : {eur(item.finalTotalCents)}
    </Badge>
  );
}

/** Bouton « Peser / Confirmer le prix » d'une ligne vendue au poids ou à prix variable. */
export function AdjustWeightButton({ order, item }: { order: OrderRow; item: OrderItem }) {
  const can = useCan();
  const [open, setOpen] = useState(false);
  const adjustable =
    (item.saleUnit === 'weight' || item.saleUnit === 'variable') &&
    (order.status === 'accepted' || order.status === 'preparing') &&
    !item.adjustment &&
    item.finalTotalCents == null;
  if (!adjustable || !can('orders.manage')) return null;
  return (
    <>
      <Button size="xs" variant="ghost" leftIcon={<Scale />} onClick={() => setOpen(true)}>
        {item.saleUnit === 'weight' ? 'Peser' : 'Confirmer le prix'}
      </Button>
      {open && <AdjustDialog order={order} item={item} onClose={() => setOpen(false)} />}
    </>
  );
}

function AdjustDialog({ order, item, onClose }: { order: OrderRow; item: OrderItem; onClose: () => void }) {
  const isWeight = item.saleUnit === 'weight';
  const [grams, setGrams] = useState(item.weightGrams ? String(item.weightGrams) : '');
  const [price, setPrice] = useState('');
  const [loading, setLoading] = useState(false);
  const gramsValue = Number(grams);
  const priceCentsValue = price ? Math.round(Number(price.replace(',', '.')) * 100) : NaN;
  const valid = isWeight ? Number.isFinite(gramsValue) && gramsValue > 0 : Number.isFinite(priceCentsValue) && priceCentsValue >= 0;

  async function submit() {
    setLoading(true);
    try {
      const result = await adjustOrderItemWeight({
        orderId: order.id,
        lineId: item.lineId,
        ...(isWeight ? { actualWeightGrams: gramsValue } : { actualPriceCents: priceCentsValue }),
      });
      toast.success(
        result.refundCents > 0
          ? `Prix confirmé : ${eur(result.finalTotalCents)} · ${eur(result.refundCents)} remboursés au client.`
          : `Prix confirmé : ${eur(result.finalTotalCents)}.`,
      );
      onClose();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="sm">
        <DialogHeader
          title={isWeight ? `Peser « ${item.name} »` : `Confirmer le prix de « ${item.name} »`}
          description={`Commande ${order.number} · prix indicatif autorisé : ${eur(item.unitPriceCents * item.quantity + item.optionsPriceCents * item.quantity)}`}
          icon={<Scale />}
        />
        <DialogBody className="space-y-4">
          {isWeight ? (
            <div>
              <label htmlFor="actual-grams" className="mb-1 block text-sm font-medium text-fg">
                Poids réellement pesé (grammes)
              </label>
              <Input id="actual-grams" type="number" min={1} inputMode="numeric" value={grams} onChange={(e) => setGrams(e.target.value)} placeholder="Ex. 480" autoFocus />
              {isWeight && Number.isFinite(gramsValue) && gramsValue > 0 && item.pricePerKgCents != null && (
                <p className="mt-1.5 text-xs text-fg-subtle">Prix calculé : {eur(Math.round((item.pricePerKgCents * gramsValue) / 1000) * item.quantity)}</p>
              )}
            </div>
          ) : (
            <div>
              <label htmlFor="actual-price" className="mb-1 block text-sm font-medium text-fg">
                Prix final (€)
              </label>
              <Input id="actual-price" type="text" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="Ex. 8,50" autoFocus />
            </div>
          )}
          <p className="text-xs text-fg-subtle">
            Le client ne paie jamais plus que le montant indiqué à la commande : si le montant réel est inférieur, la différence est remboursée
            automatiquement.
          </p>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Annuler
          </Button>
          <Button variant="primary" loading={loading} disabled={!valid} leftIcon={<Scale />} onClick={() => void submit()}>
            Confirmer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
