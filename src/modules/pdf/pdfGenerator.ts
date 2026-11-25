import { jsPDF } from 'jspdf';
import { getDictionary } from '@/src/modules/i18n';
import { getLanguageConfig } from '@/src/modules/language/languages';
import type { LanguageCode, SubmissionRecord } from '@/src/types/kiosk';

function wrapTextLines(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number
): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = '';
  for (const w of words) {
    const candidate = current ? `${current} ${w}` : w;
    if (ctx.measureText(candidate).width <= maxWidth) {
      current = candidate;
    } else {
      if (current) lines.push(current);
      current = w;
    }
  }
  if (current) lines.push(current);
  return lines.length > 0 ? lines : ['—'];
}

/**
 * Generates an A4 PDF receipt using high-DPI Canvas rendering embedded into jsPDF.
 * This ensures 100% crisp shaping for all 12 Indian languages including Tamil, Hindi,
 * Telugu, Kannada, Malayalam, Bengali, Marathi, Gujarati, Punjabi, Odia, and Urdu (RTL).
 */
export async function generateApplicationPdf(
  submission: SubmissionRecord,
  language: LanguageCode
): Promise<void> {
  const t = getDictionary(language);
  const langCfg = getLanguageConfig(language);
  const isRtl = langCfg.dir === 'rtl';

  const width = 1240; // A4 @ 150 DPI
  const height = 1754;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Unable to initialize PDF canvas.');

  const fontStack =
    '"Public Sans", "Noto Sans Tamil", "Noto Sans Devanagari", "Noto Sans Telugu", "Noto Sans Kannada", "Noto Sans Malayalam", "Noto Sans Bengali", "Noto Sans Gujarati", "Noto Sans Gurmukhi", "Noto Sans Oriya", "Noto Nastaliq Urdu", sans-serif';

  // White paper background
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);

  // Top civic header bar
  ctx.fillStyle = '#1e3a8a';
  ctx.fillRect(0, 0, width, 175);

  ctx.fillStyle = '#ffffff';
  ctx.font = `700 42px ${fontStack}`;
  ctx.textAlign = isRtl ? 'right' : 'left';
  const marginX = 72;
  const startX = isRtl ? width - marginX : marginX;

  ctx.fillText(t.app.brandName, startX, 82);
  ctx.font = `500 24px ${fontStack}`;
  ctx.fillStyle = '#dbeafe';
  ctx.fillText(t.app.brandTagline, startX, 128);

  // Reference & status strip
  ctx.fillStyle = '#f1f5f9';
  ctx.fillRect(marginX, 210, width - marginX * 2, 132);
  ctx.strokeStyle = '#cbd5e1';
  ctx.lineWidth = 2;
  ctx.strokeRect(marginX, 210, width - marginX * 2, 132);

  ctx.fillStyle = '#475569';
  ctx.font = `600 20px ${fontStack}`;
  ctx.fillText(t.completion.referenceLabel, isRtl ? width - marginX - 28 : marginX + 28, 255);

  ctx.fillStyle = '#0f172a';
  ctx.font = `700 32px "JetBrains Mono", monospace`;
  ctx.fillText(submission.referenceId, isRtl ? width - marginX - 28 : marginX + 28, 305);

  // Status right/left side
  ctx.textAlign = isRtl ? 'left' : 'right';
  const oppX = isRtl ? marginX + 28 : width - marginX - 28;
  ctx.fillStyle = '#475569';
  ctx.font = `600 20px ${fontStack}`;
  ctx.fillText(t.completion.statusLabel, oppX, 255);
  ctx.fillStyle = '#15803d';
  ctx.font = `700 24px ${fontStack}`;
  ctx.fillText(t.completion.statusConfirmed, oppX, 303);

  // Section heading
  ctx.textAlign = isRtl ? 'right' : 'left';
  ctx.fillStyle = '#0f172a';
  ctx.font = `700 30px ${fontStack}`;
  ctx.fillText(t.completion.title, startX, 410);

  const rows: Array<[string, string]> = [
    [t.form.fields.serviceType.label, t.dashboard.services[submission.formSummary.serviceType]],
    [t.form.fields.fullName.label, submission.formSummary.fullName],
    [t.form.fields.idNumber.label, submission.maskedIdNumber],
    [t.form.fields.dob.label, submission.formSummary.dob],
    [
      t.form.fields.gender.label,
      submission.formSummary.gender
        ? t.form.genders[submission.formSummary.gender]
        : '—',
    ],
    [t.form.fields.fatherName.label, submission.formSummary.fatherName],
    [t.form.fields.phoneNumber.label, submission.formSummary.phoneNumber],
    [t.form.fields.address.label, submission.formSummary.address],
    [t.form.fields.pincode.label, submission.formSummary.pincode],
    [
      t.completion.submittedAtLabel,
      new Date(submission.submittedAt).toLocaleString(langCfg.speechCode),
    ],
  ];

  let y = 460;
  const boxW = width - marginX * 2;
  const labelW = 360;
  const valMaxW = boxW - labelW - 60;

  for (const [label, value] of rows) {
    ctx.font = `600 22px ${fontStack}`;
    const wrapped = wrapTextLines(ctx, value || '—', valMaxW);
    const rowH = Math.max(76, wrapped.length * 34 + 34);

    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(marginX, y);
    ctx.lineTo(width - marginX, y);
    ctx.stroke();

    ctx.fillStyle = '#475569';
    ctx.font = `600 22px ${fontStack}`;
    ctx.textAlign = isRtl ? 'right' : 'left';
    ctx.fillText(label, startX, y + 44, labelW - 20);

    ctx.fillStyle = '#0f172a';
    ctx.font = `600 24px ${fontStack}`;
    const valX = isRtl ? width - marginX - labelW : marginX + labelW;
    wrapped.forEach((line, idx) => {
      ctx.fillText(line, valX, y + 44 + idx * 34);
    });

    y += rowH;
  }

  // Bottom border & footer note
  ctx.strokeStyle = '#cbd5e1';
  ctx.beginPath();
  ctx.moveTo(marginX, y + 10);
  ctx.lineTo(width - marginX, y + 10);
  ctx.stroke();

  ctx.fillStyle = '#64748b';
  ctx.font = `500 19px ${fontStack}`;
  ctx.textAlign = isRtl ? 'right' : 'left';
  ctx.fillText(t.completion.receiptFooterNote, startX, height - 64);

  const imgData = canvas.toDataURL('image/png');
  const pdf = new jsPDF({
    orientation: 'portrait',
    unit: 'pt',
    format: 'a4',
  });
  const pdfW = pdf.internal.pageSize.getWidth();
  const pdfH = pdf.internal.pageSize.getHeight();
  pdf.addImage(imgData, 'PNG', 0, 0, pdfW, pdfH);
  pdf.save(`${submission.referenceId}.pdf`);
}
