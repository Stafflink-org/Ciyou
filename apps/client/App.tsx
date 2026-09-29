// Point d'entrée de l'app client Ciyou Eats — assemble les fournisseurs
// (zones sûres, session Firebase, i18n) et la navigation racine. La structure
// détaillée (dossiers, conventions, schéma de navigation) est documentée dans
// docs/CONTRAT_MODULES.md.
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NavigationContainer, DefaultTheme } from '@react-navigation/native';
import { AuthProvider } from './src/auth/AuthContext';
import { CartProvider } from './src/features/cart/CartContext';
import { I18nProvider } from './src/i18n/I18nProvider';
import { RootNavigator } from './src/navigation/RootNavigator';
import { colors } from './src/theme/tokens';
import { ToastProvider } from './src/ui/Toast';

const navigationTheme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    background: colors.canvas,
    card: colors.surface,
    text: colors.fg,
    border: colors.border,
    primary: colors.primary,
  },
};

export default function App() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <I18nProvider>
          <AuthProvider>
            <CartProvider>
              <ToastProvider>
                <NavigationContainer theme={navigationTheme}>
                  <RootNavigator />
                </NavigationContainer>
              </ToastProvider>
            </CartProvider>
          </AuthProvider>
        </I18nProvider>
        <StatusBar style="dark" />
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
