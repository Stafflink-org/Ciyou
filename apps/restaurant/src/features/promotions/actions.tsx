import { useState } from 'react';
import { Copy, Pause, Pencil, Play, Send, Square, Trash2, Undo2 } from 'lucide-react';
import { ConfirmDialog, DropdownMenuItem, DropdownMenuSeparator } from '@golink/ui';
import type { PromotionStatus } from '@golink/shared';
import { callFunction, useMutation } from '@/lib/firestore';
import { promotionName, type PromotionRow } from './lib';

export type LifecycleAction = 'submit' | 'withdraw' | 'pause' | 'resume' | 'end' | 'delete';

const updatePromotion = callFunction<{ action: LifecycleAction; promotionId: string }, { promotionId: string; status: PromotionStatus | 'deleted' }>(
  'updatePromotion',
);

const SUCCESS: Record<LifecycleAction, string> = {
  submit: 'Offre envoyée.',
  withdraw: 'Offre retirée de la validation.',
  pause: 'Offre mise en pause.',
  resume: 'Offre relancée.',
  end: 'Offre terminée.',
  delete: 'Brouillon supprimé.',
};

/** Actions de cycle de vie d'une offre, avec confirmation pour les actions définitives. */
export function usePromotionActions() {
  const [confirm, setConfirm] = useState<{ action: 'end' | 'delete'; promotions: PromotionRow[] } | null>(null);
  const run = useMutation(
    async (action: LifecycleAction, promotions: PromotionRow[]) => {
      for (const p of promotions) await updatePromotion({ action, promotionId: p.id });
      return action;
    },
    { success: (action) => SUCCESS[action] },
  );

  function trigger(action: LifecycleAction, promotions: PromotionRow[]) {
    if (action === 'end' || action === 'delete') setConfirm({ action, promotions });
    else void run.mutate(action, promotions);
  }

  const dialog = (
    <ConfirmDialog
      open={confirm !== null}
      onOpenChange={(open) => !open && setConfirm(null)}
      destructive
      title={
        confirm?.action === 'delete'
          ? 'Supprimer ce brouillon ?'
          : confirm && confirm.promotions.length > 1
            ? `Terminer ${confirm.promotions.length} offres ?`
            : 'Terminer cette offre ?'
      }
      description={
        confirm?.action === 'delete'
          ? `Le brouillon « ${confirm ? promotionName(confirm.promotions[0]!) : ''} » sera définitivement supprimé.`
          : 'Les clients ne pourront plus en profiter. Son historique et ses statistiques restent consultables.'
      }
      confirmLabel={confirm?.action === 'delete' ? 'Supprimer' : 'Terminer'}
      onConfirm={async () => {
        if (confirm) await run.mutate(confirm.action, confirm.promotions);
      }}
    />
  );

  return { trigger, dialog, loading: run.loading };
}

/** Entrées de menu disponibles selon le statut de l'offre. */
export function PromotionMenuItems({
  promotion,
  onEdit,
  onDuplicate,
  onAction,
  submitLabel,
}: {
  promotion: PromotionRow;
  onEdit: () => void;
  onDuplicate: () => void;
  onAction: (action: LifecycleAction) => void;
  submitLabel: string;
}) {
  const s = promotion.status;
  return (
    <>
      {s !== 'ended' && (
        <DropdownMenuItem icon={<Pencil />} onSelect={onEdit}>
          Modifier
        </DropdownMenuItem>
      )}
      <DropdownMenuItem icon={<Copy />} onSelect={onDuplicate}>
        Dupliquer
      </DropdownMenuItem>
      {(s === 'draft' || s === 'rejected') && (
        <DropdownMenuItem icon={<Send />} onSelect={() => onAction('submit')}>
          {submitLabel}
        </DropdownMenuItem>
      )}
      {s === 'pending_review' && (
        <DropdownMenuItem icon={<Undo2 />} onSelect={() => onAction('withdraw')}>
          Retirer de la validation
        </DropdownMenuItem>
      )}
      {s === 'active' && (
        <DropdownMenuItem icon={<Pause />} onSelect={() => onAction('pause')}>
          Mettre en pause
        </DropdownMenuItem>
      )}
      {s === 'paused' && (
        <DropdownMenuItem icon={<Play />} onSelect={() => onAction('resume')}>
          Relancer
        </DropdownMenuItem>
      )}
      {['active', 'paused', 'pending_review'].includes(s) && (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuItem icon={<Square />} destructive onSelect={() => onAction('end')}>
            Terminer l’offre
          </DropdownMenuItem>
        </>
      )}
      {(s === 'draft' || s === 'rejected') && promotion.stats.redemptions === 0 && (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuItem icon={<Trash2 />} destructive onSelect={() => onAction('delete')}>
            Supprimer le brouillon
          </DropdownMenuItem>
        </>
      )}
    </>
  );
}
