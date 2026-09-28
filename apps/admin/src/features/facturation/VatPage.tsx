import { useMemo, useState } from 'react';
import { Ban, CheckCircle2, Hash, Pencil, Percent, ShieldAlert } from 'lucide-react';
import { Badge, Button, Card, CardContent, CardHeader, EmptyState, FormField, Input, PageContainer, PageHeader, Skeleton, Switch, Textarea, formatDateTime, Table } from '@golink/ui';
import { COLLECTIONS, INVOICE_RETENTION_YEARS, VAT_CATEGORY_LABELS, type Counter, type Country, type WithId } from '@golink/shared';
import { useDocumentTitle } from '@golink/web';
import { useCan } from '@/auth/AdminAccess';
import { useGeoScope } from '@/layout/GeoScope';
import { docAt, toDate, useDocs, useMutation } from '@/lib/firestore';
import { callFunction } from '@/lib/firestore';
import { ActionDialog, Callout } from '../argent-commun/components';
import { bps, parsePercent, toPercentInput } from '../argent-commun/format';
import { FacturationNav } from './nav';

const updateCountryVat = callFunction<
  { countryId: string; standardBps: number; byCategory: { food: number; soft_drink: number; grocery: number }; vatValidated: boolean; vatNote: string | null; reason: string },
  { changedFields: string[] }
>('updateCountryVat');

const SERIES: Array<{ code: string; label: string }> = [
  { code: 'FAC', label: 'Factures mensuelles aux commerces' },
  { code: 'COM', label: 'Factures de commissions (historique)' },
  { code: 'ABO', label: 'Factures d’abonnement' },
  { code: 'PUB', label: 'Factures de mise en avant' },
  { code: 'LIV', label: 'Relevés livreurs (autofacturation)' },
  { code: 'REC', label: 'Justificatifs clients' },
  { code: 'AV', label: 'Avoirs' },
];

/** Taux de TVA par pays et type de produit, numérotation continue et conservation (cahier §16). */
export function VatPage() {
  useDocumentTitle('TVA et numérotation · Ciyou Eats Admin');
  const can = useCan();
  const geo = useGeoScope();
  const countries = geo.countries.filter((c) => !geo.countryId || c.id === geo.countryId);
  const [editing, setEditing] = useState<WithId<Country> | null>(null);

  const counterRefs = useMemo(
    () => countries.flatMap((c) => SERIES.map((s) => docAt(`${COLLECTIONS.counters}/invoice_${c.billingEntity?.invoicePrefix || c.id}-${s.code}`))),
    [countries.map((c) => c.id).join(',')],
  );
  const counters = useDocs<Counter>(counterRefs);

  return (
    <PageContainer wide>
      <PageHeader eyebrow={`Argent · ${geo.label}`} title="TVA et numérotation" description="Taux appliqués par type de produit et par pays, séries de numérotation continue des pièces et durée de conservation.">
        <FacturationNav />
      </PageHeader>

      <div className="space-y-6">
        <Callout tone="danger" icon={<Ban />} title="Vente d’alcool interdite sur Ciyou Eats">
          La catégorie « boisson alcoolisée » est verrouillée : aucun produit ne peut y être rattaché. Son taux reste affiché pour mémoire.
        </Callout>

        {countries.length === 0 ? (
          <EmptyState icon={<Percent />} title="Aucun pays dans votre périmètre" />
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {countries.map((country) => {
              const vat = country.pricing?.vat;
              return (
                <Card key={country.id}>
                  <CardHeader
                    title={country.name}
                    description={`${country.currency} · ${country.active ? 'marché ouvert' : 'marché en attente'}`}
                    divided
                    actions={
                      <div className="flex items-center gap-2">
                        {country.vatValidated ? <Badge tone="success" icon={<CheckCircle2 />}>Validés</Badge> : <Badge tone="amber" icon={<ShieldAlert />}>À valider</Badge>}
                        {can('tax.reports') && (
                          <Button size="sm" variant="ghost" leftIcon={<Pencil />} onClick={() => setEditing(country)}>
                            Modifier
                          </Button>
                        )}
                      </div>
                    }
                  />
                  <CardContent className="space-y-3">
                    <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
                      <div>
                        <dt className="text-xs text-fg-subtle">Taux normal (services Ciyou Eats)</dt>
                        <dd className="font-display text-xl font-semibold text-fg num">{vat ? bps(vat.standardBps) : '—'}</dd>
                      </div>
                      {(['food', 'soft_drink', 'grocery'] as const).map((cat) => (
                        <div key={cat}>
                          <dt className="text-xs text-fg-subtle">{VAT_CATEGORY_LABELS[cat]}</dt>
                          <dd className="font-display text-xl font-semibold text-fg num">{vat ? bps(vat.byCategory[cat]) : '—'}</dd>
                        </div>
                      ))}
                      <div>
                        <dt className="text-xs text-fg-subtle">Boisson alcoolisée</dt>
                        <dd className="flex items-center gap-1.5 font-display text-xl font-semibold text-fg-subtle line-through num">{vat ? bps(vat.byCategory.alcohol) : '—'}</dd>
                      </div>
                    </dl>
                    {country.vatNote && <p className="rounded-lg bg-surface-2 px-3 py-2 text-sm text-fg-muted">{country.vatNote}</p>}
                    <p className="text-xs text-fg-subtle">
                      Entité émettrice : {country.billingEntity?.legalName ?? '—'}
                      {country.billingEntity?.vatNumber ? ` · TVA ${country.billingEntity.vatNumber}` : ''}
                    </p>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}

        <Card>
          <CardHeader title="Numérotation continue" description="Chaque série est incrémentée dans une transaction : aucun numéro sauté, aucun doublon. Format : PRÉFIXE-SÉRIE-ANNÉE-NUMÉRO." icon={<Hash />} divided />
          <CardContent className="p-0">
            {counters.loading ? (
              <div className="space-y-2 p-5">{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-8 w-full" />)}</div>
            ) : (
              <div className="overflow-x-auto">
                <Table className="w-full min-w-[560px] text-sm">
                  <thead>
                    <tr className="border-b border-border bg-surface-2 text-left">
                      <th className="eyebrow px-5 py-2.5 font-normal">Série</th>
                      <th className="eyebrow px-3 py-2.5 font-normal">Pièces</th>
                      <th className="eyebrow px-3 py-2.5 text-right font-normal">Dernier numéro</th>
                      <th className="eyebrow px-5 py-2.5 text-right font-normal">Mise à jour</th>
                    </tr>
                  </thead>
                  <tbody>
                    {counters.data.length === 0 && (
                      <tr><td colSpan={4} className="px-5 py-6 text-center text-fg-muted">Aucune pièce émise pour l’instant.</td></tr>
                    )}
                    {counters.data
                      .slice()
                      .sort((a, b) => a.id.localeCompare(b.id))
                      .map((c) => {
                        const code = c.id.split('-').pop() ?? '';
                        return (
                          <tr key={c.id} className="border-b border-border last:border-0">
                            <td className="px-5 py-3 font-mono font-medium text-fg">{c.prefix}</td>
                            <td className="px-3 py-3 text-fg-muted">{SERIES.find((s) => s.code === code)?.label ?? '—'}</td>
                            <td className="px-3 py-3 text-right font-mono num">{String(c.value).padStart(6, '0')}</td>
                            <td className="px-5 py-3 text-right text-fg-muted">{toDate(c.updatedAt) ? formatDateTime(toDate(c.updatedAt) as Date) : '—'}</td>
                          </tr>
                        );
                      })}
                  </tbody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
        <Callout tone="info" title={`Conservation ${INVOICE_RETENTION_YEARS} ans`}>
          Les factures, avoirs et relevés sont conservés {INVOICE_RETENTION_YEARS} ans à compter de la clôture de l’exercice, même après la suppression du compte du commerce, du livreur ou du client. Aucune pièce ne peut être supprimée ni modifiée.
        </Callout>
      </div>

      {editing && <VatDialog country={editing} onClose={() => setEditing(null)} />}
    </PageContainer>
  );
}

function VatDialog({ country, onClose }: { country: WithId<Country>; onClose: () => void }) {
  const vat = country.pricing.vat;
  const [values, setValues] = useState({
    standard: toPercentInput(vat.standardBps),
    food: toPercentInput(vat.byCategory.food),
    soft_drink: toPercentInput(vat.byCategory.soft_drink),
    grocery: toPercentInput(vat.byCategory.grocery),
  });
  const [validated, setValidated] = useState(Boolean(country.vatValidated));
  const [note, setNote] = useState(country.vatNote ?? '');
  const save = useMutation(updateCountryVat, { success: `Taux de TVA de ${country.name} enregistrés` });
  const parsed = { standard: parsePercent(values.standard), food: parsePercent(values.food), soft_drink: parsePercent(values.soft_drink), grocery: parsePercent(values.grocery) };
  const valid = Object.values(parsed).every((v) => v !== null && v <= 5000);
  return (
    <ActionDialog
      open
      onOpenChange={(o) => !o && onClose()}
      size="md"
      icon={<Percent />}
      title={`TVA · ${country.name}`}
      description="Les nouveaux taux s’appliquent aux prochaines commandes et factures ; les pièces déjà émises ne changent pas."
      confirmLabel="Enregistrer les taux"
      disabled={!valid}
      onSubmit={async (reason) =>
        Boolean(
          valid &&
            (await save.mutate({
              countryId: country.id,
              standardBps: parsed.standard as number,
              byCategory: { food: parsed.food as number, soft_drink: parsed.soft_drink as number, grocery: parsed.grocery as number },
              vatValidated: validated,
              vatNote: note.trim() || null,
              reason,
            })),
        )
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        {([
          ['standard', 'Taux normal (commissions, frais)'],
          ['food', VAT_CATEGORY_LABELS.food],
          ['soft_drink', VAT_CATEGORY_LABELS.soft_drink],
          ['grocery', VAT_CATEGORY_LABELS.grocery],
        ] as const).map(([key, label]) => (
          <FormField key={key} label={label}>
            <Input inputMode="decimal" value={values[key]} trailing="%" invalid={parsed[key] === null} onChange={(e) => setValues({ ...values, [key]: e.target.value })} />
          </FormField>
        ))}
      </div>
      <Switch checked={validated} onCheckedChange={setValidated} label="Taux validés par l’expert-comptable" description="Retire la mention « à valider » des écrans et des déclarations." />
      <FormField label="Note" hint="Précisions sur les taux, points en attente.">
        <Textarea rows={2} value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />
      </FormField>
    </ActionDialog>
  );
}
