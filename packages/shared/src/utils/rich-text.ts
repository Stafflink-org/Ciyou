// Texte enrichi des contenus éditables (pages d'information, FAQ, centre d'aide,
// réponses types) : Markdown restreint, analysé en blocs sans HTML, donc sans
// risque d'injection. Syntaxe : « ## Titre », « ### Sous-titre », « - puce »,
// « 1. étape », « > encadré », **gras**, *italique*, [lien](https://…), ligne
// vide = nouveau paragraphe.

export type RichInline =
  | { type: 'text'; text: string }
  | { type: 'strong'; children: RichInline[] }
  | { type: 'em'; children: RichInline[] }
  | { type: 'link'; href: string; children: RichInline[] }
  | { type: 'break' };

export type RichBlock =
  | { type: 'heading'; level: 2 | 3; children: RichInline[] }
  | { type: 'paragraph'; children: RichInline[] }
  | { type: 'list'; ordered: boolean; items: RichInline[][] }
  | { type: 'quote'; children: RichInline[] };

const SAFE_LINK = /^(https:\/\/|mailto:|tel:|\/)/i;

/** Analyse les styles en ligne d'une ligne (ou d'un paragraphe multi-lignes). */
export function parseRichInline(text: string): RichInline[] {
  const out: RichInline[] = [];
  let buffer = '';
  const flush = () => {
    if (buffer) out.push({ type: 'text', text: buffer });
    buffer = '';
  };
  let i = 0;
  while (i < text.length) {
    const rest = text.slice(i);
    if (rest.startsWith('\n')) {
      flush();
      out.push({ type: 'break' });
      i += 1;
      continue;
    }
    const strong = rest.match(/^\*\*(.+?)\*\*/s);
    if (strong) {
      flush();
      out.push({ type: 'strong', children: parseRichInline(strong[1]!) });
      i += strong[0].length;
      continue;
    }
    const em = rest.match(/^\*(?!\s)(.+?)\*/s);
    if (em) {
      flush();
      out.push({ type: 'em', children: parseRichInline(em[1]!) });
      i += em[0].length;
      continue;
    }
    const link = rest.match(/^\[([^\]]+)\]\(([^)\s]+)\)/);
    if (link) {
      flush();
      const href = link[2]!;
      if (SAFE_LINK.test(href)) out.push({ type: 'link', href, children: parseRichInline(link[1]!) });
      else out.push({ type: 'text', text: link[1]! });
      i += link[0].length;
      continue;
    }
    buffer += text[i];
    i += 1;
  }
  flush();
  return out;
}

/** Découpe un texte enrichi en blocs. */
export function parseRichText(source: string | null | undefined): RichBlock[] {
  const lines = (source ?? '').replace(/\r\n?/g, '\n').split('\n');
  const blocks: RichBlock[] = [];
  let paragraph: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  let quote: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length) blocks.push({ type: 'paragraph', children: parseRichInline(paragraph.join('\n')) });
    paragraph = [];
  };
  const flushList = () => {
    if (list) blocks.push({ type: 'list', ordered: list.ordered, items: list.items.map((item) => parseRichInline(item)) });
    list = null;
  };
  const flushQuote = () => {
    if (quote.length) blocks.push({ type: 'quote', children: parseRichInline(quote.join('\n')) });
    quote = [];
  };
  const flushAll = () => {
    flushParagraph();
    flushList();
    flushQuote();
  };

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    if (!line.trim()) {
      flushAll();
      continue;
    }
    const heading = line.match(/^(#{2,3})\s+(.*)$/);
    if (heading) {
      flushAll();
      blocks.push({ type: 'heading', level: heading[1]!.length === 2 ? 2 : 3, children: parseRichInline(heading[2]!.trim()) });
      continue;
    }
    const bullet = line.match(/^\s*[-•]\s+(.*)$/);
    const ordered = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (bullet || ordered) {
      flushParagraph();
      flushQuote();
      const isOrdered = Boolean(ordered);
      if (!list || list.ordered !== isOrdered) {
        flushList();
        list = { ordered: isOrdered, items: [] };
      }
      list.items.push((bullet ?? ordered)![1]!);
      continue;
    }
    const quoted = line.match(/^>\s?(.*)$/);
    if (quoted) {
      flushParagraph();
      flushList();
      quote.push(quoted[1]!);
      continue;
    }
    flushList();
    flushQuote();
    paragraph.push(line.trim());
  }
  flushAll();
  return blocks;
}

/** Texte brut (aperçus, recherche, extraits d'e-mail). */
export function richTextToPlain(source: string | null | undefined): string {
  const inline = (nodes: RichInline[]): string =>
    nodes.map((n) => (n.type === 'text' ? n.text : n.type === 'break' ? ' ' : inline(n.children))).join('');
  return parseRichText(source)
    .map((b) => (b.type === 'list' ? b.items.map(inline).join(' · ') : inline(b.children)))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}
