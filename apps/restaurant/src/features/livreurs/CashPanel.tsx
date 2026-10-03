import { useState } from 'react';
import { Banknote, CreditCard, HandCoins, Ticket } from 'lucide-react';
import { Button, Card, CardContent, CardHeader, ConfirmDialog, Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, FormField, Input, ProgressBar, formatEUR } from '@golink/ui';
import { parsePriceInput, type CollectedPaymentMethod, type RestaurantCourier, type WithId } from '@golink/shared';
import { useCan } from '@/auth/RestaurantAccess';
import { callFunction, useMutation } from '@/lib/firestore';

const recordRemittance = callFunction<{ restaurantId: string; driverId: string; amountCents: number; note?: string | null }, { cashBalanceCents: number; movementId: string }>('recordMerchantCashRemittance');
const resetBalance = callFunction<{ restaurantId: string; driverId: string; method: CollectedPaymentMethod; note?: string | null }, { balanceCents: number; movementId: string }>('resetDriverCashBalance');

const METHODS: Array<{ id: CollectedPaymentMethod; label: string; summaryLabel: string; icon: typeof Banknote; held: (c: RestaurantCourier) => number }> = [
  { id: 'cash', label: 'Espèces', summaryLabel: 'espèces', icon: Banknote, held: (c) => c.cashHeldCents ?? 0 },
  { id: 'meal_voucher', label: 'Tickets Restaurant', summaryLabel: 'tickets restaurant', icon: Ticket, held: (c) => c.mealVoucherHeldCents ?? 0 },
  { id: 'card', label: 'TPE (carte)', summaryLabel: 'TPE (carte)', icon: CreditCard, held: (c) => c.cardTerminalHeldCents ?? 0 },
];

/**
 * Recette des livreurs salariés : l'argent encaissé en personne à la livraison (espèces,
 * Tickets Restaurant ou carte via le terminal du livreur) reste chez vous jusqu'à remise.
 * Document client « Points à corriger », Backoffice resto #6.
 */
export function CashPanel({ restaurantId, couriers, limitCents }: { restaurantId: string; couriers: Array<WithId<RestaurantCourier>>; limitCents: number }) {
  const can = useCan();
  const [remitTarget, setRemitTarget] = useState<WithId<RestaurantCourier> | null>(null);
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [resetTarget, setResetTarget] = useState<{ courier: WithId<RestaurantCourier>; method: CollectedPaymentMethod } | null>(null);
  const remit = useMutation(recordRemittance, { success: (r) => `Remise enregistrée : il reste ${formatEUR(r.cashBalanceCents)} en espèces` });
  const reset = useMutation(resetBalance, { success: () => 'Remise à zéro enregistrée' });

  const held = couriers.filter((c) => METHODS.some((m) => m.held(c) > 0));
  const totals = METHODS.map((m) => ({ ...m, total: held.reduce((s, c) => s + m.held(c), 0) }));
  const cents = parsePriceInput(amount);
  if (held.length === 0) return null;

  return (
    <>
      <Card>
        <CardHeader
          title="Recette détenue par vos livreurs"
          description={totals.filter((m) => m.total > 0).map((m) => `${formatEUR(m.total)} en ${m.summaryLabel}`).join(' · ') || undefined}
          icon={<Banknote />}
          divided
        />
        <CardContent className="p-0">
          <ul className="divide-y divide-border">
            {held.map((c) => (
              <li key={c.id} className="px-5 py-3.5">
                <p className="truncate font-medium text-fg">{c.displayName}</p>
                <div className="mt-2 grid gap-2.5 sm:grid-cols-3">
                  {METHODS.map((m) => {
                    const amountHeld = m.held(c);
                    const cap = m.id === 'cash' ? (c.cashLimitCents ?? limitCents) : null;
                    const pct = cap ? Math.min(100, Math.round((amountHeld / cap) * 100)) : null;
                    return (
                      <div key={m.id} className="min-w-0 rounded-lg border border-border bg-surface-2 px-3 py-2">
                        <p className="flex items-center gap-1.5 text-2xs font-medium uppercase tracking-wide text-fg-subtle">
                          <m.icon className="size-3.5" /> {m.label}
                        </p>
                        <p className="num mt-1 font-mono text-sm font-semibold text-fg">{formatEUR(amountHeld)}</p>
                        {pct !== null && (
                          <div className="mt-1.5">
                            <ProgressBar value={pct} tone={pct >= 100 ? 'danger' : pct >= 75 ? 'amber' : 'brand'} size="sm" />
                            <p className="mt-1 text-3xs text-fg-subtle">{pct >= 100 ? 'Plafond atteint : plus de course en espèces' : `Plafond ${formatEUR(cap ?? 0)}`}</p>
                          </div>
                        )}
                        {can('couriers.manage') && amountHeld > 0 && (
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {m.id === 'cash' && (
                              <Button size="xs" variant="secondary" leftIcon={<HandCoins />} onClick={() => { setAmount((amountHeld / 100).toFixed(2).replace('.', ',')); setNote(''); setRemitTarget(c); }}>
                                Remise de caisse
                              </Button>
                            )}
                            <Button size="xs" variant="ghost" onClick={() => setResetTarget({ courier: c, method: m.id })}>
                              Remise à zéro
                            </Button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <Dialog open={Boolean(remitTarget)} onOpenChange={(open) => !open && !remit.loading && setRemitTarget(null)}>
        <DialogContent size="sm">
          <DialogHeader title={remitTarget ? `Remise de caisse de ${remitTarget.displayName}` : 'Remise de caisse'} description={remitTarget ? `Espèces détenues : ${formatEUR(remitTarget.cashHeldCents ?? 0)}.` : undefined} icon={<HandCoins />} />
          <DialogBody className="space-y-4">
            <FormField label="Montant remis" hint={remitTarget ? `Au plus ${formatEUR(remitTarget.cashHeldCents ?? 0)}.` : undefined}>
              <Input inputMode="decimal" value={amount} trailing="€" invalid={amount !== '' && (!cents || (remitTarget ? cents > (remitTarget.cashHeldCents ?? 0) : false))} onChange={(e) => setAmount(e.target.value)} />
            </FormField>
            <FormField label="Note (facultatif)">
              <Input value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} />
            </FormField>
          </DialogBody>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRemitTarget(null)} disabled={remit.loading}>Annuler</Button>
            <Button
              variant="primary"
              loading={remit.loading}
              disabled={!remitTarget || !cents || cents <= 0 || cents > (remitTarget.cashHeldCents ?? 0)}
              onClick={async () => {
                if (!remitTarget || !cents) return;
                const result = await remit.mutate({ restaurantId, driverId: remitTarget.id, amountCents: cents, note: note.trim() || null });
                if (result) setRemitTarget(null);
              }}
            >
              Enregistrer la remise
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={Boolean(resetTarget)}
        onOpenChange={(open) => !open && setResetTarget(null)}
        title={resetTarget ? `Remettre à zéro — ${METHODS.find((m) => m.id === resetTarget.method)?.label}` : 'Remise à zéro'}
        description={resetTarget ? `${resetTarget.courier.displayName} a confirmé avoir remis l’intégralité de ce qu’il détenait (${formatEUR(METHODS.find((m) => m.id === resetTarget.method)?.held(resetTarget.courier) ?? 0)}).` : undefined}
        confirmLabel="Remettre à zéro"
        onConfirm={async () => {
          if (!resetTarget) return;
          await reset.mutate({ restaurantId, driverId: resetTarget.courier.id, method: resetTarget.method });
        }}
      />
    </>
  );
}
