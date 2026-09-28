// Éléments communs de la rubrique « Affichage app client » : navigation, icônes de
// catégories, sélecteur de ville, envoi d'images publiques, aperçu téléphone.
import { useMemo, useState, type ReactNode } from 'react';
import { collection, limit, query, where } from 'firebase/firestore';
import { getDownloadURL, ref as storageRef, uploadBytes } from 'firebase/storage';
import {
  Apple,
  Beef,
  CakeSlice,
  ChefHat,
  Coffee,
  Cookie,
  Croissant,
  Drumstick,
  EggFried,
  FileText,
  Fish,
  Flame,
  Flower2,
  Gauge,
  Gift,
  IceCreamCone,
  Image as ImageIcon,
  LayoutTemplate,
  Leaf,
  Megaphone,
  Pill,
  Pizza,
  Salad,
  Sandwich,
  ShoppingBasket,
  Soup,
  Store,
  Tags,
  Utensils,
  UtensilsCrossed,
  Wheat,
} from 'lucide-react';
import { Select, cn } from '@golink/ui';
import { COLLECTIONS, STORAGE_PATHS, type Restaurant } from '@golink/shared';
import { useGeoScope } from '@/layout/GeoScope';
import { db, storage } from '@/lib/firebase';
import { useCollection } from '@/lib/firestore';
import { SubNav } from '../_experience/ui';

export function AffichageNav() {
  return (
    <SubNav
      items={[
        { to: '/affichage', label: 'Page d’accueil', icon: <LayoutTemplate />, end: true },
        { to: '/affichage/bannieres', label: 'Bannières', icon: <ImageIcon /> },
        { to: '/affichage/categories', label: 'Catégories', icon: <Tags /> },
        { to: '/affichage/classement', label: 'Classement', icon: <Gauge /> },
        { to: '/affichage/sponsorise', label: 'Mise en avant payante', icon: <Megaphone /> },
        { to: '/affichage/offres-plats', label: 'Offres sur les plats', icon: <Gift /> },
        { to: '/affichage/pages', label: 'Pages d’information', icon: <FileText /> },
      ]}
    />
  );
}

/** Icônes proposées pour les catégories (nom lucide stocké en base). */
export const CATEGORY_ICONS: Record<string, ReactNode> = {
  utensils: <Utensils />,
  'utensils-crossed': <UtensilsCrossed />,
  'chef-hat': <ChefHat />,
  pizza: <Pizza />,
  fish: <Fish />,
  soup: <Soup />,
  salad: <Salad />,
  sandwich: <Sandwich />,
  beef: <Beef />,
  drumstick: <Drumstick />,
  'egg-fried': <EggFried />,
  flame: <Flame />,
  leaf: <Leaf />,
  coffee: <Coffee />,
  croissant: <Croissant />,
  'cake-slice': <CakeSlice />,
  'ice-cream-cone': <IceCreamCone />,
  cookie: <Cookie />,
  wheat: <Wheat />,
  apple: <Apple />,
  'shopping-basket': <ShoppingBasket />,
  pill: <Pill />,
  flower: <Flower2 />,
  store: <Store />,
};

export function CategoryIcon({ name, className }: { name?: string | null; className?: string }) {
  return <span className={cn('inline-grid place-items-center [&_svg]:size-full', className)}>{CATEGORY_ICONS[name ?? ''] ?? <Utensils />}</span>;
}

/** Ville de travail de la page : filtre de la barre supérieure, sinon première ville du périmètre. */
export function useWorkingCity() {
  const geo = useGeoScope();
  const [picked, setPicked] = useState<string | null>(null);
  // Villes actives d'abord : ce sont celles que voient les clients.
  const options = geo.cities.filter((c) => !geo.countryId || c.countryId === geo.countryId).sort((a, b) => Number(b.active) - Number(a.active));
  const cityId = picked && options.some((c) => c.id === picked) ? picked : (geo.cityId ?? options[0]?.id ?? null);
  const city = geo.cities.find((c) => c.id === cityId) ?? null;
  const selector = (
    <Select
      className="w-52"
      value={cityId ?? ''}
      onValueChange={setPicked}
      options={options.map((c) => ({ value: c.id, label: `${c.name}${c.active ? '' : ' (en attente)'}` }))}
      placeholder="Choisir une ville"
      aria-label="Ville"
    />
  );
  return { cityId, city, cities: geo.cities, selector };
}

/** Restaurants en ligne d'une ville (sélections, aperçus). */
export function useCityRestaurants(cityId: string | null) {
  const q = useMemo(
    () => (cityId ? query(collection(db, COLLECTIONS.restaurants), where('cityId', '==', cityId), where('status', '==', 'active'), limit(300)) : null),
    [cityId],
  );
  const state = useCollection<Restaurant>(q);
  const byId = useMemo(() => new Map(state.data.map((r) => [r.id, r])), [state.data]);
  return { ...state, byId };
}

/** Envoi d'une image publique (platform/public/…), renvoie son URL. */
export async function uploadPublicImage(folder: string, file: File): Promise<{ path: string; url: string }> {
  const ext = (file.name.split('.').pop() ?? 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
  const path = `${STORAGE_PATHS.platformPublic}/${folder}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const ref = storageRef(storage, path);
  await uploadBytes(ref, file, { contentType: file.type, cacheControl: 'public,max-age=31536000' });
  return { path, url: await getDownloadURL(ref) };
}

/** Cadre de téléphone pour les aperçus de l'app client (toujours en thème clair de l'app). */
export function PhoneFrame({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('mx-auto w-full max-w-[340px] rounded-[2.2rem] border border-border-strong bg-ink-950 p-2.5 shadow-xl', className)}>
      <div className="relative h-[640px] overflow-hidden rounded-[1.7rem] bg-cream-50 text-petrol-900">
        <div className="absolute left-1/2 top-2 z-10 h-5 w-24 -translate-x-1/2 rounded-full bg-ink-950" />
        <div className="h-full overflow-y-auto pt-9 [scrollbar-width:none]">{children}</div>
      </div>
    </div>
  );
}
