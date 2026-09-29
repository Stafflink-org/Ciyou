// Profil (`ProfileScreen`, onglet, §18.1, §16 client.md — « recentré » : bloc
// profil, résumés cliquables). Fonctionnel dès ce lot : identité réelle
// (Firebase Auth), déconnexion, rappel de vérification d'e-mail, raccourcis
// vers les autres écrans (encore des coquilles).
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import type { CompositeScreenProps } from '@react-navigation/native';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { MainStackParamList, MainTabsParamList } from '../../navigation/types';
import { useAuth } from '../../auth/AuthContext';
import { colors, radius, spacing } from '../../theme/tokens';
import { Text } from '../../ui/Text';
import { Card } from '../../ui/Card';
import { Badge } from '../../ui/Badge';
import { Button } from '../../ui/Button';

type Props = CompositeScreenProps<BottomTabScreenProps<MainTabsParamList, 'Profile'>, NativeStackScreenProps<MainStackParamList>>;

export function ProfileScreen({ navigation }: Props) {
  const { user, signOut, resendVerificationEmail } = useAuth();
  const [resent, setResent] = useState(false);
  const initials = (user?.displayName ?? user?.email ?? '?').trim().slice(0, 1).toUpperCase();

  const shortcuts: { label: string; icon: string; onPress: () => void }[] = [
    { label: 'Mes commandes', icon: '🧾', onPress: () => navigation.navigate('MainTabs', { screen: 'Orders' } as never) },
    { label: 'Mes favoris', icon: '❤️', onPress: () => navigation.navigate('MainTabs', { screen: 'Favorites' } as never) },
    { label: 'Mes adresses', icon: '📍', onPress: () => navigation.navigate('Addresses') },
    { label: 'Offres', icon: '🏷️', onPress: () => navigation.navigate('Promotions') },
    { label: 'Parrainage', icon: '🎁', onPress: () => navigation.navigate('Referral') },
    { label: 'Notifications', icon: '🔔', onPress: () => navigation.navigate('Notifications') },
    { label: 'Modes de paiement', icon: '💳', onPress: () => navigation.navigate('PaymentMethods') },
    { label: 'Aide', icon: '❓', onPress: () => navigation.navigate('Help') },
    { label: 'Support (mes demandes)', icon: '💬', onPress: () => navigation.navigate('Support', undefined) },
  ];

  return (
    <ScrollView style={styles.root} contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xxl }}>
      <Card>
        <View style={styles.identityRow}>
          <View style={styles.avatar}>
            <Text variant="title" color="inverted">
              {initials}
            </Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text variant="subtitle" numberOfLines={1}>
              {user?.displayName || 'Client Ciyou Eats'}
            </Text>
            <Text variant="caption" color="muted" numberOfLines={1}>
              {user?.email}
            </Text>
          </View>
          <Pressable onPress={() => navigation.navigate('EditProfile')}>
            <Text variant="bodyStrong" color="primary">
              Modifier
            </Text>
          </Pressable>
        </View>
      </Card>

      {user && !user.emailVerified ? (
        <Card style={{ marginTop: spacing.md }}>
          <Text variant="bodyStrong">Vérifiez votre e-mail</Text>
          <Text variant="caption" color="muted" style={{ marginTop: 2 }}>
            Un lien de confirmation a été envoyé à {user.email}.
          </Text>
          {resent ? (
            <Badge label="Renvoyé" tone="success" style={{ marginTop: spacing.sm }} />
          ) : (
            <Pressable onPress={() => resendVerificationEmail().then(() => setResent(true))} style={{ marginTop: spacing.sm }}>
              <Text variant="bodyStrong" color="primary">
                Renvoyer l’e-mail
              </Text>
            </Pressable>
          )}
        </Card>
      ) : null}

      <View style={styles.shortcuts}>
        {shortcuts.map((item) => (
          <Pressable key={item.label} onPress={item.onPress} style={styles.shortcutRow}>
            <Text style={{ fontSize: 18 }}>{item.icon}</Text>
            <Text variant="body" style={{ flex: 1, marginLeft: spacing.md }}>
              {item.label}
            </Text>
            <Text variant="body" color="subtle">
              ›
            </Text>
          </Pressable>
        ))}
      </View>

      <Button label="Se déconnecter" variant="outline" onPress={() => signOut()} style={{ marginTop: spacing.xl }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.canvas },
  identityRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  avatar: { width: 52, height: 52, borderRadius: radius.pill, backgroundColor: colors.ink, alignItems: 'center', justifyContent: 'center' },
  shortcuts: { marginTop: spacing.lg, backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, overflow: 'hidden' },
  shortcutRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.md, paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
});
