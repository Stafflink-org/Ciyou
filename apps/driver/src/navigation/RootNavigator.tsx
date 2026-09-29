// Racine de navigation : bascule Auth ⇄ Main selon la session Firebase
// (`useAuth().status`), avec un écran de chargement pendant la résolution
// initiale. Copie fidèle de apps/client/src/navigation/RootNavigator.tsx.
import { ActivityIndicator, View } from 'react-native';
import { useAuth } from '../auth/AuthContext';
import { colors } from '../theme/tokens';
import { AuthStack } from './AuthStack';
import { MainStack } from './MainStack';

export function RootNavigator() {
  const { status } = useAuth();

  if (status === 'loading') {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.ink }}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }

  return status === 'signed-in' ? <MainStack /> : <AuthStack />;
}
