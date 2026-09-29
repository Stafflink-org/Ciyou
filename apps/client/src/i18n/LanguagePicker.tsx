// Sélecteur de langue accessible (mission « bascule i18n », point 4) — modale
// simple avec les 3 langues prises en charge (FR/EN/AR), accédée depuis
// l'écran Profil. Le changement est immédiat (texte) ; sur mobile natif,
// I18nManager exige un redémarrage pour un RTL visuel complet — on prévient
// alors l'utilisateur au lieu de redémarrer nous-mêmes (aucune API RN ne le
// permet proprement sans un module natif dédié).
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { colors, radius, spacing } from '../theme/tokens';
import { Text } from '../ui/Text';
import { useTranslation } from './I18nProvider';

export function LanguagePicker({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { t, locale, locales, setLocale, dir, restartRecommended } = useTranslation('common');

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
              onPress={() => setLocale(code)}
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
