// Modification du profil (§19 client.md) — écriture réelle de `users/{uid}`
// (champs autorisés par `userEditableFields()` : firstName/lastName/phone,
// displayName synchronisé aussi côté Firebase Auth) et des préférences de
// notification.
import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { updateProfile as updateAuthProfile } from '@firebase/auth';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { MainStackParamList } from '../../navigation/types';
import type { UserProfile } from '@golink/shared';
import { auth } from '../../lib/firebase';
import { useAuth } from '../../auth/AuthContext';
import { docAt, updatedFields, useDoc, errorMessage } from '../../lib/firestore';
import { updateDoc } from 'firebase/firestore';
import { colors, spacing } from '../../theme/tokens';
import { Text } from '../../ui/Text';
import { Input } from '../../ui/Input';
import { Button } from '../../ui/Button';
import { useToast } from '../../ui/Toast';
import { useTranslation } from '../../i18n/I18nProvider';

type Props = NativeStackScreenProps<MainStackParamList, 'EditProfile'>;

export function EditProfileScreen({ navigation }: Props) {
  const { user } = useAuth();
  const { data: profile, loading } = useDoc<UserProfile>(user ? docAt(`users/${user.uid}`) : null);
  const toast = useToast();
  const { t } = useTranslation('editProfile');

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phone, setPhone] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (profile) {
      setFirstName(profile.firstName ?? '');
      setLastName(profile.lastName ?? '');
      setPhone(profile.phone ?? '');
    }
  }, [profile]);

  const save = async () => {
    if (!user) return;
    if (!firstName.trim() || !lastName.trim()) {
      toast.show(t('editProfile:errors.nameRequired'), 'danger');
      return;
    }
    setSaving(true);
    try {
      const displayName = `${firstName.trim()} ${lastName.trim()}`.trim();
      await updateDoc(docAt(`users/${user.uid}`), {
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        displayName,
        phone: phone.trim() || null,
        ...updatedFields(user.uid),
      });
      if (auth.currentUser) await updateAuthProfile(auth.currentUser, { displayName }).catch(() => undefined);
      toast.show(t('editProfile:success'));
      navigation.goBack();
    } catch (error) {
      toast.show(errorMessage(error), 'danger');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return null;

  return (
    <ScrollView style={styles.root} contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}>
      <Text variant="title">{t('editProfile:title')}</Text>
      <Input label={t('editProfile:fields.firstName')} value={firstName} onChangeText={setFirstName} />
      <Input label={t('editProfile:fields.lastName')} value={lastName} onChangeText={setLastName} />
      <Input
        label={t('editProfile:fields.phone')}
        placeholder={t('editProfile:fields.phonePlaceholder')}
        keyboardType="phone-pad"
        value={phone}
        onChangeText={setPhone}
      />
      <Input label={t('editProfile:fields.email')} value={user?.email ?? ''} editable={false} />
      <Text variant="caption" color="muted">
        {t('editProfile:emailHint')}
      </Text>
      <Button label={t('editProfile:save')} onPress={save} loading={saving} style={{ marginTop: spacing.md }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.canvas },
});
