// Réinitialisation du mot de passe (e-mail Firebase standard).
import { useState } from 'react';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { AuthStackParamList } from '../navigation/types';
import { useAuth } from './AuthContext';
import { errorMessage } from '../lib/firestore';
import { AuthLayout } from './AuthLayout';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Text } from '../ui/Text';
import { useTranslation } from '../i18n/I18nProvider';

type Props = NativeStackScreenProps<AuthStackParamList, 'ForgotPassword'>;

export function ForgotPasswordScreen({ navigation }: Props) {
  const { sendPasswordReset } = useAuth();
  const { t } = useTranslation('auth');
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    if (!email.trim()) {
      setError(t('forgotPassword.missingEmail'));
      return;
    }
    setError(null);
    setLoading(true);
    try {
      await sendPasswordReset(email);
      setSent(true);
    } catch (err) {
      setError(errorMessage(err, t, t('forgotPassword.sendFailed')));
    } finally {
      setLoading(false);
    }
  };

  if (sent) {
    return (
      <AuthLayout title={t('forgotPassword.sentTitle')} subtitle={t('forgotPassword.sentSubtitle', { email: email.trim() })}>
        <Button label={t('forgotPassword.backToSignIn')} onPress={() => navigation.navigate('SignIn')} />
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title={t('forgotPassword.title')} subtitle={t('forgotPassword.subtitle')}>
      <Input label={t('login.email')} autoCapitalize="none" keyboardType="email-address" autoComplete="email" value={email} onChangeText={setEmail} placeholder={t('login.emailPlaceholder')} />
      {error ? (
        <Text variant="caption" color="danger">
          {error}
        </Text>
      ) : null}
      <Button label={t('forgotPassword.submit')} onPress={submit} loading={loading} />
    </AuthLayout>
  );
}
