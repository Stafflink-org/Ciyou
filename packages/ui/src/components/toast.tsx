import { Toaster as SonnerToaster } from 'sonner';
import { AlertTriangle, CheckCircle2, Info, XCircle } from 'lucide-react';

/** Conteneur des notifications éphémères, à monter une fois à la racine. */
export function Toaster({ theme = 'light' }: { theme?: 'light' | 'dark' }) {
  return (
    <SonnerToaster
      theme={theme}
      position="bottom-right"
      gap={10}
      closeButton
      icons={{
        success: <CheckCircle2 className="size-[18px] text-success" />,
        error: <XCircle className="size-[18px] text-danger" />,
        warning: <AlertTriangle className="size-[18px] text-warning" />,
        info: <Info className="size-[18px] text-info" />,
      }}
      toastOptions={{
        classNames: {
          toast:
            'group rounded-xl! border! border-border! bg-elevated! text-fg! shadow-lg! font-sans! gap-3! px-4! py-3.5!',
          title: 'text-sm! font-semibold! text-fg!',
          description: 'text-xs! text-fg-muted!',
          actionButton: 'bg-primary! text-primary-fg! rounded-md! font-medium!',
          cancelButton: 'bg-surface-3! text-fg! rounded-md!',
          closeButton: 'bg-elevated! border-border! text-fg-subtle! hover:text-fg!',
        },
      }}
    />
  );
}
