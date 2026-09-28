// Vérification bloquante de la double authentification (cahier §27) : affichée à
// la place de l'application tant que la session n'a pas encore validé de code,
// sur un compte où la double authentification est exigée.
import { useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { Button, Card, CardContent, CardHeader, Input } from '@golink/ui';
import type { AdminUser, WithId } from '@golink/shared';
import { errorMessage } from '@/lib/firestore';
import { verifyTotp } from './api';

export function MfaChallengeScreen({
  admin,
  onVerified,
  onSignOut,
}: {
  admin: WithId<AdminUser>;
  onVerified: () => void;
  onSignOut: () => void;
}) {
  const [code, setCode] = useState('');
  const [method, setMethod] = useState<'totp' | 'recovery_code'>('totp');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setPending(true);
    setError(null);
    try {
      const result = await verifyTotp({ code: code.trim(), method });
      if (result.verified) onVerified();
    } catch (caught) {
      setError(errorMessage(caught, 'Code incorrect.'));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="grid min-h-dvh place-items-center bg-surface-1 px-4">
      <Card className="w-full max-w-sm">
        <CardHeader
          icon={<ShieldCheck />}
          title="Double authentification"
          description={`Bonjour ${admin.displayName}, saisissez le code de votre application d'authentification pour continuer.`}
        />
        <CardContent className="space-y-4">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (!pending && code.trim().length >= 6) void submit();
            }}
            className="space-y-4"
          >
            <Input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              maxLength={12}
              inputMode="numeric"
              autoFocus
              placeholder={method === 'totp' ? '123 456' : 'xxxx-xxxx'}
            />
            {error && <p className="text-sm text-danger">{error}</p>}
            <Button type="submit" className="w-full" loading={pending} disabled={code.trim().length < 6}>
              Valider
            </Button>
          </form>
          <div className="flex items-center justify-between text-xs text-fg-subtle">
            <button
              type="button"
              className="underline hover:text-fg"
              onClick={() => {
                setMethod((m) => (m === 'totp' ? 'recovery_code' : 'totp'));
                setCode('');
                setError(null);
              }}
            >
              {method === 'totp' ? 'Utiliser un code de secours' : "Utiliser l'application d'authentification"}
            </button>
            <button type="button" className="underline hover:text-fg" onClick={onSignOut}>
              Se déconnecter
            </button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
