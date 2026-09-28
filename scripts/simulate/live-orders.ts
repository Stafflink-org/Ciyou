// Simulateur de service : passe de vraies commandes via la Cloud Function
// placeOrder avec des clients de démonstration, puis fait rouler des livreurs
// simulés (positions GPS mises à jour en continu) jusqu'à la livraison.
//
//   npm run simulate:orders -- --restaurant mina-kitchen --count 5
//
// Options :
//   --restaurant <id>   établissement (obligatoire)
//   --count <n>         nombre de commandes (défaut 3)
//   --interval <s>      écart entre deux commandes, en secondes (défaut 25)
//   --mode <m>          delivery | pickup | mix (défaut mix)
//   --speed <x>         accélération des trajets des livreurs (défaut 1 = vitesse réelle)
//   --autopilot         le restaurant accepte et prépare seul (poste de démonstration)
//   --prep <min>        temps de préparation annoncé en pilote automatique (défaut et minimum 5)
//   --duration <min>    durée maximale de la simulation (défaut 45)
//   --no-orders         anime seulement les livreurs (commandes déjà passées)
//
// Prérequis : `npx tsx scripts/seed/only/r-commandes.ts` (clients et livreurs de
// démonstration). Les mots de passe des comptes simulés sont régénérés à chaque
// exécution et ne sont jamais enregistrés. Les commandes portent `test: true`.
import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  COLLECTIONS,
  DEFAULT_STAFF_ROLE_PERMISSIONS,
  FIREBASE_REGION,
  SUBCOLLECTIONS,
  encodeGeohash,
  formatPrice,
  haversineMeters,
  type CartLineInput,
  type Driver,
  type LatLng,
  type MenuOption,
  type OptionGroup,
  type Order,
  type PlaceOrderInput,
  type PlaceOrderResult,
  type Product,
  type Restaurant,
  type RestaurantMember,
} from '@golink/shared';
import { auth, db, PROJECT_ID } from '../lib/admin.mjs';
import { GeoPoint, Timestamp } from '../seed/lib';
import { SIM_CITIES, SIM_CLIENTS_PER_CITY, SIM_DRIVERS_PER_CITY, simClientUid, simDriverUid, type SimCity } from '../seed/only/r-commandes';

// ------------------------------------------------------------------ Paramètres

function arg(name: string, fallback?: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return fallback;
  const value = process.argv[index + 1];
  return value && !value.startsWith('--') ? value : fallback;
}
const flag = (name: string) => process.argv.includes(`--${name}`);

const restaurantId = arg('restaurant');
const count = Number(arg('count', '3'));
const intervalSeconds = Number(arg('interval', '25'));
const modeArg = arg('mode', 'mix') as 'delivery' | 'pickup' | 'mix';
const speedFactor = Math.max(0.2, Number(arg('speed', '1')));
const autopilot = flag('autopilot');
const autopilotPrep = Math.min(120, Math.max(5, Number(arg('prep', '5'))));
const durationMinutes = Number(arg('duration', '45'));
const placeOrders = !flag('no-orders');

const TICK_MS = 2000;
const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
const API_KEY = /apiKey:\s*'([^']+)'/.exec(readFileSync(`${repoRoot}apps/restaurant/src/lib/firebase.ts`, 'utf8'))?.[1] ?? '';

const log = (message: string) => console.log(`${new Date().toLocaleTimeString('fr-FR')}  ${message}`);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const pick = <T>(list: readonly T[]): T => list[Math.floor(Math.random() * list.length)] as T;

// ------------------------------------------------------------------ Comptes et appels

interface Session {
  uid: string;
  email: string;
  token: string;
  expiresAt: number;
}

/** Connexion d'un compte de démonstration (mot de passe aléatoire, régénéré à chaque exécution). */
async function signIn(uid: string): Promise<Session> {
  const user = await auth.getUser(uid);
  const email = user.email ?? '';
  const password = `${randomBytes(18).toString('base64url')}Aa1`;
  await auth.updateUser(uid, { password });
  const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${API_KEY}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  });
  const body = (await res.json()) as { idToken?: string; expiresIn?: string; error?: { message: string } };
  if (!body.idToken) throw new Error(`Connexion impossible (${email}) : ${body.error?.message ?? res.status}`);
  return { uid, email, token: body.idToken, expiresAt: Date.now() + (Number(body.expiresIn ?? 3600) - 300) * 1000 };
}

async function fresh(session: Session): Promise<Session> {
  if (Date.now() < session.expiresAt) return session;
  const renewed = await signIn(session.uid);
  Object.assign(session, renewed);
  return session;
}

/** Appel d'une Cloud Function « callable » avec le jeton du compte. */
async function call<T>(name: string, session: Session, data: unknown): Promise<T> {
  const s = await fresh(session);
  const res = await fetch(`https://${FIREBASE_REGION}-${PROJECT_ID}.cloudfunctions.net/${name}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${s.token}` },
    body: JSON.stringify({ data }),
  });
  const body = (await res.json().catch(() => ({}))) as { result?: T; error?: { message: string } };
  if (body.error || !res.ok) throw new Error(body.error?.message ?? `HTTP ${res.status}`);
  return body.result as T;
}

// ------------------------------------------------------------------ Trajets

/** Point à `meters` mètres dans la direction `bearing` (degrés). */
function offset(p: LatLng, meters: number, bearing: number): LatLng {
  const rad = (bearing * Math.PI) / 180;
  return {
    lat: p.lat + (meters * Math.cos(rad)) / 111_320,
    lng: p.lng + (meters * Math.sin(rad)) / (111_320 * Math.cos((p.lat * Math.PI) / 180)),
  };
}

function bearing(a: LatLng, b: LatLng): number {
  const y = Math.sin(((b.lng - a.lng) * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180);
  const x = Math.cos((a.lat * Math.PI) / 180) * Math.sin((b.lat * Math.PI) / 180) - Math.sin((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.cos(((b.lng - a.lng) * Math.PI) / 180);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

/**
 * Itinéraire urbain plausible : succession de rues orientées (quadrillage
 * légèrement tourné), avec de petites déviations, du départ à l'arrivée.
 */
function cityRoute(from: LatLng, to: LatLng): LatLng[] {
  const points: LatLng[] = [from];
  let current = from;
  const grid = 20 + Math.random() * 25;
  let guard = 0;
  while (haversineMeters(current, to) > 60 && guard < 30) {
    guard += 1;
    const direct = bearing(current, to);
    // Deux axes de rue possibles ; on prend le plus proche de la direction voulue.
    const axes = [grid, grid + 90, grid + 180, grid + 270];
    const axis = axes.reduce((best, a) => (Math.abs(((a - direct + 540) % 360) - 180) < Math.abs(((best - direct + 540) % 360) - 180) ? a : best), axes[0] as number);
    const remaining = haversineMeters(current, to);
    const leg = Math.min(remaining * (0.35 + Math.random() * 0.4), 120 + Math.random() * 380);
    current = offset(current, leg, axis + (Math.random() - 0.5) * 8);
    points.push(current);
  }
  points.push(to);
  return points;
}

const VEHICLE_SPEED: Partial<Record<Driver['vehicle']['type'], number>> = { bike: 4.2, e_bike: 5.4, cargo_bike: 4, scooter: 7, motorbike: 8.5, car: 7.5, on_foot: 1.4 };

interface Courier {
  session: Session;
  driver: Driver;
  position: LatLng;
  route: LatLng[];
  target: string | null;
  pauseTicks: number;
  busyAction: boolean;
}

async function writePosition(c: Courier, speedMs: number, heading: number): Promise<void> {
  await db.collection(COLLECTIONS.driverLocations).doc(c.session.uid).update({
    position: new GeoPoint(c.position.lat, c.position.lng),
    geohash: encodeGeohash(c.position),
    heading: Math.round(heading),
    speedKmh: Math.round(speedMs * 3.6),
    accuracyMeters: 5 + Math.round(Math.random() * 6),
    updatedAt: Timestamp.now(),
  });
}

/** Avance le livreur le long de son itinéraire pendant un pas de simulation. */
function advance(c: Courier, metersPerTick: number): { moved: boolean; heading: number } {
  let budget = metersPerTick;
  let heading = 0;
  while (budget > 0 && c.route.length > 0) {
    const next = c.route[0] as LatLng;
    const dist = haversineMeters(c.position, next);
    heading = bearing(c.position, next);
    if (dist <= budget) {
      c.position = next;
      c.route.shift();
      budget -= dist;
      // Feux et intersections : courtes pauses aléatoires.
      if (c.route.length > 0 && Math.random() < 0.18) {
        c.pauseTicks = 1 + Math.floor(Math.random() * 3);
        break;
      }
    } else {
      c.position = offset(c.position, budget, heading);
      budget = 0;
    }
  }
  return { moved: metersPerTick - budget > 0, heading };
}

// ------------------------------------------------------------------ Panier

async function buildCart(rid: string, minimumCents: number): Promise<CartLineInput[]> {
  const ref = db.collection(COLLECTIONS.restaurants).doc(rid);
  const [productsSnap, groupsSnap, optionsSnap] = await Promise.all([
    ref.collection(SUBCOLLECTIONS.restaurants.products).get(),
    ref.collection(SUBCOLLECTIONS.restaurants.optionGroups).get(),
    ref.collection(SUBCOLLECTIONS.restaurants.options).get(),
  ]);
  const groups = new Map(groupsSnap.docs.map((d) => [d.id, d.data() as OptionGroup]));
  const options = new Map(optionsSnap.docs.map((d) => [d.id, d.data() as MenuOption]));
  const products = productsSnap.docs
    .map((d) => ({ id: d.id, ...(d.data() as Product) }))
    .filter((p) => p.available && !p.containsAlcohol && (p.stock === null || p.stock === undefined || p.stock > 2));
  if (products.length === 0) throw new Error('Aucun produit disponible dans cet établissement.');
  const lines: CartLineInput[] = [];
  const wanted = 1 + Math.floor(Math.random() * 3);
  const chosen = new Set<string>();
  let subtotal = 0;
  // Au moins `wanted` lignes, et assez pour atteindre le minimum de commande.
  for (let i = 0; (i < wanted || subtotal < minimumCents + 300) && i < 12; i += 1) {
    const product = pick(products);
    if (chosen.has(product.id)) continue;
    chosen.add(product.id);
    subtotal += product.priceCents;
    const lineOptions: NonNullable<CartLineInput['options']> = [];
    for (const groupId of product.optionGroupIds) {
      const group = groups.get(groupId);
      if (!group?.enabled) continue;
      const available = group.optionIds.filter((id) => options.get(id)?.enabled);
      const n = Math.min(available.length, Math.max(group.min, Math.random() < 0.35 ? 1 : 0), group.max);
      for (const optionId of [...available].sort(() => Math.random() - 0.5).slice(0, n)) lineOptions.push({ optionId, groupId });
    }
    lines.push({
      productId: product.id,
      quantity: Math.random() < 0.8 ? 1 : 2,
      options: lineOptions,
      comment: Math.random() < 0.15 ? pick(['Sans oignon, merci.', 'Sauce à part s’il vous plaît.', 'Bien cuit.']) : null,
    });
  }
  return lines;
}

// ------------------------------------------------------------------ Programme

async function main(): Promise<void> {
  if (!restaurantId) throw new Error('Précisez l’établissement : --restaurant <id>');
  if (!API_KEY) throw new Error('Clé web Firebase introuvable.');
  const restaurantSnap = await db.collection(COLLECTIONS.restaurants).doc(restaurantId).get();
  if (!restaurantSnap.exists) throw new Error(`Établissement inconnu : ${restaurantId}`);
  const restaurant = restaurantSnap.data() as Restaurant;
  const city = restaurant.cityId as SimCity;
  if (!SIM_CITIES.includes(city)) throw new Error(`Pas de comptes de démonstration pour la ville ${restaurant.cityId}.`);
  const origin: LatLng = restaurant.address.geo ? { lat: restaurant.address.geo.latitude, lng: restaurant.address.geo.longitude } : { lat: 0, lng: 0 };
  const deadline = Date.now() + durationMinutes * 60_000;
  log(`Simulation Ciyou Eats · ${restaurant.name} (${restaurant.cityId}) · ${placeOrders ? `${count} commande(s)` : 'livreurs seulement'}${autopilot ? ' · pilote automatique' : ''}`);
  if (!restaurant.isOpen) log('Attention : l’établissement a mis ses commandes en pause, placeOrder les refusera.');

  // Livreurs simulés : connexion, mise en ligne près du restaurant.
  const couriers: Courier[] = [];
  for (let i = 0; i < SIM_DRIVERS_PER_CITY; i += 1) {
    const uid = simDriverUid(city, i);
    const driverSnap = await db.collection(COLLECTIONS.drivers).doc(uid).get();
    if (!driverSnap.exists) throw new Error('Livreurs de démonstration absents : lancez d’abord scripts/seed/only/r-commandes.ts');
    const session = await signIn(uid);
    const driver = driverSnap.data() as Driver;
    const locSnap = await db.collection(COLLECTIONS.driverLocations).doc(uid).get();
    const loc = locSnap.get('position') as { latitude: number; longitude: number } | undefined;
    const position = driver.activeOrderIds.length > 0 && loc ? { lat: loc.latitude, lng: loc.longitude } : offset(origin, 700 + Math.random() * 1300, Math.random() * 360);
    const now = Timestamp.now();
    await db.collection(COLLECTIONS.drivers).doc(uid).update({ availability: driver.activeOrderIds.length > 0 ? 'on_delivery' : 'online', lastSeenAt: now, updatedAt: now });
    await db.collection(COLLECTIONS.driverLocations).doc(uid).update({
      availability: driver.activeOrderIds.length > 0 ? 'on_delivery' : 'online',
      position: new GeoPoint(position.lat, position.lng),
      geohash: encodeGeohash(position),
      updatedAt: now,
    });
    couriers.push({ session, driver, position, route: [], target: null, pauseTicks: 0, busyAction: false });
  }
  log(`${couriers.length} livreurs en ligne autour du restaurant.`);

  // Poste de pilote automatique (membre temporaire de l'établissement).
  let pilot: Session | null = null;
  const pilotUid = `sim-pilote-${restaurantId}`;
  if (autopilot) {
    const email = `sim.pilote.${restaurantId}@golink.test`;
    try {
      await auth.getUser(pilotUid);
    } catch {
      await auth.createUser({ uid: pilotUid, email, displayName: 'Poste de démonstration', emailVerified: true });
    }
    const member: RestaurantMember & { test: true } = {
      uid: pilotUid,
      restaurantId,
      groupId: restaurant.groupId ?? null,
      displayName: 'Poste de démonstration',
      email,
      role: 'kitchen',
      customRoleId: null,
      permissions: [...DEFAULT_STAFF_ROLE_PERMISSIONS.kitchen],
      active: true,
      onDuty: false,
      employeeId: null,
      invitedBy: 'system',
      invitedAt: Timestamp.now(),
      joinedAt: Timestamp.now(),
      lastAccessAt: null,
      test: true,
    };
    await db.collection(COLLECTIONS.restaurants).doc(restaurantId).collection(SUBCOLLECTIONS.restaurants.members).doc(pilotUid).set(member);
    pilot = await signIn(pilotUid);
    log('Pilote automatique prêt : acceptation, préparation et remise au comptoir simulées.');
  }

  const placed = new Set<string>();
  let stopping = false;
  const shutdown = async () => {
    if (stopping) return;
    stopping = true;
    log('Arrêt : livreurs libres mis hors ligne…');
    for (const c of couriers) {
      const d = (await db.collection(COLLECTIONS.drivers).doc(c.session.uid).get()).data() as Driver;
      if (d.activeOrderIds.length === 0) {
        await db.collection(COLLECTIONS.drivers).doc(c.session.uid).update({ availability: 'offline', updatedAt: Timestamp.now() });
        await db.collection(COLLECTIONS.driverLocations).doc(c.session.uid).update({ availability: 'offline', visibleTo: [], updatedAt: Timestamp.now() });
      }
    }
    if (autopilot) await db.collection(COLLECTIONS.restaurants).doc(restaurantId).collection(SUBCOLLECTIONS.restaurants.members).doc(pilotUid).delete();
    log('Simulation terminée.');
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown());

  // Passage des commandes (en parallèle de l'animation des livreurs).
  const ordering = (async () => {
    if (!placeOrders) return;
    const modes = restaurant.fulfillmentModes.filter((m) => m === 'delivery' || m === 'pickup');
    for (let i = 0; i < count; i += 1) {
      const clientUid = simClientUid(city, Math.floor(Math.random() * SIM_CLIENTS_PER_CITY));
      try {
        const session = await signIn(clientUid);
        const fulfillment = modeArg === 'mix' ? (Math.random() < 0.72 || !modes.includes('pickup') ? 'delivery' : 'pickup') : modeArg;
        // Espèces seulement avec un livreur salarié du commerce (décision client).
        const cash = fulfillment === 'delivery' && restaurant.deliveredBy === 'restaurant' && restaurant.acceptedPaymentMethods.includes('cash') && Math.random() < 0.3;
        const input: PlaceOrderInput = {
          restaurantId,
          fulfillment,
          lines: await buildCart(restaurantId, restaurant.minOrderCents ?? 0),
          addressId: fulfillment === 'delivery' ? pick(['domicile', 'travail']) : null,
          paymentMethod: cash ? 'cash' : 'card',
          paymentMethodId: cash ? null : 'pm_card_visa',
          tipCents: fulfillment === 'delivery' && !cash && Math.random() < 0.4 ? pick([100, 200, 300]) : 0,
          customerNote: Math.random() < 0.2 ? pick(['Merci de sonner deux fois.', 'Laisser au gardien si absent.', 'Code porte 4B21.']) : null,
          source: pick(['client_ios', 'client_android', 'client_web'] as const),
          clientRequestId: `sim-${randomUUID()}`,
        };
        const result = await call<PlaceOrderResult>('placeOrder', session, input);
        placed.add(result.orderId);
        log(`Commande ${result.number} passée (${fulfillment === 'delivery' ? 'livraison' : 'à emporter'}, ${cash ? 'espèces' : 'carte de test'}) · ${formatPrice(result.totalCents)}`);
      } catch (error) {
        log(`Commande refusée : ${error instanceof Error ? error.message : String(error)}`);
      }
      if (i < count - 1) await sleep(intervalSeconds * 1000);
    }
  })();

  // Boucle des livreurs et du pilote automatique.
  const readyAt = new Map<string, number>();
  // Actions du pilote déjà effectuées (commande + étape), pour ne pas les rejouer.
  const handled = new Set<string>();
  while (Date.now() < deadline && !stopping) {
    await sleep(TICK_MS);
    for (const c of couriers) {
      if (c.busyAction) continue;
      const d = (await db.collection(COLLECTIONS.drivers).doc(c.session.uid).get()).data() as Driver;
      const orderId = d.activeOrderIds[0];
      if (!orderId) {
        // Attente près du restaurant, léger déplacement.
        if (Math.random() < 0.15) {
          c.position = offset(c.position, 10 + Math.random() * 25, Math.random() * 360);
          await writePosition(c, 1.5, 0);
        }
        c.target = null;
        continue;
      }
      const order = (await db.collection(COLLECTIONS.orders).doc(orderId).get()).data() as Order;
      const pickedUp = order.status === 'picked_up';
      const destination = pickedUp && order.delivery ? { lat: order.delivery.geo.latitude, lng: order.delivery.geo.longitude } : origin;
      const targetKey = `${orderId}:${pickedUp ? 'client' : 'restaurant'}`;
      if (c.target !== targetKey) {
        c.target = targetKey;
        c.route = cityRoute(c.position, destination);
        log(`${c.driver.firstName} ${pickedUp ? `part livrer ${order.number}` : `se dirige vers le restaurant pour ${order.number}`}.`);
      }
      if (c.pauseTicks > 0) {
        c.pauseTicks -= 1;
        await writePosition(c, 0, 0);
        continue;
      }
      if (c.route.length > 0) {
        const speed = (VEHICLE_SPEED[c.driver.vehicle.type] ?? 5) * speedFactor;
        const { heading } = advance(c, speed * (TICK_MS / 1000));
        await writePosition(c, speed, heading);
        continue;
      }
      // Arrivé à destination.
      c.busyAction = true;
      try {
        if (!pickedUp && (order.status === 'ready' || order.status === 'assigned')) {
          await call('markOrderPickedUp', c.session, { orderId });
          log(`${c.driver.firstName} a récupéré ${order.number}.`);
        } else if (pickedUp && haversineMeters(c.position, destination) < 80) {
          await sleep(4000);
          await call('completeOrder', c.session, { orderId, code: order.delivery?.handoverCodeRequired ? order.pickupCode : null });
          log(`${order.number} livrée par ${c.driver.firstName}.`);
          c.target = null;
        }
      } catch (error) {
        log(`${c.driver.firstName} : ${error instanceof Error ? error.message : String(error)}`);
      } finally {
        c.busyAction = false;
      }
    }

    if (pilot) {
      const snap = await db
        .collection(COLLECTIONS.orders)
        .where('restaurantId', '==', restaurantId)
        .where('status', 'in', ['new', 'preparing', 'ready'])
        .orderBy('createdAt', 'desc')
        .limit(30)
        .get();
      for (const doc of snap.docs) {
        const o = doc.data() as Order;
        if (!o.test || handled.has(`${doc.id}:${o.status}`)) continue;
        const age = Date.now() - o.updatedAt.toMillis();
        try {
          if (o.status === 'new' && age > 12_000) {
            handled.add(`${doc.id}:new`);
            await call('acceptOrder', pilot, { orderId: doc.id, prepMinutes: autopilotPrep });
            log(`Poste de démonstration : ${o.number} acceptée (${autopilotPrep} min).`);
          } else if (o.status === 'preparing' && o.timeline.preparing && Date.now() > o.timeline.preparing.toMillis() + (o.prepMinutes + o.prepExtendedMinutes) * 60_000) {
            handled.add(`${doc.id}:preparing`);
            await call('markOrderReady', pilot, { orderId: doc.id });
            readyAt.set(doc.id, Date.now());
            log(`Poste de démonstration : ${o.number} prête.`);
          } else if (o.status === 'ready' && o.fulfillment === 'pickup' && Date.now() - (readyAt.get(doc.id) ?? o.updatedAt.toMillis()) > 20_000 && o.pickupCode) {
            handled.add(`${doc.id}:ready`);
            await call('confirmPickup', pilot, { orderId: doc.id, code: o.pickupCode });
            log(`Poste de démonstration : ${o.number} remise au client (code vérifié).`);
          }
        } catch (error) {
          log(`Poste de démonstration : ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }

    // Animation seule : fin quand plus aucun livreur simulé n'a de course.
    if (!placeOrders) {
      const busy = await Promise.all(couriers.map((c) => db.collection(COLLECTIONS.drivers).doc(c.session.uid).get()));
      if (busy.every((d) => ((d.get('activeOrderIds') as string[] | undefined) ?? []).length === 0)) {
        log('Plus aucune course en cours.');
        break;
      }
    }
    // Fin : toutes les commandes passées sont clôturées.
    if (placeOrders && placed.size > 0 && placed.size >= count) {
      const states = await Promise.all([...placed].map((id) => db.collection(COLLECTIONS.orders).doc(id).get()));
      if (states.every((s) => ['delivered', 'cancelled'].includes((s.data() as Order).status))) {
        log('Toutes les commandes simulées sont clôturées.');
        break;
      }
    }
  }
  await ordering;
  await shutdown();
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
