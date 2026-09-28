// Adresses (`AddressesScreen`, §18.1, §15 client.md) : lot « adresses » à venir
// (CRUD `users/{uid}/addresses`, géocodage — cf. packages/shared/src/models/users.ts).
import { PlaceholderScreen } from '../shared/PlaceholderScreen';

export function AddressesScreen() {
  return <PlaceholderScreen icon="📍" title="Vos adresses" note="Ajout, modification et sélection d'adresse arriveront dans un prochain lot." />;
}
