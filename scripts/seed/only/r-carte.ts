// Données complémentaires du module « carte » (Produits & menu, Options, Stocks,
// Produits mis en avant) pour les établissements du groupe Maison Haddad :
// ordre de vitrine, badges, étiquettes, créneaux, galerie photo, suivi de stock
// (dont une rupture et des stocks faibles) et historique des mouvements de stock.
//
// Idempotent : identifiants stables, écritures en fusion sur les produits et sections,
// mouvements « rc-… » remplacés. Chaque document créé porte `seed: true`.
//
//   npx tsx scripts/seed/only/r-carte.ts --dry-run   (affiche sans écrire)
//   npx tsx scripts/seed/only/r-carte.ts
import { Timestamp } from '@google-cloud/firestore';
import { COLLECTIONS, SUBCOLLECTIONS, type ManualStockReason, type MenuSchedule, type ProductBadge, type StockMovement } from '@golink/shared';
import { db } from '../../lib/admin.mjs';
import { account } from '../accounts';
import { unsplash } from '../catalog';

const DRY_RUN = process.argv.includes('--dry-run');
const DAY = 86_400_000;

interface ProductPlan {
  badge?: ProductBadge;
  tags?: string[];
  schedule?: MenuSchedule;
  /** Stock final (null = non suivi) et seuil d'alerte. */
  stock?: number | null;
  threshold?: number;
  /** Photos supplémentaires (identifiants Unsplash). */
  gallery?: string[];
  /** Historique : mouvements du plus ancien au plus récent (variation, motif, âge en jours, note). */
  history?: Array<[number, ManualStockReason | 'order', number, string?]>;
}

interface RestaurantPlan {
  featured: string[];
  products: Record<string, ProductPlan>;
  sections?: Record<string, { availability: MenuSchedule | null; description?: string }>;
}

const LUNCH: MenuSchedule = { days: [0, 1, 2, 3, 4], from: '11:30', to: '14:30' };
const MORNING: MenuSchedule = { days: [0, 1, 2, 3, 4, 5, 6], from: '07:30', to: '11:30' };
const WEEKEND_BRUNCH = { days: [5, 6], from: '09:30', to: '14:30' };

const PLANS: Record<string, RestaurantPlan> = {
  'mina-kitchen': {
    featured: ['p1', 'p4', 'p8', 'p2'],
    sections: {
      s1: { availability: null, description: 'À partager, ou pas : houmous, moutabal, falafels et salades du Levant.' },
      s3: { availability: LUNCH, description: 'Wraps servis le midi en semaine, pain cuit minute.' },
    },
    products: {
      p1: { badge: 'popular', tags: ['best-seller', 'végétarien'], stock: 40, threshold: 8, gallery: ['1546069901-ba9599a7e63c'], history: [[30, 'reception', 6, 'Livraison pois chiches bio'], [-12, 'order', 4], [-3, 'waste', 3, 'Bac tombé en préparation'], [-9, 'order', 1]] },
      p4: { badge: 'chef', tags: ['à partager'], stock: 14, threshold: 4, history: [[20, 'reception', 5], [-6, 'order', 2]] },
      p8: { badge: 'homemade', tags: ['halal'], stock: 28, threshold: 6, gallery: ['1603133872878-684f208fb84b'], history: [[40, 'inventory', 7, 'Inventaire mensuel'], [-8, 'order', 3], [-4, 'order', 1]] },
      p9: { tags: ['halal'], schedule: LUNCH },
      p10: { stock: 18, threshold: 5, history: [[25, 'reception', 4], [-7, 'order', 1]] },
      p17: { badge: 'homemade', stock: 4, threshold: 6, history: [[24, 'reception', 8], [-14, 'order', 3], [-6, 'order', 1]] },
      p18: { stock: 0, threshold: 4, history: [[12, 'reception', 5], [-9, 'order', 2], [-3, 'order', 0]] },
      p19: { badge: 'new', stock: 3, threshold: 5, history: [[20, 'reception', 6], [-15, 'order', 2], [-2, 'order', 0]] },
      p13: { tags: ['halal'], schedule: LUNCH },
      p14: { tags: ['végétarien'], schedule: LUNCH },
    },
  },
  'lune-coffee': {
    featured: ['p10400', 'p10401', 'p10402'],
    sections: {
      s3: { availability: MORNING, description: 'Servi chaque matin jusqu’à 11 h 30.' },
      s4: { availability: WEEKEND_BRUNCH, description: 'Le brunch du week-end, de 9 h 30 à 14 h 30.' },
    },
    products: {
      p10400: { badge: 'popular', tags: ['viennoiserie'], threshold: 4, history: [[24, 'reception', 3, 'Fournée du matin'], [-12, 'order', 2]] },
      p10401: { badge: 'homemade', threshold: 5, history: [[30, 'reception', 5], [-11, 'order', 1]] },
      p10405: { threshold: 6, history: [[30, 'reception', 2, 'Fournée du matin'], [-4, 'waste', 1, 'Invendus de la veille'], [-3, 'order', 0]] },
      p10407: { stock: null },
      p10408: { stock: null },
    },
  },
  'onda-pasta-club': {
    featured: ['p10202', 'p10200', 'p10201', 'p10203'],
    sections: { s1: { availability: null, description: 'Pâtes fraîches façonnées chaque matin.' } },
    products: {
      p10200: { badge: 'popular', tags: ['pâtes fraîches'], threshold: 4 },
      p10202: { badge: 'chef', tags: ['végétarien', 'pâtes fraîches'], threshold: 6, history: [[30, 'reception', 3], [-6, 'order', 1]] },
      p10203: { badge: 'seasonal', tags: ['dimanche'], threshold: 5 },
      p10210: { stock: 8, threshold: 10, history: [[12, 'reception', 4], [-4, 'order', 1]] },
    },
  },
};

async function main(): Promise<void> {
  const now = Date.now();
  const by = account('owner').uid;
  let productWrites = 0;
  let sectionWrites = 0;
  let movementWrites = 0;
  const batch = db.batch();

  for (const [rid, plan] of Object.entries(PLANS)) {
    const base = db.collection(COLLECTIONS.restaurants).doc(rid);
    const products = base.collection(SUBCOLLECTIONS.restaurants.products);
    const movements = base.collection(SUBCOLLECTIONS.restaurants.stockMovements);

    const snaps = await products.get();
    const byId = new Map(snaps.docs.map((doc) => [doc.id, doc]));

    // Vitrine : ordre explicite, les autres produits en sortent.
    for (const doc of snaps.docs) {
      const index = plan.featured.indexOf(doc.id);
      const patch = index >= 0 ? { featured: true, featuredOrder: index } : { featured: false, featuredOrder: null };
      if (doc.get('featured') !== patch.featured || doc.get('featuredOrder') !== patch.featuredOrder) {
        batch.set(doc.ref, patch, { merge: true });
        productWrites += 1;
      }
    }

    for (const [pid, p] of Object.entries(plan.products)) {
      const doc = byId.get(pid);
      if (!doc) {
        console.warn(`Produit absent : ${rid}/${pid}`);
        continue;
      }
      const name = String(doc.get('name'));
      const patch: Record<string, unknown> = {};
      if (p.badge !== undefined) patch.badge = p.badge;
      if (p.tags) patch.tags = p.tags;
      if (p.schedule) patch.schedule = p.schedule;
      if (p.threshold !== undefined) patch.lowStockThreshold = p.threshold;
      if (p.gallery) patch.gallery = p.gallery.map((id) => ({ path: '', url: unsplash(id, 1200, 900), thumbUrl: unsplash(id, 480, 360), width: 1200, height: 900, alt: name }));
      const finalStock = p.stock !== undefined ? p.stock : (doc.get('stock') as number | null);
      if (p.stock !== undefined) {
        patch.stock = p.stock;
        // Rupture : le produit est retiré de la vente (comme le fait le contrôle serveur).
        if (p.stock === 0) Object.assign(patch, { available: false, autoSoldOut: true });
        else if (doc.get('autoSoldOut')) Object.assign(patch, { available: true, autoSoldOut: false });
      }
      if (Object.keys(patch).length) {
        batch.set(doc.ref, patch, { merge: true });
        productWrites += 1;
      }

      // Historique cohérent avec le stock final : on remonte le temps depuis la valeur actuelle.
      if (p.history && finalStock !== null && finalStock !== undefined) {
        let stockAfter = finalStock;
        const chain = [...p.history].reverse().map(([delta, reason, days, note], index) => {
          const entry = { delta, reason, days, note, stockAfter, index: p.history!.length - 1 - index };
          stockAfter -= delta;
          return entry;
        });
        for (const entry of chain) {
          const movement: StockMovement & { seed: true } = {
            productId: pid,
            productName: name,
            delta: entry.delta,
            stockAfter: Math.max(0, entry.stockAfter),
            reason: entry.reason,
            orderId: null,
            note: entry.note ?? null,
            createdAt: Timestamp.fromMillis(now - entry.days * DAY - entry.index * 3_600_000) as unknown as StockMovement['createdAt'],
            createdBy: entry.reason === 'order' ? 'system' : by,
            seed: true,
          };
          batch.set(movements.doc(`rc-${pid}-${entry.index}`), movement);
          movementWrites += 1;
        }
      }
    }

    for (const [sid, section] of Object.entries(plan.sections ?? {})) {
      const ref = base.collection(SUBCOLLECTIONS.restaurants.sections).doc(sid);
      batch.set(ref, { availability: section.availability, ...(section.description ? { description: section.description } : {}) }, { merge: true });
      sectionWrites += 1;
    }
  }

  console.log(`Produits : ${productWrites} mises à jour · sections : ${sectionWrites} · mouvements de stock : ${movementWrites}`);
  if (DRY_RUN) {
    console.log('Simulation : rien n’a été écrit.');
    return;
  }
  await batch.commit();
  console.log('Données de la carte écrites.');
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
