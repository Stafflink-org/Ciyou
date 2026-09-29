// Écran affiché juste après l'inscription : invite à vérifier l'adresse e-mail.
// Non bloquant (aucune décision client ne l'exige à ce stade) — l'utilisateur
// est déjà connecté (RootNavigator est déjà passé sur `Main` en arrière-plan) ;
// « Continuer » referme simplement cet écran informatif.
import { useState } from 'react';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { AuthStackParamList } from '../navigation/types';
import { useAuth } from './AuthContext';
import { AuthLayout } from './AuthLayout';
import { Button } from '../ui/Button';
import { Text } from '../ui/Text';
import { useTranslation } from '../i18n/I18nProvider';

type Props = NativeStackScreenProps<AuthStackParamList, 'VerifyCode'>;

export function VerifyCodeScreen({ navigation }: Props) {
  const { user, resendVerificationEmail } = useAuth();
  const { t } = useTranslation('auth');
  const [resent, setResent] = useState(false);
  const [loading, setLoading] = useState(false);

  const resend = async () => {
    setLoading(true);
    try {
      await resendVerificationEmail();
      setResent(true);
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthLayout title={t('verifyCode.title')} subtitle={t('verifyCode.subtitle', { email: user?.email ?? t('verifyCode.fallbackEmail') })}>
      <Text variant="body" color="muted">
        {t('verifyCode.info')}
      </Text>
      {resent ? (
        <Text variant="caption" color="success">
          {t('verifyCode.resent')}
        </Text>
      ) : null}
      <Button label={t('verifyCode.resend')} variant="outline" onPress={resend} loading={loading} />
      <Button label={t('verifyCode.continue')} onPress={() => navigation.navigate('SignIn')} />
    </AuthLayout>
  );
}
