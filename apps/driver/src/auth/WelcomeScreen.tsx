// Écran d'accueil de la pile d'authentification. Pas de bouton « Créer un
// compte » : l'inscription livreur est un parcours à validation manuelle,
// pas encore couvert par ce lot (voir AuthContext.tsx).
import { Image, StyleSheet, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { AuthStackParamList } from '../navigation/types';
import { colors, spacing } from '../theme/tokens';
import { LOGO_FULL } from '../theme/logo';
import { Button } from '../ui/Button';
import { Text } from '../ui/Text';

type Props = NativeStackScreenProps<AuthStackParamList, 'Welcome'>;

export function WelcomeScreen({ navigation }: Props) {
  return (
    <View style={styles.root}>
      <View style={styles.top}>
        <Image source={LOGO_FULL} style={styles.logo} resizeMode="contain" />
        <Text variant="display" color="inverted" align="center" style={styles.title}>
          Roulez, on s’occupe du reste.
        </Text>
        <Text variant="body" color="inverted" align="center" style={styles.tagline}>
          Connectez-vous pour recevoir des courses, suivre vos gains et votre historique.
        </Text>
      </View>
      <View style={styles.actions}>
        <Button label="Se connecter" onPress={() => navigation.navigate('SignIn')} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.ink, justifyContent: 'space-between', paddingHorizontal: spacing.xl, paddingVertical: 64 },
  // `width: '100%'` évite un débordement horizontal en Expo web (piège
  // documenté dans docs/CONTRAT_MODULES.md §10, reproduit ici par précaution :
  // un enfant `alignItems: 'center'` sans largeur explicite prend la largeur
  // intrinsèque de son texte sous RN-Web).
  top: { alignItems: 'center', gap: spacing.lg, marginTop: 40, width: '100%' },
  logo: { width: 200, height: 60 },
  title: { marginTop: spacing.lg, paddingHorizontal: spacing.md },
  tagline: { opacity: 0.8, paddingHorizontal: spacing.lg },
  actions: { gap: spacing.md },
});
