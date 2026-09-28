import {
  Activity,
  Database,
  History,
  Globe2,
  Languages,
  MapPin,
  Plug,
  ScaleIcon,
  Settings2,
  ShieldAlert,
  ShieldCheck,
  ToggleLeft,
  Users,
} from 'lucide-react';
import { SubNav } from './components';
import { useOpenSecurityAlertsCount } from './SecuritePage';
import { useOpenGdprCount } from './LegalRgprPage';

export function PlateformeNav() {
  const alerts = useOpenSecurityAlertsCount();
  const gdpr = useOpenGdprCount();
  return (
    <SubNav
      items={[
        { to: '/plateforme/parametres', label: 'Paramètres', icon: <Settings2 />, permission: 'settings.view', end: true },
        { to: '/plateforme/marches', label: 'Multi-pays', icon: <Globe2 />, permission: 'markets.edit' },
        { to: '/plateforme/fonctionnalites', label: 'Fonctionnalités', icon: <ToggleLeft />, permission: 'features.edit' },
        { to: '/plateforme/connexions', label: 'Connexions', icon: <Plug />, permission: 'integrations.view' },
        { to: '/plateforme/traduction', label: 'Traduction', icon: <Languages />, permission: 'settings.view' },
        { to: '/plateforme/cartographie', label: 'Cartographie', icon: <MapPin />, permission: 'settings.view' },
        { to: '/plateforme/administrateurs', label: 'Administrateurs', icon: <Users />, permission: 'admins.view' },
        { to: '/plateforme/securite', label: 'Sécurité', icon: <ShieldCheck />, permission: 'security.manage', count: alerts },
        { to: '/plateforme/journal', label: 'Journal d’audit', icon: <History />, permission: 'audit.view' },
        { to: '/plateforme/fraude', label: 'Fraude', icon: <ShieldAlert />, permission: 'fraud.view' },
        { to: '/plateforme/legal-rgpd', label: 'Légal & RGPD', icon: <ScaleIcon />, permission: ['legal.edit', 'gdpr.handle'], count: gdpr },
        { to: '/plateforme/sante', label: 'Santé', icon: <Activity />, permission: 'system.view' },
        { to: '/plateforme/donnees', label: 'Données & sauvegardes', icon: <Database />, permission: ['backups.manage', 'trash.view'] },
      ]}
    />
  );
}
