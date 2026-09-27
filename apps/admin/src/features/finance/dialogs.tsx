// Dialogues de la rubrique Finance : construction des reversements, calendrier,
// blocage, ajustement manuel.
import { useEffect, useMemo, useState } from 'react';
import { CalendarClock, Calculator, ShieldBan, SlidersHorizontal } from 'lucide-react';
import {
  Badge,
  Combobox,
  FormField,
  Input,
  RadioGroup,
  Select,
  SegmentedControl,
  Skeleton,
} from '@golink/ui';
import {
  COLLECTIONS,
  PAYOUT_FREQUENCY_LABELS,
  PAYOUT_HOLD_REASONS,
  PAYOUT_HOLD_REASON_LABELS,
  SETTINGS_DOCS,
  type BuildPayoutsResult,
  type PayoutHoldReason,
  type PayoutSettings,
} from '@golink/shared';
import { useGeoScope } from '@/layout/GeoScope';
import { docAt, errorMessage, useDoc, useMutation } from '@/lib/firestore';
import { buildPayoutsNow, createAdjustment, holdPayouts, updateFinanceSettings, type ScheduleInput } from '../argent-commun/api';
import { ActionDialog, Callout, Money } from '../argent-commun/components';
import { addDays, day, eur, isoDay, parseEuros, plural, toEurosInput } from '../argent-commun/format';
import { inGeo, useDirectory } from '../argent-commun/hooks';

const WEEKDAYS = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'];

/** Sélecteur de bénéficiaire (commerce ou livreur) du périmètre courant. */
export function BeneficiaryPicker({ type, value, onChange }: { type: 'restaurant' | 'driver'; value: string | undefined; onChange: (id: string | undefined) => void }) {
  const directory = useDirectory();
  const geo = useGeoScope();
  const options = useMemo(
    () =>
      (type === 'restaurant' ? directory.restaurants : directory.drivers)
        .filter((x) => inGeo(geo, x))
        .map((x) =>
          type === 'restaurant'
            ? { value: x.id, label: (x as { name: string }).name, description: (x as { address?: { city?: string } }).address?.city }
            : { value: x.id, label: `${(x as { firstName: string }).firstName} ${(x as { lastName: string }).lastName}`, description: (x as { email?: string }).email },
        )
        .sort((a, b) => a.label.localeCompare(b.label, 'fr')),
    [type, directory.restaurants, directory.drivers, geo],
  );
  return (
    <Combobox
      aria-label={type === 'restaurant' ? 'Commerce' : 'Livreur'}
      options={options}
      value={value}
      onChange={onChange}
      placeholder={directory.loading ? 'Chargement…' : type === 'restaurant' ? 'Choisir un commerce' : 'Choisir un livreur'}
      searchPlaceholder="Rechercher par nom…"
      emptyText="Aucun résultat dans ce périmètre"
      className="w-full"
    />
  );
}

// ------------------------------------------------------------------ Construction manuelle

export function BuildPayoutsDialog({ open, onOpenChange, defaultType }: { open: boolean; onOpenChange: (open: boolean) => void; defaultType: 'restaurant' | 'driver' }) {
  const [type, setType] = useState<'restaurant' | 'driver'>(defaultType);
  const [until, setUntil] = useState(addDays(isoDay(new Date()), -1));
  const [beneficiaryId, setBeneficiaryId] = useState<string | undefined>();
  const [preview, setPreview] = useState<BuildPayoutsResult | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const build = useMutation(buildPayoutsNow, { success: (r) => (r.created ? `${plural(r.created, 'reversement')} créé${r.created > 1 ? 's' : ''}` : 'Aucun reversement à créer') });

  useEffect(() => {
    if (open) setType(defaultType);
  }, [open, defaultType]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setPreviewing(true);
    setPreviewError(null);
    buildPayoutsNow({ beneficiaryType: type, until, beneficiaryId: beneficiaryId ?? null, dryRun: true })
      .then((r) => !cancelled && setPreview(r))
      .catch((error: unknown) => !cancelled && setPreviewError(errorMessage(error)))
      .finally(() => !cancelled && setPreviewing(false));
    return () => {
      cancelled = true;
    };
  }, [open, type, until, beneficiaryId]);

  const toCreate = preview?.preview.filter((p) => p.status !== 'below_minimum') ?? [];
  return (
    <ActionDialog
      open={open}
      onOpenChange={onOpenChange}
      size="md"
      icon={<Calculator />}
      title="Construire les reversements"
      description="Regroupe les mouvements du grand livre non encore reversés jusqu’à la date choisie. Le calendrier automatique fait la même chose chaque nuit."
      confirmLabel={toCreate.length ? `Créer ${plural(toCreate.length, 'reversement')}` : 'Créer'}
      disabled={previewing || toCreate.length === 0}
      onSubmit={async () => Boolean(await build.mutate({ beneficiaryType: type, until, beneficiaryId: beneficiaryId ?? null }))}
      requireReason={false}
    >
      <SegmentedControl
        aria-label="Bénéficiaires"
        value={type}
        onValueChange={(v) => {
          setType(v as 'restaurant' | 'driver');
          setBeneficiaryId(undefined);
        }}
        options={[
          { value: 'restaurant', label: 'Commerces' },
          { value: 'driver', label: 'Livreurs' },
        ]}
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label="Mouvements jusqu’au" hint="Inclus, au plus tard hier.">
          <Input type="date" value={until} max={addDays(isoDay(new Date()), -1)} onChange={(e) => e.target.value && setUntil(e.target.value)} />
        </FormField>
        <FormField label="Bénéficiaire" hint="Laisser vide pour tous.">
          <BeneficiaryPicker type={type} value={beneficiaryId} onChange={setBeneficiaryId} />
        </FormField>
      </div>
      <div className="rounded-xl border border-border">
        <div className="flex items-center justify-between border-b border-border bg-surface-2 px-4 py-2.5">
          <p className="text-sm font-medium text-fg">Aperçu</p>
          {preview && !previewing && <p className="font-mono text-sm text-fg num">{eur(preview.totalNetCents)}</p>}
        </div>
        <div className="max-h-64 overflow-y-auto">
          {previewing ? (
            <div className="space-y-2 p-4">{Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-8 w-full" />)}</div>
          ) : previewError ? (
            <p className="p-4 text-sm text-danger">{previewError}</p>
          ) : !preview?.preview.length ? (
            <p className="p-4 text-sm text-fg-muted">Aucun mouvement en attente de reversement jusqu’au {day(until)}.</p>
          ) : (
            <ul className="divide-y divide-border">
              {preview.preview.map((p) => (
                <li key={p.beneficiaryId} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                  <div className="min-w-0">
                    <p className="truncate text-fg">{p.beneficiaryName}</p>
                    <p className="text-xs text-fg-subtle">{plural(p.entries, 'mouvement')}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {p.status === 'on_hold' && <Badge tone="plum" size="sm">Bloqué</Badge>}
                    {p.status === 'below_minimum' && <Badge tone="neutral" size="sm">Sous le minimum, reporté</Badge>}
                    <Money cents={p.netCents} className="text-fg" />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </ActionDialog>
  );
}

// ------------------------------------------------------------------ Calendrier

function ScheduleFields({ label, value, onChange }: { label: string; value: ScheduleInput; onChange: (next: ScheduleInput) => void }) {
  const [minimum, setMinimum] = useState(toEurosInput(value.minimumCents));
  useEffect(() => setMinimum(toEurosInput(value.minimumCents)), [value.minimumCents]);
  return (
    <fieldset className="space-y-3 rounded-xl border border-border p-4">
      <legend className="px-1 text-sm font-semibold text-fg">{label}</legend>
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label="Rythme">
          <Select value={value.frequency} onValueChange={(v) => onChange({ ...value, frequency: v as ScheduleInput['frequency'] })} options={Object.entries(PAYOUT_FREQUENCY_LABELS).map(([v, l]) => ({ value: v, label: l }))} />
        </FormField>
        <FormField label="Jour de calcul" hint={value.frequency === 'monthly' ? 'Le 1er de chaque mois.' : undefined}>
          <Select disabled={value.frequency === 'monthly'} value={String(value.dayOfWeek)} onValueChange={(v) => onChange({ ...value, dayOfWeek: Number(v) })} options={WEEKDAYS.map((d, i) => ({ value: String(i), label: d }))} />
        </FormField>
        <FormField label="Montant minimum" hint="En dessous, le solde est reporté.">
          <Input inputMode="decimal" value={minimum} trailing="€" onChange={(e) => setMinimum(e.target.value)} onBlur={() => { const c = parseEuros(minimum); if (c !== null && c >= 0) onChange({ ...value, minimumCents: c }); else setMinimum(toEurosInput(value.minimumCents)); }} />
        </FormField>
        <FormField label="Délai de versement" hint="Jours entre le calcul et le virement.">
          <Input type="number" min={0} max={30} value={value.delayDays} onChange={(e) => onChange({ ...value, delayDays: Math.max(0, Math.min(30, Number(e.target.value) || 0)) })} trailing="j" />
        </FormField>
      </div>
    </fieldset>
  );
}

export function ScheduleDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const settings = useDoc<PayoutSettings>(open ? docAt(`${COLLECTIONS.settings}/${SETTINGS_DOCS.payouts}`) : null);
  const [draft, setDraft] = useState<{ restaurants: ScheduleInput; drivers: ScheduleInput } | null>(null);
  const save = useMutation(updateFinanceSettings, { success: 'Calendrier des reversements enregistré' });
  useEffect(() => {
    if (open && settings.data) setDraft({ restaurants: { ...settings.data.restaurants }, drivers: { ...settings.data.drivers } });
  }, [open, settings.data]);
  return (
    <ActionDialog
      open={open}
      onOpenChange={onOpenChange}
      size="md"
      icon={<CalendarClock />}
      title="Calendrier des reversements"
      description="Rythme par défaut de la plateforme. Un commerce peut avoir son propre rythme (rubrique Paiements, onglet Commerces)."
      confirmLabel="Enregistrer"
      disabled={!draft}
      onSubmit={async (reason) => Boolean(draft && (await save.mutate({ doc: 'payouts', reason, data: draft })))}
    >
      {settings.loading || !draft ? (
        <Skeleton className="h-64 w-full" />
      ) : (
        <>
          <ScheduleFields label="Commerces" value={draft.restaurants} onChange={(restaurants) => setDraft({ ...draft, restaurants })} />
          <ScheduleFields label="Livreurs" value={draft.drivers} onChange={(drivers) => setDraft({ ...draft, drivers })} />
        </>
      )}
    </ActionDialog>
  );
}

// ------------------------------------------------------------------ Blocage

export function HoldDialog({
  open,
  onOpenChange,
  beneficiary,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  beneficiary?: { type: 'restaurant' | 'driver'; id: string; name: string } | null;
}) {
  const [type, setType] = useState<'restaurant' | 'driver'>(beneficiary?.type ?? 'restaurant');
  const [id, setId] = useState<string | undefined>(beneficiary?.id);
  const [reason, setReason] = useState<PayoutHoldReason>('dispute');
  const hold = useMutation(holdPayouts, { success: (r) => (r.payoutsHeld ? `Reversements bloqués (${r.payoutsHeld} en attente suspendu${r.payoutsHeld > 1 ? 's' : ''})` : 'Reversements bloqués') });
  useEffect(() => {
    if (open) {
      setType(beneficiary?.type ?? 'restaurant');
      setId(beneficiary?.id);
    }
  }, [open, beneficiary]);
  return (
    <ActionDialog
      open={open}
      onOpenChange={onOpenChange}
      destructive
      icon={<ShieldBan className="text-danger" />}
      title={beneficiary ? `Bloquer les reversements de ${beneficiary.name}` : 'Bloquer des reversements'}
      description="Les reversements programmés sont suspendus et aucun virement ne part tant que le blocage est actif. L’argent reste dû au bénéficiaire."
      confirmLabel="Bloquer les reversements"
      reasonLabel="Précisions (visibles par l’équipe, conservées dans l’audit)"
      reasonPlaceholder="Ex. : contestation bancaire en cours sur la commande GL-10482."
      disabled={!id}
      onSubmit={async (details) => Boolean(id && (await hold.mutate({ beneficiaryType: type, beneficiaryId: id, reason, details })))}
    >
      {!beneficiary && (
        <>
          <SegmentedControl aria-label="Type de bénéficiaire" value={type} onValueChange={(v) => { setType(v as 'restaurant' | 'driver'); setId(undefined); }} options={[{ value: 'restaurant', label: 'Commerce' }, { value: 'driver', label: 'Livreur' }]} />
          <FormField label={type === 'restaurant' ? 'Commerce' : 'Livreur'}>
            <BeneficiaryPicker type={type} value={id} onChange={setId} />
          </FormField>
        </>
      )}
      <FormField label="Motif du blocage">
        <RadioGroup value={reason} onValueChange={(v) => setReason(v as PayoutHoldReason)} options={PAYOUT_HOLD_REASONS.map((r) => ({ value: r, label: PAYOUT_HOLD_REASON_LABELS[r] }))} />
      </FormField>
    </ActionDialog>
  );
}

// ------------------------------------------------------------------ Ajustement

export function AdjustmentDialog({
  open,
  onOpenChange,
  beneficiary,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  beneficiary?: { type: 'restaurant' | 'driver'; id: string; name: string } | null;
}) {
  const [type, setType] = useState<'restaurant' | 'driver'>(beneficiary?.type ?? 'restaurant');
  const [id, setId] = useState<string | undefined>(beneficiary?.id);
  const [direction, setDirection] = useState<'credit' | 'debit'>('credit');
  const [amount, setAmount] = useState('');
  const [label, setLabel] = useState('');
  const [orderRef, setOrderRef] = useState('');
  const create = useMutation(createAdjustment, { success: 'Ajustement enregistré : il sera repris au prochain reversement' });
  useEffect(() => {
    if (open) {
      setType(beneficiary?.type ?? 'restaurant');
      setId(beneficiary?.id);
      setAmount('');
      setLabel('');
      setOrderRef('');
      setDirection('credit');
    }
  }, [open, beneficiary]);
  const cents = parseEuros(amount);
  const valid = Boolean(id) && cents !== null && cents > 0 && label.trim().length >= 3;
  return (
    <ActionDialog
      open={open}
      onOpenChange={onOpenChange}
      icon={<SlidersHorizontal />}
      title={beneficiary ? `Ajustement pour ${beneficiary.name}` : 'Nouvel ajustement manuel'}
      description="Correction ajoutée au grand livre du bénéficiaire, reprise automatiquement dans son prochain reversement."
      confirmLabel={cents ? `${direction === 'credit' ? 'Créditer' : 'Retenir'} ${eur(cents)}` : 'Enregistrer'}
      disabled={!valid}
      onSubmit={async (reason) =>
        Boolean(
          id &&
            cents &&
            (await create.mutate({
              beneficiaryType: type,
              beneficiaryId: id,
              amountCents: direction === 'credit' ? cents : -cents,
              label: label.trim(),
              reason,
              orderId: orderRef.trim() || null,
            })),
        )
      }
    >
      {!beneficiary && (
        <>
          <SegmentedControl aria-label="Type de bénéficiaire" value={type} onValueChange={(v) => { setType(v as 'restaurant' | 'driver'); setId(undefined); }} options={[{ value: 'restaurant', label: 'Commerce' }, { value: 'driver', label: 'Livreur' }]} />
          <FormField label={type === 'restaurant' ? 'Commerce' : 'Livreur'}>
            <BeneficiaryPicker type={type} value={id} onChange={setId} />
          </FormField>
        </>
      )}
      <FormField label="Sens">
        <RadioGroup
          variant="cards"
          value={direction}
          onValueChange={(v) => setDirection(v as 'credit' | 'debit')}
          options={[
            { value: 'credit', label: 'Crédit', description: 'Somme due au bénéficiaire' },
            { value: 'debit', label: 'Retenue', description: 'Somme déduite du reversement' },
          ]}
        />
      </FormField>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label="Montant" required>
          <Input inputMode="decimal" placeholder="0,00" value={amount} onChange={(e) => setAmount(e.target.value)} trailing="€" invalid={amount !== '' && (cents === null || cents <= 0)} />
        </FormField>
        <FormField label="Commande liée" hint="Identifiant, facultatif.">
          <Input placeholder="o-10482" value={orderRef} onChange={(e) => setOrderRef(e.target.value)} />
        </FormField>
      </div>
      <FormField label="Libellé sur le relevé" required>
        <Input placeholder="Ex. : geste commercial suite à une panne de terminal" value={label} maxLength={120} onChange={(e) => setLabel(e.target.value)} />
      </FormField>
      {direction === 'debit' && cents ? (
        <Callout tone="amber" title="Retenue sur le prochain reversement">
          {eur(cents)} seront déduits du prochain reversement ; si le solde devient négatif, il est reporté.
        </Callout>
      ) : null}
    </ActionDialog>
  );
}

