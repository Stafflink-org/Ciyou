// Nettoie les données créées par r-marketing-messagerie.flow.mjs (titres et textes « TEST »).
// npx tsx scripts/tests/_rmm-cleanup.ts
import { COLLECTIONS } from '@golink/shared';
import { db } from '../lib/admin.mjs';

async function main() {
  let count = 0;
  const promos = await db.collection(COLLECTIONS.promotions).where('restaurantId', '==', 'mina-kitchen').get();
  for (const d of promos.docs) {
    const title = (d.get('title') as { fr?: string } | undefined)?.fr ?? '';
    if (title.startsWith('TEST parcours')) (await db.recursiveDelete(d.ref), (count += 1));
  }
  const campaigns = await db.collection(COLLECTIONS.campaigns).where('restaurantId', '==', 'mina-kitchen').get();
  for (const d of campaigns.docs) if (String(d.get('name') ?? '').startsWith('TEST campagne')) (await db.recursiveDelete(d.ref), (count += 1));

  const tickets = await db.collection(COLLECTIONS.supportTickets).where('restaurantId', '==', 'mina-kitchen').get();
  for (const d of tickets.docs) if (String(d.get('subject') ?? '').startsWith('TEST demande')) (await db.recursiveDelete(d.ref), (count += 1));

  for (const rid of ['mina-kitchen', 'lune-coffee', 'onda-pasta-club']) {
    const templates = await db.collection(`${COLLECTIONS.restaurants}/${rid}/replyTemplates`).get();
    for (const d of templates.docs) if (String(d.get('title') ?? '').startsWith('TEST modèle')) (await d.ref.delete(), (count += 1));
  }

  const reviews = await db.collection(COLLECTIONS.reviews).where('restaurantId', '==', 'mina-kitchen').get();
  for (const d of reviews.docs) {
    if (String(d.get('reply.text') ?? '').includes('(TEST)')) (await d.ref.update({ reply: null }), (count += 1));
  }

  const conversations = await db.collection(COLLECTIONS.conversations).where('restaurantId', '==', 'mina-kitchen').get();
  for (const c of conversations.docs) {
    const messages = await c.ref.collection('messages').orderBy('createdAt', 'asc').get();
    const kept = messages.docs.filter((m) => !String(m.get('text') ?? '').startsWith('TEST message'));
    if (kept.length === messages.size) continue;
    for (const m of messages.docs) if (!kept.includes(m)) (await m.ref.delete(), (count += 1));
    const last = kept.at(-1);
    if (last) {
      await c.ref.update({
        lastMessage: String(last.get('text') ?? ''),
        lastMessageAt: last.get('createdAt'),
        lastSenderRole: c.get(`participants.${last.get('senderId')}.role`) ?? c.get('lastSenderRole') ?? null,
      });
    }
  }
  console.log(`${count} éléments de test nettoyés.`);
}

main().then(() => process.exit(0));
