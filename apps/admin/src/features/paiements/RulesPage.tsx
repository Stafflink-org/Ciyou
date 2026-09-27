import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { ArrowRight, Receipt, Save, Scale, Undo2 } from 'lucide-react';
import { Badge, Button, Card, CardContent, CardFooter, CardHeader, FormField, Input, PageContainer, PageHeader, RadioGroup, Skeleton, formatDateTime, Table } from '@golink/ui';
import {
  COLLECTIONS,
  DEFAULT_REFUND_LIABILITY,
  REFUND_CAUSES,
  REFUND_CAUSE_LABELS,
  SETTINGS_DOCS,
  formatMoney,
  type OrderRulesSettings,
  type RefundSettings,
} from '@golink/shared';
import { useDocumentTitle } from '@golink/web';
import { useCan } from '@/auth/AdminAccess';
import { useGeoScope } from '@/layout/GeoScope';
import { docAt, toDate, useDoc, useMutation } from '@/lib/firestore';
import { updateFinanceSettings } from '../argent-commun/api';
import { ActionDialog, Callout, ErrorPanel } from '../argent-commun/components';
import { bps, parseEuros, toEurosInput } from '../argent-commun/format';
import { PaiementsNav } from './nav';

const PAYER_LABELS = { restaurant: 'Commerce', courier: 'Livreur', platform: 'Ciyou Eats' } as const;

/** Frais et remboursements (cahier §14) : règles de remboursement, prise en charge des frais. */
export function RulesPage() {
  useDocumentTitle('Frais et remboursements · Ciyou Eats Admin');
  const can = useCan();
  const geo = useGeoScope();
  const refunds = useDoc<RefundSettings>(docAt(`${COLLECTIONS.settings}/${SETTINGS_DOCS.refunds}`));
  const orderRules = useDoc<OrderRulesSettings>(docAt(`${COLLECTIONS.settings}/${SETTINGS_DOCS.orderRules}`));
  const [draft, setDraft] = useState<{ threshold: string; method: 'original_payment' | 'wallet_credit'; validity: string; maxCredit: string } | null>(null);
  const [confirm, setConfirm] = useState(false);
  const save = useMutation(updateFinanceSettings, { success: 'Règles de remboursement enregistrées' });
  const editable = can('payments.configure');

  useEffect(() => {
    if (refunds.data) setDraft({ threshold: toEurosInput(refunds.data.approvalThresholdCents), method: refunds.data.defaultMethod, validity: String(refunds.data.walletCreditValidityDays), maxCredit: toEurosInput(refunds.data.maxCreditCents ?? 50_000) });
    else if (!refunds.loading && !refunds.data) setDraft({ threshold: '50,00', method: 'original_payment', validity: '180', maxCredit: '500,00' });
  }, [refunds.data, refunds.loading]);

  const threshold = draft ? parseEuros(draft.threshold) : null;
  const validity = draft && /^\d+$/.test(draft.validity) ? Number(draft.validity) : null;
  const maxCredit = draft ? parseEuros(draft.maxCredit) : null;
  const liability = orderRules.data?.refundLiability ?? DEFAULT_REFUND_LIABILITY;
  const allRestaurant = REFUND_CAUSES.every((c) => (liability[c]?.restaurant ?? 0) === 10_000);
  const countries = geo.countries.filter((c) => !geo.countryId || c.id === geo.countryId);

  return (
    <PageContainer wide>
      <PageHeader eyebrow={`Argent · ${geo.label}`} title="Frais et remboursements" description="Qui paie les remboursements et les frais de paiement, et comment un remboursement est validé.">
        <PaiementsNav />
      </PageHeader>

      <div className="grid gap-6 xl:grid-cols-3">
        <Card className="h-fit">
          <CardHeader title="Validation des remboursements" icon={<Undo2 />} divided />
          {refunds.error ? (
            <CardContent><ErrorPanel error={refunds.error} compact /></CardContent>
          ) : !draft ? (
            <CardContent><Skeleton className="h-48 w-full" /></CardContent>
          ) : (
            <>
              <CardContent className="space-y-4">
                <FormField label="Seuil de validation" hint="Plafond commun aux remboursements et aux avoirs : au-delà, un responsable doit valider (sauf plafond propre à l’agent). Plafonds par rôle : Plateforme > Administrateurs.">
                  <Input inputMode="decimal" disabled={!editable} value={draft.threshold} trailing="€" invalid={threshold === null} onChange={(e) => setDraft({ ...draft, threshold: e.target.value })} />
                </FormField>
                <FormField label="Mode de remboursement par défaut">
                  <RadioGroup
                    value={draft.method}
                    disabled={!editable}
                    onValueChange={(v) => setDraft({ ...draft, method: v as 'original_payment' | 'wallet_credit' })}
                    options={[
                      { value: 'original_payment', label: 'Sur le moyen de paiement d’origine' },
                      { value: 'wallet_credit', label: 'En avoir Ciyou Eats' },
                    ]}
                  />
                </FormField>
                <FormField label="Montant maximal d’un avoir" hint="Un avoir manuel ne peut pas dépasser ce montant, même pour un responsable.">
                  <Input inputMode="decimal" disabled={!editable} value={draft.maxCredit} trailing="€" invalid={maxCredit === null} onChange={(e) => setDraft({ ...draft, maxCredit: e.target.value })} />
                </FormField>
                <FormField label="Validité d’un avoir Ciyou Eats">
                  <Input type="number" min={1} disabled={!editable} value={draft.validity} trailing="jours" invalid={validity === null} onChange={(e) => setDraft({ ...draft, validity: e.target.value })} />
                </FormField>
                {toDate(refunds.data?.updatedAt) && <p className="text-xs text-fg-subtle">Modifié le {formatDateTime(toDate(refunds.data?.updatedAt) as Date)}</p>}
              </CardContent>
              {editable && (
                <CardFooter className="justify-end">
                  <Button variant="primary" size="sm" leftIcon={<Save />} disabled={threshold === null || validity === null || maxCredit === null} onClick={() => setConfirm(true)}>Enregistrer</Button>
                </CardFooter>
              )}
            </>
          )}
        </Card>

        <div className="space-y-6 xl:col-span-2">
          <Card>
            <CardHeader
              title="Imputation des remboursements"
              description="Part de chaque remboursement déduite du prochain reversement de chacun"
              icon={<Scale />}
              divided
              actions={can('order_rules.edit') ? <Button asChild size="sm" variant="ghost" rightIcon={<ArrowRight />}><Link to="/regles-commandes">Modifier dans Règles automatiques</Link></Button> : undefined}
            />
            <CardContent className="space-y-4">
              {allRestaurant && (
                <Callout tone="info" title="Le commerce paie tous les remboursements">
                  Décision de la direction : quelle que soit la cause, le montant remboursé est déduit du prochain reversement du commerce. Un remboursement d’une commande annulée avant livraison ne lui est pas retenu, puisqu’aucune vente ne lui a été versée.
                </Callout>
              )}
              {orderRules.loading ? (
                <Skeleton className="h-64 w-full" />
              ) : (
                <div className="overflow-x-auto rounded-xl border border-border">
                  <Table className="w-full min-w-[520px] text-sm">
                    <thead>
                      <tr className="border-b border-border bg-surface-2 text-left">
                        <th className="eyebrow px-4 py-2.5 font-normal">Cause</th>
                        {(['restaurant', 'courier', 'platform'] as const).map((p) => <th key={p} className="eyebrow px-3 py-2.5 text-right font-normal">{PAYER_LABELS[p]}</th>)}
                      </tr>
                    </thead>
                    <tbody>
                      {REFUND_CAUSES.map((cause) => {
                        const rule = liability[cause] ?? {};
                        const total = (rule.restaurant ?? 0) + (rule.courier ?? 0) + (rule.platform ?? 0);
                        return (
                          <tr key={cause} className="border-b border-border last:border-0">
                            <td className="px-4 py-2.5 text-fg">
                              {REFUND_CAUSE_LABELS[cause]}
                              {total === 0 && <Badge size="sm" tone="neutral" className="ml-2">Pas de remboursement</Badge>}
                            </td>
                            {(['restaurant', 'courier', 'platform'] as const).map((p) => (
                              <td key={p} className="px-3 py-2.5 text-right font-mono num">{rule[p] ? bps(rule[p] as number) : <span className="text-fg-subtle">—</span>}</td>
                            ))}
                          </tr>
                        );
                      })}
                    </tbody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader title="Frais de paiement" description="Coût des encaissements par carte, par pays" icon={<Receipt />} divided actions={<Button asChild size="sm" variant="ghost" rightIcon={<ArrowRight />}><Link to="/paiements/moyens">Modifier</Link></Button>} />
            <CardContent className="p-0">
              <ul className="divide-y divide-border">
                {countries.map((c) => (
                  <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
                    <div>
                      <p className="font-medium text-fg">{c.name}</p>
                      <p className="text-xs text-fg-subtle">{c.pricing?.payment ? `${bps(c.pricing.payment.percentBps)} + ${formatMoney(c.pricing.payment.fixedCents, c.currency)} par paiement, + ${bps(c.pricing.payment.connectPercentBps)} Connect` : 'Non renseigné'}</p>
                    </div>
                    <Badge tone={c.pricing?.payment?.payer === 'restaurant' ? 'info' : 'neutral'}>{c.pricing?.payment?.payer === 'restaurant' ? 'Déduits du reversement du commerce' : 'Pris en charge par Ciyou Eats'}</Badge>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </div>
      </div>

      <ActionDialog
        open={confirm}
        onOpenChange={setConfirm}
        title="Enregistrer les règles de remboursement"
        confirmLabel="Enregistrer"
        onSubmit={async (reason) => Boolean(draft && threshold !== null && validity !== null && maxCredit !== null && (await save.mutate({ doc: 'refunds', reason, data: { approvalThresholdCents: threshold, defaultMethod: draft.method, walletCreditValidityDays: validity, maxCreditCents: maxCredit } })))}
      />
    </PageContainer>
  );
}
