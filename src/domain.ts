import type { TimeBreak, TimeEntry, WeekdayTargets } from './types';
import { addLocalDays, localDateKey, monthKeys, startOfWeek } from './lib/date';
export const minutesBetween = (a: string, b: string) =>
  Math.max(0, Math.round((Date.parse(b) - Date.parse(a)) / 60000));
export function recordedBreakMinutes(entry: TimeEntry, breaks: TimeBreak[]): number {
  return (
    entry.manual_break_minutes +
    breaks
      .filter((b) => b.time_entry_id === entry.id && !b.deleted_at && b.ended_at)
      .reduce((n, b) => n + minutesBetween(b.started_at, b.ended_at!), 0)
  );
}
export function grossMinutes(entry: TimeEntry, now = new Date()): number {
  return entry.started_at
    ? minutesBetween(entry.started_at, entry.ended_at ?? now.toISOString())
    : 0;
}
export function minimumBreak(gross: number): number {
  return gross > 9 * 60 ? 45 : gross > 6 * 60 ? 30 : 0;
}
export function entryNetMinutes(entry: TimeEntry, breaks: TimeBreak[], now = new Date()): number {
  if (entry.entry_type !== 'work') return 0;
  return Math.max(
    0,
    grossMinutes(entry, now) -
      recordedBreakMinutes(entry, breaks) -
      entry.automatically_added_break_minutes,
  );
}
export function targetForDate(key: string, targets: WeekdayTargets): number {
  const [y, m, d] = key.split('-').map(Number);
  return targets[String(new Date(Date.UTC(y!, m! - 1, d!, 12)).getUTCDay())] ?? 0;
}
export function creditedAbsence(entry: TimeEntry, targets: WeekdayTargets): number {
  return ['vacation', 'sick', 'holiday'].includes(entry.entry_type)
    ? targetForDate(entry.work_date, targets)
    : 0;
}
export interface DaySummary {
  date: string;
  work: number;
  credited: number;
  gross: number;
  recordedBreak: number;
  automaticBreak: number;
  target: number;
  balance: number;
  entries: TimeEntry[];
}
export function summarizeDay(
  date: string,
  all: TimeEntry[],
  breaks: TimeBreak[],
  targets: WeekdayTargets,
  now = new Date(),
  automaticBreakEnabled = true,
): DaySummary {
  const entries = all.filter((e) => e.work_date === date && !e.deleted_at);
  const gross = entries.reduce((n, e) => n + grossMinutes(e, now), 0);
  const recordedBreak = entries.reduce((n, e) => n + recordedBreakMinutes(e, breaks), 0);
  const currentAuto = entries.reduce((n, e) => n + e.automatically_added_break_minutes, 0);
  const required = minimumBreak(gross);
  const automaticBreak = automaticBreakEnabled
    ? Math.max(currentAuto, Math.max(0, required - recordedBreak))
    : currentAuto;
  const rawWork = Math.max(0, gross - recordedBreak - automaticBreak);
  const credited = Math.max(0, ...entries.map((e) => creditedAbsence(e, targets)));
  const target = entries.some((entry) => entry.entry_type === 'holiday')
    ? 0
    : targetForDate(date, targets);
  const work = Math.max(rawWork, credited);
  return {
    date,
    work,
    credited,
    gross,
    recordedBreak,
    automaticBreak,
    target,
    balance: work - target,
    entries,
  };
}
export function summarizeRange(
  keys: string[],
  entries: TimeEntry[],
  breaks: TimeBreak[],
  targets: WeekdayTargets,
  now = new Date(),
  automaticBreakEnabled = true,
) {
  const days = keys.map((k) =>
    summarizeDay(k, entries, breaks, targets, now, automaticBreakEnabled),
  );
  return {
    days,
    worked: days.reduce((n, d) => n + d.work, 0),
    target: days.reduce((n, d) => n + d.target, 0),
    balance: days.reduce((n, d) => n + d.balance, 0),
  };
}
export function weekKeys(key = localDateKey()) {
  const first = startOfWeek(key);
  return Array.from({ length: 7 }, (_, i) => addLocalDays(first, i));
}
export function currentMonthKeys(key = localDateKey()) {
  return monthKeys(Number(key.slice(0, 4)), Number(key.slice(5, 7)));
}
export function formatMinutes(value: number, signed = false) {
  const sign = value < 0 ? '−' : signed && value > 0 ? '+' : '';
  const n = Math.abs(Math.round(value));
  return `${sign}${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}`;
}
