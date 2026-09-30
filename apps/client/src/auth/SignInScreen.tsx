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
import { useTranslation } from '../i18n/I18nProvider';

type Props = NativeStackScreenProps<AuthStackParamList, 'SignIn'>;

export function SignInScreen({ navigation }: Props) {
  const { signIn } = useAuth();
  const { t } = useTranslation('auth');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    if (!email.trim() || !password) {
      setError(t('login.missingFields'));
      return;
    }
    setError(null);
    setLoading(true);
    try {
      await signIn(email, password);
      // Pas de navigation manuelle : RootNavigator bascule automatiquement
      // vers `Main` dès que la session Firebase est active.
    } catch (err) {
      setError(errorMessage(err, t, t('login.invalidCredentials')));
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthLayout
      title={t('login.title')}
      subtitle={t('login.subtitle')}
      footer={
        <View style={{ flexDirection: 'row', gap: 4 }}>
          <Text variant="body" color="muted">
            {t('login.noAccount')}
          </Text>
          <Pressable onPress={() => navigation.navigate('SignUp')}>
            <Text variant="bodyStrong" color="primary">
              {t('login.createAccount')}
            </Text>
          </Pressable>
        </View>
      }
    >
      <Input label={t('login.email')} autoCapitalize="none" keyboardType="email-address" autoComplete="email" value={email} onChangeText={setEmail} placeholder={t('login.emailPlaceholder')} />
      <Input label={t('login.password')} secure autoComplete="password" value={password} onChangeText={setPassword} placeholder={t('login.passwordPlaceholder')} />
      <Pressable onPress={() => navigation.navigate('ForgotPassword')} style={{ alignSelf: 'flex-end' }}>
        <Text variant="caption" color="primary">
          {t('login.forgot')}
        </Text>
      </Pressable>
      {error ? (
        <Text variant="caption" color="danger">
          {error}
        </Text>
      ) : null}
      <Button label={t('login.submit')} onPress={submit} loading={loading} />
    </AuthLayout>
  );
}
