import { useEffect, useMemo, useState } from 'react';
import { collection, query, where } from 'firebase/firestore';
import { useMapsLibrary } from '@vis.gl/react-google-maps';
import { CircleCheck, Crosshair, MapPin, Navigation, TriangleAlert } from 'lucide-react';
import { Badge, Button, FormField, Input, toast } from '@golink/ui';
import { COLLECTIONS, isPointInPolygon, type LatLng, type Zone } from '@golink/shared';
import { useRestaurantAccess } from '@/auth/RestaurantAccess';
import { db } from '@/lib/firebase';
import { useCollection, useMutation } from '@/lib/firestore';
import { updateRestaurantSettings } from '../parametres/kit/api';
import { useDraft, useUnsavedGuard } from '../parametres/kit/hooks';
import { ConfigMap, MapRecenter, PolygonShape, RestaurantPin, useMapsAvailable, themeColor, useMapsAuthFailed } from '../parametres/kit/map';
import { Notice, SaveBar, SettingsCard } from '../parametres/kit/ui';

interface Draft {
  line1: string;
  line2: string;
  postalCode: string;
  city: string;
  location: LatLng | null;
  placeId: string | null;
}

/** Adresse de l'établissement, position sur la carte et couverture des zones Ciyou Eats de la ville. */
export function AddressTab({ active }: { active: boolean }) {
  const { restaurant, restaurantId } = useRestaurantAccess();
  const zones = useCollection<Zone>(query(collection(db, COLLECTIONS.zones), where('cityId', '==', restaurant.cityId)));

  const source = useMemo<Draft>(
    () => ({
      line1: restaurant.address.line1 ?? '',
      line2: restaurant.address.line2 ?? '',
      postalCode: restaurant.address.postalCode ?? '',
      city: restaurant.address.city ?? '',
      location: restaurant.address.geo ? { lat: restaurant.address.geo.latitude, lng: restaurant.address.geo.longitude } : null,
      placeId: restaurant.address.placeId ?? null,
    }),
    [restaurant.address],
  );
  const { draft, setDraft, dirty, reset, markSaved } = useDraft<Draft>(source, restaurantId);
  useUnsavedGuard(dirty);
  const save = useMutation(updateRestaurantSettings, { success: 'Adresse enregistrée.' });
  const [geocoding, setGeocoding] = useState(false);
  const [recenter, setRecenter] = useState<LatLng | null>(null);
  const mapFailed = useMapsAuthFailed();
  const mapsAvailable = useMapsAvailable();
  const [geocodingLib, setGeocodingLib] = useState<google.maps.GeocodingLibrary | null>(null);

  const activeZones = zones.data.filter((z) => z.active);
  const covering = draft?.location ? activeZones.filter((z) => isPointInPolygon(draft.location!, z.polygon)) : [];
  const outside = Boolean(draft?.location) && activeZones.length > 0 && covering.length === 0;
  const center = draft?.location ?? source.location ?? { lat: 49.1193, lng: 6.1757 };

  if (!draft) return null;

  const addressChanged =
    draft.line1 !== source.line1 || draft.postalCode !== source.postalCode || draft.city !== source.city || draft.line2 !== source.line2;
  const locationStale = addressChanged && draft.location !== null && draft.placeId === source.placeId && draft.location === source.location;
  const invalid = draft.line1.trim().length < 3 || !draft.postalCode.trim() || !draft.city.trim() || !draft.location || outside;

  const onSave = async () => {
    if (!draft.location) return;
    const result = await save.mutate({
      restaurantId,
      section: 'address',
      line1: draft.line1.trim(),
      line2: draft.line2.trim() || null,
      postalCode: draft.postalCode.trim(),
      city: draft.city.trim(),
      location: draft.location,
      placeId: draft.placeId,
    });
    if (result) markSaved();
  };

  return (
    <>
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
        <SettingsCard icon={<MapPin />} title="Adresse" description="Adresse de retrait des commandes, utilisée par les livreurs et affichée aux clients.">
          <div className="grid gap-5">
            <FormField label="Adresse" required>
              <Input value={draft.line1} autoComplete="address-line1" onChange={(e) => setDraft({ line1: e.target.value })} />
            </FormField>
            <FormField label="Complément" hint="Bâtiment, étage, entrée de service…">
              <Input value={draft.line2} autoComplete="address-line2" onChange={(e) => setDraft({ line2: e.target.value })} />
            </FormField>
            <div className="grid gap-5 sm:grid-cols-[140px_minmax(0,1fr)]">
              <FormField label="Code postal" required>
                <Input value={draft.postalCode} autoComplete="postal-code" onChange={(e) => setDraft({ postalCode: e.target.value })} />
              </FormField>
              <FormField label="Ville" required>
                <Input value={draft.city} autoComplete="address-level2" onChange={(e) => setDraft({ city: e.target.value })} />
              </FormField>
            </div>
            {mapsAvailable && !mapFailed ? (
              <Geocoder
                lib={geocodingLib}
                address={`${draft.line1}, ${draft.postalCode} ${draft.city}, ${restaurant.countryId === 'LU' ? 'Luxembourg' : 'France'}`}
                busy={geocoding}
                setBusy={setGeocoding}
                onResult={(location, placeId) => {
                  setDraft({ location, placeId });
                  setRecenter(location);
                }}
              />
            ) : (
              <Notice tone="amber">La carte n’est pas disponible : la position actuelle est conservée. Vous pouvez modifier le texte de l’adresse.</Notice>
            )}
            {locationStale && (
              <Notice tone="amber" title="Position à mettre à jour">
                L’adresse a changé : localisez-la à nouveau pour déplacer le repère.
              </Notice>
            )}
          </div>
        </SettingsCard>

        <SettingsCard
          icon={<Navigation />}
          title="Position sur la carte"
          description="Faites glisser le repère pour le placer exactement sur votre entrée."
          actions={
            draft.location ? (
              outside ? (
                <Badge tone="danger" icon={<TriangleAlert />}>Hors zone Ciyou Eats</Badge>
              ) : covering.length > 0 ? (
                <Badge tone="success" icon={<CircleCheck />}>{covering.map((z) => z.name).join(', ')}</Badge>
              ) : null
            ) : (
              <Badge tone="amber">Non localisée</Badge>
            )
          }
        >
          <ConfigMap center={center} zoom={14} height={380}>
            <MapRecenter center={recenter} zoom={16} />
            <GeocodingBridge onReady={setGeocodingLib} />
            {activeZones.map((zone) => (
              <PolygonShape key={zone.id} path={zone.polygon} style={{ color: zone.color || themeColor('chart-2'), fillOpacity: 0.06, strokeWeight: 1, dashed: true }} />
            ))}
            {draft.location && (
              <RestaurantPin
                position={draft.location}
                label={restaurant.name}
                draggable
                onDragEnd={(location) => setDraft({ location, placeId: null })}
              />
            )}
          </ConfigMap>
          {draft.location && (
            <p className="mt-3 font-mono text-2xs text-fg-subtle num">
              {draft.location.lat.toFixed(6)}, {draft.location.lng.toFixed(6)}
            </p>
          )}
          {outside && (
            <Notice tone="danger" className="mt-4" title="Adresse en dehors des zones desservies">
              Ciyou Eats ne livre pas encore ce secteur de {restaurant.address.city}. Contactez le support si vous déménagez.
            </Notice>
          )}
        </SettingsCard>
      </div>
      {active && (
        <SaveBar
          dirty={dirty}
          saving={save.loading}
          disabled={invalid}
          message={outside ? 'Adresse hors zone : enregistrement impossible' : !draft.location ? 'Localisez l’adresse sur la carte' : 'Adresse modifiée'}
          onSave={() => void onSave()}
          onReset={() => {
            reset();
            setRecenter(source.location);
          }}
        />
      )}
    </>
  );
}

/** Transmet la bibliothèque de géocodage chargée par la carte au formulaire. */
function GeocodingBridge({ onReady }: { onReady: (lib: google.maps.GeocodingLibrary) => void }) {
  const lib = useMapsLibrary('geocoding');
  useEffect(() => {
    if (lib) onReady(lib);
  }, [lib, onReady]);
  return null;
}

/** Géocodage de l'adresse saisie (API Geocoding du navigateur, clé Ciyou Eats). */
function Geocoder({
  lib: geocoding,
  address,
  busy,
  setBusy,
  onResult,
}: {
  lib: google.maps.GeocodingLibrary | null;
  address: string;
  busy: boolean;
  setBusy: (busy: boolean) => void;
  onResult: (location: LatLng, placeId: string | null) => void;
}) {
  const locate = async () => {
    if (!geocoding) return;
    setBusy(true);
    try {
      const geocoder = new geocoding.Geocoder();
      const { results } = await geocoder.geocode({ address, region: 'fr', language: 'fr' } as google.maps.GeocoderRequest);
      const first = results[0];
      if (!first) {
        toast.error('Adresse introuvable. Vérifiez la saisie.');
        return;
      }
      onResult({ lat: Number(first.geometry.location.lat().toFixed(6)), lng: Number(first.geometry.location.lng().toFixed(6)) }, first.place_id ?? null);
      toast.success('Adresse localisée. Ajustez le repère si besoin.');
    } catch {
      toast.error('Adresse introuvable. Vérifiez la saisie ou placez le repère à la main.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Button variant="secondary" leftIcon={<Crosshair />} loading={busy || !geocoding} onClick={() => void locate()} className="justify-self-start">
      Localiser l’adresse sur la carte
    </Button>
  );
}
