// Création d'un commerce par l'équipe (prospect signé hors ligne) : fiche,
// compte du gérant et lien d'accès. Même traitement serveur que l'import en masse.
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { Store } from 'lucide-react';
import { Button, Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, FormField, Input, Select, toast } from '@golink/ui';
import { MERCHANT_TYPES, MERCHANT_TYPE_LABELS, type MerchantType } from '@golink/shared';
import { useGeoScope } from '@/layout/GeoScope';
import { useMutation } from '@/lib/firestore';
import { PLAN_LABELS, importRestaurants } from '../lib';

const EMPTY = {
  name: '',
  merchantType: 'restaurant' as MerchantType,
  cityId: '',
  line1: '',
  postalCode: '',
  phone: '',
  email: '',
  ownerFirstName: '',
  ownerLastName: '',
  ownerEmail: '',
  legalName: '',
  siret: '',
  planCode: 'basic',
};

export function CreateRestaurantDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const navigate = useNavigate();
  const scope = useGeoScope();
  const [form, setForm] = useState({ ...EMPTY, cityId: scope.cityId ?? '' });
  const [error, setError] = useState<string | null>(null);
  const create = useMutation(importRestaurants);
  const set = (key: keyof typeof EMPTY) => (event: { target: { value: string } }) => setForm((f) => ({ ...f, [key]: event.target.value }));
  const city = scope.cities.find((c) => c.id === form.cityId);
  const ready =
    form.name.trim().length >= 2 &&
    city &&
    form.line1.trim().length >= 3 &&
    form.postalCode.trim() &&
    form.phone.trim() &&
    form.email.includes('@') &&
    form.ownerFirstName.trim() &&
    form.ownerLastName.trim() &&
    form.ownerEmail.includes('@');

  async function submit() {
    if (!city) return;
    setError(null);
    const report = await create.mutate({
      dryRun: false,
      inviteOwners: true,
      rows: [
        {
          name: form.name.trim(),
          merchantType: form.merchantType,
          cityId: city.id,
          line1: form.line1.trim(),
          postalCode: form.postalCode.trim(),
          city: city.name,
          phone: form.phone.trim(),
          email: form.email.trim(),
          ownerFirstName: form.ownerFirstName.trim(),
          ownerLastName: form.ownerLastName.trim(),
          ownerEmail: form.ownerEmail.trim(),
          legalName: form.legalName.trim() || null,
          siret: form.siret.trim() || null,
          planCode: form.planCode as 'basic' | 'pro' | 'premium',
        },
      ],
    });
    if (!report) return;
    const id = report.restaurantIds[0];
    if (!id) {
      setError(report.errors[0]?.message ?? report.warnings[0]?.message ?? 'Ce commerce n’a pas pu être créé.');
      return;
    }
    toast.success(`${form.name.trim()} est créé`, { description: 'Le gérant reçoit un lien pour définir son mot de passe et déposer ses documents.' });
    setForm({ ...EMPTY, cityId: scope.cityId ?? '' });
    onOpenChange(false);
    navigate(`/restaurants/${id}`);
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !create.loading && onOpenChange(next)}>
      <DialogContent size="lg">
        <DialogHeader icon={<Store />} title="Ajouter un commerce" description="Le dossier démarre en « Documents manquants » : le gérant complète ses pièces et signe le contrat depuis son espace." />
        <DialogBody className="space-y-6">
          <fieldset className="space-y-3">
            <legend className="eyebrow mb-1">Établissement</legend>
            <div className="grid gap-3 sm:grid-cols-2">
              <FormField label="Nom commercial" required>
                <Input value={form.name} onChange={set('name')} maxLength={80} placeholder="Le Comptoir de Metz" />
              </FormField>
              <FormField label="Type de commerce">
                <Select value={form.merchantType} onValueChange={(v) => setForm((f) => ({ ...f, merchantType: v as MerchantType }))} options={MERCHANT_TYPES.map((t) => ({ value: t, label: MERCHANT_TYPE_LABELS[t] }))} />
              </FormField>
              <FormField label="Ville" required>
                <Select
                  value={form.cityId}
                  onValueChange={(v) => setForm((f) => ({ ...f, cityId: v }))}
                  placeholder="Choisir une ville"
                  options={scope.cities.map((c) => ({ value: c.id, label: c.active ? c.name : `${c.name} (non lancée)` }))}
                />
              </FormField>
              <FormField label="Formule">
                <Select value={form.planCode} onValueChange={(v) => setForm((f) => ({ ...f, planCode: v }))} options={Object.entries(PLAN_LABELS).map(([value, label]) => ({ value, label }))} />
              </FormField>
              <FormField label="Adresse" required className="sm:col-span-2">
                <Input value={form.line1} onChange={set('line1')} maxLength={120} placeholder="12 rue des Clercs" />
              </FormField>
              <FormField label="Code postal" required>
                <Input value={form.postalCode} onChange={set('postalCode')} maxLength={8} inputMode="numeric" placeholder="57000" />
              </FormField>
              <FormField label="Téléphone" required>
                <Input value={form.phone} onChange={set('phone')} type="tel" placeholder="+33 3 87 00 00 00" />
              </FormField>
              <FormField label="E-mail du commerce" required className="sm:col-span-2">
                <Input value={form.email} onChange={set('email')} type="email" placeholder="contact@exemple.fr" />
              </FormField>
            </div>
          </fieldset>
          <fieldset className="space-y-3">
            <legend className="eyebrow mb-1">Gérant</legend>
            <div className="grid gap-3 sm:grid-cols-2">
              <FormField label="Prénom" required>
                <Input value={form.ownerFirstName} onChange={set('ownerFirstName')} maxLength={60} />
              </FormField>
              <FormField label="Nom" required>
                <Input value={form.ownerLastName} onChange={set('ownerLastName')} maxLength={60} />
              </FormField>
              <FormField label="E-mail de connexion" required hint="Un lien pour définir le mot de passe lui est envoyé." className="sm:col-span-2">
                <Input value={form.ownerEmail} onChange={set('ownerEmail')} type="email" />
              </FormField>
            </div>
          </fieldset>
          <fieldset className="space-y-3">
            <legend className="eyebrow mb-1">Identité légale (facultatif)</legend>
            <div className="grid gap-3 sm:grid-cols-2">
              <FormField label="Raison sociale">
                <Input value={form.legalName} onChange={set('legalName')} maxLength={120} />
              </FormField>
              <FormField label="SIRET ou RCS">
                <Input value={form.siret} onChange={set('siret')} maxLength={20} inputMode="numeric" />
              </FormField>
            </div>
          </fieldset>
          {error && <p className="rounded-lg border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={create.loading}>
            Annuler
          </Button>
          <Button variant="primary" loading={create.loading} disabled={!ready} onClick={() => void submit()}>
            Créer le commerce
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
