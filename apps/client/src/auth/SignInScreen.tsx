// Connexion (Firebase Auth, e-mail/mot de passe).
import { useState } from 'react';
import { Pressable, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { AuthStackParamList } from '../navigation/types';
import { useAuth } from './AuthContext';
import { errorMessage } from '../lib/firestore';
import { AuthLayout } from './AuthLayout';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Text } from '../ui/Text';

type Props = NativeStackScreenProps<AuthStackParamList, 'SignIn'>;

export function SignInScreen({ navigation }: Props) {
  const { signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    if (!email.trim() || !password) {
      setError('Renseignez votre e-mail et votre mot de passe.');
      return;
    }
    setError(null);
    setLoading(true);
    try {
      await signIn(email, password);
      // Pas de navigation manuelle : RootNavigator bascule automatiquement
      // vers `Main` dès que la session Firebase est active.
    } catch (err) {
      setError(errorMessage(err, 'Connexion impossible. Vérifiez vos identifiants.'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthLayout
      title="Content de vous revoir"
      subtitle="Connectez-vous pour retrouver vos commandes et vos adresses."
      footer={
        <View style={{ flexDirection: 'row', gap: 4 }}>
          <Text variant="body" color="muted">
            Pas encore de compte ?
          </Text>
          <Pressable onPress={() => navigation.navigate('SignUp')}>
            <Text variant="bodyStrong" color="primary">
              Créer un compte
            </Text>
          </Pressable>
        </View>
      }
    >
      <Input label="E-mail" autoCapitalize="none" keyboardType="email-address" autoComplete="email" value={email} onChangeText={setEmail} placeholder="vous@exemple.com" />
      <Input label="Mot de passe" secure autoComplete="password" value={password} onChangeText={setPassword} placeholder="••••••••" />
      <Pressable onPress={() => navigation.navigate('ForgotPassword')} style={{ alignSelf: 'flex-end' }}>
        <Text variant="caption" color="primary">
          Mot de passe oublié ?
        </Text>
      </Pressable>
      {error ? (
        <Text variant="caption" color="danger">
          {error}
        </Text>
      ) : null}
      <Button label="Se connecter" onPress={submit} loading={loading} />
    </AuthLayout>
  );
}
