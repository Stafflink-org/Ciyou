// Contrat d'une rubrique du super admin, importé par src/features/<id>/module.tsx.
import type { AdminPermission } from '@golink/shared';
import type { AppModule } from '@golink/web';
import type { AdminNavGroup } from './navigation';

export type AdminModule = AppModule<AdminNavGroup, AdminPermission>;

/** Déclare une rubrique (typage du groupe de navigation et de la permission). */
export function defineModule(module: AdminModule): AdminModule {
  return module;
}
