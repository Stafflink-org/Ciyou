import { useState } from 'react';
import { Pause, Pencil, Play, Trash2 } from 'lucide-react';
import { ConfirmDialog, DropdownMenuItem, DropdownMenuSeparator } from '@golink/ui';
import { useActiveRestaurant } from '@/auth/RestaurantAccess';
import { callFunction, useMutation } from '@/lib/firestore';
import { productOfferStatus, today, type OfferRow } from './lib';

const toggleProductOffer = callFunction<{ restaurantId: string; offerId: string; active: boolean }, { offerId: string; active: boolean }>('toggleProductOffer');
const deleteProductOffer = callFunction<{ restaurantId: string; offerId: string }, { offerId: string; status: 'deleted' }>('deleteProductOffer');

/** Mise en pause / relance / suppression, avec confirmation pour la suppression. */
export function useOfferActions() {
  const restaurant = useActiveRestaurant();
  const [confirmDelete, setConfirmDelete] = useState<OfferRow | null>(null);

  const toggle = useMutation(
    async (offer: OfferRow) => toggleProductOffer({ restaurantId: restaurant.id, offerId: offer.id, active: !offer.active }),
    { success: (r) => (r.active ? 'Offre relancée.' : 'Offre mise en pause.') },
  );

  const remove = useMutation(async (offer: OfferRow) => deleteProductOffer({ restaurantId: restaurant.id, offerId: offer.id }), {
    success: () => 'Offre supprimée.',
  });

  const dialog = (
    <ConfirmDialog
      open={confirmDelete !== null}
      onOpenChange={(open) => !open && setConfirmDelete(null)}
      destructive
      title="Supprimer cette offre ?"
      description={`« ${confirmDelete?.title ?? ''} » ne sera plus proposée à vos clients. Elle reste consultable un temps dans la corbeille.`}
      confirmLabel="Supprimer"
      onConfirm={async () => {
        if (confirmDelete) await remove.mutate(confirmDelete);
      }}
    />
  );

  return {
    toggle: (offer: OfferRow) => void toggle.mutate(offer),
    askDelete: (offer: OfferRow) => setConfirmDelete(offer),
    dialog,
    loading: toggle.loading || remove.loading,
  };
}

export function OfferMenuItems({ offer, onEdit, actions }: { offer: OfferRow; onEdit: () => void; actions: ReturnType<typeof useOfferActions> }) {
  const status = productOfferStatus(offer, today());
  const disabledByPlatform = Boolean(offer.disabledByPlatform);
  return (
    <>
      {!disabledByPlatform && (
        <DropdownMenuItem icon={<Pencil />} onSelect={onEdit}>
          Modifier
        </DropdownMenuItem>
      )}
      {!disabledByPlatform && status !== 'ended' && (
        <DropdownMenuItem icon={offer.active ? <Pause /> : <Play />} onSelect={() => actions.toggle(offer)}>
          {offer.active ? 'Mettre en pause' : 'Relancer'}
        </DropdownMenuItem>
      )}
      <DropdownMenuSeparator />
      <DropdownMenuItem icon={<Trash2 />} destructive onSelect={() => actions.askDelete(offer)}>
        Supprimer
      </DropdownMenuItem>
    </>
  );
}
