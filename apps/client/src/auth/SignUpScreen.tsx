// Inscription client (Firebase Auth). Le profil `users/{uid}` (rôle « client »)
// est provisionné côté serveur par `onUserCreate` — voir AuthContext.signUp.
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

type Props = NativeStackScreenProps<AuthStackParamList, 'SignUp'>;

export function SignUpScreen({ navigation }: Props) {
  const { signUp } = useAuth();
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    if (!firstName.trim() || !lastName.trim() || !email.trim() || !password) {
      setError('Tous les champs sont obligatoires.');
      return;
    }
    if (password.length < 6) {
      setError('Le mot de passe doit contenir au moins 6 caractères.');
      return;
    }
    if (password !== confirm) {
      setError('Les mots de passe ne correspondent pas.');
      return;
    }
    setError(null);
    setLoading(true);
    try {
      await signUp({ firstName, lastName, email, password });
      // Pas de navigation manuelle : `createUserWithEmailAndPassword` connecte
      // aussitôt l'utilisateur, et `RootNavigator` bascule alors sur `Main`
      // avant qu'un `navigate('VerifyCode')` ici n'ait de sens (la pile
      // d'authentification est démontée). Le rappel de vérification d'e-mail
      // est repris dans `ProfileScreen` tant que `user.emailVerified` est faux.
    } catch (err) {
      setError(errorMessage(err, 'Inscription impossible. Réessayez.'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthLayout
      title="Créer un compte"
      subtitle="Quelques informations pour commencer à commander."
      footer={
        <View style={{ flexDirection: 'row', gap: 4 }}>
          <Text variant="body" color="muted">
            Déjà un compte ?
          </Text>
          <Pressable onPress={() => navigation.navigate('SignIn')}>
            <Text variant="bodyStrong" color="primary">
              Se connecter
            </Text>
          </Pressable>
        </View>
      }
    >
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <View style={{ flex: 1 }}>
          <Input label="Prénom" autoCapitalize="words" value={firstName} onChangeText={setFirstName} placeholder="Awa" />
        </View>
        <View style={{ flex: 1 }}>
          <Input label="Nom" autoCapitalize="words" value={lastName} onChangeText={setLastName} placeholder="Traoré" />
        </View>
      </View>
      <Input label="E-mail" autoCapitalize="none" keyboardType="email-address" autoComplete="email" value={email} onChangeText={setEmail} placeholder="vous@exemple.com" />
      <Input label="Mot de passe" secure autoComplete="password-new" value={password} onChangeText={setPassword} placeholder="Au moins 6 caractères" />
      <Input label="Confirmer le mot de passe" secure value={confirm} onChangeText={setConfirm} placeholder="••••••••" />
      {error ? (
        <Text variant="caption" color="danger">
          {error}
        </Text>
      ) : null}
      <Text variant="caption" color="subtle">
        En créant un compte, vous acceptez les conditions générales et la politique de confidentialité de Ciyou Eats.
      </Text>
      <Button label="Créer mon compte" onPress={submit} loading={loading} />
    </AuthLayout>
  );
}
