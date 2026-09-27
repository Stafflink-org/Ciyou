// Mise en page commune des e-mails Ciyou Eats : sobre, lisible sur mobile et
// compatible avec les principaux clients de messagerie (tableaux, styles en ligne).
import { PLATFORM_NAME } from './config';

const COLORS = {
  background: '#f7f2e8',
  card: '#ffffff',
  ink: '#19343b',
  muted: '#5c6f73',
  line: '#e9e1d2',
  accent: '#e8784b',
  soft: '#fbf8f2',
};

const FONT = "'DM Sans', 'Helvetica Neue', Helvetica, Arial, sans-serif";
const DISPLAY = "'Space Grotesk', 'DM Sans', 'Helvetica Neue', Helvetica, Arial, sans-serif";

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export interface EmailContent {
  /** Texte d'aperçu affiché par les messageries après l'objet. */
  preheader: string;
  /** Petit libellé au-dessus du titre (ex. « Invitation »). */
  eyebrow?: string;
  title: string;
  paragraphs: string[];
  details?: Array<{ label: string; value: string }>;
  cta?: { label: string; url: string };
  /** Mention sous le bouton (validité du lien, sécurité). */
  note?: string;
  /** Raison de l'envoi, rappelée en pied de page. */
  footerReason: string;
}

export interface RenderedEmail {
  html: string;
  text: string;
}

function detailsBlock(details: NonNullable<EmailContent['details']>): string {
  const rows = details
    .map(
      (d, i) => `<tr>
  <td style="padding:12px 16px;font:400 13px/1.4 ${FONT};color:${COLORS.muted};${i > 0 ? `border-top:1px solid ${COLORS.line};` : ''}">${escapeHtml(d.label)}</td>
  <td align="right" style="padding:12px 16px;font:600 14px/1.4 ${FONT};color:${COLORS.ink};${i > 0 ? `border-top:1px solid ${COLORS.line};` : ''}">${escapeHtml(d.value)}</td>
</tr>`,
    )
    .join('');
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:8px 0 24px;background:${COLORS.soft};border:1px solid ${COLORS.line};border-radius:12px;border-collapse:separate;">${rows}</table>`;
}

function ctaBlock(cta: NonNullable<EmailContent['cta']>): string {
  const url = escapeHtml(cta.url);
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 20px;">
<tr><td style="border-radius:10px;background:${COLORS.ink};">
<a href="${url}" style="display:inline-block;padding:14px 26px;font:600 15px/1 ${FONT};color:#ffffff;text-decoration:none;border-radius:10px;">${escapeHtml(cta.label)}&nbsp;&nbsp;&rarr;</a>
</td></tr></table>
<p style="margin:0 0 20px;font:400 12px/1.6 ${FONT};color:${COLORS.muted};">Si le bouton ne fonctionne pas, copiez ce lien dans votre navigateur&nbsp;:<br><a href="${url}" style="color:${COLORS.ink};word-break:break-all;">${url}</a></p>`;
}

/** Produit la version HTML et la version texte d'un e-mail. */
export function renderEmail(content: EmailContent): RenderedEmail {
  const paragraphs = content.paragraphs
    .map((p) => `<p style="margin:0 0 16px;font:400 15px/1.65 ${FONT};color:${COLORS.ink};">${escapeHtml(p)}</p>`)
    .join('');
  const eyebrow = content.eyebrow
    ? `<p style="margin:0 0 10px;font:600 11px/1 ${FONT};letter-spacing:.14em;text-transform:uppercase;color:${COLORS.accent};">${escapeHtml(content.eyebrow)}</p>`
    : '';
  const note = content.note
    ? `<p style="margin:0;padding-top:16px;border-top:1px solid ${COLORS.line};font:400 13px/1.6 ${FONT};color:${COLORS.muted};">${escapeHtml(content.note)}</p>`
    : '';

  const html = `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light only">
<title>${escapeHtml(content.title)}</title>
<link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;600&family=Space+Grotesk:wght@600&display=swap" rel="stylesheet">
</head>
<body style="margin:0;padding:0;background:${COLORS.background};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(content.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${COLORS.background};">
<tr><td align="center" style="padding:40px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;">
<tr><td style="padding:0 4px 24px;">
<span style="font:600 22px/1 ${DISPLAY};letter-spacing:-.02em;color:${COLORS.ink};">${PLATFORM_NAME}</span><span style="font:600 22px/1 ${DISPLAY};color:${COLORS.accent};">.</span>
</td></tr>
<tr><td style="background:${COLORS.card};border:1px solid ${COLORS.line};border-radius:18px;padding:40px 36px;">
${eyebrow}
<h1 style="margin:0 0 20px;font:600 26px/1.25 ${DISPLAY};letter-spacing:-.02em;color:${COLORS.ink};">${escapeHtml(content.title)}</h1>
${paragraphs}
${content.details?.length ? detailsBlock(content.details) : ''}
${content.cta ? ctaBlock(content.cta) : ''}
${note}
</td></tr>
<tr><td style="padding:24px 8px 0;font:400 12px/1.6 ${FONT};color:${COLORS.muted};">
${escapeHtml(content.footerReason)}<br>
${PLATFORM_NAME} &middot; livraison de repas en France et au Luxembourg
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;

  const text = [
    content.title,
    '',
    ...content.paragraphs.flatMap((p) => [p, '']),
    ...(content.details ?? []).map((d) => `${d.label} : ${d.value}`),
    ...(content.details?.length ? [''] : []),
    ...(content.cta ? [`${content.cta.label} : ${content.cta.url}`, ''] : []),
    ...(content.note ? [content.note, ''] : []),
    '--',
    content.footerReason,
    `${PLATFORM_NAME} · livraison de repas en France et au Luxembourg`,
  ].join('\n');

  return { html, text };
}
