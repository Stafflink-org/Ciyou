// Article indisponible en cours de préparation : le commerce propose un remplacement au client
// (délai réglé par la ville) ou retire l'article, remboursé au prorata. Sans réponse du client,
// l'article est retiré automatiquement. Fonctions : reportItemUnavailable, respondToItemProposal.
import { useMemo, useState } from 'react';
import { orderBy, query, where } from 'firebase/firestore';
import { PackageX, Replace } from 'lucide-react';
import { Badge, Button, Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, RadioGroup, Select, formatEUR, toast } from '@golink/ui';
import { paths, type OrderItem, type Product, type WithId } from '@golink/shared';
import { useCan, useRestaurantAccess } from '@/auth/RestaurantAccess';
import { callFunction, collectionAt, errorMessage, toMillis, useCollection } from '@/lib/firestore';
import type { OrderRow } from '../lib';

interface ReportInput {
  orderId: string;
  lineId: string;
  replacementProductId?: string | null;
}
interface ReportResult {
  status: 'proposed' | 'removed' | 'order_cancelled';
  expiresAt: number | null;
  refundCents: number;
}

const reportItemUnavailable = callFunction<ReportInput, ReportResult>('reportItemUnavailable');
const eur = (cents: number) => formatEUR(cents);

/** Statut d'une ligne : retirée, remplacée ou remplacement en attente de réponse. */
export function ItemAdjustmentBadge({ order, item }: { order: OrderRow; item: OrderItem }) {
  const proposal = order.itemProposals?.[item.lineId];
  if (item.adjustment?.type === 'removed') return <Badge tone="danger" size="sm">Retiré · {eur(item.adjustment.refundCents)} remboursés</Badge>;
  if (item.adjustment?.type === 'replaced') return <Badge tone="teal" size="sm">Remplacé par {item.adjustment.replacementName}</Badge>;
  if (proposal?.status === 'pending') {
    const minutes = Math.max(0, Math.ceil(((toMillis(proposal.expiresAt) ?? Date.now()) - Date.now()) / 60_000));
    return <Badge tone="amber" size="sm">Remplacement proposé : {proposal.replacementName} · réponse sous {minutes} min</Badge>;
  }
  return null;
}

/** Bouton « Indisponible » d'une ligne et fenêtre de choix (retrait ou remplacement). */
export function ItemUnavailableButton({ order, item }: { order: OrderRow; item: OrderItem }) {
  const can = useCan();
  const [open, setOpen] = useState(false);
  const adjustable = (order.status === 'accepted' || order.status === 'preparing') && !item.adjustment && order.itemProposals?.[item.lineId]?.status !== 'pending';
  if (!adjustable || !can('orders.manage')) return null;
  return (
    <>
      <Button size="xs" variant="ghost" leftIcon={<PackageX />} onClick={() => setOpen(true)}>
        Indisponible
      </Button>
      {open && <UnavailableDialog order={order} item={item} onClose={() => setOpen(false)} />}
    </>
  );
}

function UnavailableDialog({ order, item, onClose }: { order: OrderRow; item: OrderItem; onClose: () => void }) {
  const { restaurantId } = useRestaurantAccess();
  const [mode, setMode] = useState<'remove' | 'replace'>('remove');
  const [productId, setProductId] = useState('');
  const [loading, setLoading] = useState(false);
  const productsQuery = useMemo(() => (restaurantId ? query(collectionAt(paths.restaurantSub(restaurantId, 'products')), where('available', '==', true), orderBy('name'), ) : null), [restaurantId]);
  const products = useCollection<Product>(productsQuery);
  const candidates = (products.data as Array<WithId<Product>>).filter((p) => p.id !== item.productId && !p.containsAlcohol);

  async function submit() {
    setLoading(true);
    try {
      const result = await reportItemUnavailable({ orderId: order.id, lineId: item.lineId, replacementProductId: mode === 'replace' ? productId : null });
      if (result.status === 'proposed') toast.success('Remplacement proposé au client : il répond dans le délai réglé, sinon l’article est retiré.');
      else if (result.status === 'order_cancelled') toast.success('Plus aucun article à servir : la commande est annulée et le client remboursé.');
      else toast.success(`Article retiré : ${eur(result.refundCents)} remboursés au client.`);
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
        <DialogHeader title={`« ${item.name} » est indisponible`} description={`Commande ${order.number} · ${item.quantity} × ${eur(item.unitPriceCents)}`} icon={<PackageX />} />
        <DialogBody className="space-y-4">
          <RadioGroup
            value={mode}
            onValueChange={(v) => setMode(v as 'remove' | 'replace')}
            options={[
              { value: 'remove', label: 'Retirer l’article', description: 'Le client est remboursé au prorata de cet article.' },
              { value: 'replace', label: 'Proposer un remplacement', description: 'Le client accepte ou refuse dans le délai réglé ; il ne paie jamais plus cher.' },
            ]}
          />
          {mode === 'replace' && (
            <Select
              value={productId}
              onValueChange={setProductId}
              placeholder={products.loading ? 'Chargement…' : 'Choisir un produit disponible'}
              options={candidates.map((p) => ({ value: p.id, label: `${p.name} · ${eur(p.priceCents)}` }))}
              aria-label="Produit de remplacement"
            />
          )}
          <p className="text-xs text-fg-subtle">Le produit sera aussi retiré de la vente tant que vous ne l’avez pas remis en stock.</p>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Annuler
          </Button>
          <Button variant="primary" loading={loading} disabled={mode === 'replace' && !productId} leftIcon={mode === 'replace' ? <Replace /> : <PackageX />} onClick={() => void submit()}>
            {mode === 'replace' ? 'Proposer' : 'Retirer et rembourser'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
