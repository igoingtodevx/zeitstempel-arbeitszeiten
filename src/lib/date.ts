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
export function berlinLocalToIso(dateKey: string, time: string, dayOffset = 0): string {
  const target = addLocalDays(dateKey, dayOffset);
  const [y, m, d] = target.split('-').map(Number);
  const [h, min] = time.split(':').map(Number);
  const desired = Date.UTC(y!, m! - 1, d!, h!, min!);
  let guess = desired;
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  for (let i = 0; i < 3; i++) {
    const shown = formatter.formatToParts(new Date(guess));
    const get = (type: Intl.DateTimeFormatPartTypes) =>
      Number(shown.find((p) => p.type === type)?.value);
    const represented = Date.UTC(
      get('year'),
      get('month') - 1,
      get('day'),
      get('hour'),
      get('minute'),
    );
    const delta = desired - represented;
    if (!delta) break;
    guess += delta;
  }
  return new Date(guess).toISOString();
}
