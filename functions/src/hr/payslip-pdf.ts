// Mise en page PDF d'un bulletin de paie (modèle simplifié français).
import { CONTRACT_TYPE_LABELS, type Payslip, type PostalAddress } from '@golink/shared';
import { PDF_COLORS, PdfDocument, pdfEuros, pdfNumber } from './pdf';
import { formatMonth, formatShortDay } from './time';

export interface PayslipPdfInput {
  payslip: Payslip;
  employer: {
    name: string;
    legalName?: string | null;
    siret?: string | null;
    nafCode?: string | null;
    address?: PostalAddress | null;
    collectiveAgreement: string;
  };
  employeeFallbackName: string;
  payDate: string | null;
}

const LEFT = 40;
const RIGHT = 555;

const percent = (bps: number) => (bps === 0 ? '' : `${pdfNumber(bps / 100, bps % 100 === 0 ? 0 : 2)} %`);

export function renderPayslipPdf(input: PayslipPdfInput): Buffer {
  const { payslip, employer } = input;
  const pdf = new PdfDocument();
  const snapshot = payslip.employeeSnapshot;
  let y = 40;

  const ensure = (space: number) => {
    if (y + space > 800) {
      pdf.addPage();
      y = 48;
    }
  };

  // En-tête : employeur à gauche, titre à droite.
  pdf.text(LEFT, y + 12, employer.legalName || employer.name, { size: 13, bold: true });
  const employerLines = [
    employer.legalName && employer.legalName !== employer.name ? `Établissement : ${employer.name}` : null,
    employer.address ? `${employer.address.line1}${employer.address.line2 ? `, ${employer.address.line2}` : ''}` : null,
    employer.address ? `${employer.address.postalCode} ${employer.address.city}` : null,
    employer.siret ? `SIRET ${employer.siret}` : null,
    employer.nafCode ? `Code NAF ${employer.nafCode}` : null,
    `Convention collective : ${employer.collectiveAgreement}`,
  ].filter((line): line is string => Boolean(line));
  employerLines.forEach((line, i) => pdf.text(LEFT, y + 27 + i * 10.5, line, { size: 8.5, color: PDF_COLORS.muted }));

  pdf.text(RIGHT, y + 12, 'BULLETIN DE PAIE', { size: 9, bold: true, color: PDF_COLORS.brand, align: 'right' });
  pdf.text(RIGHT, y + 32, formatMonth(payslip.period), { size: 17, bold: true, align: 'right' });
  const [year, month] = payslip.period.split('-').map(Number) as [number, number];
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  pdf.text(RIGHT, y + 47, `Période du 01/${String(month).padStart(2, '0')}/${year} au ${lastDay}/${String(month).padStart(2, '0')}/${year}`, {
    size: 8.5,
    color: PDF_COLORS.muted,
    align: 'right',
  });
  if (input.payDate) pdf.text(RIGHT, y + 59, `Paiement le ${formatShortDay(input.payDate)}`, { size: 8.5, color: PDF_COLORS.muted, align: 'right' });
  y += 27 + employerLines.length * 10.5 + 8;

  // Salarié.
  ensure(90);
  pdf.rect(LEFT, y, RIGHT - LEFT, 70, { fill: PDF_COLORS.surface, stroke: PDF_COLORS.border, radius: 6 });
  pdf.text(LEFT + 14, y + 20, snapshot?.fullName ?? input.employeeFallbackName, { size: 12, bold: true });
  pdf.text(LEFT + 14, y + 34, snapshot?.position ?? '', { size: 9, color: PDF_COLORS.muted });
  const facts: Array<[string, string]> = snapshot
    ? [
        ['Contrat', CONTRACT_TYPE_LABELS[snapshot.contractType]],
        ['Entrée', formatShortDay(snapshot.hireDate)],
        ['Horaire', `${pdfNumber(snapshot.weeklyHours, 0)} h / semaine`],
        ['Taux horaire', pdfEuros(snapshot.hourlyRateCents)],
        ['Classification', snapshot.classification ?? '—'],
        ['Sécurité sociale', snapshot.socialSecurityLast4 ? `•••• ${snapshot.socialSecurityLast4}` : '—'],
      ]
    : [];
  facts.forEach(([label, value], i) => {
    const col = i % 3;
    const row = Math.floor(i / 3);
    const x = LEFT + 14 + col * 172;
    pdf.text(x, y + 50 + row * 12, `${label} :`, { size: 8, color: PDF_COLORS.subtle });
    pdf.text(x + pdf.textWidth(`${label} : `, 8), y + 50 + row * 12, pdf.fit(value, 168 - pdf.textWidth(`${label} : `, 8), 8, true), { size: 8, bold: true });
  });
  y += 82;

  // Rémunération.
  const tableHeader = (columns: Array<[string, number, 'left' | 'right']>) => {
    ensure(40);
    pdf.rect(LEFT, y, RIGHT - LEFT, 18, { fill: PDF_COLORS.ink });
    for (const [label, x, align] of columns) pdf.text(x, y + 12.2, label, { size: 7.5, bold: true, color: PDF_COLORS.white, align });
    y += 18;
  };
  const row = (cells: Array<[string, number, 'left' | 'right', boolean?]>, shaded: boolean, height = 14) => {
    ensure(height + 4);
    if (shaded) pdf.rect(LEFT, y, RIGHT - LEFT, height, { fill: PDF_COLORS.surface });
    for (const [text, x, align, bold] of cells) pdf.text(x, y + height - 4.5, text, { size: 8.2, align, bold });
    y += height;
  };

  tableHeader([
    ['RÉMUNÉRATION', LEFT + 8, 'left'],
    ['NOMBRE', 360, 'right'],
    ['TAUX', 450, 'right'],
    ['MONTANT', RIGHT - 8, 'right'],
  ]);
  (payslip.lines ?? []).forEach((line, i) => {
    row(
      [
        [pdf.fit(line.label, 290, 8.2), LEFT + 8, 'left'],
        [line.quantity !== null && line.quantity !== undefined ? pdfNumber(line.quantity) : '', 360, 'right'],
        [line.unitCents ? pdfEuros(line.unitCents) : '', 450, 'right'],
        [pdfEuros(line.amountCents), RIGHT - 8, 'right'],
      ],
      i % 2 === 1,
    );
  });
  pdf.line(LEFT, y, RIGHT, y, { color: PDF_COLORS.ink, width: 0.8 });
  row([['Salaire brut', LEFT + 8, 'left', true], [pdfEuros(payslip.grossCents), RIGHT - 8, 'right', true]], false, 18);
  const h = payslip.hours;
  const days =
    payslip.workedDays !== undefined
      ? ` · ${payslip.workedDays} j travaillés · absences : ${pdfNumber(payslip.paidAbsenceDays ?? 0, 1)} j rémunérées, ${pdfNumber(payslip.unpaidAbsenceDays ?? 0, 1)} j non rémunérées`
      : '';
  pdf.text(
    LEFT + 8,
    y + 10,
    `${pdfNumber(h.regular)} h normales · ${pdfNumber(h.overtime10 + h.overtime20 + h.overtime50)} h sup. · ${pdfNumber(h.night)} h de nuit · ${pdfNumber(h.sunday)} h dimanche · ${pdfNumber(h.holiday)} h fériées${days}`,
    { size: 7.2, color: PDF_COLORS.subtle },
  );
  y += 24;

  // Cotisations.
  tableHeader([
    ['COTISATIONS ET CONTRIBUTIONS', LEFT + 8, 'left'],
    ['BASE', 318, 'right'],
    ['TAUX', 364, 'right'],
    ['SALARIÉ', 432, 'right'],
    ['TAUX', 478, 'right'],
    ['EMPLOYEUR', RIGHT - 8, 'right'],
  ]);
  payslip.contributions.forEach((c, i) => {
    const employee = Math.round((c.baseCents * c.employeeRateBps) / 10_000);
    const employer = Math.round((c.baseCents * c.employerRateBps) / 10_000);
    row(
      [
        [pdf.fit(c.label, 222, 8.2), LEFT + 8, 'left'],
        [pdfEuros(c.baseCents), 318, 'right'],
        [percent(c.employeeRateBps), 364, 'right'],
        [employee ? pdfEuros(employee) : '', 432, 'right'],
        [percent(c.employerRateBps), 478, 'right'],
        [employer ? pdfEuros(employer) : '', RIGHT - 8, 'right'],
      ],
      i % 2 === 1,
      13,
    );
  });
  pdf.line(LEFT, y, RIGHT, y, { color: PDF_COLORS.ink, width: 0.8 });
  row(
    [
      ['Total des cotisations', LEFT + 8, 'left', true],
      [pdfEuros(payslip.employeeContributionsCents), 432, 'right', true],
      [pdfEuros(payslip.employerContributionsCents), RIGHT - 8, 'right', true],
    ],
    false,
    18,
  );
  y += 14;

  // Synthèse et net à payer.
  ensure(96);
  const summary: Array<[string, string]> = [
    ['Salaire brut', pdfEuros(payslip.grossCents)],
    ['Cotisations salariales', `- ${pdfEuros(payslip.employeeContributionsCents)}`],
    ...(payslip.mealAllowanceCents > 0 ? ([['Avantage en nature nourriture', `- ${pdfEuros(payslip.mealAllowanceCents)}`]] as Array<[string, string]>) : []),
    ['Net imposable', pdfEuros(payslip.taxableNetCents)],
    ['Impôt sur le revenu prélevé à la source', `- ${pdfEuros(payslip.withholdingTaxCents)}`],
    ...(payslip.deductionsCents > 0 ? ([['Retenues (acomptes, autres)', `- ${pdfEuros(payslip.deductionsCents)}`]] as Array<[string, string]>) : []),
  ];
  const boxTop = y;
  summary.forEach(([label, value], i) => {
    pdf.text(LEFT + 8, y + 12, label, { size: 8.8, color: PDF_COLORS.muted });
    pdf.text(300, y + 12, value, { size: 8.8, align: 'right', bold: label === 'Net imposable' });
    y += 15;
    if (i < summary.length - 1) pdf.line(LEFT + 8, y + 1, 300, y + 1, { color: PDF_COLORS.border, width: 0.4 });
  });
  pdf.rect(330, boxTop, RIGHT - 330, 76, { fill: PDF_COLORS.ink, radius: 8 });
  pdf.text(346, boxTop + 22, 'NET À PAYER AU SALARIÉ', { size: 8, bold: true, color: PDF_COLORS.brand });
  pdf.text(RIGHT - 16, boxTop + 54, pdfEuros(payslip.netCents), { size: 22, bold: true, color: PDF_COLORS.white, align: 'right' });
  pdf.text(346, boxTop + 68, `Coût employeur : ${pdfEuros(payslip.grossCents + payslip.employerContributionsCents)}`, {
    size: 7.5,
    color: [0.75, 0.8, 0.8],
  });
  y = Math.max(y, boxTop + 76) + 20;

  // Mentions légales en bas de la dernière page.
  const footer = 'Dans votre intérêt et pour vous aider à faire valoir vos droits, conservez ce bulletin de paie sans limitation de durée.';
  pdf.line(LEFT, 806, RIGHT, 806, { color: PDF_COLORS.border, width: 0.5 });
  pdf.text(LEFT, 818, footer, { size: 7, color: PDF_COLORS.subtle });
  pdf.text(LEFT, 828, 'Bulletin établi avec GoLink à partir des pointages et des absences enregistrés.', { size: 7, color: PDF_COLORS.subtle });
  pdf.text(RIGHT, 828, `Réf. ${payslip.employeeId}-${payslip.period}`, { size: 7, color: PDF_COLORS.subtle, align: 'right' });
  return pdf.toBuffer();
}
