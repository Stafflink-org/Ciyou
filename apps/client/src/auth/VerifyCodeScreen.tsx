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

type Props = NativeStackScreenProps<AuthStackParamList, 'VerifyCode'>;

export function VerifyCodeScreen({ navigation }: Props) {
  const { user, resendVerificationEmail } = useAuth();
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
    <AuthLayout title="Vérifiez votre e-mail" subtitle={`Un lien de confirmation a été envoyé à ${user?.email ?? 'votre adresse'}.`}>
      <Text variant="body" color="muted">
        Vous pouvez commander dès maintenant ; la vérification confirme simplement que cette adresse vous appartient.
      </Text>
      {resent ? (
        <Text variant="caption" color="success">
          E-mail renvoyé.
        </Text>
      ) : null}
      <Button label="Renvoyer l’e-mail" variant="outline" onPress={resend} loading={loading} />
      <Button label="Continuer" onPress={() => navigation.navigate('SignIn')} />
    </AuthLayout>
  );
}
