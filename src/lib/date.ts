export const ZONE = 'Europe/Berlin';
const partsFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});
export function localDateKey(value: Date | string | number = new Date()): string {
  const parts = partsFmt.formatToParts(new Date(value));
  const get = (t: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}
export function localDateLabel(
  key: string,
  options: Intl.DateTimeFormatOptions = { dateStyle: 'medium' },
): string {
  const [y, m, d] = key.split('-').map(Number);
  return new Intl.DateTimeFormat('de-DE', { ...options, timeZone: ZONE }).format(
    new Date(Date.UTC(y!, m! - 1, d!, 12)),
  );
}
export function localTimeLabel(iso: string | null): string {
  return iso
    ? new Intl.DateTimeFormat('de-DE', {
        timeZone: ZONE,
        hour: '2-digit',
        minute: '2-digit',
      }).format(new Date(iso))
    : '–';
}
export function addLocalDays(key: string, count: number): string {
  const [y, m, d] = key.split('-').map(Number);
  const date = new Date(Date.UTC(y!, m! - 1, d! + count, 12));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}
export function startOfWeek(key = localDateKey()): string {
  const [y, m, d] = key.split('-').map(Number);
  const date = new Date(Date.UTC(y!, m! - 1, d!, 12));
  const dow = date.getUTCDay();
  return addLocalDays(key, -(dow === 0 ? 6 : dow - 1));
}
export function monthKeys(year: number, month1: number): string[] {
  const out: string[] = [];
  let key = `${year}-${String(month1).padStart(2, '0')}-01`;
  while (Number(key.slice(5, 7)) === month1) {
    out.push(key);
    key = addLocalDays(key, 1);
  }
  return out;
}

function localParts(value: Date, formatter: Intl.DateTimeFormat) {
  const parts = formatter.formatToParts(value);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`;
}

/**
 * Converts a Europe/Berlin wall-clock value to an instant without doing offset
 * arithmetic. Ambiguous fall-back times use the later occurrence; nonexistent
 * spring-forward times are rejected instead of being silently shifted.
 */
export function berlinLocalToIso(dateKey: string, time: string, dayOffset = 0): string {
  const baseMatch = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/.exec(dateKey);
  if (!baseMatch) throw new RangeError('Ungültiges Datum');
  const baseDate = new Date(Date.UTC(Number(baseMatch[1]), Number(baseMatch[2]) - 1, Number(baseMatch[3]), 12));
  if (
    baseDate.getUTCFullYear() !== Number(baseMatch[1]) ||
    baseDate.getUTCMonth() !== Number(baseMatch[2]) - 1 ||
    baseDate.getUTCDate() !== Number(baseMatch[3])
  )
    throw new RangeError('Ungültiges Datum');
  const target = addLocalDays(dateKey, dayOffset);
  const dateMatch = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/.exec(target);
  const timeMatch = /^([0-9]{2}):([0-9]{2})$/.exec(time);
  if (!dateMatch || !timeMatch) throw new RangeError('Ungültige lokale Zeit');
  const y = Number(dateMatch[1]);
  const m = Number(dateMatch[2]);
  const d = Number(dateMatch[3]);
  const h = Number(timeMatch[1]);
  const min = Number(timeMatch[2]);
  const calendar = new Date(Date.UTC(y, m - 1, d, 12));
  if (
    calendar.getUTCFullYear() !== y ||
    calendar.getUTCMonth() !== m - 1 ||
    calendar.getUTCDate() !== d ||
    h > 23 ||
    min > 59
  )
    throw new RangeError('Ungültige lokale Zeit');

  const desired = `${target}T${time}`;
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const pseudoUtc = Date.UTC(y, m - 1, d, h, min);
  const candidates: number[] = [];
  for (let offset = -3 * 60; offset <= 3 * 60; offset++) {
    const instant = pseudoUtc + offset * 60_000;
    if (localParts(new Date(instant), formatter) === desired) candidates.push(instant);
  }
  if (!candidates.length) throw new RangeError('Diese lokale Zeit existiert wegen der Zeitumstellung nicht.');
  return new Date(candidates[candidates.length - 1]!).toISOString();
}
