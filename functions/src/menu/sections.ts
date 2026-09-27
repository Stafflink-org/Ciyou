// Duplication d'une section de la carte, avec ou sans ses produits. La copie est
// ajoutée en fin de carte et désactivée : le restaurant la relit avant de la publier.
import { MENU_LIMITS, buildSearchKeywords, type MenuSection, type Product } from '@golink/shared';
import type { DocumentReference } from 'firebase-admin/firestore';
import { db } from '../lib/admin';
import { callable } from '../lib/callable';
import { fail } from '../lib/errors';
import { z, zId } from '../lib/validation';
import { auditMenu, chunk, menuCollection, nameKey, requireMenuAccess, trackedCreate, uniqueCopyName, MENU_RUNTIME } from './common';

const schema = z.object({
  restaurantId: zId,
  sectionId: zId,
  withProducts: z.boolean().default(true),
});

export const duplicateSection = callable(schema, async (data, request) => {
  const context = await requireMenuAccess(request, data.restaurantId, 'menu.edit');
  const uid = context.actor.caller.uid;
  const sections = menuCollection(data.restaurantId, 'sections');
  const products = menuCollection(data.restaurantId, 'products');

  const [sourceSnap, allSections] = await Promise.all([sections.doc(data.sectionId).get(), sections.get()]);
  if (!sourceSnap.exists) throw fail.notFound('Section');
  const source = sourceSnap.data() as MenuSection;

  const taken = new Set(allSections.docs.map((doc) => nameKey(String(doc.get('name') ?? ''))));
  const name = uniqueCopyName(source.name, taken, MENU_LIMITS.sectionName);
  const order = allSections.docs.reduce((max, doc) => Math.max(max, Number(doc.get('order') ?? 0)), -1) + 1;

  const sectionRef = sections.doc();
  const copy: Record<string, unknown> = {
    name,
    description: source.description ?? null,
    image: source.image ?? null,
    enabled: false,
    hideProductNames: source.hideProductNames ?? false,
    order,
    availability: source.availability ?? null,
    ...trackedCreate(uid),
  };

  const sourceProducts = data.withProducts ? (await products.where('sectionId', '==', data.sectionId).get()).docs : [];
  const writes: Array<{ ref: DocumentReference; value: Record<string, unknown> }> = [{ ref: sectionRef, value: copy }];
  for (const doc of sourceProducts) {
    const product = doc.data() as Product;
    writes.push({
      ref: products.doc(),
      value: {
        ...product,
        sectionId: sectionRef.id,
        salesCount: 0,
        featured: false,
        featuredOrder: null,
        externalId: null,
        autoSoldOut: false,
        qualityIssues: product.qualityIssues ?? [],
        searchKeywords: buildSearchKeywords(product.name, name),
        ...trackedCreate(uid),
      },
    });
  }

  for (const group of chunk(writes, 400)) {
    const batch = db.batch();
    group.forEach(({ ref, value }) => batch.set(ref, value));
    await batch.commit();
  }

  await auditMenu(request, context, 'menu_section.duplicated', { type: 'other', id: sectionRef.id, label: name }, {
    after: { sourceId: data.sectionId, products: sourceProducts.length },
  });
  return { sectionId: sectionRef.id, name, products: sourceProducts.length };
}, MENU_RUNTIME);
