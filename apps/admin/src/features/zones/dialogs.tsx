// Fenêtres de la rubrique Zones et villes : fermeture d'urgence, création d'une ville,
// règle d'heure de pointe (majoration des frais, bonus livreurs).
import { useEffect, useState } from 'react';
import { Building2, CloudLightning, Zap } from 'lucide-react';
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
  RadioGroup,
  Select,
  Switch,
  Textarea,
} from '@golink/ui';
import { EMERGENCY_REASON_LABELS, SURGE_TRIGGER_LABELS, type City, type Country, type EmergencyClosure, type SaveSurgeRuleInput, type SurgeRule, type WithId, type Zone } from '@golink/shared';
import { useMutation } from '@/lib/firestore';
import { fn } from '../_operations/functions';
import { defaultWeeklyHours, hoursIssues, WeeklyHoursEditor } from '../_operations/hours';
import { EuroInput, PercentInput, UnitInput } from '../_operations/inputs';

const CLOSURE_MESSAGES: Record<EmergencyClosure['reason'], string> = {
  weather: 'En raison des conditions météo, la livraison est suspendue pour la sécurité de nos livreurs. Merci de votre compréhension.',
  event: 'En raison d’un événement dans le quartier, la livraison est momentanément suspendue.',
  driver_shortage: 'Nos livreurs sont tous occupés : la livraison reprend dans quelques instants.',
  incident: 'Un incident perturbe la livraison dans votre secteur. Nous revenons très vite.',
  other: 'La livraison est momentanément suspendue dans votre secteur.',
};

export function ClosureDialog({ open, onOpenChange, scope, id, name }: { open: boolean; onOpenChange: (open: boolean) => void; scope: 'city' | 'zone'; id: string; name: string }) {
  const [reason, setReason] = useState<EmergencyClosure['reason']>('weather');
  const [message, setMessage] = useState(CLOSURE_MESSAGES.weather);
  const [messageEn, setMessageEn] = useState('');
  const [messageAr, setMessageAr] = useState('');
  const [duration, setDuration] = useState('120');
  const [note, setNote] = useState('');
  useEffect(() => {
    if (open) {
      setReason('weather');
      setMessage(CLOSURE_MESSAGES.weather);
      setMessageEn('');
      setMessageAr('');
      setDuration('120');
      setNote('');
    }
  }, [open]);
  const action = useMutation(fn.closeZone, { success: `${scope === 'city' ? 'Ville' : 'Zone'} fermée : les clients concernés sont prévenus` });
  return (
    <Dialog open={open} onOpenChange={(o) => !action.loading && onOpenChange(o)}>
      <DialogContent size="md">
        <DialogHeader icon={<CloudLightning />} title={`Fermeture d’urgence · ${name}`} description="Plus aucune commande en livraison n’est acceptée ; les commandes en cours se poursuivent." />
        <DialogBody className="space-y-4">
          <FormField label="Cause">
            <Select
              value={reason}
              onValueChange={(v) => {
                const r = v as EmergencyClosure['reason'];
                setReason(r);
                setMessage(CLOSURE_MESSAGES[r]);
              }}
              options={(Object.keys(EMERGENCY_REASON_LABELS) as EmergencyClosure['reason'][]).map((r) => ({ value: r, label: EMERGENCY_REASON_LABELS[r] }))}
            />
          </FormField>
          <FormField label="Message affiché aux clients" aside={<span className="font-mono text-2xs text-fg-subtle">{message.length}/280</span>}>
            <Textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={3} maxLength={280} />
          </FormField>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Message en anglais" hint="Facultatif : sinon le français est affiché.">
              <Textarea value={messageEn} onChange={(e) => setMessageEn(e.target.value)} rows={3} maxLength={280} dir="ltr" />
            </FormField>
            <FormField label="Message en arabe" hint="Facultatif : affiché de droite à gauche.">
              <Textarea value={messageAr} onChange={(e) => setMessageAr(e.target.value)} rows={3} maxLength={280} dir="rtl" />
            </FormField>
          </div>
          <FormField label="Réouverture" hint="La réouverture automatique évite une fermeture oubliée.">
            <Select
              value={duration}
              onValueChange={setDuration}
              options={[
                { value: '30', label: 'Dans 30 minutes' },
                { value: '60', label: 'Dans 1 heure' },
                { value: '120', label: 'Dans 2 heures' },
                { value: '240', label: 'Dans 4 heures' },
                { value: '720', label: 'Dans 12 heures' },
                { value: 'manual', label: 'Manuelle uniquement' },
              ]}
            />
          </FormField>
          <FormField label="Note interne (journal d’audit)">
            <Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder="Ex. alerte orange Météo-France, pluie verglaçante" />
          </FormField>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={action.loading}>
            Annuler
          </Button>
          <Button
            variant="danger"
            loading={action.loading}
            disabled={message.trim().length < 5 || note.trim().length < 3}
            onClick={async () => {
              const result = await action.mutate({ scope, id, close: true, reason, message: message.trim(), messageEn: messageEn.trim() || null, messageAr: messageAr.trim() || null, endsAt: duration === 'manual' ? null : Date.now() + Number(duration) * 60_000, note: note.trim() });
              if (result) onOpenChange(false);
            }}
          >
            Fermer maintenant
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function CityDialog({ open, onOpenChange, countries, onCreated }: { open: boolean; onOpenChange: (open: boolean) => void; countries: WithId<Country>[]; onCreated: (id: string) => void }) {
  const [name, setName] = useState('');
  const [countryId, setCountryId] = useState(countries[0]?.id ?? 'FR');
  const [lat, setLat] = useState('');
  const [lng, setLng] = useState('');
  const country = countries.find((c) => c.id === countryId);
  const action = useMutation(fn.saveCity, { success: 'Ville créée (inactive) : dessinez ses zones puis activez-la' });
  const latN = Number(lat.replace(',', '.'));
  const lngN = Number(lng.replace(',', '.'));
  const valid = name.trim().length >= 2 && Number.isFinite(latN) && Number.isFinite(lngN) && lat !== '' && lng !== '' && Math.abs(latN) <= 90 && Math.abs(lngN) <= 180;
  return (
    <Dialog open={open} onOpenChange={(o) => !action.loading && onOpenChange(o)}>
      <DialogContent size="md">
        <DialogHeader icon={<Building2 />} title="Nouvelle ville" description="Lancement ville par ville : la ville reste inactive tant que vous ne l’activez pas." />
        <DialogBody className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Nom">
              <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder="Ex. Nancy" />
            </FormField>
            <FormField label="Pays">
              <Select value={countryId} onValueChange={setCountryId} options={countries.map((c) => ({ value: c.id, label: c.name }))} />
            </FormField>
            <FormField label="Latitude du centre">
              <Input value={lat} onChange={(e) => setLat(e.target.value)} inputMode="decimal" placeholder="48.6921" />
            </FormField>
            <FormField label="Longitude du centre">
              <Input value={lng} onChange={(e) => setLng(e.target.value)} inputMode="decimal" placeholder="6.1844" />
            </FormField>
          </div>
          <p className="text-xs text-fg-subtle">Horaires de service par défaut : 11 h – 14 h 30 et 18 h – 23 h, modifiables ensuite. Fuseau : {country?.timezone ?? 'Europe/Paris'}.</p>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={action.loading}>
            Annuler
          </Button>
          <Button
            variant="primary"
            loading={action.loading}
            disabled={!valid}
            onClick={async () => {
              const tz = country?.timezone ?? 'Europe/Paris';
              const result = await action.mutate({ countryId, name: name.trim(), timezone: tz, center: { lat: latN, lng: lngN }, serviceHours: defaultWeeklyHours(tz) });
              if (result) {
                onOpenChange(false);
                setName('');
                onCreated(result.cityId);
              }
            }}
          >
            Créer la ville
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function SurgeRuleDialog({ open, onOpenChange, city, zones, rule }: { open: boolean; onOpenChange: (open: boolean) => void; city: WithId<City>; zones: WithId<Zone>[]; rule: WithId<SurgeRule> | null }) {
  const blank = (): SaveSurgeRuleInput => ({
    cityId: city.id,
    zoneIds: zones.map((z) => z.id),
    name: '',
    active: true,
    trigger: 'manual',
    schedule: null,
    demandRatio: 2,
    multiplierBps: 12_000,
    flatFeeCents: 0,
    courierBonusCents: 100,
  });
  const [draft, setDraft] = useState<SaveSurgeRuleInput>(blank);
  const [reason, setReason] = useState('');
  useEffect(() => {
    if (!open) return;
    setReason('');
    setDraft(
      rule
        ? { ruleId: rule.id, cityId: rule.cityId, zoneIds: rule.zoneIds, name: rule.name, active: rule.active, trigger: rule.trigger, schedule: rule.schedule ?? null, demandRatio: rule.demandRatio ?? 2, multiplierBps: rule.multiplierBps, flatFeeCents: rule.flatFeeCents, courierBonusCents: rule.courierBonusCents }
        : blank(),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, rule?.id]);
  const action = useMutation(fn.saveSurgeRule, { success: 'Règle de pointe enregistrée' });
  const schedule = draft.schedule ?? { ...defaultWeeklyHours(city.timezone), days: defaultWeeklyHours(city.timezone).days.map((d) => ({ ...d, slots: [{ from: '19:00', to: '21:30' }] })) };
  const issues = draft.trigger === 'schedule' ? hoursIssues(schedule) : [];
  const valid = draft.name.trim().length >= 2 && draft.zoneIds.length > 0 && issues.length === 0 && (draft.multiplierBps > 10_000 || draft.flatFeeCents > 0 || draft.courierBonusCents > 0);
  return (
    <Dialog open={open} onOpenChange={(o) => !action.loading && onOpenChange(o)}>
      <DialogContent size="lg">
        <DialogHeader icon={<Zap />} title={rule ? 'Modifier la règle de pointe' : 'Nouvelle règle de pointe'} description="Majoration temporaire des frais de livraison et/ou bonus versé aux livreurs." />
        <DialogBody className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Nom">
              <Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} maxLength={60} placeholder="Ex. Pointe du soir" />
            </FormField>
            <FormField label="Zones concernées">
              <Combobox multiple options={zones.map((z) => ({ value: z.id, label: z.name }))} value={draft.zoneIds} onChange={(v: string[]) => setDraft({ ...draft, zoneIds: v })} placeholder="Choisir les zones" />
            </FormField>
          </div>
          <FormField label="Déclenchement">
            <RadioGroup
              variant="cards"
              className="sm:grid-cols-3"
              value={draft.trigger}
              onValueChange={(v) => setDraft({ ...draft, trigger: v as SaveSurgeRuleInput['trigger'] })}
              options={(Object.keys(SURGE_TRIGGER_LABELS) as SaveSurgeRuleInput['trigger'][]).map((t) => ({
                value: t,
                label: SURGE_TRIGGER_LABELS[t],
                description: t === 'manual' ? 'Lancée à la main, pour une durée donnée.' : t === 'schedule' ? 'Active sur des créneaux fixes.' : 'Dès que la demande dépasse l’offre.',
              }))}
            />
          </FormField>
          {draft.trigger === 'schedule' && (
            <div className="space-y-2">
              <WeeklyHoursEditor value={schedule} onChange={(s) => setDraft({ ...draft, schedule: s })} />
              {issues.length > 0 && <p className="text-xs text-danger">{issues[0]}</p>}
            </div>
          )}
          {draft.trigger === 'demand' && (
            <FormField label="Seuil de déclenchement" hint="Commandes en attente par livreur disponible dans la zone.">
              <UnitInput value={draft.demandRatio ?? 2} onChange={(v) => v !== null && setDraft({ ...draft, demandRatio: v })} unit="cmd / livreur" min={0.5} max={20} decimals={1} />
            </FormField>
          )}
          <div className="grid gap-4 sm:grid-cols-3">
            <FormField label="Majoration des frais" hint="100 % = aucune majoration.">
              <PercentInput value={draft.multiplierBps} onChange={(v) => v !== null && setDraft({ ...draft, multiplierBps: Math.max(10_000, v) })} max={30_000} />
            </FormField>
            <FormField label="Supplément fixe client">
              <EuroInput value={draft.flatFeeCents} onChange={(v) => v !== null && setDraft({ ...draft, flatFeeCents: v })} />
            </FormField>
            <FormField label="Bonus livreur par course">
              <EuroInput value={draft.courierBonusCents} onChange={(v) => v !== null && setDraft({ ...draft, courierBonusCents: v })} />
            </FormField>
          </div>
          <Switch checked={draft.active} onCheckedChange={(v) => setDraft({ ...draft, active: v })} label="Règle active" description="Une règle inactive ne se déclenche jamais." />
          <FormField label="Motif (journal d’audit)">
            <Input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} />
          </FormField>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={action.loading}>
            Annuler
          </Button>
          <Button
            variant="primary"
            loading={action.loading}
            disabled={!valid}
            onClick={async () => {
              const result = await action.mutate({ ...draft, name: draft.name.trim(), schedule: draft.trigger === 'schedule' ? schedule : null, reason: reason.trim() || null });
              if (result) onOpenChange(false);
            }}
          >
            Enregistrer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
