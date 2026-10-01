// Checkout (`CheckoutScreen`, §18.1, §8 client.md) — mode de réception, adresse
// (formulaire inline, écrit dans `users/{uid}/addresses`), créneau, paiement,
// récapitulatif et confirmation réelle via la Cloud Function `placeOrder`
// (functions/src/orders/place.ts) : c'est elle qui fait foi (prix, stock,
// zone, promotion, capacité…). Paiement carte réel via Stripe (features/checkout/payment/,
// voir docs/CONTRAT_MODULES.md §10) : moyen de paiement créé à l'écran (CardField natif
// ou CardElement web), autorisation côté serveur, authentification forte 3-D Secure gérée
// via `confirmNextAction` + la Cloud Function `confirmOrderPayment` si nécessaire — voir
// les commentaires plus bas pour la limitation assumée restante (pas de géocodage d'adresse).
import { useMemo, useRef, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { GeoPoint, collection, doc, setDoc } from 'firebase/firestore';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { MainStackParamList } from '../../navigation/types';
import { useAuth } from '../../auth/AuthContext';
import { docAt, useCollection, useDoc, callFunction, createdFields, errorMessage } from '../../lib/firestore';
import { db } from '../../lib/firebase';
import { APP_VERSION } from '../../lib/env';
import type { FulfillmentMode, PaymentMethod, PlaceOrderInput, PlaceOrderResult, Restaurant, UserAddress, UserProfile } from '@golink/shared';
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
import { useTranslation } from '../../i18n/I18nProvider';
import { CardEntry, useCardPayment } from './payment/CardInput';
import { PaymentProvider } from './payment/PaymentProvider';

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

// Fournisseur Stripe posé au plus près du formulaire (pas au niveau de l'app) : évite de charger
// Stripe.js/le SDK natif sur les écrans qui n'en ont pas besoin, et garantit que `useCardPayment()`
// et `<CardEntry>` (qui ont besoin du contexte Elements côté web) restent dans le même sous-arbre.
export function CheckoutScreen(props: Props) {
  return (
    <PaymentProvider>
      <CheckoutScreenInner {...props} />
    </PaymentProvider>
  );
}

function CheckoutScreenInner({ navigation }: Props) {
  const { t } = useTranslation('checkout');
  const { user } = useAuth();
  const cart = useCart();
  const toast = useToast();
  const { city } = useDefaultCity();
  const { data: restaurant } = useDoc<Restaurant>(cart.restaurantId ? docAt(`restaurants/${cart.restaurantId}`) : null);
  const { data: addresses } = useCollection<UserAddress>(user ? collection(db, paths.userSub(user.uid, 'addresses')) : null);
  const { data: profile } = useDoc<UserProfile>(user ? docAt(`users/${user.uid}`) : null);

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
  // Avoirs Ciyou Eats (§19 cahier) : jamais consommés à la commande faute d'appel côté client,
  // alors que le serveur (orders/place.ts) sait déjà les appliquer intégralement (paymentMethod:
  // 'wallet', aucune carte requise) ou partiellement (reste réglé par le moyen choisi).
  const [useWallet, setUseWallet] = useState(false);
  // Préremplit avec le code choisi depuis l'écran Promotions (lot 3), le cas échéant.
  const [promoCode, setPromoCode] = useState(cart.promoCode ?? '');
  const [submitting, setSubmitting] = useState(false);
  const [submittingLabel, setSubmittingLabel] = useState<string | null>(null);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [cardComplete, setCardComplete] = useState(false);
  const clientRequestId = useRef(newClientRequestId());
  const cardPayment = useCardPayment();

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
  const walletBalanceCents = Math.max(0, profile?.walletBalanceCents ?? 0);
  const walletAppliedCents = useWallet ? Math.min(walletBalanceCents, quote.totalCents) : 0;
  const remainingCents = quote.totalCents - walletAppliedCents;
  const walletCoversFull = useWallet && remainingCents <= 0;

  if (cart.loaded && cart.lines.length === 0) {
    return <PlaceholderScreen icon="🧾" title={t('emptyTitle')} note={t('emptyNote')} />;
  }

  const saveAddress = async () => {
    if (!user) return;
    if (!addrStreet.trim()) {
      toast.show(t('addressEmptyToast'), 'danger');
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
      toast.show(t('addressSavedToast'));
    } catch (error) {
      toast.show(errorMessage(error, t), 'danger');
    } finally {
      setSavingAddress(false);
    }
  };

  const onConfirm = async () => {
    if (!restaurant || !cart.restaurantId || !activeMode) return;
    setErrorText(null);
    if (activeMode === 'delivery' && !addressId) {
      setErrorText(t('addressMissingError'));
      return;
    }
    if (!walletCoversFull && !activeMethod) {
      setErrorText(t('paymentMissingError'));
      return;
    }
    let scheduledFor: string | null = null;
    if (timing === 'later') {
      const parsed = parseScheduledDateTime(scheduledDate, scheduledTime);
      if (!parsed || parsed.getTime() <= Date.now()) {
        setErrorText(t('scheduleInvalidError'));
        return;
      }
      scheduledFor = parsed.toISOString();
    }
    // Carte bancaire : crée un vrai moyen de paiement Stripe (CardField natif ou CardElement web,
    // selon la plateforme — voir features/checkout/payment/) avant d'appeler `placeOrder`, qui autorise
    // réellement le montant côté serveur (functions/src/orders/payment.ts::authorizePayment).
    let paymentMethodId: string | null = null;
    if (!walletCoversFull && activeMethod === 'card') {
      if (!cardComplete) {
        setErrorText(t('cardIncompleteError'));
        return;
      }
      setSubmitting(true);
      setSubmittingLabel(t('cardPreparingToast'));
      const created = await cardPayment.createCardPaymentMethod();
      if ('error' in created) {
        setErrorText(created.error);
        setSubmitting(false);
        setSubmittingLabel(null);
        return;
      }
      paymentMethodId = created.id;
    }
    const input: PlaceOrderInput = {
      restaurantId: cart.restaurantId,
      fulfillment: activeMode,
      lines: cartLinesToInput(cart.lines),
      addressId: activeMode === 'delivery' ? addressId : null,
      // 'wallet' n'est jamais envoyé ici : le serveur le détermine lui-même à partir du solde
      // réel (useWallet + chargedCents === 0) — un client ne peut pas se l'auto-attribuer (voir
      // orders/place.ts). Quand les avoirs couvrent tout, la valeur ci-dessous est ignorée côté
      // serveur (la branche d'autorisation de paiement est sautée), un simple repli valide suffit.
      paymentMethod: walletCoversFull ? 'card' : (activeMethod as PaymentMethod),
      paymentMethodId,
      useWallet,
      promoCode: promoCode.trim() || null,
      customerNote: null,
      scheduledFor,
      source: Platform.OS === 'web' ? 'client_web' : Platform.OS === 'ios' ? 'client_ios' : 'client_android',
      clientRequestId: clientRequestId.current,
      expectedTotalCents: quote.totalCents,
      appVersion: APP_VERSION,
    };
    setSubmitting(true);
    setSubmittingLabel(null);
    try {
      const result = await callFunction<PlaceOrderInput, PlaceOrderResult>('placeOrder')(input);
      // Authentification forte (3-D Secure) : la commande existe déjà (autorisation en attente),
      // il faut compléter l'authentification puis rafraîchir son état côté serveur avant de conclure.
      if (result.payment.status === 'requires_action' && result.payment.clientSecret) {
        setSubmittingLabel(t('cardAuthenticatingToast'));
        const next = await cardPayment.confirmNextAction(result.payment.clientSecret);
        if (next.error) {
          setErrorText(next.error || t('cardAuthFailedError'));
          setSubmitting(false);
          setSubmittingLabel(null);
          return;
        }
        await callFunction<{ orderId: string }, { status: string }>('confirmOrderPayment')({ orderId: result.orderId });
      }
      cart.clear();
      toast.show(t('orderConfirmedToast'));
      navigation.replace('Confirmation', { orderId: result.orderId });
    } catch (error) {
      setErrorText(errorMessage(error, t) || t('cardGenericError'));
    } finally {
      setSubmitting(false);
      setSubmittingLabel(null);
    }
  };

  return (
    <View style={styles.root}>
      <ScrollView contentContainerStyle={{ paddingBottom: 160 }}>
        {restaurant && (!restaurant.isOpen || !restaurant.acceptingOrders) ? (
          <Banner text={t('closedBanner')} />
        ) : null}
        {restaurant?.minOrderCents ? <Banner text={t('minOrderBanner', { amount: money(restaurant.minOrderCents) })} tone="info" /> : null}
        {activeMode === 'delivery' ? <Banner text={t('deliveryFeeBanner')} tone="info" /> : null}

        <View style={styles.header}>
          <Pressable onPress={() => navigation.navigate('Cart')}>
            <Text variant="bodyStrong" color="primary">
              {t('backToCart')}
            </Text>
          </Pressable>
          <Text variant="eyebrow" color="muted" style={{ marginTop: spacing.sm }}>
            {t('eyebrow')}
          </Text>
          <Text variant="title">{t('title')}</Text>
        </View>

        <Section title={t('fulfillmentTitle')}>
          <View style={styles.modeRow}>
            {availableModes.length === 0 ? <Text color="danger">{t('noModeAvailable')}</Text> : null}
            {availableModes.includes('delivery') ? (
              <ModeButton testID="button-mode-delivery" label={t('delivery')} active={activeMode === 'delivery'} onPress={() => setFulfillment('delivery')} />
            ) : null}
            {availableModes.includes('pickup') ? (
              <ModeButton testID="button-mode-pickup" label={t('pickup')} active={activeMode === 'pickup'} onPress={() => setFulfillment('pickup')} />
            ) : null}
          </View>
        </Section>

        {activeMode === 'delivery' ? (
          <Section
            title={t('deliveryAddressTitle')}
            action={{ label: addingAddress ? t('cancel') : t('add'), onPress: () => setAddingAddress((v) => !v) }}
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
            {addresses.length === 0 && !addingAddress ? <Text color="muted">{t('noAddressYet')}</Text> : null}
            {addingAddress ? (
              <View style={{ gap: spacing.sm, marginTop: spacing.sm }}>
                <Input label={t('addressLabel')} placeholder={t('addressLabelPlaceholder')} value={addrLabel} onChangeText={setAddrLabel} testID="input-address-label" />
                <Input label={t('addressStreet')} placeholder={t('addressStreetPlaceholder')} value={addrStreet} onChangeText={setAddrStreet} testID="input-address-street" />
                <Input label={t('addressDetails')} placeholder={t('addressDetailsPlaceholder')} value={addrDetails} onChangeText={setAddrDetails} testID="input-address-details" />
                <Button label={t('saveAddress')} onPress={saveAddress} loading={savingAddress} testID="button-save-address" />
              </View>
            ) : null}
            <View style={styles.mapPlaceholder}>
              <Text variant="caption" color="muted" align="center">
                {t('mapPlaceholder', { city: (city?.name ?? '').toUpperCase() })}
              </Text>
            </View>
          </Section>
        ) : activeMode === 'pickup' ? (
          <Section title={t('pickupTitle')}>
            <Text variant="body" color="muted">
              {t('pickupBody')}
            </Text>
            {/* Les consignes de retrait (`pickupInstructions`) vivent dans le document
                `restaurants/{rid}/settings/orders`, réservé au personnel du restaurant par les
                règles Firestore : le client n'y a pas accès, contrairement à la maquette qui les
                affiche (limitation documentée dans docs/CONTRAT_MODULES.md §10). */}
          </Section>
        ) : null}

        <Section title={t('whenTitle')}>
          <View style={styles.modeRow}>
            <ModeButton testID="button-timing-now" label={t('asap')} active={timing === 'now'} onPress={() => setTiming('now')} />
            <ModeButton testID="button-timing-later" label={t('schedule')} active={timing === 'later'} onPress={() => setTiming('later')} />
          </View>
          {timing === 'now' ? (
            <Text variant="caption" color="muted" style={{ marginTop: spacing.xs }}>
              {t('asapNote')}
            </Text>
          ) : (
            <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm }}>
              <View style={{ flex: 1 }}>
                <Input label={t('scheduledDateLabel')} placeholder="28/09/2026" value={scheduledDate} onChangeText={setScheduledDate} testID="input-scheduled-date" />
              </View>
              <View style={{ width: 110 }}>
                <Input label={t('scheduledTimeLabel')} placeholder="19:00" value={scheduledTime} onChangeText={setScheduledTime} />
              </View>
            </View>
          )}
        </Section>

        <Section title={t('paymentTitle')}>
          {walletBalanceCents > 0 ? (
            <View style={{ marginBottom: spacing.sm }}>
              <ModeButton
                testID="button-use-wallet"
                label={t('walletToggleLabel', { amount: money(walletBalanceCents) })}
                active={useWallet}
                onPress={() => setUseWallet((v) => !v)}
              />
            </View>
          ) : null}
          {walletCoversFull ? (
            <Text variant="caption" color="muted" testID="text-wallet-covers-full">
              {t('walletCoversFullNote')}
            </Text>
          ) : (
            <>
              <Text variant="caption" color="muted" style={{ marginBottom: spacing.sm }}>
                {t('paymentNote')}
              </Text>
              <View style={styles.modeRow}>
                {availableMethods.length === 0 ? <Text color="danger">{t('noPaymentAvailable')}</Text> : null}
                {acceptsCard ? <ModeButton testID="button-payment-card" label={t('paymentCard')} active={activeMethod === 'card'} onPress={() => setPaymentMethod('card')} /> : null}
                {acceptsCash ? <ModeButton testID="button-payment-cash" label={t('paymentCash')} active={activeMethod === 'cash'} onPress={() => setPaymentMethod('cash')} /> : null}
              </View>
              {activeMethod === 'card' ? (
                <View style={{ marginTop: spacing.md }}>
                  <Text variant="label" color="muted" style={{ marginBottom: spacing.xs }}>
                    {t('cardFieldLabel').toUpperCase()}
                  </Text>
                  <CardEntry onChange={setCardComplete} />
                </View>
              ) : null}
            </>
          )}
        </Section>

        <Section title={t('orderTitle')}>
          <Text variant="bodyStrong">
            {t('orderSummaryLine', { restaurant: restaurant?.name ?? '', count: cart.itemsCount })}
          </Text>
          {cart.lines.map((line) => (
            <Text key={line.lineId} variant="caption" color="muted" style={{ marginTop: 4 }}>
              {line.quantity} × {line.name} — {money((line.unitPriceCents + line.optionsPriceCents) * line.quantity)}
            </Text>
          ))}
          <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md }}>
            <View style={{ flex: 1 }}>
              <Input placeholder={t('promoPlaceholder')} autoCapitalize="characters" value={promoCode} onChangeText={setPromoCode} testID="input-checkout-promo" />
            </View>
            <Pressable style={styles.okButton} testID="button-checkout-apply-promo" onPress={() => toast.show(t('promoCheckedToast'))}>
              <Text variant="bodyStrong" style={{ color: colors.primaryFg }}>
                OK
              </Text>
            </Pressable>
          </View>
          <SummaryLine label={t('subtotal')} value={money(quote.subtotalCents)} />
          <SummaryLine label={t('delivery')} value={activeMode === 'delivery' ? (quote.deliveryFeeCents > 0 ? money(quote.deliveryFeeCents) : t('deliveryFree')) : t('notApplicable')} />
          <SummaryLine label={t('serviceFee')} value={money(quote.serviceFeeCents)} />
          {walletAppliedCents > 0 ? <SummaryLine label={t('walletAppliedLabel')} value={`-${money(walletAppliedCents)}`} /> : null}
          <View style={styles.totalRow}>
            <Text variant="title">{walletAppliedCents > 0 ? t('remainingToPay') : t('total')}</Text>
            <Text variant="title" color="primary">
              {money(remainingCents)}
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
        <Button label={t('confirmOrder')} onPress={onConfirm} loading={submitting} testID="button-place-order" />
        <Text variant="caption" color="subtle" align="center" style={{ marginTop: spacing.xs }}>
          {submittingLabel ?? t('fakeOrderNote')}
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
