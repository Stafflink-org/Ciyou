// Porte légale (§29 cahier super admin, point cité comme dépendant de l'app
// client) : bloque l'accès tant que la dernière version des CGU n'est pas
// acceptée (`acceptedLegal.terms_client` != version publiée), et propose la
// capture des consentements cookies/marketing sous forme de bandeau, une
// seule fois par compte (`consents.analytics_cookies` non renseigné).
import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { colors, radius, spacing } from '../../theme/tokens';
import { Text } from '../../ui/Text';
import { Button } from '../../ui/Button';
import { useToast } from '../../ui/Toast';
import { errorMessage } from '../../lib/firestore';
import { useTranslation } from '../../i18n/I18nProvider';
import { acceptLegalDocument, setConsent, useMyProfile, usePublishedTerms } from './hooks';

export function LegalGate({ children }: { children: React.ReactNode }) {
  const { data: profile, loading: profileLoading } = useMyProfile();
  const countryId = profile?.countryId ?? 'FR';
  const { data: terms, loading: termsLoading } = usePublishedTerms(profileLoading ? null : countryId);

  const acceptedVersion = profile?.acceptedLegal?.terms_client;
  const mustReaccept = Boolean(terms) && acceptedVersion !== terms!.version;

  if (mustReaccept) {
    return <ReacceptanceScreen version={terms!.version} title={terms!.title.fr} content={terms!.content.fr} countryId={countryId} changeSummary={terms!.changeSummary ?? null} />;
  }

  return (
    <>
      {children}
      {!termsLoading && !profileLoading && profile && profile.consents?.analytics_cookies === undefined ? <CookieConsentBanner /> : null}
    </>
  );
}

function ReacceptanceScreen({ version, title, content, countryId, changeSummary }: { version: string; title: string; content: string; countryId: string; changeSummary: string | null }) {
  const { t } = useTranslation('legal');
  const toast = useToast();
  const [pending, setPending] = useState(false);

  const accept = async () => {
    setPending(true);
    try {
      await acceptLegalDocument({ documentType: 'terms_client', countryId });
    } catch (error) {
      toast.show(errorMessage(error), 'danger');
    } finally {
      setPending(false);
    }
  };

  return (
    <View style={styles.gateRoot}>
      <View style={styles.gateHeader}>
        <Text variant="title">{t('legal:reacceptance.title')}</Text>
        <Text variant="body" color="muted" style={{ marginTop: 4 }}>
          {t('legal:reacceptance.description', { version })}
        </Text>
      </View>
      {changeSummary ? (
        <View style={styles.summaryBox}>
          <Text variant="bodyStrong">{t('legal:reacceptance.whatChanges')}</Text>
          <Text variant="body" color="muted" style={{ marginTop: 4 }}>
            {changeSummary}
          </Text>
        </View>
      ) : null}
      <ScrollView style={styles.contentBox} contentContainerStyle={{ padding: spacing.md }}>
        <Text variant="bodyStrong" style={{ marginBottom: spacing.sm }}>
          {title}
        </Text>
        <Text variant="body" color="muted">
          {content}
        </Text>
      </ScrollView>
      <Button label={t('legal:reacceptance.accept')} onPress={accept} loading={pending} style={{ margin: spacing.lg }} />
    </View>
  );
}

function CookieConsentBanner() {
  const { t } = useTranslation('legal');
  const [visible, setVisible] = useState(true);
  const [pending, setPending] = useState(false);
  if (!visible) return null;

  const respond = async (analytics: boolean, marketing: boolean) => {
    setPending(true);
    try {
      await Promise.all([setConsent({ key: 'analytics_cookies', granted: analytics }), setConsent({ key: 'marketing_email', granted: marketing })]);
      setVisible(false);
    } finally {
      setPending(false);
    }
  };

  return (
    <View style={styles.banner}>
      <Text variant="caption" color="inverted">
        {t('legal:cookieBanner.text')}
      </Text>
      <View style={styles.bannerRow}>
        <Button label={t('legal:cookieBanner.refuseAll')} variant="outline" onPress={() => respond(false, false)} loading={pending} style={{ flex: 1 }} />
        <Button label={t('legal:cookieBanner.acceptAll')} onPress={() => respond(true, true)} loading={pending} style={{ flex: 1 }} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  gateRoot: { flex: 1, backgroundColor: colors.canvas },
  gateHeader: { padding: spacing.lg, paddingTop: spacing.xxl },
  summaryBox: { marginHorizontal: spacing.lg, padding: spacing.md, borderRadius: radius.lg, backgroundColor: colors.surfaceRaised },
  contentBox: { flex: 1, marginTop: spacing.md, marginHorizontal: spacing.lg, borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  banner: {
    position: 'absolute',
    left: spacing.lg,
    right: spacing.lg,
    bottom: spacing.lg,
    padding: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.ink,
    gap: spacing.sm,
  },
  bannerRow: { flexDirection: 'row', gap: spacing.sm },
});
