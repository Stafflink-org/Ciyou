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
import { useTranslation } from '../i18n/I18nProvider';

type Props = NativeStackScreenProps<AuthStackParamList, 'SignUp'>;

export function SignUpScreen({ navigation }: Props) {
  const { signUp } = useAuth();
  const { t } = useTranslation('auth');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    if (!firstName.trim() || !lastName.trim() || !email.trim() || !password) {
      setError(t('signup.errors.allFieldsRequired'));
      return;
    }
    if (password.length < 6) {
      setError(t('signup.errors.passwordTooShort'));
      return;
    }
    if (password !== confirm) {
      setError(t('signup.errors.passwordMismatch'));
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
      setError(errorMessage(err, t, t('signup.errors.signUpFailed')));
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthLayout
      title={t('login.createAccount')}
      subtitle={t('signup.subtitle')}
      footer={
        <View style={{ flexDirection: 'row', gap: 4 }}>
          <Text variant="body" color="muted">
            {t('signup.alreadyAccount')}
          </Text>
          <Pressable onPress={() => navigation.navigate('SignIn')}>
            <Text variant="bodyStrong" color="primary">
              {t('login.submit')}
            </Text>
          </Pressable>
        </View>
      }
    >
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <View style={{ flex: 1 }}>
          <Input label={t('signup.firstName')} autoCapitalize="words" value={firstName} onChangeText={setFirstName} placeholder={t('signup.firstNamePlaceholder')} />
        </View>
        <View style={{ flex: 1 }}>
          <Input label={t('signup.lastName')} autoCapitalize="words" value={lastName} onChangeText={setLastName} placeholder={t('signup.lastNamePlaceholder')} />
        </View>
      </View>
      <Input label={t('login.email')} autoCapitalize="none" keyboardType="email-address" autoComplete="email" value={email} onChangeText={setEmail} placeholder={t('login.emailPlaceholder')} />
      <Input label={t('login.password')} secure autoComplete="password-new" value={password} onChangeText={setPassword} placeholder={t('signup.passwordPlaceholder')} />
      <Input label={t('signup.confirmPassword')} secure value={confirm} onChangeText={setConfirm} placeholder={t('login.passwordPlaceholder')} />
      {error ? (
        <Text variant="caption" color="danger">
          {error}
        </Text>
      ) : null}
      <Text variant="caption" color="subtle">
        {t('signup.terms')}
      </Text>
      <Button label={t('signup.submit')} onPress={submit} loading={loading} />
    </AuthLayout>
  );
}
