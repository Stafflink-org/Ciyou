// Logiciels de caisse (cahier §25) : connexion d'un commerce à sa caisse par webhook signé,
// suivi par commerce (dernier envoi, erreurs, compteurs), test de connexion et déconnexion.
// Le secret de signature n'est montré qu'à la création.
import { useMemo, useState } from 'react';
import { limit, orderBy, query } from 'firebase/firestore';
import { Copy, Plug2, Plus, Send, Unplug } from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  Combobox,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  EmptyState,
  FormField,
  Input,
  Select,
  Skeleton,
  Switch,
  formatRelative,
  toast,
} from '@golink/ui';
import { COLLECTIONS, type PosConnection, type Restaurant } from '@golink/shared';
import { useCan } from '@/auth/AdminAccess';
import { collectionAt, toDate, useCollection, useMutation } from '@/lib/firestore';
import { askReason } from '@/lib/reason';
import { disconnectPosConnection, savePosConnection, testPosConnection } from './api';
import { ErrorPanel } from './components';

const PROVIDERS = [
  { value: 'generic_webhook', label: 'Webhook générique' },
  { value: 'lightspeed', label: 'Lightspeed' },
  { value: 'zelty', label: 'Zelty' },
  { value: 'popina', label: 'Popina' },
  { value: 'other', label: 'Autre logiciel' },
];
const STATUS: Record<PosConnection['status'], { label: string; tone: 'success' | 'amber' | 'danger' | 'neutral' }> = {
  pending: { label: 'À tester', tone: 'amber' },
  connected: { label: 'Connectée', tone: 'success' },
  error: { label: 'En erreur', tone: 'danger' },
  disconnected: { label: 'Déconnectée', tone: 'neutral' },
};

type Row = PosConnection & { id: string; webhookUrl?: string | null; label?: string | null; pushedCount?: number; failedCount?: number };

function NewConnectionDialog({ open, onOpenChange, restaurants }: { open: boolean; onOpenChange: (open: boolean) => void; restaurants: { id: string; name: string }[] }) {
  const [restaurantId, setRestaurantId] = useState<string | undefined>();
  const [provider, setProvider] = useState('generic_webhook');
  const [label, setLabel] = useState('');
  const [url, setUrl] = useState('');
  const [push, setPush] = useState(true);
  const [reason, setReason] = useState('');
  const [secret, setSecret] = useState<string | null>(null);
  const create = useMutation(() => savePosConnection({ restaurantId: restaurantId!, provider, label: label.trim() || null, webhookUrl: url.trim(), pushOrders: push, reason }), {});
  const valid = Boolean(restaurantId) && /^https:\/\//.test(url.trim()) && reason.trim().length >= 3;
  const close = (o: boolean) => {
    if (!o) {
      setSecret(null);
      setUrl('');
      setLabel('');
      setReason('');
      setRestaurantId(undefined);
    }
    onOpenChange(o);
  };
  return (
    <Dialog open={open} onOpenChange={(o) => !create.loading && close(o)}>
      <DialogContent size="md">
        <DialogHeader icon={<Plug2 />} title="Nouvelle connexion caisse" description="Chaque commande reçue par le commerce est envoyée à la caisse (adresse https), signée avec un secret propre à la connexion." />
        {secret ? (
          <>
            <DialogBody className="space-y-3">
              <p className="text-sm text-fg">Connexion créée. Copiez ce secret de signature maintenant : il ne sera plus affiché.</p>
              <div className="flex items-center gap-2 rounded-lg border border-border bg-surface-2 px-3 py-2">
                <code className="min-w-0 flex-1 break-all text-xs">{secret}</code>
                <Button size="xs" variant="ghost" leftIcon={<Copy />} onClick={() => void navigator.clipboard.writeText(secret).then(() => toast.success('Secret copié.'))}>Copier</Button>
              </div>
              <p className="text-xs text-fg-subtle">La caisse vérifie l’en-tête <code>x-golink-signature</code> : « sha256= » suivi du HMAC-SHA256 du corps, calculé avec ce secret.</p>
            </DialogBody>
            <DialogFooter><Button onClick={() => close(false)}>J’ai copié le secret</Button></DialogFooter>
          </>
        ) : (
          <>
            <DialogBody className="space-y-4">
              <FormField label="Commerce" required>
                <Combobox value={restaurantId} onChange={setRestaurantId} options={restaurants.map((r) => ({ value: r.id, label: r.name }))} placeholder="Choisir un commerce" />
              </FormField>
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField label="Logiciel de caisse" required><Select value={provider} onValueChange={setProvider} options={PROVIDERS} /></FormField>
                <FormField label="Nom de la connexion"><Input value={label} onChange={(e) => setLabel(e.target.value)} maxLength={80} placeholder="Caisse principale" /></FormField>
              </div>
              <FormField label="Adresse du webhook (https)" required hint="Adresse publique de la caisse qui reçoit les commandes.">
                <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://caisse.exemple.fr/golink/webhook" />
              </FormField>
              <FormField label="Envoyer les commandes"><div className="flex h-10 items-center"><Switch checked={push} onCheckedChange={setPush} /></div></FormField>
              <FormField label="Motif" required hint="Conservé dans le journal d’audit."><Input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} placeholder="Ex. demande du commerce, intégration Zelty" /></FormField>
            </DialogBody>
            <DialogFooter>
              <Button variant="ghost" onClick={() => close(false)}>Annuler</Button>
              <Button
                leftIcon={<Plus />}
                loading={create.loading}
                disabled={!valid}
                onClick={async () => {
                  const res = await create.mutate();
                  if (res?.secret) setSecret(res.secret);
                }}
              >
                Créer la connexion
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function PosConnectionsCard() {
  const can = useCan();
  const connections = useCollection<PosConnection & { webhookUrl?: string | null; label?: string | null; pushedCount?: number; failedCount?: number }>(useMemo(() => query(collectionAt(COLLECTIONS.posConnections), orderBy('createdAt', 'desc'), limit(200)), []));
  const restaurants = useCollection<Restaurant>(useMemo(() => query(collectionAt(COLLECTIONS.restaurants), orderBy('name'), limit(400)), []));
  const names = useMemo(() => new Map(restaurants.data.map((r) => [r.id, r.name])), [restaurants.data]);
  const [open, setOpen] = useState(false);
  const test = useMutation(async (id: string) => savePosTest(id), {});
  const disconnect = useMutation(async (id: string) => {
    const reason = await askReason({ title: 'Déconnecter cette caisse', description: 'Plus aucune commande ne sera transmise à cette caisse.', confirmLabel: 'Déconnecter' });
    return disconnectPosConnection({ connectionId: id, reason });
  }, { success: 'Caisse déconnectée.' });
  const editable = can('integrations.edit');

  async function savePosTest(id: string) {
    const reason = await askReason({ title: 'Tester cette caisse', description: 'Un événement de test signé est envoyé à la caisse.', confirmLabel: 'Envoyer le test' });
    const result = await testPosConnection({ connectionId: id, reason });
    if (result.ok) toast.success('La caisse a bien reçu l’événement de test.');
    else toast.error(result.error ?? 'La caisse n’a pas répondu.');
    return result;
  }

  return (
    <Card>
      <CardHeader
        icon={<Plug2 />}
        title="Logiciels de caisse"
        description="Commandes reçues en caisse : une connexion par commerce, avec suivi des envois. Activez la fonctionnalité « Intégration caisse » pour le commerce concerné."
        actions={editable ? <Button size="sm" leftIcon={<Plus />} onClick={() => setOpen(true)}>Nouvelle connexion</Button> : undefined}
      />
      <CardContent>
        {connections.error ? (
          <ErrorPanel error={connections.error} compact />
        ) : connections.loading ? (
          <Skeleton className="h-24" />
        ) : connections.data.length === 0 ? (
          <EmptyState compact icon={<Plug2 />} title="Aucune caisse connectée" description="Ajoutez la caisse d’un commerce pour lui envoyer ses commandes." />
        ) : (
          <ul className="divide-y divide-border">
            {(connections.data as Row[]).map((c) => {
              const meta = STATUS[c.status] ?? STATUS.pending;
              const last = toDate(c.lastSyncAt);
              return (
                <li key={c.id} className="flex flex-wrap items-start justify-between gap-3 py-3">
                  <div className="min-w-0 space-y-1">
                    <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-fg">
                      {names.get(c.restaurantId) ?? c.restaurantId}
                      <Badge size="sm" tone={meta.tone}>{meta.label}</Badge>
                      <Badge size="sm" tone="neutral">{PROVIDERS.find((p) => p.value === c.provider)?.label ?? c.provider}</Badge>
                    </p>
                    <p className="text-xs text-fg-subtle">
                      {c.label ? `${c.label} · ` : ''}
                      {c.pushOrders ? 'Envoi des commandes actif' : 'Envoi désactivé'} · dernier envoi réussi {last ? formatRelative(last) : 'jamais'} · {c.pushedCount ?? 0} envoyée(s), {c.failedCount ?? 0} échec(s)
                    </p>
                    {c.lastError && <p className="truncate text-xs text-danger">{c.lastError}</p>}
                  </div>
                  {editable && (
                    <div className="flex shrink-0 gap-1.5">
                      <Button size="sm" variant="secondary" leftIcon={<Send />} loading={test.loading} disabled={c.status === 'disconnected'} onClick={() => void test.mutate(c.id)}>Tester</Button>
                      <Button size="sm" variant="ghost" leftIcon={<Unplug />} loading={disconnect.loading} disabled={c.status === 'disconnected'} onClick={() => void disconnect.mutate(c.id)}>Déconnecter</Button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
      <NewConnectionDialog open={open} onOpenChange={setOpen} restaurants={restaurants.data.map((r) => ({ id: r.id, name: r.name }))} />
    </Card>
  );
}
