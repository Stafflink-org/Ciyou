// Formulaire de prospect et changement d'étape (motif de perte, restaurant inscrit).
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { ArrowRightLeft, Target } from 'lucide-react';
import {
  Button,
  Combobox,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  FormField,
  Input,
  Select,
  SheetBody,
  SheetContent,
  SheetFooter,
  SheetHeader,
  Textarea,
} from '@golink/ui';
import { PROSPECT_STAGE_LABELS, type ProspectStage } from '@golink/shared';
import { useAuth } from '@golink/web';
import { useGeoScope } from '@/layout/GeoScope';
import { toMillis, useMutation } from '@/lib/firestore';
import { moveProspect, saveProspect, type ProspectInput } from '../_croissance/api';
import { useRestaurantOptions, useSalesTeam } from '../_croissance/hooks';
import { SOURCE_LABELS } from '../_croissance/labels';
import { DateTimeField, NumberInput } from '../_croissance/ui';
import type { ProspectRow } from './lib';

export function ProspectFormSheet({ prospect, onDone }: { prospect: ProspectRow | null; onDone: () => void }) {
  const navigate = useNavigate();
  const geo = useGeoScope();
  const { user } = useAuth();
  const team = useSalesTeam();
  const defaultCity = prospect?.cityId ?? geo.cityId ?? geo.cities[0]?.id ?? '';
  const [d, setD] = useState<ProspectInput>(() => ({
    prospectId: prospect?.id ?? null,
    name: prospect?.name ?? '',
    countryId: prospect?.countryId ?? geo.cities.find((c) => c.id === defaultCity)?.countryId ?? 'FR',
    cityId: defaultCity,
    cuisine: prospect?.cuisine ?? null,
    contactName: prospect?.contactName ?? null,
    contactEmail: prospect?.contactEmail ?? null,
    contactPhone: prospect?.contactPhone ?? null,
    source: prospect?.source ?? 'field',
    ownerId: prospect?.ownerId ?? user?.uid ?? '',
    estimatedMonthlyOrders: prospect?.estimatedMonthlyOrders ?? null,
    nextFollowUpAt: toMillis(prospect?.nextFollowUpAt) ?? null,
    notes: prospect?.notes ?? null,
  }));
  const [touched, setTouched] = useState(false);
  const { mutate, loading } = useMutation(saveProspect, { success: prospect ? 'Prospect mis à jour' : 'Prospect créé' });
  const set = <K extends keyof ProspectInput>(k: K, v: ProspectInput[K]) => setD((x) => ({ ...x, [k]: v }));
  const errors = {
    name: d.name.trim().length < 2 ? 'Indiquez le nom de l’établissement.' : undefined,
    cityId: !d.cityId ? 'Choisissez une ville.' : undefined,
    ownerId: !d.ownerId ? 'Choisissez un commercial.' : undefined,
    contactEmail: d.contactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.contactEmail) ? 'Adresse e-mail invalide.' : undefined,
    contactPhone: d.contactPhone && !/^\+?[0-9 .()-]{6,20}$/.test(d.contactPhone) ? 'Numéro invalide.' : undefined,
  };
  const valid = !Object.values(errors).some(Boolean);
  const e = (k: keyof typeof errors) => (touched ? errors[k] : undefined);
  const owners = team.reps.some((r) => r.uid === d.ownerId) || !d.ownerId ? team.reps : [...team.reps, { uid: d.ownerId, displayName: prospect?.ownerName ?? 'Commercial', email: '', role: '', cityIds: [] }];

  return (
    <SheetContent className="sm:max-w-xl" aria-describedby={undefined}>
      <SheetHeader title={prospect ? 'Modifier le prospect' : 'Nouveau prospect'} description="Établissement démarché et personne à contacter." icon={<Target />} />
      <SheetBody className="space-y-5">
        <FormField label="Établissement" required error={e('name')}>
          <Input value={d.name} maxLength={120} onChange={(x) => set('name', x.target.value)} placeholder="Ex. Brasserie des Remparts" />
        </FormField>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="Ville" required error={e('cityId')}>
            <Select
              value={d.cityId || undefined}
              onValueChange={(v) => setD((x) => ({ ...x, cityId: v, countryId: geo.cities.find((c) => c.id === v)?.countryId ?? x.countryId }))}
              placeholder="Choisir une ville"
              options={geo.cities.map((c) => ({ value: c.id, label: c.name }))}
            />
          </FormField>
          <FormField label="Cuisine ou type de commerce">
            <Input value={d.cuisine ?? ''} maxLength={60} onChange={(x) => set('cuisine', x.target.value || null)} placeholder="Italien, boulangerie…" />
          </FormField>
          <FormField label="Contact">
            <Input value={d.contactName ?? ''} maxLength={80} onChange={(x) => set('contactName', x.target.value || null)} placeholder="Nom du gérant" />
          </FormField>
          <FormField label="Téléphone" error={e('contactPhone')}>
            <Input type="tel" value={d.contactPhone ?? ''} onChange={(x) => set('contactPhone', x.target.value || null)} />
          </FormField>
          <FormField label="E-mail" error={e('contactEmail')} className="sm:col-span-2">
            <Input type="email" value={d.contactEmail ?? ''} onChange={(x) => set('contactEmail', x.target.value.trim() || null)} />
          </FormField>
          <FormField label="Origine">
            <Select value={d.source} onValueChange={(v) => set('source', v as ProspectInput['source'])} options={Object.entries(SOURCE_LABELS).map(([value, label]) => ({ value, label }))} />
          </FormField>
          <FormField label="Commercial" required error={e('ownerId')}>
            <Select
              value={d.ownerId || undefined}
              onValueChange={(v) => set('ownerId', v)}
              placeholder={team.loading ? 'Chargement…' : 'Choisir'}
              options={owners.map((r) => ({ value: r.uid, label: r.displayName, description: r.email || undefined }))}
            />
          </FormField>
          <FormField label="Commandes estimées par mois">
            <NumberInput value={d.estimatedMonthlyOrders} onChange={(v) => set('estimatedMonthlyOrders', v)} unit="cmd" />
          </FormField>
          <FormField label="Prochaine relance">
            <DateTimeField value={d.nextFollowUpAt} onChange={(v) => set('nextFollowUpAt', v)} placeholder="Aucune" />
          </FormField>
        </div>
        <FormField label="Notes">
          <Textarea rows={4} maxLength={2000} value={d.notes ?? ''} onChange={(x) => set('notes', x.target.value || null)} placeholder="Contexte, attentes, concurrents en place…" />
        </FormField>
      </SheetBody>
      <SheetFooter>
        <Button variant="ghost" onClick={onDone}>
          Annuler
        </Button>
        <Button
          variant="primary"
          loading={loading}
          onClick={async () => {
            setTouched(true);
            if (!valid) return;
            const res = await mutate({ ...d, name: d.name.trim() });
            if (!res) return;
            onDone();
            if (!prospect) void navigate(`/prospection/${res.prospectId}`);
          }}
        >
          {prospect ? 'Enregistrer' : 'Créer le prospect'}
        </Button>
      </SheetFooter>
    </SheetContent>
  );
}

/** Confirmation d'un changement d'étape (motif de perte, restaurant inscrit, relance). */
export function StageDialog({ prospect, to, onClose }: { prospect: ProspectRow; to: ProspectStage; onClose: () => void }) {
  const restaurants = useRestaurantOptions();
  const [summary, setSummary] = useState('');
  const [lostReason, setLostReason] = useState('');
  const [restaurantId, setRestaurantId] = useState<string | undefined>(prospect.restaurantId ?? undefined);
  const [followUp, setFollowUp] = useState<number | null>(null);
  const { mutate, loading } = useMutation(moveProspect, { success: `Étape « ${PROSPECT_STAGE_LABELS[to]} »` });
  const closed = to === 'signed_up' || to === 'lost';
  const invalid = to === 'lost' && lostReason.trim().length < 3;
  return (
    <Dialog open onOpenChange={(o) => !o && !loading && onClose()}>
      <DialogContent size="md">
        <DialogHeader
          icon={<ArrowRightLeft />}
          title={`${prospect.name} → ${PROSPECT_STAGE_LABELS[to]}`}
          description={
            to === 'signed_up'
              ? 'Reliez le restaurant inscrit : la prime du commercial est créée automatiquement.'
              : to === 'lost'
                ? 'Le motif aide à comprendre les objections des restaurants.'
                : 'Ajoutez un commentaire et la prochaine relance.'
          }
        />
        <DialogBody className="space-y-4">
          {to === 'signed_up' && (
            <FormField label="Restaurant inscrit sur GoLink" hint="Facultatif si l’inscription est en cours.">
              <Combobox
                value={restaurantId}
                onChange={(v: string | undefined) => setRestaurantId(v)}
                options={restaurants.options.filter((r) => r.cityId === prospect.cityId).map((r) => ({ value: r.id, label: r.name }))}
                placeholder="Choisir le restaurant"
                searchPlaceholder="Rechercher"
                emptyText="Aucun restaurant dans cette ville"
              />
            </FormField>
          )}
          {to === 'lost' && (
            <FormField label="Motif de la perte" required>
              <Textarea rows={3} value={lostReason} onChange={(e) => setLostReason(e.target.value)} placeholder="Ex. exclusivité avec un concurrent, commission jugée trop élevée…" />
            </FormField>
          )}
          {!closed && (
            <>
              <FormField label="Commentaire">
                <Textarea rows={3} value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="Ce qui a été dit, les prochaines étapes…" />
              </FormField>
              <FormField label="Prochaine relance">
                <DateTimeField value={followUp} onChange={setFollowUp} placeholder="Inchangée" minDate={new Date()} />
              </FormField>
            </>
          )}
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={loading}>
            Annuler
          </Button>
          <Button
            variant={to === 'lost' ? 'danger' : 'primary'}
            loading={loading}
            disabled={invalid}
            onClick={async () => {
              const ok = await mutate({
                prospectId: prospect.id,
                toStage: to,
                summary: summary.trim() || null,
                lostReason: to === 'lost' ? lostReason.trim() : null,
                restaurantId: to === 'signed_up' ? (restaurantId ?? null) : null,
                nextFollowUpAt: followUp,
              });
              if (ok) onClose();
            }}
          >
            Confirmer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
