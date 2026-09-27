// Filtre automatique des avis publics : insultes, propos haineux, menaces,
// coordonnées personnelles et liens. Module pur, partagé par la Cloud Function
// `onReviewCreated` et l'aperçu du super admin. Les termes par défaut sont
// complétés par la liste éditable `moderationTerms`.
import type { ModerationCategory } from '../models/experience';
import { normalizeForMatch } from './alcohol';

export interface ModerationRule {
  term: string;
  category: ModerationCategory;
  action: 'block' | 'flag';
}

export const MODERATION_CATEGORY_LABELS: Record<ModerationCategory, string> = {
  insult: 'Insulte',
  hate: 'Propos haineux',
  threat: 'Menace',
  sexual: 'Contenu sexuel',
  personal_data: 'Données personnelles',
  spam: 'Publicité, lien',
  other: 'Autre',
};

/** Termes de base (forme normalisée). Un terme de plusieurs mots est une expression. */
export const DEFAULT_MODERATION_RULES: readonly ModerationRule[] = [
  ...['connard', 'connasse', 'conasse', 'salope', 'salaud', 'encule', 'enculer', 'batard', 'fdp', 'fils de pute', 'pute', 'putain de',
    'ta gueule', 'ferme ta gueule', 'abruti', 'debile', 'cretin', 'imbecile', 'idiot', 'bouffon', 'clochard', 'merdique', 'de merde',
    'nique', 'niquer', 'ntm', 'tg', 'pd', 'tocard', 'raclure', 'ordure', 'chier', 'enfoire', 'couillon', 'grognasse', 'pouffiasse',
    'asshole', 'bitch', 'fuck', 'fucking', 'motherfucker', 'bastard', 'dickhead', 'moron', 'shit']
    .map((term) => ({ term, category: 'insult' as const, action: 'block' as const })),
  ...['sale arabe', 'sale noir', 'sale juif', 'sale blanc', 'bougnoule', 'negre', 'youpin', 'bicot', 'raton', 'niakoue', 'chinetoque', 'sale race',
    'retourne dans ton pays', 'sale pede', 'tapette', 'gouine']
    .map((term) => ({ term, category: 'hate' as const, action: 'block' as const })),
  ...['je vais te tuer', 'je vais vous tuer', 'je vais te retrouver', 'on va te retrouver', 'je sais ou tu habites', 'creve', 'va crever', 'mort aux']
    .map((term) => ({ term, category: 'threat' as const, action: 'block' as const })),
  ...['bite', 'suce', 'sucer', 'porno', 'baiser', 'nichon']
    .map((term) => ({ term, category: 'sexual' as const, action: 'flag' as const })),
  ...['arnaque', 'arnaqueur', 'voleur', 'voleurs', 'escroc', 'escroquerie']
    .map((term) => ({ term, category: 'other' as const, action: 'flag' as const })),
];

export interface ModerationMatch {
  term: string;
  category: ModerationCategory;
  action: 'block' | 'flag';
}

export interface ModerationVerdict {
  /** L'avis doit passer en modération avant publication. */
  blocked: boolean;
  /** Au moins un terme ou motif détecté. */
  flagged: boolean;
  matches: ModerationMatch[];
  /** Motifs lisibles (catégories), pour `autoModeration.reasons`. */
  reasons: string[];
}

/** Déjoue les contournements simples : chiffres pour lettres, lettres répétées. */
function deobfuscate(text: string): string {
  return text
    .replace(/0/g, 'o')
    .replace(/1/g, 'i')
    .replace(/3/g, 'e')
    .replace(/4/g, 'a')
    .replace(/5/g, 's')
    .replace(/7/g, 't')
    .replace(/@/g, 'a')
    .replace(/\$/g, 's')
    .replace(/([a-z])\1{2,}/g, '$1');
}

const EMAIL = /[\w.+-]+@[\w-]+\.[\w.]{2,}/;
const PHONE = /(?:\+|00)?\d(?:[\s.-]?\d){8,}/;
const URL = /\b(?:https?:\/\/|www\.)\S+|\b[\w-]+\.(?:com|fr|net|org|io|lu|be|ma|dz|tn)\b/i;

/**
 * Analyse un texte d'avis. `rules` = règles par défaut + termes actifs de
 * `moderationTerms` ; un terme en double garde l'action la plus stricte.
 */
export function scanReviewText(text: string | null | undefined, rules: readonly ModerationRule[] = DEFAULT_MODERATION_RULES): ModerationVerdict {
  const raw = (text ?? '').trim();
  if (!raw) return { blocked: false, flagged: false, matches: [], reasons: [] };
  const normalized = ` ${normalizeForMatch(raw)} `;
  const loose = ` ${normalizeForMatch(deobfuscate(raw.toLowerCase()))} `;
  const matches = new Map<string, ModerationMatch>();

  for (const rule of rules) {
    const term = normalizeForMatch(rule.term).trim();
    if (!term) continue;
    const needle = ` ${term} `;
    if (normalized.includes(needle) || loose.includes(needle)) {
      const current = matches.get(term);
      if (!current || (current.action === 'flag' && rule.action === 'block')) {
        matches.set(term, { term, category: rule.category, action: rule.action });
      }
    }
  }
  if (EMAIL.test(raw) || PHONE.test(raw)) matches.set('#contact', { term: 'coordonnées', category: 'personal_data', action: 'block' });
  if (URL.test(raw)) matches.set('#url', { term: 'lien', category: 'spam', action: 'flag' });

  const list = [...matches.values()];
  const reasons = [...new Set(list.map((m) => MODERATION_CATEGORY_LABELS[m.category]))];
  return { blocked: list.some((m) => m.action === 'block'), flagged: list.length > 0, matches: list, reasons };
}

/** Masque les termes détectés pour l'affichage (« c****d »). */
export function maskModeratedTerms(text: string, matches: readonly ModerationMatch[]): string {
  let out = text;
  for (const match of matches) {
    if (match.term.length < 3 || match.term === 'coordonnées' || match.term === 'lien') continue;
    const pattern = new RegExp(`\\b${match.term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/e/g, '[eéèêë]').replace(/a/g, '[aàâ]')}\\b`, 'gi');
    out = out.replace(pattern, (word) => `${word[0]}${'*'.repeat(Math.max(1, word.length - 2))}${word[word.length - 1]}`);
  }
  return out;
}
