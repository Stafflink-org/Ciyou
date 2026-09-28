import { useCallback } from 'react';
import { updateDoc } from 'firebase/firestore';
import { Check, ChevronDown, Flame, PauseCircle, PlayCircle } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  StatusPill,
  cn,
  toast,
  type Tone,
} from '@golink/ui';
import { paths, type Restaurant } from '@golink/shared';
import { translate, useAuth, useTranslation } from '@golink/web';
import { useRestaurantAccess } from '@/auth/RestaurantAccess';
import { docAt, updatedFields, useMutation } from '@/lib/firestore';

/** Minutes ajoutées au temps de préparation en mode affluence. */
const RUSH_STEPS = [10, 20, 30, 45] as const;

interface ServiceState {
  /** Clé de traduction (espace accueil, groupe service). */
  key: 'suspended' | 'paused' | 'closed' | 'busy' | 'open';
  minutes?: number;
  label: string;
  short: string;
  tone: Tone;
  pulse: boolean;
}

/** État affiché : suspension, pause manuelle, hors horaires, affluence ou ouvert. */
export function serviceState(restaurant: Restaurant): ServiceState {
  if (restaurant.status === 'suspended') return { key: 'suspended', label: 'Suspendu par Ciyou Eats', short: 'Suspendu', tone: 'danger', pulse: false };
  if (!restaurant.isOpen) return { key: 'paused', label: 'En pause', short: 'En pause', tone: 'amber', pulse: false };
  if (!restaurant.acceptingOrders) return { key: 'closed', label: 'Fermé', short: 'Fermé', tone: 'neutral', pulse: false };
  if (restaurant.busyExtraMinutes > 0) {
    return { key: 'busy', minutes: restaurant.busyExtraMinutes, label: `Affluence · +${restaurant.busyExtraMinutes} min`, short: `+${restaurant.busyExtraMinutes} min`, tone: 'amber', pulse: true };
  }
  return { key: 'open', label: 'Ouvert', short: 'Ouvert', tone: 'success', pulse: true };
}

/** Libellés traduits d'un état de service (complet et court). */
export function useServiceStateLabel(): (state: ServiceState, short?: boolean) => string {
  const { locale } = useTranslation('accueil');
  return (state, short = false) => {
    const key = state.key === 'busy' ? (short ? 'busyShort' : 'busy') : short && state.key === 'suspended' ? 'suspendedShort' : state.key;
    return translate(`accueil:service.${key}`, { minutes: state.minutes }, locale);
  };
}

/** Pastille d'état du service en barre supérieure, avec bascule rapide ouvert / affluence / pause. */
export function ServiceStatus() {
  const { user } = useAuth();
  const { t } = useTranslation('accueil');
  const stateLabel = useServiceStateLabel();
  const { restaurant, can } = useRestaurantAccess();
  const state = serviceState(restaurant);
  const editable = can('orders.manage') && restaurant.status !== 'suspended';

  const write = useCallback(
    (isOpen: boolean, busyExtraMinutes: number) =>
      updateDoc(docAt(paths.restaurant(restaurant.id)), { isOpen, busyExtraMinutes, ...updatedFields(user?.uid ?? '') }).then(
        () => true,
      ),
    [restaurant.id, user],
  );
  const { mutate, loading } = useMutation(write);

  const set = async (isOpen: boolean, minutes: number, message: string) => {
    if (await mutate(isOpen, minutes)) toast.success(message);
  };

  const pill = (
    <StatusPill tone={state.tone} pulse={state.pulse} className="h-8 gap-2 ps-2.5 pe-2 text-sm">
      <span className="hidden sm:inline">{stateLabel(state)}</span>
      <span className="sm:hidden">{stateLabel(state, true)}</span>
      {editable && <ChevronDown className="size-3.5 opacity-70" />}
    </StatusPill>
  );

  if (!editable) return <span title={t('service.receiving')}>{pill}</span>;

  const rush = restaurant.isOpen ? restaurant.busyExtraMinutes : 0;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={loading}>
        <button type="button" aria-label={t('service.receivingState', { state: stateLabel(state) })} className="rounded-full focus-visible:outline-2 focus-visible:outline-ring">
          {pill}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-72">
        <DropdownMenuLabel>{t('service.receiving')}</DropdownMenuLabel>
        <DropdownMenuItem
          icon={<PlayCircle />}
          onSelect={() => void set(true, 0, t('service.toastOpen'))}
          className={cn(restaurant.isOpen && rush === 0 && 'font-medium')}
        >
          <span className="flex items-center justify-between gap-2">
            {t('service.open')}
            {restaurant.isOpen && rush === 0 && <Check className="size-4 text-primary!" />}
          </span>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <p className="px-2 pb-1 pt-1.5 text-2xs text-fg-subtle">{t('service.rushHint')}</p>
        {RUSH_STEPS.map((minutes) => (
          <DropdownMenuItem key={minutes} icon={<Flame />} onSelect={() => void set(true, minutes, t('service.toastRush', { minutes }))}>
            <span className="flex items-center justify-between gap-2">
              {t('service.plusMinutes', { minutes })}
              {rush === minutes && <Check className="size-4 text-primary!" />}
            </span>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem icon={<PauseCircle />} onSelect={() => void set(false, 0, t('service.toastPaused'))}>
          <span className="flex items-center justify-between gap-2">
            {t('service.pause')}
            {!restaurant.isOpen && <Check className="size-4 text-primary!" />}
          </span>
        </DropdownMenuItem>
        {!restaurant.acceptingOrders && restaurant.isOpen && (
          <p className="mx-1 mb-1 mt-1.5 rounded-md bg-surface-2 px-2 py-1.5 text-2xs leading-4 text-fg-muted">
            {t('service.outsideHours')}
          </p>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
