import { z } from 'zod';
import { db } from './db';
import { berlinLocalToIso } from './lib/date';
import { saveLocal } from './repository';
import type { TimeEntry } from './types';
const legacyEntry = z.object({
  id: z.union([z.string(), z.number()]).optional(),
  type: z.string().optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  start: z.string().optional().default(''),
  end: z.string().optional().default(''),
  breakMins: z.coerce.number().min(0).optional().default(0),
  note: z.string().optional().default(''),
});
const legacyRoot = z.object({
  entries: z.array(legacyEntry).default([]),
  active: legacyEntry.nullable().optional(),
  settings: z.record(z.string(), z.unknown()).optional(),
});
const typeMap: Record<string, TimeEntry['entry_type']> = {
  Arbeit: 'work',
  Urlaub: 'vacation',
  Krank: 'sick',
  Feiertag: 'holiday',
};
export interface MigrationResult {
  status: 'none' | 'success' | 'partial' | 'error';
  imported: number;
  errors: string[];
}
export async function migrateLegacy(userId: string): Promise<MigrationResult> {
  const marker = `migration:${userId}`;
  const done = await db.meta.get(marker);
  if (done) return done.value as MigrationResult;
  const raws = [
    ['zt_v1', localStorage.getItem('zt_v1')],
    ['zt_v2', localStorage.getItem('zt_v2')],
  ] as const;
  if (!raws.some(([, r]) => r)) return { status: 'none', imported: 0, errors: [] };
  await db.meta.put({ key: `legacy-backup:${userId}`, value: Object.fromEntries(raws) });
  let imported = 0;
  const errors: string[] = [];
  const seen = new Set<string>();
  for (const [key, raw] of raws) {
    if (!raw) continue;
    try {
      const parsed = legacyRoot.parse(JSON.parse(raw));
      for (const old of [...parsed.entries, ...(parsed.active ? [parsed.active] : [])]) {
        const signature = `${old.id ?? ''}|${old.date}|${old.start}|${old.end}|${old.note}`;
        if (seen.has(signature)) continue;
        seen.add(signature);
        const now = new Date().toISOString();
        const started = old.start ? berlinLocalToIso(old.date, old.start) : null;
        const ended = old.end
          ? berlinLocalToIso(old.date, old.end, old.start && old.end <= old.start ? 1 : 0)
          : null;
        const entry: TimeEntry = {
          id: crypto.randomUUID(),
          user_id: userId,
          project_id: null,
          project_name_snapshot: 'Ohne Baustelle',
          entry_type: typeMap[old.type ?? 'Arbeit'] ?? 'other_absence',
          work_date: old.date,
          started_at: started,
          ended_at: ended,
          manual_break_minutes: old.breakMins,
          automatically_added_break_minutes: 0,
          activity: '',
          note: old.note.slice(0, 1000),
          source: 'migration',
          created_at: now,
          updated_at: now,
          deleted_at: null,
          revision: 0,
        };
        await saveLocal('time_entries', entry);
        imported++;
      }
    } catch (error) {
      errors.push(`${key}: ${error instanceof Error ? error.message : 'beschädigte Daten'}`);
    }
  }
  const result: MigrationResult = {
    status: imported ? (errors.length ? 'partial' : 'success') : 'error',
    imported,
    errors,
  };
  if (imported || errors.length === 0) await db.meta.put({ key: marker, value: result });
  return result;
}
export async function legacyBackup(userId: string) {
  return (await db.meta.get(`legacy-backup:${userId}`))?.value;
}
