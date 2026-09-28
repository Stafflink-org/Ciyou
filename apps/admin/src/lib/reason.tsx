// Motif obligatoire des actions sensibles : une boîte de dialogue unique, ouverte à la
// demande avant l'appel de la fonction serveur. Le serveur refuse de toute façon un appel
// sans motif ; cette boîte évite seulement d'aller-retour inutile et guide la saisie.
import { useEffect, useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { Button, Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, Textarea } from '@golink/ui';
import { callFunction } from './firestore';

export interface ReasonRequest {
  title: string;
  description?: string;
  confirmLabel?: string;
  placeholder?: string;
}

/** Levée quand l'utilisateur ferme la boîte sans confirmer. */
export class ReasonCancelledError extends Error {
  constructor() {
    super('Action annulée.');
    this.name = 'ReasonCancelledError';
  }
}

type Pending = { request: ReasonRequest; resolve: (reason: string) => void; reject: (error: Error) => void };
let listener: ((pending: Pending | null) => void) | null = null;
let current: Pending | null = null;

/** Demande un motif (au moins 3 caractères) et le renvoie ; rejette avec ReasonCancelledError si annulé. */
export function askReason(request: ReasonRequest): Promise<string> {
  return new Promise((resolve, reject) => {
    if (current) current.reject(new ReasonCancelledError());
    current = { request, resolve, reject };
    listener?.(current);
  });
}

/**
 * Fonction appelable dont le champ `reason` est demandé à l'utilisateur avant l'appel
 * (sauf si l'appelant le fournit déjà, ou si `skip(input)` est vrai : simulation, aperçu).
 * Ex. : `const run = callFunctionWithReason<In, Out>('executePayout', { title: 'Exécuter le reversement' });`
 */
export function callFunctionWithReason<Input extends object, Output = void>(
  name: string,
  request: ReasonRequest,
  skip?: (input: Input) => boolean,
) {
  const call = callFunction<Input & { reason?: string }, Output>(name);
  return async (input: Input): Promise<Output> => {
    if (skip?.(input)) return call(input);
    const given = (input as { reason?: string | null }).reason;
    const reason = typeof given === 'string' && given.trim().length >= 3 ? given.trim() : await askReason(request);
    return call({ ...input, reason });
  };
}

/** Variante pour une fonction dont le motif porte un autre nom de champ (ex. `changeSummary`, `note`). */
export function callFunctionWithReasonIn<Input extends object, Output = void>(name: string, field: string, request: ReasonRequest) {
  const call = callFunction<Input, Output>(name);
  return async (input: Input): Promise<Output> => {
    const given = (input as Record<string, unknown>)[field];
    const reason = typeof given === 'string' && given.trim().length >= 3 ? given.trim() : await askReason(request);
    return call({ ...input, [field]: reason });
  };
}

/** À monter une seule fois à la racine de l'application. */
export function ReasonPromptHost() {
  const [pending, setPending] = useState<Pending | null>(null);
  const [reason, setReason] = useState('');
  useEffect(() => {
    listener = (next) => {
      setReason('');
      setPending(next);
    };
    return () => {
      listener = null;
    };
  }, []);

  const close = (confirmed: boolean) => {
    const p = pending;
    current = null;
    setPending(null);
    if (!p) return;
    if (confirmed) p.resolve(reason.trim());
    else p.reject(new ReasonCancelledError());
  };
  const blocked = reason.trim().length < 3;
  return (
    <Dialog open={pending !== null} onOpenChange={(open) => !open && close(false)}>
      <DialogContent size="sm">
        <DialogHeader icon={<ShieldCheck />} title={pending?.request.title ?? ''} description={pending?.request.description ?? 'Le motif est conservé dans le journal d’audit.'} />
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (!blocked) close(true);
          }}
        >
          <DialogBody className="space-y-3 pt-2">
            <Textarea
              autoFocus
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              maxLength={500}
              placeholder={pending?.request.placeholder ?? 'Motif (obligatoire)'}
              aria-label="Motif"
            />
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => close(false)}>Annuler</Button>
            <Button type="submit" disabled={blocked}>{pending?.request.confirmLabel ?? 'Confirmer'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
