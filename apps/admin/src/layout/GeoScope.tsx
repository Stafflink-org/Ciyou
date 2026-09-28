// Filtre géographique global du super admin (pays, ville), choisi en barre
// supérieure et lu par chaque rubrique. Limité au périmètre de l'administrateur
// (admins/{uid}.countryIds / cityIds ; liste vide = tous).
import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { collection, orderBy, query } from 'firebase/firestore';
import { Check, ChevronDown, Globe2, MapPin, Search } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger, cn } from '@golink/ui';
import { COLLECTIONS, type City, type Country, type WithId } from '@golink/shared';
import { useAuth, usePersistentState, useTranslation } from '@golink/web';
import { useAdminAccess } from '@/auth/AdminAccess';
import { db } from '@/lib/firebase';
import { useCollection } from '@/lib/firestore';

export interface GeoSelection {
  countryId: string | null;
  cityId: string | null;
}

export interface GeoScope extends GeoSelection {
  /** Pays et villes du périmètre de l'administrateur. */
  countries: WithId<Country>[];
  cities: WithId<City>[];
  setScope: (selection: GeoSelection) => void;
  /** Libellé court du filtre courant. */
  label: string;
  /**
   * Villes couvertes par le filtre, pour les requêtes (`where('cityId', 'in', …)`) ;
   * null = aucune restriction de ville.
   */
  cityIds: string[] | null;
  /** L'administrateur peut-il voir tous les marchés (sans restriction) ? */
  global: boolean;
}

const GeoScopeContext = createContext<GeoScope | null>(null);

export function GeoScopeProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { admin } = useAdminAccess();
  const { t } = useTranslation();
  const countriesQuery = useMemo(() => query(collection(db, COLLECTIONS.countries), orderBy('name')), []);
  const citiesQuery = useMemo(() => query(collection(db, COLLECTIONS.cities), orderBy('name')), []);
  const allCountries = useCollection<Country>(countriesQuery).data;
  const allCities = useCollection<City>(citiesQuery).data;
  const [stored, setStored] = usePersistentState<GeoSelection>(`golink:admin-scope:${user?.uid ?? ''}`, {
    countryId: null,
    cityId: null,
  });

  const value = useMemo<GeoScope>(() => {
    const cityScoped = admin.cityIds.length > 0;
    const cities = allCities.filter(
      (city) =>
        (!cityScoped || admin.cityIds.includes(city.id)) &&
        (admin.countryIds.length === 0 || admin.countryIds.includes(city.countryId)),
    );
    const countries = allCountries.filter(
      (country) =>
        (admin.countryIds.length === 0 || admin.countryIds.includes(country.id)) &&
        (!cityScoped || cities.some((city) => city.countryId === country.id)),
    );
    // Sélection mémorisée invalide (ville retirée du périmètre…) : on revient au périmètre complet.
    const city = cities.find((item) => item.id === stored.cityId) ?? null;
    const country = countries.find((item) => item.id === (city?.countryId ?? stored.countryId)) ?? null;
    const global = admin.countryIds.length === 0 && !cityScoped;

    let cityIds: string[] | null = null;
    if (city) cityIds = [city.id];
    else if (cityScoped) cityIds = cities.filter((item) => !country || item.countryId === country.id).map((item) => item.id);

    const label = city
      ? city.name
      : country
        ? country.name
        : global
          ? t('nav:geo.allMarkets')
          : cityScoped && cities.length === 1
            ? (cities[0]?.name ?? t('nav:geo.myScope'))
            : t('nav:geo.myScope');

    return {
      countries,
      cities,
      countryId: country?.id ?? null,
      cityId: city?.id ?? null,
      setScope: setStored,
      label,
      cityIds,
      global,
    };
  }, [admin, allCountries, allCities, stored, setStored, t]);

  return <GeoScopeContext.Provider value={value}>{children}</GeoScopeContext.Provider>;
}

/** Filtre pays / ville courant du super admin. */
export function useGeoScope(): GeoScope {
  const value = useContext(GeoScopeContext);
  if (!value) throw new Error('useGeoScope doit être utilisé sous <GeoScopeProvider>.');
  return value;
}

function Option({
  active,
  onSelect,
  children,
  indent,
  icon,
}: {
  active: boolean;
  onSelect: () => void;
  children: ReactNode;
  indent?: boolean;
  icon?: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'flex w-full items-center gap-2.5 rounded-lg py-2 pr-2.5 text-left text-sm transition-colors hover:bg-surface-3',
        indent ? 'pl-9' : 'pl-2.5',
        active ? 'bg-surface-2 font-medium text-fg' : 'text-fg-muted',
      )}
    >
      {icon}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {active && <Check className="size-4 shrink-0 text-primary" />}
    </button>
  );
}

/** Sélecteur de périmètre (barre supérieure). */
export function GeoScopeSelector() {
  const scope = useGeoScope();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const { t } = useTranslation();
  const shownLabel = scope.label.startsWith('i18n:') ? t(`nav:${scope.label.slice(5)}`) : scope.label;
  const needle = search.trim().toLocaleLowerCase('fr');
  const select = (selection: GeoSelection) => {
    scope.setScope(selection);
    setOpen(false);
    setSearch('');
  };
  const filtered = scope.countries
    .map((country) => ({
      country,
      cities: scope.cities.filter(
        (city) => city.countryId === country.id && (!needle || city.name.toLocaleLowerCase('fr').includes(needle)),
      ),
    }))
    .filter((entry) => !needle || entry.cities.length > 0 || entry.country.name.toLocaleLowerCase('fr').includes(needle));

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={t('nav:geo.scopeLabel', { name: shownLabel })}
          className="flex h-9 max-w-44 items-center gap-2 rounded-lg border border-border bg-surface px-2.5 text-sm text-fg shadow-xs transition-colors hover:border-border-strong sm:max-w-56"
        >
          {scope.cityId ? <MapPin className="size-4 shrink-0 text-primary" /> : <Globe2 className="size-4 shrink-0 text-fg-subtle" />}
          <span className="hidden min-w-0 truncate font-medium sm:block">{shownLabel}</span>
          <ChevronDown className="size-3.5 shrink-0 text-fg-subtle" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(300px,calc(100vw-1.5rem))] p-0">
        <div className="border-b border-border px-3 py-2.5">
          <p className="eyebrow">{t('nav:geo.shown')}</p>
          <p className="mt-0.5 text-xs text-fg-subtle">{t('nav:geo.hint')}</p>
        </div>
        {scope.cities.length > 8 && (
          <label className="flex items-center gap-2 border-b border-border px-3">
            <Search className="size-4 text-fg-subtle" />
            <input
              autoFocus
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t('nav:geo.searchCity')}
              aria-label={t('nav:geo.searchCity')}
              className="h-10 w-full bg-transparent text-sm outline-none placeholder:text-fg-subtle"
            />
          </label>
        )}
        <div className="max-h-96 space-y-0.5 overflow-y-auto p-1.5">
          {!needle && (
            <Option active={!scope.countryId && !scope.cityId} onSelect={() => select({ countryId: null, cityId: null })} icon={<Globe2 className="size-4 text-fg-subtle" />}>
              {scope.global ? t('nav:geo.allMarkets') : t('nav:geo.allMyScope')}
            </Option>
          )}
          {filtered.map(({ country, cities }) => (
            <div key={country.id} className="pt-1">
              <Option
                active={scope.countryId === country.id && !scope.cityId}
                onSelect={() => select({ countryId: country.id, cityId: null })}
                icon={
                  <span className="grid h-5 w-7 place-items-center rounded border border-border bg-surface-2 font-mono text-3xs font-medium text-fg-muted">
                    {country.code}
                  </span>
                }
              >
                {country.name}
              </Option>
              {cities.map((city) => (
                <Option key={city.id} indent active={scope.cityId === city.id} onSelect={() => select({ countryId: country.id, cityId: city.id })}>
                  {city.name}
                  {!city.active && <span className="ml-1.5 text-2xs text-fg-subtle">· inactive</span>}
                </Option>
              ))}
            </div>
          ))}
          {scope.countries.length === 0 && (
            <p className="px-3 py-6 text-center text-sm text-fg-subtle">Aucun marché configuré pour le moment.</p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
