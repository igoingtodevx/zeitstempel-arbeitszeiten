import { jsPDF } from 'jspdf';
import { entryNetMinutes, summarizeDay } from './domain';
import { localDateLabel, localTimeLabel } from './lib/date';
import type { Project, TimeBreak, TimeEntry, WeekdayTargets } from './types';
export interface ReportRow {
  date: string;
  weekday: string;
  project: string;
  customerOrPlace: string;
  type: string;
  start: string;
  end: string;
  breakMinutes: number;
  netMinutes: number;
  targetMinutes: number | '';
  balanceMinutes: number | '';
  activity: string;
  note: string;
}
const labels = {
  work: 'Arbeit',
  vacation: 'Urlaub',
  sick: 'Krankheit',
  holiday: 'Feiertag',
  other_absence: 'Sonstige Abwesenheit',
};
export function reportRows(
  keys: string[],
  entries: TimeEntry[],
  breaks: TimeBreak[],
  projects: Project[],
  targets: WeekdayTargets,
  automaticBreakEnabled = true,
): ReportRow[] {
  const out: ReportRow[] = [];
  for (const key of keys) {
    const day = summarizeDay(key, entries, breaks, targets, new Date(), automaticBreakEnabled);
    const active = day.entries;
    if (!active.length) {
      out.push({
        date: localDateLabel(key),
        weekday: localDateLabel(key, { weekday: 'long' }),
        project: '',
        customerOrPlace: '',
        type: '',
        start: '',
        end: '',
        breakMinutes: 0,
        netMinutes: 0,
        targetMinutes: day.target,
        balanceMinutes: day.balance,
        activity: '',
        note: '',
      });
      continue;
    }
    active.forEach((entry, index) => {
      const project = projects.find((p) => p.id === entry.project_id);
      out.push({
        date: localDateLabel(key),
        weekday: localDateLabel(key, { weekday: 'long' }),
        project: entry.project_name_snapshot || 'Ohne Baustelle',
        customerOrPlace: project?.customer || project?.address || '',
        type: labels[entry.entry_type],
        start: localTimeLabel(entry.started_at),
        end: localTimeLabel(entry.ended_at),
        breakMinutes: entry.manual_break_minutes,
        netMinutes: entryNetMinutes(entry, breaks),
        targetMinutes: index ? '' : day.target,
        balanceMinutes: index ? '' : day.balance,
        activity: entry.activity,
        note: entry.note,
      });
    });
  }
  return out;
}
const esc = (v: unknown) => `"${String(v).replaceAll('"', '""')}"`;
export function createCsv(rows: ReportRow[]): string {
  const fields = [
    'Datum',
    'Wochentag',
    'Baustelle',
    'Kunde oder Ort',
    'Typ',
    'Start',
    'Ende',
    'Pause (Min)',
    'Netto (Min)',
    'Sollzeit (Min)',
    'Tagessaldo (Min)',
    'Tätigkeit',
    'Notiz',
  ];
  return (
    '\uFEFF' +
    [
      fields.map(esc).join(';'),
      ...rows.map((r) =>
        [
          r.date,
          r.weekday,
          r.project,
          r.customerOrPlace,
          r.type,
          r.start,
          r.end,
          r.breakMinutes,
          r.netMinutes,
          r.targetMinutes,
          r.balanceMinutes,
          r.activity,
          r.note,
        ]
          .map(esc)
          .join(';'),
      ),
    ].join('\r\n')
  );
}
export function createPdf(rows: ReportRow[]): Blob {
  const doc = new jsPDF();
  doc.setFontSize(18);
  doc.text('Stundennachweis', 14, 16);
  doc.setFontSize(8);
  let y = 25;
  for (const r of rows) {
    if (y > 280) {
      doc.addPage();
      y = 15;
    }
    doc.text(
      `${r.date} ${r.project || ''} ${r.start}${r.start ? '–' : ''}${r.end} · Netto ${r.netMinutes} min · Saldo ${r.balanceMinutes}`,
      14,
      y,
      { maxWidth: 180 },
    );
    y += 6;
  }
  return doc.output('blob');
}
export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
