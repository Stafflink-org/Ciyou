// Réinitialisation du mot de passe (e-mail Firebase standard). Copie fidèle de
// apps/client/src/auth/ForgotPasswordScreen.tsx.
import { useState } from 'react';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { AuthStackParamList } from '../navigation/types';
import { useAuth } from './AuthContext';
import { errorMessage } from '../lib/firestore';
import { AuthLayout } from './AuthLayout';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Text } from '../ui/Text';

type Props = NativeStackScreenProps<AuthStackParamList, 'ForgotPassword'>;

export function ForgotPasswordScreen({ navigation }: Props) {
  const { sendPasswordReset } = useAuth();
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    if (!email.trim()) {
      setError('Renseignez votre e-mail.');
      return;
    }
    setError(null);
    setLoading(true);
    try {
      await sendPasswordReset(email);
      setSent(true);
    } catch (err) {
      setError(errorMessage(err, 'Envoi impossible. Vérifiez l’adresse saisie.'));
    } finally {
      setLoading(false);
    }
  };

  if (sent) {
    return (
      <AuthLayout title="E-mail envoyé" subtitle={`Un lien de réinitialisation a été envoyé à ${email.trim()} s’il correspond à un compte.`}>
        <Button label="Retour à la connexion" onPress={() => navigation.navigate('SignIn')} />
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="Mot de passe oublié" subtitle="Indiquez votre e-mail : nous vous enverrons un lien de réinitialisation.">
      <Input label="E-mail" autoCapitalize="none" keyboardType="email-address" autoComplete="email" value={email} onChangeText={setEmail} placeholder="vous@exemple.com" />
      {error ? (
        <Text variant="caption" color="danger">
          {error}
        </Text>
      ) : null}
      <Button label="Envoyer le lien" onPress={submit} loading={loading} />
    </AuthLayout>
  );
}
