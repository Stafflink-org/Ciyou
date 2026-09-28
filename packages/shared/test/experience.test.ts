import { test } from 'node:test';
import assert from 'node:assert/strict';
import { maskModeratedTerms, parseRichText, richTextToPlain, scanReviewText } from '../src';

test('filtre des avis : texte correct publié', () => {
  const verdict = scanReviewText('Très bon repas, livré chaud et rapidement. Merci !');
  assert.equal(verdict.flagged, false);
  assert.equal(verdict.blocked, false);
});

test('filtre des avis : insulte bloquée, y compris déguisée', () => {
  assert.equal(scanReviewText('Livreur connard, jamais plus').blocked, true);
  assert.equal(scanReviewText('Quel c0nnard ce livreur').blocked, true);
  assert.equal(scanReviewText('Service de MERDE').blocked, true);
});

test('filtre des avis : coordonnées bloquées, lien signalé', () => {
  assert.equal(scanReviewText('Appelez-moi au 06 12 34 56 78').blocked, true);
  const link = scanReviewText('Meilleur ailleurs : www.exemple.com');
  assert.equal(link.flagged, true);
  assert.equal(link.blocked, false);
});

test('filtre des avis : termes éditables', () => {
  const verdict = scanReviewText('Un vrai radin ce restaurant', [{ term: 'radin', category: 'insult', action: 'flag' }]);
  assert.equal(verdict.flagged, true);
  assert.equal(verdict.blocked, false);
  assert.match(maskModeratedTerms('Un vrai radin', verdict.matches), /r\*+n/);
});

test('texte enrichi : blocs et liens sûrs', () => {
  const blocks = parseRichText('## Titre\n\nUn **gras** et [lien](https://golink.fr).\n\n- un\n- deux\n\n1. étape\n\n> note\n\n[piège](javascript:alert(1))');
  assert.deepEqual(blocks.map((b) => b.type), ['heading', 'paragraph', 'list', 'list', 'quote', 'paragraph']);
  const last = blocks[5];
  assert.ok(last && last.type === 'paragraph' && last.children.every((c) => c.type === 'text'));
  assert.equal(richTextToPlain('## A\n\n**b** c'), 'A b c');
});
