// Navigation interne de la rubrique Restaurants (liste, validation, qualité,
// groupes, import), affichée sous l'en-tête de chaque page.
import { NavLink } from 'react-router';
import { ClipboardCheck, FileUp, LayoutList, Network, ShieldCheck } from 'lucide-react';
import { cn } from '@golink/ui';
import { useCan } from '@/auth/AdminAccess';

export function RestaurantsNav({ validationCount }: { validationCount?: number }) {
  const can = useCan();
  const items = [
    { to: '/restaurants', label: 'Tous les commerces', icon: <LayoutList />, end: true, show: true },
    { to: '/restaurants/validation', label: 'Validation', icon: <ClipboardCheck />, count: validationCount, show: can('restaurants.validate') },
    { to: '/restaurants/qualite', label: 'Qualité & allergènes', icon: <ShieldCheck />, show: true },
    { to: '/restaurants/groupes', label: 'Groupes & chaînes', icon: <Network />, show: true },
    { to: '/restaurants/import', label: 'Import', icon: <FileUp />, show: can('restaurants.import') || can('restaurants.edit') },
  ].filter((item) => item.show);
  return (
    <nav data-scroll-ok aria-label="Rubrique Restaurants" className="-mx-4 overflow-x-auto px-4 [scrollbar-width:none] sm:mx-0 sm:px-0">
      <ul className="flex min-w-max items-center gap-5 border-b border-border">
        {items.map((item) => (
          <li key={item.to}>
            <NavLink
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                cn(
                  'relative -mb-px flex h-10 items-center gap-2 whitespace-nowrap border-b-2 text-sm font-medium transition-colors [&_svg]:size-4',
                  isActive ? 'border-primary text-fg' : 'border-transparent text-fg-muted hover:text-fg',
                )
              }
            >
              {item.icon}
              {item.label}
              {item.count ? <span className="rounded-full bg-primary-soft px-1.5 py-px font-mono text-2xs text-primary-soft-fg num">{item.count}</span> : null}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
