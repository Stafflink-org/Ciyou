import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { collection, query } from 'firebase/firestore';
import {
  ArrowRight,
  BellRing,
  CircleCheck,
  ClipboardList,
  Clock3,
  CreditCard,
  FileCheck,
  Gem,
  Landmark,
  MapPinned,
  ShieldCheck,
  Store,
} from 'lucide-react';
import { Badge, Card, PageContainer, PageHeader, ProgressBar, Skeleton, cn, formatEUR } from '@golink/ui';
import {
  FULFILLMENT_LABELS,
  PAYMENT_METHOD_LABELS,
  paths,
  type RestaurantDeliveryZone,
  type RestaurantMember,
  type RestaurantNotificationSettings,
  type RestaurantPermission,
} from '@golink/shared';
import { useCan, useRestaurantAccess } from '@/auth/RestaurantAccess';
import { db } from '@/lib/firebase';
import { useCollection } from '@/lib/firestore';
import { scheduleState } from '../horaires/schedule';
import { planOf, useCommercial, usePlans, useRestaurantSettings } from './kit/hooks';
import { useSetupSteps } from './kit/setup';

interface Tile {
  href: string;
  label: string;
  description: string;
  icon: ReactNode;
  permission: RestaurantPermission;
  summary: ReactNode;
}

/** Vue d'ensemble de la configuration : mise en route et accès rapide à chaque rubrique. */
export function ParametresPage() {
  const { restaurant, restaurantId } = useRestaurantAccess();
  const can = useCan();
  const { steps, loading } = useSetupSteps();
  const notifications = useRestaurantSettings<RestaurantNotificationSettings>('notifications');
  const zones = useCollection<RestaurantDeliveryZone>(can('zones.manage') ? query(collection(db, `${paths.restaurant(restaurantId)}/deliveryZones`)) : null);
  const members = useCollection<RestaurantMember>(can('team.view') ? query(collection(db, `${paths.restaurant(restaurantId)}/members`)) : null);
  const commercial = useCommercial();
  const plans = usePlans();

  const known = steps.filter((s) => !s.unknown);
  const done = known.filter((s) => s.done).length;
  const complete = done === known.length;
  const hours = restaurant.hoursSummary ? scheduleState(restaurant.hoursSummary) : null;
  const plan = planOf(plans.data, restaurant.planCode);
  const activeZones = zones.data.filter((z) => z.enabled).length;
  const activeMembers = members.data.filter((m) => m.active).length;
  const stripe = commercial.data?.stripeAccountStatus;

  const tiles: Tile[] = [
    {
      href: '/etablissement',
      label: 'Établissement',
      description: 'Profil, visuels, adresse, identité légale.',
      icon: <Store />,
      permission: 'settings.manage',
      summary: `${restaurant.name} · ${restaurant.address.city}`,
    },
    {
      href: '/horaires',
      label: 'Horaires',
      description: 'Créneaux, fermetures, jours fériés, pause.',
      icon: <Clock3 />,
      permission: 'settings.manage',
      summary: !restaurant.isOpen ? 'Commandes en pause' : (hours?.label ?? 'À définir'),
    },
    {
      href: '/reglages-commandes',
      label: 'Réglages des commandes',
      description: 'Préparation, modes, capacité, programmées.',
      icon: <ClipboardList />,
      permission: 'settings.manage',
      summary: `${restaurant.prepMinutes} min · ${restaurant.fulfillmentModes.map((m) => FULFILLMENT_LABELS[m]).join(', ') || 'aucun mode'}`,
    },
    {
      href: '/zones',
      label: 'Zones de livraison',
      description: 'Secteurs livrés, frais, minimum et délai.',
      icon: <MapPinned />,
      permission: 'zones.manage',
      summary: restaurant.deliveredBy === 'platform' ? 'Livraison assurée par GoLink' : `${activeZones} zone${activeZones > 1 ? 's' : ''} active${activeZones > 1 ? 's' : ''}`,
    },
    {
      href: '/paiements',
      label: 'Moyens de paiement',
      description: 'En ligne, à la livraison, au retrait.',
      icon: <CreditCard />,
      permission: 'settings.manage',
      summary:
        restaurant.acceptedPaymentMethods
          .filter((m) => m !== 'wallet')
          .slice(0, 3)
          .map((m) => PAYMENT_METHOD_LABELS[m])
          .join(', ') + (restaurant.acceptedPaymentMethods.filter((m) => m !== 'wallet').length > 3 ? '…' : ''),
    },
    {
      href: '/notifications',
      label: 'Notifications',
      description: 'Son des commandes, alertes, e-mails, SMS.',
      icon: <BellRing />,
      permission: 'settings.manage',
      summary: notifications.loading
        ? '…'
        : `${notifications.data?.newOrderSound === false ? 'Son désactivé' : 'Son activé'} · ${notifications.data?.emailRecipients?.length ?? 0} destinataire${(notifications.data?.emailRecipients?.length ?? 0) > 1 ? 's' : ''}`,
    },
    {
      href: '/utilisateurs',
      label: 'Utilisateurs et accès',
      description: 'Membres, rôles, permissions, invitations.',
      icon: <ShieldCheck />,
      permission: 'team.view',
      summary: members.loading ? '…' : `${activeMembers} membre${activeMembers > 1 ? 's' : ''} actif${activeMembers > 1 ? 's' : ''}`,
    },
    {
      href: '/documents',
      label: 'Documents et contrat',
      description: 'Justificatifs et contrat partenaire.',
      icon: <FileCheck />,
      permission: 'settings.manage',
      summary: steps.find((s) => s.id === 'documents')?.done && steps.find((s) => s.id === 'contract')?.done ? 'Dossier à jour' : 'Action requise',
    },
    {
      href: '/versements',
      label: 'Compte de versement',
      description: 'Stripe Connect, calendrier des virements.',
      icon: <Landmark />,
      permission: 'finance.view',
      summary: stripe === 'enabled' ? 'Versements actifs' : stripe ? 'Vérification en cours' : 'À configurer',
    },
    {
      href: '/abonnement',
      label: 'Abonnement',
      description: 'Formule, commissions, factures.',
      icon: <Gem />,
      permission: 'finance.view',
      summary: `${plan.name} · ${plan.monthlyPriceHtCents > 0 ? `${formatEUR(plan.monthlyPriceHtCents, { cents: true })} HT / mois` : 'sans abonnement'}`,
    },
  ];

  return (
    <PageContainer>
      <PageHeader eyebrow="Configuration" title="Paramètres" description={`Tout ce qui fait tourner ${restaurant.name}, au même endroit.`} />

      <Card className="mb-8 overflow-hidden">
        <div className="flex flex-col gap-4 p-5 md:flex-row md:items-center md:justify-between">
          <div className="min-w-0">
            <p className="eyebrow">Mise en route</p>
            <h2 className="mt-1 font-display text-lg font-semibold tracking-tight text-fg">
              {loading ? 'Vérification de votre configuration…' : complete ? 'Votre établissement est prêt.' : `Encore ${known.length - done} étape${known.length - done > 1 ? 's' : ''} pour être 100 % opérationnel`}
            </h2>
          </div>
          <div className="w-full md:w-64">
            {loading ? (
              <Skeleton className="h-8 w-full" />
            ) : (
              <ProgressBar value={done} max={known.length} tone={complete ? 'success' : 'brand'} label="Étapes terminées" valueLabel={`${done} / ${known.length}`} />
            )}
          </div>
        </div>
        {!loading && (
          <ol className="grid border-t border-border sm:grid-cols-2 xl:grid-cols-4">
            {known.map((step, index) => (
              <li key={step.id} className="border-b border-border sm:odd:border-r xl:border-r xl:[&:nth-child(4n)]:border-r-0">
                <Link
                  to={step.href}
                  className="group flex h-full items-start gap-3 px-5 py-4 transition-colors hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring"
                >
                  <span
                    className={cn(
                      'mt-0.5 grid size-6 shrink-0 place-items-center rounded-full border text-2xs font-semibold num',
                      step.done ? 'tone-success border-(--tone-border) bg-(--tone-bg) text-(--tone-fg)' : 'border-border-strong text-fg-muted',
                    )}
                  >
                    {step.done ? <CircleCheck className="size-3.5" /> : index + 1}
                  </span>
                  <span className="min-w-0">
                    <span className={cn('block text-sm font-medium', step.done ? 'text-fg-muted line-through decoration-border-strong' : 'text-fg')}>{step.label}</span>
                    <span className="block text-xs text-fg-subtle">{step.description}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ol>
        )}
      </Card>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {tiles
          .filter((tile) => can(tile.permission))
          .map((tile) => (
            <Link
              key={tile.href}
              to={tile.href}
              className="group rounded-xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              <Card interactive className="flex h-full items-start gap-4 p-5">
                <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-surface-3 text-fg-muted transition-colors group-hover:bg-primary-soft group-hover:text-primary-soft-fg [&_svg]:size-5">
                  {tile.icon}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center justify-between gap-2">
                    <span className="font-medium text-fg">{tile.label}</span>
                    <ArrowRight className="size-4 shrink-0 text-fg-subtle transition-transform group-hover:translate-x-0.5" />
                  </span>
                  <span className="mt-0.5 block text-xs text-fg-subtle">{tile.description}</span>
                  <Badge className="mt-3 max-w-full truncate" tone={tile.summary === 'Action requise' || tile.summary === 'À configurer' ? 'amber' : 'neutral'}>
                    {tile.summary}
                  </Badge>
                </span>
              </Card>
            </Link>
          ))}
      </div>
    </PageContainer>
  );
}
