import { createBrowserRouter } from 'react-router';
import { FullScreenLoader, NotFoundPanel, PublicOnly, RequireAuth, RouteErrorScreen, moduleRoutes } from '@golink/web';
import { AdminAccessGate, CAPTION } from '@/auth/AdminAccess';
import { AccessDeniedPage, ForgotPasswordPage, LoginPage, SetPasswordPage } from '@/auth/pages';
import { Shell } from '@/layout/Shell';
import { MODULES } from './modules';

export const router = createBrowserRouter([
  {
    errorElement: <RouteErrorScreen caption={CAPTION} />,
    hydrateFallbackElement: <FullScreenLoader />,
    children: [
      {
        element: <PublicOnly />,
        children: [
          { path: 'connexion', element: <LoginPage /> },
          { path: 'mot-de-passe-oublie', element: <ForgotPasswordPage /> },
        ],
      },
      // Lien d'invitation ou de réinitialisation : accessible connecté ou non.
      { path: 'definir-mot-de-passe', element: <SetPasswordPage /> },
      { path: 'acces-refuse', element: <AccessDeniedPage /> },
      {
        element: <RequireAuth />,
        children: [
          {
            element: <AdminAccessGate />,
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
]);
