// Étapes de mise en route de l'établissement, calculées en temps réel.
import { useCan, useRestaurantAccess } from '@/auth/RestaurantAccess';
import { requirementState, requirementsFor, usePartnerContract, usePartnerDocuments, useRestaurantLegal } from '../../documents/hooks';
import { useCommercial } from './hooks';

export interface SetupStep {
  id: string;
  label: string;
  description: string;
  href: string;
  done: boolean;
  /** Étape non vérifiable avec les droits du membre connecté. */
  unknown?: boolean;
}

export function useSetupSteps(): { steps: SetupStep[]; loading: boolean } {
  const { restaurant } = useRestaurantAccess();
  const can = useCan();
  const settings = can('settings.manage');
  const finance = can('finance.view');
  const legal = useRestaurantLegal(settings);
  const docs = usePartnerDocuments(settings);
  const contract = usePartnerContract(settings);
  const commercial = useCommercial();

  const profileDone = Boolean(restaurant.description && restaurant.phone && restaurant.email && restaurant.cuisineIds?.length && (restaurant.logo || restaurant.cover));
  const openDays = restaurant.hoursSummary?.days?.filter((d) => d.open && d.slots.length > 0).length ?? 0;
  const requiredDocs = requirementsFor().filter((r) => r.required);
  const docsDone = requiredDocs.every((r) => ['approved', 'expiring', 'pending'].includes(requirementState(docs.data.find((d) => d.type === r.type))));
  const legalDone = Boolean(legal.data?.dac7Complete || (legal.data?.legalName && legal.data.siret && legal.data.taxIdentificationNumber));
  const contractDone = Boolean(contract.latest && legal.data?.partnerTermsVersion === contract.latest.version);
  const payoutsDone = commercial.data?.stripeAccountStatus === 'enabled';

  const steps: SetupStep[] = [
    { id: 'profile', label: 'Compléter le profil', description: 'Présentation, cuisines, coordonnées et visuels.', href: '/etablissement', done: profileDone },
    { id: 'address', label: 'Localiser l’établissement', description: 'Position exacte pour les livreurs.', href: '/etablissement?onglet=adresse', done: Boolean(restaurant.address.geo) },
    { id: 'hours', label: 'Définir les horaires', description: 'Créneaux d’ouverture de la semaine.', href: '/horaires', done: openDays > 0 },
    { id: 'legal', label: 'Informations légales', description: 'SIRET, TVA, numéro fiscal, siège.', href: '/etablissement?onglet=legal', done: legalDone, unknown: !settings },
    { id: 'documents', label: 'Déposer les justificatifs', description: 'Kbis, pièce d’identité, RIB.', href: '/documents', done: docsDone, unknown: !settings },
    { id: 'contract', label: 'Signer le contrat partenaire', description: 'Version en vigueur des conditions Ciyou Eats.', href: '/documents', done: contractDone, unknown: !settings },
    { id: 'payouts', label: 'Activer les versements', description: 'Compte bancaire vérifié par Stripe.', href: '/versements', done: payoutsDone, unknown: !finance },
  ];
  return { steps, loading: legal.loading || docs.loading || contract.loading || commercial.loading };
}

/** Pastille du menu Paramètres : étapes de mise en route restantes (hors pièces et contrat, comptés dans Documents). */
export function useSetupBadge(): number | null {
  const can = useCan();
  const { steps, loading } = useSetupSteps();
  if (!can('settings.manage') || loading) return null;
  const remaining = steps.filter((s) => !s.done && !s.unknown && s.id !== 'documents' && s.id !== 'contract').length;
  return remaining || null;
}
