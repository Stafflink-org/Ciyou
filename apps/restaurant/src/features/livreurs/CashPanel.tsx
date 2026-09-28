import { useState } from 'react';
import { Banknote, HandCoins } from 'lucide-react';
import { Button, Card, CardContent, CardHeader, Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, FormField, Input, ProgressBar, formatEUR } from '@golink/ui';
import { parsePriceInput, type RestaurantCourier, type WithId } from '@golink/shared';
import { useCan } from '@/auth/RestaurantAccess';
import { callFunction, useMutation } from '@/lib/firestore';

const recordRemittance = callFunction<{ restaurantId: string; driverId: string; amountCents: number; note?: string | null }, { cashBalanceCents: number; movementId: string }>('recordMerchantCashRemittance');

/**
 * Espèces des livreurs salariés : l'argent encaissé à la livraison reste chez vous. Cette caisse
 * suit ce que détient chaque livreur ; au plafond, il ne reçoit plus de commande en espèces.
 */
export function CashPanel({ restaurantId, couriers, limitCents }: { restaurantId: string; couriers: Array<WithId<RestaurantCourier>>; limitCents: number }) {
  const can = useCan();
  const [target, setTarget] = useState<WithId<RestaurantCourier> | null>(null);
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const remit = useMutation(recordRemittance, { success: (r) => `Remise enregistrée : il reste ${formatEUR(r.cashBalanceCents)} en caisse` });
  const held = couriers.filter((c) => (c.cashHeldCents ?? 0) > 0);
  const total = held.reduce((s, c) => s + (c.cashHeldCents ?? 0), 0);
  const cents = parsePriceInput(amount);
  if (held.length === 0) return null;

  return (
    <>
      <Card>
        <CardHeader title="Espèces détenues par vos livreurs" description={`${formatEUR(total)} à récupérer · plafond de ${formatEUR(limitCents)} par livreur`} icon={<Banknote />} divided />
        <CardContent className="p-0">
          <ul className="divide-y divide-border">
            {held.map((c) => {
              const cap = c.cashLimitCents ?? limitCents;
              const pct = Math.min(100, Math.round(((c.cashHeldCents ?? 0) / cap) * 100));
              return (
                <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-fg">{c.displayName}</p>
                    <div className="mt-1 max-w-xs">
                      <ProgressBar value={pct} tone={pct >= 100 ? 'danger' : pct >= 75 ? 'amber' : 'brand'} size="sm" />
                      <p className="mt-1 text-2xs text-fg-subtle">{formatEUR(c.cashHeldCents ?? 0)} sur {formatEUR(cap)}{pct >= 100 ? ' · plafond atteint : plus de course en espèces' : ''}</p>
                    </div>
                  </div>
                  {can('couriers.manage') && (
                    <Button size="sm" variant="secondary" leftIcon={<HandCoins />} onClick={() => { setAmount(((c.cashHeldCents ?? 0) / 100).toFixed(2).replace('.', ',')); setNote(''); setTarget(c); }}>
                      Remise de caisse
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        </CardContent>
      </Card>
      <Dialog open={Boolean(target)} onOpenChange={(open) => !open && !remit.loading && setTarget(null)}>
        <DialogContent size="sm">
          <DialogHeader title={target ? `Remise de caisse de ${target.displayName}` : 'Remise de caisse'} description={target ? `Espèces détenues : ${formatEUR(target.cashHeldCents ?? 0)}.` : undefined} icon={<HandCoins />} />
          <DialogBody className="space-y-4">
            <FormField label="Montant remis" hint={target ? `Au plus ${formatEUR(target.cashHeldCents ?? 0)}.` : undefined}>
              <Input inputMode="decimal" value={amount} trailing="€" invalid={amount !== '' && (!cents || (target ? cents > (target.cashHeldCents ?? 0) : false))} onChange={(e) => setAmount(e.target.value)} />
            </FormField>
            <FormField label="Note (facultatif)">
              <Input value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} />
            </FormField>
          </DialogBody>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setTarget(null)} disabled={remit.loading}>Annuler</Button>
            <Button
              variant="primary"
              loading={remit.loading}
              disabled={!target || !cents || cents <= 0 || cents > (target.cashHeldCents ?? 0)}
              onClick={async () => {
                if (!target || !cents) return;
                const result = await remit.mutate({ restaurantId, driverId: target.id, amountCents: cents, note: note.trim() || null });
                if (result) setTarget(null);
              }}
            >
              Enregistrer la remise
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
