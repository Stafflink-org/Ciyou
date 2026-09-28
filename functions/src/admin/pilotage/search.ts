// Recherche universelle du super admin (cahier §2) : numéro de commande, nom,
// e-mail, téléphone, SIRET, numéro de facture ou de ticket. Résultats groupés par
// type, limités aux rubriques et aux villes que l'administrateur peut consulter ;
// coordonnées masquées sans le droit `personal_data.view`.
import {
  COLLECTIONS,
  RESTAURANT_PRIVATE_DOCS,
  SUBCOLLECTIONS,
  adminHasPermission,
  formatTicketNumber,
  maskEmail,
  maskPhone,
  normalizeText,
  parseOrderNumber,
  type AdminPermission,
  type AdminUser,
  type Driver,
  type GlobalSearchHit,
  type GlobalSearchResult,
  type Invoice,
  type Order,
  type Restaurant,
  type SearchHitType,
  type SupportTicket,
  type UserProfile,
} from '@golink/shared';
import { logger } from 'firebase-functions/v2';
import { db } from '../../lib/admin';
import { requireAdmin } from '../../lib/permissions';
import { z } from '../../lib/validation';
import { pilotageCallable } from './runtime';
import { loadMarkets, type CityInfo } from './scope';

const GROUP_PERMISSIONS: Record<SearchHitType, AdminPermission> = {
  order: 'orders.view',
  restaurant: 'restaurants.view',
  client: 'customers.view',
  driver: 'drivers.view',
  invoice: 'invoices.view',
  ticket: 'support.view',
};

const toIso = (value: { toDate(): Date } | null | undefined) => (value ? value.toDate().toISOString() : null);
const compact = (value: string) => normalizeText(value).replace(/[\s.+()-]/g, '');
const digitsOf = (value: string) => value.replace(/\D/g, '');

interface Context {
  admin: AdminUser;
  can: (permission: AdminPermission) => boolean;
  allowedCity: (cityId: string | null | undefined) => boolean;
  showPersonal: boolean;
  cities: Map<string, CityInfo>;
  limit: number;
}

function cityLabel(ctx: Context, cityId: string | null | undefined): string | null {
  return cityId ? (ctx.cities.get(cityId)?.name ?? cityId) : null;
}

/** Mot-clé indexé le plus sélectif pour `array-contains`, et mots restants à vérifier. */
function keywordPlan(query: string): { key: string; rest: string[] } | null {
  const normalized = normalizeText(query);
  const words = normalized.split(/[\s,@.'’-]+/).filter((w) => w.length >= 2);
  const whole = compact(query);
  if (/[@+]/.test(query) || /^\+?[\d\s.()-]{6,}$/.test(query.trim())) {
    // E-mail ou téléphone : forme compacte complète (indexée telle quelle, 30 caractères).
    if (whole.length >= 2) return { key: whole.slice(0, 30), rest: [] };
  }
  if (!words.length) return whole.length >= 2 ? { key: whole.slice(0, 15), rest: [] } : null;
  const sorted = [...words].sort((a, b) => b.length - a.length);
  const key = (sorted[0] ?? '').slice(0, 15);
  return { key, rest: words.filter((w) => w !== sorted[0]).map((w) => w.slice(0, 15)) };
}

function matchesRest(keywords: string[] | undefined, rest: string[]): boolean {
  if (!rest.length) return true;
  const set = new Set(keywords ?? []);
  return rest.every((word) => set.has(word));
}

async function searchOrders(ctx: Context, query: string): Promise<GlobalSearchHit[]> {
  const number = parseOrderNumber(query);
  let docs: FirebaseFirestore.QueryDocumentSnapshot[] = [];
  if (number) {
    docs = (await db.collection(COLLECTIONS.orders).where('number', '==', number).limit(5).get()).docs;
  }
  if (!docs.length) {
    const plan = keywordPlan(query);
    if (!plan) return [];
    const snap = await db
      .collection(COLLECTIONS.orders)
      .where('searchKeywords', 'array-contains', plan.key)
      .orderBy('createdAt', 'desc')
      .limit(80)
      .get();
    docs = snap.docs.filter((doc) => matchesRest(doc.get('searchKeywords') as string[], plan.rest));
  }
  return docs
    .map((doc) => ({ id: doc.id, order: doc.data() as Order }))
    .filter(({ order }) => ctx.allowedCity(order.cityId))
    .slice(0, ctx.limit)
    .map(({ id, order }) => ({
      type: 'order' as const,
      id,
      title: `${order.number} · ${order.restaurantName}`,
      subtitle: [order.customerName, cityLabel(ctx, order.cityId), `${(order.amounts.totalCents / 100).toFixed(2).replace('.', ',')} €`].filter(Boolean).join(' · '),
      status: order.status,
      matched: null,
      cityId: order.cityId,
      at: toIso(order.createdAt),
    }));
}

async function searchRestaurants(ctx: Context, query: string): Promise<GlobalSearchHit[]> {
  const hits = new Map<string, GlobalSearchHit>();
  const digits = digitsOf(query);
  // SIRET (14 chiffres) ou SIREN (9 chiffres) : fiches légales des restaurants du périmètre.
  if ((digits.length === 14 || digits.length === 9) && digits.length === query.replace(/[\s.]/g, '').length) {
    const restaurants = await db.collection(COLLECTIONS.restaurants).select('name', 'cityId', 'status').limit(3000).get();
    const allowed = restaurants.docs.filter((doc) => ctx.allowedCity(doc.get('cityId') as string));
    for (let i = 0; i < allowed.length && hits.size < ctx.limit; i += 200) {
      const slice = allowed.slice(i, i + 200);
      const legal = await db.getAll(
        ...slice.map((doc) => doc.ref.collection(SUBCOLLECTIONS.restaurants.private).doc(RESTAURANT_PRIVATE_DOCS.legal)),
      );
      legal.forEach((snap, index) => {
        const siret = digitsOf(String(snap.get('siret') ?? ''));
        if (!siret || !siret.startsWith(digits)) return;
        const doc = slice[index]!;
        hits.set(doc.id, {
          type: 'restaurant',
          id: doc.id,
          title: String(doc.get('name')),
          subtitle: [cityLabel(ctx, doc.get('cityId') as string), snap.get('legalName') as string | undefined].filter(Boolean).join(' · '),
          status: doc.get('status') as string,
          matched: `SIRET ${String(snap.get('siret'))}`,
          cityId: doc.get('cityId') as string,
          at: null,
        });
      });
    }
  }
  const plan = keywordPlan(query);
  if (plan && hits.size < ctx.limit) {
    const snap = await db.collection(COLLECTIONS.restaurants).where('searchKeywords', 'array-contains', plan.key).limit(40).get();
    for (const doc of snap.docs) {
      const r = doc.data() as Restaurant;
      if (!matchesRest(r.searchKeywords, plan.rest) || !ctx.allowedCity(r.cityId) || hits.has(doc.id)) continue;
      hits.set(doc.id, {
        type: 'restaurant',
        id: doc.id,
        title: r.name,
        subtitle: [cityLabel(ctx, r.cityId), r.planCode ? `Formule ${r.planCode.charAt(0).toUpperCase()}${r.planCode.slice(1)}` : null].filter(Boolean).join(' · '),
        status: r.status,
        matched: contactMatch(ctx, query, r.email, r.phone),
        cityId: r.cityId,
        at: null,
      });
    }
  }
  // Recherche par e-mail de contact exacte (dépasse la limite de préfixe de 15 caractères indexée ci-dessus).
  if (query.includes('@') && hits.size < ctx.limit) {
    const snap = await db.collection(COLLECTIONS.restaurants).where('email', '==', query.trim().toLowerCase()).limit(5).get();
    for (const doc of snap.docs) {
      const r = doc.data() as Restaurant;
      if (!ctx.allowedCity(r.cityId) || hits.has(doc.id)) continue;
      hits.set(doc.id, {
        type: 'restaurant',
        id: doc.id,
        title: r.name,
        subtitle: cityLabel(ctx, r.cityId),
        status: r.status,
        matched: ctx.showPersonal ? query.trim().toLowerCase() : maskEmail(query.trim().toLowerCase()),
        cityId: r.cityId,
        at: null,
      });
    }
  }
  return [...hits.values()].slice(0, ctx.limit);
}

function contactMatch(ctx: Context, query: string, email: string | null | undefined, phone: string | null | undefined): string | null {
  const q = compact(query);
  if (email && compact(email).includes(q) && query.includes('@')) return ctx.showPersonal ? email : maskEmail(email);
  const digits = digitsOf(query);
  if (phone && digits.length >= 6 && digitsOf(phone).includes(digits.replace(/^0/, ''))) return ctx.showPersonal ? phone : maskPhone(phone);
  return null;
}

async function searchClients(ctx: Context, query: string): Promise<GlobalSearchHit[]> {
  const plans = [keywordPlan(query)];
  const digits = digitsOf(query);
  // Numéro national (06…) : essai aussi au format international français et luxembourgeois.
  if (/^0\d{8,}$/.test(digits)) plans.push({ key: `33${digits.slice(1)}`, rest: [] }, { key: `352${digits.slice(1)}`, rest: [] });
  const seen = new Map<string, GlobalSearchHit>();
  for (const plan of plans) {
    if (!plan || seen.size >= ctx.limit) continue;
    const snap = await db.collection(COLLECTIONS.users).where('searchKeywords', 'array-contains', plan.key).limit(40).get();
    for (const doc of snap.docs) {
      const u = doc.data() as UserProfile;
      if (u.role !== 'client' || seen.has(doc.id) || !matchesRest(u.searchKeywords, plan.rest)) continue;
      if (!ctx.allowedCity(u.cityId ?? null) && !(ctx.admin.cityIds.length === 0 && ctx.admin.countryIds.length === 0)) continue;
      seen.set(doc.id, {
        type: 'client',
        id: doc.id,
        title: u.displayName,
        subtitle: [ctx.showPersonal ? u.email : maskEmail(u.email), cityLabel(ctx, u.cityId ?? null), `${u.stats?.ordersCount ?? 0} commande${(u.stats?.ordersCount ?? 0) > 1 ? 's' : ''}`]
          .filter(Boolean)
          .join(' · '),
        status: u.status,
        matched: contactMatch(ctx, query, u.email, u.phone),
        cityId: u.cityId ?? null,
        at: toIso(u.createdAt),
      });
    }
  }
  return [...seen.values()].slice(0, ctx.limit);
}

async function searchDrivers(ctx: Context, query: string): Promise<GlobalSearchHit[]> {
  const plans = [keywordPlan(query)];
  const digits = digitsOf(query);
  // Numéro national (0…) : essai aussi au format international français et luxembourgeois (livreurs +352).
  if (/^0\d{8,}$/.test(digits)) plans.push({ key: `33${digits.slice(1)}`, rest: [] }, { key: `352${digits.slice(1)}`, rest: [] });
  const seen = new Map<string, GlobalSearchHit>();
  for (const plan of plans) {
    if (!plan) continue;
    const snap = await db.collection(COLLECTIONS.drivers).where('searchKeywords', 'array-contains', plan.key).limit(40).get();
    for (const doc of snap.docs) {
      const d = doc.data() as Driver;
      if (seen.has(doc.id) || !matchesRest(d.searchKeywords, plan.rest) || !ctx.allowedCity(d.cityId)) continue;
      seen.set(doc.id, {
        type: 'driver',
        id: doc.id,
        title: `${d.firstName} ${d.lastName}`.trim() || d.displayName,
        subtitle: [cityLabel(ctx, d.cityId), d.type === 'restaurant' ? 'Livreur du commerce' : 'Livreur Ciyou Eats', `${d.stats?.deliveries ?? 0} livraisons`].filter(Boolean).join(' · '),
        status: d.status,
        matched: contactMatch(ctx, query, d.email, d.phone),
        cityId: d.cityId,
        at: null,
      });
    }
  }
  return [...seen.values()].slice(0, ctx.limit);
}

async function searchInvoices(ctx: Context, query: string): Promise<GlobalSearchHit[]> {
  const upper = query.trim().toUpperCase().replace(/\s+/g, '');
  if (upper.length < 4 || !/\d/.test(upper)) return [];
  const exact = await db.collection(COLLECTIONS.invoices).where('number', '==', upper).limit(3).get();
  let docs = exact.docs;
  if (!docs.length && /^[A-Z]{2}-/.test(upper)) {
    docs = (await db.collection(COLLECTIONS.invoices).where('number', '>=', upper).where('number', '<', `${upper}`).limit(ctx.limit).get()).docs;
  }
  return docs
    .map((doc) => ({ id: doc.id, inv: doc.data() as Invoice }))
    .filter(({ inv }) => !inv.cityId || ctx.allowedCity(inv.cityId))
    .slice(0, ctx.limit)
    .map(({ id, inv }) => ({
      type: 'invoice' as const,
      id,
      title: inv.number,
      subtitle: [inv.recipient?.name, `${(inv.totalTtcCents / 100).toFixed(2).replace('.', ',')} € TTC`].filter(Boolean).join(' · '),
      status: inv.status,
      matched: null,
      cityId: inv.cityId ?? null,
      at: toIso(inv.issuedAt),
    }));
}

async function searchTickets(ctx: Context, query: string): Promise<GlobalSearchHit[]> {
  const match = query.trim().toUpperCase().match(/^#?T[\s-]?(\d{1,8})$/);
  if (!match) return [];
  const snap = await db.collection(COLLECTIONS.supportTickets).where('number', '==', formatTicketNumber(Number(match[1]))).limit(3).get();
  return snap.docs
    .map((doc) => ({ id: doc.id, t: doc.data() as SupportTicket }))
    .filter(({ t }) => ctx.allowedCity(t.cityId ?? null) || !t.cityId)
    .map(({ id, t }) => ({
      type: 'ticket' as const,
      id,
      title: `${t.number} · ${t.subject}`,
      subtitle: [t.requesterName, cityLabel(ctx, t.cityId ?? null)].filter(Boolean).join(' · '),
      status: t.status,
      matched: null,
      cityId: t.cityId ?? null,
      at: toIso(t.createdAt),
    }));
}

const SEARCHERS: Record<SearchHitType, (ctx: Context, query: string) => Promise<GlobalSearchHit[]>> = {
  order: searchOrders,
  restaurant: searchRestaurants,
  client: searchClients,
  driver: searchDrivers,
  invoice: searchInvoices,
  ticket: searchTickets,
};

export const globalSearch = pilotageCallable(
  z.object({ query: z.string().trim().min(2, 'Saisissez au moins 2 caractères').max(80), limit: z.number().int().min(1).max(20).optional() }),
  async (data, request): Promise<GlobalSearchResult> => {
    const started = Date.now();
    const { admin } = await requireAdmin(request, 'search.use');
    const markets = await loadMarkets();
    const cityScoped = admin.role !== 'super_admin' && admin.cityIds.length > 0;
    const countryScoped = admin.role !== 'super_admin' && admin.countryIds.length > 0;
    const ctx: Context = {
      admin,
      can: (permission) => adminHasPermission(admin, permission),
      allowedCity: (cityId) => {
        if (!cityScoped && !countryScoped) return true;
        if (!cityId) return false;
        if (cityScoped && !admin.cityIds.includes(cityId)) return false;
        const country = markets.cities.get(cityId)?.countryId;
        return !countryScoped || Boolean(country && admin.countryIds.includes(country));
      },
      showPersonal: adminHasPermission(admin, 'personal_data.view'),
      cities: markets.cities,
      limit: data.limit ?? 6,
    };
    const types = (Object.keys(SEARCHERS) as SearchHitType[]).filter((type) => ctx.can(GROUP_PERMISSIONS[type]));
    const results = await Promise.all(
      types.map(async (type) => ({
        type,
        hits: await SEARCHERS[type](ctx, data.query).catch((error: unknown) => {
          logger.warn('Recherche partielle en échec', { type, error: error instanceof Error ? error.message : String(error) });
          return [] as GlobalSearchHit[];
        }),
      })),
    );
    return { query: data.query, groups: results.filter((group) => group.hits.length > 0), tookMs: Date.now() - started };
  },
);
