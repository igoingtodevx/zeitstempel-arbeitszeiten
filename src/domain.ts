import type { TimeBreak, TimeEntry, WeekdayTargets } from './types';
import { addLocalDays, localDateKey, monthKeys, startOfWeek } from './lib/date';

const DATE_KEY = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/;
const ENTRY_TYPES = new Set(['work', 'vacation', 'sick', 'holiday', 'other_absence']);

function isValidDateKey(value: string) {
  const match = DATE_KEY.exec(value);
  if (!match) return false;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12));
  return (
    date.getUTCFullYear() === Number(match[1]) &&
    date.getUTCMonth() === Number(match[2]) - 1 &&
    date.getUTCDate() === Number(match[3])
  );
}

function isIsoInstant(value: string | null): value is string {
  return value !== null && Number.isFinite(Date.parse(value));
}

function validMinutes(value: number, max = 1440) {
  return Number.isInteger(value) && value >= 0 && value <= max;
}

/** Returns elapsed real minutes; malformed or backwards intervals never become NaN. */
export const minutesBetween = (a: string, b: string) => {
  const start = Date.parse(a);
  const end = Date.parse(b);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0;
  return Math.round((end - start) / 60000);
};

export function validateTimeEntry(entry: TimeEntry): string[] {
  const errors: string[] = [];
  if (!isValidDateKey(entry.work_date)) errors.push('Das Datum ist ungültig.');
  if (!ENTRY_TYPES.has(entry.entry_type)) errors.push('Der Eintragstyp ist ungültig.');
  if (!validMinutes(entry.manual_break_minutes)) errors.push('Die manuelle Pause ist ungültig.');
  if (!validMinutes(entry.automatically_added_break_minutes))
    errors.push('Die automatisch ergänzte Pause ist ungültig.');
  if (entry.entry_type === 'work') {
    if (!isIsoInstant(entry.started_at)) errors.push('Eine Arbeitszeit braucht einen gültigen Start.');
    if (entry.ended_at !== null && !isIsoInstant(entry.ended_at))
      errors.push('Das Ende ist ungültig.');
    if (isIsoInstant(entry.started_at) && isIsoInstant(entry.ended_at) && Date.parse(entry.ended_at) <= Date.parse(entry.started_at))
      errors.push('Das Ende muss nach dem Start liegen.');
  } else if (
    entry.started_at !== null ||
    entry.ended_at !== null ||
    entry.manual_break_minutes !== 0 ||
    entry.automatically_added_break_minutes !== 0
  ) {
    errors.push('Abwesenheiten dürfen keine Arbeitszeit enthalten.');
  }
  return errors;
}

export function recordedBreakMinutes(entry: TimeEntry, breaks: TimeBreak[]): number {
  const manual = validMinutes(entry.manual_break_minutes) ? entry.manual_break_minutes : 0;
  return (
    manual +
    breaks
      .filter((b) => b.time_entry_id === entry.id && !b.deleted_at && b.ended_at)
      .reduce((n, b) => n + minutesBetween(b.started_at, b.ended_at!), 0)
  );
}
export function grossMinutes(entry: TimeEntry, now = new Date()): number {
  return entry.entry_type === 'work' && entry.started_at
    ? minutesBetween(entry.started_at, entry.ended_at ?? now.toISOString())
    : 0;
}
export function minimumBreak(gross: number): number {
  return gross > 9 * 60 ? 45 : gross > 6 * 60 ? 30 : 0;
}
export function entryNetMinutes(
  entry: TimeEntry,
  breaks: TimeBreak[],
  now = new Date(),
  automaticBreakMinutes = entry.automatically_added_break_minutes,
): number {
  if (entry.entry_type !== 'work') return 0;
  const automatic = validMinutes(automaticBreakMinutes) ? automaticBreakMinutes : 0;
  return Math.max(0, grossMinutes(entry, now) - recordedBreakMinutes(entry, breaks) - automatic);
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
  const workEntries = entries.filter((e) => e.entry_type === 'work');
  const gross = workEntries.reduce((n, e) => n + grossMinutes(e, now), 0);
  const recordedBreak = workEntries.reduce((n, e) => n + recordedBreakMinutes(e, breaks), 0);
  const currentAuto = workEntries.reduce(
    (n, e) => n + (validMinutes(e.automatically_added_break_minutes) ? e.automatically_added_break_minutes : 0),
    0,
  );
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

/**
 * Allocates a day-level statutory break to the first work block when it was not
 * persisted on an entry. This keeps per-entry exports consistent with the day total.
 */
export function automaticBreakAllocation(day: DaySummary): Map<string, number> {
  const allocation = new Map<string, number>();
  let persisted = 0;
  for (const entry of day.entries) {
    const value = validMinutes(entry.automatically_added_break_minutes)
      ? entry.automatically_added_break_minutes
      : 0;
    allocation.set(entry.id, value);
    if (entry.entry_type === 'work') persisted += value;
  }
  let remaining = Math.max(0, day.automaticBreak - persisted);
  for (const entry of day.entries) {
    if (entry.entry_type !== 'work' || remaining <= 0) continue;
    allocation.set(entry.id, (allocation.get(entry.id) ?? 0) + remaining);
    remaining = 0;
  }
  return allocation;
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
