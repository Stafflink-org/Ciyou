// Découverte des rubriques : chaque dossier src/features/<id>/module.tsx exporte
// par défaut `defineModule({...})`. Aucun fichier central à modifier.
import { collectModules } from '@golink/web';
import type { RestaurantModule } from './define-module';
import { NAV_GROUPS } from './navigation';

export const MODULES = collectModules<RestaurantModule>(
  import.meta.glob<{ default?: RestaurantModule }>('../features/*/module.tsx', { eager: true }),
  NAV_GROUPS,
);
