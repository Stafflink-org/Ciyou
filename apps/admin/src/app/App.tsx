import { RouterProvider } from 'react-router';
import { Toaster } from '@golink/ui';
import { AuthProvider, BrandingEffect, FaviconEffect, I18nProvider } from '@golink/web';
import { auth, db } from '@/lib/firebase';
import { ReasonPromptHost } from '@/lib/reason';
import { ColorModeProvider, useAppColorMode } from './color-mode';
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
          <RouterProvider router={router} />
          <BrandingEffect db={db} />
          <FaviconEffect db={db} />
          <ReasonPromptHost />
          <ThemedToaster />
        </I18nProvider>
      </AuthProvider>
    </ColorModeProvider>
  );
}
