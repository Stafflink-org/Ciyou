// Marque de la plateforme (super admin > Paramètres > Marque) lue par les back-offices :
// nom, logo et couleur principale. Les réglages sont publics (settings/general, settings/branding).
// La couleur principale surcharge les variables du thème seulement si elle diffère de la valeur
// d'origine ; supprimer la surcharge rétablit le thème livré.
import { useEffect } from 'react';
import { doc, type Firestore } from 'firebase/firestore';
import { COLLECTIONS, SETTINGS_DOCS } from '@golink/shared';
import { useDoc } from '../firestore/hooks';

export interface BrandingState {
  platformName: string | null;
  logoUrl: string | null;
  logoDarkUrl: string | null;
  faviconUrl: string | null;
  primary: string | null;
}

const DEFAULT_PRIMARY = '#ff6b00';

interface BrandingDoc {
  logo?: { url?: string } | null;
  logoDark?: { url?: string } | null;
  favicon?: { url?: string } | null;
  colors?: { primary?: string } | null;
}

export function useBranding(db: Firestore): BrandingState {
  const general = useDoc<{ platformName?: string }>(doc(db, COLLECTIONS.settings, SETTINGS_DOCS.general));
  const branding = useDoc<BrandingDoc>(doc(db, COLLECTIONS.settings, SETTINGS_DOCS.branding));
  return {
    platformName: general.data?.platformName ?? null,
    logoUrl: branding.data?.logo?.url ?? null,
    logoDarkUrl: branding.data?.logoDark?.url ?? null,
    faviconUrl: branding.data?.favicon?.url ?? null,
    primary: branding.data?.colors?.primary ?? null,
  };
}

/**
 * Icône d'onglet (favicon) du réglage « Marque » : jusqu'ici téléversée par l'écran mais jamais
 * relue nulle part (`settings/branding.favicon` sans consommateur) — l'onglet du navigateur
 * restait toujours sur le favicon statique livré avec l'application (`index.html`).
 */
export function FaviconEffect({ db }: { db: Firestore }) {
  const { faviconUrl } = useBranding(db);
  useEffect(() => {
    if (!faviconUrl) return;
    const existing = document.querySelectorAll<HTMLLinkElement>('link[rel="icon"]');
    const previous = existing.length > 0 ? [...existing].map((link) => ({ link, href: link.href })) : null;
    const link = existing[0] ?? document.createElement('link');
    link.rel = 'icon';
    link.href = faviconUrl;
    if (existing.length === 0) document.head.appendChild(link);
    return () => {
      if (previous) previous.forEach(({ link: l, href }) => (l.href = href));
      else link.remove();
    };
  }, [faviconUrl]);
  return null;
}

function parse(hex: string): [number, number, number] | null {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1]!, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const toHex = (rgb: number[]) => `#${rgb.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')}`;
const luminance = ([r, g, b]: number[]) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;

/** Applique la couleur principale du réglage « Marque » aux variables du thème (et les retire si absente ou d'origine). */
export function BrandingEffect({ db }: { db: Firestore }) {
  const { primary } = useBranding(db);
  useEffect(() => {
    const root = document.documentElement;
    const vars = ['--gl-primary', '--gl-primary-hover', '--gl-primary-fg', '--gl-primary-soft', '--gl-primary-soft-fg'];
    const rgb = primary && primary.toLowerCase() !== DEFAULT_PRIMARY ? parse(primary) : null;
    if (!rgb) {
      for (const v of vars) root.style.removeProperty(v);
      return;
    }
    root.style.setProperty('--gl-primary', toHex(rgb));
    root.style.setProperty('--gl-primary-hover', toHex(rgb.map((v) => v * 0.92)));
    root.style.setProperty('--gl-primary-fg', luminance(rgb) > 0.55 ? '#1c0d06' : '#ffffff');
    root.style.setProperty('--gl-primary-soft', `rgb(${rgb.join(' ')} / 0.14)`);
    root.style.setProperty('--gl-primary-soft-fg', toHex(rgb.map((v) => v * 0.78)));
    return () => {
      for (const v of vars) root.style.removeProperty(v);
    };
  }, [primary]);
  return null;
}
