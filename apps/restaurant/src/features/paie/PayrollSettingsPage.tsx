import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { setDoc } from 'firebase/firestore';
import { ArrowLeft, Moon, Percent, Save, ShieldCheck, Utensils } from 'lucide-react';
import { Button, Card, CardContent, CardHeader, EmptyState, FormField, Input, PageContainer, PageHeader, Select, Skeleton, Switch, TimeInput } from '@golink/ui';
import { DEFAULT_PAYROLL_SETTINGS, RESTAURANT_SETTINGS_DOCS, paths, type PayrollSettings } from '@golink/shared';
import { useAuth, useDocumentTitle } from '@golink/web';
import { useCan, useRestaurantAccess } from '@/auth/RestaurantAccess';
import { docAt, updatedFields, useDoc, useMutation } from '@/lib/firestore';
import { ErrorCard } from '../_rh/ui';

type Form = Omit<PayrollSettings, 'updatedAt' | 'updatedBy'>;

const DEFAULTS: Form = DEFAULT_PAYROLL_SETTINGS;

const toPercent = (bps: number) => String(bps / 100).replace('.', ',');
const fromPercent = (value: string) => Math.round(Number(value.replace(',', '.')) * 100) || 0;
const toEuros = (cents: number) => (cents / 100).toFixed(2).replace('.', ',');
const fromEuros = (value: string) => Math.round(Number(value.replace(',', '.')) * 100) || 0;

function PercentInput({ value, onChange, disabled }: { value: number; onChange: (bps: number) => void; disabled?: boolean }) {
  const [text, setText] = useState(toPercent(value));
  useEffect(() => setText(toPercent(value)), [value]);
  return <Input inputMode="decimal" trailing="%" disabled={disabled} value={text} onChange={(e) => setText(e.target.value)} onBlur={() => onChange(fromPercent(text))} />;
}

function EurosInput({ value, onChange, disabled }: { value: number; onChange: (cents: number) => void; disabled?: boolean }) {
  const [text, setText] = useState(toEuros(value));
  useEffect(() => setText(toEuros(value)), [value]);
  return <Input inputMode="decimal" trailing="€" disabled={disabled} value={text} onChange={(e) => setText(e.target.value)} onBlur={() => onChange(fromEuros(text))} />;
}

function Block({ icon, title, description, children }: { icon: ReactNode; title: string; description: string; children: ReactNode }) {
  return (
    <Card>
      <CardHeader icon={icon} title={title} description={description} divided />
      <CardContent className="grid gap-4 py-5 sm:grid-cols-2">{children}</CardContent>
    </Card>
  );
}

export function PayrollSettingsPage() {
  useDocumentTitle('Réglages de paie · Ciyou Eats Restaurant');
  const can = useCan();
  const { restaurantId } = useRestaurantAccess();
  const { user } = useAuth();
  const ref = docAt(paths.restaurantSettings(restaurantId, RESTAURANT_SETTINGS_DOCS.payroll));
  const state = useDoc<PayrollSettings>(ref);
  const [form, setForm] = useState<Form>(DEFAULTS);
  useEffect(() => {
    if (state.data) {
      const { id: _id, updatedAt: _u, updatedBy: _b, ...rest } = state.data;
      setForm({ ...DEFAULTS, ...rest });
    }
  }, [state.data]);
  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm((f) => ({ ...f, [key]: value }));

  const save = useMutation(
    async () => {
      await setDoc(ref, { ...form, ...updatedFields(user!.uid) });
    },
    { success: 'Réglages de paie enregistrés' },
  );

  const back = (
    <Link to="/equipe/paie" className="mb-4 inline-flex items-center gap-1.5 text-sm text-fg-muted hover:text-fg">
      <ArrowLeft className="size-4" /> Paie
    </Link>
  );

  if (!can('payroll.manage')) {
    return (
      <PageContainer>
        {back}
        <Card>
          <EmptyState icon={<ShieldCheck />} title="Réglages réservés" description="Seul le gestionnaire de paie de l’établissement peut modifier ces paramètres." />
        </Card>
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      {back}
      <PageHeader
        eyebrow="Paie"
        title="Réglages de paie"
        description="Convention, majorations et avantages appliqués au calcul des bulletins de l’établissement."
        actions={
          <Button variant="primary" leftIcon={<Save />} loading={save.loading} onClick={() => void save.mutate()}>
            Enregistrer
          </Button>
        }
      />
      {state.error && <ErrorCard error={state.error} />}
      {state.loading ? (
        <div className="space-y-4">
          <Skeleton className="h-48" />
          <Skeleton className="h-48" />
        </div>
      ) : (
        <div className="space-y-4">
          <Block icon={<ShieldCheck />} title="Cadre légal" description="Convention collective et temps de travail de référence.">
            <FormField label="Convention collective">
              <Input value={form.collectiveAgreement} onChange={(e) => set('collectiveAgreement', e.target.value)} />
            </FormField>
            <FormField label="Code NAF">
              <Input value={form.nafCode ?? ''} onChange={(e) => set('nafCode', e.target.value || null)} />
            </FormField>
            <FormField label="Durée hebdomadaire de référence">
              <Select
                value={String(form.weeklyLegalHours)}
                onValueChange={(v) => set('weeklyLegalHours', Number(v) as 35 | 39)}
                options={[
                  { value: '35', label: '35 heures' },
                  { value: '39', label: '39 heures (HCR)' },
                ]}
              />
            </FormField>
            <FormField label="Congés payés acquis par an">
              <Select
                value={String(form.paidLeaveDaysPerYear)}
                onValueChange={(v) => set('paidLeaveDaysPerYear', Number(v))}
                options={[
                  { value: '25', label: '25 jours ouvrés (lundi → vendredi)' },
                  { value: '30', label: '30 jours ouvrables (lundi → samedi)' },
                ]}
              />
            </FormField>
            <FormField label="Jour de versement du salaire" hint="Du mois suivant.">
              <Input type="number" min={1} max={28} value={String(form.payDay)} onChange={(e) => set('payDay', Math.min(28, Math.max(1, Number(e.target.value) || 1)))} />
            </FormField>
            <FormField label="Taux accidents du travail" hint="Notifié par la CARSAT.">
              <PercentInput value={form.accidentRateBps} onChange={(v) => set('accidentRateBps', v)} />
            </FormField>
          </Block>

          <Block icon={<Percent />} title="Heures supplémentaires" description="Décomptées par semaine au-delà de 35 heures.">
            <Switch
              className="sm:col-span-2"
              label="Barème de la convention HCR"
              description="36e à 39e heure, 40e à 43e, puis au-delà. Sinon, régime légal : +25 % jusqu’à la 43e, +50 % ensuite."
              checked={form.applyHcrOvertime}
              onCheckedChange={(v) =>
                setForm((f) => ({ ...f, applyHcrOvertime: v, overtimeRatesBps: v ? { first: 1000, second: 2000, beyond: 5000 } : { first: 2500, second: 2500, beyond: 5000 } }))
              }
            />
            <FormField label={form.applyHcrOvertime ? '36e à 39e heure' : '36e à 43e heure'}>
              <PercentInput value={form.overtimeRatesBps.first} onChange={(v) => set('overtimeRatesBps', { ...form.overtimeRatesBps, first: v })} />
            </FormField>
            {form.applyHcrOvertime && (
              <FormField label="40e à 43e heure">
                <PercentInput value={form.overtimeRatesBps.second} onChange={(v) => set('overtimeRatesBps', { ...form.overtimeRatesBps, second: v })} />
              </FormField>
            )}
            <FormField label="Au-delà de la 43e heure">
              <PercentInput value={form.overtimeRatesBps.beyond} onChange={(v) => set('overtimeRatesBps', { ...form.overtimeRatesBps, beyond: v })} />
            </FormField>
          </Block>

          <Block icon={<Moon />} title="Nuit, dimanche et jours fériés" description="Majorations appliquées en plus du salaire de base.">
            <FormField label="Début de la plage de nuit">
              <TimeInput value={form.nightWindow.from} onChange={(v) => set('nightWindow', { ...form.nightWindow, from: v })} aria-label="Début de la plage de nuit" />
            </FormField>
            <FormField label="Fin de la plage de nuit">
              <TimeInput value={form.nightWindow.to} onChange={(v) => set('nightWindow', { ...form.nightWindow, to: v })} aria-label="Fin de la plage de nuit" />
            </FormField>
            <FormField label="Majoration de nuit">
              <PercentInput value={form.nightBonusBps} onChange={(v) => set('nightBonusBps', v)} />
            </FormField>
            <FormField label="Majoration du dimanche">
              <PercentInput value={form.sundayBonusBps} onChange={(v) => set('sundayBonusBps', v)} />
            </FormField>
            <FormField label="Majoration des jours fériés travaillés">
              <PercentInput value={form.holidayBonusBps} onChange={(v) => set('holidayBonusBps', v)} />
            </FormField>
          </Block>

          <Block icon={<Utensils />} title="Repas et complémentaire santé" description="Avantage en nature nourriture et mutuelle d’entreprise.">
            <Switch
              className="sm:col-span-2"
              label="Avantage en nature nourriture"
              description="Repas pris sur place, ajouté au brut puis déduit du net."
              checked={form.mealAllowance.enabled}
              onCheckedChange={(v) => set('mealAllowance', { ...form.mealAllowance, enabled: v })}
            />
            <FormField label="Repas par jour travaillé">
              <Select
                value={String(form.mealAllowance.mealsPerDay)}
                onValueChange={(v) => set('mealAllowance', { ...form.mealAllowance, mealsPerDay: Number(v) })}
                options={[
                  { value: '1', label: '1 repas' },
                  { value: '2', label: '2 repas' },
                ]}
              />
            </FormField>
            <FormField label="Valeur d’un repas">
              <EurosInput value={form.mealAllowance.rateCents ?? 0} disabled={!form.mealAllowance.enabled} onChange={(v) => set('mealAllowance', { ...form.mealAllowance, rateCents: v })} />
            </FormField>
            <FormField label="Complémentaire santé : forfait mensuel">
              <EurosInput value={form.healthInsurance.monthlyCents} onChange={(v) => set('healthInsurance', { ...form.healthInsurance, monthlyCents: v })} />
            </FormField>
            <FormField label="Part prise en charge par l’employeur" hint="50 % au minimum.">
              <PercentInput value={form.healthInsurance.employerShareBps} onChange={(v) => set('healthInsurance', { ...form.healthInsurance, employerShareBps: Math.max(5000, Math.min(10000, v)) })} />
            </FormField>
          </Block>
        </div>
      )}
    </PageContainer>
  );
}
