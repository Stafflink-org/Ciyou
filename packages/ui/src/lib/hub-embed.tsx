// Contexte « page intégrée » : une rubrique agrégée dans un hub à onglets (Paiement,
// Marketing…) est rendue sans dupliquer son propre PageHeader/PageContainer, qui sont
// déjà fournis par le hub. Par défaut (hors hub), rien ne change.
import { createContext, useContext, type ReactNode } from 'react';

const HubEmbedContext = createContext(false);

/** Enveloppe les onglets/cartes d'un hub : leurs PageHeader/PageContainer s'effacent. */
export function HubEmbedProvider({ children }: { children: ReactNode }) {
  return <HubEmbedContext.Provider value={true}>{children}</HubEmbedContext.Provider>;
}

/** Vrai à l'intérieur d'un `HubEmbedProvider` (rubrique affichée dans un hub). */
export function useHubEmbed(): boolean {
  return useContext(HubEmbedContext);
}
