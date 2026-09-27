import type { ComponentType } from 'react';
import { Smartphone } from 'lucide-react';
import { defineModule } from '@/app/define-module';

const page = <T,>(loader: () => Promise<T>, pick: (m: T) => ComponentType) => () => loader().then((m) => ({ Component: pick(m) }));

export default defineModule({
  id: 'affichage',
  nav: {
    group: 'operations',
    label: 'Affichage app client',
    icon: <Smartphone />,
    order: 110,
    keywords: ['accueil', 'bannières', 'catégories', 'cuisines', 'classement', 'sponsorisé', 'mise en avant', 'pages', 'FAQ', 'CGU', 'mentions légales', 'confidentialité'],
  },
  permission: 'display.edit',
  routes: [
    { path: 'affichage', lazy: page(() => import('./HomeLayoutPage'), (m) => m.HomeLayoutPage) },
    { path: 'affichage/bannieres', lazy: page(() => import('./BannersPage'), (m) => m.BannersPage) },
    { path: 'affichage/categories', lazy: page(() => import('./CategoriesPage'), (m) => m.CategoriesPage) },
    { path: 'affichage/classement', lazy: page(() => import('./RankingPage'), (m) => m.RankingPage) },
    { path: 'affichage/sponsorise', lazy: page(() => import('./SponsoredPage'), (m) => m.SponsoredPage) },
    { path: 'affichage/pages', lazy: page(() => import('./PagesPage'), (m) => m.PagesPage) },
    { path: 'affichage/pages/:slug', lazy: page(() => import('./PageEditorPage'), (m) => m.PageEditorPage) },
    { path: 'affichage/legal/:documentId', lazy: page(() => import('./LegalEditorPage'), (m) => m.LegalEditorPage) },
  ],
});
