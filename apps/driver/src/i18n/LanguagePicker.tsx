// Sélecteur de langue accessible (écran Profil) — identique à
// `apps/client/src/i18n/LanguagePicker.tsx` (voir ce fichier pour les choix).
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { updateDoc } from 'firebase/firestore';
import { colors, radius, spacing } from '../theme/tokens';
import { Text } from '../ui/Text';
import { useTranslation } from './I18nProvider';
import { useAuth } from '../auth/AuthContext';
import { docAt, updatedFields } from '../lib/firestore';
import type { Locale } from '@golink/shared';

export function LanguagePicker({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { t, locale, locales, setLocale, dir, restartRecommended } = useTranslation('common');
  const { user } = useAuth();

  // Persiste la langue choisie sur `users/{uid}.locale` (voir
  // apps/client/src/i18n/LanguagePicker.tsx pour le même choix côté client) :
  // best-effort, ne bloque jamais le changement local déjà appliqué.
  const changeLocale = (next: Locale) => {
    setLocale(next);
    if (user) {
      updateDoc(docAt(`users/${user.uid}`), { locale: next, ...updatedFields(user.uid) }).catch(() => undefined);
    }
  };

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={[styles.sheet, { direction: dir }]} onPress={(e) => e.stopPropagation()}>
          <Text variant="subtitle" style={{ marginBottom: spacing.md }}>
            {t('language.label')}
          </Text>
          {locales.map((code) => (
            <Pressable
              key={code}
              onPress={() => changeLocale(code)}
              style={[styles.row, code === locale && styles.rowActive]}
              accessibilityRole="radio"
              accessibilityState={{ selected: code === locale }}
            >
              <Text variant="body" style={{ flex: 1 }}>
                {t(`language.names.${code}`)}
              </Text>
              {code === locale ? <Text style={{ color: colors.primary }}>✓</Text> : null}
            </Pressable>
          ))}
          {restartRecommended ? (
            <Text variant="caption" color="muted" style={{ marginTop: spacing.sm }}>
              {t('language.restartRecommended')}
            </Text>
          ) : null}
          <Pressable onPress={onClose} style={styles.closeBtn}>
            <Text variant="bodyStrong" color="primary">
              {t('actions.back')}
            </Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, padding: spacing.lg, paddingBottom: spacing.xxl },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 14, paddingHorizontal: spacing.sm, borderRadius: radius.md },
  rowActive: { backgroundColor: colors.primarySoft },
  closeBtn: { marginTop: spacing.md, alignItems: 'center', paddingVertical: spacing.sm },
});
