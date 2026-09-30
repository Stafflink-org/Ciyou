import type { ComponentType } from 'react';
import { ShieldCheck } from 'lucide-react';
import { defineModule } from '@/app/define-module';

const page = <K extends string>(load: () => Promise<Record<K, ComponentType>>, name: K) => () => load().then((m) => ({ Component: m[name] }));

export default defineModule({
  id: 'haccp',
  nav: { group: 'equipe', label: 'HACCP', icon: <ShieldCheck />, order: 80, keywords: ['hygiène', 'températures', 'traçabilité', 'nettoyage', 'allergènes', 'sanitaire'], feature: 'haccp' },
  permission: 'haccp.record',
  routes: [
    { path: 'equipe/haccp', lazy: page(() => import('./HaccpDashboardPage'), 'HaccpDashboardPage') },
    { path: 'equipe/haccp/temperatures', lazy: page(() => import('./TemperaturesPage'), 'TemperaturesPage') },
    { path: 'equipe/haccp/receptions', lazy: page(() => import('./ReceptionsPage'), 'ReceptionsPage') },
    { path: 'equipe/haccp/nettoyage', lazy: page(() => import('./CleaningPage'), 'CleaningPage') },
    { path: 'equipe/haccp/non-conformites', lazy: page(() => import('./NonConformitiesPage'), 'NonConformitiesPage') },
    { path: 'equipe/haccp/personnel', lazy: page(() => import('./PersonnelPage'), 'PersonnelPage') },
    { path: 'equipe/haccp/nuisibles', lazy: page(() => import('./PestsPage'), 'PestsPage') },
    { path: 'equipe/haccp/allergenes', lazy: page(() => import('./AllergensPage'), 'AllergensPage') },
    { path: 'equipe/haccp/registre', lazy: page(() => import('./RegisterPage'), 'RegisterPage') },
  ],
});
