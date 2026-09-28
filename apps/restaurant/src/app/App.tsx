import { RouterProvider } from 'react-router';
import { Toaster } from '@golink/ui';
import { AuthProvider, BrandingEffect, I18nProvider } from '@golink/web';
import { auth, db } from '@/lib/firebase';
import { ColorModeProvider, useAppColorMode } from './color-mode';
import { MaintenanceGate } from './MaintenanceGate';
import { router } from './router';

function ThemedToaster() {
  const { mode } = useAppColorMode();
  return <Toaster theme={mode} />;
}

export function App() {
  return (
    <ColorModeProvider>
      <AuthProvider auth={auth}>
        <I18nProvider db={db}>
          <BrandingEffect db={db} />
          <MaintenanceGate>
            <RouterProvider router={router} />
          </MaintenanceGate>
          <ThemedToaster />
        </I18nProvider>
      </AuthProvider>
    </ColorModeProvider>
  );
}
