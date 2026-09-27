import { useMemo } from 'react';
import { Link } from 'react-router';
import { Building, CircleCheck, FileSignature, Landmark, UserRound } from 'lucide-react';
import { Button, FormField, Input, Select, formatDate } from '@golink/ui';
import {
  RESTAURANT_PRIVATE_DOCS,
  compactIdentifier,
  isValidSiret,
  isValidVatNumber,
  paths,
  type RestaurantLegal,
} from '@golink/shared';
import { useRestaurantAccess } from '@/auth/RestaurantAccess';
import { docAt, errorMessage, toDate, useDoc, useMutation } from '@/lib/firestore';
import { updateRestaurantSettings, type LegalInput } from '../parametres/kit/api';
import { useDraft, useUnsavedGuard } from '../parametres/kit/hooks';
import { MoneyInput } from '../parametres/kit/inputs';
import { LoadError, SaveBar, SettingsCard, SettingsSkeleton, SplitLayout } from '../parametres/kit/ui';

type Draft = Omit<LegalInput, 'section'>;

const LEGAL_FORMS = ['SAS', 'SASU', 'SARL', 'EURL', 'SA', 'SNC', 'EI', 'Micro-entreprise', 'SARL-S (LU)', 'Autre'].map((v) => ({ value: v, label: v }));
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHONE = /^\+?[0-9 .()-]{6,20}$/;

/** Identité légale (facturation, DAC7), représentant légal, licence. Lecture : settings.manage. */
export function LegalTab({ active }: { active: boolean }) {
  const { restaurant, restaurantId } = useRestaurantAccess();
  const legal = useDoc<RestaurantLegal>(docAt(`${paths.restaurant(restaurantId)}/private/${RESTAURANT_PRIVATE_DOCS.legal}`));
  const lu = restaurant.countryId === 'LU';

  const source = useMemo<Draft | null>(() => {
    if (legal.loading) return null;
    const l = legal.data;
    return {
      legalName: l?.legalName ?? '',
      legalForm: l?.legalForm ?? null,
      siret: l?.siret ?? '',
      vatNumber: l?.vatNumber ?? '',
      rcsCity: l?.rcsCity ?? '',
      shareCapitalCents: l?.shareCapitalCents ?? null,
      registeredAddress: {
        line1: l?.registeredAddress?.line1 ?? '',
        line2: l?.registeredAddress?.line2 ?? '',
        postalCode: l?.registeredAddress?.postalCode ?? '',
        city: l?.registeredAddress?.city ?? '',
      },
      managerName: l?.managerName ?? '',
      managerEmail: l?.managerEmail ?? '',
      managerPhone: l?.managerPhone ?? '',
      managerBirthDate: l?.managerBirthDate ?? null,
      alcoholLicenseNumber: null,
      taxIdentificationNumber: l?.taxIdentificationNumber ?? '',
    };
  }, [legal.data, legal.loading]);
  const { draft, setDraft, dirty, reset, markSaved } = useDraft<Draft>(source, restaurantId);
  useUnsavedGuard(dirty);
  const save = useMutation(updateRestaurantSettings, { success: 'Informations légales enregistrées.' });

  if (legal.error) return <LoadError message={errorMessage(legal.error)} />;
  if (!draft || !source) return <SettingsSkeleton />;

  const siretChanged = compactIdentifier(draft.siret) !== compactIdentifier(source.siret);
  const vatChanged = compactIdentifier(draft.vatNumber ?? '') !== compactIdentifier(source.vatNumber ?? '');
  const errors = {
    legalName: draft.legalName.trim().length < 2 ? 'Raison sociale obligatoire.' : null,
    siret: !draft.siret.trim()
      ? 'Obligatoire.'
      : siretChanged && !isValidSiret(draft.siret, restaurant.countryId)
        ? lu
          ? 'Numéro RCS invalide (ex. B123456).'
          : 'SIRET invalide : 14 chiffres, clé de contrôle incorrecte.'
        : null,
    vatNumber: draft.vatNumber && vatChanged && !isValidVatNumber(draft.vatNumber) ? 'Numéro de TVA invalide.' : null,
    address: !draft.registeredAddress.line1.trim() || !draft.registeredAddress.postalCode.trim() || !draft.registeredAddress.city.trim() ? 'Adresse du siège incomplète.' : null,
    managerName: draft.managerName.trim().length < 2 ? 'Obligatoire.' : null,
    managerEmail: !EMAIL.test(draft.managerEmail.trim()) ? 'Adresse e-mail invalide.' : null,
    managerPhone: !PHONE.test(draft.managerPhone.trim()) ? 'Numéro invalide.' : null,
  };
  const invalid = Object.values(errors).some(Boolean);
  const dac7 = Boolean(draft.legalName && draft.siret && draft.taxIdentificationNumber && draft.registeredAddress.line1);
  const setAddress = (patch: Partial<Draft['registeredAddress']>) =>
    setDraft((d) => ({ ...d, registeredAddress: { ...d.registeredAddress, ...patch } }));

  const onSave = async () => {
    const trim = (v: string | null) => (v ? v.trim() || null : null);
    const result = await save.mutate({
      restaurantId,
      section: 'legal',
      legalName: draft.legalName.trim(),
      legalForm: draft.legalForm,
      siret: draft.siret.trim(),
      vatNumber: trim(draft.vatNumber),
      rcsCity: trim(draft.rcsCity),
      shareCapitalCents: draft.shareCapitalCents,
      registeredAddress: {
        line1: draft.registeredAddress.line1.trim(),
        line2: trim(draft.registeredAddress.line2),
        postalCode: draft.registeredAddress.postalCode.trim(),
        city: draft.registeredAddress.city.trim(),
      },
      managerName: draft.managerName.trim(),
      managerEmail: draft.managerEmail.trim(),
      managerPhone: draft.managerPhone.trim(),
      managerBirthDate: draft.managerBirthDate || null,
      alcoholLicenseNumber: null,
      taxIdentificationNumber: trim(draft.taxIdentificationNumber),
    });
    if (result) markSaved();
  };

  const acceptedAt = toDate(legal.data?.partnerTermsAcceptedAt);

  return (
    <>
      <SplitLayout
        aside={
          <>
            <div className="rounded-xl border border-border bg-surface p-5 shadow-card">
              <p className="eyebrow">Déclaration DAC7</p>
              <p className="mt-2 flex items-center gap-2 font-display text-lg font-semibold text-fg">
                {dac7 ? <CircleCheck className="size-5 text-success" /> : null}
                {dac7 ? 'Dossier complet' : 'Informations manquantes'}
              </p>
              <p className="mt-1.5 text-sm leading-5 text-fg-muted">
                Ciyou Eats déclare chaque année aux impôts les ventes réalisées par les établissements partenaires (directive européenne DAC7). Raison sociale, numéro
                d’immatriculation, adresse du siège et numéro fiscal sont requis.
              </p>
            </div>
            <div className="rounded-xl border border-border bg-surface p-5 shadow-card">
              <p className="eyebrow">Contrat partenaire</p>
              {legal.data?.partnerTermsVersion ? (
                <>
                  <p className="mt-2 font-display text-lg font-semibold text-fg">Version {legal.data.partnerTermsVersion}</p>
                  <p className="mt-1 text-sm text-fg-muted">
                    Accepté {acceptedAt ? `le ${formatDate(acceptedAt)}` : ''}
                    {legal.data.partnerTermsSignatureName ? ` par ${legal.data.partnerTermsSignatureName}` : ''}.
                  </p>
                </>
              ) : (
                <p className="mt-2 text-sm text-fg-muted">Aucun contrat signé pour le moment.</p>
              )}
              <Button asChild variant="secondary" size="sm" className="mt-4" leftIcon={<FileSignature />}>
                <Link to="/documents">Documents et contrat</Link>
              </Button>
            </div>
            {legal.data?.ibanMasked && (
              <div className="rounded-xl border border-border bg-surface p-5 shadow-card">
                <p className="eyebrow">Compte bancaire</p>
                <p className="mt-2 font-mono text-sm text-fg num">{legal.data.ibanMasked}</p>
                <p className="mt-1 text-xs text-fg-subtle">Le RIB complet est conservé par notre prestataire de paiement.</p>
              </div>
            )}
          </>
        }
      >
        <SettingsCard icon={<Building />} title="Société" description="Telle qu’elle figure sur votre extrait d’immatriculation. Utilisée sur les factures Ciyou Eats.">
          <div className="grid gap-5">
            <div className="grid gap-5 sm:grid-cols-[minmax(0,1fr)_200px]">
              <FormField label="Raison sociale" required error={errors.legalName}>
                <Input value={draft.legalName} onChange={(e) => setDraft({ legalName: e.target.value })} />
              </FormField>
              <FormField label="Forme juridique">
                <Select options={LEGAL_FORMS} value={draft.legalForm ?? undefined} placeholder="Choisir" onValueChange={(v) => setDraft({ legalForm: v })} />
              </FormField>
            </div>
            <div className="grid gap-5 sm:grid-cols-2">
              <FormField
                label={lu ? 'Numéro RCS' : 'SIRET'}
                required
                error={errors.siret}
                hint={siretChanged ? undefined : lu ? 'Registre de commerce et des sociétés.' : '14 chiffres, sur votre avis de situation.'}
              >
                <Input value={draft.siret} className="font-mono" inputMode={lu ? 'text' : 'numeric'} onChange={(e) => setDraft({ siret: e.target.value })} />
              </FormField>
              <FormField label="TVA intracommunautaire" error={errors.vatNumber} hint={lu ? 'Ex. LU12345678' : 'Ex. FR40303265045'}>
                <Input value={draft.vatNumber ?? ''} className="font-mono" onChange={(e) => setDraft({ vatNumber: e.target.value.toUpperCase() })} />
              </FormField>
              <FormField label={lu ? 'Ville du registre' : 'Ville du RCS'}>
                <Input value={draft.rcsCity ?? ''} onChange={(e) => setDraft({ rcsCity: e.target.value })} />
              </FormField>
              <FormField label="Capital social">
                <MoneyInput nullable value={draft.shareCapitalCents} onChange={(v) => setDraft({ shareCapitalCents: v })} />
              </FormField>
              <FormField label="Numéro fiscal (NIF)" hint="Requis pour la déclaration DAC7.">
                <Input value={draft.taxIdentificationNumber ?? ''} className="font-mono" onChange={(e) => setDraft({ taxIdentificationNumber: e.target.value })} />
              </FormField>
            </div>
          </div>
        </SettingsCard>

        <SettingsCard icon={<Landmark />} title="Siège social" description="Adresse légale de la société (peut différer de l’adresse de l’établissement).">
          <div className="grid gap-5">
            <FormField label="Adresse" required error={errors.address}>
              <Input value={draft.registeredAddress.line1} onChange={(e) => setAddress({ line1: e.target.value })} />
            </FormField>
            <FormField label="Complément">
              <Input value={draft.registeredAddress.line2 ?? ''} onChange={(e) => setAddress({ line2: e.target.value })} />
            </FormField>
            <div className="grid gap-5 sm:grid-cols-[140px_minmax(0,1fr)]">
              <FormField label="Code postal" required>
                <Input value={draft.registeredAddress.postalCode} onChange={(e) => setAddress({ postalCode: e.target.value })} />
              </FormField>
              <FormField label="Ville" required>
                <Input value={draft.registeredAddress.city} onChange={(e) => setAddress({ city: e.target.value })} />
              </FormField>
            </div>
            <Button
              variant="link"
              className="justify-self-start"
              onClick={() =>
                setAddress({
                  line1: restaurant.address.line1,
                  line2: restaurant.address.line2 ?? '',
                  postalCode: restaurant.address.postalCode,
                  city: restaurant.address.city,
                })
              }
            >
              Reprendre l’adresse de l’établissement
            </Button>
          </div>
        </SettingsCard>

        <SettingsCard icon={<UserRound />} title="Représentant légal" description="Gérant ou président : interlocuteur de Ciyou Eats pour le contrat.">
          <div className="grid gap-5 sm:grid-cols-2">
            <FormField label="Nom et prénom" required error={errors.managerName}>
              <Input value={draft.managerName} autoComplete="name" onChange={(e) => setDraft({ managerName: e.target.value })} />
            </FormField>
            <FormField label="Date de naissance" hint="Demandée par notre prestataire de paiement.">
              <Input type="date" value={draft.managerBirthDate ?? ''} max={new Date().toISOString().slice(0, 10)} onChange={(e) => setDraft({ managerBirthDate: e.target.value || null })} />
            </FormField>
            <FormField label="E-mail" required error={errors.managerEmail}>
              <Input type="email" value={draft.managerEmail} onChange={(e) => setDraft({ managerEmail: e.target.value })} />
            </FormField>
            <FormField label="Téléphone" required error={errors.managerPhone}>
              <Input inputMode="tel" value={draft.managerPhone} onChange={(e) => setDraft({ managerPhone: e.target.value })} />
            </FormField>
          </div>
        </SettingsCard>

      </SplitLayout>
      {active && (
        <SaveBar
          dirty={dirty}
          saving={save.loading}
          disabled={invalid}
          message={invalid ? 'Corrigez les champs signalés' : 'Informations légales modifiées'}
          onSave={() => void onSave()}
          onReset={reset}
        />
      )}
    </>
  );
}
