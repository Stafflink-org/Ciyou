// Bandeau de pause automatique : après plusieurs commandes non acceptées
// d'affilée, Ciyou Eats met l'établissement en pause (paramètre du super admin).
import { useCallback } from 'react';
import { PauseCircle, PlayCircle } from 'lucide-react';
import { Button, toast } from '@golink/ui';
import { paths } from '@golink/shared';
import { useAuth } from '@golink/web';
import { updateDoc } from 'firebase/firestore';
import { useRestaurantAccess } from '@/auth/RestaurantAccess';
import { docAt, updatedFields, useMutation } from '@/lib/firestore';

export function AutoPauseBanner({ className }: { className?: string }) {
  const { user } = useAuth();
  const { restaurant, can } = useRestaurantAccess();
  const reopen = useCallback(
    () => updateDoc(docAt(paths.restaurant(restaurant.id)), { isOpen: true, busyExtraMinutes: 0, ...updatedFields(user?.uid ?? '') }).then(() => true),
    [restaurant.id, user],
  );
  const { mutate, loading } = useMutation(reopen);
  const missed = restaurant.missedOrdersInARow ?? 0;
  // Pause automatique encore en vigueur : aucune écriture sur l'établissement depuis.
  const autoPaused = Boolean(restaurant.autoPausedAt && restaurant.updatedAt && restaurant.autoPausedAt.toMillis() >= restaurant.updatedAt.toMillis());
  if (restaurant.isOpen || missed === 0 || !autoPaused || restaurant.status === 'suspended') return null;

  return (
    <div role="status" className={`tone-amber flex flex-col gap-3 rounded-xl border border-(--tone-border) bg-(--tone-bg) px-4 py-3 sm:flex-row sm:items-center sm:justify-between ${className ?? ''}`}>
      <div className="flex items-start gap-3">
        <PauseCircle className="mt-0.5 size-5 shrink-0 text-(--tone-fg)" />
        <div>
          <p className="text-sm font-semibold text-fg">Commandes en pause automatique</p>
          <p className="mt-0.5 text-sm text-fg-muted">
            {missed} commande{missed > 1 ? 's' : ''} n’{missed > 1 ? 'ont' : 'a'} pas été acceptée{missed > 1 ? 's' : ''} à temps : les clients ont été remboursés et votre établissement n’apparaît plus comme ouvert. Rouvrez dès que l’équipe est prête.
          </p>
        </div>
      </div>
      {can('orders.manage') && (
        <Button
          size="sm"
          variant="primary"
          loading={loading}
          leftIcon={<PlayCircle />}
          className="shrink-0"
          onClick={async () => {
            if (await mutate()) toast.success('Commandes rouvertes.');
          }}
        >
          Rouvrir les commandes
        </Button>
      )}
    </div>
  );
}
