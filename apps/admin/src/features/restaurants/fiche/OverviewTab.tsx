// Fiche restaurant, onglet « Aperçu » : identité, coordonnées, horaires, zones,
// modes de service, propriétaire et équipe, groupe.
import { useMemo } from 'react';
import { Link } from 'react-router';
import { limit, orderBy, query, where } from 'firebase/firestore';
import { Clock, MapPin as MapPinIcon, Network, Store, UserRound } from 'lucide-react';
import { Badge, MapContainer, MapPin, Skeleton, formatDate } from '@golink/ui';
import {
  COLLECTIONS,
  FULFILLMENT_LABELS,
  MERCHANT_TYPE_LABELS,
  PAYMENT_METHOD_LABELS,
  paths,
  type CuisineCategory,
  type Restaurant,
  type RestaurantGroup,
  type RestaurantMember,
  type UserProfile,
  type WithId,
  type Zone,
} from '@golink/shared';
import { useRuntimeConfig } from '@golink/web';
import { useCan } from '@/auth/AdminAccess';
import { functions } from '@/lib/firebase';
import { collectionAt, docAt, toDate, useCollection, useDoc } from '@/lib/firestore';
import { Facts, Panel, eur } from '../../acteurs-commun/ui';

const DAYS = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'];

export function OverviewTab({ restaurant, cityName }: { restaurant: WithId<Restaurant>; cityName: string }) {
  const can = useCan();
  const runtimeConfig = useRuntimeConfig(functions);
  const cuisines = useCollection<CuisineCategory>(useMemo(() => query(collectionAt(COLLECTIONS.cuisineCategories), orderBy('order')), []));
  const zones = useCollection<Zone>(useMemo(() => query(collectionAt(COLLECTIONS.zones), where('cityId', '==', restaurant.cityId)), [restaurant.cityId]));
  const owner = useDoc<UserProfile>(docAt(paths.user(restaurant.ownerId)));
  const group = useDoc<RestaurantGroup>(restaurant.groupId ? docAt(`${COLLECTIONS.restaurantGroups}/${restaurant.groupId}`) : null);
  const members = useCollection<RestaurantMember>(
    useMemo(() => (can('restaurants.view') ? query(collectionAt(paths.restaurantSub(restaurant.id, 'members')), limit(50)) : null), [can, restaurant.id]),
  );
  const cuisineNames = restaurant.cuisineIds.map((id) => cuisines.data.find((c) => c.id === id)?.name.fr ?? id);
  const zoneNames = restaurant.zoneIds.map((id) => zones.data.find((z) => z.id === id)?.name ?? id);
  const geo = restaurant.address.geo;
  const position = geo ? { lat: geo.latitude, lng: geo.longitude } : null;
  const activeMembers = members.data.filter((m) => m.active && !m.revokedAt);

  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
      <div className="space-y-6">
        <Panel title="Identité" icon={<Store />}>
          <Facts
            items={[
              { label: 'Type de commerce', value: MERCHANT_TYPE_LABELS[restaurant.merchantType ?? 'restaurant'] },
              { label: 'Catégories', value: cuisineNames.length ? cuisineNames.join(', ') : '—' },
              { label: 'Gamme de prix', value: '€'.repeat(restaurant.priceLevel || 1) },
              restaurant.tags.length > 0 && { label: 'Étiquettes', value: restaurant.tags.join(', ') },
              { label: 'Description', value: <span className="font-normal text-fg-muted">{restaurant.description || '—'}</span> },
              { label: 'Inscrit le', value: toDate(restaurant.createdAt) ? formatDate(toDate(restaurant.createdAt)!) : '—' },
              restaurant.launchedAt && { label: 'En ligne depuis', value: formatDate(toDate(restaurant.launchedAt)!) },
            ]}
          />
        </Panel>

        <Panel title="Service et livraison" icon={<Clock />}>
          <Facts
            items={[
              { label: 'Modes', value: restaurant.fulfillmentModes.map((m) => FULFILLMENT_LABELS[m]).join(', ') || '—' },
              { label: 'Livraison assurée par', value: restaurant.deliveredBy === 'platform' ? 'Livreurs Ciyou Eats' : restaurant.deliveredBy === 'restaurant' ? 'Livreurs du commerce' : 'Ciyou Eats et livreurs du commerce' },
              { label: 'Zones Ciyou Eats', value: zoneNames.length ? zoneNames.join(', ') : <span className="text-danger">Aucune zone</span> },
              { label: 'Minimum de commande', value: eur(restaurant.minOrderCents), hint: 'Frais et minimum définis par le commerce sur ses zones' },
              { label: 'Préparation', value: `${restaurant.prepMinutes} min`, hint: `Livraison annoncée ${restaurant.etaMinutes.min}–${restaurant.etaMinutes.max} min` },
              { label: 'Paiements acceptés', value: restaurant.acceptedPaymentMethods.map((m) => PAYMENT_METHOD_LABELS[m]).join(', ') || '—' },
              { label: 'Ouverture', value: restaurant.isOpen ? <Badge tone="success">Ouvert</Badge> : <Badge tone="neutral">Fermé</Badge> },
            ]}
          />
          <div className="mt-4 rounded-xl border border-border bg-surface-2 px-4 py-3">
            <p className="eyebrow mb-2">Horaires</p>
            <ul className="space-y-1 text-sm">
              {DAYS.map((label, index) => {
                const day = restaurant.hoursSummary?.days?.find((d) => d.day === index);
                return (
                  <li key={label} className="flex justify-between gap-3">
                    <span className="text-fg-muted">{label}</span>
                    <span className="text-right font-mono text-xs text-fg num">
                      {day?.open && day.slots.length ? day.slots.map((s) => `${s.from}–${s.to}`).join(' · ') : 'Fermé'}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        </Panel>
      </div>

      <div className="space-y-6">
        <Panel title="Adresse" icon={<MapPinIcon />} bodyClassName="space-y-4">
          <p className="text-sm text-fg">
            {restaurant.address.line1}
            {restaurant.address.line2 ? `, ${restaurant.address.line2}` : ''}
            <br />
            {restaurant.address.postalCode} {restaurant.address.city}
            {cityName && cityName !== restaurant.address.city ? ` · ${cityName}` : ''}
          </p>
          {position ? (
            <MapContainer apiKey={runtimeConfig?.googleMapsWebKey ?? undefined} center={position} zoom={15} height={200} dark>
              <MapPin position={position} icon={<Store />} label={restaurant.name} />
            </MapContainer>
          ) : (
            <p className="text-sm text-fg-subtle">Adresse non géolocalisée : zones à rattacher manuellement.</p>
          )}
          <Facts items={[{ label: 'Téléphone', value: restaurant.phone || '—' }, { label: 'E-mail', value: restaurant.email || '—' }]} />
        </Panel>

        <Panel title="Propriétaire et équipe" icon={<UserRound />}>
          {owner.loading ? (
            <Skeleton className="h-16 w-full" />
          ) : (
            <Facts
              items={[
                { label: 'Propriétaire', value: owner.data?.displayName ?? '—', hint: owner.data?.email },
                { label: 'Dernière connexion', value: toDate(owner.data?.lastLoginAt) ? formatDate(toDate(owner.data?.lastLoginAt)!) : '—' },
                { label: 'Accès actifs', value: members.loading ? '…' : `${activeMembers.length}` },
              ]}
            />
          )}
        </Panel>

        {restaurant.groupId && (
          <Panel title="Groupe" icon={<Network />}>
            {group.data ? (
              <Facts
                items={[
                  { label: 'Groupe', value: <Link to={`/restaurants/groupes?groupe=${restaurant.groupId}`} className="text-primary-soft-fg hover:underline">{group.data.name}</Link> },
                  { label: 'Établissements', value: `${group.data.restaurantIds.length}` },
                  { label: 'Facturation', value: group.data.consolidatedBilling ? 'Consolidée' : 'Par établissement' },
                ]}
              />
            ) : (
              <Skeleton className="h-12 w-full" />
            )}
          </Panel>
        )}
      </div>
    </div>
  );
}
