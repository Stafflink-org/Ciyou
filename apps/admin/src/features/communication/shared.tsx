// Éléments partagés des pages d'envoi.
import type { ReactElement } from 'react';
import { Bell, Mail, MessageSquareText, Smartphone } from 'lucide-react';
import type { Campaign, CampaignChannel } from '@golink/shared';
import type { useGeoNames } from '../_croissance/hooks';
import { SEGMENT_LABELS, USER_TYPE_LABELS } from '../_croissance/labels';

export const CHANNEL_ICONS: Record<CampaignChannel, ReactElement> = {
  push: <Smartphone />,
  email: <Mail />,
  sms: <MessageSquareText />,
  in_app: <Bell />,
};

/** Résumé lisible de la cible d'un envoi. */
export function audienceSummary(c: Campaign, names: ReturnType<typeof useGeoNames>, restaurantName: (id: string) => string): string {
  const a = c.audience;
  const parts: string[] = [USER_TYPE_LABELS[a.userType]];
  if (a.cityIds?.length) parts.push(a.cityIds.map((id) => names.city(id)).join(', '));
  else if (a.countryIds?.length) parts.push(a.countryIds.map((id) => names.country(id)).join(', '));
  else parts.push('tous les marchés');
  if (a.restaurantIds?.length) parts.push(a.userType === 'client' ? `clients de ${a.restaurantIds.map(restaurantName).join(', ')}` : a.restaurantIds.map(restaurantName).join(', '));
  if (a.planCodes?.length) parts.push(`formules ${a.planCodes.join(', ')}`);
  if (a.segment && a.segment !== 'all') parts.push(SEGMENT_LABELS[a.segment].toLowerCase());
  return parts.join(' · ');
}

