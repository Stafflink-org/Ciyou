// Checkout (`CheckoutScreen`, §18.1, §8 client.md) — mode de réception, adresse
// (formulaire inline, écrit dans `users/{uid}/addresses`), créneau, paiement,
// récapitulatif et confirmation réelle via la Cloud Function `placeOrder`
// (functions/src/orders/place.ts) : c'est elle qui fait foi (prix, stock,
// zone, promotion, capacité…) — voir les commentaires plus bas pour les
// limitations assumées de cet aperçu (pas de géocodage, paiement carte préparé
// mais pas encore branché à un vrai moyen Stripe).
import { useMemo, useRef, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { GeoPoint, collection, doc, setDoc } from 'firebase/firestore';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { MainStackParamList } from '../../navigation/types';
import { useAuth } from '../../auth/AuthContext';
import { docAt, useCollection, useDoc, callFunction, createdFields, errorMessage } from '../../lib/firestore';
import { db } from '../../lib/firebase';
import type { FulfillmentMode, PaymentMethod, PlaceOrderInput, PlaceOrderResult, Restaurant, UserAddress } from '@golink/shared';
import { paths } from '@golink/shared';
import { colors, radius, spacing } from '../../theme/tokens';
import { Text } from '../../ui/Text';
import { Input } from '../../ui/Input';
import { Button } from '../../ui/Button';
import { useToast } from '../../ui/Toast';
import { PlaceholderScreen } from '../shared/PlaceholderScreen';
import { useDefaultCity } from '../home/hooks';
import { useCart, cartLinesToInput } from '../cart/CartContext';
import { previewQuote, pricingConfigFor } from '../cart/pricing';

type Props = NativeStackScreenProps<MainStackParamList, 'Checkout'>;

const money = (cents: number) => `${(cents / 100).toFixed(2).replace('.', ',')} €`;

function newClientRequestId(): string {
  return `co-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Date programmée à partir de deux champs texte (pas de bibliothèque de date-picker ajoutée dans ce
 * lot) : `JJ/MM/AAAA` et `HH:MM`. `null` si incomplet ou invalide. */
function parseScheduledDateTime(dateText: string, timeText: string): Date | null {
  const dateMatch = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(dateText.trim());
  const timeMatch = /^(\d{2}):(\d{2})$/.exec(timeText.trim());
  if (!dateMatch || !timeMatch) return null;
  const [, day, month, year] = dateMatch;
  const [, hour, minute] = timeMatch;
  const date = new Date(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute));
  return Number.isNaN(date.getTime()) ? null : date;
}

export function CheckoutScreen({ navigation }: Props) {
  const { user } = useAuth();
  const cart = useCart();
  const toast = useToast();
  const { city } = useDefaultCity();
  const { data: restaurant } = useDoc<Restaurant>(cart.restaurantId ? docAt(`restaurants/${cart.restaurantId}`) : null);
  const { data: addresses } = useCollection<UserAddress>(user ? collection(db, paths.userSub(user.uid, 'addresses')) : null);

  const [fulfillment, setFulfillment] = useState<FulfillmentMode | null>(null);
  const [addressId, setAddressId] = useState<string | null>(null);
  const [addingAddress, setAddingAddress] = useState(false);
  const [addrLabel, setAddrLabel] = useState('');
  const [addrStreet, setAddrStreet] = useState('');
  const [addrDetails, setAddrDetails] = useState('');
  const [savingAddress, setSavingAddress] = useState(false);

  const [timing, setTiming] = useState<'now' | 'later'>('now');
  const [scheduledDate, setScheduledDate] = useState('');
  const [scheduledTime, setScheduledTime] = useState('');

  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod | null>(null);
  const [promoCode, setPromoCode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);
  const clientRequestId = useRef(newClientRequestId());

  const availableModes = (restaurant?.fulfillmentModes ?? []).filter((m): m is 'delivery' | 'pickup' => m === 'delivery' || m === 'pickup');
  const activeMode = fulfillment && availableModes.includes(fulfillment as 'delivery' | 'pickup') ? fulfillment : (availableModes[0] ?? null);

  const acceptsCard = restaurant?.acceptedPaymentMethods.includes('card') ?? false;
  // Espèces : uniquement avec un livreur salarié du commerce en livraison (décision client), toujours
  // possible au retrait si le commerce l'accepte. Aperçu seulement — `placeOrder` revalide.
  const acceptsCash =
    (restaurant?.acceptedPaymentMethods.includes('cash') ?? false) &&
    (activeMode === 'pickup' || restaurant?.deliveredBy === 'restaurant' || (restaurant?.deliveredBy === 'both' && true));
  const availableMethods: PaymentMethod[] = [...(acceptsCard ? (['card'] as const) : []), ...(acceptsCash ? (['cash'] as const) : [])];
  const activeMethod = paymentMethod && availableMethods.includes(paymentMethod) ? paymentMethod : (availableMethods[0] ?? null);

  const config = pricingConfigFor(restaurant?.countryId);
  const quote = useMemo(
    () => previewQuote(cart.lines, (activeMode ?? 'delivery') as FulfillmentMode, restaurant?.ownDeliveryFeeCents ?? null, restaurant?.minOrderCents ?? 0, config),
    [cart.lines, activeMode, restaurant?.ownDeliveryFeeCents, restaurant?.minOrderCents, config],
  );

  if (cart.loaded && cart.lines.length === 0) {
    return <PlaceholderScreen icon="🧾" title="Votre panier est vide" note="Ajoutez un plat avant de passer commande." />;
  }

  const saveAddress = async () => {
    if (!user) return;
    if (!addrStreet.trim()) {
      toast.show('Indiquez une adresse de livraison.', 'danger');
      return;
    }
    setSavingAddress(true);
    try {
      const ref = doc(collection(db, paths.userSub(user.uid, 'addresses')));
      // Pas de géocodage dans ce lot (aucune intégration cartographique livrée) : le point géographique
      // par défaut est le centre de la ville active, à corriger dès le lot cartographie/adresses dédié.
      const center = city?.center ?? { lat: 0, lng: 0 };
      const address: UserAddress = {
        label: addrLabel.trim() || 'Adresse',
        line1: addrStreet.trim(),
        line2: null,
        postalCode: '00000',
        city: city?.name ?? restaurant?.address.city ?? '',
        countryCode: restaurant?.countryId ?? 'FR',
        geo: new GeoPoint(center.lat, center.lng),
        geohash: null,
        placeId: null,
        details: addrDetails.trim() || null,
        instructions: null,
        floor: null,
        doorCode: null,
        isDefault: addresses.length === 0,
        ...createdFields(user.uid),
      } as unknown as UserAddress;
      await setDoc(ref, address);
      setAddressId(ref.id);
      setAddingAddress(false);
      setAddrLabel('');
      setAddrStreet('');
      setAddrDetails('');
      toast.show('Adresse enregistrée');
    } catch (error) {
      toast.show(errorMessage(error), 'danger');
    } finally {
      setSavingAddress(false);
    }
  };

  const onConfirm = async () => {
    if (!restaurant || !cart.restaurantId || !activeMode) return;
    setErrorText(null);
    if (activeMode === 'delivery' && !addressId) {
      setErrorText('Ajoutez une adresse de livraison.');
      return;
    }
    if (!activeMethod) {
      setErrorText('Choisissez un moyen de paiement actuellement accepté.');
      return;
    }
    let scheduledFor: string | null = null;
    if (timing === 'later') {
      const parsed = parseScheduledDateTime(scheduledDate, scheduledTime);
      if (!parsed || parsed.getTime() <= Date.now()) {
        setErrorText('Choisissez une date et une heure à venir.');
        return;
      }
      scheduledFor = parsed.toISOString();
    }
    if (activeMethod === 'card') {
      // Carte bancaire : préparé mais pas encore branché (pas d'écran de saisie Stripe dans ce lot —
      // il faudrait `@stripe/stripe-react-native` ou Stripe.js web + un PaymentIntent confirmé côté
      // client). L'appel ci-dessous ira au bout avec `paymentMethod: 'card'` et sans `paymentMethodId` :
      // la Cloud Function le refusera proprement (« Choisissez un moyen de paiement. »), ce qui est un
      // comportement réel et honnête plutôt qu'un paiement simulé qui prétendrait avoir débité une carte.
      toast.show('Le paiement par carte n’est pas encore branché dans cette version : choisissez Espèces pour une commande réelle, ou continuez pour voir le refus serveur attendu.');
    }
    const input: PlaceOrderInput = {
      restaurantId: cart.restaurantId,
      fulfillment: activeMode,
      lines: cartLinesToInput(cart.lines),
      addressId: activeMode === 'delivery' ? addressId : null,
      paymentMethod: activeMethod,
      paymentMethodId: null,
      promoCode: promoCode.trim() || null,
      customerNote: null,
      scheduledFor,
      source: Platform.OS === 'web' ? 'client_web' : Platform.OS === 'ios' ? 'client_ios' : 'client_android',
      clientRequestId: clientRequestId.current,
      expectedTotalCents: quote.totalCents,
    };
    setSubmitting(true);
    try {
      const result = await callFunction<PlaceOrderInput, PlaceOrderResult>('placeOrder')(input);
      cart.clear();
      toast.show('Commande confirmée !');
      navigation.replace('Confirmation', { orderId: result.orderId });
    } catch (error) {
      setErrorText(errorMessage(error));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <View style={styles.root}>
      <ScrollView contentContainerStyle={{ paddingBottom: 160 }}>
        {restaurant && (!restaurant.isOpen || !restaurant.acceptingOrders) ? (
          <Banner text="Restaurant fermé temporairement : aucune nouvelle commande ne peut être passée." />
        ) : null}
        {restaurant?.minOrderCents ? <Banner text={`Commande minimum : ${money(restaurant.minOrderCents)} (hors frais).`} tone="info" /> : null}
        {activeMode === 'delivery' ? <Banner text="Frais de livraison fixes pour la démo : les zones ne sont pas calculées par géolocalisation." tone="info" /> : null}

        <View style={styles.header}>
          <Pressable onPress={() => navigation.navigate('Cart')}>
            <Text variant="bodyStrong" color="primary">
              ‹ Retour au panier
            </Text>
          </Pressable>
          <Text variant="eyebrow" color="muted" style={{ marginTop: spacing.sm }}>
            PLUS QU'UNE ÉTAPE
          </Text>
          <Text variant="title">Finaliser la commande</Text>
        </View>

        <Section title="Comment souhaitez-vous recevoir votre repas ?">
          <View style={styles.modeRow}>
            {availableModes.length === 0 ? <Text color="danger">Aucun mode de commande n'est disponible.</Text> : null}
            {availableModes.includes('delivery') ? (
              <ModeButton testID="button-mode-delivery" label="Livraison" active={activeMode === 'delivery'} onPress={() => setFulfillment('delivery')} />
            ) : null}
            {availableModes.includes('pickup') ? (
              <ModeButton testID="button-mode-pickup" label="Retrait" active={activeMode === 'pickup'} onPress={() => setFulfillment('pickup')} />
            ) : null}
          </View>
        </Section>

        {activeMode === 'delivery' ? (
          <Section
            title="Adresse de livraison"
            action={{ label: addingAddress ? 'Annuler' : 'Ajouter', onPress: () => setAddingAddress((v) => !v) }}
            actionTestID="button-add-address"
          >
            {addresses.map((a) => (
              <Pressable key={a.id} onPress={() => setAddressId(a.id)} style={[styles.addressRow, addressId === a.id && styles.addressRowActive]} testID={`button-address-${a.id}`}>
                <View style={{ flex: 1 }}>
                  <Text variant="bodyStrong">{a.label}</Text>
                  <Text variant="caption" color="muted">
                    {a.line1}
                    {a.details ? ` · ${a.details}` : ''}
                  </Text>
                </View>
                {addressId === a.id ? <Text style={{ fontSize: 18 }}>✓</Text> : null}
              </Pressable>
            ))}
            {addresses.length === 0 && !addingAddress ? <Text color="muted">Ajoutez une adresse de livraison.</Text> : null}
            {addingAddress ? (
              <View style={{ gap: spacing.sm, marginTop: spacing.sm }}>
                <Input label="Étiquette" placeholder="Bureau" value={addrLabel} onChangeText={setAddrLabel} testID="input-address-label" />
                <Input label="Rue" placeholder="12 rue de la Paix" value={addrStreet} onChangeText={setAddrStreet} testID="input-address-street" />
                <Input label="Complément" placeholder="54400 Longwy, 2e étage" value={addrDetails} onChangeText={setAddrDetails} testID="input-address-details" />
                <Button label="Enregistrer l'adresse" onPress={saveAddress} loading={savingAddress} testID="button-save-address" />
              </View>
            ) : null}
            <View style={styles.mapPlaceholder}>
              <Text variant="caption" color="muted" align="center">
                Restaurant — Vous{'\n'}CARTE ILLUSTRATIVE · {(city?.name ?? '').toUpperCase()}
              </Text>
            </View>
          </Section>
        ) : activeMode === 'pickup' ? (
          <Section title="Retrait">
            <Text variant="body" color="muted">
              Récupérez votre commande directement au restaurant.
            </Text>
            {/* Les consignes de retrait (`pickupInstructions`) vivent dans le document
                `restaurants/{rid}/settings/orders`, réservé au personnel du restaurant par les
                règles Firestore : le client n'y a pas accès, contrairement à la maquette qui les
                affiche (limitation documentée dans docs/CONTRAT_MODULES.md §10). */}
          </Section>
        ) : null}

        <Section title="Quand ?">
          <View style={styles.modeRow}>
            <ModeButton testID="button-timing-now" label="Dès que possible" active={timing === 'now'} onPress={() => setTiming('now')} />
            <ModeButton testID="button-timing-later" label="Programmer" active={timing === 'later'} onPress={() => setTiming('later')} />
          </View>
          {timing === 'now' ? (
            <Text variant="caption" color="muted" style={{ marginTop: spacing.xs }}>
              On s'en occupe tout de suite.
            </Text>
          ) : (
            <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm }}>
              <View style={{ flex: 1 }}>
                <Input label="Date (JJ/MM/AAAA)" placeholder="28/09/2026" value={scheduledDate} onChangeText={setScheduledDate} testID="input-scheduled-date" />
              </View>
              <View style={{ width: 110 }}>
                <Input label="Heure (HH:MM)" placeholder="19:00" value={scheduledTime} onChangeText={setScheduledTime} />
              </View>
            </View>
          )}
        </Section>

        <Section title="Paiement simulé">
          <Text variant="caption" color="muted" style={{ marginBottom: spacing.sm }}>
            Démo uniquement : aucune donnée bancaire demandée ni transmise.
          </Text>
          <View style={styles.modeRow}>
            {availableMethods.length === 0 ? <Text color="danger">Aucun moyen de paiement disponible pour ce mode.</Text> : null}
            {acceptsCard ? <ModeButton testID="button-payment-card" label="Carte · démo" active={activeMethod === 'card'} onPress={() => setPaymentMethod('card')} /> : null}
            {acceptsCash ? <ModeButton testID="button-payment-cash" label="Espèces" active={activeMethod === 'cash'} onPress={() => setPaymentMethod('cash')} /> : null}
          </View>
        </Section>

        <Section title="Votre commande">
          <Text variant="bodyStrong">
            {restaurant?.name} · {cart.itemsCount} article(s)
          </Text>
          {cart.lines.map((line) => (
            <Text key={line.lineId} variant="caption" color="muted" style={{ marginTop: 4 }}>
              {line.quantity} × {line.name} — {money((line.unitPriceCents + line.optionsPriceCents) * line.quantity)}
            </Text>
          ))}
          <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md }}>
            <View style={{ flex: 1 }}>
              <Input placeholder="Code promotionnel" autoCapitalize="characters" value={promoCode} onChangeText={setPromoCode} testID="input-checkout-promo" />
            </View>
            <Pressable style={styles.okButton} testID="button-checkout-apply-promo" onPress={() => toast.show('Le code sera vérifié à la confirmation.')}>
              <Text variant="bodyStrong" style={{ color: colors.primaryFg }}>
                OK
              </Text>
            </Pressable>
          </View>
          <SummaryLine label="Sous-total" value={money(quote.subtotalCents)} />
          <SummaryLine label="Livraison" value={activeMode === 'delivery' ? (quote.deliveryFeeCents > 0 ? money(quote.deliveryFeeCents) : 'Offerte') : 'Non applicable'} />
          <SummaryLine label="Frais de service" value={money(quote.serviceFeeCents)} />
          <View style={styles.totalRow}>
            <Text variant="title">Total</Text>
            <Text variant="title" color="primary">
              {money(quote.totalCents)}
            </Text>
          </View>
          {errorText ? (
            <Text variant="body" color="danger" testID="text-checkout-error" style={{ marginTop: spacing.sm }}>
              {errorText}
            </Text>
          ) : null}
        </Section>
      </ScrollView>

      <View style={styles.footer}>
        <Button label="Confirmer la commande" onPress={onConfirm} loading={submitting} testID="button-place-order" />
        <Text variant="caption" color="subtle" align="center" style={{ marginTop: spacing.xs }}>
          Commande fictive · Aucun montant débité
        </Text>
      </View>
    </View>
  );
}

function Banner({ text, tone = 'warning' }: { text: string; tone?: 'warning' | 'info' }) {
  return (
    <View style={[styles.banner, tone === 'info' && styles.bannerInfo]} testID="checkout-outlet-settings">
      <Text variant="caption" style={{ color: tone === 'info' ? colors.fgMuted : colors.warning }}>
        {text}
      </Text>
    </View>
  );
}

function Section({ title, children, action, actionTestID }: { title: string; children: React.ReactNode; action?: { label: string; onPress: () => void }; actionTestID?: string }) {
  return (
    <View style={styles.section}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.sm }}>
        <Text variant="bodyStrong">{title}</Text>
        {action ? (
          <Pressable onPress={action.onPress} testID={actionTestID}>
            <Text variant="bodyStrong" color="primary">
              {action.label}
            </Text>
          </Pressable>
        ) : null}
      </View>
      {children}
    </View>
  );
}

function ModeButton({ label, active, onPress, testID }: { label: string; active: boolean; onPress: () => void; testID?: string }) {
  return (
    <Pressable onPress={onPress} style={[styles.modeButton, active && styles.modeButtonActive]} testID={testID}>
      <Text variant="bodyStrong" style={{ color: active ? colors.primaryFg : colors.fg }}>
        {label}
      </Text>
    </Pressable>
  );
}

function SummaryLine({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.sm }}>
      <Text variant="body" color="muted">
        {label}
      </Text>
      <Text variant="bodyStrong">{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.canvas },
  banner: { backgroundColor: colors.warningSoft, padding: spacing.md, marginHorizontal: spacing.lg, marginTop: spacing.md, borderRadius: radius.md },
  bannerInfo: { backgroundColor: colors.surfaceRaised },
  header: { padding: spacing.lg, gap: 2 },
  section: { paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  modeRow: { flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' },
  modeButton: { paddingVertical: 10, paddingHorizontal: spacing.lg, borderRadius: radius.pill, backgroundColor: colors.surfaceRaised },
  modeButtonActive: { backgroundColor: colors.primary },
  addressRow: { flexDirection: 'row', alignItems: 'center', padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, marginBottom: spacing.sm },
  addressRowActive: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  mapPlaceholder: { marginTop: spacing.md, height: 90, borderRadius: radius.md, backgroundColor: colors.surfaceRaised, alignItems: 'center', justifyContent: 'center' },
  okButton: { backgroundColor: colors.ink, paddingHorizontal: spacing.lg, height: 50, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.md, paddingTop: spacing.md, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  footer: { padding: spacing.lg, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, backgroundColor: colors.surface },
});
