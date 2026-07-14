import { describe, expect, it } from 'vitest';
import { createCsv, reportRows } from '../reports';
import { DEFAULT_TARGETS, type TimeEntry } from '../types';
const base = (id: string, start: string, end: string): TimeEntry => ({
  id,
  user_id: 'u',
  project_id: null,
  project_name_snapshot: 'Baustelle A',
  entry_type: 'work',
  work_date: '2026-02-09',
  started_at: start,
  ended_at: end,
  manual_break_minutes: 0,
  automatically_added_break_minutes: 0,
  activity: 'Montage',
  note: 'A; "B"',
  source: 'manual',
  created_at: start,
  updated_at: start,
  deleted_at: null,
  revision: 0,
});
describe('Exporte', () => {
  it('behält Blöcke und zeigt Saldo einmal', () => {
    const rows = reportRows(
      ['2026-02-09'],
      [
        base('a', '2026-02-09T07:00:00Z', '2026-02-09T11:00:00Z'),
        base('b', '2026-02-09T12:00:00Z', '2026-02-09T16:00:00Z'),
      ],
      [],
      [],
      DEFAULT_TARGETS,
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]?.targetMinutes).toBe(480);
    expect(rows[1]?.targetMinutes).toBe('');
    expect(rows[1]?.balanceMinutes).toBe('');
  });
  it('erzeugt BOM und korrektes Quoting', () => {
    const csv = createCsv(
      reportRows(
        ['2026-02-09'],
        [base('a', '2026-02-09T07:00:00Z', '2026-02-09T15:00:00Z')],
        [],
        [],
        DEFAULT_TARGETS,
      ),
    );
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv).toContain('"A; ""B"""');
  });
});
