import { describe, expect, it } from 'vitest';
import {
  currentMonthKeys,
  entryNetMinutes,
  formatMinutes,
  summarizeDay,
  summarizeRange,
  weekKeys,
} from '../domain';
import { berlinLocalToIso, localDateKey } from '../lib/date';
import { DEFAULT_TARGETS, type TimeEntry } from '../types';
function entry(
  start: string | null,
  end: string | null,
  type: TimeEntry['entry_type'] = 'work',
  date = '2026-02-10',
  id = '1',
): TimeEntry {
  return {
    id,
    user_id: 'u',
    project_id: null,
    project_name_snapshot: 'Ohne Baustelle',
    entry_type: type,
    work_date: date,
    started_at: start,
    ended_at: end,
    manual_break_minutes: 0,
    automatically_added_break_minutes: 0,
    activity: '',
    note: '',
    source: 'manual',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    deleted_at: null,
    revision: 0,
  };
}
describe('Europe/Berlin Kalender', () => {
  it('ermittelt den lokalen Tag kurz nach Mitternacht', () =>
    expect(localDateKey('2026-07-13T22:15:00Z')).toBe('2026-07-14'));
  it('kennt Schaltjahre', () => expect(currentMonthKeys('2028-02-10')).toHaveLength(29));
  it('erzeugt ISO-Wochen', () =>
    expect(weekKeys('2026-07-14')).toEqual([
      '2026-07-13',
      '2026-07-14',
      '2026-07-15',
      '2026-07-16',
      '2026-07-17',
      '2026-07-18',
      '2026-07-19',
    ]));
  it('konvertiert lokale Berlin-Zeit', () =>
    expect(berlinLocalToIso('2026-01-15', '08:00')).toBe('2026-01-15T07:00:00.000Z'));
});
describe('Dauern und Summen', () => {
  it('berechnet normale Schicht und Pause', () =>
    expect(
      entryNetMinutes(
        { ...entry('2026-02-10T07:00:00Z', '2026-02-10T16:00:00Z'), manual_break_minutes: 30 },
        [],
      ),
    ).toBe(510));
  it('berechnet Nachtschicht', () =>
    expect(entryNetMinutes(entry('2026-02-10T21:00:00Z', '2026-02-11T05:00:00Z'), [])).toBe(480));
  it('berücksichtigt DST', () => {
    expect(entryNetMinutes(entry('2026-03-28T21:00:00Z', '2026-03-29T04:00:00Z'), [])).toBe(420);
    expect(entryNetMinutes(entry('2026-10-24T20:00:00Z', '2026-10-25T05:00:00Z'), [])).toBe(540);
  });
  it('ergänzt Mindestpause nur einmal über mehrere Blöcke', () => {
    const es = [
      entry('2026-02-10T07:00:00Z', '2026-02-10T11:00:00Z', 'work', '2026-02-10', 'a'),
      entry('2026-02-10T11:30:00Z', '2026-02-10T16:00:00Z', 'work', '2026-02-10', 'b'),
    ];
    const d = summarizeDay('2026-02-10', es, [], DEFAULT_TARGETS);
    expect(d.gross).toBe(510);
    expect(d.automaticBreak).toBe(30);
    expect(d.work).toBe(480);
    expect(d.balance).toBe(0);
  });
  it('nutzt Wochentags-Soll und Abwesenheiten', () => {
    const d = summarizeDay(
      '2026-02-09',
      [entry(null, null, 'vacation', '2026-02-09')],
      [],
      DEFAULT_TARGETS,
    );
    expect(d.work).toBe(480);
    expect(d.balance).toBe(0);
    expect(
      summarizeDay('2026-02-09', [entry(null, null, 'holiday', '2026-02-09')], [], DEFAULT_TARGETS)
        .target,
    ).toBe(0);
  });
  it('summiert Wochenwerte', () =>
    expect(summarizeRange(weekKeys('2026-02-09'), [], [], DEFAULT_TARGETS).target).toBe(2400));
  it('formatiert Salden', () => expect(formatMinutes(-75, true)).toBe('−1:15'));
});
