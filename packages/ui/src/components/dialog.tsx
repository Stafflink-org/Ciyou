import { useState, type ComponentPropsWithoutRef, type ReactNode } from 'react';
import { Dialog as DialogPrimitive } from 'radix-ui';
import { AlertTriangle, X } from 'lucide-react';
import { cva } from 'class-variance-authority';
import { cn } from '../lib/cn';
import { Button } from './button';

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

function Overlay() {
  return (
    <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-overlay backdrop-blur-[2px] data-[state=open]:animate-fade-in data-[state=closed]:animate-fade-out" />
  );
}

function CloseButton() {
  return (
    <DialogPrimitive.Close
      aria-label="Fermer"
      className="absolute end-4 top-4 grid size-8 place-items-center rounded-lg text-fg-subtle transition-colors hover:bg-surface-3 hover:text-fg focus-visible:outline-2 focus-visible:outline-ring"
    >
      <X className="size-4" />
    </DialogPrimitive.Close>
  );
}

const dialogSizes = {
  sm: 'max-w-md',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
  xl: 'max-w-4xl',
} as const;

export interface DialogContentProps extends ComponentPropsWithoutRef<typeof DialogPrimitive.Content> {
  size?: keyof typeof dialogSizes;
  hideClose?: boolean;
}

/** Fenêtre modale centrée ; plein écran bas sur mobile. */
export function DialogContent({ className, size = 'md', hideClose, children, ...props }: DialogContentProps) {
  return (
    <DialogPrimitive.Portal>
      <Overlay />
      <DialogPrimitive.Content
        className={cn(
          'fixed left-1/2 top-1/2 z-50 flex max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 flex-col',
          'overflow-hidden rounded-2xl border border-border bg-surface text-fg shadow-xl outline-none',
          'data-[state=open]:animate-dialog-in data-[state=closed]:animate-dialog-out',
          dialogSizes[size],
          className,
        )}
        {...props}
      >
        {children}
        {!hideClose && <CloseButton />}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

export function DialogHeader({
  title,
  description,
  icon,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex gap-3.5 px-6 pb-2 pt-6 pe-14', className)}>
      {icon && (
        <div className="grid size-10 shrink-0 place-items-center rounded-xl border border-border bg-surface-2 text-fg-muted [&_svg]:size-5">
          {icon}
        </div>
      )}
      <div className="min-w-0 space-y-1">
        <DialogPrimitive.Title className="font-display text-lg font-semibold tracking-tight text-fg">
          {title}
        </DialogPrimitive.Title>
        {description ? (
          <DialogPrimitive.Description className="text-sm text-fg-muted">{description}</DialogPrimitive.Description>
        ) : (
          <DialogPrimitive.Description className="sr-only">{title}</DialogPrimitive.Description>
        )}
      </div>
    </div>
  );
}

export function DialogBody({ className, ...props }: ComponentPropsWithoutRef<'div'>) {
  return <div className={cn('min-h-0 flex-1 overflow-y-auto px-6 py-4', className)} {...props} />;
}

export function DialogFooter({ className, ...props }: ComponentPropsWithoutRef<'div'>) {
  return (
    <div
      className={cn(
        'flex flex-col-reverse gap-2 border-t border-border bg-surface-2 px-6 py-3.5 sm:flex-row sm:items-center sm:justify-end',
        className,
      )}
      {...props}
    />
  );
}

/* ------------------------------------------------------------------ Sheet */

const sheetVariants = cva(
  'fixed z-50 flex flex-col bg-surface text-fg shadow-xl outline-none border-border',
  {
    variants: {
      side: {
        right:
          'inset-y-0 end-0 h-full w-full border-s sm:max-w-md data-[state=open]:animate-sheet-right-in data-[state=closed]:animate-sheet-right-out',
        left: 'inset-y-0 start-0 h-full w-full border-e sm:max-w-md data-[state=open]:animate-sheet-left-in data-[state=closed]:animate-sheet-left-out',
        bottom:
          'inset-x-0 bottom-0 max-h-[90dvh] rounded-t-2xl border-t data-[state=open]:animate-sheet-bottom-in data-[state=closed]:animate-sheet-bottom-out',
      },
    },
    defaultVariants: { side: 'right' },
  },
);

export const Sheet = DialogPrimitive.Root;
export const SheetTrigger = DialogPrimitive.Trigger;
export const SheetClose = DialogPrimitive.Close;

export interface SheetContentProps extends ComponentPropsWithoutRef<typeof DialogPrimitive.Content> {
  side?: 'right' | 'left' | 'bottom';
  hideClose?: boolean;
}

/** Tiroir latéral (détail d'une commande, filtres avancés, formulaires longs). */
export function SheetContent({ className, side = 'right', hideClose, children, ...props }: SheetContentProps) {
  return (
    <DialogPrimitive.Portal>
      <Overlay />
      <DialogPrimitive.Content className={cn(sheetVariants({ side }), className)} {...props}>
        {children}
        {!hideClose && <CloseButton />}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

export const SheetHeader = DialogHeader;
export const SheetBody = DialogBody;
export const SheetFooter = DialogFooter;

/* ---------------------------------------------------------- ConfirmDialog */

export interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Style destructif (suppression, suspension…). */
  destructive?: boolean;
  /** Exige la saisie d'un motif (actions tracées dans le journal d'audit). */
  requireReason?: boolean;
  reasonLabel?: string;
  onConfirm: (reason?: string) => void | Promise<void>;
  children?: ReactNode;
}

/** Confirmation d'action sensible, avec motif optionnel et état de chargement. */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = 'Confirmer',
  cancelLabel = 'Annuler',
  destructive,
  requireReason,
  reasonLabel = 'Motif (obligatoire, conservé dans le journal d’audit)',
  onConfirm,
  children,
}: ConfirmDialogProps) {
  const [pending, setPending] = useState(false);
  const [reason, setReason] = useState('');
  const blocked = requireReason && reason.trim().length < 3;

  async function handleConfirm() {
    setPending(true);
    try {
      await onConfirm(requireReason ? reason.trim() : undefined);
      setReason('');
      onOpenChange(false);
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !pending && onOpenChange(next)}>
      <DialogContent size="sm" hideClose>
        <DialogHeader
          title={title}
          description={description}
          icon={destructive ? <AlertTriangle className="text-danger" /> : undefined}
        />
        <DialogBody className="space-y-3 pt-2">
          {children}
          {requireReason && (
            <label className="block space-y-1.5">
              <span className="text-sm font-medium text-fg">{reasonLabel}</span>
              <textarea
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                rows={3}
                className="w-full rounded-lg border border-border-strong bg-surface px-3 py-2 text-sm text-fg shadow-xs focus-visible:border-primary focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-primary/20"
              />
            </label>
          )}
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={pending}>
            {cancelLabel}
          </Button>
          <Button variant={destructive ? 'danger' : 'primary'} loading={pending} disabled={blocked} onClick={handleConfirm}>
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
