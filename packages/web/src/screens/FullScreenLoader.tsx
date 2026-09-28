import { LogoMark } from '@golink/ui';
import { useTranslation } from '../i18n/I18nProvider';

/** Écran d'attente (ouverture de session, chargement des droits). */
export function FullScreenLoader({ label }: { label?: string }) {
  const { t } = useTranslation();
  return (
    <div role="status" aria-live="polite" className="grid min-h-dvh place-items-center bg-canvas text-fg">
      <div className="flex flex-col items-center gap-5 animate-fade-in">
        <div className="relative grid place-items-center">
          <span className="absolute size-16 animate-ping rounded-[22px] bg-primary/15 [animation-duration:1.8s]" />
          <LogoMark size={44} className="relative drop-shadow-[0_8px_24px_color-mix(in_oklab,var(--gl-primary)_35%,transparent)]" />
        </div>
        <p className="font-mono text-2xs uppercase tracking-eyebrow text-fg-subtle">{label ?? t('auth.loading')}</p>
      </div>
    </div>
  );
}
