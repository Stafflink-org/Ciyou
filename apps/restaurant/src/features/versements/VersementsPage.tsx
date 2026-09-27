import { lazy, Suspense, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { Banknote, BadgeCheck, Calculator, CalendarClock, Clock3, Landmark, Lock, RefreshCw, ShieldCheck, TriangleAlert } from 'lucide-react';
import { Badge, Button, Card, PageContainer, PageHeader, Skeleton, Spinner, StatusPill, toast, type Tone } from '@golink/ui';
import type { RestaurantCommercial } from '@golink/shared';
import { useCan, useRestaurantAccess } from '@/auth/RestaurantAccess';
import { env } from '@/lib/env';
import { errorMessage, useMutation } from '@/lib/firestore';
import { refreshConnectAccountStatus } from '../parametres/kit/api';
import { useCommercial } from '../parametres/kit/hooks';
import { LoadError, Notice, SettingsCard } from '../parametres/kit/ui';
import { useRestaurantLegal } from '../documents/hooks';
import { LocalAccountCard, useNonStripeCountry } from './LocalAccountCard';

const StripeEmbedded = lazy(() => import('./StripeEmbedded').then((m) => ({ default: m.StripeEmbedded })));

type AccountStatus = NonNullable<RestaurantCommercial['stripeAccountStatus']> | 'none';

const STATUS: Record<AccountStatus, { label: string; tone: Tone; title: string; text: string }> = {
  none: {
    label: 'À configurer',
    tone: 'neutral',
    title: 'Activez vos versements',
    text: 'Renseignez votre société et votre compte bancaire auprès de Stripe, notre prestataire de paiement, pour recevoir le produit de vos ventes.',
  },
  pending: {
    label: 'Informations à compléter',
    tone: 'amber',
    title: 'Encore quelques informations',
    text: 'Votre compte de versement est créé mais incomplet : terminez la vérification pour débloquer vos virements.',
  },
  restricted: {
    label: 'Vérification en cours',
    tone: 'info',
    title: 'Vérification par Stripe',
    text: 'Stripe vérifie vos informations. Si un justificatif est demandé, il apparaît ci-dessous.',
  },
  enabled: {
    label: 'Actif',
    tone: 'success',
    title: 'Versements actifs',
    text: 'Vos ventes sont reversées automatiquement sur votre compte bancaire selon votre calendrier.',
  },
};

/** Décisions GoLink : commission sur les articles TTC, frais bancaires et remboursements à la charge du commerce. */
const PAYOUT_STEPS: Array<{ sign: '+' | '-' | '='; label: string; detail: string }> = [
  { sign: '+', label: 'Ventes encaissées', detail: 'Articles TTC payés par vos clients, et frais de livraison quand vos livreurs assurent la course.' },
  { sign: '-', label: 'Commission GoLink', detail: 'Selon le mode (livraison GoLink, vos livreurs, retrait), sur les articles TTC hors livraison et pourboires.' },
  { sign: '-', label: 'Frais de paiement', detail: 'Frais bancaires des paiements en ligne.' },
  { sign: '-', label: 'Remboursements et ajustements', detail: 'Remboursements clients, à la charge de l’établissement, et commission due sur les ventes en espèces.' },
  { sign: '=', label: 'Versement sur votre compte', detail: 'Pourboires exclus : ils reviennent à 100 % au livreur.' },
];

const FREQUENCY: Record<string, string> = { weekly: 'Chaque semaine', biweekly: 'Toutes les deux semaines', monthly: 'Chaque mois' };

/** Compte de versement Stripe Connect : création, vérification, calendrier et relevés. */
export function VersementsPage() {
  const { restaurantId } = useRestaurantAccess();
  const can = useCan();
  const commercial = useCommercial();
  const legal = useRestaurantLegal(can('settings.manage'));
  const [embedded, setEmbedded] = useState(false);
  const refresh = useMutation(refreshConnectAccountStatus);
  const { nonStripe } = useNonStripeCountry();

  const header = (
    <PageHeader
      eyebrow="Configuration"
      title="Compte de versement"
      description="Là où GoLink vous reverse vos ventes, déduction faite des commissions. Les données bancaires sont conservées par Stripe, jamais par GoLink."
    />
  );

  if (commercial.error)
    return (
      <PageContainer>
        {header}
        <LoadError message={errorMessage(commercial.error)} />
      </PageContainer>
    );
  if (commercial.loading)
    return (
      <PageContainer>
        {header}
        <Skeleton className="h-44 w-full rounded-xl" />
      </PageContainer>
    );

  const data = commercial.data;
  const status: AccountStatus = data?.stripeAccountId ? (data.stripeAccountStatus ?? 'pending') : data?.stripeAccountStatus === 'enabled' ? 'enabled' : 'none';
  const hasAccount = Boolean(data?.stripeAccountId);
  const meta = STATUS[status];
  const canSetup = can('settings.manage');
  const stripeReady = Boolean(env.stripePublishableKey);

  const onRefresh = async () => {
    const result = await refresh.mutate({ restaurantId });
    if (result) toast.success(result.status ? `Statut actualisé : ${STATUS[result.status].label.toLowerCase()}.` : 'Aucun compte de versement pour le moment.');
  };

  return (
    <PageContainer>
      {header}
      <div className="space-y-6">
        {data?.payoutsBlocked && (
          <Notice tone="danger" icon={<Lock />} title="Versements suspendus">
            {data.payoutsBlockedReason ?? 'Contactez le support GoLink.'} Vos ventes restent enregistrées et seront reversées dès la levée du blocage.
          </Notice>
        )}

        <LocalAccountCard account={data?.payoutAccount} />

        {!nonStripe && (
        <Card className="overflow-hidden">
          <div className="flex flex-col gap-5 p-5 md:flex-row md:items-center md:justify-between">
            <div className="flex min-w-0 items-start gap-4">
              <div className="grid size-12 shrink-0 place-items-center rounded-xl bg-surface-3 text-fg-muted">
                <Landmark className="size-6" />
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="font-display text-lg font-semibold tracking-tight text-fg">{meta.title}</h2>
                  <StatusPill tone={meta.tone} pulse={status === 'restricted'}>
                    {meta.label}
                  </StatusPill>
                </div>
                <p className="mt-1 max-w-2xl text-sm text-fg-muted">{meta.text}</p>
                {!hasAccount && status === 'enabled' && (
                  <p className="mt-1 text-xs text-fg-subtle">Compte activé par l’équipe GoLink.</p>
                )}
              </div>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              {hasAccount && (
                <Button variant="ghost" leftIcon={<RefreshCw />} loading={refresh.loading} onClick={() => void onRefresh()}>
                  Actualiser
                </Button>
              )}
              {!embedded && status !== 'enabled' && (
                <Button variant="primary" leftIcon={<ShieldCheck />} disabled={!canSetup || !stripeReady} onClick={() => setEmbedded(true)}>
                  {hasAccount ? 'Reprendre la vérification' : 'Configurer mes versements'}
                </Button>
              )}
              {!embedded && status === 'enabled' && hasAccount && (
                <Button variant="secondary" leftIcon={<Banknote />} disabled={!stripeReady} onClick={() => setEmbedded(true)}>
                  Relevés Stripe
                </Button>
              )}
            </div>
          </div>
          {!canSetup && status !== 'enabled' && (
            <div className="border-t border-border bg-surface-2 px-5 py-3 text-xs text-fg-muted">La configuration est réservée aux membres qui gèrent les paramètres de l’établissement.</div>
          )}
          {!stripeReady && (
            <div className="border-t border-border bg-surface-2 px-5 py-3 text-xs text-fg-muted">Le module de paiement n’est pas configuré sur cet environnement.</div>
          )}
        </Card>
        )}

        <div className="grid gap-4 md:grid-cols-3">
          <InfoTile icon={<CalendarClock />} label="Calendrier" value={FREQUENCY[data?.payoutFrequency ?? 'weekly'] ?? 'Chaque semaine'} hint="Calendrier défini avec GoLink." />
          <InfoTile
            icon={<Landmark />}
            label="Compte bancaire"
            value={legal.data?.ibanMasked ?? (hasAccount ? 'Chez Stripe' : 'Non renseigné')}
            hint={legal.data?.ibanMasked ? 'Numéro masqué pour votre sécurité.' : 'Ajouté pendant la configuration.'}
            mono={Boolean(legal.data?.ibanMasked)}
          />
          <InfoTile
            icon={data?.payoutsBlocked ? <TriangleAlert /> : <BadgeCheck />}
            label="Versements"
            value={data?.payoutsBlocked ? 'Suspendus' : status === 'enabled' ? 'Autorisés' : 'En attente'}
            hint={data?.payoutsBlocked ? 'Voir le motif ci-dessus.' : 'Délai bancaire : 1 à 3 jours ouvrés.'}
          />
        </div>

        {embedded && stripeReady && (
          <SettingsCard
            icon={<ShieldCheck />}
            title={status === 'enabled' ? 'Relevés de versement' : 'Vérification sécurisée'}
            description="Module fourni par Stripe, prestataire de paiement agréé. Vos pièces et votre IBAN lui sont transmis directement."
            actions={
              <Button variant="ghost" size="sm" onClick={() => setEmbedded(false)}>
                Fermer
              </Button>
            }
          >
            <Suspense
              fallback={
                <div className="grid h-48 place-items-center">
                  <Spinner />
                </div>
              }
            >
              <StripeEmbedded
                mode={status === 'enabled' ? 'payouts' : 'onboarding'}
                onExit={() => {
                  setEmbedded(false);
                  void onRefresh();
                }}
              />
            </Suspense>
          </SettingsCard>
        )}

        <SettingsCard icon={<Calculator />} title="Calcul de chaque versement" description="Ce que vous recevez pour une période de ventes.">
          <ol className="divide-y divide-border text-sm">
            {PAYOUT_STEPS.map((step) => (
              <li key={step.label} className="flex items-start justify-between gap-4 py-3 first:pt-0 last:pb-0">
                <div className="flex min-w-0 items-start gap-3">
                  <span
                    aria-hidden
                    className={
                      step.sign === '+'
                        ? 'grid size-6 shrink-0 place-items-center rounded-full tone-success bg-(--tone-bg) text-(--tone-fg) font-mono text-xs'
                        : step.sign === '='
                          ? 'grid size-6 shrink-0 place-items-center rounded-full bg-primary font-mono text-xs text-primary-fg'
                          : 'grid size-6 shrink-0 place-items-center rounded-full bg-surface-3 font-mono text-xs text-fg-muted'
                    }
                  >
                    {step.sign === '-' ? '−' : step.sign}
                  </span>
                  <div className="min-w-0">
                    <p className={step.sign === '=' ? 'font-semibold text-fg' : 'font-medium text-fg'}>{step.label}</p>
                    <p className="text-xs text-fg-subtle">{step.detail}</p>
                  </div>
                </div>
              </li>
            ))}
          </ol>
        </SettingsCard>

        <Card className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <Clock3 className="mt-0.5 size-4 shrink-0 text-fg-muted" />
            <div>
              <p className="text-sm font-medium text-fg">Historique de vos virements GoLink</p>
              <p className="text-xs text-fg-subtle">Montants reversés, commissions déduites et relevés téléchargeables.</p>
            </div>
          </div>
          <Button asChild variant="secondary" size="sm">
            <Link to="/virements">Voir les virements</Link>
          </Button>
        </Card>
        <p className="flex flex-col items-start gap-1.5 text-xs text-fg-subtle sm:flex-row sm:items-center">
          <Badge size="sm" variant="outline">
            Stripe Connect
          </Badge>
          L’identité du représentant légal est vérifiée par Stripe, conformément à la réglementation bancaire européenne.
        </p>
      </div>
    </PageContainer>
  );
}

function InfoTile({ icon, label, value, hint, mono }: { icon: ReactNode; label: string; value: string; hint: string; mono?: boolean }) {
  return (
    <Card className="p-4">
      <div className="flex items-center gap-2 text-sm text-fg-muted [&_svg]:size-4">
        {icon}
        {label}
      </div>
      <p className={mono ? 'mt-2 font-mono text-md text-fg num' : 'mt-2 font-display text-lg font-semibold tracking-tight text-fg'}>{value}</p>
      <p className="mt-1 text-xs text-fg-subtle">{hint}</p>
    </Card>
  );
}
