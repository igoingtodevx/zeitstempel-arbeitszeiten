import { jsPDF } from 'jspdf';
import type { ReportRow } from './reports';

export function createPdf(rows: ReportRow[]): Blob {
  const doc = new jsPDF();
  doc.setFontSize(18);
  doc.text('Stundennachweis', 14, 16);
  doc.setFontSize(8);
  let y = 25;

  for (const row of rows) {
    if (y > 280) {
      doc.addPage();
      y = 15;
    }
    doc.text(
      `${row.date} ${row.project || ''} ${row.start}${row.start ? '–' : ''}${row.end} · Netto ${row.netMinutes} min · Saldo ${row.balanceMinutes}`,
      14,
      y,
      { maxWidth: 180 },
    );
    y += 6;
  }

  return doc.output('blob');
}
