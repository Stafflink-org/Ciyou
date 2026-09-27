import { RouterProvider } from 'react-router';
import { Toaster } from '@golink/ui';
import { AuthProvider, BrandingEffect, I18nProvider } from '@golink/web';
import { auth, db } from '@/lib/firebase';
import { ReasonPromptHost } from '@/lib/reason';
import { router } from './router';

export function App() {
  return (
    <AuthProvider auth={auth}>
      <I18nProvider db={db}>
        <RouterProvider router={router} />
        <BrandingEffect db={db} />
        <ReasonPromptHost />
        <Toaster theme="dark" />
      </I18nProvider>
    </AuthProvider>
  );
}
