// Mode maintenance (§30) : lit la source unique settings/maintenance et bloque
// réellement l'accès à l'application restaurant pendant la fenêtre annoncée.
import { useEffect, useState, type ReactNode } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { COLLECTIONS, SETTINGS_DOCS, type MaintenanceSettings } from '@golink/shared';
import { db } from '@/lib/firebase';

interface MaintenanceState {
  enabled: boolean;
  message: string | null;
}

export function MaintenanceGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<MaintenanceState | null>(null);

  useEffect(() => {
    const ref = doc(db, COLLECTIONS.settings, SETTINGS_DOCS.maintenance);
    return onSnapshot(
      ref,
      (snap) => {
        const data = snap.data() as MaintenanceSettings | undefined;
        const app = data?.apps?.restaurant;
        if (!app?.enabled) return setState({ enabled: false, message: null });
        const until = app.until as unknown as { toMillis?: () => number } | null;
        if (until?.toMillis && until.toMillis() <= Date.now()) return setState({ enabled: false, message: null });
        setState({ enabled: true, message: app.message?.fr ?? 'GoLink Restaurant est momentanément en maintenance. Réessayez dans quelques minutes.' });
      },
      () => setState({ enabled: false, message: null }),
    );
  }, []);

  if (state?.enabled) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-canvas px-6 text-center">
        <div className="max-w-md space-y-3">
          <h1 className="text-xl font-semibold text-fg">Maintenance en cours</h1>
          <p className="text-sm text-fg-muted">{state.message}</p>
        </div>
      </div>
    );
  }
  return <>{children}</>;
}
