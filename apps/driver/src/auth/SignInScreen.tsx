// Connexion (Firebase Auth, e-mail/mot de passe), rôle livreur uniquement.
import { useState } from 'react';
import { Pressable, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { AuthStackParamList } from '../navigation/types';
import { useAuth } from './AuthContext';
import { AuthLayout } from './AuthLayout';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Text } from '../ui/Text';

type Props = NativeStackScreenProps<AuthStackParamList, 'SignIn'>;

function signInErrorMessage(err: unknown): string {
  if (err instanceof Error && err.message === 'driver/wrong-role') {
    return 'Ce compte n’est pas un compte livreur.';
  }
  const code = (err as { code?: string } | null)?.code;
  switch (code) {
    case 'auth/wrong-password':
    case 'auth/invalid-credential':
      return 'E-mail ou mot de passe incorrect.';
    case 'auth/user-not-found':
      return 'Aucun compte ne correspond à cet e-mail.';
    case 'auth/too-many-requests':
      return 'Trop de tentatives. Réessayez dans quelques minutes.';
    case 'auth/network-request-failed':
      return 'Connexion impossible. Vérifiez votre réseau.';
    default:
      return 'Connexion impossible. Vérifiez vos identifiants.';
  }
}

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
      setError(signInErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthLayout title="Content de vous revoir" subtitle="Connectez-vous pour retrouver votre file de courses et vos gains.">
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
      <View style={{ marginTop: 4 }}>
        <Text variant="caption" color="muted" align="center">
          Pas encore livreur Ciyou Eats ? L’inscription se fait pour l’instant auprès de l’équipe Ciyou Eats.
        </Text>
      </View>
    </AuthLayout>
  );
}
