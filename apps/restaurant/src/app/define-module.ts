// Contrat d'une rubrique du back-office restaurant, importé par src/features/<id>/module.tsx.
import type { RestaurantPermission } from '@golink/shared';
import type { AppModule } from '@golink/web';
import type { RestaurantNavGroup } from './navigation';

export type RestaurantModule = AppModule<RestaurantNavGroup, RestaurantPermission>;

/** Déclare une rubrique (typage du groupe de navigation et de la permission). */
export function defineModule(module: RestaurantModule): RestaurantModule {
  return module;
}
