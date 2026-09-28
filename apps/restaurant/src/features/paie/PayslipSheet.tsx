import { useEffect, useState } from 'react';
import { ChevronDown, Download, FileCheck2, Plus, RefreshCw, RotateCcw, Send, X } from 'lucide-react';
import {
  Badge,
  Button,
  ConfirmDialog,
  IconButton,
  Input,
  Select,
  Sheet,
  SheetBody,
  SheetContent,
  SheetFooter,
  SheetHeader,
  StatusBadge,
  cn,
  formatEUR,
} from '@golink/ui';
import type { Payslip, PayslipAdjustment, WithId } from '@golink/shared';
import { useCan, useRestaurantAccess } from '@/auth/RestaurantAccess';
import { useMutation } from '@/lib/firestore';
import { formatMonth } from '../_rh/dates';
import { computePayroll, downloadBase64, generatePayslipPdf, savePayslipAdjustments, sendPayslips, setPayslipStatus } from '../_rh/functions';
import { PAYSLIP_STATUS } from '../_rh/ui';

const hours = (value: number) => `${value.toLocaleString('fr-FR', { maximumFractionDigits: 2 })} h`;
const rate = (bps: number) => (bps ? `${(bps / 100).toLocaleString('fr-FR', { maximumFractionDigits: 3 })} %` : '');

export function usePayslipDownload() {
  const { restaurantId } = useRestaurantAccess();
  return useMutation(
    async (payslipId: string) => {
      const file = await generatePayslipPdf({ restaurantId, payslipId });
      downloadBase64(file.base64, file.fileName);
      return file.fileName;
    },
    { success: 'Bulletin téléchargé' },
  );
}

function Amount({ label, value, strong, negative }: { label: string; value: number; strong?: boolean; negative?: boolean }) {
  return (
    <div className="flex items-center justify-between py-1.5 text-sm">
      <span className={strong ? 'font-medium text-fg' : 'text-fg-muted'}>{label}</span>
      <span className={cn('font-mono num', strong ? 'font-semibold text-fg' : 'text-fg')}>
        {negative && value > 0 ? '− ' : ''}
        {formatEUR(value, { cents: true })}
      </span>
    </div>
  );
}

export function PayslipSheet({ payslip, name, onClose }: { payslip: WithId<Payslip> | null; name: string; onClose: () => void }) {
  const { restaurantId } = useRestaurantAccess();
  const can = useCan();
  const manage = can('payroll.manage');
  const [adjustments, setAdjustments] = useState<PayslipAdjustment[]>([]);
  const [showContributions, setShowContributions] = useState(false);
  const [sendOpen, setSendOpen] = useState(false);
  useEffect(() => {
    setAdjustments(payslip?.adjustments ?? []);
    setShowContributions(false);
  }, [payslip]);

  const download = usePayslipDownload();
  const saveAdjustments = useMutation(savePayslipAdjustments, { success: (r) => `Bulletin recalculé : ${formatEUR(r.netCents, { cents: true })} net` });
  const status = useMutation(setPayslipStatus, { success: 'Statut du bulletin mis à jour' });
  const send = useMutation(sendPayslips, { success: 'Bulletin envoyé au salarié' });
  const recompute = useMutation(computePayroll, { success: 'Bulletin recalculé à partir des pointages' });

  const editable = manage && payslip?.status === 'generated';
  const dirty = JSON.stringify(adjustments) !== JSON.stringify(payslip?.adjustments ?? []);
  const validAdjustments = adjustments.every((a) => a.label.trim().length >= 2 && a.amountCents > 0);

  return (
    <Sheet open={payslip !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="sm:max-w-xl">
        {payslip && (
          <>
            <SheetHeader icon={<FileCheck2 />} title={name} description={`Bulletin de ${formatMonth(payslip.period).toLowerCase()}`} />
            <SheetBody className="space-y-5">
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge status={payslip.status} map={PAYSLIP_STATUS} />
                {payslip.employeeSnapshot && (
                  <span className="text-xs text-fg-muted">
                    {payslip.employeeSnapshot.position} · {formatEUR(payslip.employeeSnapshot.hourlyRateCents, { cents: true })} / h · {payslip.employeeSnapshot.weeklyHours} h / sem.
                  </span>
                )}
              </div>

              <div className="rounded-xl bg-sidebar p-5 text-sidebar-fg">
                <p className="eyebrow text-sidebar-muted">Net à payer</p>
                <p className="mt-1 font-display text-4xl font-semibold tracking-display num">{formatEUR(payslip.netCents, { cents: true })}</p>
                <div className="mt-4 grid grid-cols-3 gap-3 text-xs text-sidebar-muted">
                  <div>
                    <p>Brut</p>
                    <p className="mt-0.5 font-mono text-sm text-sidebar-fg num">{formatEUR(payslip.grossCents, { cents: true })}</p>
                  </div>
                  <div>
                    <p>Net imposable</p>
                    <p className="mt-0.5 font-mono text-sm text-sidebar-fg num">{formatEUR(payslip.taxableNetCents, { cents: true })}</p>
                  </div>
                  <div>
                    <p>Coût employeur</p>
                    <p className="mt-0.5 font-mono text-sm text-sidebar-fg num">{formatEUR(payslip.grossCents + payslip.employerContributionsCents, { cents: true })}</p>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
                {[
                  ['Normales', payslip.hours.regular],
                  ['Sup. +10 %', payslip.hours.overtime10],
                  ['Sup. +20/50 %', payslip.hours.overtime20 + payslip.hours.overtime50],
                  ['Nuit', payslip.hours.night],
                ].map(([label, value]) => (
                  <div key={label as string} className="rounded-lg border border-border bg-surface-2 px-3 py-2">
                    <p className="text-2xs text-fg-subtle">{label}</p>
                    <p className="font-mono font-medium text-fg num">{hours(value as number)}</p>
                  </div>
                ))}
              </div>

              <section>
                <p className="eyebrow mb-2">Rémunération</p>
                {payslip.lines?.length ? (
                  <div className="divide-y divide-border rounded-xl border border-border">
                    {payslip.lines.map((line, i) => (
                      <div key={i} className="flex items-center justify-between gap-3 px-4 py-2 text-sm">
                        <span className="min-w-0 text-fg">
                          {line.label}
                          {line.quantity ? (
                            <span className="ml-1.5 font-mono text-2xs text-fg-subtle num">
                              {line.quantity.toLocaleString('fr-FR')} × {line.unitCents ? formatEUR(line.unitCents, { cents: true }) : ''}
                            </span>
                          ) : null}
                        </span>
                        <span className="shrink-0 font-mono text-fg num">{formatEUR(line.amountCents, { cents: true })}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-fg-subtle">Détail non disponible pour ce bulletin importé.</p>
                )}
                <div className="mt-2 px-1">
                  <Amount label="Salaire brut" value={payslip.grossCents} strong />
                  <Amount label="Cotisations salariales" value={payslip.employeeContributionsCents} negative />
                  {payslip.mealAllowanceCents > 0 && <Amount label="Avantage en nature nourriture" value={payslip.mealAllowanceCents} negative />}
                  <Amount label="Prélèvement à la source" value={payslip.withholdingTaxCents} negative />
                  {payslip.deductionsCents > 0 && <Amount label="Retenues" value={payslip.deductionsCents} negative />}
                  <div className="mt-1 border-t border-border pt-1">
                    <Amount label="Net à payer" value={payslip.netCents} strong />
                  </div>
                </div>
              </section>

              <section>
                <button
                  type="button"
                  onClick={() => setShowContributions((v) => !v)}
                  className="flex w-full items-center justify-between rounded-lg px-1 py-1 text-left"
                  aria-expanded={showContributions}
                >
                  <span className="eyebrow">Cotisations ({payslip.contributions.length})</span>
                  <ChevronDown className={cn('size-4 text-fg-subtle transition-transform', showContributions && 'rotate-180')} />
                </button>
                {showContributions && (
                  <div data-scroll-ok className="mt-2 overflow-x-auto rounded-xl border border-border">
                    <table className="w-full min-w-[440px] text-xs">
                      <thead className="bg-surface-2 text-left text-fg-subtle">
                        <tr>
                          <th className="px-3 py-2 font-medium">Cotisation</th>
                          <th className="px-3 py-2 text-right font-medium">Base</th>
                          <th className="px-3 py-2 text-right font-medium">Salarié</th>
                          <th className="px-3 py-2 text-right font-medium">Employeur</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {payslip.contributions.map((c) => (
                          <tr key={c.label}>
                            <td className="px-3 py-1.5 text-fg">{c.label}</td>
                            <td className="px-3 py-1.5 text-right font-mono num">{formatEUR(c.baseCents, { cents: true })}</td>
                            <td className="px-3 py-1.5 text-right font-mono num">{rate(c.employeeRateBps)}</td>
                            <td className="px-3 py-1.5 text-right font-mono num">{rate(c.employerRateBps)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>

              {(editable || adjustments.length > 0) && (
                <section className="space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="eyebrow">Primes et retenues</p>
                    {editable && (
                      <Button size="xs" variant="ghost" leftIcon={<Plus />} onClick={() => setAdjustments((a) => [...a, { label: '', amountCents: 0, kind: 'bonus' }])} disabled={adjustments.length >= 12}>
                        Ajouter
                      </Button>
                    )}
                  </div>
                  {adjustments.length === 0 && <p className="text-sm text-fg-subtle">Prime de service, acompte, maintien de salaire…</p>}
                  {adjustments.map((adjustment, index) => (
                    <div key={index} className="grid grid-cols-[1fr_7.5rem] gap-2 sm:grid-cols-[1fr_8rem_7rem_auto]">
                      <Input
                        aria-label="Libellé"
                        placeholder="Libellé"
                        value={adjustment.label}
                        disabled={!editable}
                        onChange={(e) => setAdjustments((list) => list.map((a, i) => (i === index ? { ...a, label: e.target.value } : a)))}
                      />
                      <Select
                        aria-label="Nature"
                        value={adjustment.kind}
                        disabled={!editable}
                        onValueChange={(v) => setAdjustments((list) => list.map((a, i) => (i === index ? { ...a, kind: v as PayslipAdjustment['kind'] } : a)))}
                        options={[
                          { value: 'bonus', label: 'Prime' },
                          { value: 'deduction', label: 'Retenue' },
                        ]}
                      />
                      <Input
                        aria-label="Montant"
                        inputMode="decimal"
                        trailing="€"
                        disabled={!editable}
                        value={adjustment.amountCents ? (adjustment.amountCents / 100).toString().replace('.', ',') : ''}
                        onChange={(e) => {
                          const cents = Math.round(Number(e.target.value.replace(',', '.')) * 100);
                          setAdjustments((list) => list.map((a, i) => (i === index ? { ...a, amountCents: Number.isFinite(cents) ? Math.max(0, cents) : 0 } : a)));
                        }}
                      />
                      {editable && (
                        <IconButton label="Retirer" variant="danger" onClick={() => setAdjustments((list) => list.filter((_, i) => i !== index))}>
                          <X />
                        </IconButton>
                      )}
                    </div>
                  ))}
                  {editable && dirty && (
                    <div className="flex justify-end">
                      <Button
                        size="sm"
                        variant="primary"
                        loading={saveAdjustments.loading}
                        disabled={!validAdjustments}
                        onClick={() => void saveAdjustments.mutate({ restaurantId, payslipId: payslip.id, adjustments })}
                      >
                        Recalculer avec ces montants
                      </Button>
                    </div>
                  )}
                  {!editable && manage && payslip.status !== 'sent' && adjustments.length > 0 && (
                    <Badge tone="neutral">Repassez le bulletin à valider pour modifier les primes.</Badge>
                  )}
                </section>
              )}
            </SheetBody>
            <SheetFooter className="flex-wrap sm:justify-between">
              <Button leftIcon={<Download />} loading={download.loading} onClick={() => void download.mutate(payslip.id)}>
                Télécharger le PDF
              </Button>
              {manage && (
                <div className="flex flex-col-reverse gap-2 sm:flex-row">
                  {payslip.status === 'generated' && (
                    <>
                      <Button variant="ghost" leftIcon={<RefreshCw />} loading={recompute.loading} onClick={() => void recompute.mutate({ restaurantId, period: payslip.period, employeeIds: [payslip.employeeId] })}>
                        Recalculer
                      </Button>
                      <Button variant="primary" leftIcon={<FileCheck2 />} loading={status.loading} onClick={() => void status.mutate({ restaurantId, payslipIds: [payslip.id], status: 'validated' })}>
                        Valider
                      </Button>
                    </>
                  )}
                  {payslip.status === 'validated' && (
                    <>
                      <Button variant="ghost" leftIcon={<RotateCcw />} loading={status.loading} onClick={() => void status.mutate({ restaurantId, payslipIds: [payslip.id], status: 'generated' })}>
                        Repasser à valider
                      </Button>
                      <Button variant="primary" leftIcon={<Send />} onClick={() => setSendOpen(true)}>
                        Envoyer au salarié
                      </Button>
                    </>
                  )}
                </div>
              )}
            </SheetFooter>
            <ConfirmDialog
              open={sendOpen}
              onOpenChange={setSendOpen}
              title="Envoyer le bulletin ?"
              description="Le bulletin devient définitif et consultable par le salarié dans son espace ; il reçoit une notification."
              confirmLabel="Envoyer"
              onConfirm={async () => {
                await send.mutate({ restaurantId, payslipIds: [payslip.id] });
              }}
            />
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
