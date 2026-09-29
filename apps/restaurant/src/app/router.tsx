import { createBrowserRouter } from 'react-router';
import { FullScreenLoader, NotFoundPanel, PublicOnly, RequireAuth, RouteErrorScreen, moduleRoutes } from '@golink/web';
import { AccessDeniedPage, ForgotPasswordPage, InvitationRedirect, LoginPage, SetPasswordPage } from '@/auth/pages';
import { AccessGate } from '@/auth/Impersonation';
import { SignupPage } from '@/auth/SignupPage';
import { LegalGate } from '@/features/legal/LegalGate';
import { Shell } from '@/layout/Shell';
import { MODULES } from './modules';

export const router = createBrowserRouter([
  {
    errorElement: <RouteErrorScreen caption="Restaurant" />,
    hydrateFallbackElement: <FullScreenLoader />,
    children: [
      {
        element: <PublicOnly />,
        children: [
          { path: 'connexion', element: <LoginPage /> },
          { path: 'mot-de-passe-oublie', element: <ForgotPasswordPage /> },
          { path: 'inscription', element: <SignupPage /> },
        ],
      },
      // Lien d'invitation ou de réinitialisation : accessible connecté ou non.
      { path: 'definir-mot-de-passe', element: <SetPasswordPage /> },
      { path: 'acces-refuse', element: <AccessDeniedPage /> },
      {
        element: <RequireAuth />,
        children: [
          { path: 'invitation', element: <InvitationRedirect /> },
          {
            element: <AccessGate />,
            children: [
              {
                element: <LegalGate />,
                children: [
                  {
                    element: <Shell />,
                    children: [...moduleRoutes(MODULES), { path: '*', element: <NotFoundPanel /> }],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  },
]);
