// Racine de navigation : bascule Auth ⇄ Main selon la session Firebase
// (`useAuth().status`), avec un écran de chargement pendant la résolution
// initiale (évite un flash de l'écran de connexion à chaque démarrage).
import { ActivityIndicator, View } from 'react-native';
import { useAuth } from '../auth/AuthContext';
import { colors } from '../theme/tokens';
import { AuthStack } from './AuthStack';
import { MainStack } from './MainStack';
import { LegalGate } from '../features/legal/LegalGate';

export function RootNavigator() {
  const { status } = useAuth();

  if (status === 'loading') {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.ink }}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }

  return status === 'signed-in' ? (
    <LegalGate>
      <MainStack />
    </LegalGate>
  ) : (
    <AuthStack />
  );
}
