// Écran d'accueil de la pile d'authentification (`Welcome`, §18.1/§18.2) :
// premier écran vu par un visiteur non connecté, avant SignIn/SignUp.
import { Image, StyleSheet, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { AuthStackParamList } from '../navigation/types';
import { colors, radius, spacing } from '../theme/tokens';
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
          Vos commerces préférés, livrés vite.
        </Text>
        <Text variant="body" color="inverted" align="center" style={styles.tagline}>
          Restaurants, épiceries et plus encore, en livraison ou à retirer près de chez vous.
        </Text>
      </View>
      <View style={styles.actions}>
        <Button label="Se connecter" onPress={() => navigation.navigate('SignIn')} />
        <Button label="Créer un compte" variant="outlineInverted" onPress={() => navigation.navigate('SignUp')} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.ink, justifyContent: 'space-between', paddingHorizontal: spacing.xl, paddingVertical: 64 },
  // `width: '100%'` est indispensable ici : sans largeur explicite, un enfant
  // en `alignItems: 'center'` prend la largeur intrinsèque de son texte (RN-Web
  // ne le contraint pas comme le natif) et le titre/tagline dépassent l'écran
  // au lieu de passer à la ligne — constaté à l'écran (test réel `expo start --web`).
  top: { alignItems: 'center', gap: spacing.lg, marginTop: 40, width: '100%' },
  logo: { width: 200, height: 60 },
  title: { marginTop: spacing.lg, paddingHorizontal: spacing.md },
  tagline: { opacity: 0.8, paddingHorizontal: spacing.lg },
  actions: { gap: spacing.md, backgroundColor: 'transparent', borderRadius: radius.lg },
});
