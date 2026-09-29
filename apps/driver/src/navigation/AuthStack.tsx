// Pile d'authentification : Welcome → SignIn → ForgotPassword. Pas d'écran
// d'inscription (voir auth/AuthContext.tsx).
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { AuthStackParamList } from './types';
import { WelcomeScreen } from '../auth/WelcomeScreen';
import { SignInScreen } from '../auth/SignInScreen';
import { ForgotPasswordScreen } from '../auth/ForgotPasswordScreen';

const Stack = createNativeStackNavigator<AuthStackParamList>();

export function AuthStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="Welcome" component={WelcomeScreen} />
      <Stack.Screen name="SignIn" component={SignInScreen} />
      <Stack.Screen name="ForgotPassword" component={ForgotPasswordScreen} />
    </Stack.Navigator>
  );
}
