import { limit, orderBy, query, where } from 'firebase/firestore';
import { COLLECTIONS, type Campaign, type RestaurantCampaignSegment, type WithId } from '@golink/shared';
import type { StatusMeta } from '@golink/ui';
import { useCan, useRestaurantAccess } from '@/auth/RestaurantAccess';
import { callFunction, collectionAt, useCollection } from '@/lib/firestore';

export type CampaignRow = WithId<Campaign>;

export const CAMPAIGN_STATUS: Record<Campaign['status'], StatusMeta> = {
  draft: { label: 'Brouillon', tone: 'neutral' },
  scheduled: { label: 'Programmée', tone: 'teal' },
  sending: { label: 'Envoi en cours', tone: 'info', pulse: true },
  sent: { label: 'Envoyée', tone: 'success' },
  cancelled: { label: 'Annulée', tone: 'neutral' },
  failed: { label: 'Échec', tone: 'danger' },
};

export const CHANNEL_LABELS: Record<'push' | 'email', string> = { push: 'Notification', email: 'E-mail' };

export function useRestaurantCampaigns() {
  const { restaurantId } = useRestaurantAccess();
  const can = useCan();
  const q = can('marketing.manage')
    ? query(
        collectionAt(COLLECTIONS.campaigns),
        where('scope', '==', 'restaurant'),
        where('restaurantId', '==', restaurantId),
        orderBy('createdAt', 'desc'),
        limit(100),
      )
    : null;
  return useCollection<Campaign>(q);
}

export interface AudienceInput {
  restaurantId: string;
  channel: 'push' | 'email';
  segment: RestaurantCampaignSegment;
  inactiveDays: number;
}

export const estimateCampaignAudience = callFunction<AudienceInput, { segmentCount: number; reachable: number }>('estimateCampaignAudience');

export interface ScheduleInput extends AudienceInput {
  campaignId?: string;
  name: string;
  title: string;
  body: string;
  emailSubject: string | null;
  promotionId: string | null;
  mode: 'draft' | 'schedule' | 'send_now';
  scheduledAt: number | null;
}

export const scheduleCampaign = callFunction<ScheduleInput, { campaignId: string; status: Campaign['status']; stats: Campaign['stats'] }>('scheduleCampaign');
export const cancelCampaign = callFunction<{ campaignId: string }, { campaignId: string; status: 'cancelled' }>('cancelCampaign');

/** Date d'affichage : envoi réel, sinon programmation, sinon création. */
export function campaignDate(c: Campaign): { value: Campaign['createdAt']; label: string } {
  if (c.sentAt) return { value: c.sentAt, label: 'Envoyée le' };
  if (c.scheduledAt && c.status === 'scheduled') return { value: c.scheduledAt, label: 'Prévue le' };
  return { value: c.createdAt, label: 'Créée le' };
}

export function rate(part: number, total: number): number | null {
  return total > 0 ? part / total : null;
}

// ------------------------------------------------------------------ Heure de Paris
const PARIS = 'Europe/Paris';

function parisOffsetMinutes(ms: number): number {
  const label = new Intl.DateTimeFormat('en-US', { timeZone: PARIS, timeZoneName: 'shortOffset' }).formatToParts(ms).find((p) => p.type === 'timeZoneName')?.value ?? 'GMT+1';
  const match = /GMT([+-])(\d{1,2})(?::(\d{2}))?/.exec(label);
  if (!match) return 0;
  const minutes = Number(match[2]) * 60 + Number(match[3] ?? 0);
  return match[1] === '-' ? -minutes : minutes;
}

/** Jour choisi dans le calendrier + « HH:MM » à l'heure de Paris → instant (ms). */
export function parisDateTime(day: Date, time: string): number | null {
  const match = /^(\d{2}):(\d{2})$/.exec(time);
  if (!match) return null;
  const guess = Date.UTC(day.getFullYear(), day.getMonth(), day.getDate(), Number(match[1]), Number(match[2]));
  return guess - parisOffsetMinutes(guess) * 60_000;
}

/** Instant → jour (à minuit local, pour le calendrier) et heure « HH:MM » à Paris. */
export function toParisParts(ms: number): { day: Date; time: string } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', { timeZone: PARIS, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(ms)
      .map((p) => [p.type, p.value]),
  );
  return { day: new Date(Number(parts.year), Number(parts.month) - 1, Number(parts.day)), time: `${parts.hour}:${parts.minute}` };
}

export function formatParis(ms: number): string {
  return new Intl.DateTimeFormat('fr-FR', { timeZone: PARIS, weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }).format(ms);
}
